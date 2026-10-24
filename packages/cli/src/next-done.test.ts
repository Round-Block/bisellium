/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sourceTreeHash } from "@bisellium/shim";
import { runDone } from "@bisellium/commands/lifecycle.js";
import { parseFrontMatter } from "@bisellium/adapter-native";
import { Alt, BRANCH, FAST, HANDOFF_DONE, Json, MIN_CHECKS, OPUS, Out, PR_NUMBER, QUEUE_RULES, REAL_GIT, Reply, SETUP_ENV, SLOT_MATCH, SLUG, SlotName, SlotValue, T, World, advanceOrigin, asRule, branchExists, briefText, cand, check, cli, commit, editRecord, eventsOf, expectHeld, expectStep, failingGit, ghCalls, ghMerges, git, gitCalls, gitYesNo, greens, landMerge, markDone, mergedList, modeLine, mutating, next, openList, outLines, parse, performMerge, performPr, prArgs, put, queueWorld, ran, recordOf, recordText, remoteBranchExists, reviewed, scenario, certificateRun, checkRunsOf, scratch, sourceTree, stagedPaths, touchHandoff, unmatched, verb, viewOf, world, writeReceipt, writeTranscript } from "./next-world.test.js";


// ---------------------------------------------------------------------------
// W-123: `done` refuses unless the opus's merge is in the fetched trunk
// ---------------------------------------------------------------------------
const WHY_LINE = `${OPUS}: done needs the PR from ${BRANCH} merged and its merge commit in the local master; run: bisellium next ${OPUS}`;
/** The row is refused: exit 1, the two exact stderr lines, and neither the record nor the event log moved. */
function expectRefused(w: World, run: () => Out, reason: { is: string } | { startsWith: string }, row: string, studio = w.wtStudio): Out {
  const recordIn = (): string => readFileSync(join(studio, "opera", `${OPUS}.md`), "utf8");
  const recordBefore = recordIn();
  const eventsBefore = eventsOf(studio);
  const o = run();
  const lines = o.err.split("\n");
  assert.equal(o.status, 1, ran(`${row}: exit`, o));
  const first = lines[0] ?? "";
  if ("is" in reason) assert.equal(first, `${OPUS}: done refused: ${reason.is}`, ran(`${row}: first stderr line`, o));
  else assert.ok(first.startsWith(`${OPUS}: done refused: ${reason.startsWith}`), ran(`${row}: first stderr line`, o));
  assert.equal(lines[1], WHY_LINE, ran(`${row}: second stderr line`, o));
  assert.equal(recordIn(), recordBefore, `${row}: the record's bytes are unchanged`);
  assert.equal(eventsOf(studio), eventsBefore, `${row}: the event log is unchanged`);
  return o;
}
/** The handoff flow: the main checkout on a branch cut from master with no upstream. */
function onHandoffBranch(w: World): void {
  git(w.repo, ["switch", "-q", "--no-track", "-c", "chore/w123-done", "master"]);
}

test("W-123 behaviour 1: done and close refuse an opus whose merge is not in the local master, and accept one whose merge is", { timeout: 1_800_000 }, () => {
  const doneArgs = (w: World): string[] => ["done", OPUS, "--sella", "producer", "--studio", w.wtStudio, "--now", T.done];
  const reviewWorld = (tag: string, merge?: (w: World) => SlotValue): World => {
    const w = world(tag, "review", { prRequired: true });
    if (merge !== undefined) scenario(w, { list: merge(w) });
    return w;
  };

  const empty = reviewWorld("w123-b1-empty");
  expectRefused(empty, () => cli(empty, doneArgs(empty), empty.wt), { is: `no MERGED PR from ${BRANCH} to master` }, "an empty list");

  const open = reviewWorld("w123-b1-open", (w) => openList(w));
  expectRefused(open, () => cli(open, doneArgs(open), open.wt), { is: `PR #${PR_NUMBER} from ${BRANCH} is OPEN, not MERGED` }, "an OPEN candidate");

  const closed = reviewWorld("w123-b1-closed", (w) => ({ stdout: [cand(w, { state: "CLOSED" })] }));
  expectRefused(closed, () => cli(closed, doneArgs(closed), closed.wt), { is: `no MERGED PR from ${BRANCH} to master` }, "a CLOSED-only candidate");

  const failing = reviewWorld("w123-b1-gh-fails", () => ({ exit: 1, stderr: "boom\n" }));
  expectRefused(failing, () => cli(failing, doneArgs(failing), failing.wt), { startsWith: "gh pr list exited 1" }, "gh pr list exits 1");

  const behind = world("w123-b1-behind", "merge", { prRequired: true, fetched: false });
  scenario(behind, { list: mergedList(behind) });
  const refusedBehind = expectRefused(behind, () => cli(behind, doneArgs(behind), behind.wt), { startsWith: "merge commit " }, "MERGED but not fetched");
  assert.ok((refusedBehind.err.split("\n")[0] ?? "").includes(behind.mergeOid!.slice(0, 12)), ran("the reason names the merge commit's first 12 characters", refusedBehind));

  const closing = reviewWorld("w123-b1-close");
  const refusedClose = expectRefused(closing, () => cli(closing, ["close", OPUS, "--studio", closing.wtStudio, "--repo", closing.wt], closing.wt), { is: `no MERGED PR from ${BRANCH} to master` }, "close with an empty list");
  assert.ok(refusedClose.err.split("\n").includes("done failed (exit 1)"), ran("close still reports done failed (exit 1)", refusedClose));

  // accepted: merged and fetched, branch and worktree gone, from the main checkout on a branch cut from master
  const merged = world("w123-b1-merged", "cleanup", { prRequired: true });
  scenario(merged, { list: mergedList(merged) });
  onHandoffBranch(merged);
  const accepted = cli(merged, ["done", OPUS, "--sella", "producer", "--studio", merged.studio, "--now", T.done], merged.repo);
  assert.equal(accepted.status, 0, ran("done accepts a merged and fetched opus", accepted));
  assert.match(recordOf(merged), /state: "?done/, "the record reads done");

  const closed2 = world("w123-b1-merged-close", "cleanup", { prRequired: true });
  scenario(closed2, { list: mergedList(closed2) });
  onHandoffBranch(closed2);
  const acceptedClose = cli(closed2, ["close", OPUS, "--studio", closed2.studio, "--repo", closed2.repo], closed2.repo);
  assert.equal(acceptedClose.status, 0, ran("close accepts a merged and fetched opus", acceptedClose));
  assert.match(recordOf(closed2), /state: "?done/, "close leaves the record done");
});

test("W-123 behaviour 2: the guard fails closed, and stays silent where no PR is required", { timeout: 1_800_000 }, () => {
  const doneArgs = (studio: string): string[] => [OPUS, "--sella", "producer", "--studio", studio, "--now", T.done];
  /** In-process runDone with stderr captured, the way lifecycle.test.ts reads it. */
  const inProcess = (studio: string, opts: Parameters<typeof runDone>[1] = {}): Out => {
    const errors: string[] = [];
    const logs: string[] = [];
    const realError = console.error;
    const realLog = console.log;
    console.error = (...a: unknown[]): void => void errors.push(a.join(" "));
    console.log = (...a: unknown[]): void => void logs.push(a.join(" "));
    try {
      const r = runDone(doneArgs(studio), opts);
      return parse(r.exitCode, logs.join("\n"), errors.join("\n"));
    } finally {
      console.error = realError;
      console.log = realLog;
    }
  };

  // no reader supplied: refused, never let through
  const noReader = world("w123-b2-no-reader", "cleanup", { prRequired: true });
  scenario(noReader, { list: mergedList(noReader) });
  expectRefused(noReader, () => inProcess(noReader.studio), { is: "no merge reader was supplied" }, "no reader", noReader.studio);

  // no git work tree: refused, and the reader (gh) is never reached
  const bare = world("w123-b2-no-git", "cleanup", { prRequired: true });
  scenario(bare, { list: mergedList(bare) });
  const outside = join(scratch("w123-b2-outside"), "studio");
  cpSync(bare.studio, outside, { recursive: true });
  expectRefused(bare, () => cli(bare, ["done", ...doneArgs(outside)], outside), { is: `${outside} is not inside a git work tree` }, "outside any git work tree", outside);
  assert.equal(ghCalls(bare).filter((a) => a[0] === "pr" && a[1] === "list").length, 0, "no gh pr list call");

  // control: where no PR is required the reader is never called
  const control = world("w123-b2-control", "cleanup");
  let reads = 0;
  const counted = inProcess(control.studio, {
    mergeRefusal: () => {
      reads++;
      return "always refuses";
    },
  });
  assert.equal(counted.status, 0, ran("no pr.required: done exits 0", counted));
  assert.equal(reads, 0, "no pr.required: the reader was called 0 times");
  assert.match(recordOf(control), /state: "?done/, "no pr.required: the record reads done");
});

// round 1 (censor): the refusal reads the opus's identity from fresh, fail-closed reads
const doneFrom = (w: World, env: Record<string, string | undefined> = {}): Out => cli(w, ["done", OPUS, "--sella", "producer", "--studio", w.studio, "--now", T.done], w.repo, env);
/** A merged-and-fetched world on the handoff branch, whose gh list is `list`. */
function mergedWorld(tag: string, list: (w: World) => SlotValue): World {
  const w = world(tag, "cleanup", { prRequired: true });
  scenario(w, { list: list(w) });
  onHandoffBranch(w);
  return w;
}

test("W-123 round-1 fix 1a: a newer CLOSED PR for the head outranks an older MERGED one", { timeout: 1_800_000 }, () => {
  const w = mergedWorld("w123-r1-newest", (x) => ({ stdout: [cand(x, { state: "CLOSED", number: PR_NUMBER + 1 }), cand(x, { state: "MERGED" })] }));
  expectRefused(w, () => doneFrom(w), { is: `no MERGED PR from ${BRANCH} to master` }, "newest PR is CLOSED", w.studio);
});

test("W-123 round-1 fix 1b: a head force-pushed after the merge is refused when the local branch is gone, and a matching remote head is accepted", { timeout: 1_800_000 }, () => {
  const stale = mergedWorld("w123-r1-force", (x) => mergedList(x));
  const side = join(scratch("w123-r1-force-side"), "c");
  git(dirname(side), ["clone", "-q", stale.origin, side]);
  git(side, ["switch", "-q", "-c", BRANCH, "origin/master"]);
  put(side, "after-merge.txt", "force-pushed after the merge\n");
  commit(side, "feat: a head the merged PR never had");
  git(side, ["push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`]);
  expectRefused(stale, () => doneFrom(stale), { startsWith: `PR #${PR_NUMBER} merged head ${stale.headOid!.slice(0, 12)} is not the remote ${BRANCH} tip` }, "remote head differs from the merged head", stale.studio);

  const same = mergedWorld("w123-r1-same", (x) => mergedList(x));
  git(same.repo, ["push", "-q", "origin", `${same.headOid!}:refs/heads/${BRANCH}`]);
  const accepted = doneFrom(same);
  assert.equal(accepted.status, 0, ran("a remote head equal to the merged head is accepted", accepted));
});

test("W-123 round-1 fix 2a: an unreadable local branch ref is an error, never an absent branch", { timeout: 1_800_000 }, () => {
  const w = mergedWorld("w123-r1-tip", (x) => mergedList(x));
  const wrapper = join(scratch("w123-r1-tip-git"), "git-real");
  writeFileSync(wrapper, `#!/bin/sh\ncase "$*" in *"rev-parse --verify -q refs/heads/${BRANCH}") echo "fatal: simulated failure" >&2; exit 3;; esac\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  expectRefused(w, () => doneFrom(w, { GIT_STUB_REAL: wrapper }), { startsWith: `cannot read refs/heads/${BRANCH}` }, "rev-parse exits 3", w.studio);
});

test("W-123 round-1 fix 2b: an all-zero headRefOid is refused outright", { timeout: 1_800_000 }, () => {
  const w = mergedWorld("w123-r1-zero", (x) => mergedList(x, { oid: "0".repeat(40) }));
  expectRefused(w, () => doneFrom(w), { startsWith: "headRefOid is not a 40-hex commit id" }, "an all-zero headRefOid", w.studio);
});

// ---------------------------------------------------------------------------
// W-141 behaviour 1: a Patron path stops `next` before the main checkout moves
// ---------------------------------------------------------------------------
const CENSOR = ".claude/agents/censor.md";
/** The four things a refusal must leave byte-identical: HEAD and master, the index, the status and the Patron file. */
const frozen = (w: World): string =>
  [git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["ls-files", "-s"]), git(w.repo, ["status", "--porcelain"]), readFileSync(join(w.repo, CENSOR), "utf8")].join("\n--\n");

test("W-141-b1 behaviour 1: a Patron path stops next before the main checkout moves, and names the Patron's one command", { timeout: 1_800_000 }, () => {
  // merge: the reviewed merge commit changes a Patron path
  const w = reviewed(
    "w141-b1-merge",
    { patron: true },
    (x) => {
      put(x.wt, CENSOR, "censor v2\n");
      commit(x.wt, `feat(${OPUS}): censor change`);
      writeReceipt(x, "current");
    },
    true,
  );
  const m = landMerge(w, false);
  scenario(w, { list: mergedList(w, { merge: m }) });
  expectStep(next(w, [OPUS]), "merge", "named", "the world sits at merge");
  const before = frozen(w);
  const held = performMerge(w);
  assert.equal(frozen(w), before, ran("merge: nothing is mutated (master unmoved, index, status, censor.md bytes)", held));
  expectHeld(held, "merge: held");
  assert.equal(held.status, 1, ran("merge: exit 1", held));
  const lines = outLines(held);
  const why = lines.findIndex((l) => l === `why: refusing: incoming paths belong to the Patron (${CENSOR}); the main checkout is untouched`);
  assert.notEqual(why, -1, ran("merge: the why line names the Patron path", held));
  assert.equal(lines[why + 1], `patron: git -C ${w.repo} merge --ff-only ${m}`, ran("merge: the patron line follows the why line", held));
  assert.equal(gitCalls(w).filter((a) => a[0] === "merge").length, 0, "merge: no git merge call");
  // the Patron runs that exact line, and next moves on
  const [bin, ...args] = lines[why + 1]!.slice("patron: ".length).split(" ");
  assert.equal(bin, "git");
  git(w.root, args);
  expectStep(next(w, [OPUS]), "cleanup", "named", "after the Patron's command next derives cleanup");

  // dirty: a tracked edit to a Patron path holds the branch rung and the done rung, and prints the Patron's checkout line
  const dirtyRow = (row: string, o: Out, w2: World, was: string, file = CENSOR, quoted = file): void => {
    expectHeld(o, row);
    assert.equal(frozen(w2), was, ran(`${row}: nothing is mutated`, o));
    const ls = outLines(o);
    const at = ls.indexOf("why: refusing: the working tree has tracked changes");
    assert.notEqual(at, -1, ran(`${row}: the why line`, o));
    assert.ok(ls.indexOf(`dirty: M ${file}`) > at, ran(`${row}: the dirty line follows the why line`, o));
    assert.ok(ls.indexOf(`patron: git -C ${w2.repo} checkout -- ${quoted}`) > at, ran(`${row}: the patron checkout line`, o));
  };
  const b = world("w141-b1-branch", "spec", { patron: true });
  appendFileSync(join(b.repo, CENSOR), "edit\n");
  const bBefore = frozen(b);
  dirtyRow("branch", next(b, [OPUS, "--perform", "--expect", "branch"]), b, bBefore);
  assert.equal(branchExists(b), false, "branch: no branch was cut");
  const d = world("w141-b1-done", "cleanup", { patron: true });
  scenario(d, { list: mergedList(d) });
  appendFileSync(join(d.repo, CENSOR), "edit\n");
  const dBefore = frozen(d);
  dirtyRow("done", next(d, [OPUS, "--perform", "--expect", "done"]), d, dBefore);
  assert.equal(branchExists(d, `chore/done-${OPUS}`), false, "done: no chore branch was made");

  // a path with a character outside [A-Za-z0-9/._-] is single-quoted
  const q = world("w141-b1-quote", "spec", { patron: true });
  appendFileSync(join(q.repo, ".claude/my notes.md"), "edit\n");
  dirtyRow("quoted", next(q, [OPUS, "--perform", "--expect", "branch"]), q, frozen(q), ".claude/my notes.md", "'.claude/my notes.md'");
});

// ---------------------------------------------------------------------------
// W-141 behaviour 2: done composes with verify
// ---------------------------------------------------------------------------
test("W-141-b2 behaviour 2: done composes with verify: the rung names verify first, then commits the record and verify's certificates", { timeout: 1_800_000 }, () => {
  const w = world("w141-b2", "cleanup", { automated: true });
  scenario(w, { list: mergedList(w) });
  const chore = `chore/done-${OPUS}`;
  const verify = `bisellium verify ${OPUS} --studio studio --repo .`;

  // before verify: the rung names the verify command, and a perform holds with it on a why: line
  const named = next(w, [OPUS]);
  expectStep(named, "done", "named", "no certificate: done is named");
  assert.equal(named.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("W-259: the command is the done perform", named));
  const refused = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(refused, "perform before verify");
  assert.ok(outLines(refused).some((l) => l.startsWith("why: ") && l.includes(verify)), ran("the why line carries the verify command", refused));
  assert.equal(branchExists(w, chore), false, "no chore/done-<id> is created");

  // run the named command, then edit the handoff
  const [bin, ...args] = verify.split(" ");
  assert.equal(bin, "bisellium");
  verb(w.repo, args);
  appendFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), "- checkpoint line\n");
  assert.match(git(w.repo, ["status", "--porcelain"]), /studio\/opera\/W-900\.md/, "verify wrote the record");
  const ready = next(w, [OPUS]);
  expectStep(ready, "done", "named", "after verify: done is named again");
  assert.equal(ready.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("the command is the perform", ready));

  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  assert.equal(done.status, 0, ran("perform exits 0", done));
  expectStep(done, "done", "performed", "done is performed over verify's outputs");
  const tip = git(w.repo, ["rev-parse", `refs/heads/${chore}`]);
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", tip]).split("\n").sort();
  assert.equal(paths.length, 3, `the commit changes three paths: ${paths.join(", ")}`);
  assert.equal(paths[0], "docs/SESSION-HANDOFF.md");
  assert.match(paths[1]!, /^studio\/ci\/W-900-tests-[0-9a-f]+\.log$/);
  assert.equal(paths[2], `studio/opera/${OPUS}.md`);
  assert.equal(git(w.repo, ["rev-list", "--count", `master..${chore}`]), "1", "one commit");
  assert.equal(git(w.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "HEAD is back on master");
  const status = git(w.repo, ["status", "--porcelain"]);
  for (const p of paths) assert.ok(!status.includes(p), `git status lists none of the three paths (${p}): ${status}`);
});

// ---------------------------------------------------------------------------
// W-141 behaviour 3: the checkpoint rides the done commit
// ---------------------------------------------------------------------------
test("W-141-b3 behaviour 3: the checkpoint rides the done commit", { timeout: 1_800_000 }, () => {
  // a done commit that changed a heading-less handoff reads complete
  const c = world("w141-b3-complete", "cleanup");
  markDone(c, false, "# Handoff\n\n- the producer's note, under no heading at all\n");
  scenario(c, { list: mergedList(c) });
  const complete = next(c, [OPUS]);
  assert.equal(complete.first, `next: ${OPUS} checkpoint complete`, ran("the done commit carried the handoff: complete, with no heading", complete));
  assert.equal(complete.status, 0, ran("complete exits 0", complete));

  // W-299: a done commit that left the handoff unchanged reads complete, and a later handoff edit changes nothing
  const n = world("w141-b3-named", "done");
  expectStep(next(n, [OPUS]), "checkpoint", "complete", "the done commit left the handoff unchanged: complete (W-299)");
  put(n.repo, "docs/SESSION-HANDOFF.md", HANDOFF_DONE);
  commit(n.repo, "chore: a later handoff edit");
  git(n.repo, ["push", "-q", "origin", "master"]);
  expectStep(next(n, [OPUS]), "checkpoint", "complete", "a later handoff edit leaves it complete");

  // master without a handoff: complete once the record is done
  const none = world("w141-b3-none", "cleanup");
  git(none.repo, ["rm", "-q", "docs/SESSION-HANDOFF.md"]);
  commit(none.repo, "test: no handoff");
  git(none.repo, ["push", "-q", "origin", "master"]);
  markDone(none, false);
  assert.equal(next(none, [OPUS]).first, `next: ${OPUS} checkpoint complete`, "no handoff on master: complete once the record is done");

  // W-299: --perform --expect done commits with no tracked handoff change, and a handoff change still rides
  const r = world("w141-b3-refuse", "cleanup", { patron: true });
  scenario(r, { list: mergedList(r) });
  expectStep(next(r, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "without a handoff change the perform commits (W-299)");
  assert.equal(branchExists(r, `chore/done-${OPUS}`), true, "the chore branch holds the done commit");
  const t = world("w141-b3-rides", "cleanup", { patron: true });
  scenario(t, { list: mergedList(t) });
  touchHandoff(t);
  expectStep(next(t, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "with a handoff change the perform commits");
});

// ---------------------------------------------------------------------------
// W-141 behaviour 5: next lands chore/done-<id> through a PR (W-293 retired spec/<id>)
// ---------------------------------------------------------------------------
/** Write a raw gh scenario: `rules` are tried in order, first match wins (the slot builder cannot tell two `pr list` heads apart). */
function rawScenario(w: World, rules: { match: string[]; replies: Reply[]; alts?: Alt[] }[]): void {
  writeFileSync(w.scn, JSON.stringify({ rules }));
  rmSync(`${w.scn}.state`, { force: true });
  rmSync(w.log, { force: true });
}
/** The gh world of landing `head`: a PR that is created (or already OPEN), merges on request, and then reads MERGED. */
function landingScenario(w: World, head: string, o: { open: boolean; checks?: Json[]; opusMerged?: boolean }): { merged: string } {
  const created = join(w.root, "created.flag");
  const merged = join(w.root, "merged.flag");
  const oid = git(w.repo, ["rev-parse", `refs/heads/${head}`]);
  const m = git(w.repo, ["commit-tree", `${head}^{tree}`, "-p", "master", "-m", `squash ${head} (#${PR_NUMBER})`]);
  git(w.repo, ["push", "-q", "origin", `${m}:refs/heads/master`]);
  const open = cand(w, { state: "OPEN", head, oid });
  const done = cand(w, { state: "MERGED", head, oid, merge: m });
  const std = (slot: SlotName): { match: string[]; replies: Reply[]; alts?: Alt[] } => ({ match: SLOT_MATCH[slot], ...asRule(slot === "checks" ? { stdout: o.checks ?? greens() } : slot === "view" ? { stdout: viewOf(open) } : slot === "create" ? { stdout: `https://github.com/${SLUG}/pull/${PR_NUMBER}\n`, touch: created } : slot === "merge" ? { stdout: "", touch: merged } : slot === "alerts" || slot === "rules" ? { stdout: [] } : slot === "repoView" ? { stdout: { nameWithOwner: SLUG } } : { stdout: "" }) });
  rawScenario(w, [
    ...(o.opusMerged ? [{ match: ["pr", "list", "--head", BRANCH], replies: [{ stdout: [cand(w, { state: "MERGED" })] }] }] : []),
    {
      match: ["pr", "list", "--head", head],
      replies: [{ stdout: o.open ? [open] : [] }],
      alts: [{ ifExists: merged, replies: [{ stdout: [done] }] }, ...(o.open ? [] : [{ ifExists: created, replies: [{ stdout: [open] }] }])],
    },
    { match: ["pr", "list"], replies: [{ stdout: [] }] },
    { match: ["pr", "view"], replies: [{ stdout: viewOf(open) }], alts: [{ ifExists: merged, replies: [{ stdout: viewOf(done) }] }] },
    std("repoView"),
    std("checks"),
    std("rules"),
    std("alerts"),
    std("update"),
    std("merge"),
    std("create"),
  ]);
  return { merged };
}
const originHas = (w: World, head: string): boolean => git(w.origin, ["for-each-ref", `refs/heads/${head}`]) !== "";

test("W-141-b5 behaviour 5: next lands chore/done-<id> through a PR, as it lands an opus", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  const doneCommitted = (tag: string): World => {
    const w = world(tag, "cleanup");
    scenario(w, { list: mergedList(w) });
    touchHandoff(w);
    expectStep(next(w, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the done commit is made first");
    return w;
  };
  // done head: no PR yet, so one is created
  const s = doneCommitted("w141-b5-create");
  landingScenario(s, chore, { open: false, opusMerged: true });
  const subject = git(s.repo, ["log", "-1", "--format=%s", chore]);
  const body = git(s.repo, ["log", "-1", "--format=%b", chore]);
  const landed = next(s, [OPUS, "--perform", "--expect", "done", ...FAST]);
  const creates = ghCalls(s).filter((a) => a[0] === "pr" && a[1] === "create");
  assert.equal(creates.length, 1, ran("one gh pr create call", landed));
  const arg = (a: string[], flag: string): string | undefined => a[a.indexOf(flag) + 1];
  assert.equal(arg(creates[0]!, "--title"), subject, "the PR title is the head commit's subject");
  assert.equal(arg(creates[0]!, "--body"), body, "the PR body is the head commit's body");
  assert.equal(arg(creates[0]!, "--head"), chore);
  assert.equal(landed.status, 0, ran("landing exits 0", landed));
  expectStep(landed, "done", "performed", "the done head is landed");
  assert.deepEqual(mutating(s), ["git push --force-with-lease", "gh pr create", "gh pr merge --squash --auto", "git fetch master:master", "git merge --ff-only"], "push, create, merge, fetch, in order");
  const pushes = gitCalls(s).filter((a) => a[0] === "push");
  assert.ok(pushes.every((a) => !a.includes("-u") && !a.includes("--set-upstream")), "no -u");
  assert.deepEqual(pushes[0], ["push", "-q", "--force-with-lease", "origin", chore], "the head is pushed with --force-with-lease");
  assert.ok(pushes.some((a) => a.includes("--delete") && a.some((x) => x.startsWith(`--force-with-lease=refs/heads/${chore}:`))), "the remote head is deleted, leased to the PR head");
  assert.equal(branchExists(s, chore), false, "the local head is deleted");
  assert.equal(originHas(s, chore), false, "the remote head is deleted");

  // done head: an OPEN PR is reused, and the checkpoint rides along
  const d = doneCommitted("w141-b5-done");
  landingScenario(d, chore, { open: true, opusMerged: true });
  const choreSubject = git(d.repo, ["log", "-1", "--format=%s", chore]);
  expectStep(next(d, [OPUS]), "done", "named", "next names the landing of chore/done-<id>");
  const doneLanded = next(d, [OPUS, "--perform", "--expect", "done", ...FAST]);
  assert.equal(ghCalls(d).filter((a) => a[0] === "pr" && a[1] === "create").length, 0, ran("an OPEN PR is reused: no gh pr create", doneLanded));
  assert.equal(ghCalls(d).filter((a) => a[0] === "pr" && a[1] === "merge" && a.includes("--squash") && a.includes("--auto")).length, 1, "merged with --squash --auto");
  assert.equal(doneLanded.status, 0, ran("done landing exits 0", doneLanded));
  assert.equal(branchExists(d, chore), false, "the local chore head is deleted");
  assert.equal(originHas(d, chore), false, "the remote chore head is deleted");
  assert.equal(git(d.repo, ["log", "-1", "--format=%s", "master"]), `squash ${chore} (#${PR_NUMBER})`, "master fast-forwarded to the squash commit");
  assert.ok(choreSubject.includes(OPUS));
  assert.equal(next(d, [OPUS]).first, `next: ${OPUS} checkpoint complete`, "the done head carried the handoff: complete");

  // mergeGate's rules apply: a failing check holds, merges nothing and deletes nothing
  const f = doneCommitted("w141-b5-fail");
  landingScenario(f, chore, { open: false, opusMerged: true, checks: [...greens(MIN_CHECKS), check("lint", "fail")] });
  const failed = next(f, [OPUS, "--perform", "--expect", "done", ...FAST]);
  expectHeld(failed, "a failing check");
  assert.match(failed.out, /state=CHECKS_FAILED/, ran("CHECKS_FAILED", failed));
  assert.equal(ghMerges(f).length, 0, "no merge");
  assert.equal(branchExists(f, chore), true, "the head stays");

  // a head that changes a path outside the officina and docs/ is refused before the push
  const o = doneCommitted("w141-b5-outside");
  git(o.repo, ["switch", "-q", chore]);
  put(o.repo, "source.txt", "changed outside the officina\n");
  commit(o.repo, "feat: touch the source");
  git(o.repo, ["switch", "-q", "master"]);
  scenario(o, { list: mergedList(o) });
  expectStep(next(o, [OPUS]), "done", "named", "the done head is named");
  const calls = ghCalls(o).length;
  const refused = next(o, [OPUS, "--perform", "--expect", "done", ...FAST]);
  expectHeld(refused, "an outside path");
  assert.match(refused.out, /why: .*source\.txt/, ran("the refusal names the path", refused));
  // the done rung reads opus/<id>'s PR (a spec head read none); the landing itself makes no gh call
  const derivation = (a: string[]): boolean => (a[0] === "repo" && a[1] === "view") || (a[0] === "pr" && a[1] === "list" && a.includes(BRANCH));
  assert.deepEqual(ghCalls(o).slice(calls).filter((a) => !derivation(a)), [], ran("no gh call is made beyond the derivation's reads", refused));
  assert.deepEqual(mutating(o), [], "nothing is pushed");
  assert.equal(originHas(o, chore), false, "the head never reached origin");
});

// ---------------------------------------------------------------------------
// W-141 review round 1: the rows the censor named
// ---------------------------------------------------------------------------
/** Every ref with its object: a refusal must leave all of them (master and origin/master included) untouched. */
const refsOf = (w: World): string => git(w.repo, ["for-each-ref", "--format=%(refname) %(objectname)"]);

test("W-141-b1 round 1: the Patron preflight runs before any fetch moves a ref, master checked out or not", { timeout: 1_800_000 }, () => {
  for (const checkedOut of [false, true]) {
    const label = checkedOut ? "master checked out" : "master unchecked out";
    const w = reviewed(
      `w141-r1-b1-${checkedOut}`,
      { patron: true, mainOnMaster: checkedOut },
      (x) => {
        put(x.wt, CENSOR, "censor v2\n");
        commit(x.wt, `feat(${OPUS}): censor change`);
        writeReceipt(x, "current");
      },
      true,
    );
    const m = landMerge(w, false);
    scenario(w, { list: mergedList(w, { merge: m }) });
    const before = refsOf(w);
    const held = performMerge(w);
    expectHeld(held, `${label}: held`);
    assert.equal(refsOf(w), before, ran(`${label}: every ref is unchanged (master and origin/master included)`, held));
    assert.ok(
      outLines(held).some((l) => l.startsWith("why: refusing: incoming paths belong to the Patron")),
      ran(`${label}: the Patron refusal`, held),
    );
    const patron = outLines(held).find((l) => l.startsWith("patron: "));
    assert.ok(patron !== undefined, ran(`${label}: a patron line`, held));
    // the printed command, run as given, lets next move on
    const [, ...args] = patron!.slice("patron: ".length).split(" ");
    git(w.root, args);
    expectStep(next(w, [OPUS]), "cleanup", "named", `${label}: after the Patron's command next derives cleanup`);
  }
});

test("W-141-b1 round 1: a staged rename out of .claude/ is a Patron change", { timeout: 1_800_000 }, () => {
  const w = world("w141-r1-b1-rename", "spec", { patron: true });
  git(w.repo, ["mv", CENSOR, "docs/censor.md"]);
  const was = [git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["status", "--porcelain"])].join("\n");
  const held = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(held, "branch with a staged rename out of .claude/");
  assert.equal([git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["status", "--porcelain"])].join("\n"), was, ran("nothing is mutated", held));
  const lines = outLines(held);
  assert.ok(lines.some((l) => l.startsWith("dirty: R")), ran("the rename is a dirty line", held));
  const patron = lines.find((l) => l.startsWith("patron: "));
  assert.ok(patron?.includes(CENSOR), ran("the patron line names the original path", held));
  const [, ...args] = patron!.slice("patron: ".length).split(" ");
  git(w.root, args);
  assert.equal(readFileSync(join(w.repo, CENSOR), "utf8"), "censor v1\n", "the printed command restores the Patron file");
});

/** A done world (merged, fetched, cleaned up) of an automated opus whose main-checkout record carries `gates`. */
function certifiedWorld(tag: string, kind: "opus" | "ui", gates: Record<string, { certifies: (tree: string) => string; hex: string }>): World {
  const w = world(tag, "cleanup", { automated: true });
  scenario(w, { list: mergedList(w) });
  const tree = sourceTree(w.repo);
  if (kind === "ui") editRecord(w, "repo", (doc) => doc.setIn(["kind"], "ui"));
  editRecord(w, "repo", (doc) => {
    for (const [id, g] of Object.entries(gates)) doc.setIn(["probationes", id], { status: "passed", evidence: `ci/${OPUS}-${id}-${g.hex}.log`, certifies: g.certifies(tree) });
  });
  return w;
}
const VERIFY = `bisellium verify ${OPUS} --studio studio --repo .`;
/** W-259: an uncertified non-ui opus is named the done perform, which records certify's certificate or names VERIFY. */
const DONE_PERFORM = `bisellium next ${OPUS} --perform --expect done`;

test("W-141-b2 round 1: a UI opus's implicit served-e2e gate counts toward certificate readiness", { timeout: 1_800_000 }, () => {
  const w = certifiedWorld("w141-r1-b2-ui", "ui", { tests: { certifies: (t) => t, hex: "aaa111" } });
  const tree = sourceTree(w.repo);
  const missing = next(w, [OPUS]);
  expectStep(missing, "done", "named", "ui opus with no served-e2e certificate");
  assert.equal(missing.kv.get("command"), VERIFY, ran("the rung names verify", missing));
  editRecord(w, "repo", (doc) => doc.setIn(["probationes", "served-e2e"], { status: "passed", evidence: `ci/${OPUS}-served-e2e-bbb222.log`, certifies: tree }));
  put(w.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  put(w.repo, `studio/ci/${OPUS}-served-e2e-bbb222.log`, "served e2e log\n");
  const ready = next(w, [OPUS]);
  assert.equal(ready.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("with both certificates the rung is the perform", ready));
});

test("W-141-b2 round 1: the done commit stages each gate's recorded evidence, never another matching log", { timeout: 1_800_000 }, () => {
  const w = world("w141-r1-b2-logs", "cleanup", { automated: true });
  // a second automated gate, declared in the manifest as a UI opus's implicit one would be
  put(w.studio, "bisellium.yml", readFileSync(join(w.studio, "bisellium.yml"), "utf8").replace("source_excludes:", '  - { id: served-e2e, name: Served e2e, kind: automated, command: "node scripts/served-e2e.mjs" }\nsource_excludes:'));
  commit(w.repo, "test: a second automated gate");
  git(w.repo, ["push", "-q", "origin", "master"]);
  scenario(w, { list: mergedList(w) });
  const tree = sourceTree(w.repo);
  editRecord(w, "repo", (doc) => {
    doc.setIn(["probationes", "tests"], { status: "passed", evidence: `ci/${OPUS}-tests-aaa111.log`, certifies: tree });
    doc.setIn(["probationes", "served-e2e"], { status: "passed", evidence: `ci/${OPUS}-served-e2e-bbb222.log`, certifies: tree });
  });
  put(w.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  put(w.repo, `studio/ci/${OPUS}-served-e2e-bbb222.log`, "served e2e log\n");
  put(w.repo, `studio/ci/${OPUS}-tests-0badcafe.log`, "an unrelated, filename-shaped log\n");
  touchHandoff(w);
  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  assert.equal(done.status, 0, ran("perform exits 0", done));
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/chore/done-${OPUS}`]).split("\n").sort();
  assert.deepEqual(paths, ["docs/SESSION-HANDOFF.md", `studio/ci/${OPUS}-served-e2e-bbb222.log`, `studio/ci/${OPUS}-tests-aaa111.log`, `studio/opera/${OPUS}.md`], "both gates' recorded logs ride, and only those");
  assert.match(git(w.repo, ["status", "--porcelain", "-uall"]), /\?\? studio\/ci\/W-900-tests-0badcafe\.log/, "the unrelated matching log is not committed");
});

test("W-141-b2 round 1: a stale or dirty certificate is not a certificate", { timeout: 1_800_000 }, () => {
  for (const [row, certifies] of [
    ["a tree: value of another tree", () => `tree:${"0".repeat(40)}`],
    ["a dirty: value of this tree", (t: string) => `dirty:${t.slice(5)}`],
  ] as const) {
    const w = certifiedWorld(`w141-r1-b2-${row.split(" ")[1]}`, "opus", { tests: { certifies, hex: "aaa111" } });
    const o = next(w, [OPUS]);
    expectStep(o, "done", "named", row);
    assert.equal(o.kv.get("command"), DONE_PERFORM, ran(`${row}: the rung names the done perform (W-259)`, o));
    const held = next(w, [OPUS, "--perform", "--expect", "done"]);
    expectHeld(held, `${row}: perform`);
    assert.ok(outLines(held).some((l) => l.startsWith("why: ") && l.includes(VERIFY)), ran(`${row}: the why line names verify`, held));
  }
});

test("W-141-b2 round 1: a failed done commit or switch-back never leaves the main checkout half-moved or reports success", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  // the commit fails: master is restored with nothing staged, no chore head
  const c = world("w141-r1-b2-commit", "cleanup");
  scenario(c, { list: mergedList(c) });
  touchHandoff(c);
  const failed = next(c, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r1-b2-commit", ["commit -q -m chore(studio): mark"]) } });
  expectHeld(failed, "done with a failing commit");
  assert.equal(git(c.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", ran("HEAD is back on master", failed));
  assert.equal(stagedPaths(c), "", ran("nothing is staged on master", failed));
  assert.equal(branchExists(c, chore), false, "no chore head is left");

  // the switch back fails after a good commit: the rung holds, it never reports success off master
  const s = world("w141-r1-b2-switch", "cleanup");
  scenario(s, { list: mergedList(s) });
  touchHandoff(s);
  const stuck = next(s, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r1-b2-switch", ["switch -q master"]) } });
  expectHeld(stuck, "done with a failing switch back");
  assert.match(stuck.out, /why: .*master/, ran("the why names the failed switch", stuck));
});

// ---------------------------------------------------------------------------
// W-141 review round 2: the classes the censor named, closed whole
// ---------------------------------------------------------------------------
const fetchHead = (w: World): string => (existsSync(join(w.repo, ".git/FETCH_HEAD")) ? readFileSync(join(w.repo, ".git/FETCH_HEAD"), "utf8") : "(absent)");

test("W-141-b1 round 2: the Patron preflight mutates nothing: no ref, no tag, no FETCH_HEAD, and every indeterminate target refuses", { timeout: 1_800_000 }, () => {
  const build = (tag: string, merge?: (w: World, m: string) => string): { w: World; held: () => Out } => {
    const w = reviewed(
      tag,
      { patron: true, mainOnMaster: false },
      (x) => {
        put(x.wt, CENSOR, "censor v2\n");
        commit(x.wt, `feat(${OPUS}): censor change`);
        writeReceipt(x, "current");
      },
      true,
    );
    const m = landMerge(w, false);
    // a tag on origin that a bare `git fetch origin <oid>` would follow
    git(w.origin, ["tag", "v-r2", m]);
    scenario(w, { list: mergedList(w, { merge: merge === undefined ? m : merge(w, m) }) });
    return { w, held: () => performMerge(w) };
  };
  const state = (w: World): string => [refsOf(w), git(w.repo, ["tag"]), fetchHead(w)].join("\n--\n");

  // the Patron stop: nothing is written, not even FETCH_HEAD or the tag
  const stop = build("w141-r2-b1-stop");
  const before = state(stop.w);
  const held = stop.held();
  expectHeld(held, "Patron stop");
  assert.match(held.out, /why: refusing: incoming paths belong to the Patron/, ran("the Patron refusal", held));
  assert.equal(state(stop.w), before, ran("refs, tags and FETCH_HEAD are all unchanged", held));

  // an absent target, a tag object that merely peels to a commit and a tree id each refuse with nothing written
  const absent = build("w141-r2-b1-absent", () => "1".repeat(40));
  const absentBefore = state(absent.w);
  const a = absent.held();
  expectHeld(a, "an absent target");
  assert.equal(state(absent.w), absentBefore, ran("an absent target: nothing written", a));

  const peel = build("w141-r2-b1-peel", (w, m) => {
    const body = `object ${m}\ntype commit\ntag peel\ntagger t <t@example.com> 1700000000 +0000\n\nm\n`;
    return spawnSync("git", ["hash-object", "-t", "tag", "-w", "--stdin"], { cwd: w.repo, env: SETUP_ENV, encoding: "utf8", input: body }).stdout.trim();
  });
  const peelBefore = state(peel.w);
  const p = peel.held();
  expectHeld(p, "a tag object");
  assert.equal(state(peel.w), peelBefore, ran("a tag object that peels to the commit: refs, tags and FETCH_HEAD unchanged", p));

  const tree = build("w141-r2-b1-tree", (w) => git(w.repo, ["rev-parse", "master^{tree}"]));
  const treeBefore = state(tree.w);
  const t = tree.held();
  expectHeld(t, "a tree id");
  assert.equal(state(tree.w), treeBefore, ran("a tree id: refs, tags and FETCH_HEAD unchanged", t));
});

test("W-141-b1 round 2: a rename or copy into .claude/ is a Patron change", { timeout: 1_800_000 }, () => {
  const w = world("w141-r2-b1-into", "spec", { patron: true });
  git(w.repo, ["mv", "README.md", ".claude/readme.md"]);
  const held = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(held, "branch with a staged rename into .claude/");
  const lines = outLines(held);
  assert.ok(
    lines.some((l) => l.startsWith("dirty: R README.md -> .claude/readme.md")),
    ran("the rename is a dirty line", held),
  );
  const patron = lines.filter((l) => l.startsWith("patron: "));
  assert.ok(
    patron.some((l) => l.includes(".claude/readme.md")),
    ran("a patron line names the destination", held),
  );
  for (const l of patron) git(w.root, l.slice("patron: ".length).split(" ").slice(1));
  assert.equal(git(w.repo, ["ls-files", ".claude/readme.md"]), "", "the printed command takes the destination out of the index");

  // a copy: status reports it as C when copy detection is on
  const c = world("w141-r2-b1-copy", "spec", { patron: true });
  git(c.repo, ["config", "status.renames", "copies"]);
  appendFileSync(join(c.repo, "README.md"), "edit\n");
  put(c.repo, ".claude/copy.md", readFileSync(join(c.repo, "README.md"), "utf8"));
  git(c.repo, ["add", "README.md", ".claude/copy.md"]);
  assert.match(git(c.repo, ["status", "--porcelain"]), /^C /m, "the fixture reports a copy");
  const heldCopy = next(c, [OPUS, "--perform", "--expect", "branch"]);
  expectHeld(heldCopy, "branch with a staged copy into .claude/");
  assert.ok(
    outLines(heldCopy).some((l) => l.startsWith("patron: ") && l.includes(".claude/copy.md")),
    ran("a patron line names the copy's destination", heldCopy),
  );
});

test("W-141-b2 round 2: readiness judges the working record: a valid trunk certificate never masks a stale or dirty one, and kind drift is judged by the stricter kind", { timeout: 1_800_000 }, () => {
  // a valid certificate committed on the trunk, a stale one in the working record
  const w = certifiedWorld("w141-r2-b2-mask", "opus", { tests: { certifies: (t) => t, hex: "aaa111" } });
  put(w.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  commit(w.repo, "test: the certificate rides the trunk");
  editRecord(w, "repo", (doc) => doc.setIn(["probationes", "tests", "certifies"], `tree:${"0".repeat(40)}`));
  const masked = next(w, [OPUS]);
  expectStep(masked, "done", "named", "stale working certificate");
  assert.equal(masked.kv.get("command"), DONE_PERFORM, ran("the stale working record is not masked by the trunk's", masked));
  const heldPerform = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(heldPerform, "perform with a stale working record");

  // kind drift: ui on the trunk (with the ui-lead's input, so the ladder is past spec), opus in the working record
  const d = certifiedWorld("w141-r2-b2-drift", "opus", {});
  put(d.studio, "ci/dispatch.md", "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n");
  const from = join(d.root, "ui-spec.md");
  writeFileSync(from, ["## Findings", "No findings", "The navigation relationships remain legible across the complete narrow viewport arrangement.", "## Recommendation", "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.", "Additional original observations cover focus movement responsive density and stable content grouping throughout.", "Verdict: passed", ""].join("\n"));
  editRecord(d, "repo", (doc) => {
    doc.setIn(["kind"], "ui");
    doc.setIn(["spec"], `briefs/${OPUS}.md`);
  });
  verb(d.repo, ["verdict", OPUS, "--round", "2", "--sella", "ui-lead", "--outcome", "passed", "--phase", "spec", "--dispatch-prompt", "ci/dispatch.md", "--from", from, "--studio", d.studio, "--now", T.spec]);
  commit(d.repo, "test: the record is ui on the trunk");
  const tree = sourceTree(d.repo);
  put(d.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  editRecord(d, "repo", (doc) => {
    doc.setIn(["kind"], "opus");
    doc.setIn(["probationes", "tests"], { status: "passed", evidence: `ci/${OPUS}-tests-aaa111.log`, certifies: tree });
  });
  const drift = next(d, [OPUS]);
  expectStep(drift, "done", "named", "kind drift ui -> opus");
  assert.equal(drift.kv.get("command"), VERIFY, ran("the stricter kind's gates are required", drift));
});

test("W-141-b2 round 2: readiness validates each gate's recorded evidence file, and refuses any it cannot read or list", { timeout: 1_800_000 }, () => {
  const certified = (tag: string, evidenceName = "aaa111"): World => {
    const w = certifiedWorld(tag, "opus", { tests: { certifies: (t) => t, hex: evidenceName } });
    return w;
  };
  // the record cites a log that exists nowhere
  const missing = certified("w141-r2-b2-missing");
  const m = next(missing, [OPUS]);
  expectStep(m, "done", "named", "evidence file missing");
  assert.equal(m.kv.get("command"), DONE_PERFORM, ran("a missing log is not certified", m));
  touchHandoff(missing);
  expectHeld(next(missing, [OPUS, "--perform", "--expect", "done"]), "perform with a missing log");
  assert.equal(branchExists(missing, `chore/done-${OPUS}`), false, "no chore head");

  // the record cites a path that is not `ci/<id>-<gate>-<hex>.log`
  const odd = certified("w141-r2-b2-odd");
  editRecord(odd, "repo", (doc) => doc.setIn(["probationes", "tests", "evidence"], "../README.md"));
  const o = next(odd, [OPUS]);
  assert.equal(o.kv.get("command"), DONE_PERFORM, ran("a malformed evidence path is not certified", o));

  // a good untracked log, but `git ls-files` fails: the omission is a refusal, not a silent skip
  const fine = certified("w141-r2-b2-lsfiles");
  put(fine.repo, `studio/ci/${OPUS}-tests-aaa111.log`, "tests log\n");
  touchHandoff(fine);
  const failed = next(fine, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r2-b2-lsfiles", ["ls-files"]) } });
  expectHeld(failed, "perform with ls-files failing");
  assert.equal(branchExists(fine, `chore/done-${OPUS}`), false, "no chore head");
  assert.equal(git(fine.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "HEAD stays on master");
  // and with ls-files working, the same world performs
  expectStep(next(fine, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the same world performs once git can list");
});

test("W-141-b2 round 2: a failed unstage keeps the branch and HEAD on it, never carrying staged files onto master", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  const c = world("w141-r2-b2-restore", "cleanup");
  scenario(c, { list: mergedList(c) });
  touchHandoff(c);
  const failed = next(c, [OPUS, "--perform", "--expect", "done"], { env: { GIT_STUB_REAL: failingGit("w141-r2-b2-restore", ["commit -q -m chore(studio): mark", "restore -q --staged"]) } });
  expectHeld(failed, "done with failing commit and restore");
  assert.equal(git(c.repo, ["symbolic-ref", "HEAD"]), `refs/heads/${chore}`, ran("HEAD stays on the chore branch", failed));
  assert.equal(branchExists(c, chore), true, "the recovery branch is kept");
  assert.match(failed.out, /restore --staged/, ran("the why names the recovery command", failed));
  assert.match(failed.out, /switch master/, ran("and the switch back", failed));
});

// ---------------------------------------------------------------------------
// W-137 behaviour 4: next names the retro after done and holds every new start until it is filed
// ---------------------------------------------------------------------------
const OTHER = "W-901";
/** A second opus, greenlit and specced on master, with no branch: the next one that would start. */
function addSpecced(w: World): void {
  put(w.studio, `opera/${OTHER}.md`, recordText({ id: OTHER, state: "greenlit", probationes: {} }));
  put(w.repo, `studio/briefs/${OTHER}.md`, briefText(w.behaviours).replace(`# ${OPUS}`, `# ${OTHER}`));
  verb(w.repo, ["verdict", OTHER, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, "spec-other.md"), "--studio", w.studio, "--now", T.spec]);
  commit(w.repo, `spec(${OTHER}): signed`);
  git(w.repo, ["push", "-q", "origin", "master"]);
}
/** Expect `next: W-901 <step> <status>` as the first stdout line. */
function expectOther(o: Out, step: string, status: string, row: string): void {
  assert.equal(o.first, `next: ${OTHER} ${step} ${status}`, ran(row, o));
}
function setRetro(w: World, line: string): void {
  appendFileSync(join(w.studio, "bisellium.yml"), `${line}\n`);
  commit(w.repo, "test: retro setting");
  git(w.repo, ["push", "-q", "origin", "master"]);
}
test("W-137-b4 behaviour 4: next names the retro after done and holds every new start until it is filed", { timeout: 1_800_000 }, () => {
  const w = world("w137-b4", "done");
  addSpecced(w);
  setRetro(w, "retro: { since: 2026-10-01T00:00:00Z }");

  const named = next(w, [OPUS]);
  expectStep(named, "retro", "named", "a done opus whose retro is owed names the retro");
  assert.match(named.out, /^command: bisellium retro --opus W-900 --from <triage\.json> --studio /m, ran("the retro command", named));
  assert.match(named.out, /^actor: producer$/m, ran("the producer files it", named));

  const held = next(w, [OTHER]);
  expectOther(held, "branch", "held", "a new start holds at branch while a retro is owed");
  assert.match(held.out, /retro owed: W-900; file them before a new opus starts/, ran("the hold names the owed opus", held));

  put(w.studio, "acta/2026-10-06-retro-W-900.md", `---\nauthor: producer\nkind: decision\ntitle: "Retro W-900"\nat: 2026-10-06T13:00:00Z\nopus: W-900\n---\nFiled.\n`);
  commit(w.repo, "chore(studio): retro W-900 filed");
  git(w.repo, ["push", "-q", "origin", "master"]);
  expectStep(next(w, [OPUS]), "checkpoint", "complete", "once the retro is filed the ladder goes on to the checkpoint, complete (W-299)");
  expectOther(next(w, [OTHER]), "branch", "named", "and the next opus may start");

  const none = world("w137-b4-none", "done");
  addSpecced(none);
  expectStep(next(none, [OPUS]), "checkpoint", "complete", "with no retro key the done opus goes straight to the checkpoint, complete (W-299)");
  expectOther(next(none, [OTHER]), "branch", "named", "with no retro key a new start is named as today");

  const bad = world("w137-b4-bad", "done");
  addSpecced(bad);
  setRetro(bad, 'retro: { since: "soon" }');
  const badDone = next(bad, [OPUS]);
  expectStep(badDone, "retro", "held", "a malformed retro setting holds the retro step");
  assert.match(badDone.out, /since/, ran("and names the setting", badDone));
  const badNew = next(bad, [OTHER]);
  expectOther(badNew, "branch", "held", "a malformed retro setting holds a new start");
  assert.match(badNew.out, /since/, ran("and names the setting", badNew));
});

// ---------------------------------------------------------------------------
// W-186 behaviour 2: performed done holds on a stale working-tree handoff before performDone runs
// ---------------------------------------------------------------------------
/** The base world's handoff (nothing queued, no Resume point, W-299), with an edit that names no opus: a change that may ride a perform. */
const HANDOFF_FRESH = "# Handoff\n\n## Queue\n\n- (nothing queued)\n- checkpoint line\n";
const handoffHolds = (o: Out): string[] => outLines(o).filter((l) => l.startsWith("handoff: "));
/** The master tip, the chore heads and the tracked changes: what a hold must leave exactly as it found them. */
const choreHeads = (w: World): string => git(w.repo, ["for-each-ref", "--format=%(refname)", "refs/heads/chore/"]);
test("W-186-b2 behaviour 2: performed done holds on a stale working-tree handoff before performDone runs", { timeout: 1_800_000 }, () => {
  const w = world("w186-b2", "cleanup");
  scenario(w, { list: mergedList(w) });
  expectStep(next(w, [OPUS]), "done", "named", "the fixture names done");
  const tip = git(w.repo, ["rev-parse", "refs/heads/master"]);

  // (a) W-299: the Queue names the opus, which the perform is about to make done (no finding), beside a Resume point (a finding)
  put(w.repo, "docs/SESSION-HANDOFF.md", "# Handoff\n\n## Resume point (9999-12-31)\n\n- (nothing recorded)\n\n## Queue\n\n1. W-900 — fixture\n");
  const stale = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(stale, "a handoff that keeps a Resume point");
  assert.ok(outLines(stale).some((l) => l.startsWith("why: refusing: docs/SESSION-HANDOFF.md is stale")), ran("the why line", stale));
  assert.deepEqual(handoffHolds(stale).map((l) => l.split(" ")[1]), ["process.handoff.resume"], ran("a resume finding is printed, and no queue finding", stale));
  assert.equal(git(w.repo, ["rev-parse", "refs/heads/master"]), tip, "the master tip is unchanged");
  assert.equal(choreHeads(w), "", "no chore head");
  assert.equal(git(w.repo, ["status", "--porcelain", "--untracked-files=no"]), "M docs/SESSION-HANDOFF.md", "only the handoff edit is in the tree");

  // (b) the Queue is emptied and the Resume date is older than the opus's done
  put(w.repo, "docs/SESSION-HANDOFF.md", "# Handoff\n\n## Resume point (2000-01-01)\n\n- (nothing recorded)\n\n## Queue\n\n- (nothing queued)\n");
  const old = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(old, "a Resume date before the done");
  assert.deepEqual(
    handoffHolds(old).map((l) => l.split(" ")[1]),
    ["process.handoff.resume"],
    ran("exactly a resume finding", old),
  );
  assert.equal(choreHeads(w), "", "still no chore head");

  // (c) the date is restored: the step performs, and the one commit holds the handoff and the record
  put(w.repo, "docs/SESSION-HANDOFF.md", HANDOFF_FRESH);
  expectStep(next(w, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "a fresh handoff performs");
  const chore = `chore/done-${OPUS}`;
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", git(w.repo, ["rev-parse", `refs/heads/${chore}`])]).split("\n").sort();
  assert.deepEqual(paths, ["docs/SESSION-HANDOFF.md", `studio/opera/${OPUS}.md`], "the chore commit holds the handoff and the record");

  // (d) a second world: the working-tree handoff is deleted while master keeps it
  const d = world("w186-b2-absent", "cleanup");
  scenario(d, { list: mergedList(d) });
  expectStep(next(d, [OPUS]), "done", "named", "the second fixture names done");
  rmSync(join(d.repo, "docs/SESSION-HANDOFF.md"));
  const gone = next(d, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(gone, "a deleted handoff that master keeps");
  assert.ok(handoffHolds(gone).some((l) => l.startsWith("handoff: process.handoff.input ")), ran("an input finding is printed", gone));
  assert.equal(choreHeads(d), "", "no chore head");
});

// ---------------------------------------------------------------------------
// W-243 behaviour 2: done and its landing take only the paths certify takes as records (scripts/ci-scope.mjs recordOnly)
// ---------------------------------------------------------------------------
test("W-243-b2 behaviour 2: done and its landing refuse a docs/ path that is not an officina record", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  // the done perform: a staged docs/ARCHITECTURE.md does not ride the done commit
  const d = world("w243-b2-done", "cleanup");
  scenario(d, { list: mergedList(d) });
  touchHandoff(d);
  put(d.repo, "docs/ARCHITECTURE.md", "an architecture edit\n");
  git(d.repo, ["add", "--", "docs/ARCHITECTURE.md"]);
  const held = next(d, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(held, "a staged docs/ARCHITECTURE.md holds done");
  assert.ok(outLines(held).some((l) => l.includes("docs/ARCHITECTURE.md")), ran("the hold names docs/ARCHITECTURE.md", held));
  assert.equal(branchExists(d, chore), false, "no chore/done-<id> is made");

  // the dossier pages and the handoff still ride
  const p = world("w243-b2-pages", "cleanup");
  scenario(p, { list: mergedList(p) });
  touchHandoff(p);
  put(p.repo, "docs/design/dossier/progress-body.html", "<tr><td>W-900</td></tr>\n");
  git(p.repo, ["add", "--", "docs/design/dossier/progress-body.html"]);
  expectStep(next(p, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "a dossier page rides the done commit");
  const paths = git(p.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/${chore}`]).split("\n").sort();
  assert.deepEqual(paths, ["docs/SESSION-HANDOFF.md", "docs/design/dossier/progress-body.html", `studio/opera/${OPUS}.md`], "the record, the handoff and the page");

  // the landing: a done head that also changes docs/ARCHITECTURE.md is refused before the push
  const o = world("w243-b2-land", "cleanup");
  scenario(o, { list: mergedList(o) });
  touchHandoff(o);
  expectStep(next(o, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the done commit is made first");
  git(o.repo, ["switch", "-q", chore]);
  put(o.repo, "docs/ARCHITECTURE.md", "an architecture edit\n");
  commit(o.repo, "docs: architecture");
  git(o.repo, ["switch", "-q", "master"]);
  scenario(o, { list: mergedList(o) });
  const refused = next(o, [OPUS, "--perform", "--expect", "done", ...FAST]);
  expectHeld(refused, "docs/ARCHITECTURE.md on the done head");
  assert.match(refused.out, /why: refusing: .*docs\/ARCHITECTURE\.md/, ran("the refusal names the path", refused));
  assert.deepEqual(mutating(o), [], "nothing is pushed");
  assert.equal(originHas(o, chore), false, "the head never reached origin");
});

// ---------------------------------------------------------------------------
// W-243 behaviour 3: pr refuses an opus branch carrying a merge commit before it pushes (#489)
// ---------------------------------------------------------------------------
test("W-243-b3 behaviour 3: pr refuses an opus branch carrying a merge commit before any push", { timeout: 3_600_000 }, () => {
  // master moves, the opus branch merges it in, and the merged head is minted and reviewed (the #489 shape)
  let mergeCommit = "";
  const w = queueWorld("w243-b3-merge", { stdout: QUEUE_RULES }, false, (x) => {
    advanceOrigin(x, "trunk.txt", "a new trunk file changes the SOURCE tree\n");
    git(x.wt, ["fetch", "-q", "origin", "master"]);
    git(x.wt, ["merge", "-q", "--no-ff", "-m", "merge master into the opus branch", "FETCH_HEAD"]);
    mergeCommit = git(x.wt, ["rev-parse", "HEAD"]);
    writeReceipt(x, "current");
  });
  expectStep(next(w, [OPUS]), "pr", "named", "the minted, reviewed merged head names pr");
  const o = performPr(w);
  expectHeld(o, "a merge commit on the opus branch holds pr");
  const why = outLines(o).find((l) => l.startsWith("why:"));
  assert.ok(why?.startsWith(`why: refusing: ${BRANCH} carries merge commit ${mergeCommit.slice(0, 12)}`), ran("the why names the merge commit", o));
  assert.deepEqual(mutating(w), ["git fetch master:master"], ran("nothing is pushed or created", o));
  assert.equal(remoteBranchExists(w), false, "the branch never reached origin");
  assert.equal(modeLine(o), undefined, ran("held before the mode read", o));

  // a merge-commit list that cannot be read holds too (fails closed)
  const f = queueWorld("w243-b3-unreadable", { stdout: QUEUE_RULES });
  const blind = next(f, [OPUS, "--perform", "--expect", "pr", ...prArgs, ...FAST], { env: { GIT_STUB_REAL: failingGit("w243-b3-revlist", ["rev-list --merges"]) } });
  expectHeld(blind, "an unreadable merge-commit list holds pr");
  assert.ok(outLines(blind).some((l) => l.startsWith(`why: refusing: could not list ${BRANCH}'s merge commits`)), ran("the why", blind));
  assert.deepEqual(mutating(f), ["git fetch master:master"], ran("nothing is pushed", blind));
});

// ---------------------------------------------------------------------------
// W-214 behaviour 1: the checkpoint's history row rides the done commit, so an opus closes in one records PR
// ---------------------------------------------------------------------------
test("W-214-b1 behaviour 1: done refuses until the checkpoint's history row naming the opus rides with the handoff", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  const ROW = "docs/design/dossier/progress-body.html";
  const MAST = "docs/design/dossier/body.html";
  const w = world("w214-b1", "cleanup");
  put(w.repo, ROW, "<tr><td>W-899 shipped</td></tr>\n");
  put(w.repo, MAST, "<p>cascade 1: W-899</p>\n");
  commit(w.repo, "test: master keeps the history page and the masthead");
  git(w.repo, ["push", "-q", "origin", "master"]);
  scenario(w, { list: mergedList(w) });
  touchHandoff(w);
  const still = (): string => [git(w.repo, ["rev-parse", "HEAD", "master"]), git(w.repo, ["ls-files", "-s"]), git(w.repo, ["status", "--porcelain"]), git(w.repo, ["branch", "--list"])].join("\n--\n");
  const refusedRow = (label: string): void => {
    const was = still();
    const o = next(w, [OPUS, "--perform", "--expect", "done"]);
    expectHeld(o, label);
    assert.ok(outLines(o).some((l) => /^why: refusing: .*progress-body\.html.*W-900/.test(l)), ran(`${label}: the why line names the history page and the opus`, o));
    assert.equal(still(), was, ran(`${label}: nothing is mutated`, o));
    assert.equal(branchExists(w, chore), false, `${label}: no chore/done-<id> is made`);
  };
  // the handoff alone, as every done before W-214 committed it, no longer closes the opus
  refusedRow("the handoff without the history row");
  // a row that names another opus, or the id as a prefix of a longer one, is not the opus's row
  appendFileSync(join(w.repo, ROW), "<tr><td>W-9000 and W-901 shipped</td></tr>\n");
  refusedRow("a row naming W-9000 and W-901");
  // the history page deleted from the working tree adds no row
  rmSync(join(w.repo, ROW));
  refusedRow("the history page deleted");
  // the row naming the opus and the masthead ride the done commit with the record and the handoff
  put(w.repo, ROW, `<tr><td>W-899 shipped</td></tr>\n<tr><td>${OPUS} shipped</td></tr>\n`);
  put(w.repo, MAST, `<p>cascade 2: ${OPUS}</p>\n`);
  expectStep(next(w, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the row naming the opus admits done");
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/${chore}`]).split("\n").sort();
  assert.deepEqual(paths, ["docs/SESSION-HANDOFF.md", MAST, ROW, `studio/opera/${OPUS}.md`], "the record, the handoff, the masthead and the history row are one commit");
});

// ---------------------------------------------------------------------------
// W-259 behaviour 1: done records the merge queue's certify certificate
// ---------------------------------------------------------------------------
test("W-259-b1 behaviour 1: the done perform records the merge queue's certify certificate for the merge commit, and names verify when it cannot", { timeout: 1_800_000 }, () => {
  const w = world("w259-b1", "cleanup", { automated: true });
  const merge = w.mergeOid!;
  const tree = `tree:${sourceTreeHash(w.repo, ["studio", ".bisellium"], merge)}`;
  const RUN = 4242;
  const receipt = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({ sella: `builder.${OPUS}`, harness: "run", exitCode: 0, completion: { schema: 1, origin: "host-producer", opus: OPUS, branch: BRANCH, builder: `builder.${OPUS}`, producer: "producer", baseCommit: merge, finalCommit: merge, toolingCommit: merge, finalSourceTree: tree, redReplays: [], gates: { ci: true, verify: true, check: true }, teardownComplete: true, completed: true, ...over } });
  const certifyLog = (pr = PR_NUMBER, exit = 0): string => `certify: merge group for PR #${pr}\ncertify: running the mint\ntests: passed  ci/${OPUS}-tests-${tree.slice(5, 13)}.log\ncertify: the mint exited ${exit}\n`;
  const ci = (o: { runs?: unknown; jobs?: unknown; files?: Record<string, string>; download?: number } = {}): void =>
    scenario(w, {
      list: mergedList(w),
      runList: { stdout: o.runs ?? [{ databaseId: RUN, headSha: merge, event: "merge_group", status: "completed", conclusion: "success" }] },
      runView: { stdout: { jobs: o.jobs ?? [{ name: "gates", conclusion: "success" }, { name: "certify", conclusion: "success" }] } },
      runDownload: o.download === undefined ? { stdout: "", files: o.files ?? { [`bisellium/bisellium/candidate/studio/receipts/builder.${OPUS}/r.json`]: receipt(), "_temp/certify.log": certifyLog() } } : { exit: o.download, stderr: "artifact expired" },
    });
  const verify = `bisellium verify ${OPUS} --studio studio --repo .`;
  const perform = (): Out => next(w, [OPUS, "--perform", "--expect", "done"]);
  const logName = `studio/ci/${OPUS}-tests-${tree.slice(5)}.log`;

  // the rung names the perform, not verify
  ci();
  const named = next(w, [OPUS]);
  expectStep(named, "done", "named", "no certificate: done is named");
  assert.equal(named.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("the command is the done perform", named));

  // every case certify cannot vouch for holds, names verify, and writes nothing
  touchHandoff(w);
  const record = readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8");
  const heldWith = (row: string, why: RegExp): void => {
    const o = perform();
    expectHeld(o, row);
    const line = outLines(o).find((l) => l.startsWith("why: ")) ?? "";
    assert.match(line, why, ran(`${row}: the reason`, o));
    assert.ok(line.includes(verify), ran(`${row}: the why line names verify`, o));
    assert.equal(readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8"), record, `${row}: the record is unchanged`);
    assert.equal(existsSync(join(w.repo, logName)), false, `${row}: no certificate log`);
    assert.equal(branchExists(w, `chore/done-${OPUS}`), false, `${row}: no chore/done-<id>`);
  };
  ci({ runs: [] });
  heldWith("no run", /0 merge-queue CI runs name the merge commit/);
  ci({ runs: [{ databaseId: RUN, headSha: merge, event: "merge_group", status: "completed", conclusion: "failure" }] });
  heldWith("a failed run", /CI run 4242 is completed, failure/);
  ci({ jobs: [{ name: "certify", conclusion: "skipped" }] });
  heldWith("certify skipped", /no one successful certify job/);
  ci({ download: 1 });
  heldWith("an expired artifact", /gh run download of certify-4242 failed/);
  ci({ files: { [`receipts/r.json`]: receipt({ finalSourceTree: `tree:${"0".repeat(40)}` }), "certify.log": certifyLog() } });
  heldWith("a receipt of another tree", /not the merge commit's tree:/);
  ci({ files: { [`receipts/r.json`]: receipt({ opus: "W-901" }), "certify.log": certifyLog() } });
  heldWith("another opus's receipt", /the receipt is not W-900's/);
  ci({ files: { [`receipts/r.json`]: receipt(), "certify.log": certifyLog(PR_NUMBER, 1) } });
  heldWith("a mint that failed", /does not show PR #901's mint exiting 0/);
  ci({ files: { "certify.log": certifyLog() } });
  heldWith("no receipt", /holds 0 receipt\(s\) and 1 certify\.log/);
  // master's source moved since the merge by a commit no merge-queue run certifies (W-330: a certified one is a chain, W-330-b1)
  put(w.repo, "source.txt", "a later source change\n");
  git(w.repo, ["commit", "-q", "-m", "feat: later", "--", "source.txt"]);
  ci();
  heldWith("source moved since the merge", /master's source changed since the merge commit [0-9a-f]{12} at [0-9a-f]{12} \(source\.txt\), and 0 merge-queue CI runs name the commit [0-9a-f]{12}/);
  git(w.repo, ["reset", "-q", "--hard", merge]);
  // a records-only commit that changes what the certificate must cover: a new automated gate, or the opus's own record
  put(w.studio, "bisellium.yml", readFileSync(join(w.studio, "bisellium.yml"), "utf8").replace("source_excludes:", '  - { id: lint, name: Lint, kind: automated, command: "node -e 0" }\nsource_excludes:'));
  git(w.repo, ["commit", "-q", "-m", "chore(studio): a records PR adds a gate", "--", "studio/bisellium.yml"]);
  touchHandoff(w);
  ci();
  heldWith("a gate added since the merge", /master changed studio\/bisellium\.yml since the merge commit [0-9a-f]{12}, which certify's run did not judge/);
  assert.equal(existsSync(join(w.studio, "ci", `${OPUS}-lint-${tree.slice(5)}.log`)), false, "a gate added since the merge: no lint log");
  git(w.repo, ["reset", "-q", "--hard", merge]);
  editRecord(w, "repo", (doc) => doc.setIn(["title"], "W-124 fixture: retitled by a records PR"));
  git(w.repo, ["commit", "-q", "-m", "chore(studio): a records PR edits the record", "--", `studio/opera/${OPUS}.md`]);
  touchHandoff(w);
  const recordAfter = readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8");
  const o = perform();
  expectHeld(o, "the record changed since the merge");
  assert.match(outLines(o).find((l) => l.startsWith("why: ")) ?? "", new RegExp(`master changed studio/opera/${OPUS}\\.md since the merge commit`), ran("the record changed since the merge: the reason", o));
  assert.equal(readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8"), recordAfter, "the record changed since the merge: the record is unchanged");
  assert.equal(existsSync(join(w.repo, logName)), false, "the record changed since the merge: no certificate log");
  git(w.repo, ["reset", "-q", "--hard", merge]);
  touchHandoff(w);

  // a symlink planted at the certificate log's predictable name is never written through (review round 1: security×symlink-parent-write-escape)
  const outside = join(w.repo, "..", "w259-outside.txt");
  writeFileSync(outside, "outside the officina\n");
  mkdirSync(join(w.repo, "studio", "ci"), { recursive: true });
  symlinkSync(outside, join(w.repo, logName));
  ci();
  const linked = perform();
  expectHeld(linked, "a symlink at the certificate log's name");
  assert.match(outLines(linked).find((l) => l.startsWith("why: ")) ?? "", /the merge queue's certify certificate cannot be recorded/, ran("the symlinked log: the reason", linked));
  assert.equal(readFileSync(outside, "utf8"), "outside the officina\n", "the symlinked log: the outside file is byte-identical");
  assert.equal(lstatSync(join(w.repo, logName)).isSymbolicLink(), true, "the symlinked log: still the planted link, no log written");
  assert.equal(branchExists(w, `chore/done-${OPUS}`), false, "the symlinked log: no chore/done-<id>");
  rmSync(join(w.repo, logName));
  rmSync(outside);

  // records alone moved since the merge: the merge commit's certificate is recorded and the done record committed
  // a records PR after the merge: the handoff is a record (recordOnly) but inside the source tree, as on master after #541
  git(w.repo, ["commit", "-q", "-m", "chore(studio): a records PR", "--", "docs/SESSION-HANDOFF.md"]);
  touchHandoff(w);
  assert.notEqual(sourceTree(w.repo), tree, "the fixture: master's tree is not the merge commit's");
  ci();
  const done = perform();
  assert.equal(done.status, 0, ran("perform exits 0", done));
  expectStep(done, "done", "performed", "done is performed over certify's certificate");
  assert.ok(outLines(done).includes(`certificate: certify run ${RUN}, PR #${PR_NUMBER}, merge commit ${merge.slice(0, 12)}, ${tree}`), ran("the certificate line", done));
  const chore = `chore/done-${OPUS}`;
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/${chore}`]).split("\n").sort();
  assert.deepEqual(paths, ["docs/SESSION-HANDOFF.md", logName, `studio/opera/${OPUS}.md`], "the done commit carries the handoff, certify's log and the record");
  const committed = git(w.repo, ["show", `refs/heads/${chore}:${logName}`]);
  assert.equal(committed.split("\n")[0], `certifies: ${tree}`, "the log's first line is its certificate");
  assert.match(committed, new RegExp(`CI run ${RUN}, PR #${PR_NUMBER}, merge commit ${merge}`), "the log names the run, the PR and the merge commit");
  const rec = parseFrontMatter(git(w.repo, ["show", `refs/heads/${chore}:studio/opera/${OPUS}.md`])).data as Json;
  assert.deepEqual((rec["probationes"] as Json)["tests"], { status: "passed", evidence: `ci/${OPUS}-tests-${tree.slice(5)}.log`, certifies: tree }, "the record's tests gate certifies the merge commit's tree");
  assert.equal(rec["state"], "done", "the record is done");
  const runCalls = ghCalls(w).filter((a) => a[0] === "run");
  assert.deepEqual(runCalls.map((a) => a[1]), ["list", "view", "download"], "one run list, view and download");
  assert.ok(runCalls[0]!.includes(merge) && runCalls[0]!.includes("merge_group"), "the run list names the merge commit and the merge_group event");
});

// ---------------------------------------------------------------------------
// W-299 behaviour 2: the done rung asks no handoff edit (D-077 B, absorbing W-247)
// ---------------------------------------------------------------------------
test("W-299-b2 behaviour 2: the done rung asks no handoff edit: the perform commits without one and the checkpoint reads complete", { timeout: 1_800_000 }, () => {
  const w = world("w299-b2", "cleanup");
  scenario(w, { list: mergedList(w) });
  const handoff = readFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), "utf8");
  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectStep(done, "done", "performed", "the perform commits with no handoff change");
  const chore = `chore/done-${OPUS}`;
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", git(w.repo, ["rev-parse", `refs/heads/${chore}`])]).split("\n").sort();
  assert.deepEqual(paths, [`studio/opera/${OPUS}.md`], "the done commit holds the record alone");
  assert.equal(readFileSync(join(w.repo, "docs/SESSION-HANDOFF.md"), "utf8"), handoff, "the handoff is untouched");
  // a trunk done record whose commit left the handoff unchanged completes the ladder, with no later handoff edit
  const d = world("w299-b2-done", "done");
  const complete = next(d, [OPUS]);
  expectStep(complete, "checkpoint", "complete", "a done commit that left the handoff unchanged reads the checkpoint complete");
  assert.equal(complete.status, 0, ran("complete exits 0", complete));
});

// ---------------------------------------------------------------------------
// W-330: the done perform accepts a certified chain (D-087 B)
// ---------------------------------------------------------------------------
/** A cleaned-up W-900 with one automated gate, master at its merge commit, and helpers that move master on. */
function chainWorld(tag: string) {
  const w = world(tag, "cleanup", { automated: true });
  const merge = w.mergeOid!;
  /** A later lane's merge-queue squash merge on master: a source file, its subject naming PR #<pr>. */
  const lane = (file: string, pr: number, subject = `feat(W-${pr - 1}): a later lane (#${pr})`, more: string[] = []): string => {
    put(w.repo, file, `${file}: a later lane's source\n`);
    git(w.repo, ["add", "--", file, ...more]);
    git(w.repo, ["commit", "-q", "-m", subject]);
    return git(w.repo, ["rev-parse", "HEAD"]);
  };
  /** A records PR on master that changes the handoff, which the source tree hashes (as #607 did after #605). */
  const records = (): string => {
    touchHandoff(w);
    git(w.repo, ["commit", "-q", "-m", "chore(studio): a records PR (#990)", "--", "docs/SESSION-HANDOFF.md"]);
    return git(w.repo, ["rev-parse", "HEAD"]);
  };
  const treeOf = (sha: string): string => `tree:${sourceTreeHash(w.repo, ["studio", ".bisellium"], sha)}`;
  return { w, merge, lane, records, treeOf };
}
const CHAIN_RUN = 4343;
/** A branch read with two valid answers (git show-ref: 0 present, 1 absent); any other failure throws, so "no chore branch" cannot pass on a git error. */
const chainBranchExists = (w: World, name: string): boolean => gitYesNo(w.repo, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
const chainRun = (sha: string, databaseId = CHAIN_RUN, conclusion = "success"): Json => ({ databaseId, headSha: sha, event: "merge_group", status: "completed", conclusion });
const chainReceipt = (opus: string, tree: string): string =>
  JSON.stringify({ sella: `builder.${opus}`, harness: "run", exitCode: 0, completion: { schema: 1, origin: "host-producer", opus, branch: `opus/${opus}`, builder: `builder.${opus}`, producer: "producer", finalSourceTree: tree, redReplays: [], gates: { ci: true, verify: true, check: true }, teardownComplete: true, completed: true } });
/** certify.log as ci-certify.mjs writes it for an opus head (artifact-605's shape). */
const chainLog = (pr: number | string, opus: string, base: string): string => `certify: merge group for PR #${pr}\ncertify: fetching refs/pull/${pr}/head and master\ncertify: rebasing opus/${opus} onto ${base.slice(0, 12)}\ncertify: running the mint\ncertify: the mint exited 0\n`;
function chainScenario(w: World, o: { runs?: Json[]; runList?: SlotValue; jobs?: Json[]; files: Record<string, string> }): void {
  scenario(w, {
    list: mergedList(w),
    runList: o.runList ?? { stdout: o.runs ?? [] },
    runView: { stdout: { jobs: o.jobs ?? [{ name: "gates", conclusion: "success" }, { name: "certify", conclusion: "success" }] } },
    runDownload: { stdout: "", files: o.files },
  });
}

test("W-330-b1 behaviour 1: when master's source moved since the merge only by a certified merge-queue merge and records, the done perform records that merge's certify certificate, naming its tree", { timeout: 1_800_000 }, () => {
  const { w, merge, lane, records, treeOf } = chainWorld("w330-b1");
  // W-317 merged (#606), then W-299 (#605), then a records PR (#607): the live case on master cf8a96f8
  const later = lane("lane.txt", 903);
  records();
  const tree = treeOf(later);
  assert.notEqual(tree, treeOf(merge), "the fixture: the later merge changed source");
  assert.notEqual(sourceTree(w.repo), tree, "the fixture: master's tree is not the later merge's (the records PR changed the handoff)");
  chainScenario(w, { runs: [chainRun(later)], files: { "receipts/r.json": chainReceipt("W-902", tree), "certify.log": chainLog(903, "W-902", merge) } });
  const named = next(w, [OPUS]);
  assert.equal(named.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("the chain's rung names the done perform", named));
  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  assert.equal(done.status, 0, ran("the certified chain's certificate is recorded: exit 0", done));
  expectStep(done, "done", "performed", "the certified chain's certificate is recorded");
  assert.ok(outLines(done).includes(`certificate: certify run ${CHAIN_RUN}, PR #903, merge commit ${later.slice(0, 12)}, ${tree}`), ran("the certificate names the later merge's run, PR, commit and tree", done));
  assert.ok(outLines(done).includes(`certificate: the certified chain since ${OPUS}'s merge commit ${merge.slice(0, 12)}: ${later.slice(0, 12)}`), ran("the chain line", done));
  const chore = `chore/done-${OPUS}`;
  const logName = `studio/ci/${OPUS}-tests-${tree.slice(5)}.log`;
  const paths = git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", `refs/heads/${chore}`]).split("\n").sort();
  assert.deepEqual(paths, [logName, `studio/opera/${OPUS}.md`], "the done commit carries certify's log and the record");
  const committed = git(w.repo, ["show", `refs/heads/${chore}:${logName}`]);
  assert.equal(committed.split("\n")[0], `certifies: ${tree}`, "the log certifies the later merge's tree");
  assert.match(committed, new RegExp(`CI run ${CHAIN_RUN}, PR #903, merge commit ${later} \\(the newest of 1 certified source commit\\(s\\) on master since ${OPUS}'s merge commit ${merge}\\)`), "the log names the run, the PR, the later merge and the opus's merge commit");
  const rec = parseFrontMatter(git(w.repo, ["show", `refs/heads/${chore}:studio/opera/${OPUS}.md`])).data as Json;
  assert.deepEqual((rec["probationes"] as Json)["tests"], { status: "passed", evidence: `ci/${OPUS}-tests-${tree.slice(5)}.log`, certifies: tree }, "the record's tests gate certifies the later merge's tree");
  assert.equal(rec["state"], "done", "the record is done");
  const runCalls = ghCalls(w).filter((a) => a[0] === "run");
  assert.deepEqual(runCalls.map((a) => a[1]), ["list", "view", "download"], "one run list, view and download");
  assert.ok(runCalls[0]!.includes(later) && !runCalls[0]!.includes(merge), "the run list names the later merge, not the opus's merge commit");
});

test("W-330-b2 behaviour 2: every source commit of the chain needs its own certify run, and a link the perform cannot read holds and names verify", { timeout: 1_800_000 }, () => {
  const { w, merge, lane, records, treeOf } = chainWorld("w330-b2");
  const verify = `bisellium verify ${OPUS} --studio studio --repo .`;
  const record = readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8");
  const heldWith = (row: string, why: RegExp): void => {
    const o = next(w, [OPUS, "--perform", "--expect", "done"]);
    expectHeld(o, row);
    const line = outLines(o).find((l) => l.startsWith("why: ")) ?? "";
    assert.match(line, why, ran(`${row}: the reason`, o));
    assert.ok(line.includes(verify), ran(`${row}: the why line names verify`, o));
    assert.equal(readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8"), record, `${row}: the record is unchanged`);
    assert.equal(chainBranchExists(w, `chore/done-${OPUS}`), false, `${row}: no chore/done-<id>`);
  };
  const reset = (): void => void git(w.repo, ["reset", "-q", "--hard", merge]);
  const h = (sha: string): string => sha.slice(0, 12);

  // a chain with a non-certified source commit refuses, even when the newest is certified
  let early = lane("early.txt", 902);
  let later = lane("lane.txt", 903);
  chainScenario(w, { runs: [chainRun(later)], files: { "receipts/r.json": chainReceipt("W-902", treeOf(later)), "certify.log": chainLog(903, "W-902", early) } });
  heldWith("a chain with a non-certified source commit refuses", new RegExp(`master's source changed since the merge commit ${h(merge)} at ${h(early)} \\(early\\.txt\\), and 0 merge-queue CI runs name the commit ${h(early)}`));
  chainScenario(w, { runs: [chainRun(early, 4342, "failure"), chainRun(later)], files: { "receipts/r.json": chainReceipt("W-902", treeOf(later)), "certify.log": chainLog(903, "W-902", early) } });
  heldWith("an older source commit whose run failed refuses", new RegExp(`at ${h(early)} \\(early\\.txt\\), and CI run 4342 is completed, failure`));
  reset();

  // the merge commit off master's first-parent line refuses
  git(w.repo, ["checkout", "-q", "--detach", `${merge}~1`]);
  put(w.repo, "side.txt", "a side line's source\n");
  git(w.repo, ["add", "--", "side.txt"]);
  git(w.repo, ["commit", "-q", "-m", "feat: a side line (#904)"]);
  git(w.repo, ["merge", "-q", "--no-ff", "-m", "merge the opus in from the side (#905)", merge]);
  git(w.repo, ["branch", "-f", "master", "HEAD"]);
  git(w.repo, ["switch", "-q", "master"]);
  const side = git(w.repo, ["rev-parse", "HEAD"]);
  chainScenario(w, { runs: [chainRun(side)], files: { "receipts/r.json": chainReceipt("W-904", treeOf(side)), "certify.log": chainLog(905, "W-904", merge) } });
  heldWith("the merge commit off master's first-parent line", new RegExp(`the merge commit ${h(merge)} is not on master's first-parent line`));
  reset();

  // the newest certified merge's own links: its run, the PR its subject names, the log, the receipt
  later = lane("lane.txt", 903);
  records();
  const tree = treeOf(later);
  const files = (pr = 903, opus = "W-902", receiptTree = tree, receiptOpus = opus): Record<string, string> => ({ "receipts/r.json": chainReceipt(receiptOpus, receiptTree), "certify.log": chainLog(pr, opus, merge) });
  chainScenario(w, { runs: [chainRun(later)], jobs: [{ name: "certify", conclusion: "skipped" }], files: files() });
  heldWith("the later merge's certify job skipped", new RegExp(`at ${h(later)} \\(lane\\.txt\\), and CI run ${CHAIN_RUN} has no one successful certify job`));
  chainScenario(w, { runList: { exit: 1, stderr: "HTTP 502" }, files: files() });
  heldWith("gh run list failing", new RegExp(`at ${h(later)} \\(lane\\.txt\\), and gh run list failed`));
  chainScenario(w, { runs: [chainRun(later)], files: files(904) });
  heldWith("a log for another PR than the subject names", /certify\.log does not show PR #903's mint exiting 0/);
  chainScenario(w, { runs: [chainRun(later)], files: files(903, "W-902", tree, "W-777") });
  heldWith("a receipt of another opus than the log rebased", /the receipt is not W-902's/);
  chainScenario(w, { runs: [chainRun(later)], files: files(903, "W-902", sourceTree(w.repo)) });
  heldWith("a receipt of master's tree, not the later merge's", new RegExp(`not the merge commit's ${tree}`));
  reset();
  later = lane("lane.txt", 903, "feat(W-902): a later lane with no PR number");
  chainScenario(w, { runs: [chainRun(later)], files: files() });
  heldWith("a subject that names no PR", new RegExp(`the commit ${h(later)}'s subject names no PR as \\(#<n>\\)`));
  reset();
  // adjacent PR numbers past Number.MAX_SAFE_INTEGER are different PRs: the subject binds to the log exactly
  later = lane("lane.txt", 903, "feat(W-902): a later lane (#9007199254740993)");
  chainScenario(w, { runs: [chainRun(later)], files: files(9007199254740992, "W-902", treeOf(later)) });
  heldWith("a log for the adjacent PR number past the safe integers", /certify\.log does not show PR #9007199254740993's mint exiting 0/);
  reset();

  // the policy refusals stand inside a chain: a certified merge that adds a gate, or edits the opus's record
  put(w.studio, "bisellium.yml", readFileSync(join(w.studio, "bisellium.yml"), "utf8").replace("source_excludes:", '  - { id: lint, name: Lint, kind: automated, command: "node -e 0" }\nsource_excludes:'));
  later = lane("lane.txt", 903, undefined, ["studio/bisellium.yml"]);
  chainScenario(w, { runs: [chainRun(later)], files: files(903, "W-902", treeOf(later)) });
  heldWith("a certified merge that adds a gate", new RegExp(`master changed studio/bisellium\\.yml since the merge commit ${h(merge)}, which certify's run did not judge`));
  reset();
  editRecord(w, "repo", (doc) => doc.setIn(["title"], "W-124 fixture: retitled by a later lane"));
  later = lane("lane.txt", 903, undefined, [`studio/opera/${OPUS}.md`]);
  const retitled = readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8");
  chainScenario(w, { runs: [chainRun(later)], files: files(903, "W-902", treeOf(later)) });
  const o = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectHeld(o, "a certified merge that edits the opus's record");
  assert.match(outLines(o).find((l) => l.startsWith("why: ")) ?? "", new RegExp(`master changed studio/opera/${OPUS}\\.md since the merge commit ${h(merge)}`), ran("a certified merge that edits the opus's record: the reason", o));
  assert.equal(readFileSync(join(w.studio, "opera", `${OPUS}.md`), "utf8"), retitled, "a certified merge that edits the opus's record: the record is unchanged");
  reset();

  // two certified merges: each one's run is read, and the newest one's receipt names the tree
  early = lane("early.txt", 902);
  later = lane("lane.txt", 903);
  chainScenario(w, { runs: [chainRun(early, 4342), chainRun(later)], files: { "receipts/r.json": chainReceipt("W-902", treeOf(later)), "certify.log": chainLog(903, "W-902", early) } });
  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  assert.equal(done.status, 0, ran("two certified merges: exit 0", done));
  assert.ok(outLines(done).includes(`certificate: certify run ${CHAIN_RUN}, PR #903, merge commit ${h(later)}, ${treeOf(later)}`), ran("two certified merges: the newest one's certificate", done));
  assert.ok(outLines(done).includes(`certificate: the certified chain since ${OPUS}'s merge commit ${h(merge)}: ${h(early)}, ${h(later)}`), ran("two certified merges: the chain line names both", done));
  const runCalls = ghCalls(w).filter((a) => a[0] === "run");
  assert.deepEqual(runCalls.map((a) => a[1]), ["list", "view", "list", "view", "download"], "two certified merges: each one's run is read, the newest one's artifact downloaded");
  assert.ok(runCalls[0]!.includes(early) && runCalls[2]!.includes(later) && runCalls[4]!.includes(String(CHAIN_RUN)), "two certified merges: oldest first, the newest run's artifact");
});

test("W-330-b2 behaviour 2 review round 2: an exactly matching PR number past the safe integers performs (W-334, ci/W-330-review-2.log #1)", { timeout: 1_800_000 }, () => {
  const { w, merge, lane, treeOf } = chainWorld("w334-w330-b2");
  // the other side of W-330-b2's adjacent-number case: a reader that refused every suffix past the safe integers would hold here
  const later = lane("lane.txt", 903, "feat(W-902): a later lane (#9007199254740993)");
  const tree = treeOf(later);
  chainScenario(w, { runs: [chainRun(later)], files: { "receipts/r.json": chainReceipt("W-902", tree), "certify.log": chainLog("9007199254740993", "W-902", merge) } });
  const done = next(w, [OPUS, "--perform", "--expect", "done"]);
  assert.equal(done.status, 0, ran("an exactly matching unbounded PR number performs: exit 0", done));
  expectStep(done, "done", "performed", "an exactly matching unbounded PR number performs");
  assert.ok(outLines(done).includes(`certificate: certify run ${CHAIN_RUN}, PR #9007199254740993, merge commit ${later.slice(0, 12)}, ${tree}`), ran("the certificate names the PR as the subject wrote it", done));
});

// ---------------------------------------------------------------------------
// W-370 behaviour 1: the done perform reads certify's certificate from its check run, through api.github.com
// ---------------------------------------------------------------------------
test("W-370-b1 behaviour 1: the done perform records certify's certificate from the one certify-certificate check run on the merge commit through gh api, downloads the artifact only when there is no check run, and holds on a doubled one", { timeout: 1_800_000 }, () => {
  const RUN = 4545;
  const setup = (tag: string) => {
    const w = world(tag, "cleanup", { automated: true });
    const merge = w.mergeOid!;
    const tree = `tree:${sourceTreeHash(w.repo, ["studio", ".bisellium"], merge)}`;
    const receipt = JSON.stringify({ sella: `builder.${OPUS}`, harness: "run", exitCode: 0, completion: { schema: 1, origin: "host-producer", opus: OPUS, branch: BRANCH, builder: `builder.${OPUS}`, producer: "producer", finalSourceTree: tree, redReplays: [], gates: { ci: true, verify: true, check: true }, teardownComplete: true, completed: true } });
    const log = `certify: merge group for PR #${PR_NUMBER}\ncertify: running the mint\ntests: passed  ci/${OPUS}-tests-${tree.slice(5, 13)}.log\ncertify: the mint exited 0\n`;
    const ci = { list: mergedList(w), runList: { stdout: [{ databaseId: RUN, headSha: merge, event: "merge_group", status: "completed", conclusion: "success" }] }, runView: { stdout: { jobs: [{ name: "gates", conclusion: "success" }, { name: "certify", conclusion: "success" }] } } };
    touchHandoff(w);
    return { w, merge, tree, receipt, log, ci, files: { "receipts/r.json": receipt, "certify.log": log }, logName: `studio/ci/${OPUS}-tests-${tree.slice(5)}.log` };
  };
  const perform = (w: World): Out => next(w, [OPUS, "--perform", "--expect", "done"]);
  const apiCalls = (w: World): string[][] => ghCalls(w).filter((c) => c[0] === "api");
  const READ = (merge: string): string[] => ["api", "--method", "GET", `repos/${SLUG}/commits/${merge}/check-runs`, "-f", "check_name=certify-certificate", "-f", "filter=all", "-f", "per_page=100"];
  const chore = `chore/done-${OPUS}`;

  const a = setup("w370-b1");
  const record = readFileSync(join(a.w.studio, "opera", `${OPUS}.md`), "utf8");
  const run = certificateRun({ sha: a.merge, runId: RUN, receipt: a.receipt, log: a.log, id: 9001 });

  // two check runs (a re-run, or another writer) and an artifact the stub would serve: the perform holds, names verify and downloads nothing
  scenario(a.w, { ...a.ci, runDownload: { stdout: "", files: a.files }, checkRuns: checkRunsOf(run, { ...run, id: 9002 }) });
  const held = perform(a.w);
  expectHeld(held, "two check runs, an artifact present");
  const why = outLines(held).find((l) => l.startsWith("why: ")) ?? "";
  assert.match(why, /2 certify-certificate check runs name the commit [0-9a-f]{12}/, ran("two check runs: the reason", held));
  assert.ok(why.includes(`bisellium verify ${OPUS} --studio studio --repo .`), ran("two check runs: the why line names verify", held));
  assert.equal(ghCalls(a.w).some((c) => c[0] === "run" && c[1] === "download"), false, "two check runs: no artifact is downloaded");
  assert.equal(readFileSync(join(a.w.studio, "opera", `${OPUS}.md`), "utf8"), record, "two check runs: the record is unchanged");
  assert.equal(existsSync(join(a.w.repo, a.logName)), false, "two check runs: no certificate log");

  // one check run and every download refused: the certificate is recorded and done committed
  scenario(a.w, { ...a.ci, checkRuns: checkRunsOf(run) });
  const done = perform(a.w);
  assert.equal(done.status, 0, ran("the check run's certificate: exit 0", done));
  expectStep(done, "done", "performed", "done is performed over the check run's certificate");
  assert.ok(outLines(done).includes(`certificate: certify run ${RUN}, PR #${PR_NUMBER}, merge commit ${a.merge.slice(0, 12)}, ${a.tree}`), ran("the certificate line", done));
  const committed = git(a.w.repo, ["show", `refs/heads/${chore}:${a.logName}`]);
  assert.equal(committed.split("\n")[0], `certifies: ${a.tree}`, "the log's first line is its certificate");
  // one-sided: the line's start is the command text certify's gate log prints before the run, which the row does not pin
  assert.match(committed, new RegExp(`CI run ${RUN}, PR #${PR_NUMBER}, merge commit ${a.merge}, receipt sha256:[0-9a-f]{64}, check run 9001$`, "m"), "the log names the run, the PR, the merge commit and the check run");
  assert.ok(committed.includes("certify: the mint exited 0"), "the log carries certify.log's tail");
  const rec = parseFrontMatter(git(a.w.repo, ["show", `refs/heads/${chore}:studio/opera/${OPUS}.md`])).data as Json;
  assert.deepEqual((rec["probationes"] as Json)["tests"], { status: "passed", evidence: `ci/${OPUS}-tests-${a.tree.slice(5)}.log`, certifies: a.tree }, "the record's tests gate certifies the merge commit's tree");
  assert.deepEqual(ghCalls(a.w).filter((c) => c[0] === "run").map((c) => c[1]), ["list", "view"], "one run list and view, no download");
  assert.deepEqual(apiCalls(a.w), [READ(a.merge)], "one read of the merge commit's certify-certificate check runs, through api.github.com");

  // no check run (every merge until W-396's job posts one): the check runs are read, then the artifact, as today
  const b = setup("w370-b1-none");
  scenario(b.w, { ...b.ci, runDownload: { stdout: "", files: b.files }, checkRuns: checkRunsOf() });
  const fallback = perform(b.w);
  assert.equal(fallback.status, 0, ran("no check run: the artifact's certificate, exit 0", fallback));
  expectStep(fallback, "done", "performed", "no check run: done is performed over the artifact's certificate");
  assert.deepEqual(apiCalls(b.w), [READ(b.merge)], "no check run: the check runs are read first");
  assert.deepEqual(ghCalls(b.w).filter((c) => c[0] === "run").map((c) => c[1]), ["list", "view", "download"], "no check run: then the artifact is downloaded");
  const kept = git(b.w.repo, ["show", `refs/heads/${chore}:${b.logName}`]);
  // one-sided: the line's start is the command text certify's gate log prints before the run, which the row does not pin
  assert.match(kept, new RegExp(`merge commit ${b.merge}, receipt sha256:[0-9a-f]{64}$`, "m"), "no check run: the log names no check run");
});

// ---------------------------------------------------------------------------
// W-384: the done land's W-347 re-arm on a records PR that is already merged
// ---------------------------------------------------------------------------
/**
 * The gh world of landing `head` in queue mode: an OPEN, CLEAN records PR outside the merge queue, so the merge step re-arms
 * auto-merge. The call `failing` ("disable" or "enable") exits 1 with GitHub's already-merged text; with `merges`, that call
 * also merges the PR (the flag), so every later read says MERGED on the pinned head.
 */
function rearmScenario(w: World, head: string, failing: "disable" | "enable", merges: boolean): { merge: string } {
  const merged = join(w.root, "merged.flag");
  const oid = git(w.repo, ["rev-parse", `refs/heads/${head}`]);
  const m = git(w.repo, ["commit-tree", `${head}^{tree}`, "-p", "master", "-m", `squash ${head} (#${PR_NUMBER})`]);
  git(w.repo, ["push", "-q", "origin", `${m}:refs/heads/master`]);
  const open = cand(w, { state: "OPEN", head, oid, mss: "CLEAN" });
  const done = cand(w, { state: "MERGED", head, oid, merge: m });
  const refused: Reply = { exit: 1, stderr: `GraphQL: Pull request is already merged (${failing === "disable" ? "disablePullRequestAutoMerge" : "enablePullRequestAutoMerge"})\n`, ...(merges ? { touch: merged } : {}) };
  rawScenario(w, [
    { match: ["pr", "list", "--head", BRANCH], replies: [{ stdout: [cand(w, { state: "MERGED" })] }] },
    { match: ["pr", "list", "--head", head], replies: [{ stdout: [open] }], alts: [{ ifExists: merged, replies: [{ stdout: [done] }] }] },
    { match: ["pr", "list"], replies: [{ stdout: [] }] },
    { match: ["pr", "view"], replies: [{ stdout: viewOf(open) }], alts: [{ ifExists: merged, replies: [{ stdout: viewOf(done) }] }] },
    { match: SLOT_MATCH.repoView, replies: [{ stdout: { nameWithOwner: SLUG } }] },
    { match: SLOT_MATCH.checks, replies: [{ stdout: greens() }] },
    { match: SLOT_MATCH.rules, replies: [{ stdout: QUEUE_RULES }] },
    { match: SLOT_MATCH.queue, replies: [{ stdout: { data: { repository: { pullRequest: { isInMergeQueue: false } } } } }] },
    { match: SLOT_MATCH.alerts, replies: [{ stdout: [] }] },
    { match: SLOT_MATCH.merge, replies: failing === "disable" ? [{ stdout: "" }, refused] : [{ stdout: "" }, { stdout: "" }, refused] },
  ]);
  return { merge: m };
}

test("W-384-b1 behaviour 1: the done land counts a records PR as landed when the auto-merge re-arm fails because the PR is already merged on its pinned head, and keeps any other failure", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  const doneCommitted = (tag: string): World => {
    const w = world(tag, "cleanup");
    scenario(w, { list: mergedList(w) });
    touchHandoff(w);
    expectStep(next(w, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the done commit is made first");
    return w;
  };
  /** The gh calls after the first failing `pr merge`, labelled. */
  const afterFailure = (w: World, nth: number): string[] => {
    const gh = ghCalls(w);
    let seen = 0;
    const at = gh.findIndex((a) => a[0] === "pr" && a[1] === "merge" && ++seen === nth);
    return gh.slice(at + 1).map((a) => `${a[0]} ${a[1]}`);
  };

  for (const failing of ["disable", "enable"] as const) {
    const w = doneCommitted(`w384-b1-${failing}-merged`);
    const head = git(w.repo, ["rev-parse", `refs/heads/${chore}`]);
    const { merge } = rearmScenario(w, chore, failing, true);
    const o = next(w, [OPUS, "--perform", "--expect", "done", ...FAST]);
    const call = failing === "disable" ? "gh pr merge --disable-auto" : "gh pr merge --squash --auto \\(re-enabling\\)";
    expectStep(o, "done", "performed", `${failing}: an already-merged records PR is landed, not held`);
    assert.equal(o.status, 0, ran(`${failing}: the land exits 0`, o));
    assert.match(o.out, new RegExp(`^merge: ${call} failed \\(GraphQL: Pull request is already merged \\([a-zA-Z]+\\)\\); PR #${PR_NUMBER} reads MERGED at its pinned head ${head.slice(0, 12)}$`, "m"), ran(`${failing}: the failed call and the merged read are both named`, o));
    assert.match(o.out, /^state=MERGED$/m, ran(`${failing}: state=MERGED`, o));
    assert.doesNotMatch(o.out, /MERGE_FAILED/, ran(`${failing}: no MERGE_FAILED`, o));
    const merges = failing === "disable" ? ["gh pr merge --squash --auto", "gh pr merge --disable-auto"] : ["gh pr merge --squash --auto", "gh pr merge --disable-auto", "gh pr merge --squash --auto"];
    assert.deepEqual(mutating(w).filter((c) => c.startsWith("gh pr merge")), merges, ran(`${failing}: no merge call follows the failed one`, o));
    assert.deepEqual(afterFailure(w, merges.length).slice(0, 1), ["pr view"], ran(`${failing}: the failed call is followed by one fresh pr view`, o));
    assert.equal(git(w.repo, ["rev-parse", "master"]), merge, ran(`${failing}: master is fast-forwarded to the merge commit`, o));
    assert.equal(branchExists(w, chore), false, ran(`${failing}: the local records head is deleted`, o));
    assert.equal(originHas(w, chore), false, ran(`${failing}: the remote records head is deleted`, o));
    assert.deepEqual(unmatched(w), [], `${failing}: the fixture saw every gh call`);
  }

  // the same failure on a PR that still reads OPEN keeps the failure: nothing is fetched or deleted
  const kept = doneCommitted("w384-b1-disable-open");
  rearmScenario(kept, chore, "disable", false);
  const before = git(kept.repo, ["rev-parse", "master"]);
  const held = next(kept, [OPUS, "--perform", "--expect", "done", ...FAST]);
  expectHeld(held, "a failed disable on an OPEN PR holds");
  assert.deepEqual(outLines(held).filter((l) => l.startsWith("state=") || l.startsWith("why:")), ["state=MERGE_FAILED", "why: disabling auto-merge before re-arming it failed: GraphQL: Pull request is already merged (disablePullRequestAutoMerge)"], ran("the failure is the call's own, unchanged", held));
  // after the perform, the ladder's own derivation reads the PR list again; the perform itself makes one read and no call
  assert.deepEqual(afterFailure(kept, 2).filter((c) => c !== "pr list" && c !== "repo view"), ["pr view"], ran("one fresh pr view and no other call", held));
  assert.equal(git(kept.repo, ["rev-parse", "master"]), before, "master did not move");
  assert.equal(branchExists(kept, chore), true, "the records head stays");
  assert.equal(originHas(kept, chore), true, "the remote records head stays");
});
