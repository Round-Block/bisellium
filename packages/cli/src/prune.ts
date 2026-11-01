import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseFrontMatter, readFront, readManifest } from "@bisellium/adapter-native";
import { ensureRealDirectory } from "@bisellium/commands/ids.js";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { reclaimWorktrees } from "@bisellium/shim";

interface PruneEntry {
  branch: string;
  reason: string;
}

export interface PruneResult {
  removed: PruneEntry[];
  kept: PruneEntry[];
}

function git(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function pruneStaleOpusBranches(repo: string, studio: string): PruneResult {
  const cwd = resolve(repo);
  const removed: PruneEntry[] = [];
  const kept: PruneEntry[] = [];

  const branchList = git(["branch", "--list", "opus/*", "--format=%(refname:short)"], cwd);
  if (branchList.status !== 0) return { removed, kept };

  const branches = branchList.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (branches.length === 0) return { removed, kept };

  const merged = git(["branch", "--merged", "HEAD", "--format=%(refname:short)"], cwd);
  const mergedSet = new Set(merged.status === 0 ? merged.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : []);

  const operaDir = join(resolve(studio), "opera");

  for (const branch of branches) {
    const opusId = branch.replace(/^opus\//, "");
    const opusPath = join(operaDir, `${opusId}.md`);

    if (!existsSync(opusPath)) {
      kept.push({ branch, reason: "no opus file found" });
      continue;
    }

    let state: string | undefined;
    try {
      const fm = readFront<Record<string, unknown>>(opusPath);
      state = typeof fm.data["state"] === "string" ? fm.data["state"] : undefined;
    } catch {
      kept.push({ branch, reason: "opus file unreadable" });
      continue;
    }

    if (state !== "done") {
      kept.push({ branch, reason: `opus state is "${state}"` });
      continue;
    }

    if (!mergedSet.has(branch)) {
      kept.push({ branch, reason: "not merged into HEAD" });
      continue;
    }

    const del = git(["branch", "-d", branch], cwd);
    if (del.status === 0) {
      removed.push({ branch, reason: "done and merged" });
    } else {
      kept.push({ branch, reason: "delete failed" });
    }
  }

  return { removed, kept };
}

/** Every regular file under `dir` outside `ci/` (symlinks are never followed), as one string. */
function officinaTextOutsideCi(root: string): string {
  const parts: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entryRel === "ci") continue;
      if (entry.isDirectory()) walk(join(dir, entry.name), entryRel);
      else if (entry.isFile()) {
        // a root-level name ("" is the root) or one under a top-level directory: either way, the contained reader
        const file = readContainedRegularFile(root, entryRel, rel === "" ? "" : (entryRel.split("/")[0] ?? ""));
        if (!("error" in file)) parts.push(file.bytes.toString("utf8"));
      }
    }
  };
  walk(root, "");
  return parts.join("\n");
}

/** W-131: removes the gate logs (`<opus>-<probatio>-<tree8>.log`) of a `done` opus that nothing outside `ci/` cites. */
export function pruneCiLogs(studio: string): { removed: string[] } {
  const root = resolve(studio);
  const removed: string[] = [];
  const ciDir = join(root, "ci");
  if (!existsSync(ciDir)) return { removed };
  const probationes = readManifest(root).probationes.map((p) => p.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (probationes.length === 0) return { removed };
  const shape = new RegExp(`^([A-Za-z]+-\\d+)-(?:${probationes.join("|")})-[0-9a-f]{8}\\.log$`);
  let cited: string | undefined;
  for (const name of readdirSync(ciDir)) {
    const opus = shape.exec(name)?.[1];
    // A verdict log (`<opus>-spec|review-<round>.log`) is evidence, never a gate log, even when the round is eight digits.
    if (opus === undefined || /-(?:spec|review)-\d+\.log$/.test(name)) continue;
    const opusFile = readContainedRegularFile(root, `opera/${opus}.md`, "opera");
    if ("error" in opusFile || readFront<Record<string, unknown>>(opusFile.absolute).data["state"] !== "done") continue;
    cited ??= officinaTextOutsideCi(root);
    if (cited.includes(`ci/${name}`)) continue;
    const log = readContainedRegularFile(root, `ci/${name}`, "ci");
    if ("error" in log) continue;
    unlinkSync(log.absolute);
    removed.push(`ci/${name}`);
  }
  return { removed };
}

// ---------------------------------------------------------------------------
// W-489: worktrees reclaimed when their opus or PR ends. Only `<repo>/.worktrees/<name>` is swept, never the main
// checkout or a worktree elsewhere; a branch is never deleted here, so no commit is lost, and a worktree's uncommitted
// state is saved as a patch under `<repo>/.bisellium/worktree-diffs/` before it is removed.
// ---------------------------------------------------------------------------

/** A branch's PR state as a lookup reads it: any OPEN PR wins, then MERGED, then CLOSED; NONE when it has no PR. */
export type PrState = "OPEN" | "MERGED" | "CLOSED" | "NONE";
/** Reads the PR state of every branch asked for, at most once per sweep; a branch the map leaves out is unknown, so its worktree stays. */
export type PrLookup = (branches: readonly string[]) => Map<string, PrState> | { error: string };

export interface SweepEntry {
  path: string;
  reason: string;
  /** The patch of its uncommitted changes, written before the removal. */
  saved?: string;
  /** The checkout is gone but git could not delete its admin directory (a sandbox holds it busy); a later prune retries. */
  adminLeft?: true;
}

export interface SweepResult {
  removed: SweepEntry[];
  kept: SweepEntry[];
  /** Admin directories `git worktree prune` could not delete (still pending in its dry run after it ran). */
  adminLeft: number;
}

/** A worktree younger than this is never removed: a fresh branch at master looks merged (the 11-01 sweep). */
export const WORKTREE_MIN_AGE_MS = 3_600_000;

interface ListedWorktree {
  path: string;
  head?: string;
  branch?: string;
  locked: boolean;
  prunable: boolean;
}

/** `git worktree list --porcelain -z`, one entry per worktree; undefined when git cannot list them. */
function listedWorktrees(root: string): ListedWorktree[] | undefined {
  const r = git(["worktree", "list", "--porcelain", "-z"], root);
  if (r.status !== 0) return undefined;
  const out: ListedWorktree[] = [];
  let cur: ListedWorktree | undefined;
  for (const field of r.stdout.split("\0")) {
    if (field.startsWith("worktree ")) {
      cur = { path: field.slice("worktree ".length), locked: false, prunable: false };
      out.push(cur);
    } else if (cur === undefined) continue;
    else if (field.startsWith("HEAD ")) cur.head = field.slice("HEAD ".length);
    else if (field.startsWith("branch refs/heads/")) cur.branch = field.slice("branch refs/heads/".length);
    else if (field === "locked" || field.startsWith("locked ")) cur.locked = true;
    else if (field === "prunable" || field.startsWith("prunable ")) cur.prunable = true;
  }
  return out;
}

/** The opus ids a worktree's name and branch carry: `<LETTERS>-<digits>`, bounded so W-48 is not W-489. */
export function carriedOpusIds(name: string, branch: string | undefined): string[] {
  const ids = new Set<string>();
  for (const text of [name, branch ?? ""]) for (const m of text.matchAll(/(?<![A-Za-z0-9])[A-Z]+-\d+(?!\d)/g)) ids.add(m[0]);
  return [...ids];
}

/** Milliseconds since the worktree was created: the mtime of its admin directory's `gitdir` file (git bumps the directory's own mtime). */
function worktreeAgeMs(path: string, nowMs: number): number | undefined {
  const r = git(["rev-parse", "--absolute-git-dir"], path);
  const admin = r.stdout.trim();
  if (r.status !== 0 || admin === "") return undefined;
  try {
    return nowMs - statSync(join(admin, "gitdir")).mtimeMs;
  } catch {
    return undefined;
  }
}

/** True when a branch, tag or remote-tracking ref holds `commit`, so removing a detached worktree loses no commit. */
function heldByRef(root: string, commit: string | undefined): boolean {
  if (commit === undefined) return false;
  const r = git(["for-each-ref", "--contains", commit, "--count=1", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"], root);
  return r.status === 0 && r.stdout.trim() !== "";
}

/** The worktree's uncommitted changes, untracked files included, as one binary patch under `<repo>/.bisellium/worktree-diffs/`. */
function saveWorktreeDiff(root: string, path: string, name: string, nowMs: number): { path: string } | { error: string } {
  const add = git(["add", "-A"], path);
  if (add.status !== 0) return { error: `git add -A failed: ${add.stderr.trim()}` };
  const diff = spawnSync("git", ["diff", "--cached", "--binary", "HEAD"], { cwd: path, timeout: 120_000, maxBuffer: 256 * 1024 * 1024 });
  if (diff.error !== undefined || diff.status !== 0) return { error: `git diff failed: ${diff.error?.message ?? diff.stderr.toString("utf8").trim()}` };
  try {
    const dir = ensureRealDirectory(root, ".bisellium", "worktree-diffs");
    const file = join(dir, `${name}-${new Date(nowMs).toISOString().replace(/[:.]/g, "-")}.patch`);
    writeFileSync(file, diff.stdout, { flag: "wx" });
    return { path: file };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Removes the worktrees under `<repo>/.worktrees/` whose work has ended. With `opus`, the done perform's sweep: every
 * worktree whose name or branch carries that id. Without it, prune's: a worktree whose every carried opus is done in
 * the studio, or whose branch's PR is merged or closed, or (clean only) whose commit is in origin/master. Never one
 * younger than an hour, locked, holding the current directory, on a branch whose PR is open or unread, or detached at
 * a commit no ref holds. A dirty one is removed only when its opus or PR has ended, after its patch is saved.
 */
export function sweepWorktrees(repo: string, studio: string, o: { opus?: string; prs: PrLookup; nowMs: number }): SweepResult {
  const out: SweepResult = { removed: [], kept: [], adminLeft: 0 };
  let root: string;
  try {
    root = realpathSync(repo);
  } catch {
    return out;
  }
  const listed = listedWorktrees(root);
  if (listed === undefined) return out;
  const parent = join(root, ".worktrees");
  const here = resolve(process.cwd());
  const keep = (path: string, reason: string): void => void out.kept.push({ path, reason });
  const candidates: { w: ListedWorktree; name: string; ids: string[]; dirty: boolean }[] = [];
  for (const w of listed) {
    if (dirname(w.path) !== parent || w.prunable) continue;
    const name = basename(w.path);
    const ids = carriedOpusIds(name, w.branch);
    if (o.opus !== undefined && !ids.includes(o.opus)) continue;
    const inside = relative(w.path, here);
    if (w.locked) keep(w.path, "locked");
    else if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) keep(w.path, "the current directory is inside it");
    else {
      const age = worktreeAgeMs(w.path, o.nowMs);
      const status = git(["status", "--porcelain"], w.path);
      if (age === undefined) keep(w.path, "its age cannot be read");
      else if (age < WORKTREE_MIN_AGE_MS) keep(w.path, "younger than an hour");
      else if (w.branch === undefined && !heldByRef(root, w.head)) keep(w.path, "detached at a commit no branch, tag or remote-tracking ref holds");
      else if (status.status !== 0) keep(w.path, `git status failed: ${status.stderr.trim()}`);
      else candidates.push({ w, name, ids, dirty: status.stdout.trim() !== "" });
    }
  }
  const branches = candidates.flatMap((c) => (c.w.branch === undefined ? [] : [c.w.branch]));
  const states = branches.length > 0 ? o.prs(branches) : new Map<string, PrState>();
  for (const c of candidates) {
    let pr: PrState = "NONE";
    if (c.w.branch !== undefined) {
      const s = states instanceof Map ? states.get(c.w.branch) : undefined;
      if (!(states instanceof Map)) keep(c.w.path, `its PR cannot be read: ${states.error}`);
      else if (s === undefined) keep(c.w.path, "its PR state was not read");
      else if (s === "OPEN") keep(c.w.path, "its PR is open");
      if (s === undefined || s === "OPEN") continue;
      pr = s;
    }
    const reason = o.opus !== undefined ? { remove: `opus ${o.opus} done` } : endedReason(root, studio, c.ids, pr, c.dirty, c.w.head);
    if ("keep" in reason) {
      keep(c.w.path, reason.keep);
      continue;
    }
    let saved: string | undefined;
    if (c.dirty) {
      const s = saveWorktreeDiff(root, c.w.path, c.name, o.nowMs);
      if ("error" in s) {
        keep(c.w.path, `its uncommitted changes could not be saved: ${s.error}`);
        continue;
      }
      saved = s.path;
    }
    const r = git(["worktree", "remove", ...(c.dirty ? ["--force"] : []), "--", c.w.path], root);
    if (r.status === 0) out.removed.push({ path: c.w.path, reason: reason.remove, ...(saved === undefined ? {} : { saved }) });
    else if (lstatSync(c.w.path, { throwIfNoEntry: false }) === undefined) out.removed.push({ path: c.w.path, reason: reason.remove, ...(saved === undefined ? {} : { saved }), adminLeft: true });
    else keep(c.w.path, `git worktree remove failed: ${r.stderr.trim()}`);
  }
  // an admin directory whose checkout is gone is pruned; one a sandbox holds busy stays for a later run, and is counted
  git(["worktree", "prune"], root);
  out.adminLeft = git(["worktree", "prune", "--dry-run", "--verbose"], root).stderr.split("\n").filter((l) => l.startsWith("Removing ")).length;
  return out;
}

/** Prune's reason to remove a candidate, or to keep it. */
function endedReason(root: string, studio: string, ids: string[], pr: PrState, dirty: boolean, head: string | undefined): { remove: string } | { keep: string } {
  if (opusDone(studio, ids)) return { remove: `opus ${ids.join(", ")} done` };
  if (pr === "MERGED" || pr === "CLOSED") return { remove: `its PR is ${pr.toLowerCase()}` };
  if (dirty) return { keep: "uncommitted changes, and neither its opus nor its PR has ended" };
  if (head !== undefined && git(["merge-base", "--is-ancestor", head, "refs/remotes/origin/master"], root).status === 0) return { remove: "its commit is in origin/master" };
  return { keep: "not in origin/master, and neither its opus nor its PR has ended" };
}

/** True when at least one carried id names an opus record and every such record reads `state: done`. */
function opusDone(studio: string, ids: string[]): boolean {
  let seen = 0;
  for (const id of ids) {
    const file = readContainedRegularFile(studio, `opera/${id}.md`, "opera");
    if ("error" in file) {
      if (file.code === "ENOENT") continue;
      return false;
    }
    try {
      const data = parseFrontMatter<unknown>(file.bytes.toString("utf8"), file.relative).data;
      if (typeof data !== "object" || data === null || (data as Record<string, unknown>)["state"] !== "done") return false;
    } catch {
      return false;
    }
    seen++;
  }
  return seen > 0;
}

/** The PR states of every branch asked for, from one `gh pr list --state all` over the repository's PRs. */
export function ghPrStates(repo: string): PrLookup {
  return (branches) => {
    const r = spawnSync("gh", ["pr", "list", "--state", "all", "--limit", "5000", "--json", "headRefName,state"], { cwd: repo, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.error !== undefined || r.status !== 0) return { error: `gh pr list failed: ${(r.error?.message ?? r.stderr ?? "").trim()}` };
    let list: unknown;
    try {
      list = JSON.parse(r.stdout);
    } catch {
      return { error: "gh pr list did not return JSON" };
    }
    if (!Array.isArray(list)) return { error: "gh pr list did not return an array" };
    const rank: Record<PrState, number> = { NONE: 0, CLOSED: 1, MERGED: 2, OPEN: 3 };
    const states = new Map<string, PrState>(branches.map((b) => [b, "NONE"]));
    for (const p of list as { headRefName?: unknown; state?: unknown }[]) {
      const b = p.headRefName;
      const s = p.state;
      if (typeof b !== "string" || (s !== "OPEN" && s !== "MERGED" && s !== "CLOSED")) return { error: "gh pr list returned a malformed PR" };
      const was = states.get(b);
      if (was !== undefined && rank[s] > rank[was]) states.set(b, s);
    }
    return states;
  };
}

/** One line per removed worktree (and, with `kept`, per kept one), as prune and the done perform print them. */
export function sweepLines(s: SweepResult, kept: boolean): string[] {
  return [
    ...s.removed.map((w) => `worktree removed: ${w.path} (${w.reason})${w.saved === undefined ? "" : `; uncommitted changes saved to ${w.saved}`}${w.adminLeft ? "; its admin directory is held busy, a later prune retries" : ""}`),
    ...(kept ? s.kept.map((w) => `worktree kept: ${w.path} (${w.reason})`) : []),
    ...(s.adminLeft > 0 ? [`worktree admin directories left: ${s.adminLeft} (held busy; a later prune retries)`] : []),
  ];
}

/** The done perform's lookup, git only: a branch with no remote-tracking ref was never pushed, so it has no PR; one on origin is left unread. */
export function unpushedBranches(repo: string): PrLookup {
  return (branches) => new Map(branches.filter((b) => git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${b}`], repo).status !== 0).map((b) => [b, "NONE" as const]));
}

const PRUNE_USAGE = "usage: bisellium prune --studio <dir> [--repo <dir>]";

const PRUNE_FLAGS = new Set(["--studio", "--repo"]);

export function runPrune(args: string[], deps: { prs?: PrLookup; nowMs?: number } = {}): { exitCode: number } {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--") || !PRUNE_FLAGS.has(a)) {
      console.error(`${a.startsWith("--") ? `unknown flag "${a}"` : `unexpected argument "${a}"`}\n${PRUNE_USAGE}`);
      return { exitCode: 2 };
    }
    const v = args[++i];
    if (v === undefined) {
      console.error(`${a} needs a value\n${PRUNE_USAGE}`);
      return { exitCode: 2 };
    }
    values.set(a, v);
  }

  const studio = resolve(values.get("--studio") ?? ".");
  const repo = resolve(values.get("--repo") ?? ".");

  if (!existsSync(join(studio, "opera"))) {
    console.error(`no opera directory at ${studio}`);
    return { exitCode: 2 };
  }

  const worktreeResult = reclaimWorktrees(repo);
  const sweep = sweepWorktrees(repo, studio, { prs: deps.prs ?? ghPrStates(repo), nowMs: deps.nowMs ?? Date.now() });
  const branchResult = pruneStaleOpusBranches(repo, studio);
  const logResult = pruneCiLogs(studio);

  if (worktreeResult.removed.length > 0) {
    for (const w of worktreeResult.removed) console.log(`worktree removed: ${w.path} (${w.reason})`);
  }
  for (const line of sweepLines(sweep, false)) console.log(line);
  if (branchResult.removed.length > 0) {
    for (const b of branchResult.removed) console.log(`branch removed: ${b.branch} (${b.reason})`);
  }
  for (const name of logResult.removed) console.log(`ci log removed: ${name}`);
  if (worktreeResult.removed.length === 0 && sweep.removed.length === 0 && sweep.adminLeft === 0 && branchResult.removed.length === 0 && logResult.removed.length === 0) {
    console.log("nothing to prune");
  }

  return { exitCode: 0 };
}
