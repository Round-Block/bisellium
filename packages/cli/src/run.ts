/**
 * `bisellium run` — run a command as a sella, optionally inside its own
 * worktree, leaving a receipt behind. Kept out of main.ts's own argv table
 * (W-008 spec) — the logic lives here as `runCommand`, importable directly
 * by tests and wired into main.ts separately.
 *
 * Exit codes: 0/whatever the child exits with · 2 usage error (bad flags,
 * missing "--", empty command, unknown/undeclared sella, not a studio).
 */
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { readManifest } from "@bisellium/adapter-native";
import type { WorktreeProvider } from "@bisellium/shim";
import { makeSessionId, selectProvider, writeReceiptEnd, writeReceiptStart } from "@bisellium/shim";

export interface RunOptions {
  /** Pinned clock, for reproducible sessionIds/receipts in tests. */
  now?: Date;
  /** Override provider selection (tests only) — default is selectProvider(). */
  provider?: WorktreeProvider;
}

export interface RunResult {
  exitCode: number;
}

const USAGE =
  "usage: bisellium run --sella <sella> [--studio <dir>] [--no-worktree] [--base <ref>] [--keep] -- <cmd…>";

/** `studio` slug for GIT_AUTHOR_EMAIL / BISELLIUM_STUDIO — same shape as adapter-native's projectId default. */
function studioSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** True when `git status --porcelain` in `path` reports anything at all. */
function hasUncommittedChanges(path: string): boolean {
  const r = spawnSync("git", ["-C", path, "status", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0) return true; // can't tell — the safe default is to keep it, not to delete work
  return r.stdout.trim().length > 0;
}

export async function runCommand(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();

  let sella: string | undefined;
  let studio = ".";
  let noWorktree = false;
  let base: string | undefined;
  let keep = false;
  let sepIndex = -1;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") { sepIndex = i; break; }
    if (a === "--sella") { sella = args[++i]; continue; }
    if (a === "--studio") { studio = args[++i] ?? studio; continue; }
    if (a === "--no-worktree") { noWorktree = true; continue; }
    if (a === "--base") { base = args[++i]; continue; }
    if (a === "--keep") { keep = true; continue; }
    console.error(`bisellium run: unknown flag "${a}"\n${USAGE}`);
    return { exitCode: 2 };
  }
  if (sepIndex === -1) { console.error(`bisellium run: missing "--" before the command\n${USAGE}`); return { exitCode: 2 }; }
  const cmd = args.slice(sepIndex + 1);
  if (cmd.length === 0) { console.error(`bisellium run: empty command after "--"\n${USAGE}`); return { exitCode: 2 }; }
  if (!sella) { console.error(`bisellium run: --sella is required\n${USAGE}`); return { exitCode: 2 }; }

  const studioRoot = resolve(studio);
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

  let worktree: Awaited<ReturnType<WorktreeProvider["acquire"]>> | undefined;
  if (!noWorktree) {
    const provider = opts.provider ?? selectProvider();
    try {
      worktree = await provider.acquire({ repo: studioRoot, sella, base });
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
    child.on("exit", (code, signal) => res(code ?? (signal ? 1 : 1)));
  });

  const endedAt = new Date();
  writeReceiptEnd(receiptFile, {
    endedAt: endedAt.toISOString(),
    exitCode,
    durationMs: Date.now() - wallStart,
  });

  if (worktree) {
    const dirty = hasUncommittedChanges(worktree.path);
    if (keep || dirty) {
      console.log(`worktree kept at ${worktree.path}${dirty ? " (uncommitted changes)" : " (--keep)"}`);
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
