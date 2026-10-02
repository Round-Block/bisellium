/**
 * packages/cli/src/integrate.ts — W-124: the `pr`, `merge` and `cleanup` rungs
 * of `bisellium next`, absorbing `scripts/open-pr.sh` and `scripts/merge-gate.sh`
 * (which stay byte-identical until a producer chore retires them).
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

/** Parity with `merge-gate.sh`'s `-ge 5`; only checks in bucket `pass` count. */
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
const firstLine = (text: string): string => text.trim().split("\n")[0]?.slice(0, 300) ?? "";
const why = (r: Run): string => (r.error?.message ?? firstLine(r.stderr)) || `exit ${r.status}`;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function ghJson(cwd: string, args: string[]): { ok: true; value: unknown } | { ok: false; reason: string } {
  const r = sh("gh", args, cwd, GH_MAX_BYTES);
  const label = `gh ${args.slice(0, 2).join(" ")}`;
  if (r.error !== undefined) return { ok: false, reason: `${label} failed: ${r.error.message}` };
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

export const localTip = (repo: string, id: string): string | undefined => {
  const r = git(repo, ["rev-parse", "--verify", "-q", `refs/heads/opus/${id}`]);
  return r.status === 0 && OID_RE.test(r.stdout.trim()) ? r.stdout.trim() : undefined;
};

/** `git fetch origin master:master`, or a hold naming the worktree that has master checked out. */
export function fetchTrunk(repo: string): { ok: true } | { ok: false; reason: string } {
  const r = git(repo, ["fetch", "-q", "origin", "master:master"]);
  if (r.status === 0) return { ok: true };
  const holder = listWorktrees(repo)?.find((e) => e.branch === TRUNK_REF);
  if (holder !== undefined) return { ok: false, reason: `master is checked out at ${holder.path}, so it cannot be fetched into; run there: git -C ${holder.path} pull --ff-only origin master` };
  return { ok: false, reason: `git fetch origin master:master failed: ${why(r)}` };
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
  if (typeof o["state"] !== "string" || !PR_STATES.has(o["state"])) return `unknown PR state ${JSON.stringify(o["state"])}`;
  if (typeof o["mergeStateStatus"] !== "string" || !MERGE_STATES.has(o["mergeStateStatus"])) return `unknown mergeStateStatus ${JSON.stringify(o["mergeStateStatus"])}`;
  for (const k of ["headRefName", "baseRefName"]) if (typeof o[k] !== "string") return `${k} is not a string`;
  if (typeof o["headRefOid"] !== "string" || !OID_RE.test(o["headRefOid"])) return "headRefOid is not a 40-hex commit id";
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

export function identifyPr(repo: string, id: string): PrRead {
  const slug = repoSlug(repo);
  if (!slug.ok) return { kind: "held", reason: slug.reason };
  const head = `opus/${id}`;
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
  const chosen = open[0] ?? counted.filter((p) => p.state === "MERGED").sort((a, b) => b.number - a.number)[0];
  if (chosen === undefined) return { kind: "none" };
  return chosen.pr === undefined ? { kind: "held", reason: chosen.bad ?? "malformed PR" } : { kind: "pr", pr: chosen.pr };
}

export type Settlement = { kind: "settled" } | { kind: "behind"; reason: string } | { kind: "unrelated"; reason: string };

/**
 * A MERGED PR settles the rungs up to `merge` only by reachability: its merge
 * commit is in the local trunk AND, when the local branch still exists, the
 * local tip is the PR's head or an ancestor of it. An head the local object
 * store does not know is "unverifiable"; with the merge commit still missing
 * from trunk that is `behind` (the merge step fetches and re-checks), with the
 * merge commit already in trunk it settles nothing (name match alone never does).
 */
export function settleMerged(repo: string, pr: Pr, tip: string | undefined): Settlement {
  const contained = trunkContainsMerge(repo, pr.mergeOid);
  let relation: "related" | "unrelated" | "unverifiable" = "related";
  if (tip !== undefined && tip !== pr.headRefOid) {
    const r = git(repo, ["merge-base", "--is-ancestor", tip, pr.headRefOid]);
    relation = r.status === 0 ? "related" : r.status === 1 ? "unrelated" : "unverifiable";
  }
  if (relation === "unrelated") return { kind: "unrelated", reason: `local opus branch tip ${tip?.slice(0, 12)} is not part of the merged head ${pr.headRefOid.slice(0, 12)}` };
  if (!contained.ok) return { kind: "behind", reason: `merge commit ${pr.mergeOid?.slice(0, 12)} is not contained in the local trunk (${contained.reason})` };
  if (relation === "unverifiable") return { kind: "unrelated", reason: `merged head ${pr.headRefOid.slice(0, 12)} is not known locally and cannot be tied to the local branch` };
  return { kind: "settled" };
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

// ---------------------------------------------------------------------------
// pr — absorbs scripts/open-pr.sh
// ---------------------------------------------------------------------------

export function openPr(ctx: Ctx, existing: Pr | undefined, title: string | undefined, bodyFile: string | undefined): StepResult {
  const { repo, wt, id } = ctx;
  const branch = `opus/${id}`;
  const onBranch = git(wt, ["symbolic-ref", "-q", "HEAD"]);
  if (onBranch.stdout.trim() !== `refs/heads/${branch}`) return held(`refusing: ${wt} is not on ${branch} (HEAD ${onBranch.stdout.trim() || "detached"}); pr opens only from the opus branch`);
  // "dirty" is tracked changes only (staged or unstaged); untracked files never block.
  const dirty = git(wt, ["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  if (dirty !== "") return held("refusing: working tree dirty", ...dirty.split("\n").slice(0, 10).map((l) => `dirty: ${l}`));
  const fetched = fetchTrunk(repo);
  if (!fetched.ok) return held(fetched.reason);
  const before = sourceTreeHash(wt, ctx.excludes, "HEAD");
  ctx.log("rebase onto the fetched trunk");
  const rebase = git(wt, ["-c", "submodule.recurse=false", "rebase", "-q", "master"]);
  if (rebase.status !== 0) {
    const status = git(wt, ["status", "--short"]).stdout.trim().split("\n").slice(0, 10);
    git(wt, ["rebase", "--abort"]);
    return { ok: false, lines: ["state=CONFLICT", "why: rebase onto master conflicted; resolve on the branch, then re-run", ...status.map((l) => `conflict: ${l}`)] };
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
// merge — absorbs scripts/merge-gate.sh
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
  const fetched = fetchTrunk(ctx.repo);
  if (!fetched.ok) return { ok: false, lines: ["state=MERGED_NOT_FETCHED", `why: ${fetched.reason}`, ...extra] };
  const tip = localTip(ctx.repo, ctx.id);
  if (tip !== undefined) git(ctx.repo, ["fetch", "-q", "origin", `+refs/heads/opus/${ctx.id}:refs/remotes/origin/opus/${ctx.id}`]);
  const contained = trunkContainsMerge(ctx.repo, pr.mergeOid);
  if (!contained.ok) return { ok: false, lines: ["state=MERGED_NOT_FETCHED", `why: merge commit ${pr.mergeOid?.slice(0, 12) ?? "(unknown)"} is not in the local master after the fetch (${contained.reason})`, ...extra] };
  return { ok: true, lines: [`local master -> ${git(ctx.repo, ["rev-parse", "--short", TRUNK_REF]).stdout.trim()}`, "state=MERGED", ...extra] };
}

export async function mergeGate(ctx: Ctx, pr: Pr): Promise<StepResult> {
  const { repo } = ctx;
  if (pr.state === "MERGED") return landed(ctx, pr, []);
  if (pr.state !== "OPEN") return held(`PR #${pr.number} is ${pr.state}`);
  const n = String(pr.number);
  let pinned = pr.headRefOid;
  const sameIdentity = (v: Pr): boolean => v.number === pr.number && v.headRefName === pr.headRefName && v.baseRefName === pr.baseRefName;

  // A PR that falls behind while its checks run stalls forever (PRs 139, 147): update it first.
  const first = readView(repo, pr);
  if (!first.ok) return held(first.reason);
  if (first.view.mss === "BEHIND") {
    if (!sameIdentity(first.view)) return held(`PR #${pr.number} changed identity under the read`);
    ctx.log("update-branch (BEHIND)");
    if (sh("gh", ["pr", "update-branch", n, "-R", pr.repo], repo).status !== 0) return held("gh pr update-branch failed");
    await ctx.sleep(ctx.pollMs);
    const again = readView(repo, pr);
    if (!again.ok) return held(again.reason);
    if (!sameIdentity(again.view)) return held(`PR #${pr.number} changed identity after update-branch`);
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
    if (seen.fail > 0) return { ok: false, lines: ["FAILING CHECKS:", ...c.checks.filter((k) => k.bucket === "fail").map((k) => `  ${k.name}`), "state=CHECKS_FAILED"] };
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
      pinned = v.headRefOid;
      moved = false;
    } else if (v.headRefOid !== pinned) return { ok: false, lines: [`state=HEAD_MOVED pinned=${pinned.slice(0, 12)} now=${v.headRefOid.slice(0, 12)}`] };
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
// cleanup — only from a re-read MERGED + fetched; idempotent; each deletion re-reads first
// ---------------------------------------------------------------------------

export function cleanup(ctx: Ctx): StepResult {
  const { repo, id } = ctx;
  const branch = `opus/${id}`;
  const ref = `refs/heads/${branch}`;
  const out: string[] = [];
  const stop = (label: string, reason: string): StepResult => {
    out.push(`${label}: held (${reason})`);
    return { ok: false, lines: [...out, `why: ${reason}`] };
  };
  /** A fresh MERGED read, contained in trunk, and tied to the local tip; the PR 127 guard. */
  const reread = (): { ok: true; pr: Pr } | { ok: false; reason: string } => {
    const read = identifyPr(repo, id);
    if (read.kind === "held") return { ok: false, reason: read.reason };
    if (read.kind === "none" || read.pr.state !== "MERGED") return { ok: false, reason: `no MERGED PR for ${branch} (PR ${read.kind === "pr" ? `#${read.pr.number} is ${read.pr.state}` : "absent"})` };
    const s = settleMerged(repo, read.pr, localTip(repo, id));
    return s.kind === "settled" ? { ok: true, pr: read.pr } : { ok: false, reason: s.reason };
  };
  const fetched = git(repo, ["fetch", "-q", "--prune", "origin"]);
  if (fetched.status !== 0) return held(`git fetch --prune origin failed: ${why(fetched)}`);

  // (1) the worktree
  let pr = reread();
  if (!pr.ok) return stop("worktree", pr.reason);
  const { dir, entry } = opusWorktree(repo, id);
  const dirExists = lstatSafe(dir);
  if (entry === undefined) {
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
  const tip = localTip(repo, id);
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
