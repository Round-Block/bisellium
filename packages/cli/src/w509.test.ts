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

test("W-509-b2 behaviour 2: land refuses anything outside its records, before any commit or push, and names the way past", { timeout: 1_800_000 }, () => {
  const w = world("w509-b2", "backlog");
  put(w.repo, "studio/leges/engineering.md", "a rule\n");
  put(w.repo, "studio/briefs/W-901.md", "a brief\n");
  put(w.repo, "packages/cli/src/x.ts", "export const x = 1;\n");
  noPrYet(w);
  const refused = (paths: string[], name: string): void => {
    const o = land(w, paths);
    isRefused(o, new RegExp(`why: refusing: .*${name.replaceAll(".", "\\.").replaceAll("/", "\\/")}.* outside the records land carries`), name);
    assert.match(o.out, /way past: code and rules keep a real PR \(D-181 line 6\)/, ran(`${name}: the way past`, o));
    assert.deepEqual(mutating(w), [], `${name}: nothing is pushed`);
    assert.equal(localHeads(w), "", `${name}: no head is cut`);
  };
  refused(["studio/leges/engineering.md"], "studio/leges/engineering.md");
  refused(["studio/prompts/spec-draft.md"], "studio/prompts/spec-draft.md");
  refused(["studio/bisellium.yml"], "studio/bisellium.yml");
  refused(["studio/briefs/W-901.md"], "studio/briefs/W-901.md");
  refused(["studio/milestones.yml"], "studio/milestones.yml");
  refused(["packages/cli/src/x.ts"], "packages/cli/src/x.ts");
  refused(["packages/cli/src/x.test.ts"], "packages/cli/src/x.test.ts");
  refused(["docs/ARCHITECTURE.md"], "docs/ARCHITECTURE.md");
  refused(["docs/design/dossier/sub/page.html"], "docs/design/dossier/sub/page.html");
  refused(["studio/opera/../../packages/cli/src/x.ts"], "studio/opera/../../packages/cli/src/x.ts");
  refused(["./studio/queue.yml"], "./studio/queue.yml");
  refused(["studio/opera//W-901.md"], "studio/opera//W-901.md");
  refused([join(w.repo, RECORD)], "studio/opera/W-901.md");
  refused(["studio/opera"], "studio/opera");
  refused(["studio/opera/"], "studio/opera/");
  // one bad path among good ones refuses all of it
  put(w.repo, RECORD, RECORD_TEXT);
  refused([RECORD, "packages/cli/src/x.ts"], "packages/cli/src/x.ts");
  // a symlink under a record folder, and a folder named as a path
  symlinkSync("../../README.md", join(w.repo, "studio/opera/link.md"));
  const link = land(w, ["studio/opera/link.md"]);
  isRefused(link, /why: refusing: land carries regular files only, and studio\/opera\/link\.md is not one/, "a symlink");
  assert.equal(localHeads(w), "", "a symlink: no head is cut");
  put(w.repo, "studio/opera/sub/f.md", "in a folder\n");
  const folder = land(w, ["studio/opera/sub"]);
  isRefused(folder, /why: could not read a named path/, "a folder");
  symlinkSync("../..", join(w.repo, "studio/opera/parent"));
  const through = land(w, ["studio/opera/parent/README.md"]);
  isRefused(through, /why: could not read a named path/, "a path through a symlink");
  // off master, and in a linked worktree
  git(w.repo, ["switch", "-q", "-c", "elsewhere"]);
  const off = land(w, [RECORD]);
  isRefused(off, /why: refusing: land runs on master, and HEAD is refs\/heads\/elsewhere/, "off master");
  assert.match(off.out, /way past: git -C .* switch master/, ran("off master: the way past", off));
  git(w.repo, ["switch", "-q", "master"]);
  const linked = join(w.root, "linked");
  git(w.repo, ["worktree", "add", "-q", "--detach", linked]);
  const fromLinked = cli(w, ["land", RECORD, ...TITLE_ARGS, "--repo", linked, "--studio", join(linked, "studio"), ...FAST], linked);
  isRefused(fromLinked, /why: refusing: .* is a linked worktree; land runs from the repository's main checkout/, "a linked worktree");
  assert.deepEqual(mutating(w), [], "nothing was pushed in any of them");
  // a name with a space, a quote and a non-ASCII letter is carried as it is, by that exact name
  const odd = "studio/ci/W-901 a 'quoted' n\u00e4me.log";
  put(w.repo, odd, "a log\n");
  const named = land(w, [odd]);
  assert.match(named.out, /why: pr create failed/, ran("an odd name goes on to the PR", named));
  assert.deepEqual(git(w.repo, ["-c", "core.quotePath=false", "diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/${headOf(named)}`]).split("\n"), [odd], "an odd name is carried by that exact name");
  // every record form it does carry gets past the screen
  for (const p of ["studio/ci/W-901-review-1.log", "studio/decisions/D-999.md", "studio/acta/2026-11-06.md", "studio/queue.yml", "docs/design/dossier/body.html", HANDOFF]) {
    put(w.repo, p, "a record\n");
    const o = land(w, [p]);
    assert.doesNotMatch(o.out, /outside the records land carries/, ran(`${p} is carried`, o));
  }
});

test("W-509-b3 behaviour 3: land checks exactly the tree it carries; a block refuses and --past-check names the way past", { timeout: 1_800_000 }, () => {
  const BAD = '---\nid: "W-902"\nkind: "feature"\nstate: not-a-state\nprobationes: {}\n---\nbroken\n';
  const w = world("w509-b3", "backlog");
  put(w.repo, "studio/opera/W-902.md", BAD);
  noPrYet(w);
  const blocked = land(w, ["studio/opera/W-902.md"]);
  isRefused(blocked, /why: refusing: check blocks the tree this landing carries \([1-9][0-9]* blocking\); nothing pushed/, "a blocked tree");
  assert.match(blocked.out, /^block: .*W-902.*$/m, ran("the finding is printed", blocked));
  assert.match(blocked.out, /way past: fix the finding, or rerun with --past-check/, ran("the way past", blocked));
  assert.deepEqual(mutating(w), [], "nothing is pushed");
  assert.equal(localHeads(w), "", "no head is left by a refusal");
  assert.equal(git(w.repo, ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).length, 1, "the throwaway worktree is gone");
  // the way past: the reason rides the commit, and it goes on to the PR
  const past = land(w, ["studio/opera/W-902.md"], ["--past-check", "the fixture's block is the point"]);
  assert.match(past.out, /^past-check: the fixture's block is the point \(.*\)$/m, ran("the reason is printed", past));
  const head = headOf(past);
  assert.match(git(w.repo, ["log", "-1", "--format=%b", `refs/heads/${head}`]), /Past check: the fixture's block is the point/, "the reason rides the commit");
  assert.equal(originHeads(w), `refs/heads/${head}`, "it was pushed");
  // other work that would block is not judged: only the tree carried
  const c = world("w509-b3-other", "backlog");
  put(c.repo, "studio/opera/W-902.md", BAD);
  put(c.repo, HANDOFF, "# Handoff\n\n## Queue\n\n- refreshed\n");
  noPrYet(c);
  const other = land(c, [HANDOFF]);
  assert.doesNotMatch(other.out, /check blocks/, ran("an unrelated broken record in the checkout does not block", other));
  assert.match(other.out, /why: pr create failed/, ran("it goes on to the PR", other));
  assert.equal(readFileSync(join(c.repo, "studio/opera/W-902.md"), "utf8"), BAD, "the other work stays");
  // the check runs on a branch, as CI's does: on a detached HEAD opus.records_unchanged blocks any tree holding W-096's record
  const owned = world("w509-b3-branch", "backlog");
  put(owned.repo, "studio/opera/W-096.md", '---\nid: "W-096"\ntitle: "fixture"\nkind: "feature"\ncollegium: "engineering"\nstate: backlog\nprobationes: {}\n---\nA record.\n');
  commit(owned.repo, "test: W-096's record");
  git(owned.repo, ["push", "-q", "origin", "master"]);
  put(owned.repo, HANDOFF, "# Handoff\n\n## Queue\n\n- refreshed\n");
  noPrYet(owned);
  const onBranch = land(owned, [HANDOFF]);
  assert.doesNotMatch(onBranch.out, /check blocks/, ran("W-096's record does not block on the throwaway branch", onBranch));
  assert.equal(git(owned.repo, ["for-each-ref", "--format=%(refname)", "refs/heads/records/*-check"]), "", "the throwaway branch is gone");
  // a check of the carried tree that passes pushes with no reason asked
  assert.equal(git(c.repo, ["log", "-1", "--format=%b", `refs/heads/${headOf(other)}`]).includes("Past check"), false, "no reason is recorded when none was given");
});

test("W-509-b4 behaviour 4: a code-owned path opens the PR, says the Patron must review it, and merges only once approved", { timeout: 1_800_000 }, () => {
  const DECISION = "studio/decisions/D-999.md";
  const DECISION_TEXT = '---\nid: "D-999"\ntitle: "a fixture ruling"\nat: 2026-11-06T00:00:00Z\nprovenance: stated\nby: patron\nkill_when: "when the fixture goes"\n---\n\nA ruling.\n';
  const w = world("w509-b4", "backlog", { github: true });
  put(w.repo, ".github/CODEOWNERS", "/studio/decisions/ @edckt\n");
  commit(w.repo, "test: code owners");
  git(w.repo, ["push", "-q", "origin", "master"]);
  put(w.repo, DECISION, DECISION_TEXT);
  noPrYet(w);
  const head = headOf(land(w, [DECISION]));
  landing(w, head, { stuck: true, decision: { stdout: { reviewDecision: "REVIEW_REQUIRED" } } });
  const master = git(w.repo, ["rev-parse", "refs/heads/master"]);
  const waits = land(w, [DECISION]);
  isRefused(waits, /^state=PATRON_REVIEW$/m, "the wait");
  assert.match(waits.out, /^code-owned: studio\/decisions\/D-999\.md$/m, ran("the path is named", waits));
  assert.match(waits.out, /^review-requested: edckt$/m, ran("their review is requested", waits));
  assert.match(waits.out, /^patron: PR #901 touches code-owned paths, so the Patron must review it; .*$/m, ran("it says so plainly", waits));
  assert.ok(mutating(w).includes("gh pr create"), "the PR is opened");
  assert.equal(mutating(w).includes("gh pr merge --squash --auto"), false, "no merge is requested");
  assert.equal(git(w.repo, ["rev-parse", "refs/heads/master"]), master, "master does not move");
  assert.equal(read(w, DECISION), DECISION_TEXT, "the edit stays in the tree");
  // an unreadable decision reads as not approved
  landing(w, head, { stuck: true, decision: { exit: 1, stderr: "stub: down" } });
  const down = land(w, [DECISION]);
  isRefused(down, /^state=PATRON_REVIEW$/m, "an unreadable decision");
  assert.match(down.out, /^review-decision: unreadable .*$/m, ran("it says it could not read it", down));
  assert.equal(mutating(w).includes("gh pr merge --squash --auto"), false, "no merge on an unreadable decision");
  // once approved, the same command merges
  landing(w, head, { decision: { stdout: { reviewDecision: "APPROVED" } } });
  const approved = land(w, [DECISION]);
  assert.equal(approved.status, 0, ran("approved: it lands", approved));
  assert.match(approved.out, /^state=MERGED$/m, ran("approved: merged", approved));
  assert.ok(mutating(w).includes("gh pr merge --squash --auto"), "approved: the merge is requested");
  // a path no owner holds never waits
  const plain = world("w509-b4-plain", "backlog");
  put(plain.repo, ".github/CODEOWNERS", "/studio/decisions/ @edckt\n");
  commit(plain.repo, "test: code owners");
  git(plain.repo, ["push", "-q", "origin", "master"]);
  put(plain.repo, HANDOFF, "# Handoff\n\n## Queue\n\n- refreshed\n");
  noPrYet(plain);
  const plainHead = headOf(land(plain, [HANDOFF]));
  landing(plain, plainHead);
  const plainLanded = land(plain, [HANDOFF]);
  assert.equal(plainLanded.status, 0, ran("an unowned path lands with no review", plainLanded));
  assert.doesNotMatch(plainLanded.out, /PATRON_REVIEW/, ran("no wait", plainLanded));
});

test("W-509-b5 behaviour 5: a merge that times out reports the queue entry, and says when it reads stuck", { timeout: 1_800_000 }, () => {
  const entry = (state: string, rollup: string | null): Reply => ({
    stdout: { data: { repository: { pullRequest: { isInMergeQueue: true, mergeQueueEntry: { state, enqueuedAt: "2026-11-05T12:00:00Z", position: 1, headCommit: rollup === null ? null : { statusCheckRollup: { state: rollup } } } } } } },
  });
  const timedOut = (tag: string, graphql: Reply): Out => {
    const { w, head } = pushedHead(tag, edits, [HANDOFF, RECORD]);
    landing(w, head, { rules: QUEUE_RULES, stuck: true, graphql });
    return land(w, [HANDOFF, RECORD]);
  };
  const stuck = timedOut("w509-b5-stuck", entry("AWAITING_CHECKS", "SUCCESS"));
  isRefused(stuck, /^state=QUEUE_TIMEOUT$/m, "the timeout");
  assert.match(stuck.out, /^queue-entry: PR #901 AWAITING_CHECKS since 2026-11-05T12:00:00Z, position 1, checks SUCCESS$/m, ran("the entry", stuck));
  assert.match(stuck.out, /^stuck: the entry is waiting on checks that have all passed; way past: use Remove from queue on PR #901's page, then rerun this command, which adds it again$/m, ran("it reads stuck", stuck));
  assert.match(stuck.out, /^run: bisellium land .*$/m, ran("the rerun is named", stuck));
  const running = timedOut("w509-b5-running", entry("AWAITING_CHECKS", "PENDING"));
  assert.match(running.out, /^queue-entry: .* checks PENDING$/m, ran("a check still running", running));
  assert.doesNotMatch(running.out, /^stuck: .*$/m, ran("a check still running is not stuck", running));
  const unread = timedOut("w509-b5-norollup", entry("AWAITING_CHECKS", null));
  assert.match(unread.out, /^queue-entry: .* checks unread$/m, ran("no rollup", unread));
  assert.doesNotMatch(unread.out, /^stuck: .*$/m, ran("no rollup is not stuck", unread));
  const none = timedOut("w509-b5-none", { stdout: { data: { repository: { pullRequest: { isInMergeQueue: true, mergeQueueEntry: null } } } } });
  assert.match(none.out, /^queue-entry: none; PR #901 is not in the merge queue$/m, ran("no entry", none));
  const gone = timedOut("w509-b5-unread", { stdout: { data: { repository: { pullRequest: { isInMergeQueue: true } } } } });
  assert.match(gone.out, /^queue-entry: unreadable \(gh api graphql returned no data\.repository\.pullRequest\.mergeQueueEntry\)$/m, ran("an unreadable entry", gone));
  isRefused(gone, /^state=QUEUE_TIMEOUT$/m, "an unreadable entry keeps the timeout");
});

