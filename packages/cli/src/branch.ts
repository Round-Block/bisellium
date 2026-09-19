/**
 * packages/cli/src/branch.ts — W-026: per-opus branching.
 * Create opus/<id> branches from HEAD, merge back to master when done.
 *
 * mergeOpusBranch never trusts the current checkout for "where is master":
 * builders normally run `bisellium merge` from a worktree sitting on
 * opus/<id> itself, and an operator can just as easily be on some third
 * branch. Every decision (divergence, conflict, fast-forward) is made
 * against the trunk branch by name (see resolveTrunk), and the trunk ref is
 * advanced without touching the working tree when the trunk isn't what's
 * checked out (see the `git fetch . <src>:<dst>` branch below).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFront } from "@bisellium/adapter-native";

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

/** The trunk branch — "master" if it exists, else "main". Merges always
 *  target this by name; see the module comment for why. */
function resolveTrunk(cwd: string): { name: string } | { error: string } {
  for (const name of ["master", "main"]) {
    if (git(["rev-parse", "--verify", name], cwd).status === 0) return { name };
  }
  return { error: "no master or main branch found" };
}

export function mergeOpusBranch(repo: string, opusId: string, studio: string): BranchResult {
  const cwd = resolve(repo);
  const branch = opusBranchName(opusId);

  const exists = git(["rev-parse", "--verify", branch], cwd);
  if (exists.status !== 0) return { ok: false, error: `branch ${branch} does not exist` };

  const opusPath = join(resolve(studio), "opera", `${opusId}.md`);
  let state: string | undefined;
  try {
    const data = readFront<Record<string, unknown>>(opusPath).data;
    state = typeof data["state"] === "string" ? data["state"] : undefined;
  } catch {
    return { ok: false, error: `opus ${opusId} unreadable at ${opusPath}` };
  }
  if (state !== "done") return { ok: false, error: `opus ${opusId} is not done (state: ${state ?? "?"})` };

  const trunk = resolveTrunk(cwd);
  if ("error" in trunk) return { ok: false, error: trunk.error };
  const master = trunk.name;

  const masterRev = git(["rev-parse", master], cwd).stdout.trim();
  const mergeBase = git(["merge-base", master, branch], cwd).stdout.trim();

  if (mergeBase !== masterRev) {
    // master has moved since the opus branch forked. Probe the merge with
    // `merge-tree`, which computes the result purely in-memory — unlike
    // `git merge --no-commit`, it never touches the working directory or
    // index, so it's safe to run regardless of what's checked out or
    // whether the tree is dirty.
    const probe = git(["merge-tree", "--write-tree", master, branch], cwd);
    if (probe.status !== 0) return { ok: false, error: `branch ${branch} conflicts with ${master}` };
    return { ok: false, error: `branch ${branch} has diverged from ${master} — rebase first` };
  }

  const current = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.trim();
  if (current === master) {
    // Already on the trunk — merge in place, same as any manual merge.
    const merge = git(["merge", "--ff-only", branch], cwd);
    if (merge.status !== 0) return { ok: false, error: merge.stderr.trim() || "merge failed" };
  } else {
    // Not on the trunk (the opus branch itself, or anything else) —
    // advance the trunk ref directly instead of checking it out.
    // `git fetch . <src>:<dst>` only ever fast-forwards `dst`, so this
    // can never land the merge on whatever happens to be checked out.
    const fetch = git(["fetch", ".", `${branch}:${master}`], cwd);
    if (fetch.status !== 0) return { ok: false, error: fetch.stderr.trim() || `could not fast-forward ${master}` };
  }

  // `-D` (force), not `-d`: git's `-d` safety check is "merged into HEAD",
  // but HEAD may be `master`'s old position (before the fetch above), some
  // third branch, or `branch` itself — none of those reach the commit via
  // HEAD even though `master` now contains it. The merge-base check above
  // already proved `branch` is an ancestor of the new `master`, so this
  // isn't skipping a safety check, it's replacing an inapplicable one.
  const del = git(["branch", "-D", branch], cwd);
  if (del.status !== 0) {
    // master genuinely advanced above — this is a real partial failure,
    // never silently reported as a full success. The usual cause is
    // being checked out on `branch` itself, which git refuses to delete.
    return {
      ok: false,
      error: `${master} fast-forwarded to ${branch}, but could not delete ${branch}: ${del.stderr.trim() || "in use"} — switch off it and delete manually`,
    };
  }
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
  const result = mergeOpusBranch(repo, opusId, studio);
  if (!result.ok) { console.error(result.error); return { exitCode: 1 }; }
  console.log(`merged ${opusBranchName(opusId)} into master`);
  return { exitCode: 0 };
}
