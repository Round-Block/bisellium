/**
 * `bisellium run` — run a command as a sella, optionally inside its own
 * worktree, leaving a receipt behind. Kept out of main.ts's own argv table
 * (W-008 spec) — the logic lives here as `runCommand`, importable directly
 * by tests and wired into main.ts separately. `bisellium run --reclaim`
 * (or `--reclaim --repo <dir>` outside a studio) removes worktrees whose
 * branch is merged or whose directory is gone, so growth under
 * `<repo>/.bisellium/worktrees/` is bounded.
 *
 * Exit codes: 0/whatever the child exits with (128+signal if it was killed
 * by a signal) · 2 usage error (bad flags, missing "--", empty command,
 * unknown/undeclared sella, not a studio).
 */
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { constants as osConstants } from "node:os";
import { join, resolve } from "node:path";
import { readManifest } from "@bisellium/adapter-native";
import type { WorktreeProvider } from "@bisellium/shim";
import { makeSessionId, reclaimWorktrees, selectProvider, writeReceiptEnd, writeReceiptStart } from "@bisellium/shim";
import { pauseWarning } from "./pause.js";

export interface RunOptions {
  /** Pinned clock, for reproducible sessionIds/receipts in tests. */
  now?: Date;
  /** Override provider selection (tests only) — default is selectProvider(). */
  provider?: WorktreeProvider;
}

export interface RunResult {
  exitCode: number;
}

const GIT_TIMEOUT_MS = 30_000;

const USAGE =
  "usage: bisellium run --sella <sella> [--studio <dir>] [--repo <dir>] [--no-worktree] [--base <ref>] [--opus <id>] [--keep] -- <cmd…>\n" +
  "       bisellium run --reclaim [--studio <dir>] [--repo <dir>]";

/** `studio` slug for GIT_AUTHOR_EMAIL / BISELLIUM_STUDIO — same shape as adapter-native's projectId default. */
function studioSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

type GitStatus = "clean" | "dirty" | "unknown";

/** git status --porcelain in `path` — "unknown" means git itself failed to
 *  answer (never "clean": a leased worktree we can't inspect must not be
 *  silently treated as safe to keep quiet about, but it also must not be
 *  leaked — see the "unknown" handling in runCommand). */
function gitStatus(path: string): GitStatus {
  const r = spawnSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (r.error || r.status !== 0) return "unknown";
  return r.stdout.trim().length > 0 ? "dirty" : "clean";
}

/** The git repo root for `studioRoot`: `--repo` if given, else `git
 *  rev-parse --show-toplevel` run from the studio dir. Worktrees must live
 *  under *this* repo's `.bisellium/worktrees/`, not under the studio dir —
 *  the studio can be (and often is) a subdirectory of the repo. */
function resolveRepoRoot(studioRoot: string, repoFlag: string | undefined): { repo: string } | { error: string } {
  if (repoFlag !== undefined) return { repo: resolve(repoFlag) };
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: studioRoot, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  if (r.status !== 0) return { error: `not inside a git repo: ${studioRoot} (pass --repo)` };
  return { repo: resolve(r.stdout.trim()) };
}

/** Consumes the value for `flag` at `args[i]`; a missing value or one that
 *  looks like another flag (starts with "--") is a usage error, never a
 *  silently swallowed flag or a silently kept default. */
function takeValue(args: string[], i: number, flag: string): { value: string } | { error: string } {
  const v = args[i];
  if (v === undefined) return { error: `${flag} needs a value\n${USAGE}` };
  if (v.startsWith("--")) return { error: `${flag} needs a value, got flag "${v}"\n${USAGE}` };
  return { value: v };
}

export async function runCommand(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();

  let sella: string | undefined;
  let studio = ".";
  let repoFlag: string | undefined;
  let noWorktree = false;
  let base: string | undefined;
  let keep = false;
  let reclaim = false;
  let opus: string | undefined;
  let sepIndex = -1;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") { sepIndex = i; break; }
    if (a === "--opus") {
      const r = takeValue(args, ++i, "--opus");
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      opus = r.value;
      continue;
    }
    if (a === "--sella") {
      const r = takeValue(args, ++i, "--sella");
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      sella = r.value;
      continue;
    }
    if (a === "--studio") {
      const r = takeValue(args, ++i, "--studio");
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      studio = r.value;
      continue;
    }
    if (a === "--repo") {
      const r = takeValue(args, ++i, "--repo");
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      repoFlag = r.value;
      continue;
    }
    if (a === "--base") {
      const r = takeValue(args, ++i, "--base");
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      base = r.value;
      continue;
    }
    if (a === "--no-worktree") { noWorktree = true; continue; }
    if (a === "--keep") { keep = true; continue; }
    if (a === "--reclaim") { reclaim = true; continue; }
    console.error(`bisellium run: unknown flag "${a}"\n${USAGE}`);
    return { exitCode: 2 };
  }

  const studioRoot = resolve(studio);

  if (reclaim) {
    const resolved = resolveRepoRoot(studioRoot, repoFlag);
    if ("error" in resolved) { console.error(`bisellium run --reclaim: ${resolved.error}`); return { exitCode: 2 }; }
    const result = reclaimWorktrees(resolved.repo);
    for (const r of result.removed) console.log(`removed ${r.path}${r.branch ? ` (branch ${r.branch})` : ""} — ${r.reason}`);
    for (const k of result.kept) console.log(`kept ${k.path} — ${k.reason}`);
    if (result.removed.length === 0 && result.kept.length === 0) console.log(`no worktrees under ${join(resolved.repo, ".bisellium", "worktrees")}`);
    return { exitCode: 0 };
  }

  if (sepIndex === -1) { console.error(`bisellium run: missing "--" before the command\n${USAGE}`); return { exitCode: 2 }; }
  const cmd = args.slice(sepIndex + 1);
  if (cmd.length === 0) { console.error(`bisellium run: empty command after "--"\n${USAGE}`); return { exitCode: 2 }; }
  if (!sella) { console.error(`bisellium run: --sella is required\n${USAGE}`); return { exitCode: 2 }; }
  if (opus && base) { console.error(`bisellium run: --opus and --base are mutually exclusive\n${USAGE}`); return { exitCode: 2 }; }
  if (opus) base = `opus/${opus}`;

  const manifestPath = join(studioRoot, "bisellium.yml");
  if (!existsSync(manifestPath)) { console.error(`not a studio: ${studioRoot}`); return { exitCode: 2 }; }

  let manifest;
  try {
    manifest = readManifest(studioRoot);
  } catch (e) {
    console.error(`not a studio (unreadable manifest): ${(e as Error).message}`);
    return { exitCode: 2 };
  }
  if (!(manifest.sellae ?? []).some((s) => s.id === sella)) {
    console.error(`unknown sella "${sella}" — not declared in ${manifestPath}`);
    return { exitCode: 2 };
  }

  // `bisellium pause` stops autonomous starting (bisellium tick), not
  // talking — a sella already being run by hand proceeds regardless, with
  // just a warning so the operator knows the brake is on.
  const warning = pauseWarning(studioRoot);
  if (warning) console.error(warning);

  let worktree: Awaited<ReturnType<WorktreeProvider["acquire"]>> | undefined;
  if (!noWorktree) {
    const resolved = resolveRepoRoot(studioRoot, repoFlag);
    if ("error" in resolved) { console.error(`bisellium run: ${resolved.error}`); return { exitCode: 2 }; }
    const provider = opts.provider ?? selectProvider();
    try {
      worktree = await provider.acquire({ repo: resolved.repo, sella, base });
    } catch (e) {
      console.error(`worktree acquire failed (${provider.id}): ${(e as Error).message}`);
      return { exitCode: 1 };
    }
  }
  const cwd = worktree?.path ?? studioRoot;

  const startedAt = now;
  const sessionId = makeSessionId(startedAt);
  const slug = studioSlug(manifest.studio || "studio");
  const receiptFile = writeReceiptStart(studioRoot, {
    sella,
    sessionId,
    startedAt: startedAt.toISOString(),
    cwd,
    cmd,
  });

  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: sella,
    GIT_AUTHOR_EMAIL: `${sella}@${slug}.bisellium`,
    GIT_COMMITTER_NAME: sella,
    GIT_COMMITTER_EMAIL: `${sella}@${slug}.bisellium`,
    BISELLIUM_SELLA: sella,
    BISELLIUM_STUDIO: slug,
    BISELLIUM_SESSION: sessionId,
  };

  // Elapsed time is measured off the real clock, never off `startedAt` —
  // `startedAt`/`now` may be pinned (tests, reproducible logs), and mixing a
  // pinned business timestamp with the real completion time would make
  // durationMs meaningless (even negative) whenever they diverge.
  const wallStart = Date.now();
  const exitCode = await new Promise<number>((res) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env, stdio: "inherit" });
    child.on("error", (err) => {
      console.error(`bisellium run: failed to start "${cmd[0]}": ${err.message}`);
      res(127);
    });
    child.on("exit", (code, signal) => {
      if (code !== null) { res(code); return; }
      if (signal) {
        const signalNum = (osConstants.signals as Record<string, number>)[signal];
        res(128 + (signalNum ?? 0));
        return;
      }
      res(1);
    });
  });

  const endedAt = new Date();
  writeReceiptEnd(receiptFile, {
    endedAt: endedAt.toISOString(),
    exitCode,
    durationMs: Date.now() - wallStart,
  });

  if (worktree) {
    const status = gitStatus(worktree.path);
    if (status === "unknown") {
      // We can't tell whether the worktree has uncommitted work, but sitting
      // on a lease we can't inspect is worse than the small chance of
      // dropping work we couldn't have detected anyway — treehouse leases in
      // particular must never be leaked.
      console.error(`bisellium run: could not determine worktree status at ${worktree.path}; releasing anyway to avoid leaking the lease`);
      try {
        await worktree.release();
      } catch (e) {
        console.error(`worktree release failed: ${(e as Error).message}`);
      }
    } else if (keep || status === "dirty") {
      console.log(`worktree kept at ${worktree.path}${status === "dirty" ? " (uncommitted changes)" : " (--keep)"}`);
    } else {
      try {
        await worktree.release();
      } catch (e) {
        console.error(`worktree release failed: ${(e as Error).message}`);
      }
    }
  }

  return { exitCode };
}
