/**
 * W-509: `bisellium land`, the verb that carries named records to master (studio/briefs/W-509.md). Every row spawns the CLI
 * with next-world's stub `gh` and git shim against a temporary repository with a bare origin; the fixture studio is
 * next-world's. Select one row with --test-name-pattern='^W-509-b<k>\s'.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FAST, type Json, type Out, PR_NUMBER, QUEUE_RULES, type Reply, SLUG, type World, asRule, cand, cli, commit, ghCalls, ghMerges, git, greens, mutating, put, ran, scratch, viewOf, world } from "./next-world.test.js";

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

const OWNER_FIELDS = "headRefOid,reviews,reviewRequests,autoMergeRequest";
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
  /** The reply to land's read of the code owners' reviews; by default no review, no request, not armed. */
  review?: Reply;
  /** GitHub's merge state of the open PR. */
  mss?: string;
  /** The code-scanning reply. */
  alerts?: Reply;
  /** Arming the queue fails. */
  armFails?: boolean;
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
  const open = cand(w, { state: "OPEN", head, oid, ...(o.mss === undefined ? {} : { mss: o.mss }) });
  const done = cand(w, { state: "MERGED", head, oid, merge: m });
  setScenario(w, [
    { match: ["repo", "view"], replies: [{ stdout: { nameWithOwner: SLUG } }] },
    { match: ["pr", "list"], replies: [{ stdout: [] }], alts: [{ ifExists: merged, replies: [{ stdout: [done] }] }, { ifExists: created, replies: [{ stdout: [open] }] }] },
    { match: ["pr", "view", String(PR_NUMBER), "--json", "reviewDecision"], replies: [{ stdout: { reviewDecision: "" } }] },
    { match: ["pr", "view", String(PR_NUMBER), "--json", OWNER_FIELDS], replies: [o.review ?? { stdout: { autoMergeRequest: null, headRefOid: oid, reviewRequests: [], reviews: [] } }] },
    { match: ["pr", "view", String(PR_NUMBER), "--json", "title"], replies: [{ stdout: { title: "chore(studio): land fixture records" } }] },
    { match: ["pr", "view"], replies: [{ stdout: viewOf(open) }], alts: [{ ifExists: merged, replies: [{ stdout: viewOf(done) }] }] },
    { match: ["pr", "checks"], ...asRule({ stdout: greens() }) },
    { match: ["pr", "edit"], replies: [{ stdout: "" }] },
    { match: ["api", `repos/${SLUG}/rules/branches/master?per_page=100`], replies: [{ stdout: o.rules ?? [] }] },
    { match: ["api", "graphql"], replies: [o.graphql ?? { stdout: { data: { repository: { pullRequest: { isInMergeQueue: true, mergeQueueEntry: null } } } } }] },
    { match: ["api", `repos/${SLUG}/code-scanning/alerts?state=open&per_page=100`], replies: [o.alerts ?? { stdout: [] }] },
    { match: ["api"], replies: [{ stdout: [] }] },
    { match: ["pr", "merge"], replies: o.armFails === true ? [{ exit: 1, stderr: "stub: the arm failed" }] : o.stuck === true ? [{ stdout: "" }] : [{ stdout: "", touch: merged }] },
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

// W-523: GitHub's real replies for master's ruleset (require_code_owner_review true, required_approving_review_count 0), read on
// 2026-11-06 with `gh pr view <n> --json headRefOid,reviews,reviewRequests,autoMergeRequest`; `--json reviewDecision` on #1062 read "".
const REAL_1062_HEAD = "c2a0902c0ce404d8199f21afeba82ae67ee317c2";
const REAL_1062 = String.raw`{"autoMergeRequest":null,"headRefOid":"c2a0902c0ce404d8199f21afeba82ae67ee317c2","reviewRequests":[],"reviews":[{"id":"PRR_kwDOUgF3Pc8AAAABWc5r0Q","author":{"login":"edckt"},"authorAssociation":"MEMBER","body":"","submittedAt":"2026-11-06T14:37:14Z","includesCreatedEdit":false,"reactionGroups":[],"state":"APPROVED","commit":{"oid":"c2a0902c0ce404d8199f21afeba82ae67ee317c2"}},{"id":"PRR_kwDOUgF3Pc8AAAABWc708Q","author":{"login":"edckt"},"authorAssociation":"MEMBER","body":"","submittedAt":"2026-11-06T14:39:33Z","includesCreatedEdit":false,"reactionGroups":[],"state":"APPROVED","commit":{"oid":"c2a0902c0ce404d8199f21afeba82ae67ee317c2"}}]}`;
const REAL_923 = String.raw`{"autoMergeRequest":null,"headRefOid":"c9ec2579527bd74a6fa078538e2301ae3ca483d6","reviewRequests":[],"reviews":[{"id":"PRR_kwDOUgF3Pc8AAAABVQ3VQA","author":{"login":"edckt"},"authorAssociation":"MEMBER","body":"","submittedAt":"2026-10-31T08:10:14Z","includesCreatedEdit":false,"reactionGroups":[],"state":"APPROVED","commit":{"oid":"36ec7b822d73f8f057dae2f84a04bcd5bf98b93a"}},{"id":"PRR_kwDOUgF3Pc8AAAABVRByzw","author":{"login":"edckt"},"authorAssociation":"MEMBER","body":"","submittedAt":"2026-10-31T09:08:31Z","includesCreatedEdit":false,"reactionGroups":[],"state":"DISMISSED","commit":{"oid":"36ec7b822d73f8f057dae2f84a04bcd5bf98b93a"}},{"id":"PRR_kwDOUgF3Pc8AAAABVRHvaw","author":{"login":"edckt"},"authorAssociation":"MEMBER","body":"","submittedAt":"2026-10-31T09:38:34Z","includesCreatedEdit":false,"reactionGroups":[],"state":"APPROVED","commit":{"oid":"c9ec2579527bd74a6fa078538e2301ae3ca483d6"}}]}`;
const OLD_OID = "1".repeat(40);
const DECISION_PATH = "studio/decisions/D-999.md";
const DECISION_BODY = '---\nid: "D-999"\ntitle: "a fixture ruling"\nat: 2026-11-06T00:00:00Z\nprovenance: stated\nby: patron\nkill_when: "when the fixture goes"\n---\n\nA ruling.\n';
/** #1062's real reply with its head and its approvals on `oid`. */
const real1062 = (oid: string): Json => JSON.parse(REAL_1062.replaceAll(REAL_1062_HEAD, oid)) as Json;
const reviewOf = (login: string, state: string, oid: string, at: string): Json => ({ author: { login }, authorAssociation: "MEMBER", body: "", submittedAt: at, state, commit: { oid } });
const replyOf = (head: string, reviews: Json[], extra: Json = {}): Reply => ({ stdout: { autoMergeRequest: null, headRefOid: head, reviewRequests: [], reviews, ...extra } });
const ARMED: Json = { autoMergeRequest: { enabledAt: "2026-11-06T14:59:21Z", enabledBy: { login: "bisellium-agent" }, mergeMethod: "SQUASH" } };
const REQUESTED: Json = { reviewRequests: [{ __typename: "User", login: "edckt" }] };
const noticePath = (w: World): string => join(w.repo, ".git", "bisellium", "notice", String(PR_NUMBER));
const takeNotice = (w: World): boolean => {
  const held = existsSync(noticePath(w));
  rmSync(noticePath(w), { force: true });
  return held;
};
const asks = (w: World): number => ghCalls(w).filter((c) => c[0] === "pr" && c[1] === "edit").length;
/** A world whose decision is code-owned by `owner`, with land's head pushed and no PR yet. */
function ownedHead(tag: string, owner = "@edckt"): { w: World; head: string; oid: string } {
  const w = world(tag, "backlog", { github: true });
  put(w.repo, ".github/CODEOWNERS", `/studio/decisions/ ${owner}\n`);
  commit(w.repo, "test: code owners");
  git(w.repo, ["push", "-q", "origin", "master"]);
  put(w.repo, DECISION_PATH, DECISION_BODY);
  noPrYet(w);
  const head = headOf(land(w, [DECISION_PATH]));
  return { w, head, oid: git(w.repo, ["rev-parse", `refs/heads/${head}`]) };
}

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
  // --repo, --studio and --now are validated too: each invalid value exits 2 before a commit or push
  const bad = (flags: string[], why: RegExp, row: string): void => {
    const before = mutating(w).length;
    const o = cli(w, ["land", RECORD, ...TITLE_ARGS, ...flags], w.repo);
    assert.equal(o.status, 2, ran(`${row}: exit 2`, o));
    assert.match(o.err, why, ran(`${row}: the reason`, o));
    assert.equal(localHeads(w), "", `${row}: no head was cut`);
    assert.equal(mutating(w).length, before, `${row}: nothing pushed`);
  };
  bad(["--repo", join(w.root, "no-such-repo"), "--studio", w.studio], /is not a git repository/, "a repo that is not one");
  bad(["--repo", w.repo, "--studio", join(w.root, "no-such-studio")], /land: /, "a studio that is not one");
  bad(["--repo", w.repo, "--studio", w.studio, "--now", "not-a-date"], /--now must be an ISO date/, "a clock that is not a date");
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
  landing(w, head, { stuck: true });
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
  landing(w, head, { stuck: true, review: { exit: 1, stderr: "stub: down" } });
  const down = land(w, [DECISION]);
  isRefused(down, /^state=PATRON_REVIEW$/m, "an unreadable decision");
  assert.match(down.out, /^owner-review: unreadable .*$/m, ran("it says it could not read it", down));
  assert.equal(mutating(w).includes("gh pr merge --squash --auto"), false, "no merge on an unreadable decision");
  // once approved, the same command merges
  const headOid = git(w.repo, ["rev-parse", `refs/heads/${head}`]);
  landing(w, head, { review: { stdout: { autoMergeRequest: null, headRefOid: headOid, reviewRequests: [], reviews: [{ author: { login: "edckt" }, state: "APPROVED", submittedAt: "2026-11-06T14:37:14Z", commit: { oid: headOid } }] } } });
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

test("W-509-b6 behaviour 6: landing never loses an edit: a differing copy, a staged copy or incoming work stops master with the edit kept", { timeout: 1_800_000 }, () => {
  /** A merge commit that also carries `extra`: another PR's change, reaching local master with this one. */
  const mergeWith = (w: World, head: string, extra: Record<string, string>, also: (dir: string) => void = () => undefined): string => {
    const dir = join(w.root, "merge-tree");
    git(w.repo, ["worktree", "add", "-q", "--detach", dir, `refs/heads/${head}`]);
    for (const [rel, text] of Object.entries(extra)) put(dir, rel, text);
    also(dir);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "squash, with another change"]);
    const oid = git(dir, ["rev-parse", "HEAD"]);
    git(w.repo, ["worktree", "remove", "--force", dir]);
    return oid;
  };
  const stops = (o: Out, why: RegExp, row: string): void => {
    isRefused(o, /^state=MERGED_NOT_FETCHED$/m, row);
    assert.match(o.out, why, ran(`${row}: the reason`, o));
  };

  // the merged copy differs from the working copy: the copy is kept, nothing is staged, master stays
  const a = pushedHead("w509-b6-differs", edits, [HANDOFF, RECORD]);
  const aMaster = git(a.w.repo, ["rev-parse", "refs/heads/master"]);
  landing(a.w, a.head, { merge: mergeWith(a.w, a.head, { [HANDOFF]: "# Handoff\n\n## Queue\n\n- refreshed\n\nand someone else's line\n" }) });
  stops(land(a.w, [HANDOFF, RECORD]), /docs\/SESSION-HANDOFF\.md differs from the merged commit .*your copy is kept/, "a differing copy");
  assert.equal(read(a.w, HANDOFF), "# Handoff\n\n## Queue\n\n- refreshed\n", "the copy is intact");
  assert.equal(git(a.w.repo, ["diff", "--cached", "--name-only"]), "", "no path is staged, RECORD included");
  assert.equal(git(a.w.repo, ["rev-parse", "refs/heads/master"]), aMaster, "master stays");

  // a staged copy that is neither HEAD's nor the merged one is kept
  const b = pushedHead("w509-b6-staged", edits, [HANDOFF, RECORD]);
  landing(b.w, b.head);
  put(b.w.repo, HANDOFF, "# Handoff\n\n## Queue\n\n- a staged draft\n");
  git(b.w.repo, ["add", "--", HANDOFF]);
  put(b.w.repo, HANDOFF, "# Handoff\n\n## Queue\n\n- refreshed\n");
  stops(land(b.w, [HANDOFF, RECORD]), /docs\/SESSION-HANDOFF\.md has staged content that is neither HEAD's nor the merged commit's; it is kept/, "a staged copy");
  assert.equal(git(b.w.repo, ["show", `:${HANDOFF}`]), "# Handoff\n\n## Queue\n\n- a staged draft", "the staged draft is intact");

  // a staged mode change with the merged content: the index entry differs from the merge commit, so nothing is staged over it
  const bm = pushedHead("w509-b6-staged-mode", edits, [HANDOFF, RECORD]);
  const bmMaster = git(bm.w.repo, ["rev-parse", "refs/heads/master"]);
  landing(bm.w, bm.head);
  chmodSync(join(bm.w.repo, HANDOFF), 0o755);
  git(bm.w.repo, ["add", "--", HANDOFF]);
  chmodSync(join(bm.w.repo, HANDOFF), 0o644);
  const bmStops = land(bm.w, [HANDOFF, RECORD]);
  stops(bmStops, /docs\/SESSION-HANDOFF\.md has staged content that is neither HEAD's nor the merged commit's/, "a staged mode change");
  assert.equal(git(bm.w.repo, ["ls-files", "-s", "--", HANDOFF]).split(" ")[0], "100755", "a staged mode change: nothing is staged, the entry keeps its mode");
  assert.equal(git(bm.w.repo, ["diff", "--cached", "--name-only"]), HANDOFF, "a staged mode change: only the entry the Patron staged");
  assert.equal(git(bm.w.repo, ["rev-parse", "refs/heads/master"]), bmMaster, "a staged mode change: master stays");
  git(bm.w.repo, ["reset", "-q", "--", HANDOFF]);
  git(bm.w.repo, ["update-index", "--chmod=-x", "--", HANDOFF]);

  // a merge that changes an own path's mode lands under either core.fileMode: the index takes the merge commit's entry, and the copy stays as it was
  for (const honored of ["true", "false"]) {
    const row = `a merged mode change, core.fileMode=${honored}`;
    const mm = pushedHead(`w509-b6-merged-mode-${honored}`, edits, [HANDOFF, RECORD]);
    const mmMerge = mergeWith(mm.w, mm.head, {}, (dir) => chmodSync(join(dir, HANDOFF), 0o755));
    landing(mm.w, mm.head, { merge: mmMerge });
    git(mm.w.repo, ["config", "core.fileMode", honored]);
    const mmLands = land(mm.w, [HANDOFF, RECORD]);
    assert.equal(mmLands.status, 0, ran(`${row}: it lands`, mmLands));
    assert.equal(git(mm.w.repo, ["rev-parse", "refs/heads/master"]), mmMerge, `${row}: master is the merge commit`);
    assert.equal(git(mm.w.repo, ["ls-files", "-s", "--", HANDOFF]).split(" ")[0], "100755", `${row}: the index holds the merge commit's mode`);
    assert.equal(statSync(join(mm.w.repo, HANDOFF)).mode & 0o111, 0, `${row}: the copy stays as it was`);
    assert.equal(status(mm.w), honored === "true" ? `M ${HANDOFF}` : "", `${row}: git status shows the difference only where the bit is honored`);
  }

  // a copy chmod-ed after the landing, under core.fileMode=false (the same head): judged on content, it lands, and the chmod stays. With the bit honored the
  // chmod is a new tree entry and so a new head, the landing of that change; a mode the copy gains during the wait is the merged-mode row's form
  const cm = pushedHead("w509-b6-copy-mode", edits, [HANDOFF, RECORD]);
  const cmMerge = landing(cm.w, cm.head);
  git(cm.w.repo, ["config", "core.fileMode", "false"]);
  chmodSync(join(cm.w.repo, HANDOFF), 0o755);
  const cmLands = land(cm.w, [HANDOFF, RECORD]);
  assert.equal(cmLands.status, 0, ran("a chmod-ed copy: it lands", cmLands));
  assert.equal(git(cm.w.repo, ["rev-parse", "refs/heads/master"]), cmMerge, "a chmod-ed copy: master is the merge commit");
  assert.equal(git(cm.w.repo, ["ls-files", "-s", "--", HANDOFF]).split(" ")[0], "100644", "a chmod-ed copy: the index holds the merge commit's mode");
  assert.notEqual(statSync(join(cm.w.repo, HANDOFF)).mode & 0o100, 0, "a chmod-ed copy: the copy stays as it was");

  // a merge commit that holds an own path as anything but a regular file holds, even with the same bytes
  const mk = pushedHead("w509-b6-merged-link", edits, [HANDOFF, RECORD]);
  const mkMaster = git(mk.w.repo, ["rev-parse", "refs/heads/master"]);
  const mkBytes = read(mk.w, HANDOFF);
  landing(mk.w, mk.head, {
    merge: mergeWith(mk.w, mk.head, {}, (dir) => {
      rmSync(join(dir, HANDOFF));
      symlinkSync(mkBytes, join(dir, HANDOFF));
    }),
  });
  stops(land(mk.w, [HANDOFF, RECORD]), /docs\/SESSION-HANDOFF\.md is not a regular file in the merged commit/, "a merged symlink");
  assert.equal(git(mk.w.repo, ["diff", "--cached", "--name-only"]), "", "a merged symlink: nothing is staged");
  assert.equal(git(mk.w.repo, ["rev-parse", "refs/heads/master"]), mkMaster, "a merged symlink: master stays");

  // an unfinished merge or cherry-pick, or an unmerged entry on any path: git's fast-forward would refuse, so the hold comes before anything is staged
  const markerPath = (repo: string, name: string): string => join(repo, git(repo, ["rev-parse", "--git-path", name]));
  const malformed = (repo: string, name: string): void => writeFileSync(markerPath(repo, name), "not a commit id\n");
  const unfinished: readonly [string, (repo: string, oid: string) => void, (repo: string) => void][] = [
    ["an unfinished merge", (repo, oid) => writeFileSync(markerPath(repo, "MERGE_HEAD"), `${oid}\n`), (repo) => rmSync(markerPath(repo, "MERGE_HEAD"), { force: true })],
    ["an unfinished cherry-pick", (repo, oid) => writeFileSync(markerPath(repo, "CHERRY_PICK_HEAD"), `${oid}\n`), (repo) => rmSync(markerPath(repo, "CHERRY_PICK_HEAD"), { force: true })],
    ["a malformed MERGE_HEAD", (repo) => malformed(repo, "MERGE_HEAD"), (repo) => rmSync(markerPath(repo, "MERGE_HEAD"), { force: true })],
    ["a malformed CHERRY_PICK_HEAD", (repo) => malformed(repo, "CHERRY_PICK_HEAD"), (repo) => rmSync(markerPath(repo, "CHERRY_PICK_HEAD"), { force: true })],
    [
      "an unmerged entry",
      (repo) => {
        const blob = git(repo, ["rev-parse", "HEAD:README.md"]);
        execFileSync("git", ["update-index", "--index-info"], { cwd: repo, input: `0 ${"0".repeat(40)}\tREADME.md\n100644 ${blob} 1\tREADME.md\n100644 ${blob} 2\tREADME.md\n100644 ${blob} 3\tREADME.md\n` });
      },
      (repo) => void git(repo, ["reset", "-q", "--", "README.md"]),
    ],
  ];
  for (const [row, begin, clear] of unfinished) {
    const u = pushedHead(`w509-b6-${row.replaceAll(" ", "-")}`, edits, [HANDOFF, RECORD]);
    const uMaster = git(u.w.repo, ["rev-parse", "refs/heads/master"]);
    landing(u.w, u.head);
    begin(u.w.repo, uMaster);
    stops(land(u.w, [HANDOFF, RECORD]), /a merge or cherry-pick is unfinished in this checkout/, row);
    assert.equal(git(u.w.repo, ["ls-files", "-s", "--", HANDOFF]).split(" ")[0], "100644", `${row}: the entry is as it was`);
    assert.equal(git(u.w.repo, ["rev-parse", "refs/heads/master"]), uMaster, `${row}: master stays`);
    assert.equal(git(u.w.repo, ["diff", "--cached", "--name-only", "--", HANDOFF, RECORD]), "", `${row}: nothing is staged`);
    clear(u.w.repo);
    const uDone = land(u.w, [HANDOFF, RECORD]);
    assert.equal(uDone.status, 0, ran(`${row}: cleared, the same command finishes`, uDone));
  }

  // a name with a space, a quote and a non-ASCII letter settles by that exact name
  const oddName = "studio/ci/W-901 a 'quoted' n\u00e4me.log";
  const on = pushedHead("w509-b6-odd-name", (x) => put(x.repo, oddName, "a log\n"), [oddName]);
  landing(on.w, on.head);
  const onLands = land(on.w, [oddName]);
  assert.equal(onLands.status, 0, ran("an odd name: it lands", onLands));
  assert.equal(status(on.w), "", "an odd name: the checkout ends clean");

  // other work on a path the merge brings: named, untouched, and the same command finishes once it is cleared
  const c = pushedHead("w509-b6-incoming", (x) => {
    edits(x);
    put(x.repo, "README.md", "other work, on a path the merge brings\n");
  }, [HANDOFF, RECORD]);
  const cMerge = mergeWith(c.w, c.head, { "README.md": "another PR's readme\n" });
  landing(c.w, c.head, { merge: cMerge });
  const incoming = land(c.w, [HANDOFF, RECORD]);
  stops(incoming, /has uncommitted tracked changes/, "incoming work");
  assert.match(incoming.out, /^dirty: M README\.md$/m, ran("it names the path", incoming));
  assert.equal(read(c.w, "README.md"), "other work, on a path the merge brings\n", "the other work is intact");
  assert.equal(git(c.w.repo, ["diff", "--cached", "--name-only"]), "", "nothing is staged");
  git(c.w.repo, ["checkout", "--", "README.md"]);
  const finished = land(c.w, [HANDOFF, RECORD]);
  assert.equal(finished.status, 0, ran("cleared: the same command finishes", finished));
  assert.equal(git(c.w.repo, ["rev-parse", "refs/heads/master"]), cMerge, "cleared: master moved");
  assert.equal(status(c.w), "", "cleared: the checkout is clean");
  assert.equal(localHeads(c.w), "", "cleared: the head is gone");

  // an untracked or ignored file on a path the merge brings: the hold comes before anything is staged, and both are kept
  for (const [name, ignoring] of [["w509-b6-untracked", false], ["w509-b6-ignored", true]] as const) {
    const g = pushedHead(name, edits, [HANDOFF, RECORD]);
    const gMaster = git(g.w.repo, ["rev-parse", "refs/heads/master"]);
    landing(g.w, g.head, { merge: mergeWith(g.w, g.head, { "incoming.txt": "another PR's file\n" }) });
    put(g.w.repo, "incoming.txt", "a local file, not tracked\n");
    if (ignoring) appendFileSync(join(g.w.repo, ".git", "info", "exclude"), "incoming.txt\n");
    const kind = ignoring ? "an ignored" : "an untracked";
    stops(land(g.w, [HANDOFF, RECORD]), /would overwrite an untracked or ignored entry.*incoming\.txt/, `${kind} incoming path`);
    assert.equal(git(g.w.repo, ["diff", "--cached", "--name-only"]), "", `${kind} incoming path: nothing is staged`);
    assert.equal(read(g.w, "incoming.txt"), "a local file, not tracked\n", `${kind} incoming path: the file is intact`);
    assert.equal(read(g.w, HANDOFF), "# Handoff\n\n## Queue\n\n- refreshed\n", `${kind} incoming path: the handoff copy is intact`);
    assert.equal(git(g.w.repo, ["rev-parse", "refs/heads/master"]), gMaster, `${kind} incoming path: master stays`);
  }

  // a head that gained a commit outside the records is refused before the push
  const d = pushedHead("w509-b6-tampered", edits, [HANDOFF, RECORD]);
  const dir = join(d.w.root, "tamper");
  git(d.w.repo, ["worktree", "add", "-q", dir, d.head]);
  put(dir, "source.txt", "changed on the head\n");
  commit(dir, "feat: not a record");
  git(d.w.repo, ["worktree", "remove", "--force", dir]);
  noPrYet(d.w);
  const tampered = land(d.w, [HANDOFF, RECORD]);
  isRefused(tampered, /why: refusing: the existing records\/land-[0-9a-f]{12} changes source\.txt, outside the records land carries; nothing pushed/, "a tampered head");
  assert.match(tampered.out, /way past: git -C .* branch -D records\/land-/, ran("a tampered head: the way past", tampered));
  assert.deepEqual(mutating(d.w), [], "a tampered head: nothing pushed");

  // the same contents are the same head when master has moved, and a deleted record is carried as a deletion
  const e = pushedHead("w509-b6-moved", edits, [HANDOFF, RECORD]);
  git(e.w.repo, ["commit", "-q", "--allow-empty", "-m", "master moves"]);
  noPrYet(e.w);
  assert.equal(headOf(land(e.w, [HANDOFF, RECORD])), e.head, "master moved: the same head");
  const f = world("w509-b6-deleted", "backlog");
  put(f.repo, "studio/ci/W-900-old.log", "an old log\n");
  commit(f.repo, "test: a log");
  git(f.repo, ["push", "-q", "origin", "master"]);
  rmSync(join(f.repo, "studio/ci/W-900-old.log"));
  noPrYet(f);
  const fFirst = land(f, ["studio/ci/W-900-old.log"]);
  const fHead = headOf(fFirst);
  landing(f, fHead);
  const fLanded = land(f, ["studio/ci/W-900-old.log"]);
  assert.equal(fLanded.status, 0, ran("a deleted record lands", fLanded));
  assert.equal(status(f), "", "a deleted record: the checkout is clean");
});

test("W-523-b1 behaviour 1: the approval is the code owner's latest review on the PR's current head, not GitHub's reviewDecision", { timeout: 1_800_000 }, () => {
  // the reply GitHub really gave: #1062, empty reviewDecision, two APPROVED reviews, on the queue's rules, in one run
  const real = ownedHead("w523-b1-real");
  const master = git(real.w.repo, ["rev-parse", "refs/heads/master"]);
  landing(real.w, real.head, { rules: QUEUE_RULES, review: { stdout: real1062(real.oid) } });
  const landed = land(real.w, [DECISION_PATH]);
  assert.equal(landed.status, 0, ran("#1062's reply: it lands", landed));
  assert.match(landed.out, /^state=MERGED$/m, ran("#1062's reply: merged", landed));
  assert.equal(ghCalls(real.w).some((c) => c.includes("reviewDecision")), false, ran("#1062's reply: reviewDecision is not read", landed));
  assert.equal(asks(real.w), 0, ran("#1062's reply: no review is requested", landed));
  assert.equal(takeNotice(real.w), false, ran("#1062's reply: no notice", landed));
  assert.notEqual(git(real.w.repo, ["rev-parse", "refs/heads/master"]), master, "#1062's reply: local master moves");
  const { w, head, oid } = ownedHead("w523-b1");
  const merged = (name: string, review: Reply): void => {
    landing(w, head, { stuck: true, review });
    const o = land(w, [DECISION_PATH]);
    assert.doesNotMatch(o.out, /state=PATRON_REVIEW/, ran(`${name}: no wait`, o));
    assert.ok(mutating(w).includes("gh pr merge --squash --auto"), ran(`${name}: the merge is requested`, o));
    assert.equal(asks(w), 0, ran(`${name}: no review is requested`, o));
    assert.equal(takeNotice(w), false, ran(`${name}: no notice`, o));
  };
  const waits = (name: string, review: Reply, line: RegExp): void => {
    landing(w, head, { stuck: true, review });
    const o = land(w, [DECISION_PATH]);
    isRefused(o, /^state=PATRON_REVIEW$/m, name);
    assert.match(o.out, line, ran(`${name}: says why`, o));
    assert.equal(ghMerges(w).length, 0, ran(`${name}: no merge is requested`, o));
    takeNotice(w);
  };
  const at = (n: number): string => `2026-11-06T14:0${n}:00Z`;
  const old1062 = { ...real1062(OLD_OID), headRefOid: oid };
  const real923 = JSON.parse(REAL_923) as { reviews: Json[] };
  const dismissed = real923.reviews.slice(0, 2).map((r) => ({ ...r, commit: { oid: OLD_OID } }));
  waits("an approval on an old head (#1062's reviews)", { stdout: old1062 }, new RegExp(`^owner-review: edckt APPROVED on 111111111111; PR #901's head is ${oid.slice(0, 12)}$`, "m"));
  waits("a dismissed latest over an old approval (#923's reviews)", replyOf(oid, dismissed), /^owner-review: edckt DISMISSED on 111111111111; /m);
  waits("a dismissal on this head", replyOf(oid, [reviewOf("edckt", "DISMISSED", oid, at(1))]), /^owner-review: edckt DISMISSED on /m);
  waits("changes asked after an approval", replyOf(oid, [reviewOf("edckt", "APPROVED", oid, at(1)), reviewOf("edckt", "CHANGES_REQUESTED", oid, at(2))]), /^owner-review: edckt CHANGES_REQUESTED on /m);
  waits("changes asked after an approval, with the reply out of order", replyOf(oid, [reviewOf("edckt", "CHANGES_REQUESTED", oid, at(2)), reviewOf("edckt", "APPROVED", oid, at(1))]), /^owner-review: edckt CHANGES_REQUESTED on /m);
  waits("another login's approval", replyOf(oid, [reviewOf("someone", "APPROVED", oid, at(1))]), /^owner-review: edckt holds no approval; /m);
  waits("a comment alone", replyOf(oid, [reviewOf("edckt", "COMMENTED", oid, at(1))]), /^owner-review: edckt holds no approval; /m);
  waits("no review", replyOf(oid, []), /^owner-review: edckt holds no approval; /m);
  waits("a commit oid left empty, as latestReviews has it", replyOf(oid, [reviewOf("edckt", "APPROVED", "", at(1))]), /^owner-review: unreadable \(gh pr view returned a review by edckt with no state, commit or time\)/m);
  waits("a reply for another head", replyOf(OLD_OID, []), /^owner-review: unreadable \(gh pr view did not read PR #901's head /m);
  waits("a reply with no reviews", { stdout: { headRefOid: oid, reviewRequests: [] } }, /^owner-review: unreadable \(gh pr view returned no reviews or reviewRequests array\)/m);
  merged("an approval after asked-for changes", replyOf(oid, [reviewOf("edckt", "CHANGES_REQUESTED", oid, at(1)), reviewOf("edckt", "APPROVED", oid, at(2))]));
  merged("a comment after an approval", replyOf(oid, [reviewOf("edckt", "APPROVED", oid, at(1)), reviewOf("edckt", "COMMENTED", oid, at(2))]));
  merged("a login in another case", replyOf(oid, [reviewOf("EdCkT", "APPROVED", oid, at(1))]));
  // an owner that is not a login is never read as approved
  const team = ownedHead("w523-b1-team", "@some-org/some-team");
  landing(team.w, team.head, { stuck: true, review: replyOf(team.oid, [reviewOf("edckt", "APPROVED", team.oid, at(1))]) });
  const teamRun = land(team.w, [DECISION_PATH]);
  isRefused(teamRun, /^owner-review: @some-org\/some-team is not a login, /m, "a team owner");
});

test("W-523-b2 behaviour 2: land arms the queue when the PR opens, so approval alone sends it in", { timeout: 1_800_000 }, () => {
  const { w, head, oid } = ownedHead("w523-b2");
  landing(w, head, { rules: QUEUE_RULES, stuck: true });
  const master = git(w.repo, ["rev-parse", "refs/heads/master"]);
  const first = land(w, [DECISION_PATH]);
  isRefused(first, /^state=PATRON_REVIEW$/m, "armed");
  assert.match(first.out, /^queue: armed; PR #901 enters the merge queue on its code owner's approval, with no rerun$/m, ran("it says it is armed", first));
  const merges = ghMerges(w);
  assert.equal(merges.length, 1, ran("armed once", first));
  for (const flag of ["--squash", "--auto", "--match-head-commit", oid]) assert.ok(merges[0]!.includes(flag), ran(`the arm carries ${flag}`, first));
  assert.equal(ghCalls(w).some((c) => c[0] === "pr" && c[1] === "checks"), false, ran("arming does not wait on checks", first));
  assert.equal(asks(w), 1, ran("their review is requested", first));
  assert.match(first.out, /^run: bisellium land .* \(once it has merged, to bring the merge to the local master; the merge itself needs no rerun\)$/m, ran("the rerun's purpose is named", first));
  assert.equal(git(w.repo, ["rev-parse", "refs/heads/master"]), master, "master does not move");
  assert.equal(read(w, DECISION_PATH), DECISION_BODY, "the edit stays in the tree");
  takeNotice(w);
  // GitHub merges it on the approval, with nothing run here; the same command then brings it to the local master
  const m = landing(w, head, { rules: QUEUE_RULES });
  writeFileSync(join(w.root, `merged-${head.replaceAll("/", "-")}.flag`), "");
  const after = land(w, [DECISION_PATH]);
  assert.equal(after.status, 0, ran("the rerun after the merge: exit 0", after));
  assert.match(after.out, /^state=MERGED$/m, ran("the rerun after the merge: merged", after));
  assert.equal(git(w.repo, ["rev-parse", "refs/heads/master"]), m, "the rerun after the merge: local master is the merge commit");
  assert.equal(ghMerges(w).length, 0, ran("the rerun after the merge: no merge is requested", after));
  assert.equal(asks(w), 0, ran("the rerun after the merge: no review is requested", after));
  assert.equal(takeNotice(w), false, ran("the rerun after the merge: no notice", after));
  assert.equal(localHeads(w), "", "the rerun after the merge: the head is gone");
  // each way it is not armed says so, and a rerun after approval still merges
  const notArmed = (name: string, o: Gh, line: RegExp): void => {
    const x = ownedHead(`w523-b2-${name.replaceAll(" ", "-")}`);
    landing(x.w, x.head, { stuck: true, ...o });
    const run = land(x.w, [DECISION_PATH]);
    isRefused(run, /^state=PATRON_REVIEW$/m, name);
    assert.match(run.out, line, ran(`${name}: says so`, run));
    assert.match(run.out, /^run: bisellium land .* \(after their approval; it merges then\)$/m, ran(`${name}: the rerun is named`, run));
    if (o.armFails !== true) assert.equal(ghMerges(x.w).length, 0, ran(`${name}: no arm`, run));
  };
  notArmed("no queue", {}, /^queue: not armed; master's merge queue did not read as on/m);
  notArmed("a conflict", { rules: QUEUE_RULES, mss: "DIRTY" }, /^queue: not armed; PR #901 conflicts with master$/m);
  notArmed("an open alert", { rules: QUEUE_RULES, alerts: { stdout: [{ number: 1 }] } }, /^queue: not armed; code scanning stopped it$/m);
  notArmed("an unreadable alert list", { rules: QUEUE_RULES, alerts: { exit: 1, stderr: "stub: down" } }, /^queue: not armed; code scanning stopped it$/m);
  notArmed("a failed arm", { rules: QUEUE_RULES, armFails: true }, /^queue: not armed; gh pr merge --squash --auto failed: stub: the arm failed$/m);
});

test("W-523-b3 behaviour 3: land asks once: no second request, notice or arm on a rerun, and none once approved", { timeout: 1_800_000 }, () => {
  const { w, head, oid } = ownedHead("w523-b3");
  const at = "2026-11-06T14:00:00Z";
  landing(w, head, { rules: QUEUE_RULES, stuck: true });
  const first = land(w, [DECISION_PATH]);
  isRefused(first, /^state=PATRON_REVIEW$/m, "the first run");
  assert.equal(asks(w), 1, ran("the first run asks", first));
  assert.equal(takeNotice(w), true, ran("the first run leaves a notice", first));
  const quiet = (name: string, review: Reply): void => {
    landing(w, head, { rules: QUEUE_RULES, stuck: true, review });
    const o = land(w, [DECISION_PATH]);
    isRefused(o, /^state=PATRON_REVIEW$/m, name);
    assert.equal(asks(w), 0, ran(`${name}: no second request`, o));
    assert.equal(takeNotice(w), false, ran(`${name}: no second notice`, o));
  };
  quiet("a request still pending, armed", replyOf(oid, [], { ...ARMED, ...REQUESTED }));
  assert.equal(ghMerges(w).length, 0, "an armed PR is not armed again");
  quiet("changes asked on this head, armed", replyOf(oid, [reviewOf("edckt", "CHANGES_REQUESTED", oid, at)], ARMED));
  quiet("a comment on this head, armed", replyOf(oid, [reviewOf("edckt", "COMMENTED", oid, at)], ARMED));
  quiet("a request pending, not armed: it arms", replyOf(oid, [], REQUESTED));
  assert.equal(ghMerges(w).length, 1, "a PR not armed is armed");
  // a head the owner has not seen, with no request pending, asks again
  landing(w, head, { rules: QUEUE_RULES, stuck: true, review: replyOf(oid, [reviewOf("edckt", "APPROVED", OLD_OID, at)], ARMED) });
  const moved = land(w, [DECISION_PATH]);
  isRefused(moved, /^state=PATRON_REVIEW$/m, "a moved head");
  assert.equal(asks(w), 1, ran("a moved head: their review is requested", moved));
  assert.equal(takeNotice(w), true, ran("a moved head: a notice", moved));
  // an unreadable read may be an approval: nothing is asked or armed, and it says so
  landing(w, head, { rules: QUEUE_RULES, stuck: true, review: { exit: 1, stderr: "stub: down" } });
  const down = land(w, [DECISION_PATH]);
  isRefused(down, /^owner-review: unreadable \(.*\); read as not approved, so nothing is requested or armed$/m, "an unreadable read");
  assert.equal(asks(w), 0, ran("an unreadable read: no request", down));
  assert.equal(takeNotice(w), false, ran("an unreadable read: no notice", down));
  assert.equal(ghMerges(w).length, 0, ran("an unreadable read: no arm", down));
  // approved and armed, the same command waits for the merge, asking nothing
  const reply = real1062(oid);
  landing(w, head, { rules: QUEUE_RULES, review: { stdout: { ...reply, ...ARMED } } });
  const done = land(w, [DECISION_PATH]);
  assert.equal(done.status, 0, ran("approved and armed: it lands", done));
  assert.equal(asks(w), 0, ran("approved and armed: no request", done));
  assert.equal(takeNotice(w), false, ran("approved and armed: no notice", done));
});
