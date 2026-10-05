/**
 * packages/cli/src/integrate.ts — W-124: the `pr`, `merge` and `cleanup` rungs
 * of `bisellium next`, which replaced the retired PR scripts.
 *
 * `gh` and `git` are spawned by bare name through PATH with argument arrays,
 * never a shell. Every `gh` read asks for a fixed `--json` field list (never a
 * `-q` or a text grep), is pinned `-R <slug>` where gh accepts it, is bounded to
 * 1 MiB, and fails CLOSED: a non-zero exit, empty output, non-JSON, a missing
 * field or an unknown enum value is a refusal with nothing mutated. A PR counts
 * only if its (number, headRefName, headRefOid, baseRefName, repo) identity
 * checks out, and `gh pr merge` is pinned to the identified head with
 * `--match-head-commit`. `BLOCKED` is never merged directly.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { sourceTreeHash } from "@bisellium/shim";
import { TRUNK_REF, trunkContainsMerge, wellFormedOid } from "@bisellium/commands/trunk.js";

/** The fewest passing checks a merge needs; only checks in bucket `pass` count. */
export const MIN_CHECKS = 5;
const GH_MAX_BYTES = 1_048_576;
const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const OID_RE = /^[0-9a-f]{40}$/;
const PR_STATES = new Set(["OPEN", "MERGED", "CLOSED"]);
const MERGE_STATES = new Set(["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"]);
const BUCKETS = new Set(["pass", "fail", "pending", "skipping", "cancel"]);
const PR_LIST_FIELDS = "number,state,mergeStateStatus,headRefName,headRefOid,baseRefName,isCrossRepository,headRepositoryOwner,headRepository,mergeCommit";
const PR_VIEW_FIELDS = "number,state,mergeStateStatus,headRefName,headRefOid,baseRefName,mergeCommit";

// ---------------------------------------------------------------------------
// spawning
// ---------------------------------------------------------------------------

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export function sh(cmd: "git" | "gh", args: string[], cwd: string, maxBuffer = 16 * 1024 * 1024): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120_000, maxBuffer });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ...(r.error === undefined ? {} : { error: r.error }) };
}
export const git = (cwd: string, args: string[]): Run => sh("git", args, cwd);
/**
 * Everything the verb prints about a PR, a check, a gh reply or a path is data from outside: control
 * characters (C0 and C1, newline included) become a space and each element is clipped, so none of it
 * can start a `state=` line or drive a terminal.
 */
export const clean = (text: string, max = 200): string => text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, max);
const firstLine = (text: string): string => clean(text.trim().split("\n")[0] ?? "");
const why = (r: Run): string => (r.error !== undefined ? clean(r.error.message) : firstLine(r.stderr)) || `exit ${r.status}`;

/** Repo-relative prefixes the Patron owns: no agent writes them, so the CLI never moves them in the main checkout. */
export const PATRON_PATHS: readonly string[] = [".claude/"];
const isPatronPath = (path: string): boolean => PATRON_PATHS.some((prefix) => path.startsWith(prefix));
/** A path outside `[A-Za-z0-9/._-]` is single-quoted so a printed command can be pasted. */
const quoted = (path: string): string => (/^[A-Za-z0-9/._-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`);

/** One tracked change: `from` is the original path of a rename or copy (both sides count), `staged` that the index holds it. */
export interface Change {
  code: string;
  path: string;
  from?: string;
  staged: boolean;
}

/** Tracked changes of a checkout (staged or not), or the reason git could not say. */
export function trackedChanges(cwd: string): Change[] | string {
  const r = git(cwd, ["status", "--porcelain", "-z", "--untracked-files=no", "--ignore-submodules=none"]);
  if (r.status !== 0 || r.error !== undefined) return `git status failed: ${why(r)}`;
  const changes: Change[] = [];
  const parts = r.stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const change: Change = { code: entry.slice(0, 2).trim(), path: entry.slice(3), staged: entry[0] !== " " };
    if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R" || entry[1] === "C") change.from = parts[++i]; // the original path follows
    changes.push(change);
  }
  return changes;
}
/** Every path a change touches: a rename or copy has two. */
export const touched = (c: Change): string[] => (c.from === undefined ? [c.path] : [c.path, c.from]);

/** The one dirty-tree refusal: tracked changes outside `allow`, as the hold's reason and the lines after it. */
export function dirtyReport(cwd: string, allow: (path: string) => boolean = () => false): { reason: string; after: string[] } | undefined {
  const changes = trackedChanges(cwd);
  if (typeof changes === "string") return { reason: changes, after: [] };
  const bad = changes.filter((c) => !touched(c).every(allow));
  if (bad.length === 0) return undefined;
  // a path the index already moved or removed is restored from HEAD; a worktree edit from the index
  // only a path HEAD has can be restored: a rename's original, never its destination or a plain add
  const patron = bad.filter((c) => c.code !== "A" && isPatronPath(c.from ?? c.path));
  const paths = [...new Set(patron.map((c) => c.from ?? c.path))];
  return {
    reason: "the working tree has tracked changes",
    after: [
      ...bad.slice(0, 10).map((c) => `dirty: ${clean(`${c.code} ${c.from === undefined ? "" : `${c.from} -> `}${c.path}`)}`),
      ...(paths.length > 0 ? [`patron: git -C ${quoted(cwd)} checkout ${patron.some((c) => c.staged) ? "HEAD " : ""}-- ${paths.map(quoted).join(" ")}`] : []),
    ],
  };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function ghJson(cwd: string, args: string[]): { ok: true; value: unknown } | { ok: false; reason: string } {
  const r = sh("gh", args, cwd, GH_MAX_BYTES);
  const label = `gh ${args.slice(0, 2).join(" ")}`;
  if (r.error !== undefined) return { ok: false, reason: `${label} failed: ${clean(r.error.message)}` };
  if (r.status !== 0) return { ok: false, reason: `${label} exited ${r.status}: ${firstLine(r.stderr)}` };
  if (r.stdout.length > GH_MAX_BYTES) return { ok: false, reason: `${label} output is over 1 MiB` };
  if (r.stdout.trim() === "") return { ok: false, reason: `${label} returned no output` };
  try {
    return { ok: true, value: JSON.parse(r.stdout) as unknown };
  } catch {
    return { ok: false, reason: `${label} returned non-JSON output` };
  }
}

// ---------------------------------------------------------------------------
// worktrees, trunk fetch
// ---------------------------------------------------------------------------

export interface WtEntry {
  path: string;
  branch?: string;
  prunable: boolean;
}

export function listWorktrees(repo: string): WtEntry[] | undefined {
  const r = git(repo, ["worktree", "list", "--porcelain"]);
  if (r.status !== 0) return undefined;
  const out: WtEntry[] = [];
  let cur: WtEntry | undefined;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), prunable: false };
      out.push(cur);
    } else if (cur !== undefined && line.startsWith("branch ")) cur.branch = line.slice("branch ".length);
    else if (cur !== undefined && line.startsWith("prunable")) cur.prunable = true;
  }
  return out;
}

/** The registered worktree `<repo>/.worktrees/<id>`, wherever git lists it. */
export function opusWorktree(repo: string, id: string): { dir: string; entry?: WtEntry } {
  const dir = join(realpathSync(repo), ".worktrees", id);
  return { dir, entry: listWorktrees(repo)?.find((e) => e.path === dir) };
}

/** A branch tip read three ways: a commit, truly absent (git says no such ref), or unreadable (never "absent"). */
export type TipRead = { kind: "tip"; oid: string } | { kind: "absent" } | { kind: "error"; reason: string };
export const readTip = (repo: string, id: string): TipRead => readRef(repo, `refs/heads/opus/${id}`);
/** Any local branch ref, read the same three ways. */
export function readRef(repo: string, ref: string): TipRead {
  const r = git(repo, ["rev-parse", "--verify", "-q", ref]);
  const oid = r.stdout.trim();
  if (r.error === undefined && r.status === 0 && wellFormedOid(oid)) return { kind: "tip", oid };
  if (r.error === undefined && r.status === 1 && oid === "") return { kind: "absent" };
  return { kind: "error", reason: `cannot read ${ref}: ${why(r)}` };
}
/** The opus branch on origin, read now (`ls-remote`): exit 2 is the one "no such ref" answer. */
function remoteTip(repo: string, id: string): TipRead {
  const ref = `refs/heads/opus/${id}`;
  const r = git(repo, ["ls-remote", "--exit-code", "origin", ref]);
  if (r.error === undefined && r.status === 2) return { kind: "absent" };
  const lines = r.stdout.trim().split("\n");
  const [oid, name] = (lines[0] ?? "").split("\t");
  if (r.error === undefined && r.status === 0 && lines.length === 1 && wellFormedOid(oid) && name === ref) return { kind: "tip", oid };
  return { kind: "error", reason: `cannot read ${ref} on origin: ${why(r)}` };
}

const REMOTE_MASTER = "refs/remotes/origin/master";
/** `after` are lines printed after the hold's `why:` line (the Patron's command). */
type Trunk = { ok: true } | { ok: false; reason: string; after?: string[] };
const commitOf = (repo: string, ref: string): string | undefined => {
  const r = git(repo, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
  return r.status === 0 && wellFormedOid(r.stdout.trim()) ? r.stdout.trim() : undefined;
};
/** `merge-base --is-ancestor`: true, false, or undefined for any other outcome (fail closed). */
const isAncestor = (repo: string, a: string, b: string): boolean | undefined => {
  const r = git(repo, ["merge-base", "--is-ancestor", a, b]);
  return r.error === undefined && r.status === 0 ? true : r.error === undefined && r.status === 1 ? false : undefined;
};
const onDisk = (path: string): "none" | "dir" | "other" | "error" => {
  try {
    return lstatSync(path).isDirectory() ? "dir" : "other";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "none" : "error";
  }
};

/**
 * The first incoming path (added between `from` and `to`) that would overwrite an untracked or
 * ignored entry of the checkout: present on disk, under a non-directory, or a directory holding an
 * ignored entry. `undefined` means none; a string starting with "?" is an unreadable state (hold).
 */
function overwritten(repo: string, from: string, to: string): string | undefined {
  const added = git(repo, ["diff", "--no-renames", "--ignore-submodules=none", "--name-only", "-z", "--diff-filter=A", from, to]);
  if (added.status !== 0 || added.error !== undefined) return `?git diff failed: ${why(added)}`;
  const ignored = git(repo, ["ls-files", "-o", "-i", "--exclude-standard", "-z"]);
  if (ignored.status !== 0 || ignored.error !== undefined) return `?git ls-files failed: ${why(ignored)}`;
  const dirs = new Set<string>();
  for (const e of ignored.stdout.split("\0").filter(Boolean)) for (let i = e.indexOf("/"); i !== -1; i = e.indexOf("/", i + 1)) dirs.add(e.slice(0, i));
  for (const p of added.stdout.split("\0").filter(Boolean)) {
    if (dirs.has(p)) return p;
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const here = onDisk(join(repo, ...parts.slice(0, i)));
      if (here === "error") return `?cannot inspect ${p}`;
      if (here === "none") break;
      if (i === parts.length || here === "other") return p;
    }
  }
  return undefined;
}

/**
 * A Patron path never moves in the main checkout. This runs before any fetch or ref move: the reviewed commit is
 * fetched by id (`git fetch origin <oid>` writes no ref), and the paths it brings are read with `diff`. A stop
 * names the Patron's one command; `undefined` means nothing incoming is the Patron's, or this cannot be judged
 * here and the checks below hold on it. The oid is the merge commit of a MERGED PR already identified.
 */
function patronStop(repo: string, target: string, hold: (reason: string, tail?: string) => Trunk): Trunk | undefined {
  if (commitOf(repo, target) === undefined) {
    const got = git(repo, ["fetch", "-q", "origin", target]);
    if (got.status !== 0) return hold(`git fetch origin ${target.slice(0, 12)} failed: ${why(got)}`);
  }
  const local = commitOf(repo, TRUNK_REF);
  if (commitOf(repo, target) !== target || local === undefined) return undefined;
  if (isAncestor(repo, target, local) !== false || isAncestor(repo, local, target) !== true) return undefined;
  const incoming = git(repo, ["diff", "--no-renames", "--name-only", "-z", local, target]);
  if (incoming.status !== 0 || incoming.error !== undefined) return hold(`git diff failed: ${why(incoming)}`);
  const patron = incoming.stdout.split("\0").filter((p) => p !== "" && isPatronPath(p));
  if (patron.length === 0) return undefined;
  const holder = listWorktrees(repo)?.find((e) => e.branch === TRUNK_REF);
  const here = (path: string): boolean => {
    try {
      return realpathSync(path) === realpathSync(repo);
    } catch {
      return false;
    }
  };
  const command = holder === undefined ? `git -C ${quoted(repo)} fetch origin master:master` : `git -C ${quoted(here(holder.path) ? repo : holder.path)} merge --ff-only ${target}`;
  return {
    ok: false,
    reason: clean(`refusing: incoming paths belong to the Patron (${patron.slice(0, 10).map(quoted).join(", ")}); the main checkout is untouched`, 600),
    after: [`patron: ${command}`],
  };
}

/**
 * The trunk fetch. `git fetch origin master:master` when no worktree holds `master`. Otherwise the
 * remote-tracking ref is fetched and `target` (the reviewed merge commit, the `merge` rung only) is the
 * only thing a clean checked-out `master` of `repo` is ever fast-forwarded to; with no target (the `pr`
 * rung) nothing is moved. Every read fails closed into a hold with nothing mutated.
 */
export function fetchTrunk(repo: string, target?: string): Trunk {
  // the tail (advice naming a path) is clipped on its own so a long head can never cut it off
  const hold = (reason: string, tail = ""): Trunk => ({ ok: false, reason: clean(reason, 400) + clean(tail, 600) });
  if (target !== undefined && !wellFormedOid(target)) return hold("the reviewed merge commit is not a well formed commit id");
  if (target !== undefined) {
    const stop = patronStop(repo, target, hold);
    if (stop !== undefined) return stop;
  }
  const r = git(repo, ["fetch", "-q", "origin", "master:master"]);
  if (r.status === 0) return { ok: true };
  const holder = listWorktrees(repo)?.find((e) => e.branch === TRUNK_REF);
  if (holder === undefined) return hold(`git fetch origin master:master failed: ${why(r)}`);
  const held = `master is checked out at ${holder.path}, so it cannot be fetched into; run there: git -C ${holder.path} pull --ff-only origin master`;
  const tracking = git(repo, ["fetch", "-q", "origin", `+${TRUNK_REF}:${REMOTE_MASTER}`]);
  if (tracking.status !== 0) return hold(`git fetch origin master failed: ${why(tracking)}`);
  const local = commitOf(repo, TRUNK_REF);
  const origin = commitOf(repo, REMOTE_MASTER);
  const reviewed = target === undefined ? undefined : commitOf(repo, target);
  if (local === undefined || origin === undefined || (target !== undefined && reviewed === undefined)) return hold("could not read master, origin/master or the reviewed merge commit");
  // a tag or other object that merely peels to a commit is not the reviewed commit
  if (reviewed !== target && target !== undefined) return hold("the reviewed merge commit id is not itself a commit");
  if (reviewed !== undefined) {
    const contained = isAncestor(repo, reviewed, local);
    if (contained === true) return { ok: true };
    if (contained === undefined) return hold("could not compare the reviewed merge commit with master");
  } else if (local === origin) return { ok: true };
  let same: boolean;
  try {
    same = realpathSync(holder.path) === realpathSync(repo);
  } catch {
    return hold(`${held} (could not resolve ${holder.path})`);
  }
  if (!same) return hold(held);
  const behind = isAncestor(repo, local, origin);
  if (reviewed === undefined) {
    const ahead = isAncestor(repo, origin, local);
    if (behind === undefined || ahead === undefined) return hold("could not compare master with origin/master");
    if (behind) return hold(held);
    return hold(ahead ? "local master is ahead of origin/master; nothing to fetch, push it or leave it" : "local master has diverged from origin/master");
  }
  const onOrigin = isAncestor(repo, reviewed, origin);
  if (onOrigin === undefined) return hold("could not compare the reviewed merge commit with origin/master");
  if (!onOrigin) return hold(`the reviewed merge commit ${reviewed.slice(0, 12)} is not on origin/master`);
  const fastForward = isAncestor(repo, local, reviewed);
  if (fastForward === undefined) return hold("could not compare master with the reviewed merge commit");
  if (!fastForward) return hold(`local master has diverged from the reviewed merge commit ${reviewed.slice(0, 12)}`);
  const dirty = dirtyReport(repo);
  if (dirty !== undefined) return { ok: false, reason: clean(dirty.reason.startsWith("git status") ? dirty.reason : `${repo} has uncommitted tracked changes; commit or restore them, then re-run`, 400), after: dirty.after };
  const clash = overwritten(repo, local, reviewed);
  if (clash?.startsWith("?")) return hold(clash.slice(1));
  if (clash !== undefined) return hold(`an incoming path would overwrite an untracked or ignored entry (or swaps a tracked file and directory, which a manual pull handles): ${clean(clash, 120)}; move it aside, then re-run`);
  // the merge acts on the branch that was checked, not on whatever was switched to meanwhile
  const head = git(repo, ["symbolic-ref", "-q", "HEAD"]);
  if (head.stdout.trim() !== TRUNK_REF) return hold(`HEAD of ${repo} is ${clean(head.stdout.trim()) || "detached"}, not master; switch back and re-run`);
  const partly = `; the working tree may be partly updated: git -C ${repo} status`;
  const merged = git(repo, ["-c", "submodule.recurse=false", "merge", "-q", "--ff-only", reviewed]);
  if (merged.status !== 0 || merged.error !== undefined) return hold(`git merge --ff-only failed: ${why(merged)}`, partly);
  if (commitOf(repo, TRUNK_REF) !== reviewed) return hold("master did not move to the reviewed merge commit", partly);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PR identity and settlement
// ---------------------------------------------------------------------------

export interface Pr {
  number: number;
  state: "OPEN" | "MERGED" | "CLOSED";
  mss: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  repo: string;
  /** Only set (and well formed) for a MERGED PR. */
  mergeOid?: string;
}
export type PrRead = { kind: "none" } | { kind: "pr"; pr: Pr } | { kind: "held"; reason: string };

const slugs = new Map<string, string>();
export function repoSlug(repo: string): { ok: true; slug: string } | { ok: false; reason: string } {
  const known = slugs.get(repo);
  if (known !== undefined) return { ok: true, slug: known };
  const v = ghJson(repo, ["repo", "view", "--json", "nameWithOwner"]);
  if (!v.ok) return v;
  const slug = isObj(v.value) ? v.value["nameWithOwner"] : undefined;
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return { ok: false, reason: "gh repo view returned no valid nameWithOwner" };
  slugs.set(repo, slug);
  return { ok: true, slug };
}

/** Required-key, enum and shape checks shared by list and view reads. */
function checkShape(o: unknown, keys: string[]): string | undefined {
  if (!isObj(o)) return "a PR entry is not an object";
  for (const k of keys) if (!(k in o)) return `a PR entry has no ${k}`;
  if (typeof o["state"] !== "string" || !PR_STATES.has(o["state"])) return `unknown PR state ${clean(JSON.stringify(o["state"]))}`;
  if (typeof o["mergeStateStatus"] !== "string" || !MERGE_STATES.has(o["mergeStateStatus"])) return `unknown mergeStateStatus ${clean(JSON.stringify(o["mergeStateStatus"]))}`;
  for (const k of ["headRefName", "baseRefName"]) if (typeof o[k] !== "string") return `${k} is not a string`;
  if (!wellFormedOid(o["headRefOid"])) return "headRefOid is not a 40-hex commit id";
  return undefined;
}

function toPr(o: Json, slug: string): Pr | string {
  const state = o["state"] as Pr["state"];
  const pr: Pr = {
    number: o["number"] as number,
    state,
    mss: o["mergeStateStatus"] as string,
    headRefName: o["headRefName"] as string,
    headRefOid: o["headRefOid"] as string,
    baseRefName: o["baseRefName"] as string,
    repo: slug,
  };
  if (state === "MERGED") {
    const mc = o["mergeCommit"];
    const oid = isObj(mc) ? mc["oid"] : undefined;
    if (!wellFormedOid(oid)) return "the MERGED PR's mergeCommit.oid is missing or malformed";
    pr.mergeOid = oid;
  }
  return pr;
}

/** Read one `pr view` for the pinned PR number (fail closed). */
export function readView(repo: string, pr: Pr): { ok: true; view: Pr } | { ok: false; reason: string } {
  const v = ghJson(repo, ["pr", "view", String(pr.number), "-R", pr.repo, "--json", PR_VIEW_FIELDS]);
  if (!v.ok) return v;
  const bad = checkShape(v.value, PR_VIEW_FIELDS.split(","));
  if (bad !== undefined) return { ok: false, reason: bad };
  const view = toPr(v.value as Json, pr.repo);
  return typeof view === "string" ? { ok: false, reason: view } : { ok: true, view };
}

interface Cand {
  number: number;
  state: Pr["state"];
  pr?: Pr;
  bad?: string;
}

export function identifyPr(repo: string, head: string): PrRead {
  const slug = repoSlug(repo);
  if (!slug.ok) return { kind: "held", reason: slug.reason };
  const v = ghJson(repo, ["pr", "list", "-R", slug.slug, "--head", head, "--state", "all", "--limit", "20", "--json", PR_LIST_FIELDS]);
  if (!v.ok) return { kind: "held", reason: v.reason };
  if (!Array.isArray(v.value)) return { kind: "held", reason: "gh pr list did not return an array" };
  const counted: Cand[] = [];
  for (const o of v.value) {
    const bad = checkShape(o, PR_LIST_FIELDS.split(","));
    if (bad !== undefined) return { kind: "held", reason: bad };
    const c = o as Json;
    const owner = isObj(c["headRepositoryOwner"]) ? c["headRepositoryOwner"]["login"] : undefined;
    const hr = isObj(c["headRepository"]) ? c["headRepository"]["nameWithOwner"] : undefined;
    const n = c["number"];
    const identity =
      c["headRefName"] === head && c["baseRefName"] === "master" && c["isCrossRepository"] === false && hr === slug.slug && owner === slug.slug.split("/")[0] && Number.isInteger(n) && (n as number) > 0;
    if (!identity) continue;
    const pr = toPr(c, slug.slug);
    counted.push({ number: n as number, state: c["state"] as Pr["state"], ...(typeof pr === "string" ? { bad: pr } : { pr }) });
  }
  const open = counted.filter((p) => p.state === "OPEN");
  if (open.length > 1) return { kind: "held", reason: `more than one OPEN PR for ${head} (${open.map((p) => `#${p.number}`).join(", ")}): ambiguous` };
  // the NEWEST PR decides: an older MERGED one never outlives a newer CLOSED one (an OPEN one always wins, refusing)
  const newest = [...counted].sort((a, b) => b.number - a.number)[0];
  const chosen = open[0] ?? (newest?.state === "MERGED" ? newest : undefined);
  if (chosen === undefined) return { kind: "none" };
  return chosen.pr === undefined ? { kind: "held", reason: chosen.bad ?? "malformed PR" } : { kind: "pr", pr: chosen.pr };
}

export type Settlement = { kind: "settled" } | { kind: "behind"; reason: string } | { kind: "unverifiable"; reason: string } | { kind: "unrelated"; reason: string };

/**
 * A MERGED PR settles the rungs up to `merge` only by reachability: its merge
 * commit is in the local trunk AND, when the local branch still exists, the
 * local tip is the PR's head or an ancestor of it. A head the local object
 * store does not know (`merge-base` exit 128) is "unverifiable", not unrelated:
 * the merge step fetches the opus remote-tracking ref and re-checks, so both
 * `behind` and `unverifiable` are named `merge`. Only a locally known head the
 * tip is not part of (exit 1) is "unrelated" and settles nothing; a name match
 * alone never settles.
 */
export function settleMerged(repo: string, pr: Pr, read: TipRead): Settlement {
  if (read.kind === "error") return { kind: "unverifiable", reason: read.reason };
  const tip = read.kind === "tip" ? read.oid : undefined;
  const contained = trunkContainsMerge(repo, pr.mergeOid);
  let relation: "related" | "unrelated" | "unverifiable" = "related";
  if (tip !== undefined && tip !== pr.headRefOid) {
    const r = git(repo, ["merge-base", "--is-ancestor", tip, pr.headRefOid]);
    relation = r.status === 0 ? "related" : r.status === 1 ? "unrelated" : "unverifiable";
  }
  if (relation === "unrelated") return { kind: "unrelated", reason: `local opus branch tip ${tip?.slice(0, 12)} is not part of the merged head ${pr.headRefOid.slice(0, 12)}` };
  if (!contained.ok) return { kind: "behind", reason: `merge commit ${pr.mergeOid?.slice(0, 12)} is not contained in the local trunk (${contained.reason})` };
  if (relation === "unverifiable") return { kind: "unverifiable", reason: `merged head ${pr.headRefOid.slice(0, 12)} is not known locally and cannot be tied to the local branch` };
  return { kind: "settled" };
}

/** W-123: why the opus's merge is not in the local trunk; undefined when its PR is MERGED and settled. */
export function mergeRefusal(repo: string, id: string): string | undefined {
  const read = identifyPr(repo, `opus/${id}`);
  if (read.kind === "held") return read.reason;
  if (read.kind === "none") return `no MERGED PR from opus/${id} to master`;
  if (read.pr.state !== "MERGED") return `PR #${read.pr.number} from opus/${id} is ${read.pr.state}, not MERGED`;
  const tip = readTip(repo, id);
  const s = settleMerged(repo, read.pr, tip);
  if (s.kind !== "settled") return s.reason;
  // no local branch to tie the merged head to: the remote branch, if it still exists, must not have moved since the merge
  if (tip.kind !== "absent") return undefined;
  const remote = remoteTip(repo, id);
  if (remote.kind === "error") return remote.reason;
  if (remote.kind === "tip" && remote.oid !== read.pr.headRefOid) return `PR #${read.pr.number} merged head ${read.pr.headRefOid.slice(0, 12)} is not the remote opus/${id} tip ${remote.oid.slice(0, 12)}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------

/** What a performed rung reports: `lines` are printed verbatim after the step line. */
export interface StepResult {
  ok: boolean;
  lines: string[];
}
export interface Ctx {
  repo: string;
  id: string;
  /** The head branch this call carries to the trunk: `opus/<id>`, `spec/<id>` or `chore/done-<id>`. */
  head: string;
  /** The opus worktree (cwd of rebase and push). */
  wt: string;
  /** source exclusions the SOURCE tree is hashed with (studio dir, .bisellium, source_excludes) */
  excludes: string[];
  pollMs: number;
  maxPolls: number;
  log(line: string): void;
  sleep(ms: number): Promise<void>;
}
const held = (reason: string, ...more: string[]): StepResult => ({ ok: false, lines: [`why: ${reason}`, ...more] });
/** A hold for tracked changes outside `allow`; undefined when the checkout is clean. */
export function dirtyHold(cwd: string, allow?: (path: string) => boolean): StepResult | undefined {
  const d = dirtyReport(cwd, allow);
  return d === undefined ? undefined : held(`refusing: ${d.reason}`, ...d.after);
}

// ---------------------------------------------------------------------------
// pr
// ---------------------------------------------------------------------------

export function openPr(ctx: Ctx, existing: Pr | undefined, title: string | undefined, bodyFile: string | undefined): StepResult {
  const { repo, wt, id } = ctx;
  const branch = `opus/${id}`;
  const onBranch = git(wt, ["symbolic-ref", "-q", "HEAD"]);
  if (onBranch.stdout.trim() !== `refs/heads/${branch}`) return held(`refusing: ${wt} is not on ${branch} (HEAD ${onBranch.stdout.trim() || "detached"}); pr opens only from the opus branch`);
  // "dirty" is tracked changes only (staged or unstaged); untracked files never block.
  const dirty = dirtyHold(wt);
  if (dirty !== undefined) return dirty;
  const fetched = fetchTrunk(repo);
  if (!fetched.ok) return held(fetched.reason, ...(fetched.after ?? []));
  const before = sourceTreeHash(wt, ctx.excludes, "HEAD");
  ctx.log("rebase onto the fetched trunk");
  const rebase = git(wt, ["-c", "submodule.recurse=false", "rebase", "-q", TRUNK_REF]);
  if (rebase.status !== 0) {
    const status = git(wt, ["status", "--short"]).stdout.trim().split("\n").slice(0, 10);
    git(wt, ["rebase", "--abort"]);
    return { ok: false, lines: ["state=CONFLICT", "why: rebase onto master conflicted; resolve on the branch, then re-run", ...status.map((l) => `conflict: ${clean(l)}`)] };
  }
  if (sourceTreeHash(wt, ctx.excludes, "HEAD") !== before)
    return held("the rebase changed the SOURCE tree; stopped before push and PR, the build gates must be re-run on the rebased tree");
  ctx.log("push --force-with-lease");
  const push = git(wt, ["push", "-q", "--force-with-lease", "origin", branch]);
  if (push.status !== 0) return held(`push failed: ${why(push)}`);
  let number = existing?.number;
  if (existing === undefined) {
    const slug = repoSlug(repo);
    if (!slug.ok) return held(slug.reason);
    ctx.log("gh pr create");
    const created = sh("gh", ["pr", "create", "-R", slug.slug, "--base", "master", "--head", branch, "--title", title ?? "", "--body-file", bodyFile ?? ""], wt, GH_MAX_BYTES);
    const found = /\/pull\/([1-9][0-9]*)\s*$/.exec(created.stdout.trim());
    if (created.status !== 0 || found === null) return held(`pr create failed: ${why(created)}`);
    number = Number(found[1]);
  }
  const short = (ref: string): string => git(wt, ["rev-parse", "--short", ref]).stdout.trim();
  return { ok: true, lines: [`PR=${number} base=${short("master")} head=${short("HEAD")}`] };
}

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

type Check = { name: string; bucket: string };
function readChecks(repo: string, pr: Pr): { ok: true; checks: Check[] } | { ok: false; reason: string } {
  const v = ghJson(repo, ["pr", "checks", String(pr.number), "-R", pr.repo, "--json", "name,bucket,state"]);
  if (!v.ok) return v;
  if (!Array.isArray(v.value) || v.value.length === 0) return { ok: false, reason: "gh pr checks returned no checks" };
  const checks: Check[] = [];
  for (const c of v.value) {
    if (!isObj(c) || typeof c["name"] !== "string" || typeof c["state"] !== "string" || typeof c["bucket"] !== "string" || !BUCKETS.has(c["bucket"])) return { ok: false, reason: "gh pr checks returned a check with a missing or unknown field" };
    checks.push({ name: c["name"], bucket: c["bucket"] });
  }
  return { ok: true, checks };
}

/** The tail shared by a freshly merged PR and an already-MERGED one: fetch the trunk, re-check containment. */
function landed(ctx: Ctx, pr: Pr, extra: string[]): StepResult {
  const fetched = fetchTrunk(ctx.repo, pr.mergeOid);
  if (!fetched.ok) return { ok: false, lines: ["state=MERGED_NOT_FETCHED", `why: ${fetched.reason}`, ...(fetched.after ?? []), ...extra] };
  const tip = readRef(ctx.repo, `refs/heads/${ctx.head}`);
  if (tip.kind === "error") return held(tip.reason, ...extra);
  if (tip.kind === "tip") git(ctx.repo, ["fetch", "-q", "origin", `+refs/heads/${ctx.head}:refs/remotes/origin/${ctx.head}`]);
  const contained = trunkContainsMerge(ctx.repo, pr.mergeOid);
  if (!contained.ok) return { ok: false, lines: ["state=MERGED_NOT_FETCHED", `why: merge commit ${pr.mergeOid?.slice(0, 12) ?? "(unknown)"} is not in the local master after the fetch (${contained.reason})`, ...extra] };
  // the merged head must be resolvable here now that the opus ref was fetched; otherwise it can never be tied to the local branch
  if (settleMerged(ctx.repo, pr, tip).kind === "unverifiable") return held(`merged head ${pr.headRefOid.slice(0, 12)} is still not known locally after fetching refs/remotes/origin/${ctx.head}; nothing more is done, resolve it by hand`, ...extra);
  return { ok: true, lines: [`local master -> ${git(ctx.repo, ["rev-parse", "--short", TRUNK_REF]).stdout.trim()}`, "state=MERGED", ...extra] };
}

export async function mergeGate(ctx: Ctx, pr: Pr): Promise<StepResult> {
  const { repo } = ctx;
  if (pr.state === "MERGED") return landed(ctx, pr, []);
  if (pr.state !== "OPEN") return held(`PR #${pr.number} is ${pr.state}`);
  const n = String(pr.number);
  let pinned = pr.headRefOid;
  const headMoved = (now: string): StepResult => ({ ok: false, lines: [`state=HEAD_MOVED pinned=${pinned.slice(0, 12)} now=${now.slice(0, 12)}`] });
  /** A head other than the reviewed pin is adopted only if it descends from the pin (fetched first); anything unprovable is not. */
  const descends = (head: string): boolean => {
    if (head === pinned) return true;
    git(repo, ["fetch", "-q", "origin", `+refs/heads/${ctx.head}:refs/remotes/origin/${ctx.head}`]);
    return git(repo, ["merge-base", "--is-ancestor", pinned, head]).status === 0;
  };
  const sameIdentity = (v: Pr): boolean => v.number === pr.number && v.headRefName === pr.headRefName && v.baseRefName === pr.baseRefName;

  // A PR that falls behind while its checks run stalls forever (PRs 139, 147): update it first.
  const first = readView(repo, pr);
  if (!first.ok) return held(first.reason);
  if (first.view.mss === "BEHIND") {
    if (!sameIdentity(first.view)) return held(`PR #${pr.number} changed identity under the read`);
    if (first.view.headRefOid !== pinned) return headMoved(first.view.headRefOid);
    ctx.log("update-branch (BEHIND)");
    if (sh("gh", ["pr", "update-branch", n, "-R", pr.repo], repo).status !== 0) return held("gh pr update-branch failed");
    await ctx.sleep(ctx.pollMs);
    const again = readView(repo, pr);
    if (!again.ok) return held(again.reason);
    if (!sameIdentity(again.view)) return held(`PR #${pr.number} changed identity after update-branch`);
    if (!descends(again.view.headRefOid)) return headMoved(again.view.headRefOid);
    pinned = again.view.headRefOid;
  }

  // checks: only `pass` counts toward MIN_CHECKS; a failing check stops, pending waits
  let green = false;
  let seen = { pass: 0, pending: 0, fail: 0, total: 0 };
  for (let poll = 1; poll <= ctx.maxPolls && !green; poll++) {
    const c = readChecks(repo, pr);
    if (!c.ok) return held(c.reason);
    seen = { pass: 0, pending: 0, fail: 0, total: c.checks.length };
    for (const k of c.checks) if (k.bucket === "pass" || k.bucket === "pending" || k.bucket === "fail") seen[k.bucket]++;
    ctx.log(`checks poll ${poll}: pass=${seen.pass} pending=${seen.pending} fail=${seen.fail} total=${seen.total}`);
    if (seen.fail > 0) return { ok: false, lines: ["FAILING CHECKS:", ...c.checks.filter((k) => k.bucket === "fail").map((k) => `  ${clean(k.name)}`), "state=CHECKS_FAILED"] };
    if (seen.pending === 0 && seen.pass >= MIN_CHECKS) green = true;
    else if (poll < ctx.maxPolls) await ctx.sleep(ctx.pollMs);
  }
  if (!green) return { ok: false, lines: [`state=WAITING total=${seen.total} pass=${seen.pass} pending=${seen.pending} failing=${seen.fail}`] };

  // GHAS: any open alert, an API error or a non-array reply stops the merge.
  const alerts = ghJson(repo, ["api", `repos/${pr.repo}/code-scanning/alerts?state=open&per_page=100`]);
  if (!alerts.ok || !Array.isArray(alerts.value)) return { ok: false, lines: ["state=GHAS_STOP", `why: ${alerts.ok ? "the code-scanning reply was not an array" : alerts.reason}`] };
  if (alerts.value.length > 0) return { ok: false, lines: [`state=GHAS_STOP open_alerts=${alerts.value.length}`] };

  // --auto lets the merge queue serialise PRs that leapfrog each other's update-branch.
  ctx.log("gh pr merge --squash --auto");
  const merge = sh("gh", ["pr", "merge", n, "-R", pr.repo, "--squash", "--auto", "--match-head-commit", pinned], repo);
  if (merge.status !== 0) return { ok: false, lines: ["state=MERGE_FAILED", `why: ${why(merge)}`] };

  let moved = false;
  for (let poll = 1; poll <= ctx.maxPolls; poll++) {
    const r = readView(repo, pr);
    if (!r.ok) return held(`${r.reason} (after the merge was requested)`);
    const v = r.view;
    if (!sameIdentity(v)) return held(`PR #${pr.number} changed identity after the merge was requested`);
    if (v.state === "MERGED") return landed(ctx, v, []);
    if (v.state === "CLOSED") return { ok: false, lines: ["state=QUEUE_REJECTED"] };
    if (moved) {
      if (!descends(v.headRefOid)) return headMoved(v.headRefOid);
      pinned = v.headRefOid;
      moved = false;
    } else if (v.headRefOid !== pinned) return headMoved(v.headRefOid);
    if (v.mss === "BEHIND") {
      ctx.log("update-branch (BEHIND while queued)");
      if (sh("gh", ["pr", "update-branch", n, "-R", pr.repo], repo).status === 0) moved = true;
    } else if (v.mss === "CLEAN") {
      // Auto-merge does not always fire once a PR is green (PRs 139, 147, 149). BLOCKED is never merged directly.
      const c = readChecks(repo, pr);
      if (c.ok && c.checks.every((k) => k.bucket === "pass")) {
        ctx.log("direct merge requested (CLEAN, every check pass)");
        sh("gh", ["pr", "merge", n, "-R", pr.repo, "--squash", "--match-head-commit", pinned], repo);
      }
    }
    ctx.log(`queue poll ${poll}: ${v.state} ${v.mss}`);
    await ctx.sleep(ctx.pollMs);
  }
  return { ok: false, lines: ["state=QUEUE_TIMEOUT"] };
}

// ---------------------------------------------------------------------------
// landing — a record-only head (`spec/<id>`, `chore/done-<id>`) carried to the trunk by the same gates as an opus
// ---------------------------------------------------------------------------

/**
 * Push the head (`--force-with-lease`, never `-u`), reuse its OPEN PR or create one titled with the head commit's subject,
 * run `mergeGate`'s rules, and once MERGED and the trunk fast-forwarded delete the head locally and on origin (leased to the PR head).
 * An already MERGED PR skips the push and the create and goes straight to the trunk fetch and the deletion.
 */
export async function landHead(ctx: Ctx): Promise<StepResult> {
  const { repo, head } = ctx;
  let read = identifyPr(repo, head);
  if (read.kind === "held") return held(read.reason);
  if (!(read.kind === "pr" && read.pr.state === "MERGED")) {
    ctx.log(`push --force-with-lease ${head}`);
    const push = git(repo, ["push", "-q", "--force-with-lease", "origin", head]);
    if (push.status !== 0) return held(`push failed: ${why(push)}`);
    if (read.kind === "none") {
      const slug = repoSlug(repo);
      if (!slug.ok) return held(slug.reason);
      const title = git(repo, ["log", "-1", "--format=%s", `refs/heads/${head}`]).stdout.trim();
      const body = git(repo, ["log", "-1", "--format=%b", `refs/heads/${head}`]).stdout.trim();
      ctx.log("gh pr create");
      const created = sh("gh", ["pr", "create", "-R", slug.slug, "--base", "master", "--head", head, "--title", title, "--body", body], repo, GH_MAX_BYTES);
      if (created.status !== 0 || !/\/pull\/[1-9][0-9]*\s*$/.test(created.stdout.trim())) return held(`pr create failed: ${why(created)}`);
    }
    // the PR head moves with the push: pin the merge to what is there now
    read = identifyPr(repo, head);
    if (read.kind === "held") return held(read.reason);
  }
  if (read.kind !== "pr") return held(`no PR for ${head} after the push`);
  const merged = await mergeGate(ctx, read.pr);
  if (!merged.ok) return merged;
  const dropped = cleanup(ctx);
  return { ok: dropped.ok, lines: [...merged.lines, ...dropped.lines] };
}

// ---------------------------------------------------------------------------
// cleanup — only from a re-read MERGED + fetched; idempotent; each deletion re-reads first
// ---------------------------------------------------------------------------

export function cleanup(ctx: Ctx): StepResult {
  const { repo, id } = ctx;
  const branch = ctx.head;
  const ref = `refs/heads/${branch}`;
  const out: string[] = [];
  const stop = (label: string, reason: string): StepResult => {
    out.push(`${label}: held (${reason})`);
    return { ok: false, lines: [...out, `why: ${reason}`] };
  };
  /** A fresh MERGED read, contained in trunk, and tied to the local tip; the PR 127 guard. */
  const reread = (): { ok: true; pr: Pr } | { ok: false; reason: string } => {
    const read = identifyPr(repo, branch);
    if (read.kind === "held") return { ok: false, reason: read.reason };
    if (read.kind === "none" || read.pr.state !== "MERGED") return { ok: false, reason: `no MERGED PR for ${branch} (PR ${read.kind === "pr" ? `#${read.pr.number} is ${read.pr.state}` : "absent"})` };
    const s = settleMerged(repo, read.pr, readRef(repo, ref));
    return s.kind === "settled" ? { ok: true, pr: read.pr } : { ok: false, reason: s.reason };
  };
  const fetched = git(repo, ["fetch", "-q", "--prune", "origin"]);
  if (fetched.status !== 0) return held(`git fetch --prune origin failed: ${why(fetched)}`);

  // (1) the worktree (only an opus branch has one)
  let pr = reread();
  if (!pr.ok) return stop("worktree", pr.reason);
  const { dir, entry } = opusWorktree(repo, id);
  const dirExists = lstatSafe(dir);
  if (branch !== `opus/${id}`) out.push("worktree: skipped (not an opus branch)");
  else if (entry === undefined) {
    if (dirExists) return stop("worktree", `${dir} exists but is not the registered worktree for ${branch}; left untouched`);
    out.push("worktree: skipped (absent)");
  } else if (entry.branch !== ref && !(entry.prunable && !dirExists)) {
    return stop("worktree", `${dir} is registered for ${entry.branch ?? "no branch"}, not ${branch}; left untouched`);
  } else if (!dirExists) {
    // an entry whose directory was deleted by hand: prune it (never --force), then carry on
    if (!entry.prunable) return stop("worktree", `${dir} is registered but its directory is missing and git does not mark it prunable`);
    const pruned = git(repo, ["worktree", "prune"]);
    if (pruned.status !== 0) return stop("worktree", `git worktree prune failed: ${why(pruned)}`);
    out.push("worktree: ran (pruned the entry whose directory was missing)");
  } else {
    const inside = relative(dir, resolve(process.cwd()));
    if (lstatSync(dir).isSymbolicLink()) return stop("worktree", `${dir} is a symlink; left untouched`);
    if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) return stop("worktree", `the current directory is inside ${dir}`);
    const removed = git(repo, ["worktree", "remove", "--", dir]);
    if (removed.status !== 0) return stop("worktree", `git worktree remove refused (no --force): ${why(removed)}`);
    out.push("worktree: ran");
  }

  // (2) the local branch: compare-and-swap on the tip, only if the merged PR has it
  pr = reread();
  if (!pr.ok) return stop("local branch", pr.reason);
  const read = readRef(repo, ref);
  if (read.kind === "error") return stop("local branch", read.reason);
  const tip = read.kind === "tip" ? read.oid : undefined;
  if (tip === undefined) out.push("local branch: skipped (absent)");
  else {
    const elsewhere = listWorktrees(repo)?.find((e) => e.branch === ref);
    if (elsewhere !== undefined) return stop("local branch", `${branch} is still checked out at ${elsewhere.path}`);
    if (tip !== pr.pr.headRefOid && git(repo, ["merge-base", "--is-ancestor", tip, pr.pr.headRefOid]).status !== 0)
      return stop("local branch", `${branch} (${tip.slice(0, 12)}) has a local commit the merged PR lacks`);
    const deleted = git(repo, ["update-ref", "-d", ref, tip]);
    if (deleted.status !== 0) return stop("local branch", `update-ref -d failed: ${why(deleted)}`);
    out.push("local branch: ran");
  }

  // (3) the remote branch, leased on the merged head
  pr = reread();
  if (!pr.ok) return stop("remote branch", pr.reason);
  const remote = git(repo, ["for-each-ref", "--format=%(objectname)", `refs/remotes/origin/${branch}`]).stdout.trim();
  if (remote === "") out.push("remote branch: skipped (absent)");
  else {
    const pushed = git(repo, ["push", "-q", "origin", `--force-with-lease=${ref}:${pr.pr.headRefOid}`, "--delete", ref]);
    if (pushed.status !== 0) return stop("remote branch", `leased delete refused: ${why(pushed)}`);
    out.push("remote branch: ran");
  }
  return { ok: true, lines: out };
}

function lstatSafe(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
