/**
 * packages/cli/src/rewrite.ts — W-462: the `pr` rung's rewrite of a reviewed head. A PR is OPEN on its reviewed head R
 * and the local opus branch now ends at N, where R is not an ancestor of N (the series was rebuilt, as W-408's was) and
 * N's tree is R's tree. The rung never pushes it: it checks, then asks the Patron once, by printing the one leased push
 * only the Patron runs (the harness refuses an agent's force push, 2026-10-29).
 *
 * The perform checks, in order, with nothing pushed and every commit of the opus branch kept: the worktree is clean, on
 * opus/<id> at N; origin's opus/<id> is R now (`ls-remote`); N's tree is R's; Then it holds with the Patron's command: `git push
 * --force-with-lease=refs/heads/opus/<id>:<R> origin <N>:refs/heads/opus/<id>`, which refuses if origin moved off R.
 */
import { sourceTreeHash } from "@bisellium/shim";
import { dirtyHold, git, quoted, remoteTip, type Pr, type StepResult } from "./integrate.js";

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
  const remote = remoteTip(repo, id);
  if (remote.kind !== "tip" || remote.oid !== reviewed)
    return held(`origin's ${branch} is ${remote.kind === "tip" ? short(remote.oid) : remote.kind === "absent" ? "absent" : remote.reason}, not PR #${pr.number}'s reviewed head ${short(reviewed)}; nothing checked or pushed`);
  const r = rewriteOf(repo, o.excludes, reviewed, head);
  if (r.kind !== "rewrite") return held(r.kind === "error" ? r.reason : `${branch} ${short(head)} is not a rewrite of PR #${pr.number}'s reviewed head ${short(reviewed)} with its tree kept; nothing pushed`);
  return {
    ok: false,
    lines: [
      `rewrite: ${branch} ${short(head)} keeps PR #${pr.number}'s reviewed tree ${short(r.tree)} over a new history`,
      `why: the push replaces PR #${pr.number}'s reviewed history with ${short(head)}; only the Patron runs it, once, leased on ${short(reviewed)}`,
      `patron: ${patronPush(wt, id, reviewed, head)}`,
    ],
  };
}
