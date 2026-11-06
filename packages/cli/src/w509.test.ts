/**
 * W-509: `bisellium land`, the verb that carries named records to master (studio/briefs/W-509.md). Every row spawns the CLI
 * with next-world's stub `gh` and git shim against a temporary repository with a bare origin; the fixture studio is
 * next-world's. Select one row with --test-name-pattern='^W-509-b<k>\s'.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FAST, type Json, type Out, PR_NUMBER, QUEUE_RULES, type Reply, SLUG, type World, asRule, cand, cli, commit, git, greens, mutating, put, ran, scratch, viewOf, world } from "./next-world.test.js";

const HANDOFF = "docs/SESSION-HANDOFF.md";
const RECORD = "studio/opera/W-901.md";
const RECORD_TEXT = '---\nid: "W-901"\ntitle: "fixture record"\nkind: "feature"\ncollegium: "engineering"\nstate: backlog\nprobationes: {}\n---\nA record to land.\n';
const TITLE_ARGS = ["--title", "chore(studio): land fixture records", "--sella", "producer"];

const land = (w: World, paths: string[], extra: string[] = []): Out => cli(w, ["land", ...paths, ...TITLE_ARGS, ...extra, "--repo", w.repo, "--studio", w.studio, ...FAST], w.repo);
const headOf = (o: Out): string => {
  const m = /^land: (records\/land-[0-9a-f]{12})(?: held| landed)?$/m.exec(o.out);
  assert.ok(m !== null, ran("land names its head", o));
  return m[1]!;
};
const localHeads = (w: World): string => git(w.repo, ["for-each-ref", "--format=%(refname)", "refs/heads/records/"]);
const originHeads = (w: World): string => git(w.origin, ["for-each-ref", "--format=%(refname)", "refs/heads/records/"]);
const status = (w: World): string => git(w.repo, ["status", "--porcelain", "--untracked-files=all"]);
const read = (w: World, rel: string): string => readFileSync(join(w.repo, rel), "utf8");
const isRefused = (o: Out, why: RegExp, row: string): void => {
  assert.equal(o.status, 1, ran(`${row}: exit 1`, o));
  assert.match(o.out, why, ran(`${row}: the reason`, o));
};

type GhRule = { match: string[]; replies: Reply[]; alts?: { ifExists?: string; replies: Reply[] }[] };
function setScenario(w: World, rules: GhRule[]): void {
  writeFileSync(w.scn, JSON.stringify({ rules }));
  writeFileSync(`${w.scn}.state`, "{}");
  writeFileSync(w.log, "");
}
/** No PR yet, and creating one fails: land stops after its push, having named its head. */
function noPrYet(w: World): void {
  setScenario(w, [
    { match: ["repo", "view"], replies: [{ stdout: { nameWithOwner: SLUG } }] },
    { match: ["pr", "list"], replies: [{ stdout: [] }] },
    { match: ["pr", "create"], replies: [{ exit: 1, stderr: "stub: not yet" }] },
  ]);
}
interface Gh {
  rules?: Json[];
  /** Replies to the graphql read, gate and report alike. */
  graphql?: Reply;
  decision?: Reply;
  /** The merge never lands: the PR stays OPEN and CLEAN, and origin's master does not move. */
  stuck?: boolean;
  /** The merge commit is built by the caller (another change arrived with it). */
  merge?: string;
}
/** The gh world of landing `head`: a PR that is created, merges on request and then reads MERGED, the merge commit on origin. */
function landing(w: World, head: string, o: Gh = {}): string {
  const created = join(w.root, `created-${head.replaceAll("/", "-")}.flag`);
  const merged = join(w.root, `merged-${head.replaceAll("/", "-")}.flag`);
  const oid = git(w.repo, ["rev-parse", `refs/heads/${head}`]);
  const m = o.merge ?? git(w.repo, ["commit-tree", `${head}^{tree}`, "-p", "refs/heads/master", "-m", `squash ${head} (#${PR_NUMBER})`]);
  if (o.stuck !== true) git(w.repo, ["push", "-q", "origin", `${m}:refs/heads/master`]);
  const open = cand(w, { state: "OPEN", head, oid });
  const done = cand(w, { state: "MERGED", head, oid, merge: m });
  setScenario(w, [
    { match: ["repo", "view"], replies: [{ stdout: { nameWithOwner: SLUG } }] },
    { match: ["pr", "list"], replies: [{ stdout: [] }], alts: [{ ifExists: merged, replies: [{ stdout: [done] }] }, { ifExists: created, replies: [{ stdout: [open] }] }] },
    { match: ["pr", "view", String(PR_NUMBER), "--json", "reviewDecision"], replies: [o.decision ?? { stdout: { reviewDecision: null } }] },
    { match: ["pr", "view", String(PR_NUMBER), "--json", "title"], replies: [{ stdout: { title: "chore(studio): land fixture records" } }] },
    { match: ["pr", "view"], replies: [{ stdout: viewOf(open) }], alts: [{ ifExists: merged, replies: [{ stdout: viewOf(done) }] }] },
    { match: ["pr", "checks"], ...asRule({ stdout: greens() }) },
    { match: ["pr", "edit"], replies: [{ stdout: "" }] },
    { match: ["api", `repos/${SLUG}/rules/branches/master?per_page=100`], replies: [{ stdout: o.rules ?? [] }] },
    { match: ["api", "graphql"], replies: [o.graphql ?? { stdout: { data: { repository: { pullRequest: { isInMergeQueue: true, mergeQueueEntry: null } } } } }] },
    { match: ["api"], replies: [{ stdout: [] }] },
    { match: ["pr", "merge"], replies: o.stuck === true ? [{ stdout: "" }] : [{ stdout: "", touch: merged }] },
    { match: ["pr", "create"], replies: [{ stdout: `https://github.com/${SLUG}/pull/${PR_NUMBER}\n`, touch: created }] },
    { match: ["pr", "update-branch"], replies: [{ stdout: "" }] },
  ]);
  return m;
}
/** A fixture with edits in the main checkout, and land's first run: it stops at the PR, having pushed and named its head. */
function pushedHead(tag: string, edit: (w: World) => void, paths: string[], extra: string[] = []): { w: World; head: string; first: Out } {
  const w = world(tag, "backlog");
  edit(w);
  noPrYet(w);
  const first = land(w, paths, extra);
  return { w, head: headOf(first), first };
}
const edits = (w: World): void => {
  put(w.repo, HANDOFF, "# Handoff\n\n## Queue\n\n- refreshed\n");
  put(w.repo, RECORD, RECORD_TEXT);
};

test("W-509-b1 behaviour 1: land carries the named records to master and leaves other work where it is", { timeout: 1_800_000 }, () => {
  const bodyFile = join(scratch("w509-b1-body"), "body.md");
  writeFileSync(bodyFile, "Why these records land.\n");
  const { w, head, first } = pushedHead("w509-b1", (x) => {
    edits(x);
    put(x.repo, "README.md", "other work, unrelated\n");
    put(x.repo, "scratch.txt", "untracked other work\n");
  }, [HANDOFF, RECORD], ["--body-file", bodyFile]);
  assert.equal(first.status, 1, ran("the first run stops at the failed PR create", first));
  assert.match(first.out, /why: pr create failed/, ran("the reason names the PR create", first));
  // the checkout is untouched by the cut: same branch, nothing staged, every edit still in the working tree
  assert.equal(git(w.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "the checkout stays on master");
  assert.equal(git(w.repo, ["diff", "--cached", "--name-only"]), "", "nothing is staged by the cut");
  assert.equal(read(w, RECORD), RECORD_TEXT, "the record stays in the working tree");
  assert.equal(read(w, "README.md"), "other work, unrelated\n", "other work stays");
  // the head holds exactly the named paths, on HEAD
  assert.deepEqual(git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/${head}`]).split("\n").sort(), [HANDOFF, RECORD], "the head changes the named paths only");
  assert.equal(git(w.repo, ["rev-parse", `refs/heads/${head}^`]), git(w.repo, ["rev-parse", "HEAD"]), "the head sits on HEAD");
  assert.equal(git(w.repo, ["log", "-1", "--format=%s", `refs/heads/${head}`]), "chore(studio): land fixture records", "the subject is the title");
  assert.match(git(w.repo, ["log", "-1", "--format=%b", `refs/heads/${head}`]), /Co-Authored-By: producer \(bisellium land\) <noreply@anthropic\.com>/, "the trailer names the sella");
  assert.match(git(w.repo, ["log", "-1", "--format=%b", `refs/heads/${head}`]), /Why these records land\./, "the body file rides the commit");
  assert.equal(originHeads(w), `refs/heads/${head}`, "the head reached origin");
  // the same command again resumes: the same head, and it lands
  const merge = landing(w, head);
  const landed = land(w, [HANDOFF, RECORD], ["--body-file", bodyFile]);
  assert.equal(landed.status, 0, ran("the rerun lands", landed));
  assert.equal(headOf(landed), head, "the same paths and contents are the same head");
  assert.match(landed.out, /^state=MERGED$/m, ran("it says merged", landed));
  assert.equal(git(w.repo, ["rev-parse", "refs/heads/master"]), merge, "local master is the merge commit");
  assert.deepEqual(status(w).split("\n").map((l) => l.trim()).sort(), ["?? scratch.txt", "M README.md"], "only the other work is left");
  assert.equal(read(w, RECORD), RECORD_TEXT, "the record is in the tree, committed");
  assert.equal(read(w, "README.md"), "other work, unrelated\n", "the other edit is intact");
  assert.equal(localHeads(w), "", "the head is gone locally");
  assert.equal(originHeads(w), "", "the head is gone on origin");
  // a third run has nothing to do
  isRefused(land(w, [HANDOFF, RECORD]), /why: nothing to land/, "nothing left");
  // its flags: each usage error exits 2 and names the flag
  const usage = (args: string[], why: RegExp, row: string): void => {
    const o = cli(w, ["land", ...args, "--repo", w.repo, "--studio", w.studio], w.repo);
    assert.equal(o.status, 2, ran(`${row}: exit 2`, o));
    assert.match(o.err, why, ran(`${row}: the reason`, o));
  };
  usage([...TITLE_ARGS], /name at least one path/, "no path");
  usage([RECORD, "--sella", "producer"], /--title is required/, "no title");
  usage([RECORD, "--title", "two\nlines", "--sella", "producer"], /--title is required/, "a two-line title");
  usage([RECORD, "--title", "t"], /--sella is required/, "no sella");
  usage([RECORD, "--title", "t", "--sella", "no-such-seat"], /--sella no-such-seat is not a sella/, "an unknown sella");
  usage([RECORD, ...TITLE_ARGS, "--past-check", " "], /--past-check needs a reason/, "an empty reason");
  usage([RECORD, ...TITLE_ARGS, "--body-file", w.root], /--body-file must be a regular file/, "a folder as the body");
  usage([RECORD, ...TITLE_ARGS, "--poll-ms", "0"], /--poll-ms takes 1 through 60000/, "a poll of zero");
  usage([RECORD, ...TITLE_ARGS, "--no-such-flag"], /unknown flag/, "an unknown flag");
});





