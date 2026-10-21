/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, appendFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { admitCurrentRunReceipt } from "@bisellium/commands/builder-run.js";
import { BRANCH, CAND, FAST, Json, NOW_ISO, NOW_MS, OID_UNFETCHED, OPUS, Out, PROC_ENV, RunOpts, T, World, addReview, advanceSource, branchExists, briefText, calls, cand, commit, deadPid, editRecord, expectHeld, expectStep, fakeProc, ghCalls, ghMerges, git, gitArgs, gitCalls, gitOk, gitq, handoffAt, landMerge, liveChild, markDone, markerJson, markerPath, markerText, mergedList, mutating, next, nextAsync, only, openList, outputPath, performMerge, pushed, put, putMarker, putOutput, ran, recordOf, recordText, runs, scenario, snap, sourceTree, statLine, stepsDir, tickOf, ticketed, tipOf, touchHandoff, verb, world, writeGates, writeReds, writeTranscript, zombiePid } from "./next-world.test.js";


// ---------------------------------------------------------------------------
// fixture self-check: the worlds this file builds are what the real verbs read
// ---------------------------------------------------------------------------
if (only === undefined) {
  test("W-124 fixtures: worlds agree with the real verbs and the real gh shapes", () => {
    const w = world("sanity", "review");
    assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, true, "the current receipt is admitted by the real validator");
    const header = readFileSync(join(w.wtStudio, "ci", `${OPUS}-review-1.log`), "utf8").match(/^# tree: (.+)$/m)?.[1];
    assert.equal(header, sourceTree(w.wt), "a real verdict stamps the SOURCE tree sourceTreeHash computes");
    advanceSource(w, false);
    assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, false, "a source change without a refreshed receipt is not admitted");
    advanceSource(w, true);
    assert.equal(admitCurrentRunReceipt(w.wtStudio, OPUS).ok, true);
    assert.notEqual(header, sourceTree(w.wt), "the review log now certifies an older tree");
    assert.equal(CAND["isCrossRepository"], false);
    assert.match(String((CAND["mergeCommit"] as Json)["oid"]), /^[0-9a-f]{40}$/);
    const merged = world("sanity-merged", "merge", { fetched: false });
    assert.equal(gitOk(merged.repo, ["cat-file", "-e", `${merged.mergeOid}^{commit}`]), false, "an unfetched merge commit is not in the local object store");
    const fetched = world("sanity-fetched", "merge");
    assert.equal(gitOk(fetched.repo, ["merge-base", "--is-ancestor", fetched.mergeOid!, "refs/heads/master"]), true);
    const done = world("sanity-done", "checkpoint");
    assert.match(recordOf(done), /state: "?done/);
    assert.equal(statSync(join(done.repo, "docs/SESSION-HANDOFF.md")).isFile(), true);
  });
}

// ---------------------------------------------------------------------------
// behaviour 1: the ladder names exactly one legal next step from evidence
// ---------------------------------------------------------------------------
if (runs(1)) {
  test("W-124 behaviour 1: the ladder names exactly one legal next step from evidence", { timeout: 1_800_000 }, () => {
    const budget = ["--budget", "100000"];
    /** One rung boundary: the step line, its actor and why, and nothing written. */
    const rung = (w: World, row: string, step: string, status: string, extra?: (o: Out) => void): Out => {
      if (['spec','reds','build','review'].includes(step) && !/traditio/.test(recordOf(w, existsSync(w.wt) ? "wt" : "repo"))) handoffAt(w, existsSync(w.wt) ? "wt" : "repo", T.handoffFresh);
      const before = snap(w);
      const o = next(w, [OPUS, ...budget]);
      expectStep(o, step, status, row);
      assert.equal(o.status, 0, ran(`${row}: exit`, o));
      assert.equal(snap(w), before, `${row}: report mode writes nothing (record, ci/, .bisellium/ byte-identical)`);
      assert.equal(existsSync(join(w.repo, ".bisellium", "steps")), false, `${row}: no marker`);
      extra?.(o);
      return o;
    };
    const actor = (o: Out, who: RegExp, row: string): void => assert.match(o.kv.get("actor") ?? "", who, ran(`${row}: actor`, o));

    // 1 greenlight: backlog
    const backlog = world("b1-backlog", "backlog");
    rung(backlog, "backlog names greenlight", "greenlight", "named", (o) => actor(o, /patron/i, "backlog"));

    // halted and declined hold
    const halted = world("b1-halted", "greenlight");
    editRecord(halted, "repo", (doc) => doc.setIn(["state"], "halted"));
    commit(halted.repo, "studio: halt");
    expectHeld(next(halted, [OPUS, ...budget]), "halted holds");
    const declined = world("b1-declined", "backlog");
    editRecord(declined, "repo", (doc) => doc.setIn(["declined"], "not now"));
    commit(declined.repo, "studio: decline");
    expectHeld(next(declined, [OPUS, ...budget]), "declined holds");

    // 2 spec
    const greenlit = world("b1-greenlit", "greenlight");
    rung(greenlit, "greenlit without a signed spec names spec", "spec", "named", (o) => {
      actor(o, /architect/i, "spec");
      assert.equal(o.kv.get("budget_tokens"), "100000", ran("spec order carries the declared budget", o));
    });

    // 3 branch
    rung(world("b1-branch", "spec"), "branch absent names branch", "branch", "named", (o) => actor(o, /producer/i, "branch"));

    // 4 ready
    rung(world("b1-ready", "branch"), "branch present with state greenlit names ready", "ready", "named", (o) => {
      assert.match(o.out, /architect/, ran("ready is attributed to the sella of the passed spec log", o));
    });

    // 5 reds: none, one missing, and the three red kinds that count as missing
    const noReds = world("b1-reds", "ready");
    rung(noReds, "no reds names reds", "reds", "named", (o) => {
      actor(o, /builder/i, "reds");
      assert.match(o.out, /phase:\s*1/i, ran("reds is builder phase 1", o));
    });
    writeReds(noReds);
    rmSync(join(noReds.wtStudio, "ci", "reds", OPUS, "02.log"));
    commit(noReds.wt, "studio: drop red 2");
    rung(noReds, "reds missing one behaviour names reds", "reds", "named");
    for (const kind of ["dirty", "moduleload", "exit0"] as const) {
      writeReds(noReds, { 2: kind });
      rung(noReds, `a ${kind} red counts as missing`, "reds", "named");
    }

    // 6 build (W-312): no gate evidence, or gates at an older tree; then gates at the current tree move to review
    const build = world("b1-build", "reds", { automated: true });
    rung(build, "no gate evidence names build", "build", "named", (o) => actor(o, /builder/i, "build"));
    writeGates(build);
    advanceSource(build, false);
    rung(build, "gates at an older tree name build", "build", "named");
    writeGates(build);
    rung(build, "gates at the current tree and no review name review (round 1)", "review", "named", (o) => {
      assert.match(o.out, /round[^\n]*1/i, ran("round 1", o));
    });

    // 7 review: failed at the current tree is build/fix; failed at an older tree is review, next round
    const failedNow = world("b1-failed-now", "build");
    addReview(failedNow, "failed", 1, T.review1);
    rung(failedNow, "a review gate failed at the current tree names build, phase fix", "build", "named", (o) => {
      assert.match(o.out, /phase:\s*fix/i, ran("phase fix", o));
      assert.match(o.out, /ci\/W-900-review-1\.log/, ran("the failing review log is an input", o));
    });
    advanceSource(failedNow);
    rung(failedNow, "a review gate failed at an older tree names review, next round", "review", "named", (o) => {
      assert.match(o.out, /round[^\n]*2/i, ran("round 2", o));
    });
    const older = world("b1-older", "review");
    advanceSource(older);
    rung(older, "a review gate passed at an older tree names review, next round", "review", "named", (o) => {
      assert.match(o.out, /round[^\n]*2/i, ran("round 2", o));
    });

    // 8 pr: the `# tree:` the rung compares is the one a real verdict wrote
    const prWorld = world("b1-pr", "review");
    const header = readFileSync(join(prWorld.wtStudio, "ci", `${OPUS}-review-1.log`), "utf8").match(/^# tree: (.+)$/m)?.[1];
    assert.equal(header, sourceTree(prWorld.wt), "the fixture's verdict header is the SOURCE tree");
    rung(prWorld, "review met, no PR names pr", "pr", "named", (o) => actor(o, /producer/i, "pr"));
    scenario(prWorld, { list: openList(prWorld, { state: "OPEN", oid: "8".repeat(40) }) });
    rung(prWorld, "an OPEN PR on another oid than the local tip still names pr", "pr", "named");

    // 9 merge: OPEN on the tip; MERGED with the trunk behind (branch present, then branch gone)
    scenario(prWorld, { list: openList(prWorld) });
    rung(prWorld, "an OPEN PR on the local tip names merge", "merge", "named");
    const behind = world("b1-merged-behind", "merge", { fetched: false });
    scenario(behind, { list: mergedList(behind) });
    rung(behind, "MERGED but the trunk behind names merge", "merge", "named");
    const behindGone = world("b1-merged-behind-gone", "cleanup", { fetched: false });
    scenario(behindGone, { list: mergedList(behindGone) });
    rung(behindGone, "MERGED, branch gone, trunk behind names merge, never branch", "merge", "named");

    // 10 cleanup, 11 done
    const fetched = world("b1-cleanup", "merge");
    scenario(fetched, { list: mergedList(fetched) });
    rung(fetched, "MERGED and fetched with the branch still present names cleanup", "cleanup", "named");
    const gone = world("b1-done", "cleanup");
    scenario(gone, { list: mergedList(gone) });
    rung(gone, "MERGED, fetched, branch gone names done", "done", "named");
    const chore = world("b1-chore", "cleanup");
    markDone(chore, true);
    scenario(chore, { list: mergedList(chore) });
    rung(chore, "done committed only on chore/done-<id> still names done", "done", "named", (o) => {
      assert.match(o.out, /done committed on chore\/done-W-900, not on master/, ran("chore why", o));
      assert.match(o.out, /^command: bisellium next W-900 --perform --expect done$/m, ran("names next's own landing for chore/done-<id> (W-141)", o));
      assert.doesNotMatch(o.out, /scripts\//, ran("chore: names no script", o));
    });

    // 12 checkpoint: the committed trunk record `done` settles everything before it without any gh call
    const doneWorld = world("b1-checkpoint", "done");
    rung(doneWorld, "trunk record done reads the checkpoint complete with no handoff edit (W-299)", "checkpoint", "complete");
    assert.equal(ghCalls(doneWorld).length, 0, "a done trunk record settles the earlier rungs without a gh call");
    const complete = world("b1-complete", "checkpoint");
    const completeOut = next(complete, [OPUS, ...budget]);
    assert.match(completeOut.first, /^next: W-900 \S+ complete$/, ran("checkpoint met reports complete", completeOut));
    assert.equal(completeOut.status, 0, ran("complete exits 0", completeOut));

    // an unmarked legacy record past ready is outside the ladder
    expectHeld(next(world("b1-legacy", "ready", { legacy: true }), [OPUS, ...budget]), "a legacy record past ready is held");

    // the same input twice gives the same output
    const twice = next(older, [OPUS, ...budget]);
    assert.equal(next(older, [OPUS, ...budget]).out, twice.out, "the same input twice gives the same output");
  });
}

// ---------------------------------------------------------------------------
// behaviour 2: next refuses to skip, and every refusal is bounded
// ---------------------------------------------------------------------------
if (runs(2)) {
  test("W-124 behaviour 2: next refuses to skip, and every refusal is bounded", { timeout: 1_800_000 }, () => {
    const budget = ["--budget", "100000"];
    const refusal = (o: Out, was: string, asked: string, row: string): void => {
      assert.match(o.out + o.err, new RegExp(`refusing: next step for ${OPUS} is ${was}, not ${asked}`), ran(`${row}: refusal text`, o));
      assert.equal(o.status, 1, ran(`${row}: exit`, o));
    };

    // --expect refuses when a LATER rung's evidence is present: an OPEN PR on a branch with no passing review
    const early = world("b2-early", "build", { mainOnMaster: false });
    scenario(early, { list: openList(early) });
    let before = snap(early);
    refusal(next(early, [OPUS, "--expect", "merge", ...budget]), "review", "merge", "an OPEN PR with no passing review names review, not merge");
    assert.equal(snap(early), before, "a refused --expect writes nothing");
    assert.equal(mutating(early).length, 0, "a refused --expect performs nothing");
    const matches = next(early, [OPUS, "--expect", "review", ...budget]);
    expectStep(matches, "review", "named", "--expect equal to the derived step passes");
    assert.equal(matches.status, 0, ran("--expect match exit", matches));

    // a clean tree with a review log but no gate evidence names build
    const noReceipt = world("b2-no-receipt", "reds", { automated: true });
    verb(noReceipt.wt, ["verdict", OPUS, "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--from", writeTranscript(noReceipt, "r.md"), "--studio", noReceipt.wtStudio, "--now", T.review1]);
    commit(noReceipt.wt, "studio: review log without receipt");
    refusal(next(noReceipt, [OPUS, "--expect", "review", ...budget]), "build", "review", "a review log without gate evidence names build");

    // an unknown step id is usage
    const unknown = next(early, [OPUS, "--expect", "nonsense", ...budget]);
    assert.equal(unknown.status, 2, ran("an unknown --expect step is a usage error", unknown));
    assert.equal(unknown.out, "", "usage errors print no step line");

    // --perform takes the marker, re-derives, then checks --expect: flip the evidence once the marker exists
    const flip = world("b2-flip", "review", { mainOnMaster: false });
    scenario(flip, { list: { replies: [{ stdout: [] }], alts: [{ ifExists: markerPath(flip), replies: [{ stdout: [cand(flip, { state: "OPEN" })] }] }] } });
    const flipped = next(flip, [OPUS, "--perform", "--expect", "pr", ...FAST]);
    refusal(flipped, "merge", "pr", "the second derivation (after the marker) is the one --expect checks");
    assert.deepEqual(mutating(flip), [], "nothing was performed after the refusal");

    // --perform stops at the first named-only rung and runs nothing
    const dispatch = world("b2-dispatch", "ready");
    const dispatched = next(dispatch, [OPUS, "--perform", ...budget]);
    expectStep(dispatched, "reds", "named", "--perform on a dispatch rung only names the order");
    assert.equal(dispatched.status, 0, ran("dispatch perform exit", dispatched));
    assert.deepEqual(mutating(dispatch), [], "no mutating call on a named-only rung");
    assert.equal(existsSync(join(dispatch.wtStudio, "ci", "reds")), false, "no red was recorded");
    const gl = world("b2-greenlight", "backlog");
    const glRecord = recordOf(gl);
    const glOut = next(gl, [OPUS, "--perform"], { env: { BISELLIUM_ROLE: "eng-lead" } });
    expectStep(glOut, "greenlight", "named", "a greenlight rung is named, never performed");
    assert.equal(recordOf(gl), glRecord, "the backlog record is untouched: the verb never acts as the patron");
    const cp = world("b2-checkpoint", "done");
    const cpDocs = readFileSync(join(cp.repo, "docs/SESSION-HANDOFF.md"), "utf8");
    expectStep(next(cp, [OPUS, "--perform"]), "checkpoint", "complete", "--perform stops at the checkpoint rung, complete (W-299)");
    assert.equal(readFileSync(join(cp.repo, "docs/SESSION-HANDOFF.md"), "utf8"), cpDocs, "the checkpoint rung writes nothing");

    // --perform does one rung per call: branch, then it stops (ready is not performed)
    const one = world("b2-one-rung", "spec");
    const performed = next(one, [OPUS, "--perform", "--expect", "branch"]);
    expectStep(performed, "branch", "performed", "branch is performed");
    assert.equal(performed.status, 0, ran("branch performed exit", performed));
    assert.equal(branchExists(one), true, "the branch was cut");
    assert.equal(existsSync(one.wt), true, "and its worktree added at .worktrees/<id>");
    assert.match(git(one.repo, ["worktree", "list", "--porcelain"]), new RegExp(`branch refs/heads/${BRANCH}`), "the worktree is registered on the branch");
    assert.match(recordOf(one, "wt"), /state: "?greenlit/, "ready was not performed in the same call");

    // branch refusals: other branch, not at the master tip, tracked changes (modified and staged)
    const refuseBranch = (row: string, prep: (w: World) => void): void => {
      const w = world(`b2-bref-${row.replace(/\W+/g, "-")}`, "spec");
      prep(w);
      const o = next(w, [OPUS, "--perform", "--expect", "branch"]);
      assert.equal(o.status, 1, ran(`branch refuses: ${row}`, o));
      assert.equal(branchExists(w), false, `${row}: no branch was created`);
      assert.equal(existsSync(w.wt), false, `${row}: no worktree was created`);
    };
    refuseBranch("HEAD is a branch other than master", (w) => git(w.repo, ["switch", "-q", "-c", "scratch"]));
    refuseBranch("HEAD is not at the master tip", (w) => git(w.repo, ["switch", "-q", "--detach", "HEAD~1"]));
    refuseBranch("a modified tracked file", (w) => appendFileSync(join(w.repo, "source.txt"), "dirty\n"));
    refuseBranch("a staged change", (w) => {
      appendFileSync(join(w.repo, "source.txt"), "staged\n");
      git(w.repo, ["add", "source.txt"]);
    });
    const untracked = world("b2-bref-untracked", "spec");
    mkdirSync(join(untracked.repo, ".worktrees", "other"), { recursive: true });
    writeFileSync(join(untracked.repo, ".worktrees", "other", "keep.txt"), "x");
    writeFileSync(join(untracked.repo, "scratch.tmp"), "untracked\n");
    expectStep(next(untracked, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", "an untracked .worktrees/ and an untracked file do not refuse branch");
    assert.equal(branchExists(untracked), true, "the branch was cut despite untracked files");

    // ready relays D-021 from a non-owner checkout (the branch exists, its worktree does not)
    const d021 = world("b2-d021", "branch");
    git(d021.repo, ["worktree", "remove", "--force", d021.wt]);
    const d021Record = recordOf(d021);
    const relayed = next(d021, [OPUS, "--perform", "--expect", "ready"]);
    assert.equal(relayed.status, 1, ran("ready refusal is relayed as held", relayed));
    assert.match(relayed.out + relayed.err, /D-021|worktree/i, ran("the D-021 refusal is relayed unchanged", relayed));
    assert.equal(recordOf(d021), d021Record, "the trunk record is untouched");

    // a linked-worktree --repo exits with usage status 2
    const linked = world("b2-linked", "branch");
    const lw = next(linked, [OPUS, "--repo", linked.wt, "--studio", linked.wtStudio], { bare: true });
    assert.equal(lw.status, 2, ran("a linked-worktree --repo is a usage error", lw));
    assert.match(lw.err, /main checkout/i, ran("and it names the main checkout", lw));

    // PR identity: only a verified tuple is a PR
    const id = world("b2-identity", "review", { mainOnMaster: false });
    const pr = (row: string, list: Json[], step: string, status: string): void => {
      scenario(id, { list: { stdout: list } });
      const o = next(id, [OPUS]);
      if (status === "held") expectHeld(o, row);
      else expectStep(o, step, status, row);
    };
    pr("a candidate with the wrong baseRefName is not a PR", [cand(id, { state: "OPEN", base: "develop" })], "pr", "named");
    pr("a fork head is not a PR", [cand(id, { state: "OPEN", cross: true })], "pr", "named");
    pr("a different head repository is not a PR", [cand(id, { state: "OPEN", headRepo: "evil/fork" })], "pr", "named");
    pr("a non-integer number is not a PR", [cand(id, { state: "OPEN", number: "12" })], "pr", "named");
    pr("a fractional number is not a PR", [cand(id, { state: "OPEN", number: 1.5 })], "pr", "named");
    pr("two OPEN candidates are held (ambiguous)", [cand(id, { state: "OPEN" }), cand(id, { state: "OPEN", number: 902 })], "pr", "held");
    pr("an old MERGED PR whose merge commit is not in the trunk settles nothing", [cand(id, { state: "MERGED", merge: OID_UNFETCHED })], "merge", "named");
    // unverifiable (this clone cannot resolve the head: merge-base exit 128) is not unrelated (exit 1)
    const unverifiable = world("b2-unverifiable", "merge");
    scenario(unverifiable, { list: mergedList(unverifiable, { oid: "9".repeat(40) }) });
    expectStep(next(unverifiable, [OPUS]), "merge", "named", "a MERGED PR whose headRefOid this clone cannot resolve is unverifiable: it stays at merge, never pr");
    const unrelated = world("b2-unrelated", "merge");
    const stranger = git(unrelated.repo, ["commit-tree", git(unrelated.repo, ["rev-parse", `${tipOf(unrelated)}^{tree}`]), "-m", "a root commit unrelated to the opus branch"]);
    scenario(unrelated, { list: mergedList(unrelated, { oid: stranger }) });
    expectStep(next(unrelated, [OPUS]), "pr", "named", "a MERGED PR whose locally known headRefOid does not contain the local branch tip settles nothing");
  });
}

// ---------------------------------------------------------------------------
// behaviour 4: complete means MERGED and FETCHED
// ---------------------------------------------------------------------------
if (runs(4)) {
  test("W-124 behaviour 4: complete means MERGED and FETCHED (done needs a fresh MERGED read and a trunk that contains it)", { timeout: 1_800_000 }, () => {
    // MERGED with the local trunk one commit behind: the step is merge (branch present, then branch gone), never done
    const behind = world("b4-behind", "merge", { fetched: false, mainOnMaster: false });
    scenario(behind, { list: mergedList(behind) });
    expectStep(next(behind, [OPUS]), "merge", "named", "MERGED with the trunk one commit behind is merge, with the branch present");
    const behindGone = world("b4-behind-gone", "cleanup", { fetched: false, mainOnMaster: false });
    scenario(behindGone, { list: mergedList(behindGone) });
    expectStep(next(behindGone, [OPUS]), "merge", "named", "MERGED with the trunk behind and the branch gone is merge, never branch");
    const refusedDone = next(behindGone, [OPUS, "--perform", "--expect", "done"]);
    assert.match(refusedDone.out + refusedDone.err, /refusing: next step for W-900 is merge, not done/, ran("done is refused while the trunk is behind", refusedDone));
    for (const [row, w] of [["branch present", behind], ["branch gone", behindGone]] as const) {
      scenario(w, { list: mergedList(w, { merge: OID_UNFETCHED }) });
      const o = performMerge(w);
      expectHeld(o, `${row}: a merge commit that is still not contained after the fetch`);
      assert.ok(o.out.includes(OID_UNFETCHED.slice(0, 12)), ran(`${row}: held names the commit`, o));
      assert.equal(ghMerges(w).length, 0, `${row}: no gh merge`);
      assert.equal(ghCalls(w).filter((a) => a[1] === "update-branch").length, 0, `${row}: no update-branch`);
    }

    // OPEN, CLOSED unmerged, and a PR whose base is not master are not done-able
    const open = pushed("b4-open");
    scenario(open, { list: openList(open) });
    expectStep(next(open, [OPUS]), "merge", "named", "an OPEN PR is merge, not done");
    scenario(open, { list: { stdout: [cand(open, { state: "CLOSED" })] } });
    expectStep(next(open, [OPUS]), "pr", "named", "CLOSED unmerged is no PR");
    scenario(open, { list: mergedList(open, { base: "develop" }) });
    expectStep(next(open, [OPUS]), "pr", "named", "a MERGED PR whose baseRefName is not master is not a PR");

    // a malformed mergeCommit.oid is held and never reaches git
    const malformed = world("b4-malformed", "merge");
    const badOids: [string, string | null][] = [
      ["uppercase", "A".repeat(40)],
      ["39 characters", "a".repeat(39)],
      ["all zeros", "0".repeat(40)],
      ["null", null],
      ["a leading dash", `-${"a".repeat(39)}`],
    ];
    for (const [row, oid] of badOids) {
      scenario(malformed, { list: mergedList(malformed, { merge: oid }) });
      const o = next(malformed, [OPUS]);
      expectHeld(o, `mergeCommit.oid ${row}`);
      if (oid !== null) assert.ok(!gitCalls(malformed).some((a) => a.includes(oid)), `mergeCommit.oid ${row} never reaches git`);
      assert.ok(!gitCalls(malformed).some((a) => a.some((x) => x.includes("merge-base") || x === "null")), `mergeCommit.oid ${row}: no merge-base call at all`);
    }

    // master checked out in the main checkout (clean, behind): the verb fast-forwards it to the reviewed merge commit and nothing else
    const checkedOut = world("b4-checked-out", "pr");
    const m = landMerge(checkedOut, false);
    scenario(checkedOut, { list: mergedList(checkedOut, { merge: m }) });
    assert.equal(m, checkedOut.mergeOid, "the world's mergeOid is the merge commit the PR names");
    const ffOut = performMerge(checkedOut);
    assert.match(ffOut.out, /state=MERGED/, ran("a clean checked-out master that is behind is fast-forwarded and the merge reports MERGED", ffOut));
    assert.equal(gitq(checkedOut.repo, ["rev-parse", "refs/heads/master"]), m, "refs/heads/master equals the merge commit");
    assert.equal(gitq(checkedOut.repo, ["symbolic-ref", "-q", "HEAD"]), "refs/heads/master", "HEAD is still master");
    const raw = calls(checkedOut).filter((c) => c[0] === "git").map((c) => c.slice(1));
    const mergeCalls = raw.filter((a) => gitArgs(a)[0] === "merge");
    assert.equal(mergeCalls.length, 1, "exactly one merge call");
    assert.deepEqual(mergeCalls[0], ["-c", "submodule.recurse=false", "merge", "-q", "--ff-only", m], "the merge is --ff-only to the literal reviewed oid, never origin/master");
    assert.deepEqual(raw[raw.indexOf(mergeCalls[0]!) - 1], ["symbolic-ref", "-q", "HEAD"], "the call immediately before the merge is symbolic-ref -q HEAD");
    for (const a of raw) {
      assert.ok(!["reset", "pull", "stash", "checkout", "switch", "restore", "clean"].includes(gitArgs(a)[0] ?? ""), `no ${gitArgs(a)[0]} call`);
      assert.ok(!a.includes("--force") && !a.includes("-f") && !a.includes("--update-head-ok"), `no force flag in git ${a.join(" ")}`);
    }
    assert.ok(gitCalls(checkedOut).every((a) => !a.includes("-u") && !a.includes("--set-upstream")), "-u is never used");

    // master checked out in another worktree: the verb never writes there, so the step holds naming it and the pull to run there
    const elsewhere = world("b4-held-elsewhere", "pr");
    const m2 = landMerge(elsewhere, false);
    scenario(elsewhere, { list: mergedList(elsewhere, { merge: m2 }) });
    git(elsewhere.repo, ["switch", "-q", "-c", "side"]);
    const holder = join(elsewhere.root, "master-wt");
    git(elsewhere.repo, ["worktree", "add", "-q", holder, "master"]);
    const refusedFetch = performMerge(elsewhere);
    expectHeld(refusedFetch, "git fetch origin master:master refused because master is checked out in another worktree");
    assert.ok(refusedFetch.out.includes(holder), ran("held names the worktree that has master checked out", refusedFetch));
    assert.match(refusedFetch.out, /pull --ff-only/, ran("and the pull --ff-only to run there", refusedFetch));
    assert.equal(gitCalls(elsewhere).filter((a) => a[0] === "merge").length, 0, "no merge call");
    assert.ok(gitCalls(elsewhere).every((a) => !a.includes("-u") && !a.includes("--set-upstream")), "-u is never used");

    // performed done, end to end, from the main checkout on master
    const lifecycle = world("b4-done", "cleanup");
    scenario(lifecycle, { list: mergedList(lifecycle) });
    const masterTip = gitq(lifecycle.repo, ["rev-parse", "refs/heads/master"]);
    touchHandoff(lifecycle);
    const performed = next(lifecycle, [OPUS, "--perform", "--expect", "done"]);
    expectStep(performed, "done", "performed", "done is performed from a fresh MERGED read and a contained merge commit");
    assert.equal(performed.status, 0, ran("performed done exit", performed));
    const chore = `chore/done-${OPUS}`;
    const choreTip = gitq(lifecycle.repo, ["rev-parse", `refs/heads/${chore}`]);
    assert.equal(gitq(lifecycle.repo, ["rev-parse", `${choreTip}^`]), masterTip, "chore/done-<id> is created at the master tip");
    assert.equal(gitq(lifecycle.repo, ["log", "-1", "--format=%s", choreTip]), `chore(studio): mark ${OPUS} done`);
    assert.match(gitq(lifecycle.repo, ["log", "-1", "--format=%b", choreTip]), /Co-Authored-By: producer \(bisellium next\) <noreply@anthropic\.com>/, "the trailer");
    assert.deepEqual(gitq(lifecycle.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", choreTip]).split("\n"), ["docs/SESSION-HANDOFF.md", `studio/opera/${OPUS}.md`], "exactly the record and the handoff");
    assert.equal(gitq(lifecycle.repo, ["symbolic-ref", "HEAD"]), "refs/heads/master", "and back on master");
    assert.doesNotMatch(gitq(lifecycle.repo, ["show", `refs/heads/master:studio/opera/${OPUS}.md`]), /state: "?done/, "the committed trunk record is not done until the commit lands");
    const landing2 = next(lifecycle, [OPUS]);
    expectStep(landing2, "done", "named", "the next call names the landing and performs nothing");
    assert.match(landing2.out, /done committed on chore\/done-W-900, not on master/, ran("landing why", landing2));
    assert.equal(gitq(lifecycle.repo, ["rev-parse", `refs/heads/${chore}`]), choreTip, "no second commit");

    // a refusing done leaves no branch and no commit
    const refusing = world("b4-done-refused", "cleanup", { sec: false });
    scenario(refusing, { list: mergedList(refusing) });
    touchHandoff(refusing);
    const refusingTip = git(refusing.repo, ["rev-parse", "refs/heads/master"]);
    const refusingOut = next(refusing, [OPUS, "--perform", "--expect", "done"]);
    assert.equal(refusingOut.status, 1, ran("a refusing done is relayed (exit 1)", refusingOut));
    assert.equal(branchExists(refusing, chore), false, "no chore branch is left");
    assert.equal(git(refusing.repo, ["rev-parse", "refs/heads/master"]), refusingTip, "and no commit");
    assert.equal(git(refusing.repo, ["status", "--porcelain", "--untracked-files=no"]), "M docs/SESSION-HANDOFF.md", "and only the handoff edit is left");

    // a second changed tracked path is held with nothing committed
    const second = world("b4-done-second-path", "cleanup");
    put(second.studio, ".bisellium/events.jsonl", "");
    git(second.repo, ["add", "-f", "studio/.bisellium/events.jsonl"]);
    commit(second.repo, "test: track the event log");
    scenario(second, { list: mergedList(second) });
    touchHandoff(second);
    const secondTip = git(second.repo, ["rev-parse", "refs/heads/master"]);
    const secondOut = next(second, [OPUS, "--perform", "--expect", "done"]);
    expectHeld(secondOut, "a second changed tracked path");
    assert.equal(gitq(second.repo, ["rev-parse", `refs/heads/${chore}`]), secondTip, "nothing was committed on the chore branch (left for inspection)");
  });
}

// ---------------------------------------------------------------------------
// behaviour 5: step health comes from evidence, never assumption
// ---------------------------------------------------------------------------
if (runs(5)) {
  test("W-124 behaviour 5: step health comes from the pid, /proc start time and the output mtime, never assumption", { timeout: 1_800_000 }, async () => {
    const budget = ["--budget", "100000"];
    const w = world("b5-health", "reds", { automated: true });
    const status = (o: Out): string => o.kv.get("health") ?? "";

    // the 2026-10-02 fixture: a marker whose pid is gone and whose output is four hours old is dead, not running
    const gone = deadPid();
    putMarker(w, { step: "build", pid: gone, start_ticks: 1234 });
    putOutput(w, "gate chain started\nrunning suite 3 of 9\n", 4 * 3600);
    const fourHours = next(w, [OPUS, ...budget]);
    expectStep(fourHours, "build", "dead", "a dead gate chain is dead, never running");
    assert.equal(fourHours.status, 1, ran("dead exits 1", fourHours));
    assert.match(fourHours.out, /resume/i, ran("the report names the resume point", fourHours));
    assert.match(fourHours.out, /age/i, ran("and the output age", fourHours));
    assert.match(fourHours.out, /running suite 3 of 9/, ran("and the last output line", fourHours));

    // a live pid with output inside its silence budget, on the derived rung, is running and names no next step
    const live = liveChild();
    putMarker(w, { step: "build", pid: live, start_ticks: tickOf(live) });
    putOutput(w, "compiling\n", 60);
    const running = next(w, [OPUS, ...budget]);
    expectStep(running, "build", "running", "a live pid with fresh output on the derived rung is running");
    assert.equal(running.status, 0, ran("running exits 0", running));
    assert.equal(running.kv.has("command"), false, ran("no next step is named while it runs", running));

    // pid reuse: the pid lives but its /proc start time is not the marker's
    putMarker(w, { step: "build", pid: live, start_ticks: tickOf(live) + 1 });
    expectStep(next(w, [OPUS, ...budget]), "build", "dead", "a live pid with another start time is a reused pid, hence dead");
    // a zombie is dead
    const zombie = zombiePid();
    putMarker(w, { step: "build", pid: zombie, start_ticks: tickOf(zombie) });
    expectStep(next(w, [OPUS, ...budget]), "build", "dead", "a zombie is dead");

    // pid alive but silent past the budget: dead (stalled), pid named, never killed
    putMarker(w, { step: "build", pid: live, start_ticks: tickOf(live) });
    putOutput(w, "last words\n", 3600);
    const stalled = next(w, [OPUS, ...budget]);
    expectStep(stalled, "build", "dead", "a live pid silent past its budget is dead");
    assert.match(status(stalled), /stalled/i, ran("health says stalled", stalled));
    assert.ok(stalled.out.includes(String(live)), ran("and names the pid", stalled));
    assert.doesNotThrow(() => process.kill(live, 0), "next never kills the pid");
    // output missing is dead
    rmSync(outputPath(w));
    expectStep(next(w, [OPUS, ...budget]), "build", "dead", "a missing output file is dead");
    // an output mtime more than 5 seconds in the future is a clock anomaly, held; up to 5 counts as 0
    putOutput(w, "from the future\n", -60);
    const anomaly = next(w, [OPUS, ...budget]);
    expectHeld(anomaly, "an output mtime 60s in the future");
    assert.match(anomaly.out, /clock/i, ran("names the clock anomaly", anomaly));
    putOutput(w, "slightly ahead\n", -3);
    expectStep(next(w, [OPUS, ...budget]), "build", "running", "0 to 5 seconds ahead counts as 0");

    // the marker's step against the derived rung
    putOutput(w, "fresh\n", 10);
    putMarker(w, { step: "reds", pid: live, start_ticks: tickOf(live) });
    const finished = next(w, [OPUS, ...budget]);
    expectStep(finished, "build", "named", "a marker for an earlier step whose rung is met names the real next step");
    assert.match(status(finished), /finished reds/, ran("health: finished <step>", finished));
    putMarker(w, { step: "review", pid: live, start_ticks: tickOf(live) });
    const stale = next(w, [OPUS, ...budget]);
    expectStep(stale, "build", "named", "a marker for a later step is never running");
    assert.match(status(stale), /stale marker/, ran("health: stale marker", stale));
    rmSync(markerPath(w), { force: true });
    const none = next(w, [OPUS, ...budget]);
    assert.match(status(none), /no step recorded/, ran("no marker is no step recorded, never healthy", none));
    assert.doesNotMatch(none.out, /running|healthy/i, "and never running or healthy");

    // an invalid marker is dead and its output is not opened
    writeFileSync(markerPath(w), "{ this is not json");
    putOutput(w, "SECRET-LINE-XYZ\n", 10);
    const invalid = next(w, [OPUS, ...budget]);
    expectStep(invalid, "build", "dead", "an invalid marker is dead");
    assert.ok(!invalid.out.includes("SECRET-LINE-XYZ"), ran("its output is not opened", invalid));

    // output is data: a 10 KiB last line with escapes prints as a clipped JSON string
    putMarker(w, { step: "build", pid: gone, start_ticks: 1234 });
    putOutput(w, `first\n\u001b[31m${"A".repeat(10240)}\u001b[0m\n`, 500);
    const clipped = next(w, [OPUS, ...budget]);
    const lastLine = /^last-output: (".*")$/m.exec(clipped.out)?.[1];
    assert.ok(lastLine !== undefined, ran("last-output is printed as a JSON-quoted value", clipped));
    const decoded = JSON.parse(lastLine ?? '""') as string;
    assert.ok(decoded.length <= 200, `clipped to 200 characters, got ${decoded.length}`);
    assert.ok(!decoded.includes("\u001b"), "control characters are stripped");

    // /proc parsing, with a fake root honoured only under BISELLIUM_TEST_CLOCK=1
    const pid = "4242";
    putOutput(w, "fresh\n", 10);
    putMarker(w, { step: "build", pid: Number(pid), start_ticks: 777 });
    const marker = markerText(w);
    const unknownRows: [string, Record<string, string>][] = [
      ["a non-ENOENT read error (stat is a directory)", { [pid]: "dir" }],
      ["no closing parenthesis", { [pid]: `${pid} no-paren S 1 2 3\n` }],
      ["too few fields after the comm", { [pid]: `${pid} (x) S 1 2\n` }],
      ["a state that is not one letter", { [pid]: statLine(pid, "x", "SS", 777) }],
      ["a field 22 that is not an integer", { [pid]: statLine(pid, "x", "S", "abc") }],
    ];
    for (const [row, entries] of unknownRows) {
      const proc = fakeProc(w, entries);
      const o = next(w, [OPUS, ...budget], { env: PROC_ENV(proc) });
      expectStep(o, "build", "held", `${row} is unknown, hence held`);
      assert.equal(o.status, 1, ran(`${row}: exit`, o));
      assert.match(status(o), /unknown/, ran(`${row}: health: unknown`, o));
      assert.doesNotMatch(status(o), /dead/, `${row}: never dead`);
      assert.equal(markerText(w), marker, `${row}: the marker is untouched`);
      const performRefused = next(w, [OPUS, "--perform", "--expect", "build", ...budget], { env: PROC_ENV(proc) });
      assert.equal(performRefused.status, 1, ran(`${row}: --perform refuses an unknown marker`, performRefused));
      assert.equal(markerText(w), marker, `${row}: --perform leaves the marker alone`);
    }
    // a comm containing spaces and ") (" parses by the last ")"
    const tricky = "a b) (c d";
    let proc = fakeProc(w, { [pid]: statLine(pid, tricky, "S", 5555) });
    putMarker(w, { step: "build", pid: Number(pid), start_ticks: 5555 });
    expectStep(next(w, [OPUS, ...budget], { env: PROC_ENV(proc) }), "build", "running", "a comm with spaces and ') (' reads live by its true field 22");
    putMarker(w, { step: "build", pid: Number(pid), start_ticks: 5554 });
    expectStep(next(w, [OPUS, ...budget], { env: PROC_ENV(proc) }), "build", "dead", "and dead by its true field 22");
    // BISELLIUM_TEST_PROC without BISELLIUM_TEST_CLOCK=1 is ignored: the real /proc has no such pid
    // W-347: make this the tracked-pid boundary this assertion means to pin; a perform pid can be outside this namespace
    putMarker(w, { step: "build", pid: gone, start_ticks: 777, writer: "track" });
    proc = fakeProc(w, { [String(gone)]: statLine(gone, "x", "S", 777) });
    writeFileSync(outputPath(w), "fresh\n");
    const ignored = next(w, [OPUS, ...budget], { clock: false, env: PROC_ENV(proc) });
    expectStep(ignored, "build", "dead", "BISELLIUM_TEST_PROC without BISELLIUM_TEST_CLOCK=1 is ignored");

    // --track: registers a step an orchestrator launched itself
    const t = world("b5-track", "reds", { automated: true });
    const child = liveChild();
    mkdirSync(stepsDir(t), { recursive: true });
    writeFileSync(join(stepsDir(t), "w124.log"), "tee\n");
    const track = (args: string[], o: RunOpts = {}): Out => next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", "steps/w124.log", ...budget, ...args], o);
    const tracked = track([]);
    assert.equal(tracked.status, 0, ran("--track registers a live pid", tracked));
    const written = markerJson(t);
    assert.deepEqual([written["schema"], written["step"], written["pid"], written["writer"], written["output"]], [1, "build", child, "track", "steps/w124.log"], "the marker is verb-written with writer: track");
    assert.equal(written["start_ticks"], tickOf(child), "and next read start_ticks itself");
    utimesSync(join(stepsDir(t), "w124.log"), new Date(NOW_MS - 30_000), new Date(NOW_MS - 30_000));
    expectStep(next(t, [OPUS, ...budget]), "build", "running", "a tracked live step with fresh output is running");
    // the existing live marker refuses a second track
    const liveMarker = markerText(t);
    assert.equal(track([]).status, 1, "an existing live marker refuses --track");
    assert.equal(markerText(t), liveMarker, "and is left alone");
    rmSync(markerPath(t), { force: true });
    const trackRefused = (row: string, o: Out): void => {
      assert.equal(o.status, 1, ran(`--track refuses ${row}`, o));
      assert.equal(existsSync(markerPath(t)), false, `--track ${row}: no marker written`);
    };
    for (const bad of ["0", "1", "-1", "abc", "1.5"]) trackRefused(`pid ${bad}`, next(t, [OPUS, "--track", "build", "--pid", bad, "--output", "steps/w124.log", ...budget]));
    trackRefused("the test process's own pid (next's parent)", next(t, [OPUS, "--track", "build", "--pid", String(process.pid), "--output", "steps/w124.log", ...budget]));
    trackRefused("a pid with no /proc entry", next(t, [OPUS, "--track", "build", "--pid", String(deadPid()), "--output", "steps/w124.log", ...budget]));
    trackRefused("a step that is not the derived rung", next(t, [OPUS, "--track", "review", "--pid", String(child), "--output", "steps/w124.log", ...budget]));
    const outside = join(t.root, "outside.log");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(stepsDir(t), "link-out.log"));
    symlinkSync(join(stepsDir(t), "w124.log"), join(stepsDir(t), "link-in.log"));
    for (const [row, out] of [
      ["an --output outside .bisellium/steps", "../x.log"],
      ["an absolute --output", outside],
      ["an --output reached through ..", "steps/../steps/w124.log"],
      ["a symlink to a file outside", "steps/link-out.log"],
      ["a symlink to a file inside", "steps/link-in.log"],
      ["a missing --output file", "steps/missing.log"],
    ] as const)
      trackRefused(row, next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", out, ...budget]));
    trackRefused("a target pid whose /proc entry is unreadable", next(t, [OPUS, "--track", "build", "--pid", pid, "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fakeProc(t, { [pid]: "dir" })) }));
    trackRefused("a target pid whose /proc entry is unparseable", next(t, [OPUS, "--track", "build", "--pid", pid, "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fakeProc(t, { [pid]: "garbage" })) }));
    putMarker(t, { step: "build", pid: Number(pid), start_ticks: 777 });
    const unknownMarker = markerText(t);
    const overUnknown = next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fakeProc(t, { [pid]: "dir" })) });
    assert.equal(overUnknown.status, 1, ran("an existing unknown marker refuses --track", overUnknown));
    assert.equal(markerText(t), unknownMarker, "and is left alone");
    rmSync(markerPath(t), { force: true });
    const noClock = next(t, [OPUS, "--track", "build", "--pid", String(child), "--output", "steps/w124.log", "--now", NOW_ISO, ...budget], { clock: false });
    assert.equal(noClock.status, 2, ran("--now without BISELLIUM_TEST_CLOCK=1 is a usage error", noClock));
    // the fake /proc root governs --track's own start_ticks read too (and is ignored without the clock guard)
    const fake = fakeProc(t, { [String(gone)]: statLine(gone, "x", "S", 777) });
    const fakeTracked = next(t, [OPUS, "--track", "build", "--pid", String(gone), "--output", "steps/w124.log", ...budget], { env: PROC_ENV(fake) });
    assert.equal(fakeTracked.status, 0, ran("a fake /proc entry can be tracked under the clock guard", fakeTracked));
    assert.equal(markerJson(t)["start_ticks"], 777, "start_ticks came from the fake root");
    rmSync(markerPath(t), { force: true });
    trackRefused("a fake /proc entry without the clock guard", next(t, [OPUS, "--track", "build", "--pid", String(gone), "--output", "steps/w124.log", ...budget], { clock: false, env: PROC_ENV(fake) }));

    // --perform: refuses a live marker, refuses an unknown one, replaces a dead one, and reads its OWN start_ticks from the fake root too
    const p = world("b5-perform", "spec");
    const performLive = liveChild();
    putMarker(p, { step: "branch", pid: performLive, start_ticks: tickOf(performLive), budget: 120 });
    putOutput(p, "cutting\n", 10);
    const livePerform = next(p, [OPUS, "--perform", "--expect", "branch"]);
    assert.equal(livePerform.status, 1, ran("--perform refuses a live marker", livePerform));
    assert.match(livePerform.out + livePerform.err, new RegExp(`step branch is running, pid ${performLive}`), ran("with the running message", livePerform));
    assert.equal(branchExists(p), false, "and performs nothing");
    putMarker(p, { step: "branch", pid: Number(pid), start_ticks: 777, budget: 120 });
    const unknownPerform = next(p, [OPUS, "--perform", "--expect", "branch"], { env: PROC_ENV(fakeProc(p, { [pid]: "dir" })) });
    assert.equal(unknownPerform.status, 1, ran("--perform refuses an unknown marker", unknownPerform));
    assert.equal(branchExists(p), false, "and performs nothing");
    // W-347: takeover by pid absence remains the contract for a tracked process; a perform waits on its output budget
    putMarker(p, { step: "branch", pid: gone, start_ticks: 777, budget: 120, writer: "track" });
    const replaced = next(p, [OPUS, "--perform", "--expect", "branch"]);
    assert.equal(replaced.status, 0, ran("--perform replaces a dead marker", replaced));
    assert.match(replaced.out, /dead|replac|took over/i, ran("and says so", replaced));
    assert.equal(branchExists(p), true, "and performs the rung");

    // the verb's own /proc/self/stat obeys BISELLIUM_TEST_PROC too: a fake root with no self/stat cannot supply start_ticks, so it holds
    const own = world("b5-own-stat", "spec");
    const bare = fakeProc(own, {});
    const heldOwn = next(own, [OPUS, "--perform", "--expect", "branch"], { env: PROC_ENV(bare) });
    assert.equal(heldOwn.status, 1, ran("a fake /proc with no self/stat holds --perform", heldOwn));
    assert.equal(branchExists(own), false, "and performs nothing (the real /proc/self/stat was not used)");
    assert.equal(existsSync(markerPath(own)), false, "and writes no marker");
    const unguarded = next(own, [OPUS, "--perform", "--expect", "branch"], { clock: false, env: PROC_ENV(bare) });
    assert.equal(unguarded.status, 0, ran("without BISELLIUM_TEST_CLOCK=1 the fake root is ignored and the real /proc/self/stat is read", unguarded));
    assert.equal(branchExists(own), true);

    // a takeover of a dead marker is unlink-if-unchanged: change the marker after the verb has read it and the takeover refuses
    const race = world("b5-race", "spec");
    const raceProc = join(race.root, "proc");
    mkdirSync(join(raceProc, String(gone)), { recursive: true });
    const fifo = join(raceProc, String(gone), "stat");
    execFileSync("mkfifo", [fifo]);
    mkdirSync(join(raceProc, "self"));
    writeFileSync(join(raceProc, "self", "stat"), statLine("self", "next", "S", 31337));
    putMarker(race, { step: "branch", pid: gone, start_ticks: 111, budget: 120 });
    putOutput(race, "x\n", 10);
    const racing = nextAsync(race, [OPUS, "--perform", "--expect", "branch"], { env: PROC_ENV(raceProc) });
    let served = 0;
    const serve = (async () => {
      for (;;) {
        const fd = await Promise.race([open(fifo, "w"), racing.done.then(() => null)]);
        if (fd === null) return;
        served++;
        appendFileSync(markerPath(race), " "); // same inode, new size and mtime: changed since the verb read it
        try {
          await fd.write(statLine(gone, "x", "S", 222)); // another start time: proven dead (reused pid)
        } finally {
          await fd.close().catch(() => undefined);
        }
      }
    })();
    const raced = await racing.done;
    closeSync(openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK)); // release a writer-open still pending
    await serve;
    assert.ok(served > 0, "the verb read the dead marker's /proc entry");
    assert.equal(raced.status, 1, ran("a marker changed between the read and the unlink refuses the takeover", raced));
    assert.equal(branchExists(race), false, "and performs nothing");
    assert.ok(existsSync(markerPath(race)), "the changed marker was not unlinked");
  });
}

// ---------------------------------------------------------------------------
// behaviour 6: a dispatch is refused over the context cap and resumes from the handover artifact
// ---------------------------------------------------------------------------
const DISPATCH_TOKEN_CAP = 500_000;
if (runs(6)) {
  test("W-124 behaviour 6: a dispatch is refused over the context cap, and resumes only from a fresh handover artifact", { timeout: 1_800_000 }, () => {
    const dispatch: { step: string; build: (tag: string) => World; where: "repo" | "wt"; resume: (w: World) => void }[] = [
      {
        step: "build",
        where: "wt",
        build: (tag) => world(tag, "reds", { automated: true }),
        resume: (w) => {
          writeGates(w);
          advanceSource(w, false);
        },
      },
      {
        step: "spec",
        where: "repo",
        build: (tag) => world(tag, "greenlight"),
        resume: (w) => {
          // W-162: a spec verdict pins the brief, so the brief must exist when it is recorded
          put(w.repo, "studio/briefs/W-900.md", briefText(w.behaviours));
          verb(w.repo, ["verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "revise", "--phase", "spec", "--from", writeTranscript(w, "spec-revise.md"), "--studio", w.studio, "--now", T.spec]);
          commit(w.repo, "studio: spec revise round");
        },
      },
      {
        step: "reds",
        where: "wt",
        build: (tag) => world(tag, "ready"),
        resume: (w) => {
          writeReds(w);
          rmSync(join(w.wtStudio, "ci", "reds", OPUS, "02.log"));
          commit(w.wt, "studio: only one red so far");
        },
      },
      {
        step: "review",
        where: "wt",
        build: (tag) => world(tag, "build"),
        resume: (w) => {
          addReview(w, "failed", 1, T.review1);
          advanceSource(w);
        },
      },
    ];
    const run = (w: World, args: string[]): Out => next(w, [OPUS, ...args]);
    for (const d of dispatch) {
      const w = d.build(`b6-${d.step}`);
      handoffAt(w, d.where, T.handoffFresh);
      const over = run(w, ["--budget", String(DISPATCH_TOKEN_CAP + 1)]);
      expectStep(over, d.step, "held", `${d.step}: a budget above DISPATCH_TOKEN_CAP is held`);
      assert.equal(over.status, 1, ran(`${d.step}: over-cap exit`, over));
      assert.match(over.kv.get("why") ?? "", new RegExp(`budget ${DISPATCH_TOKEN_CAP + 1} exceeds DISPATCH_TOKEN_CAP ${DISPATCH_TOKEN_CAP}`), ran(`${d.step}: over-cap why`, over));
      assert.equal(over.kv.has("command"), false, `${d.step}: no order is printed over the cap`);

      const absent = run(w, []);
      expectStep(absent, d.step, "held", `${d.step}: an undeclared budget is held`);
      assert.equal(absent.status, 1, ran(`${d.step}: undeclared exit`, absent));
      assert.match(absent.kv.get("why") ?? "", /dispatch budget undeclared/, ran(`${d.step}: undeclared why`, absent));
      assert.equal(absent.kv.has("command"), false, `${d.step}: no order without a declared budget`);

      for (const bad of ["abc", "0", "-5", "12345678901", "1.5", "05"]) {
        const o = run(w, ["--budget", bad]);
        assert.equal(o.status, 2, ran(`${d.step}: --budget ${bad} is a usage error`, o));
        assert.equal(o.out, "", `${d.step}: --budget ${bad} prints no step line`);
        assert.notEqual(o.err, "", `${d.step}: --budget ${bad} explains itself on stderr`);
      }

      const exact = run(w, ["--budget", String(DISPATCH_TOKEN_CAP)]);
      expectStep(exact, d.step, "named", `${d.step}: exactly DISPATCH_TOKEN_CAP is named`);
      assert.equal(exact.status, 0, ran(`${d.step}: exact-cap exit`, exact));
      assert.equal(exact.kv.get("budget_tokens"), String(DISPATCH_TOKEN_CAP), ran(`${d.step}: the order carries budget_tokens`, exact));
      for (const key of ["role", "sella", "phase", "inputs", "command"]) assert.ok(exact.kv.has(key), ran(`${d.step}: the order prints ${key}:`, exact));
      assert.match(exact.kv.get("inputs") ?? "", /briefs\/W-900\.md/, ran(`${d.step}: the brief is an input`, exact));
      assert.match(exact.kv.get("inputs") ?? "", /traditio/, ran(`${d.step}: the record's traditio block is an input`, exact));
      assert.doesNotMatch(exact.out, /conversation/i, `${d.step}: nothing is taken from conversation`);
    }

    // on a non-dispatch step the flag is syntax-checked and otherwise ignored
    const plain = world("b6-plain", "spec");
    const badFlag = run(plain, ["--budget", "abc"]);
    assert.equal(badFlag.status, 2, ran("a malformed --budget is a usage error even on a non-dispatch step", badFlag));
    expectStep(run(plain, ["--budget", "1"]), "branch", "named", "a well-formed --budget is ignored on a non-dispatch step");

    // a resume needs a fresh handover artifact: missing and stale are held, fresh is named
    for (const d of dispatch) {
      const missing = d.build(`b6-resume-${d.step}-missing`);
      d.resume(missing);
      const miss = run(missing, ["--budget", "100000"]);
      expectStep(miss, d.step, "held", `${d.step}: a resume with no traditio is held`);
      assert.match(miss.out + miss.err, /stale handover: run bisellium handoff first/, ran(`${d.step}: missing traditio`, miss));
      assert.equal(miss.status, 1, ran(`${d.step}: missing exit`, miss));

      const stale = d.build(`b6-resume-${d.step}-stale`);
      handoffAt(stale, d.where, T.handoffStale);
      d.resume(stale);
      if (d.step !== "spec") {
        const o = run(stale, ["--budget", "100000"]);
        expectStep(o, d.step, "held", `${d.step}: a traditio older than the newest red/review log is held`);
        assert.match(o.out + o.err, /stale handover: run bisellium handoff first/, ran(`${d.step}: stale traditio`, o));
      }

      const fresh = d.build(`b6-resume-${d.step}-fresh`);
      d.resume(fresh);
      handoffAt(fresh, d.where, T.handoffFresh);
      const ok = run(fresh, ["--budget", "100000"]);
      expectStep(ok, d.step, "named", `${d.step}: a resume from a fresh handover artifact is named`);
      assert.equal(ok.status, 0, ran(`${d.step}: fresh resume exit`, ok));
    }
  });
}

if (runs(2)) {
  test("W-124 behaviour 2 (round-1 fix A): performing an unverifiable merged head fetches, then holds naming the oid, never pr", { timeout: 1_800_000 }, () => {
    const w = world("r1-a-perform", "merge", { mainOnMaster: false });
    const unknown = "9".repeat(40);
    scenario(w, { list: mergedList(w, { oid: unknown }) });
    const o = performMerge(w);
    expectHeld(o, "an unverifiable head is held after the fetch");
    assert.match(o.first, /^next: W-900 merge held$/, ran("it is the merge step that holds", o));
    assert.ok(o.out.includes(unknown.slice(0, 12)), ran("the hold names the unresolvable oid", o));
    assert.doesNotMatch(o.out, /next-step: pr/, ran("and it never walks back to pr", o));
    assert.deepEqual(mutating(w), ["git fetch master:master"], "no rebase, push, PR or update-branch");
    assert.equal(gitCalls(w).some((a) => a[0] === "fetch" && a.some((x) => x.includes(`refs/remotes/origin/${BRANCH}`))), true, "the opus remote-tracking ref was fetched and re-checked");
  });
}

if (runs(6)) {
  test("W-124 behaviour 6 (round-1 fix B): a kind: ui review order lists the ui-lead input and carries --ui-input", { timeout: 1_800_000 }, () => {
    const w = world("r1-b-ui", "build");
    const prompt = "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n";
    const transcript = [
      "## Findings",
      "No findings",
      "The navigation relationships remain legible across the complete narrow viewport arrangement.",
      "## Recommendation",
      "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.",
      "Additional original observations cover focus movement responsive density and stable content grouping throughout.",
      "Verdict: passed",
      "",
    ].join("\n");
    for (const dir of ["repo", "wt"] as const)
      editRecord(w, dir, (doc) => {
        doc.setIn(["kind"], "ui");
        doc.setIn(["spec"], `briefs/${OPUS}.md`);
      });
    put(w.wtStudio, "ci/dispatch.md", prompt);
    const from = join(w.root, "ui-spec.md");
    writeFileSync(from, transcript);
    verb(w.wt, ["verdict", OPUS, "--round", "2", "--sella", "ui-lead", "--outcome", "passed", "--phase", "spec", "--dispatch-prompt", "ci/dispatch.md", "--from", from, "--studio", w.wtStudio, "--now", T.spec]);
    commit(w.wt, `studio(${OPUS}): ui-lead input`);
    put(w.studio, "ci/dispatch.md", prompt);
    put(w.studio, `ci/${OPUS}-spec-2.log`, readFileSync(join(w.wtStudio, "ci", `${OPUS}-spec-2.log`), "utf8"));
    commit(w.repo, `studio(${OPUS}): ui-lead input on the trunk`);

    writeGates(w, { gate: "served-e2e" });
    const o = next(w, [OPUS, "--budget", "100000"]);
    expectStep(o, "review", "named", "a kind: ui record with a met build gate names the review dispatch");
    assert.match(o.kv.get("inputs") ?? "", new RegExp(`ci/${OPUS}-spec-2\\.log`), ran("the ui-lead input path is an input", o));
    assert.match(o.kv.get("command") ?? "", new RegExp(`--ui-input ci/${OPUS}-spec-2\\.log`), ran("the verdict command carries --ui-input", o));
    const plain = next(world("r1-b-plain", "build"), [OPUS, "--budget", "100000"]);
    expectStep(plain, "review", "named", "a plain opus review order");
    assert.doesNotMatch(plain.kv.get("command") ?? "", /--ui-input/, ran("a non-ui order carries no --ui-input", plain));
  });
}

// ---------------------------------------------------------------------------
// W-299 behaviour 3: next --all prints every open opus's derived next step and writes nothing (D-077 B)
// ---------------------------------------------------------------------------
test("W-299-b3 behaviour 3: next --all prints every open opus's derived next step, in id order, and writes nothing", { timeout: 1_800_000 }, () => {
  const w = world("w299-b3", "cleanup");
  scenario(w, { list: mergedList(w) });
  ticketed(w);
  const other = (id: string, state: string | undefined): void => put(w.studio, `opera/${id}.md`, recordText({ id, title: `W-299 fixture ${state ?? "stateless"}`, state, probationes: {} }));
  put(w.studio, "opera/W-12.md", recordText({ id: "W-12", title: "W-299 fixture greenlit", state: "greenlit", probationes: {}, traditio: { sella: "producer", stage: "greenlit", next: "spec it", blocked_on: "the Patron's ruling", at: "2026-10-02T09:00:00.000Z" } }));
  other("W-1000", "review");
  for (const [id, state] of [["W-13", "backlog"], ["W-14", "halted"], ["W-15", "done"]] as const) other(id, state);
  commit(w.repo, "test: W-299 opera");
  git(w.repo, ["push", "-q", "origin", "master"]);
  const tickets = join(w.repo, ".git", "bisellium", "tickets");
  const before = snap(w);
  const all = next(w, ["--all"], { clock: false });
  assert.equal(all.status, 0, ran("next --all exits 0", all));
  const lines = all.out.trimEnd().split("\n");
  assert.deepEqual(lines.map((l) => /^next: (\S+) /.exec(l)?.[1] ?? l), ["W-12", OPUS, "W-1000", "open: 3"], ran("the open opera, in id order, then the count", all));
  for (const l of lines.slice(0, 3)) assert.match(l, /^next: \S+ \S+ (named|held|complete) · actor: \S+ · why: \S.* · traditio: \S/, ran("one line per opus: step, status, actor, why and traditio", all));
  assert.ok(lines[0]!.endsWith(" · traditio: producer at 2026-10-02T09:00:00.000Z: spec it; blocked on the Patron's ruling"), ran("the traditio: sella, time, next and what blocks it", all));
  assert.ok(lines[2]!.endsWith(" · traditio: none"), ran("a record with no traditio says none", all));
  assert.equal(snap(w), before, "next --all writes nothing: records, ci/, .bisellium/, refs and status byte-identical");
  assert.equal(existsSync(tickets), false, "next --all writes no ticket");
  // each line is the step next <opus> derives (a report-mode run with a budget, which writes its ticket: the control)
  for (const [i, id] of ["W-12", OPUS, "W-1000"].entries()) {
    const one = next(w, [id, "--budget", "400000"], { clock: false });
    assert.ok(lines[i]!.startsWith(`${one.first} · `), ran(`${id}: the --all line names the step next ${id} names`, one));
  }
  assert.equal(existsSync(join(tickets, "W-12.json")), true, "control: next <opus> does write a ticket in this world");
  // a record that cannot be read is printed and exits 1, after every other line
  other("W-16", undefined);
  commit(w.repo, "test: W-299 a stateless record");
  const bad = next(w, ["--all"], { clock: false });
  assert.equal(bad.status, 1, ran("an unreadable record exits 1", bad));
  const badLines = bad.out.trimEnd().split("\n");
  const stateless = "next: W-16 unreadable · why: opera/W-16.md cannot be read or carries no lifecycle state";
  assert.equal(badLines[1], stateless, ran("the stateless record's line, in id order", bad));
  assert.deepEqual(badLines.filter((l) => l !== stateless), lines, ran("every other line is printed as before", bad));
  other("W-17", "greenlitt");
  commit(w.repo, "test: W-299 a state that is no lifecycle state");
  const typo = next(w, ["--all"], { clock: false });
  assert.equal(typo.status, 1, ran("a state that is no lifecycle state exits 1", typo));
  assert.ok(typo.out.split("\n").includes("next: W-17 unreadable · why: opera/W-17.md cannot be read or carries no lifecycle state"), ran("its line is printed", typo));
  // each later case alone: the unreadable records go first, so the case's own line is what exits 1
  git(w.repo, ["rm", "-q", "studio/opera/W-16.md", "studio/opera/W-17.md"]);
  commit(w.repo, "test: W-299 drop the unreadable records");
  assert.equal(next(w, ["--all"], { clock: false }).status, 0, "control: without them the run exits 0 again");
  // a present traditio that is malformed fails its line
  put(w.studio, "opera/W-18.md", recordText({ id: "W-18", title: "W-299 fixture", state: "greenlit", probationes: {}, traditio: { sella: "producer" } }));
  commit(w.repo, "test: W-299 a malformed traditio");
  const malformed = next(w, ["--all"], { clock: false });
  assert.equal(malformed.status, 1, ran("a malformed traditio exits 1", malformed));
  assert.ok(malformed.out.split("\n").includes("next: W-18 failed · why: opera/W-18.md#traditio is malformed: it needs string sella, stage, next and blocked_on and an ISO at"), ran("its failed line is printed", malformed));
  git(w.repo, ["rm", "-q", "studio/opera/W-18.md"]);
  commit(w.repo, "test: W-299 drop the malformed traditio");
  // a derivation held for a rejected setting (a spec_reviewer naming no seat) is printed held and exits 1
  const manifest = readFileSync(join(w.studio, "bisellium.yml"), "utf8");
  writeFileSync(join(w.studio, "bisellium.yml"), `${manifest}spec_reviewer: qa-leed\n`);
  commit(w.repo, "test: W-299 a typo in spec_reviewer");
  const rejected = next(w, ["--all"], { clock: false });
  assert.equal(rejected.status, 1, ran("a rejected derivation exits 1", rejected));
  assert.match(rejected.out, /^next: W-12 spec held · actor: \S+ · why: bisellium\.yml#spec_reviewer: qa-leed is not a declared seat · /m, ran("the held line is printed as next W-12 holds", rejected));
  writeFileSync(join(w.studio, "bisellium.yml"), manifest);
  commit(w.repo, "test: W-299 the setting restored");
  // a record in the working tree only (in neither master nor opus/<id>) is refused as next <opus> refuses it
  other("W-19", "greenlit");
  const working = next(w, ["--all"], { clock: false });
  assert.equal(working.status, 1, ran("a working-only record exits 1", working));
  assert.ok(working.out.split("\n").includes("next: W-19 failed · why: unknown opus: opera/W-19.md is in the working tree only, in neither master nor opus/W-19, so next W-19 refuses it"), ran("the working-only id is refused", working));
  const alone = next(w, ["W-19", "--budget", "400000"], { clock: false });
  assert.equal(alone.status, 2, ran("next W-19 refuses it too", alone));
  assert.ok(alone.err.includes("unknown opus: W-19"), ran("as an unknown opus", alone));
  rmSync(join(w.studio, "opera", "W-19.md"));
  // --all takes no <opus> and no flag but --studio and --repo
  for (const [args, why] of [[["--all", "W-12"], "--all takes no <opus>"], [["--all", "--budget", "400000"], "--all takes only --studio and --repo"], [["--all", "--perform"], "--all takes only --studio and --repo"]] as const) {
    const o = next(w, [...args], { clock: false });
    assert.equal(o.status, 2, ran(`${args.join(" ")}: exit 2`, o));
    assert.ok(o.err.includes(why), ran(`${args.join(" ")}: ${why}`, o));
  }
});

// ---------------------------------------------------------------------------
// W-275: next tells the truth about each step
// ---------------------------------------------------------------------------
test("W-275-b2 behaviour 2: a dispatch the gate holds prints the derivation's own why beside the gate's", { timeout: 1_800_000 }, () => {
  const w = world("w275-b2", "ready");
  writeReds(w);
  rmSync(join(w.wtStudio, "ci", "reds", OPUS, "02.log"));
  commit(w.wt, "studio: only one red so far");
  const MISSING = /^no usable red for behaviour\(s\) 2 /;
  const held = (o: Out, row: string, gate: RegExp): void => {
    expectStep(o, "reds", "held", row);
    assert.equal(o.status, 1, ran(`${row}: exit`, o));
    assert.match(o.kv.get("why") ?? "", gate, ran(`${row}: the gate's why`, o));
    assert.match(o.kv.get("underlying") ?? "", MISSING, ran(`${row}: the derivation's why is printed beside it`, o));
  };
  const stale = next(w, [OPUS, "--budget", "100000"]);
  held(stale, "a resume with no traditio", /^stale handover: run bisellium handoff first/);
  held(next(w, [OPUS]), "an undeclared budget", /^dispatch budget undeclared$/);
  held(next(w, [OPUS, "--budget", String(DISPATCH_TOKEN_CAP + 1)]), "a budget over the cap", /exceeds DISPATCH_TOKEN_CAP/);
  handoffAt(w, "wt", T.handoffFresh);
  const named = next(w, [OPUS, "--budget", "100000"]);
  expectStep(named, "reds", "named", "a fresh handover names the order");
  assert.equal(named.kv.has("underlying"), false, ran("a named order prints no underlying line", named));
  assert.equal(stale.kv.get("underlying"), named.kv.get("why"), "the underlying why is the named order's why, word for word");
  // r2: a fresh traditio is read whole: a non-string stage holds the order as an unreadable one does
  editRecord(w, "wt", (doc) => doc.setIn(["traditio", "stage"], 3));
  commit(w.wt, "studio: a traditio whose stage is no string");
  held(next(w, [OPUS, "--budget", "100000"]), "a fresh traditio with a non-string stage", /^stale handover: run bisellium handoff first \(the record's traditio is malformed: it needs string sella, stage, next and blocked_on and an ISO at\)$/);
});

test("W-275-b3 behaviour 3: the done rung names each of its two performs", { timeout: 1_800_000 }, () => {
  const w = world("w275-b3", "cleanup");
  scenario(w, { list: mergedList(w) });
  const first = next(w, [OPUS]);
  expectStep(first, "done", "named", "the done commit is named");
  assert.match(first.out, /^perform 1 of 2: commit; rerun to land$/m, ran("the commit is the first of two performs", first));
  assert.doesNotMatch(first.out, /^perform 2 of 2:/m, ran("and not the second", first));
  expectStep(next(w, [OPUS, "--perform", "--expect", "done"]), "done", "performed", "the done commit is made");
  const second = next(w, [OPUS]);
  expectStep(second, "done", "named", "the landing is named");
  assert.match(second.out, /^perform 2 of 2: land$/m, ran("the landing is the second of two performs", second));
  assert.doesNotMatch(second.out, /^perform 1 of 2:/m, ran("and not the first", second));
  // the certify perform commits too (W-259); a ui opus is named verify, a command of its own, and no perform line
  const a = world("w275-b3-certify", "cleanup", { automated: true });
  scenario(a, { list: mergedList(a) });
  const certify = next(a, [OPUS]);
  expectStep(certify, "done", "named", "the certify perform is named");
  assert.equal(certify.kv.get("command"), `bisellium next ${OPUS} --perform --expect done`, ran("it is the done perform", certify));
  assert.match(certify.out, /^perform 1 of 2: commit; rerun to land$/m, ran("the certify perform is the first of two", certify));
  editRecord(a, "repo", (doc) => doc.setIn(["kind"], "ui"));
  const verify = next(a, [OPUS]);
  expectStep(verify, "done", "named", "a ui opus with no certificate is named verify");
  assert.equal(verify.kv.get("command"), `bisellium verify ${OPUS} --studio studio --repo .`, ran("the rung names verify", verify));
  assert.doesNotMatch(verify.out, /^perform \d of 2:/m, ran("verify is no perform", verify));
});

test("W-275-b4 behaviour 4: before pr, a handover older than the newest review log holds with the handoff command, and the pr command names --body-file's roots", { timeout: 1_800_000 }, () => {
  const w = world("w275-b4", "review");
  const PR = `bisellium next ${OPUS} --perform --expect pr --title "<title>" --body-file <a file under the repository or $TMPDIR>`;
  const plain = next(w, [OPUS]);
  expectStep(plain, "pr", "named", "no traditio: pr is named as before");
  assert.equal(plain.kv.get("command"), PR, ran("the command names --body-file's roots", plain));
  handoffAt(w, "wt", T.handoffStale);
  const held = next(w, [OPUS]);
  expectStep(held, "pr", "held", "a traditio older than the newest review log holds pr");
  assert.equal(held.status, 1, ran("held exit", held));
  assert.equal(
    held.kv.get("why"),
    `stale handover: traditio at ${T.handoffStale} predates the newest red or review log; run: bisellium handoff --opus ${OPUS} --sella producer --next "<what moves next>" --studio .worktrees/${OPUS}/studio, commit opera/${OPUS}.md on opus/${OPUS}, then rerun`,
    ran("the why names the handoff command", held),
  );
  const body = join(w.root, "body.md");
  writeFileSync(body, "PR body\n");
  const tried = next(w, [OPUS, "--perform", "--expect", "pr", "--title", "t", "--body-file", body, ...FAST]);
  expectHeld(tried, "the pr perform holds too");
  assert.deepEqual(mutating(w), [], "nothing is pushed or created");
  const MALFORMED = `^stale handover: the record's traditio is malformed: it needs string sella, stage, next and blocked_on and an ISO at; run: bisellium handoff --opus ${OPUS} `;
  // r2: a fresh ISO at does not carry a traditio whose other fields are not strings
  handoffAt(w, "wt", T.review1);
  editRecord(w, "wt", (doc) => doc.setIn(["traditio", "next"], 7));
  commit(w.wt, "studio: a fresh traditio whose next is no string");
  const fieldless = next(w, [OPUS]);
  expectStep(fieldless, "pr", "held", "a fresh traditio with a non-string next holds pr");
  assert.match(fieldless.kv.get("why") ?? "", new RegExp(MALFORMED), ran("the why names the malformed traditio and the handoff command", fieldless));
  expectHeld(next(w, [OPUS, "--perform", "--expect", "pr", "--title", "t", "--body-file", body, ...FAST]), "the pr perform holds on it too");
  assert.deepEqual(mutating(w), [], "still nothing is pushed or created");
  editRecord(w, "wt", (doc) => doc.setIn(["traditio", "at"], "not a time"));
  commit(w.wt, "studio: a traditio with no ISO at");
  const malformed = next(w, [OPUS]);
  expectStep(malformed, "pr", "held", "a traditio with no ISO at holds pr");
  assert.match(malformed.kv.get("why") ?? "", new RegExp(MALFORMED), ran("the why names the handoff command", malformed));
  handoffAt(w, "wt", T.review1);
  const level = next(w, [OPUS]);
  expectStep(level, "pr", "named", "a traditio at the newest review log's own time names pr again");
  assert.equal(level.kv.get("command"), PR, ran("with the same command", level));
});

test("W-347-b2 behaviour 2: fresh perform output stays running when its pid is outside this namespace", { timeout: 1_800_000 }, () => {
  const budget = ["--budget", "100000"];
  const w = world("w347-b2-perform-namespace", "reds", { automated: true });
  const pid = 4242;
  const proc = fakeProc(w, {});
  putMarker(w, { step: "build", pid, start_ticks: 777, budget: 120, writer: "perform" });
  putOutput(w, "suite 3 still running\n", 10);
  const live = next(w, [OPUS, ...budget], { env: PROC_ENV(proc) });
  expectStep(live, "build", "running", "a fresh perform is running when this pid namespace has no entry for it");
  assert.match(live.kv.get("health") ?? "", /pid 4242 is outside this namespace, last output 10s ago/, ran("health names the evidence and namespace limit", live));
  assert.equal(live.kv.has("command"), false, ran("no resume command is named while it runs", live));

  putMarker(w, { step: "build", pid, start_ticks: 777, budget: 120, writer: "track" });
  const tracked = next(w, [OPUS, ...budget], { env: PROC_ENV(proc) });
  expectStep(tracked, "build", "dead", "an absent tracked pid is still dead");

  putMarker(w, { step: "build", pid, start_ticks: 777, budget: 120, writer: "perform" });
  putOutput(w, "last perform output\n", 121);
  const stale = next(w, [OPUS, ...budget], { env: PROC_ENV(proc) });
  expectStep(stale, "build", "dead", "an invisible perform beyond its output budget is stalled");
  assert.match(stale.kv.get("health") ?? "", /stalled: no output for 121s \(budget 120s\); pid 4242 is outside this namespace/, ran("the stale output, not absence alone, proves the resumable stop", stale));

  const visible = fakeProc(w, { [String(pid)]: statLine(pid, "next", "S", 778) });
  putOutput(w, "fresh again\n", 10);
  const reused = next(w, [OPUS, ...budget], { env: PROC_ENV(visible) });
  expectStep(reused, "build", "dead", "a visible pid with another start time is still reused");
});
