/**
 * `bisellium ci` — W-031: runs the same six steps `.github/workflows/ci.yml`
 * runs, locally, without a runner. GitHub Actions is blocked on billing
 * there (studio/briefs/W-031.md) — every push/PR dies in ~3 seconds with an
 * empty `steps: []`, so QA has been hand-building scratch worktrees and
 * re-running the suite before it could judge anything. This is the same
 * pipeline, one command.
 *
 * CI_STEPS is the single source of truth for the step list, in `ci.yml`'s
 * order (typecheck, lint, format:check, test, check studio, check
 * examples/sample-studio — `npm ci` itself is a dependency-install
 * prerequisite, not one of the six). scripts/ci-workflow.test.mjs's drift
 * guard spawns a `node --import tsx` child to read this export straight out
 * of this file and diffs it against `ci.yml`'s own `run:` lines, so the two
 * lists cannot silently drift apart — see that script for why it needs a
 * child process instead of an ordinary import.
 *
 * `--ref` proves the ref's `packages/`, not the working tree's: three
 * builders hit a trap where a fresh worktree with no `node_modules` of its
 * own resolves `@bisellium/*` through the PARENT checkout, so edits to
 * `packages/` are silently invisible to what actually ran. Reusing the
 * invoking checkout's `node_modules` for the scratch worktree (a symlink
 * farm, or simply not reinstalling) reintroduces exactly that trap — only a
 * real, from-scratch `npm ci` inside the scratch checkout makes its
 * workspace packages (and any dependency version the ref itself changed)
 * resolve to THAT checkout. `npm ci`'s default cache directory is
 * overridden to a throwaway temp dir: on at least the sandboxed dev machine
 * this opus was built on, the default `~/.npm/_cacache` is read-only, and
 * pointing `--cache` at a writable directory is the documented way around
 * that (an environment fact, not a design gap — and worth stating plainly,
 * since a `--ref` that quietly fell back to skipping install, or to
 * borrowing the parent's node_modules, would silently lie about having
 * tested the ref at all).
 *
 * `--opus <id>` reuses `runVerify` verbatim afterwards to mint the `tests`/
 * `lint`/`types` gate certificates — no separate certificate-minting or
 * tree-hashing logic here.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { MergePipeline } from "@bisellium/pipeline";
import { selectProvider, type AcquiredWorktree, type WorktreeProvider } from "@bisellium/shim";
import { parseFlags } from "./writes.js";
import { runVerify, type RunVerifyResult } from "./verify.js";

// The six steps `.github/workflows/ci.yml` runs, in order — `npm ci` is a
// dependency-install prerequisite, not one of the six, and is deliberately
// left out here the same way it's left out of the brief's own list.
export const CI_STEPS: readonly string[] = [
  "npm run -s typecheck",
  "npm run -s lint",
  "npm run -s format:check",
  "npm test",
  "npm run -s check -- studio --repo .",
  "npm run -s check -- examples/sample-studio --repo .",
];

export interface RunCiOptions {
  /** Override worktree provider — mainly for tests. Defaults to selectProvider(). */
  provider?: WorktreeProvider;
  /** Forwarded into runVerify when --opus is given — mainly for tests. */
  pipeline?: MergePipeline;
  /** Installs dependencies into the scratch checkout `--ref` acquires,
   *  before any step runs there. Only ever called on the `--ref` path — the
   *  current-tree path is responsible for its own node_modules, same as
   *  every other command in this repo. Defaults to a real `npm ci` against
   *  an isolated cache dir; overridable for tests whose fixture repo's
   *  steps need no installed dependency at all. */
  installDeps?: (repoDir: string) => void;
}

export interface RunCiResult {
  exitCode: number;
}

const USAGE = "usage: bisellium ci [--ref <ref>] [--opus <id>] [--studio <dir>] [--repo <dir>]";
const GIT_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 10 * 60_000;

/** `git rev-parse --show-toplevel` from `cwd`, or undefined outside a repo. */
function gitRoot(cwd: string): string | undefined {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function defaultInstallDeps(repoDir: string): void {
  const cacheDir = mkdtempSync(join(tmpdir(), "bisellium-ci-npm-cache-"));
  try {
    const r = spawnSync("npm", ["ci", "--no-audit", "--no-fund", "--cache", cacheDir], {
      cwd: repoDir,
      stdio: "inherit",
      timeout: STEP_TIMEOUT_MS,
    });
    if (r.error) throw new Error(`could not start npm: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`npm ci exited ${r.status ?? `(signal ${r.signal})`}`);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

/** Runs one CI_STEPS entry in `cwd`. Every entry is a fixed, hardcoded
 *  string with no quoting needs — a plain space split is enough, never a
 *  shell. */
function runStep(command: string, cwd: string): number {
  const [bin, ...rest] = command.split(" ");
  const r = spawnSync(bin!, rest, { cwd, stdio: "inherit", timeout: STEP_TIMEOUT_MS });
  if (r.error) {
    console.error(`bisellium ci: failed to start "${command}": ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

export async function runCi(args: string[], opts: RunCiOptions = {}): Promise<RunCiResult> {
  const parsed = parseFlags(args, { valued: ["--ref", "--opus", "--studio", "--repo"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  if (positionals.length > 0) {
    console.error(`unexpected argument "${positionals[0]}"\n${USAGE}`);
    return { exitCode: 2 };
  }

  const ref = values.get("--ref");
  const opusId = values.get("--opus");
  const studioArg = values.get("--studio");
  const repoFlag = values.get("--repo");

  let execRepo: string;
  let worktree: AcquiredWorktree | undefined;

  if (ref !== undefined) {
    const root = repoFlag !== undefined ? resolve(repoFlag) : gitRoot(process.cwd());
    if (root === undefined) {
      console.error(`bisellium ci: not inside a git repo (pass --repo)\n${USAGE}`);
      return { exitCode: 2 };
    }
    const provider = opts.provider ?? selectProvider();
    try {
      worktree = await provider.acquire({ repo: root, sella: "ci", base: ref });
    } catch (e) {
      console.error(`bisellium ci: could not check out ref "${ref}" (${provider.id}): ${(e as Error).message}`);
      return { exitCode: 2 };
    }
    execRepo = worktree.path;
  } else {
    execRepo = resolve(repoFlag ?? ".");
  }

  try {
    if (worktree) {
      try {
        (opts.installDeps ?? defaultInstallDeps)(execRepo);
      } catch (e) {
        console.error(`bisellium ci: dependency install failed for ref "${ref}": ${(e as Error).message}`);
        return { exitCode: 1 };
      }
    }

    for (const step of CI_STEPS) {
      const status = runStep(step, execRepo);
      if (status !== 0) {
        console.error(`bisellium ci: step failed (exit ${status}): ${step}`);
        return { exitCode: 1 };
      }
    }

    if (opusId !== undefined) {
      const verifyArgs = [opusId, "--repo", execRepo, "--allow-dirty"];
      if (studioArg !== undefined) verifyArgs.push("--studio", studioArg);
      const verifyOpts = opts.pipeline !== undefined ? { pipeline: opts.pipeline } : {};
      const result: RunVerifyResult = await runVerify(verifyArgs, verifyOpts);
      return result;
    }

    return { exitCode: 0 };
  } finally {
    if (worktree) {
      try {
        await worktree.release();
      } catch (e) {
        console.error(`bisellium ci: worktree release failed: ${(e as Error).message}`);
      }
    }
  }
}
