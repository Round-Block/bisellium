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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFront, readManifest } from "@bisellium/adapter-native";

interface BranchResult {
  ok: boolean;
  error?: string;
  /** Non-fatal information the CLI should still print — e.g. that a rebase
   *  rewrote the opus's tree (D-015: its `tree:` gate certificates are now
   *  stale, and `check` will say so) or that a PR still has to carry the
   *  change (D-015 leaves PR creation to W-028). */
  note?: string;
  /** The trunk branch name actually touched (see `resolveTrunk`) — never
   *  assumed to be "master" (the W-026 adjacent bug: a repo whose trunk is
   *  `main` merged into `main` but reported "master"). */
  trunk?: string;
  /** True once the change actually reached the trunk locally. False when
   *  `integration.pr.required` stopped short of that on purpose — never
   *  reported as "merged" (see `runMerge`). */
  landed?: boolean;
}

type IntegrationStrategy = "fast_forward" | "rebase" | "merge_commit";
const STRATEGIES: IntegrationStrategy[] = ["fast_forward", "rebase", "merge_commit"];

interface ResolvedIntegration {
  strategy: IntegrationStrategy;
  push: boolean;
  pullAfterPush: boolean;
  prRequired: boolean;
  prReviewer?: string;
}

/** Reads `integration:` (D-015) from the officina manifest. An absent
 *  block, an absent bisellium.yml (tests routinely give `mergeOpusBranch` a
 *  bare studio dir with only opera/ in it), or an unparseable manifest all
 *  fall back to today's only behaviour — fast-forward only, no push, no PR.
 *  `bisellium check` is what blocks a malformed manifest; this reader is
 *  defensive, not a second validator. */
function resolveIntegration(studio: string): ResolvedIntegration {
  const fallback: ResolvedIntegration = { strategy: "fast_forward", push: false, pullAfterPush: false, prRequired: false };
  let cfg: ReturnType<typeof readManifest>["integration"];
  try {
    cfg = readManifest(studio).integration;
  } catch {
    return fallback;
  }
  if (!cfg) return fallback;
  const strategy = STRATEGIES.includes(cfg.strategy as IntegrationStrategy) ? (cfg.strategy as IntegrationStrategy) : fallback.strategy;
  return {
    strategy,
    push: cfg.push === true,
    pullAfterPush: cfg.pull_after_push === true,
    prRequired: cfg.pr?.required === true,
    prReviewer: cfg.pr?.reviewer,
  };
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

/** The path of whichever worktree (the primary checkout counts as one) has
 *  `branch` checked out right now, or undefined if none does. */
function findWorktreeForBranch(cwd: string, branch: string): string | undefined {
  const list = git(["worktree", "list", "--porcelain"], cwd);
  if (list.status !== 0) return undefined;
  let current: string | undefined;
  for (const line of list.stdout.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length).trim();
    else if (line.startsWith("branch ") && current) {
      const b = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      if (b === branch) return current;
    }
  }
  return undefined;
}

/** Rebases `branch` onto `master` for real (D-015): replays the opus
 *  branch's own commits on top of the trunk's current tip. That necessarily
 *  rewrites the opus's source tree — the caller surfaces that as a `note`,
 *  never suppresses it (its `tree:` gate certificates are stale afterwards
 *  by construction; `check` reports `probatio.certifies.stale`).
 *
 *  Runs wherever `branch` is already checked out (a builder's own worktree,
 *  the common case — module comment above) so conflicts land where an
 *  operator can resolve them. When nothing has it checked out, a scratch
 *  worktree under the OS tmp dir does the rebase and is removed after, so a
 *  caller sitting on master or some third branch is never disturbed by a
 *  branch it wasn't on. */
function rebaseOntoTrunk(cwd: string, branch: string, master: string): BranchResult {
  const conflictError = `branch ${branch} could not be rebased onto ${master} — resolve the conflict on ${branch} and retry`;
  const existing = findWorktreeForBranch(cwd, branch);
  if (existing) {
    const r = git(["rebase", master], existing);
    if (r.status !== 0) {
      git(["rebase", "--abort"], existing);
      return { ok: false, error: conflictError };
    }
    return { ok: true };
  }

  // Reserve a unique path without pre-creating it — `git worktree add`
  // wants to create the directory itself.
  const scratch = mkdtempSync(join(tmpdir(), "bisellium-rebase-"));
  rmSync(scratch, { recursive: true, force: true });
  const add = git(["worktree", "add", scratch, branch], cwd);
  if (add.status !== 0) return { ok: false, error: `could not prepare a worktree to rebase ${branch}: ${add.stderr.trim() || "unknown error"}` };
  try {
    const r = git(["rebase", master], scratch);
    if (r.status !== 0) {
      git(["rebase", "--abort"], scratch);
      return { ok: false, error: conflictError };
    }
    return { ok: true };
  } finally {
    git(["worktree", "remove", "--force", scratch], cwd);
    rmSync(scratch, { recursive: true, force: true });
  }
}

function pushRef(cwd: string, ref: string): BranchResult {
  const r = git(["push", "origin", ref], cwd);
  if (r.status !== 0) return { ok: false, error: `push to origin failed: ${r.stderr.trim() || "unknown error"}` };
  return { ok: true };
}

/** `git pull` the trunk after a push (D-015's "whether to pull after
 *  pushing"). Same dual path as the fast-forward step above: a real pull
 *  when the trunk is what's checked out, a fetch of the ref otherwise, so
 *  this never touches a checkout that isn't the trunk's own. */
function pullTrunk(cwd: string, master: string): BranchResult {
  const current = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.trim();
  const r = current === master ? git(["pull", "--ff-only", "origin", master], cwd) : git(["fetch", "origin", `${master}:${master}`], cwd);
  if (r.status !== 0) return { ok: false, error: `pull after push failed: ${r.stderr.trim() || "unknown error"}` };
  return { ok: true };
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

  const integration = resolveIntegration(studio);

  // merge_commit is a real, distinct strategy (a topology-preserving merge,
  // typically driven by a PR's own "merge" button on GitHub) — but nothing
  // here builds a merge-commit policy (message, conflict handling) that no
  // officina has exercised yet. Declaring it and refusing beats half-
  // building one; see this opus's report for the reasoning.
  if (integration.strategy === "merge_commit") {
    return { ok: false, error: `integration.strategy "merge_commit" is declared but not implemented — use "fast_forward" or "rebase"`, trunk: master };
  }

  const masterRev = git(["rev-parse", master], cwd).stdout.trim();
  const mergeBase = git(["merge-base", master, branch], cwd).stdout.trim();
  let rebased = false;

  if (mergeBase !== masterRev) {
    if (integration.strategy === "rebase") {
      const rebase = rebaseOntoTrunk(cwd, branch, master);
      if (!rebase.ok) return { ok: false, error: rebase.error, trunk: master };
      rebased = true;
    } else {
      // fast_forward (default): unchanged behaviour. Probe the merge with
      // `merge-tree`, which computes the result purely in-memory — unlike
      // `git merge --no-commit`, it never touches the working directory or
      // index, so it's safe to run regardless of what's checked out or
      // whether the tree is dirty.
      const probe = git(["merge-tree", "--write-tree", master, branch], cwd);
      if (probe.status !== 0) return { ok: false, error: `branch ${branch} conflicts with ${master}`, trunk: master };
      return { ok: false, error: `branch ${branch} has diverged from ${master} — rebase first`, trunk: master };
    }
  }

  // D-015's own consequence to handle, not suppress: a rebase rewrote the
  // opus's tree, so its `tree:` gate certificates are stale by construction
  // (`check` reports probatio.certifies.stale) — the gates genuinely must
  // re-run, since the opus was never tested against the code it's about to
  // ship alongside. Surfaced here so a merge that did this is never silent
  // about it, on either exit path below.
  const staleNote = rebased
    ? `${branch} was rebased onto ${master} — its tree: gate certificates are now stale (bisellium check will report probatio.certifies.stale); re-verify before this ships`
    : undefined;

  if (integration.prRequired) {
    // D-015 / this opus's brief: PR creation is W-028's territory. `merge`
    // stops here having done its half — the branch is rebased (if that's
    // the strategy) and, if configured, pushed — and leaves the branch in
    // place for a PR to carry to the trunk, rather than landing it locally.
    if (integration.push) {
      const pushed = pushRef(cwd, branch);
      if (!pushed.ok) return { ok: false, error: pushed.error, trunk: master, note: staleNote };
    }
    const reviewerNote = integration.prReviewer ? ` (reviewer: ${integration.prReviewer})` : "";
    const note = [`integration.pr.required is set — ${branch} was not merged locally; open a PR from ${branch} to ${master}${reviewerNote}`, staleNote]
      .filter(Boolean)
      .join("; ");
    return { ok: true, trunk: master, note, landed: false };
  }

  const current = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).stdout.trim();
  if (current === master) {
    // Already on the trunk — merge in place, same as any manual merge.
    const merge = git(["merge", "--ff-only", branch], cwd);
    if (merge.status !== 0) return { ok: false, error: merge.stderr.trim() || "merge failed", trunk: master };
  } else {
    // Not on the trunk (the opus branch itself, or anything else) —
    // advance the trunk ref directly instead of checking it out.
    // `git fetch . <src>:<dst>` only ever fast-forwards `dst`, so this
    // can never land the merge on whatever happens to be checked out.
    const fetch = git(["fetch", ".", `${branch}:${master}`], cwd);
    if (fetch.status !== 0) return { ok: false, error: fetch.stderr.trim() || `could not fast-forward ${master}`, trunk: master };
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
      trunk: master,
    };
  }

  if (integration.push) {
    const pushed = pushRef(cwd, master);
    if (!pushed.ok) return { ok: false, error: pushed.error, trunk: master, note: staleNote };
    if (integration.pullAfterPush) {
      const pulled = pullTrunk(cwd, master);
      if (!pulled.ok) return { ok: false, error: pulled.error, trunk: master, note: staleNote };
    }
  }

  return { ok: true, trunk: master, note: staleNote, landed: true };
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
  if (!result.ok) {
    console.error(result.error);
    if (result.note) console.error(result.note);
    return { exitCode: 1 };
  }
  if (result.landed === false) {
    // integration.pr.required stopped short of landing this on the trunk —
    // never reported as "merged" when it wasn't.
    console.log(result.note ?? `${opusBranchName(opusId)} prepared but not merged (PR required)`);
  } else {
    console.log(`merged ${opusBranchName(opusId)} into ${result.trunk ?? "master"}`);
    if (result.note) console.log(result.note);
  }
  return { exitCode: 0 };
}
