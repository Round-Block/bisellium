/**
 * packages/cli/src/branch.ts — W-026: per-opus branching.
 * Create opus/<id> branches from HEAD, merge back to master when done.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

interface BranchResult {
  ok: boolean;
  error?: string;
}

function git(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function opusBranchName(opusId: string): string {
  return `opus/${opusId}`;
}

export function createOpusBranch(repo: string, opusId: string): BranchResult {
  const cwd = resolve(repo);
  const branch = opusBranchName(opusId);

  const exists = git(["rev-parse", "--verify", branch], cwd);
  if (exists.status === 0) return { ok: false, error: `branch ${branch} already exists` };

  const create = git(["branch", branch], cwd);
  if (create.status !== 0) return { ok: false, error: create.stderr.trim() || "failed to create branch" };

  return { ok: true };
}

export function mergeOpusBranch(repo: string, opusId: string): BranchResult {
  const cwd = resolve(repo);
  const branch = opusBranchName(opusId);

  const exists = git(["rev-parse", "--verify", branch], cwd);
  if (exists.status !== 0) return { ok: false, error: `branch ${branch} does not exist` };

  // check if fast-forward is possible (opus branch is ahead of master, no divergence)
  const mergeBase = git(["merge-base", "HEAD", branch], cwd);
  const headRev = git(["rev-parse", "HEAD"], cwd);
  if (mergeBase.stdout.trim() !== headRev.stdout.trim()) {
    // master has moved — check for conflicts
    const canMerge = git(["merge", "--no-commit", "--no-ff", branch], cwd);
    if (canMerge.status !== 0) {
      git(["merge", "--abort"], cwd);
      return { ok: false, error: `branch ${branch} conflicts with master` };
    }
    git(["merge", "--abort"], cwd);
    return { ok: false, error: `branch ${branch} has diverged from master — rebase first` };
  }

  const merge = git(["merge", "--ff-only", branch], cwd);
  if (merge.status !== 0) return { ok: false, error: merge.stderr.trim() || "merge failed" };

  git(["branch", "-d", branch], cwd);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CLI wrappers
// ---------------------------------------------------------------------------

const BRANCH_USAGE = "usage: bisellium branch <opus-id> --studio <dir> [--repo <dir>]";
const MERGE_USAGE = "usage: bisellium merge <opus-id> --studio <dir> --repo <dir>";

function parseSimple(args: string[]): { positionals: string[]; values: Map<string, string> } {
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) { values.set(a, args[++i] ?? ""); continue; }
    positionals.push(a);
  }
  return { positionals, values };
}

export function runBranch(args: string[]): { exitCode: number } {
  const { positionals, values } = parseSimple(args);
  const opusId = positionals[0];
  if (!opusId) { console.error(BRANCH_USAGE); return { exitCode: 2 }; }

  const studio = resolve(values.get("--studio") ?? ".");
  if (!existsSync(join(studio, "opera", `${opusId}.md`))) {
    console.error(`opus ${opusId} not found in ${studio}`);
    return { exitCode: 1 };
  }

  const repo = resolve(values.get("--repo") ?? ".");
  const result = createOpusBranch(repo, opusId);
  if (!result.ok) { console.error(result.error); return { exitCode: 1 }; }
  console.log(`created ${opusBranchName(opusId)}`);
  return { exitCode: 0 };
}

export function runMerge(args: string[]): { exitCode: number } {
  const { positionals, values } = parseSimple(args);
  const opusId = positionals[0];
  if (!opusId) { console.error(MERGE_USAGE); return { exitCode: 2 }; }

  const studio = resolve(values.get("--studio") ?? ".");
  if (!existsSync(join(studio, "opera", `${opusId}.md`))) {
    console.error(`opus ${opusId} not found in ${studio}`);
    return { exitCode: 1 };
  }

  const repo = resolve(values.get("--repo") ?? ".");
  const result = mergeOpusBranch(repo, opusId);
  if (!result.ok) { console.error(result.error); return { exitCode: 1 }; }
  console.log(`merged ${opusBranchName(opusId)} into master`);
  return { exitCode: 0 };
}
