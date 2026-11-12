/**
 * W-610 (studio/briefs/W-610.md): the build review runs on the light gates, before the one full `ci --opus`. After the
 * builder's handoff `next` orders the light gates, which its perform runs and logs at the tree (b1); review is ordered on
 * that log with no full gate log (b2); after a pass, one `ci --opus` at the reviewed tree (b3); pr names reviewed tree =
 * gate tree = tip tree and bookkeeping commits keep it (b4); a source change after a pass orders the light gates and a
 * delta review again, never ci or pr (b5). Rows b1-b5 work in the next-world fixture's scratch repositories under the OS
 * temp directory; b6 (build-review.md and lex production §9 steps 3-4) reads studio/ and lives in w610-texts.test.ts, a
 * test:record file. Select one behaviour with --test-name-pattern='^W-610-b<k>\s'.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUDGET, OPUS, T, type World, advanceSource, addReview, commit, direct, editRecord, expectStep, git, next, ran, sourceTree, verb, world, writeGates, writeTranscript } from "./next-world.test.js";

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-610-b[1-9] /, "");
  test(name, { timeout: 1_800_000 }, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}
const OWN_TESTS = ["w326.test.mjs", "w462.test.mjs"];
const LIGHT_CMDS = ["node -e 0", ...OWN_TESTS.map((f) => `node --test-reporter=tap ${f}`)];
const LIGHT = LIGHT_CMDS.join(" ; ");
const lightRel = (w: World): string => `ci/${OPUS}-light-${sourceTree(w.wt).slice(5, 13)}.log`;
/** An automated world past its reds whose main manifest keeps the light-gate list and whose builder has handed over. */
function handed(tag: string): World {
  const w = world(tag, "reds", { automated: true });
  const manifest = join(w.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes:", 'light_gates:\n  - "node -e 0"\nsource_excludes:'));
  commit(w.repo, "studio: the light-gate list");
  // the fixture brief's own test files (Files owned), each a passing test file, committed as the builder's
  for (const f of OWN_TESTS) writeFileSync(join(w.wt, f), 'import { test } from "node:test";\ntest("own", () => {});\n');
  commit(w.wt, `test(${OPUS}): its own test files`);
  builderHandoff(w, T.handoffFresh);
  return w;
}
/** Replaces the main checkout's light_gates entry (a YAML scalar) and commits it on master. */
function setLightGates(w: World, from: string, to: string): void {
  const manifest = join(w.studio, "bisellium.yml");
  const text = readFileSync(manifest, "utf8");
  assert.ok(text.includes(`light_gates:\n  - ${from}\n`), `the main manifest keeps light_gates ${from}`);
  writeFileSync(manifest, text.replace(`light_gates:\n  - ${from}\n`, `light_gates:\n  - ${to}\n`));
  commit(w.repo, "studio: the light-gate list changes");
}
/** Edits a worktree file under studio/ (`rel`) with `edit` and commits it on the branch. */
function editWt(w: World, rel: string, edit: (text: string) => string): void {
  const path = join(w.wtStudio, rel);
  writeFileSync(path, edit(readFileSync(path, "utf8")));
  commit(w.wt, `studio(${OPUS}): edit ${rel}`);
}
function builderHandoff(w: World, at: string): void {
  verb(w.wt, ["handoff", "--opus", OPUS, "--sella", `builder.${OPUS}`, "--next", "ready for review", "--studio", w.wtStudio, "--now", at]);
  commit(w.wt, `studio(${OPUS}): builder handoff ${at}`);
}
const performLight = (w: World): ReturnType<typeof next> => next(w, [OPUS, "--perform", "--expect", "build", ...BUDGET]);
/** handed, the light gates performed, review round 1 passed with the sec gate, at one tree. */
function passed(tag: string): World {
  const w = handed(tag);
  const p = performLight(w);
  assert.equal(p.status, 0, ran("the light-gates perform exits 0", p));
  addReview(w, "passed", 1, T.review1);
  editRecord(w, "wt", (doc) => doc.setIn(["probationes", "sec"], { status: "passed", sella: "qa-lead", evidence: `ci/${OPUS}-review-1.log`, at: T.review1 }));
  commit(w.wt, `studio(${OPUS}): sec gate`);
  return w;
}

row("W-610-b1 after the builder's handoff next orders the light gates and its perform logs them at the tree", async () => {
  const w = handed("w610-b1");
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "build", "named", "the light gates are a build step");
  assert.equal(o.kv.get("actor"), "producer", ran("a ladder-runner runs them, never the builder", o));
  assert.equal(o.kv.get("light-gates"), LIGHT, ran("the order names the kept list and the brief's own test files", o));
  assert.match(o.kv.get("command") ?? "", new RegExp(`bisellium next ${OPUS} --perform --expect build`), ran("the perform runs them", o));
  const p = performLight(w);
  assert.equal(p.status, 0, ran("the perform exits 0", p));
  const rel = lightRel(w);
  assert.equal(git(w.wt, ["ls-files", "--", `studio/${rel}`]), `studio/${rel}`, ran("the log is committed at the tree", p));
  const text = readFileSync(join(w.wtStudio, rel), "utf8").split("\n");
  const { commandDigest, commandLine } = await import("@bisellium/shim");
  assert.deepEqual(text.slice(0, 3), [`certifies: ${sourceTree(w.wt)}`, commandLine(LIGHT_CMDS), "exit code: 0"], "the log opens as a gate log does, line 2 binding the exact commands");
  // the binding is the shared helper's: injective over the list (a boundary inside a command differs), one line for a multiline command
  assert.match(commandLine(LIGHT_CMDS), /^command: sha256:[0-9a-f]{64}$/, "line 2 is the command digest");
  assert.notEqual(commandDigest(["a ; b"]), commandDigest(["a", "b"]), "a list boundary is part of the binding");
  assert.notEqual(commandDigest(["a", "b"]), commandDigest(["b", "a"]), "the order is part of the binding");
  // a multiline light gate keeps `exit code:` on line 3; the changed list voids the old log, so the light gates are ordered again
  setLightGates(w, '"node -e 0"', '"node -e 0 &&\\n  node -e 0"');
  const again = next(w, [OPUS, ...BUDGET]);
  expectStep(again, "build", "named", "a changed light_gates list orders the light gates again");
  assert.equal(again.kv.has("light-gates"), true, ran("the light gates, not review", again));
  const multi = ["node -e 0 &&\n  node -e 0", ...LIGHT_CMDS.slice(1)];
  const p2 = performLight(w);
  assert.equal(p2.status, 0, ran("the multiline perform exits 0", p2));
  assert.deepEqual(readFileSync(join(w.wtStudio, rel), "utf8").split("\n").slice(0, 3), [`certifies: ${sourceTree(w.wt)}`, commandLine(multi), "exit code: 0"], "a multiline command keeps exit code: on line 3");
  // every write boundary refuses: a symlinked ci/ (ensureRealDirectory), a failed git add, a failed git commit
  const { runLightGates } = await import("@bisellium/commands/light-gates.js");
  const outside = mkdtempSync(join(tmpdir(), "w610-outside-"));
  renameSync(join(w.wtStudio, "ci"), join(w.wtStudio, "ci.real"));
  symlinkSync(outside, join(w.wtStudio, "ci"));
  const linked = runLightGates(w.wtStudio, OPUS, ["node -e 0"]);
  rmSync(join(w.wtStudio, "ci"));
  renameSync(join(w.wtStudio, "ci.real"), join(w.wtStudio, "ci"));
  assert.ok("error" in linked, "a symlinked ci/ refuses the log write");
  assert.deepEqual(readdirSync(outside), [], "nothing is written through the symlink");
  setLightGates(w, '"node -e 0 &&\\n  node -e 0"', '"node -e 0"');
  const lock = git(w.wt, ["rev-parse", "--path-format=absolute", "--git-path", "index.lock"]);
  writeFileSync(lock, "");
  const addFailed = performLight(w);
  rmSync(lock);
  assert.notEqual(addFailed.status, 0, ran("a failed git add refuses the perform", addFailed));
  assert.match(addFailed.out, /could not commit/, ran("the perform names the failed add", addFailed));
  const hooks = join(w.root, "w610-hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  git(w.wt, ["config", "core.hooksPath", hooks]);
  const commitFailed = performLight(w);
  git(w.wt, ["config", "--unset", "core.hooksPath"]);
  assert.notEqual(commitFailed.status, 0, ran("a failed git commit refuses the perform", commitFailed));
  assert.match(commitFailed.out, /could not commit/, ran("the perform names the failed commit", commitFailed));
  assert.equal(existsSync(lock), false, "the fixture's lock is gone");
  // ruled case: a Files owned test path that is not a plain repo-relative path never reaches the shell
  const { lightGateCommands } = await import("@bisellium/commands/light-gates.js");
  const brief = (p: string): string => `## Files owned\n\n- \`${p}\`\n`;
  for (const bad of ["x.test.ts; touch pwned.test.ts", "$(id).test.ts", "../up.test.ts", "/abs.test.ts", "a b.test.ts"])
    assert.ok("error" in lightGateCommands({ light_gates: ["node -e 0"] }, "studio", brief(bad)), `an unsafe test path is refused: ${bad}`);
  assert.deepEqual(lightGateCommands({ light_gates: ["x {studio}"] }, "studio", brief("packages/a/b.test.ts")), ["x studio", "node --test-reporter=tap --import tsx packages/a/b.test.ts"], "a plain path runs");
});

row("W-610-b2 review is ordered on the light gates at the tip tree with no full gate log", async () => {
  const w = handed("w610-b2");
  performLight(w);
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "review", "named", "review is named on the light gates");
  assert.match(o.out, /round[^\n]*1/i, ran("round 1", o));
  const reviewArgs = ["review", OPUS, "--pass", "--evidence", `ci/${OPUS}-review-1.log`, "--round", "1", "--sella", "qa-lead", "--studio", w.wtStudio, "--now", T.review1];
  const { admitLightGates } = await import("@bisellium/commands/light-gates.js");
  // the log binds the commands: a changed light_gates list on master is not admitted by next or by the review verb
  setLightGates(w, '"node -e 0"', '"node -e 1"');
  const changed = next(w, [OPUS, ...BUDGET]);
  expectStep(changed, "build", "named", "a changed light_gates list is not review's precondition");
  assert.equal(direct(w, w.wt, reviewArgs).status, 2, "the review verb refuses a light log of other commands");
  setLightGates(w, '"node -e 1"', '"node -e 0"');
  // a changed Files owned (a new own test file) in the committed brief voids the log too
  const briefRel = `briefs/${OPUS}.md`;
  const brief = readFileSync(join(w.wtStudio, briefRel), "utf8");
  editWt(w, briefRel, (t) => t.replace("`w462.test.mjs`, ", "`w462.test.mjs`, `w999.test.mjs`, "));
  const owned = admitLightGates(w.wtStudio, OPUS);
  assert.ok(!owned.ok && /not run for the current light-gate commands/.test(owned.error), `a changed Files owned voids the log: ${JSON.stringify(owned)}`);
  assert.equal(direct(w, w.wt, reviewArgs).status, 2, "the review verb refuses it");
  editWt(w, briefRel, () => brief);
  // a malformed worktree source_excludes refuses: next holds on the drift and the review verb does not fall back to the light log
  const manifestText = readFileSync(join(w.wtStudio, "bisellium.yml"), "utf8");
  writeFileSync(join(w.wtStudio, "bisellium.yml"), manifestText.replace("source_excludes: []", "source_excludes: [docs, 3]"));
  const malformed = admitLightGates(w.wtStudio, OPUS);
  assert.ok(!malformed.ok && /source_excludes/.test(malformed.error), `a malformed worktree source_excludes refuses: ${JSON.stringify(malformed)}`);
  assert.notEqual(next(w, [OPUS, ...BUDGET]).first, `next: ${OPUS} review named`, "next does not name review on it");
  assert.equal(direct(w, w.wt, reviewArgs).status, 2, "the review verb refuses it too");
  writeFileSync(join(w.wtStudio, "bisellium.yml"), manifestText);
  expectStep(next(w, [OPUS, ...BUDGET]), "review", "named", "the restored inputs admit the log again");
  verb(w.wt, ["verdict", OPUS, "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--from", writeTranscript(w, "review-1.md"), "--studio", w.wtStudio, "--now", T.review1]);
  const r = direct(w, w.wt, reviewArgs);
  assert.equal(r.status, 0, ran("the review verb admits the light gates", r));
});

row("W-610-b3 after a pass next orders one ci --opus at the reviewed tree", () => {
  const w = passed("w610-b3");
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "build", "named", "the full suite is ordered after the pass");
  assert.equal(o.kv.get("actor"), "producer", ran("a ladder-runner's", o));
  assert.equal(o.kv.get("reviewed"), `round 1 at ${sourceTree(w.wt)}`, ran("the order names the reviewed tree", o));
  assert.match(o.kv.get("command") ?? "", new RegExp(`ci --opus ${OPUS} --studio studio --repo \\.`), ran("one ci --opus", o));
  // the cap (w610-proof-meet-1112): a failed full suite at the reviewed tree is ordered once more, then it is a builder's
  const failedRun = (n: number): void => {
    writeGates(w, { log: (t) => `certifies: ${t}\ncommand: node -e 1\nexit code: 1\n\nrun ${n}\n`, commit: false });
    editRecord(w, "wt", (doc) => doc.setIn(["probationes", "tests", "status"], "failed"));
    commit(w.wt, `studio(${OPUS}): gates failed, run ${n}`);
  };
  failedRun(1);
  const rerun = next(w, [OPUS, ...BUDGET]);
  expectStep(rerun, "build", "named", "one failed ci at the reviewed tree is ordered once more");
  assert.equal(rerun.kv.get("reviewed"), `round 1 at ${sourceTree(w.wt)}`, ran("the rerun is the ci order", rerun));
  failedRun(2);
  const capped = next(w, [OPUS, ...BUDGET]);
  expectStep(capped, "build", "named", "a second failed ci at the reviewed tree goes to a builder");
  assert.equal(capped.kv.get("ci-runs"), `2 at ${sourceTree(w.wt)}`, ran("the order names the capped runs", capped));
  assert.notEqual(capped.kv.get("actor"), "producer", ran("a builder's, not a third ci", capped));
  assert.doesNotMatch(capped.kv.get("command") ?? "", /ci --opus/, ran("no third ci at the tree", capped));
});

row("W-610-b4 pr names reviewed tree = gate tree = tip tree and bookkeeping commits keep the pass", () => {
  const w = passed("w610-b4");
  const before = next(w, [OPUS, "--perform", "--expect", "pr", ...BUDGET]);
  assert.notEqual(before.status, 0, ran("pr refuses with no gate log at the reviewed tree", before));
  writeGates(w);
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "pr", "named", "pr after the gates at the reviewed tree");
  const t = sourceTree(w.wt);
  assert.equal(o.kv.get("trees"), `reviewed ${t} = gates ${t} = tip ${t}`, ran("the order names the three trees", o));
  // the end-to-end loop in an officina declaring light_gates (w610-proof-meet-1112): handoff, light gates, round 1 failed, the
  // fix, light gates again, round 2 passed, one ci, pr; a stub reviewer (verdict and review verbs) and a stub ci (writeGates)
  const e = handed("w610-b4-loop");
  const step = (at: string, expected: string): ReturnType<typeof next> => {
    const s = next(e, [OPUS, ...BUDGET]);
    expectStep(s, expected, "named", `the loop at ${at}`);
    return s;
  };
  const noCi = (s: ReturnType<typeof next>, at: string): void => {
    // a ci order runs the verb (`bisellium ci --opus` or `bisellium -- ci --opus`); a builder's text may name it as forbidden
    assert.doesNotMatch(s.kv.get("command") ?? "", /bisellium (?:-- )?ci --opus/, ran(`no ci order before a pass (${at})`, s));
    assert.equal(s.kv.has("reviewed"), false, ran(`no reviewed ci order before a pass (${at})`, s));
  };
  noCi(step("the handoff", "build"), "the handoff");
  assert.equal(performLight(e).status, 0, "the loop's first light gates pass");
  noCi(step("round 1", "review"), "round 1");
  addReview(e, "failed", 1, T.review1);
  noCi(step("the failed round", "build"), "the failed round");
  advanceSource(e);
  builderHandoff(e, "2026-10-02T09:30:00.000Z");
  const light2 = step("the fix", "build");
  noCi(light2, "the fix");
  assert.equal(light2.kv.has("light-gates"), true, ran("the fix goes back to the light gates", light2));
  assert.equal(performLight(e).status, 0, "the loop's second light gates pass");
  noCi(step("round 2", "review"), "round 2");
  addReview(e, "passed", 2, T.review2);
  editRecord(e, "wt", (doc) => doc.setIn(["probationes", "sec"], { status: "passed", sella: "qa-lead", evidence: `ci/${OPUS}-review-2.log`, at: T.review2 }));
  commit(e.wt, `studio(${OPUS}): sec gate`);
  const ci = step("the pass", "build");
  assert.equal(ci.kv.get("reviewed"), `round 2 at ${sourceTree(e.wt)}`, ran("one ci at the reviewed tree after the pass", ci));
  writeGates(e);
  const et = sourceTree(e.wt);
  assert.equal(step("the gates", "pr").kv.get("trees"), `reviewed ${et} = gates ${et} = tip ${et}`, "the loop ends at pr on one tree");
});

row("W-610-b5 a source change after a pass orders the light gates and a delta review, never ci or pr", () => {
  const w = passed("w610-b5");
  const reviewed = sourceTree(w.wt);
  writeGates(w);
  advanceSource(w, false, false);
  builderHandoff(w, "2026-10-02T09:30:00.000Z");
  const o = next(w, [OPUS, ...BUDGET]);
  expectStep(o, "build", "named", "the changed tree goes back to the light gates");
  assert.equal(o.kv.has("light-gates"), true, ran("the light gates, not ci", o));
  assert.doesNotMatch(o.kv.get("command") ?? "", /ci --opus/, ran("no ci on the old pass", o));
  performLight(w);
  const r = next(w, [OPUS, ...BUDGET]);
  expectStep(r, "review", "named", "a delta review");
  assert.equal(r.kv.get("delta"), `since round 1 passed at ${reviewed}`, ran("the review order names the delta's base", r));
});
