/**
 * packages/cli/src/rewrite.ts — W-462: the `pr` rung's rewrite of a reviewed head. A PR is OPEN on its reviewed head R
 * and the local opus branch now ends at N, where R is not an ancestor of N (the series was rebuilt, as W-408's was) and
 * N's tree is R's tree. The rung never pushes it: it checks, then asks the Patron once, by printing the one leased push
 * only the Patron runs (the harness refuses an agent's force push, 2026-10-29).
 *
 * The perform checks, in order, with nothing pushed and every commit of the opus branch kept: the worktree is clean, on
 * opus/<id> at N; origin's opus/<id> is R now (`ls-remote`); N's tree is R's; every commit of the series builds the web
 * bundle as certify builds it (`webBuild`, W-461); and every recorded red replays as certify replays it: the same
 * red-to-commit mapping (`redClaimer`, scripts/red-claims.mjs, the certify runner's own), certify's web build before it,
 * and certify's classifier (`classifyReplay`) on its output, with the recorded titles re-attested after a
 * re-identification. Builds and replays run in place in the opus worktree, which must start clean (no tracked change, no
 * untracked path), each commit checked out detached; a build or replay that leaves a tracked change or an untracked path
 * fails the check and is cleaned, and the Patron is asked only once the worktree is confirmed back on opus/<id> at N and
 * clean. Rejection pushes nothing and leaves commits and origin unchanged; it restores the branch and worktree when
 * possible, otherwise holds without a patron line and names the manual repair. Then it holds with the Patron's command: `git push
 * --force-with-lease=refs/heads/opus/<id>:<R> origin <N>:refs/heads/opus/<id>`, which refuses if origin moved off R.
 */
import { sourceTreeHash } from "@bisellium/shim";
import { spawnSync } from "node:child_process";
import { webBuild, webBuildFailure, webBuildReason } from "@bisellium/commands/web-build.js";
import { classifyReplay } from "../../../scripts/replay-accept.mjs";
import { redClaimer } from "../../../scripts/red-claims.mjs";
import { clean, dirtyHold, git, quoted, remoteTip, type Pr, type StepResult } from "./integrate.js";

/** next.ts's marker (W-377): `say` prints a line that opens with it whole; every other line is cut at 1000 characters, and a long worktree path would cut the Patron's one command short of its push */
const UNCUT = "\u0001";
const short = (oid: string): string => oid.slice(0, 12);
const held = (why: string, ...more: string[]): StepResult => ({ ok: false, lines: [`why: ${why}`, ...more] });

export type Rewrite = { kind: "unknown" } | { kind: "update" } | { kind: "rewrite"; tree: string } | { kind: "recorded" } | { kind: "rebased" } | { kind: "error"; reason: string };

/**
 * What local tip `head` is to PR head `reviewed`: a descendant (a plain update); a rewrite that keeps the whole tree; one
 * that keeps the source but changes the record tree (`recorded`: held, a rewrite keeps the reviewed tree); or one that
 * changes the source (`rebased`: a rebase onto master, which the review rung has already re-reviewed at the new source).
 * A PR head this clone does not hold is `unknown`: nothing can be compared, and the plain pr's push is leased on the
 * remote-tracking ref, which refuses to replace a head this clone has not fetched.
 */
export function rewriteOf(repo: string, excludes: string[], reviewed: string, head: string): Rewrite {
  const held = git(repo, ["cat-file", "-e", `${reviewed}^{commit}`]);
  if (held.error === undefined && held.status !== 0) return { kind: "unknown" };
  const anc = git(repo, ["merge-base", "--is-ancestor", reviewed, head]);
  if (anc.error === undefined && anc.status === 0) return { kind: "update" };
  if (anc.error !== undefined || anc.status !== 1) return { kind: "error", reason: `cannot compare PR head ${short(reviewed)} with the opus tip ${short(head)} (git merge-base exit ${anc.status ?? "none"}); fetch the PR head, then rerun` };
  const trees = git(repo, ["rev-parse", `${reviewed}^{tree}`, `${head}^{tree}`]);
  const [a, b] = trees.stdout.trim().split("\n");
  if (trees.status !== 0 || a === undefined || b === undefined) return { kind: "error", reason: `cannot read the trees of ${short(reviewed)} and ${short(head)}` };
  if (a === b) return { kind: "rewrite", tree: a };
  try {
    return sourceTreeHash(repo, excludes, reviewed) === sourceTreeHash(repo, excludes, head) ? { kind: "recorded" } : { kind: "rebased" };
  } catch {
    return { kind: "error", reason: `cannot read the source trees of ${short(reviewed)} and ${short(head)}` };
  }
}

/** The Patron's one command: the leased push of `head` over the reviewed head, run from the opus worktree. */
export const patronPush = (wt: string, id: string, reviewed: string, head: string): string =>
  `git -C ${quoted(wt)} push --force-with-lease=refs/heads/opus/${id}:${reviewed} origin ${head}:refs/heads/opus/${id}`;

export const REPLAY_TIMEOUT_MS = 10 * 60_000;
/** The worktree's changed and untracked paths (`git status --porcelain`; ignored paths, such as the web bundle, are not), or why not. */
function changed(wt: string): { paths: string[] } | { error: string } {
  const r = git(wt, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (r.error !== undefined || r.status !== 0) return { error: `git status failed in ${wt}` };
  return { paths: r.stdout.split("\0").filter((e) => e.length > 3).map((e) => e.slice(3)) };
}
const named = (c: { paths: string[] } | { error: string }): string => ("error" in c ? c.error : clean(c.paths.slice(0, 5).join(", ") + (c.paths.length > 5 ? `, and ${c.paths.length - 5} more` : ""), 300));
export interface SeriesInput {
  repo: string;
  /** where each commit is checked out, built and replayed; put back where it was after */
  wt: string;
  /** the branch the worktree is put back on, at `head`, after the checks */
  branch: string;
  id: string;
  studioRel: string;
  excludes: string[];
  head: string;
  /** the trunk the series starts after */
  base: string;
  behaviours: number;
}
export type Series = { ok: true; built: number; replayed: number } | { ok: false; why: string };

/**
 * Every commit of `base..head` builds, and every recorded red at `head` replays, as certify builds and replays them, in
 * the worktree `wt`, which starts clean. A build or replay that leaves a tracked change or an untracked path fails the
 * check, and the worktree is cleaned (reset, untracked paths removed; ignored paths are kept). Whatever the checks find,
 * and on every return path (a build or replay that succeeds, is refused, or leaves residue), the residue is cleaned and
 * the worktree put back on `branch` at `head`, and the result is `ok` only when it is confirmed there and clean.
 * Rejection pushes nothing and leaves commits and origin unchanged; it restores the branch and worktree when possible,
 * otherwise holds without a patron line and names the manual repair.
 */
export function checkSeries(s: SeriesInput): Series {
  const entered = { before: [] as string[] };
  let found: Series;
  try {
    found = inPlace(s, entered);
  } catch (e) {
    found = { ok: false, why: `the checks failed unexpectedly: ${clean((e as Error).message, 300)}` };
  }
  // whichever way the checks returned, a path the last build or replay left is cleaned before the worktree is put back
  const left = changed(s.wt);
  const stray = "error" in left ? left : { paths: left.paths.filter((p) => !entered.before.includes(p)) };
  if ("error" in stray || stray.paths.length > 0) {
    const reset = git(s.wt, ["reset", "-q", "--hard"]);
    const swept = git(s.wt, ["clean", "-fdq"]);
    const after = changed(s.wt);
    const cleaned = reset.status === 0 && swept.status === 0 && !("error" in after) && after.paths.length === 0;
    found = { ok: false, why: `${found.ok ? "the checks" : found.why}; the worktree was left changed (${named(stray)}), ${cleaned ? "cleaned" : "and it could not be cleaned"}` };
  }
  const back = git(s.wt, ["checkout", "-q", "--no-guess", s.branch]);
  const on = git(s.wt, ["symbolic-ref", "-q", "HEAD"]).stdout.trim();
  const at = git(s.wt, ["rev-parse", "HEAD"]).stdout.trim();
  const now = changed(s.wt);
  const off =
    back.status !== 0 || back.error !== undefined
      ? `git checkout ${s.branch} failed: ${clean(back.stderr.trim().split("\n")[0] ?? "") || `exit ${back.status}`}`
      : on !== `refs/heads/${s.branch}`
        ? `HEAD is ${clean(on) || "detached"}`
        : at !== s.head
          ? `${s.branch} is at ${short(at)}`
          : "error" in now || now.paths.length > 0
            ? `it holds ${named(now)}`
            : undefined;
  if (off === undefined) return found;
  return { ok: false, why: `${found.ok ? "" : `${found.why}; and `}the worktree ${s.wt} could not be put back on ${s.branch} at ${short(s.head)} clean (${off}): put it back by hand, then rerun` };
}
function inPlace(s: SeriesInput, entered: { before: string[] }): Series {
  /**
   * after a build or a replay: undefined when the worktree holds no path it did not hold just after the checkout (`before`:
   * an ignored output of an earlier commit's build can be untracked at this one); else what it left, after cleaning it
   */
  const left = (what: string, before: string[]): string | undefined => {
    const all = changed(s.wt);
    const now = "error" in all ? all : { paths: all.paths.filter((p) => !before.includes(p)) };
    if (!("error" in now) && now.paths.length === 0) return undefined;
    const reset = git(s.wt, ["reset", "-q", "--hard"]);
    const swept = git(s.wt, ["clean", "-fdq"]);
    const after = changed(s.wt);
    const cleaned = reset.status === 0 && swept.status === 0 && !("error" in after) && after.paths.length === 0;
    return `${what} left the worktree changed (${named(now)}), ${cleaned ? "cleaned" : "and it could not be cleaned"}; certify builds and replays in a fresh clone`;
  };
  const list = git(s.repo, ["rev-list", "--reverse", s.head, `^${s.base}`]);
  if (list.status !== 0) return { ok: false, why: `cannot list the commits of ${short(s.base)}..${short(s.head)}` };
  const commits = list.stdout.split("\n").filter(Boolean);
  /** checks out `c` detached: the paths the worktree holds then, or why it cannot */
  const at = (c: string): { paths: string[] } | { error: string } => {
    if (git(s.wt, ["checkout", "-q", "--detach", c]).status !== 0) return { error: `cannot check out ${short(c)} in ${s.wt}` };
    const here = changed(s.wt);
    if (!("error" in here)) entered.before = here.paths;
    return here;
  };
  for (const c of commits) {
    const moved = at(c);
    if ("error" in moved) return { ok: false, why: moved.error };
    const b = webBuild(s.wt);
    if (b.carried && !b.ok) return { ok: false, why: `commit ${short(c)} does not build: ${webBuildReason(b)}; certify's replay would refuse a red on it` };
    const dirt = left(`the build of ${short(c)}`, moved.paths);
    if (dirt !== undefined) return { ok: false, why: dirt };
  }
  const logRel = `${s.studioRel}/ci/reds/${s.id}`;
  const names = git(s.repo, ["ls-tree", "--name-only", `${s.head}:${logRel}`]);
  const reds = names.status === 0 ? names.stdout.split("\n").filter((n) => /^\d\d\.log$/.test(n)).sort() : [];
  for (let n = 1; n <= s.behaviours; n++) if (!reds.includes(`${String(n).padStart(2, "0")}.log`)) return { ok: false, why: `no recorded red for behaviour ${n} at ${short(s.head)}` };
  let claim: ReturnType<typeof redClaimer>;
  try {
    claim = redClaimer({
      finalCommit: s.head,
      logRel,
      behaviours: s.behaviours,
      sourceTree: (c) => sourceTreeHash(s.repo, s.excludes, c),
      git: (args, input) => {
        const r = spawnSync("git", args, { cwd: s.repo, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
        return { status: r.status, stdout: r.stdout ?? "" };
      },
      mustGit: (args) => {
        const r = git(s.repo, args);
        if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
        return r.stdout.trim();
      },
    });
  } catch (e) {
    return { ok: false, why: clean((e as Error).message, 400) };
  }
  for (const name of reds) {
    const bytes = spawnSync("git", ["cat-file", "blob", `${s.head}:${logRel}/${name}`], { cwd: s.repo, maxBuffer: 64 * 1024 * 1024 });
    if (bytes.status !== 0) return { ok: false, why: `cannot read ${logRel}/${name} at ${short(s.head)}` };
    let r: ReturnType<ReturnType<typeof redClaimer>>;
    try {
      r = claim(name, bytes.stdout);
    } catch (e) {
      return { ok: false, why: clean((e as Error).message, 400) };
    }
    const moved = at(r.commit);
    if ("error" in moved) return { ok: false, why: moved.error };
    const b = webBuild(s.wt);
    if (b.carried && !b.ok) return { ok: false, why: `${webBuildFailure(r.behaviour, b)} at ${short(r.commit)}` };
    const dirt = left(`the build of ${short(r.commit)}`, moved.paths);
    if (dirt !== undefined) return { ok: false, why: dirt };
    const argv = r.commandText.trim().split(/\s+/);
    const run = spawnSync(argv[0]!, argv.slice(1), { cwd: s.wt, encoding: "utf8", timeout: REPLAY_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    const residue = left(`red ${r.behaviour}'s replay at ${short(r.commit)}`, moved.paths);
    if (residue !== undefined) return { ok: false, why: residue };
    const verdict = classifyReplay({ status: run.status, output });
    if (!verdict.accepted) return { ok: false, why: `red ${r.behaviour} did not reproduce its assertion failure at ${short(r.commit)}: ${verdict.reason}` };
    const printed = new Set(output.split("\n").map((l) => /^not ok \d+ - (.*)$/.exec(l.replace(/\r$/, ""))?.[1]));
    if (r.titles !== undefined && !r.titles.every((t) => printed.has(t))) return { ok: false, why: `red ${r.behaviour} did not reproduce its recorded failure at ${short(r.commit)}` };
  }
  return { ok: true, built: commits.length, replayed: reds.length };
}

export interface RewriteInput {
  repo: string;
  wt: string;
  id: string;
  studioRel: string;
  excludes: string[];
  pr: Pr;
  behaviours: number;
}

/** The rewrite perform: every check, then the hold that asks the Patron for the one leased push. Never pushes. */
export function performRewrite(o: RewriteInput): StepResult {
  const { repo, wt, id, pr } = o;
  const branch = `opus/${id}`;
  const reviewed = pr.headRefOid;
  const dirty = dirtyHold(wt);
  if (dirty !== undefined) return dirty;
  const on = git(wt, ["symbolic-ref", "-q", "HEAD"]).stdout.trim();
  if (on !== `refs/heads/${branch}`) return held(`refusing: ${wt} is not on ${branch} (HEAD ${on || "detached"}); nothing checked or pushed`);
  const head = git(wt, ["rev-parse", "HEAD"]).stdout.trim();
  const stray = changed(wt);
  if ("error" in stray || stray.paths.length > 0)
    return held(`refusing: ${wt} ${"error" in stray ? `cannot be read (${stray.error})` : `holds untracked path(s) ${named(stray)}`}; the checks build and replay in place, from a clean worktree: move them aside, then rerun; nothing checked or pushed`);
  const remote = remoteTip(repo, id);
  if (remote.kind !== "tip" || remote.oid !== reviewed)
    return held(`origin's ${branch} is ${remote.kind === "tip" ? short(remote.oid) : remote.kind === "absent" ? "absent" : remote.reason}, not PR #${pr.number}'s reviewed head ${short(reviewed)}; nothing checked or pushed`);
  const r = rewriteOf(repo, o.excludes, reviewed, head);
  if (r.kind !== "rewrite") return held(r.kind === "error" ? r.reason : `${branch} ${short(head)} is not a rewrite of PR #${pr.number}'s reviewed head ${short(reviewed)} with its tree kept; nothing pushed`);
  const series = checkSeries({ repo, wt, branch, id, studioRel: o.studioRel, excludes: o.excludes, head, base: "refs/remotes/origin/master", behaviours: o.behaviours });
  if (!series.ok) return held(`${series.why}; nothing pushed`);
  return {
    ok: false,
    lines: [
      `rewrite: ${branch} ${short(head)} keeps PR #${pr.number}'s reviewed tree ${short(r.tree)} over a new history (${series.built} commit(s) build, ${series.replayed} red(s) replay)`,
      `why: the push replaces PR #${pr.number}'s reviewed history with ${short(head)}; only the Patron runs it, once, leased on ${short(reviewed)}`,
      `${UNCUT}patron: ${patronPush(wt, id, reviewed, head)}`,
    ],
  };
}
