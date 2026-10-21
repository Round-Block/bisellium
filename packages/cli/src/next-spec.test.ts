/**
 * W-179: one behaviour group of the next.test.ts rows (studio/briefs/W-179.md); the fixture is ./next-world.test.ts.
 * Select one row with --test-name-pattern='^<row id>\s'.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readFront, type Manifest } from "@bisellium/adapter-native";
import { inspectUiDesignInput, type NativeRecord } from "@bisellium/commands/opus-model.js";
import { deriveNext, readSpecReviewer, type Facts } from "./next.js";
import { BLOCKER, BRANCH, BRIEF_REL, BUDGET, F, MAIN, NO_FINDINGS, OPUS, SETUP_ENV, SR, SR_MODEL, SR_ROW, SrOpts, T, TSX, World, addReview, advanceSource, architectOrder, briefPath, briefText, buildFix, commit, editRecord, expectStep, git, gitq, handoffAt, landed, n167, next, put, putBrief, ran, review, reviewNamed, reviewerOrder, rt, sign, specHeld, specLog, specNext, srWorld, trial, verb, w167, world, writeReceipt, writeReds, writeTranscript } from "./next-world.test.js";
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ARCHITECT_ROW = "  - { id: architect, collegium: design, kind: agent }";
const readLog = (w: World, n: number): string => readFileSync(join(w.repo, specLog(n)), "utf8");
const writeLog = (w: World, n: number, text: string): void => writeFileSync(join(w.repo, specLog(n)), text);

test("W-162-b1 behaviour 1: a valid reviewer setting sends a signed spec to the reviewer, while bad settings and UI opera hold", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b1");
  putBrief(w);
  sign(w, 1);
  const o = specNext(w);
  reviewerOrder(o, 2, "a working-tree signature with no review");
  const inputs = o.kv.get("inputs") ?? "";
  assert.match(inputs, /briefs\/W-900\.md/, ran("the brief is an input", o));
  assert.match(inputs, /ci\/W-900-spec-1\.log/, ran("the signature log is an input", o));
  const command = o.kv.get("command") ?? "";
  assert.match(command, /does its Input domain name every record the opus reads, with one rejecting function that fails closed\?/, ran("question 1", o));
  assert.match(command, /can every promise be guaranteed, or does it state its limit\?/, ran("question 2", o));
  assert.match(command, /bisellium verdict W-900 --round 2 --sella spec-reviewer --model gpt-5\.6-sol --outcome <passed\|failed> --phase spec --from <file> --studio studio/, ran("the exact verdict command", o));
  assert.equal(o.out.includes("traditio"), false, ran("the reviewer order reads no handover", o));

  // an absent key preserves the existing commit path
  const absent = srWorld("w162-b1-absent", { setting: null });
  putBrief(absent);
  sign(absent, 1);
  const kept = specNext(absent);
  expectStep(kept, "branch", "named", "absent key: the signed spec names branch");
  assert.equal(kept.kv.has("role"), false, ran("absent key names no order", kept));

  const bad: [string, SrOpts][] = [
    ["null", { setting: "null" }],
    ["another type", { setting: "42" }],
    ["an unknown seat", { setting: "ghost" }],
    ["a retired seat", { row: SR_ROW.replace(" }", ", retired: true }") }],
    ["the design magister", { setting: "architect", edit: (t) => t.replace(ARCHITECT_ROW, "  - { id: architect, collegium: design, kind: agent, model: gpt-5.6-sol, harness: codex }") }],
    ["a non-agent seat", { row: SR_ROW.replace("kind: agent", "kind: orchestrator") }],
    ["a non-codex harness", { row: SR_ROW.replace("harness: codex", "harness: claude-code") }],
    ["a missing harness", { row: SR_ROW.replace(", harness: codex", "") }],
    ["a missing model", { row: SR_ROW.replace(` model: ${SR_MODEL},`, "") }],
    ["another codex model", { row: SR_ROW.replace(SR_MODEL, "gpt-5.6-terra") }],
  ];
  for (const [name, opts] of bad) {
    const b = srWorld(`w162-b1-bad-${name.replace(/\W+/g, "-")}`, opts);
    putBrief(b);
    sign(b, 1);
    specHeld(specNext(b), `${name} holds at spec`, /spec_reviewer|spec-reviewer/);
  }

  // W-338: a kind: ui opus takes the spec review: signed, it goes to the reviewer
  const ui = srWorld("w162-b1-ui");
  editRecord(ui, "repo", (doc) => doc.setIn(["kind"], "ui"));
  commit(ui.repo, "studio: W-900 is a ui opus");
  putBrief(ui);
  sign(ui, 1);
  reviewerOrder(specNext(ui), 2, "a signed kind: ui opus goes to the reviewer");
});

test("W-162-b1 behaviour 1 review round 1: a duplicate reviewer-seat row holds at spec even when the first row is valid", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b1-r1-dup-seat", { row: `${SR_ROW}\n${SR_ROW}` });
  putBrief(w);
  sign(w, 1);
  specHeld(specNext(w), "two rows for the reviewer seat hold", /spec_reviewer|spec-reviewer/);
});

test("W-162-b1 behaviour 1 review round 1: a duplicate design collegium row holds at spec even when the first row is valid", { timeout: 1_800_000 }, () => {
  const design = "  - { id: design, name: Design, magister: architect }";
  const w = srWorld("w162-b1-r1-dup-design", { edit: (t) => t.replace(design, `${design}\n${design}`) });
  putBrief(w);
  // W-306: the writer refuses any spec verdict under two design rows, so no signature exists for next to read
  assert.throws(() => sign(w, 1), /declares the design collegium 2 times/, "the writer refuses the signature");
  specHeld(specNext(w), "two design collegium rows hold", /spec_reviewer|spec-reviewer/);
});

test("W-162-b2 behaviour 2: architect signatures and review verdicts are strict, and their outcomes agree with their findings", { timeout: 1_800_000 }, () => {
  // editing the brief after the signature orders the architect at the next round, not the reviewer
  const w = srWorld("w162-b2-blob");
  putBrief(w);
  const blob = gitq(w.repo, ["hash-object", briefPath(w)]);
  sign(w, 1);
  appendFileSync(briefPath(w), "\nEdited after the signature.\n");
  architectOrder(specNext(w), 2, "a brief edited after its signature");

  // the writer pins the brief's blob on a non-UI spec-phase verdict
  assert.match(readLog(w, 1), new RegExp(`^# brief: briefs/W-900\\.md blob:${blob}$`, "m"), "the signature carries # brief: <path> blob:<sha1>");

  // and refuses, writing nothing, when the brief is unreadable
  const bare = srWorld("w162-b2-nobrief");
  const from = join(bare.root, "none.md");
  writeFileSync(from, NO_FINDINGS);
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "verdict", OPUS, "--round", "1", "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", from, "--studio", bare.studio, "--now", T.spec], { cwd: bare.repo, env: SETUP_ENV, encoding: "utf8" });
  assert.equal(r.status, 2, `an unreadable brief exits 2\n${r.stderr}${r.stdout}`);
  assert.match(r.stderr, /brief/, "the refusal names the brief");
  assert.equal(existsSync(join(bare.repo, specLog(1))), false, "no spec log is written");

  // a sole signature that is not strictly valid anchors nothing: the architect signs again
  const lone: [string, (t: string) => string][] = [
    ["a signature with no brief header", (t) => t.replace(/^# brief: .*\n/m, "")],
    ["a signature with a duplicate sella header", (t) => t.replace(/^# sella: architect\n/m, "# sella: architect\n# sella: architect\n")],
    ["a signature by another sella", (t) => t.replace("# sella: architect", "# sella: qa-lead")],
    ["a signature for another phase", (t) => t.replace("# phase: spec", "# phase: build")],
    ["a signature with a blocking finding", (t) => t.replace("No findings", "1. blocking brief:7 a defect. check: none: x")],
  ];
  for (const [name, mutate] of lone) {
    const s = srWorld(`w162-b2-lone-${name.replace(/\W+/g, "-")}`);
    putBrief(s);
    sign(s, 1);
    writeLog(s, 1, mutate(readLog(s, 1)));
    architectOrder(specNext(s), 2, `${name} is no signature`);
  }

  // a log above the newest valid signature must be that signature's strict review: nothing is skipped
  const above: [string, (t: string) => string, RegExp][] = [
    ["a review with no model", (t) => t.replace(/^# model: .*\n/m, ""), /spec-2\.log/],
    ["a review with another model", (t) => t.replace(`# model: ${SR_MODEL}`, "# model: gpt-5.6-terra"), /spec-2\.log/],
    ["a review with a duplicate header", (t) => t.replace(/^# outcome: passed\n/m, "# outcome: passed\n# outcome: passed\n"), /spec-2\.log/],
    ["a review with no brief header", (t) => t.replace(/^# brief: .*\n/m, ""), /spec-2\.log/],
    ["a review with no Findings section", (t) => t.replace("## Findings", "## Notes"), /spec-2\.log/],
    ["a review by another sella", (t) => t.replace(`# sella: ${SR}`, "# sella: qa-lead"), /spec-2\.log/],
    ["a review of another round", (t) => t.replace("# round: 2", "# round: 5"), /spec-2\.log/],
    ["a review of another phase", (t) => t.replace("# phase: spec", "# phase: build"), /spec-2\.log/],
    ["a review naming another brief blob", (t) => t.replace(/blob:[0-9a-f]{40}/, `blob:${"0".repeat(40)}`), /spec-2\.log/],
    ["a review with an unknown outcome", (t) => t.replace("# outcome: passed", "# outcome: passed with notes"), /spec-2\.log/],
  ];
  for (const [name, mutate, why] of above) {
    const s = srWorld(`w162-b2-above-${name.replace(/\W+/g, "-")}`);
    putBrief(s);
    sign(s, 1);
    review(s, 2, "passed");
    writeLog(s, 2, mutate(readLog(s, 2)));
    specHeld(specNext(s), `${name} holds`, why);
  }
  // outcome and findings must agree
  const blocked = srWorld("w162-b2-passed-blocker");
  putBrief(blocked);
  sign(blocked, 1);
  review(blocked, 2, "passed", { body: BLOCKER });
  specHeld(specNext(blocked), "passed beside a blocking finding holds", /spec-2\.log/);
  const empty = srWorld("w162-b2-failed-none");
  putBrief(empty);
  sign(empty, 1);
  review(empty, 2, "failed", { body: NO_FINDINGS });
  assert.equal(specNext(empty).first, `next: ${OPUS} branch named`, "W-246: failed beside No findings passes to branch");
  const unchecked = srWorld("w162-b2-no-check");
  putBrief(unchecked);
  sign(unchecked, 1);
  review(unchecked, 2, "failed", { body: BLOCKER });
  writeLog(unchecked, 2, readLog(unchecked, 2).replace(" check: none: no rule", ""));
  specHeld(specNext(unchecked), "a numbered finding with no check holds", /spec-2\.log/);

  // malformed names hold, wherever they sit
  for (const name of [`${OPUS}-spec-01.log`, `${OPUS}-spec-x.log`, `${OPUS}-spec-2.txt`]) {
    const n = srWorld(`w162-b2-name-${name.replace(/\W+/g, "-")}`);
    putBrief(n);
    sign(n, 1);
    put(n.repo, `studio/ci/${name}`, "junk\n");
    specHeld(specNext(n), `the name ${name} holds`, /spec-/);
  }

  // a malformed newest signature is not skipped in favour of an older one
  const newest = srWorld("w162-b2-newest");
  putBrief(newest);
  sign(newest, 1);
  sign(newest, 2);
  writeLog(newest, 2, readLog(newest, 2).replace(/^# brief: .*\n/m, ""));
  specHeld(specNext(newest), "a malformed newest signature holds", /spec-2/);
});

test("W-162-b3 behaviour 3: only a passed review after the newest architect signature unlocks commit, landing and branch", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b3");
  putBrief(w);
  sign(w, 1);
  review(w, 2, "passed");
  const named = specNext(w);
  expectStep(named, "branch", "named", "signature 1 plus passed review 2 names branch");
  assert.equal(named.kv.has("role"), false, ran("no order is named", named));

  const master = git(w.repo, ["rev-parse", "master"]);
  const done = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectStep(done, "branch", "performed", "the spec is committed by branch");
  assert.match(done.out, /^branch: opus\/W-900$/m, ran("the branch line", done));
  assert.match(done.out, /^commit: [0-9a-f]+$/m, ran("the commit line", done));
  assert.equal(git(w.repo, ["rev-parse", `${BRANCH}^`]), master, "opus/<id> is master plus one commit");
  assert.deepEqual(git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", BRANCH]).split("\n").sort(), [BRIEF_REL, specLog(1), specLog(2)], "exactly the brief and both validated logs");

  // ready is attributed to the signer, never the reviewer
  const ready = next(w, [OPUS]);
  expectStep(ready, "ready", "named", "ready follows branch");
  assert.match(ready.out, /^attributed: architect \(signed ci\/W-900-spec-1\.log\)$/m, ran("attributed to the signer", ready));
  assert.match(ready.out, /--sella architect /, ran("the ready command names the design magister", ready));
  assert.doesNotMatch(ready.out, /--sella spec-reviewer/, ran("never the reviewer", ready));

  // a signature with no passed review does not unlock anything, committed or not
  const only = srWorld("w162-b3-only");
  putBrief(only);
  sign(only, 1);
  landed(only);
  reviewerOrder(specNext(only), 2, "a committed signature with no review");

  // an edit after a passed review orders the architect, in the working tree and on the trunk
  const edited = srWorld("w162-b3-edit");
  putBrief(edited);
  sign(edited, 1);
  review(edited, 2, "passed");
  appendFileSync(briefPath(edited), "\nEdited after the review.\n");
  architectOrder(specNext(edited), 3, "a working-tree brief edited after a passed review");
  const trunk = srWorld("w162-b3-edit-trunk");
  putBrief(trunk);
  sign(trunk, 1);
  review(trunk, 2, "passed");
  landed(trunk);
  appendFileSync(briefPath(trunk), "\nEdited after the review.\n");
  commit(trunk.repo, "spec: brief edited after review");
  architectOrder(specNext(trunk), 3, "a trunk brief edited after a passed review");

  // a newer signature needs a newer review
  for (const committed of [false, true]) {
    const s = srWorld(`w162-b3-resign-${committed}`);
    putBrief(s);
    sign(s, 1);
    review(s, 2, "passed");
    sign(s, 3);
    if (committed) landed(s);
    const o = specNext(s);
    reviewerOrder(o, 4, `signature 3 after a passed review 2 (committed: ${committed})`);
    assert.doesNotMatch(o.out, /^next: W-900 branch/m, ran("never branch", o));
  }

  // the review's model must be exact, independently of the sella header
  for (const [name, opts] of [
    ["another model", { model: "gpt-5.6-terra" }],
    ["another sella with the right model", { sella: "qa-lead" }],
  ] as const) {
    const s = srWorld(`w162-b3-model-${name.replace(/\W+/g, "-")}`);
    putBrief(s);
    sign(s, 1);
    review(s, 2, "passed", opts);
    specHeld(specNext(s), `a passed review by ${name} holds`);
  }

  // a merged record past ready keeps today's check: pre-gate logs (no brief header, no review) go past spec
  const past = srWorld("w162-b3-past-ready", { upTo: "spec" });
  writeFileSync(join(past.repo, specLog(1)), readLog(past, 1).replace(/^# brief: .*\n/m, ""));
  editRecord(past, "repo", (doc) => doc.setIn(["state"], "building"));
  commit(past.repo, "studio: W-900 is building on the trunk");
  expectStep(next(past, [OPUS]), "branch", "named", "a past-ready record goes past spec as today");
});

test("W-162-b4 behaviour 4: a failed review returns to the architect, and only a newer signature can reopen review", { timeout: 1_800_000 }, () => {
  const w = srWorld("w162-b4");
  putBrief(w);
  sign(w, 1);
  review(w, 2, "failed");
  const o = specNext(w);
  architectOrder(o, 3, "signature 1 plus failed review 2");
  const inputs = o.kv.get("inputs") ?? "";
  assert.match(inputs, /briefs\/W-900\.md/, ran("the brief is an input", o));
  assert.match(inputs, /ci\/W-900-spec-2\.log/, ran("the failed review is an input", o));

  // a second reviewer verdict, with no signature between, holds and cannot erase the finding
  review(w, 3, "passed");
  specHeld(specNext(w), "a second reviewer verdict after a failed review holds", /spec-3|second|another/);

  // the architect's re-sign order resumes, so it needs a handover; the reviewer order does not
  const gated = srWorld("w162-b4-gate", { handoff: false });
  putBrief(gated);
  sign(gated, 1);
  reviewerOrder(specNext(gated), 2, "the first reviewer order needs no traditio");
  review(gated, 2, "failed");
  specHeld(specNext(gated), "the architect's order is held until the record carries a traditio", /stale handover/);
  handoffAt(gated, "repo", T.handoffFresh);
  architectOrder(specNext(gated), 3, "the architect's order with a handover");
  sign(gated, 3);
  reviewerOrder(specNext(gated), 4, "signature 3 orders the reviewer at round 4");
  review(gated, 4, "passed");
  const commitNamed = specNext(gated);
  expectStep(commitNamed, "branch", "named", "passed review 4 names branch");

  // a malformed log at round 2 holds; a valid signature at round 3 makes it history
  const bad = srWorld("w162-b4-history");
  putBrief(bad);
  sign(bad, 1);
  put(bad.repo, specLog(2), "junk, not a verdict\n");
  specHeld(specNext(bad), "a malformed log at round 2 holds", /spec-2/);
  sign(bad, 3);
  reviewerOrder(specNext(bad), 4, "a valid signature at round 3 makes the malformed log history");
});

// ---------------------------------------------------------------------------
// W-196: with `brief_behaviour_limit` declared, a signed brief that fails admission takes an architect
// order, never the reviewer's. Rows are selectable with --test-name-pattern=W-196-b4.
// ---------------------------------------------------------------------------
const W196_ADMITTED = [
  `# ${OPUS} fixture brief`,
  "",
  "Read enumeration: `enumerate-reads.mjs` -> `reads.txt`",
  "",
  "## Intent",
  "",
  "Decree family: fixture",
  "",
  "## Files owned",
  "",
  "- `source.txt`",
  "",
  "## Interfaces",
  "",
  "None.",
  "",
  "## Input domain",
  "",
  "A rejection fails closed.",
  "",
  "| Record | Valid domain | Rejected by |",
  "|---|---|---|",
  '| fixture record | a string | `readFixture`, pinned by `W-900-b1` "row 1 fails" |', // W-322: the row's pin
  "",
  "## Behaviours to test",
  "",
  "1. **Fixture behaviour 1.**",
  "   **Genuine red:** row 1 fails.",
  "",
  "## Acceptance",
  "",
  "Fixture.",
  "",
  "## Out of scope",
  "",
  "None.",
  "",
].join("\n");
const w196World = (tag: string, limit: string): World => srWorld(tag, { edit: (t) => `${t}brief_behaviour_limit: ${limit}\n` });

test("W-196-b4 behaviour 4: next sends an inadmissible signed brief back to the architect", { timeout: 1_800_000 }, () => {
  const bad = w196World("w196-b4-bad", "6");
  putBrief(bad);
  sign(bad, 1);
  const o = specNext(bad);
  architectOrder(o, 2, "an inadmissible signed brief goes back to the architect");
  assert.match(o.kv.get("why") ?? "", /^brief\.admission: .*cites no read enumeration/, ran("why names the admission problems", o));
  assert.match(o.kv.get("inputs") ?? "", /ci\/W-900-spec-1\.log/, ran("the signature is an input", o));
  assert.equal(o.out.includes(SR_MODEL), false, ran("no reviewer model is named", o));

  // W-319: W196_ADMITTED's Input domain row (brief:23, brief:25 under the added sentence) needs a ledger line in the signature
  const ledger = join(bad.root, "w319-ledger.md");
  writeFileSync(ledger, "brief:23 brief:25, fixture record: fixture.ts:1 readFixture — holds\n");
  const LEDGERED = `Promise ledger: ${ledger}\n\n${NO_FINDINGS}`;
  const promise = w196World("w196-b4-promise", "6");
  put(promise.repo, BRIEF_REL, W196_ADMITTED.replace("Decree family: fixture", "Decree family: fixture\n\nThe step always runs."));
  sign(promise, 1, LEDGERED);
  const p = specNext(promise);
  architectOrder(p, 2, "an unqualified absolute phrase goes back to the architect");
  assert.match(p.kv.get("why") ?? "", /^brief\.admission: .*says "always" outside a promise line/, ran("why names the phrase", p));

  const good = w196World("w196-b4-good", "6");
  put(good.repo, BRIEF_REL, W196_ADMITTED);
  sign(good, 1, LEDGERED);
  const g = specNext(good);
  reviewerOrder(g, 2, "an admissible signed brief goes to the reviewer");

  const off = srWorld("w196-b4-off");
  putBrief(off);
  sign(off, 1);
  reviewerOrder(specNext(off), 2, "no limit: no admission, the reviewer as before");

  const malformed = w196World("w196-b4-malformed", "0");
  putBrief(malformed);
  sign(malformed, 1);
  const m = specNext(malformed);
  specHeld(m, "a malformed limit holds", /^brief\.admission: brief_behaviour_limit must be a positive integer$/);

  // the unchanged gateDispatch holds the architect order without --budget (E10), and without a traditio, a resumed order (E11)
  const nobudget = next(bad, [OPUS]);
  specHeld(nobudget, "no --budget holds the architect order", /^dispatch budget undeclared$/);
  const nohandoff = srWorld("w196-b4-nohandoff", { handoff: false, edit: (t) => `${t}brief_behaviour_limit: 6\n` });
  putBrief(nohandoff);
  sign(nohandoff, 1);
  const nh = specNext(nohandoff);
  specHeld(nh, "no traditio holds the architect order", /^stale handover: .*no traditio/);
  const nobudgetGood = next(good, [OPUS]);
  specHeld(nobudgetGood, "no --budget holds the reviewer order too", /^dispatch budget undeclared$/);

  const failed = w196World("w196-b4-failed", "6");
  put(failed.repo, BRIEF_REL, W196_ADMITTED);
  sign(failed, 1, LEDGERED);
  review(failed, 2, "failed");
  architectOrder(specNext(failed), 3, "a failed review still returns to the architect");
});

// ---------------------------------------------------------------------------
// W-215: the review orders name the packet, the resume and --session. Rows are
// selectable with --test-name-pattern=W-215-b3.
// ---------------------------------------------------------------------------
test("W-215-b3 behaviour 3: the spec reviewer's order resumes the recorded session and names the packet", { timeout: 1_800_000 }, () => {
  const w = srWorld("w215-b3-spec");
  putBrief(w);
  sign(w, 1);
  review(w, 2, "failed", { extra: ["--session", "S1"] });
  sign(w, 3);
  const o = specNext(w);
  reviewerOrder(o, 4, "a failed review under session S1, then a new signature");
  assert.equal(o.kv.get("session"), "S1", ran("the order carries the session", o));
  const command = o.kv.get("command") ?? "";
  assert.match(command, /^resume spec-reviewer's session S1 \(gpt-5\.6-sol\) with the packet's prompt, on the same two questions \(D-046\):/, ran("the first line resumes", o));
  assert.match(command, /scripts\/review-packet\.mjs --phase spec --opus W-900 --round 4 --sella spec-reviewer --studio studio --repo \. --packets /, ran("the packet command", o));
  assert.match(command, /studio\/prompts\/rebuttal\.md/, ran("the dispute line", o));
  assert.match(command, /--studio studio --session S1$/, ran("the record command ends with the session", o));

  const first = srWorld("w215-b3-spec-first");
  putBrief(first);
  sign(first, 1);
  const none = specNext(first);
  reviewerOrder(none, 2, "no session recorded");
  assert.equal(none.kv.has("session"), false, ran("no session line", none));
  const c = none.kv.get("command") ?? "";
  assert.match(c, /^dispatch spec-reviewer \(gpt-5\.6-sol\) to review the signed spec once, on two questions only \(D-046\):/, ran("the round-1 wording is kept", none));
  assert.match(c, /scripts\/review-packet\.mjs --phase spec --opus W-900 --round 2 --sella spec-reviewer/, ran("the packet command", none));
  assert.match(c, /rebuttal/, ran("the dispute line", none));
  assert.match(c, /--studio studio --session <the session id the reviewer prints>$/, ran("the record command asks for the printed session", none));
});

test("W-215-b3 behaviour 3: the censor's order resumes the recorded build session", { timeout: 1_800_000 }, () => {
  const w = world("w215-b3-build", "build");
  addReview(w, "failed", 1, rt(1), F, ["--session", "S9"]);
  handoffAt(w, "wt", T.handoffFresh);
  advanceSource(w);
  const o = n167(w);
  reviewNamed(o, 2, "review 1 failed under S9, then a source change");
  assert.equal(o.kv.get("session"), "S9", ran("the order carries the session", o));
  const command = o.kv.get("command") ?? "";
  assert.match(command, /^resume qa-lead's session S9 with the packet's prompt/, ran("the censor resumes", o));
  assert.match(command, /scripts\/review-packet\.mjs --phase build --opus W-900 --round 2 --sella qa-lead/, ran("the packet command", o));
  assert.match(command, /rebuttal/, ran("the dispute line", o));
  assert.match(command, /--studio studio --session S9;/, ran("--session follows --studio in the record command", o));

  const plain = world("w215-b3-build-plain", "build");
  addReview(plain, "failed", 1, rt(1), F);
  handoffAt(plain, "wt", T.handoffFresh);
  advanceSource(plain);
  const p = n167(plain);
  reviewNamed(p, 2, "review 1 failed with no session");
  assert.equal(p.kv.has("session"), false, ran("no session line", p));
  assert.match(p.kv.get("command") ?? "", /^dispatch qa-lead; /, ran("today's wording", p));
  assert.match(p.kv.get("command") ?? "", /--studio studio --session <the session id the reviewer prints>;/, ran("the record command asks for the printed session", p));
});

// ---------------------------------------------------------------------------
// W-246: spec review passes on advice, stops at two failed rounds (a third is a split),
// and build review has no cap. Rows are selectable with --test-name-pattern=W-246-b<n>.
// ---------------------------------------------------------------------------
test("W-246-b1 behaviour 1: an advisory-only spec review passes", { timeout: 1_800_000 }, () => {
  const rows: [string, string][] = [
    ["advisory", "## Findings\n1. advisory brief:7 a wording note. check: none: x\n"],
    ["none", NO_FINDINGS],
    ["uncited", "## Findings\n1. blocking the Input domain omits a record [design: changes]. check: none: x\n"],
  ];
  for (const [name, body] of rows) {
    const w = srWorld(`w246-b1-${name}`);
    putBrief(w);
    sign(w, 1);
    review(w, 2, "failed", { body });
    assert.match(readLog(w, 2), /^# outcome: passed$/m, `${name}: a failed submission with no standing blocker is recorded passed`);
    assert.match(readLog(w, 2), /^# submitted_outcome: failed$/m, `${name}: the submitted outcome is kept`);
    const o = specNext(w);
    expectStep(o, "branch", "named", `${name}: the passed review names branch`);
  }
  const cited = srWorld("w246-b1-cited");
  putBrief(cited);
  sign(cited, 1);
  review(cited, 2, "failed", { body: BLOCKER });
  assert.match(readLog(cited, 2), /^# outcome: failed$/m, "a blocker citing brief:7 still fails");
  architectOrder(specNext(cited), 3, "a standing blocker orders the architect");
});

test("W-246-b2 behaviour 2: two failed spec reviews since the newest re-spec end review; the next signature stands", { timeout: 1_800_000 }, () => {
  const why = `ci/${OPUS}-spec-2.log and ci/${OPUS}-spec-4.log failed; D-061 §4: no third review: the producer files the remainder as a new opus, then the architect cuts the brief to what passed and signs`;
  const split = `bisellium new --kind <kind> --collegium <collegium> --title <the remainder> --parent ${OPUS} studio`;
  const edit = (w: World, n: number): void => appendFileSync(briefPath(w), `\nChanged before signature ${n}.\n`);
  /** Signatures 1 and 3, failed reviews 2 and 4. */
  const twice = (tag: string): World => {
    const w = srWorld(tag);
    putBrief(w);
    sign(w, 1);
    review(w, 2, "failed");
    sign(w, 3);
    review(w, 4, "failed");
    return w;
  };

  const w = twice("w246-b2");
  const order = specNext(w);
  architectOrder(order, 5, "two failed reviews end review");
  assert.equal(order.kv.get("why"), why, ran("why names both failed logs", order));
  assert.equal(order.kv.get("split"), split, ran("the split line", order));
  sign(w, 5);
  const named = specNext(w);
  expectStep(named, "branch", "named", "signature 5 stands without a third review");
  assert.equal(named.kv.has("role"), false, ran("no reviewer is ordered", named));
  const done = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectStep(done, "branch", "performed", "the split spec rides branch");
  assert.deepEqual(git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", BRANCH]).split("\n").sort(), [BRIEF_REL, ...[1, 2, 3, 4, 5].map(specLog)], "the brief and every round");
  expectStep(next(w, [OPUS]), "ready", "named", "the branch counts the same and names ready");

  const once = srWorld("w246-b2-once");
  putBrief(once);
  sign(once, 1);
  review(once, 2, "failed");
  sign(once, 3);
  reviewerOrder(specNext(once), 4, "one failed review, then a signature, orders the reviewer");

  // since the newest re-spec (D-063 §7): a passed review starts the count again
  const passed = twice("w246-b2-passed");
  sign(passed, 5);
  review(passed, 6, "passed");
  edit(passed, 7);
  sign(passed, 7);
  reviewerOrder(specNext(passed), 8, "a passed review ends the count");
  review(passed, 8, "failed");
  const again = specNext(passed);
  architectOrder(again, 9, "one failed review since the passed one");
  assert.equal(again.kv.has("split"), false, ran("no split line", again));
  sign(passed, 9);
  reviewerOrder(specNext(passed), 10, "so the signature orders the reviewer");

  // after a split: the signature that stood ends the count
  const stood = twice("w246-b2-stood");
  sign(stood, 5);
  assert.equal(specNext(stood).kv.has("role"), false, "signature 5 stands");
  edit(stood, 6);
  sign(stood, 6);
  const after = specNext(stood);
  reviewerOrder(after, 7, "a signature after the standing one orders the reviewer");
  assert.equal(after.kv.has("split"), false, ran("no split line", after));
});

test("W-246-b3 behaviour 3: build review has no cap", { timeout: 1_800_000 }, () => {
  const w = w167("w246-b3", [F, F, F]);
  // W-297 (D-085 C): three failed rounds in a row hold the fix until the architect signs again; that is routing, not a cap
  const resign = (n: number, after: number): void => {
    verb(w.wt, ["verdict", OPUS, "--round", String(n), "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", writeTranscript(w, `w246-resign-${n}.md`), "--studio", w.wtStudio, "--now", new Date(Date.parse(rt(after)) + 10 * 60_000).toISOString()]);
    commit(w.wt, `studio(${OPUS}): the architect signs again`);
  };
  expectStep(n167(w), "build", "held", "three failures hold the fix for the architect");
  resign(2, 3);
  buildFix(n167(w), "three failures name build, phase fix");
  advanceSource(w);
  reviewNamed(n167(w), 4, "a fix names round 4");
  addReview(w, "failed", 4, rt(4), F);
  resign(3, 4);
  buildFix(n167(w), "a fourth failure names build, phase fix again");
  trial(w, [{ dir: "wt", rel: `studio/opera/${OPUS}.md`, text: (t) => t.replace("\n---\n", "\nround_rulings: nonsense\n---\n") }], () => buildFix(n167(w), "round_rulings is no longer read"));
  const order = w167("w246-b3-order", [F]);
  advanceSource(order);
  const command = n167(order).kv.get("command") ?? "";
  assert.doesNotMatch(command, /three-round cap/, "the censor's order names no cap");
  assert.doesNotMatch(command, /D-044/, "the censor's order cites no D-044");
});

// ---------------------------------------------------------------------------
// W-255 (D-063 §4): next's signature gates accept a signed brief marked "Brief: light" (four sections, the
// admission of a light brief, a declared limit, the Red order line). Rows are selectable with
// --test-name-pattern=W-255-b3.
// ---------------------------------------------------------------------------
interface LightOpts {
  mark?: string | null;
  family?: boolean;
  redOrder?: boolean;
  owned?: string;
  behaviours?: number;
  exception?: string;
  acceptance?: boolean;
}
/** A light brief: Intent, Files owned, Behaviours with a red command each and Acceptance; no Interfaces, Out of scope or Input domain. */
function w255Light(o: LightOpts = {}): string {
  const rows = Array.from({ length: o.behaviours ?? 1 }, (_, i) => [
    `${i + 1}. **Fixture behaviour ${i + 1}.**`,
    `   **Genuine red:** \`bisellium red ${OPUS} --behaviour ${i + 1} --sella builder -- node x\` fails.`,
  ]).flat();
  return [
    `# ${OPUS} fixture light brief`,
    "",
    "## Intent",
    "",
    ...(o.mark === null ? [] : [o.mark ?? "Brief: light"]),
    ...(o.family === false ? [] : ["Decree family: fixture"]),
    ...(o.redOrder === false ? [] : ["Red order: one at a time"]),
    ...(o.exception === undefined ? [] : [`Behaviour limit exception: ${o.exception}`]),
    "",
    "## Files owned",
    "",
    `- \`${o.owned ?? "source.txt"}\``,
    "",
    "## Behaviours to test",
    "",
    ...rows,
    "",
    ...(o.acceptance === false ? [] : ["## Acceptance", "", "Fixture.", ""]),
  ].join("\n");
}

test("W-255-b3 behaviour 3: next's signature gates accept a signed light brief and refuse the rest", { timeout: 1_800_000 }, () => {
  const ok = w196World("w255-b3", "6");
  put(ok.repo, BRIEF_REL, w255Light());
  sign(ok, 1);
  reviewerOrder(specNext(ok), 2, "a signed light brief goes to the reviewer");
  review(ok, 2, "passed");
  const named = specNext(ok);
  expectStep(named, "branch", "named", "a reviewed light brief names branch");
  expectStep(next(ok, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", "the light spec rides branch");
  expectStep(next(ok, [OPUS]), "ready", "named", "the branch carries the light spec: ready follows");

  const refuse = (tag: string, text: string, why: RegExp, setup?: (w: World) => void): void => {
    const w = w196World(`w255-b3-${tag}`, "6");
    setup?.(w);
    put(w.repo, BRIEF_REL, text);
    sign(w, 1);
    const o = specNext(w);
    architectOrder(o, 2, `${tag} goes back to the architect`);
    assert.match(o.kv.get("why") ?? "", why, ran(`${tag}: why`, o));
    assert.equal(o.out.includes(SR_MODEL), false, ran(`${tag}: no reviewer model is named`, o));
  };
  refuse("nomark", w255Light({ mark: null }), /lacks the six design-lex sections/);
  refuse("variant", w255Light({ mark: "Brief: Light" }), /brief form line "Brief: Light" is not exactly "Brief: light"/);
  refuse("pipeline", w255Light({ owned: ".github/workflows/ci.yml" }), /a light brief is not for security, sandbox, branch-protection or pipeline work/);
  refuse("nofamily", w255Light({ family: false }), /declares no decree family/);
  refuse("nored", w255Light({ redOrder: false }), /declares no red order; add the line "Red order: one at a time"/);
  refuse("noaccept", w255Light({ acceptance: false }), /lacks the four light-brief sections/);
  refuse("seven", w255Light({ behaviours: 7 }), /numbers 7 behaviours; the limit is 6/);
  const grant = (w: World): void => {
    put(w.studio, "decisions/D-900.md", "---\nid: D-900\nby: architect\n---\nW-900 may hold seven behaviours.\n");
    commit(w.repo, "studio: D-900");
  };
  const granted = w196World("w255-b3-granted", "6");
  grant(granted);
  put(granted.repo, BRIEF_REL, w255Light({ behaviours: 7, exception: "D-900" }));
  sign(granted, 1);
  reviewerOrder(specNext(granted), 2, "seven behaviours with an exception go to the reviewer");
  refuse("badgrant", w255Light({ behaviours: 7, exception: "D-901" }), /behaviour limit exception: decision "D-901" not found/, grant);

  const solo = (tag: string): World => srWorld(tag, { row: null, setting: null, edit: (t) => `${t}brief_behaviour_limit: 6\n` });
  const alone = solo("w255-b3-solo");
  put(alone.repo, BRIEF_REL, w255Light());
  sign(alone, 1);
  landed(alone);
  expectStep(specNext(alone), "branch", "named", "no reviewer: a signed, committed light brief names branch");
  const over = solo("w255-b3-solo-over");
  put(over.repo, BRIEF_REL, w255Light({ behaviours: 7 }));
  sign(over, 1);
  landed(over);
  const o = specNext(over);
  architectOrder(o, 2, "no reviewer: seven behaviours and no exception go back to the architect");
  assert.match(o.kv.get("why") ?? "", /numbers 7 behaviours; the limit is 6/, ran("the limit", o));

  // an over-limit light brief with a valid exception: no reviewer, signedSpec passes as for a full brief
  const soloGranted = solo("w255-b3-solo-granted");
  grant(soloGranted);
  put(soloGranted.repo, BRIEF_REL, w255Light({ behaviours: 7, exception: "D-900" }));
  sign(soloGranted, 1);
  landed(soloGranted);
  expectStep(specNext(soloGranted), "branch", "named", "no reviewer: seven behaviours with a valid exception name branch");

  // W-246's split path: two failed reviews, split standing; the signed over-limit light brief stands without a third review
  const split = w196World("w255-b3-split", "6");
  grant(split);
  put(split.repo, BRIEF_REL, w255Light({ behaviours: 7, exception: "D-900" }));
  sign(split, 1);
  review(split, 2, "failed");
  sign(split, 3);
  review(split, 4, "failed");
  const splitOrder = specNext(split);
  architectOrder(splitOrder, 5, "two failed reviews end review");
  assert.match(splitOrder.kv.get("split") ?? "", /^bisellium new /, ran("the split line", splitOrder));
  sign(split, 5);
  const standing = specNext(split);
  expectStep(standing, "branch", "named", "split: the signed over-limit light brief with a valid exception stands");
  assert.equal(standing.kv.has("role"), false, ran("split: no reviewer is ordered", standing));
});

// W-264 (D-070 C, L-186): with no brief_behaviour_limit, next's signature gates admit a light brief by every rule but the count.
test("W-264-b2 behaviour 2: with no limit declared, next's signature gates admit a light brief by every rule but the count", { timeout: 1_800_000 }, () => {
  const ok = srWorld("w264-b2");
  put(ok.repo, BRIEF_REL, w255Light());
  sign(ok, 1);
  reviewerOrder(specNext(ok), 2, "no limit: a signed light brief goes to the reviewer");
  const seven = srWorld("w264-b2-seven");
  put(seven.repo, BRIEF_REL, w255Light({ behaviours: 7 }));
  sign(seven, 1);
  reviewerOrder(specNext(seven), 2, "no limit: seven behaviours go to the reviewer");
  const nofamily = srWorld("w264-b2-nofamily");
  put(nofamily.repo, BRIEF_REL, w255Light({ family: false }));
  sign(nofamily, 1);
  const o = specNext(nofamily);
  architectOrder(o, 2, "no limit: a light brief with no family goes back to the architect");
  assert.match(o.kv.get("why") ?? "", /declares no decree family/, ran("no limit: the family line", o));
  const variant = srWorld("w264-b2-variant");
  put(variant.repo, BRIEF_REL, w255Light({ mark: "Brief: Light" }));
  sign(variant, 1);
  const v = specNext(variant);
  architectOrder(v, 2, "no limit: a refused marker goes back to the architect");
  assert.match(v.kv.get("why") ?? "", /^briefs\/W-900\.md brief form line "Brief: Light" is not exactly "Brief: light"$/, ran("no limit: the form error alone, before admission", v));
  const alone = srWorld("w264-b2-solo", { row: null, setting: null });
  put(alone.repo, BRIEF_REL, w255Light());
  sign(alone, 1);
  landed(alone);
  expectStep(specNext(alone), "branch", "named", "no limit, no reviewer: a signed, committed light brief names branch");
});

// ---------------------------------------------------------------------------
// W-297 (D-086 A): a failed spec review whose every standing blocker keeps the design goes to branch, its blockers
// the required fixes the branch, reds, build and review orders name.
// ---------------------------------------------------------------------------
test("W-297-b2 behaviour 2: a failed spec review whose blockers all keep the design goes to branch, its blockers named as required fixes", { timeout: 1_800_000 }, () => {
  const KEEPS = (t: string): string => `blocking brief:7 ${t} [severity: S1] [design: keeps]. check: none: no rule`;
  const CHANGES = (t: string): string => `blocking brief:7 ${t} [severity: S1] [design: changes]. check: none: no rule`;
  const reviewed = (tag: string, ...lines: string[]): World => {
    const w = srWorld(tag);
    putBrief(w);
    sign(w, 1);
    review(w, 2, "failed", { body: `## Findings\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n` });
    return w;
  };
  const FIXES = "ci/W-900-spec-2.log #1, ci/W-900-spec-2.log #2";

  const keeps = reviewed("w297-b2-keeps", KEEPS("the Input domain omits a record"), KEEPS("a script's ratio is rounded"), "advisory brief:7 a nit [severity: S4] [design: changes]. check: none: no rule");
  const o = specNext(keeps);
  expectStep(o, "branch", "named", "two keeps blockers name branch");
  assert.equal(o.kv.get("required-fixes"), FIXES, ran("the branch order names both blockers as required fixes", o));
  assert.equal(o.kv.has("role"), false, ran("no architect or reviewer order", o));

  // one blocker that changes the design returns the brief to the architect, as today
  const mixed = reviewed("w297-b2-mixed", KEEPS("the Input domain omits a record"), CHANGES("the promise needs a new interface"));
  const m = specNext(mixed);
  architectOrder(m, 3, "a changes blocker beside a keeps blocker");
  assert.equal(m.kv.has("required-fixes"), false, ran("no required fixes", m));
  architectOrder(specNext(reviewed("w297-b2-changes", CHANGES("the promise needs a new interface"))), 3, "a lone changes blocker");
  // a recorded blocker with no design tag (a log the writer did not judge) keeps today's route
  const bare = reviewed("w297-b2-bare", KEEPS("the Input domain omits a record"));
  const log2 = join(bare.repo, specLog(2));
  writeFileSync(log2, readFileSync(log2, "utf8").replace(" [design: keeps]", ""));
  architectOrder(specNext(bare), 3, "a blocker with no design tag");
  // an uncited keeps blocker is advisory, so the round passed (W-246) and leaves no required fix
  const uncited = reviewed("w297-b2-uncited", "blocking the Input domain omits a record [severity: S1] [design: keeps]. check: none: no rule");
  const u = specNext(uncited);
  expectStep(u, "branch", "named", "an uncited blocker is converted and the round passes");
  assert.equal(u.kv.has("required-fixes"), false, ran("no required fixes", u));

  // after the branch, the reds, build-fix and review orders name the same fixes
  landed(keeps);
  git(keeps.repo, ["branch", BRANCH]);
  git(keeps.repo, ["worktree", "add", "-q", keeps.wt, BRANCH]);
  verb(keeps.wt, ["ready", OPUS, "--sella", "architect", "--studio", keeps.wtStudio, "--now", T.ready]);
  commit(keeps.wt, `studio(${OPUS}): ready`);
  handoffAt(keeps, "wt", T.handoffFresh);
  const reds = next(keeps, [OPUS, ...BUDGET]);
  expectStep(reds, "reds", "named", "the reds order");
  assert.equal(reds.kv.get("required-fixes"), FIXES, ran("the reds order names the required fixes", reds));
  writeReds(keeps);
  writeReceipt(keeps, "current");
  addReview(keeps, "failed", 1, T.review1, "1. blocking: fixture defect at brief:1 [severity: S1]. check: none: fixture");
  const fix = next(keeps, [OPUS, ...BUDGET]);
  buildFix(fix, "a failed build round names the fix");
  assert.equal(fix.kv.get("required-fixes"), FIXES, ran("the build order names the required fixes", fix));
  advanceSource(keeps);
  const again = next(keeps, [OPUS, ...BUDGET]);
  reviewNamed(again, 2, "the next review round");
  assert.equal(again.kv.get("required-fixes"), FIXES, ran("the review order names the required fixes", again));
});

// ---------------------------------------------------------------------------
// W-338 (D-088 E): a kind: ui opus takes the Codex spec review. The ui-lead's spec verdict is the UI input and every other
// seat's is a plain spec verdict; the input is the newest ui-lead spec log; next orders the ui-lead once the spec passes,
// before the branch and after it. Rows are selectable with --test-name-pattern='^W-338-b<n>\s'.
// ---------------------------------------------------------------------------
const UI_SEAT = "  - { id: ui-lead, collegium: design, kind: agent, model: gpt-6-astra, harness: codex }";
const UI_PROMPT = "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n";
const UI_BODY = ["## Findings", "No findings", "The navigation relationships remain legible across the complete narrow viewport arrangement.", "## Recommendation", "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.", "Additional original observations cover focus movement responsive density and stable content grouping throughout.", "Verdict: passed", ""].join("\n");
/** A spec-reviewer world with a ui-lead seat whose record is kind: ui (and, with `pointer`, carries `spec:`), committed on the trunk. */
function uiWorld(tag: string, o: { pointer?: boolean; kind?: "ui" | "opus" } = {}): World {
  const w = srWorld(tag, { edit: (t) => t.replace(ARCHITECT_ROW, `${ARCHITECT_ROW}\n${UI_SEAT}`) });
  editRecord(w, "repo", (doc) => {
    doc.setIn(["kind"], o.kind ?? "ui");
    if (o.pointer === true) doc.setIn(["spec"], BRIEF_REL.slice("studio/".length));
  });
  commit(w.repo, "studio: W-900's kind and pointer");
  return w;
}
/** A spec-phase verdict through the real writer, its exit and output returned (never thrown), in `studio` (the main checkout's by default). */
function specRun(w: World, round: number, sella: string, outcome: string, body: string, extra: string[] = [], studio = w.studio): { status: number | null; out: string } {
  const from = join(w.root, `w338-${round}-${sella}.md`);
  writeFileSync(from, body);
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "verdict", OPUS, "--round", String(round), "--sella", sella, "--outcome", outcome, "--phase", "spec", "--from", from, "--studio", studio, "--now", T.spec, ...extra], { cwd: w.repo, env: SETUP_ENV, encoding: "utf8" });
  return { status: r.status, out: `${r.stderr}${r.stdout}` };
}
/** The ui-lead's input at `round`, its prompt kept where the order names it. */
function uiInput(w: World, round: number, studio = w.studio): { status: number | null; out: string } {
  put(studio, `ci/${OPUS}-ui-prompt-${round}.md`, UI_PROMPT);
  return specRun(w, round, "ui-lead", "passed", UI_BODY, ["--dispatch-prompt", `ci/${OPUS}-ui-prompt-${round}.md`], studio);
}
// the third argument is revision 2's opus id (revision 1's reader takes two and ignores it)
const inspect = (w: World, studio = w.studio) => (inspectUiDesignInput as (root: string, record: NativeRecord, id: string) => ReturnType<typeof inspectUiDesignInput>)(studio, readFront<NativeRecord>(join(studio, "opera", `${OPUS}.md`)).data, OPUS);
const logAt = (dir: string, n: number): string => readFileSync(join(dir, "ci", `${OPUS}-spec-${n}.log`), "utf8");

test("W-338-b1 behaviour 1: on a kind: ui opus the ui-lead's spec verdict is the UI input and every other seat's is a plain spec verdict", { timeout: 1_800_000 }, () => {
  const w = uiWorld("w338-b1", { pointer: true });
  putBrief(w);
  const signed = specRun(w, 1, "architect", "passed", NO_FINDINGS);
  assert.equal(signed.status, 0, `the architect's signature on a kind: ui opus is recorded\n${signed.out}`);
  const signature = logAt(w.studio, 1);
  assert.match(signature, /^# brief: briefs\/W-900\.md blob:[0-9a-f]{40}$/m, "the signature pins the brief, as on any opus");
  assert.doesNotMatch(signature, /^# (?:design_digest|dispatch_prompt):/m, "the signature is no UI input");
  const reviewed = specRun(w, 2, SR, "passed", NO_FINDINGS, ["--model", SR_MODEL]);
  assert.equal(reviewed.status, 0, `the spec review on a kind: ui opus is recorded\n${reviewed.out}`);
  assert.match(logAt(w.studio, 2), new RegExp(`^# model: ${esc(SR_MODEL)}$`, "m"), "the review records its model");

  // a plain spec verdict is judged as on any opus: its Findings shape, and no --dispatch-prompt
  put(w.studio, "ci/prompt.md", UI_PROMPT);
  for (const [name, sella, body, extra, why] of [
    ["the architect with --dispatch-prompt", "architect", NO_FINDINGS, ["--dispatch-prompt", "ci/prompt.md"], /--dispatch-prompt is valid only for the ui-lead's spec input/],
    ["the reviewer with --dispatch-prompt", SR, NO_FINDINGS, ["--model", SR_MODEL, "--dispatch-prompt", "ci/prompt.md"], /--dispatch-prompt is valid only for the ui-lead's spec input/],
    ["the architect with no Findings section", "architect", "## Notes\nNo findings\n", [], /Findings/],
  ] as [string, string, string, string[], RegExp][]) {
    const r = specRun(w, 3, sella, "passed", body, extra);
    assert.equal(r.status, 2, `${name} exits 2\n${r.out}`);
    assert.match(r.out, why, `${name}: why`);
    assert.equal(existsSync(join(w.repo, specLog(3))), false, `${name}: no log is written`);
  }

  // the ui-lead's spec verdict is still the UI input: it needs the prompt and a substantive transcript, and records both
  const bare = specRun(w, 3, "ui-lead", "passed", UI_BODY);
  assert.equal(bare.status, 2, `the ui-lead with no prompt exits 2\n${bare.out}`);
  assert.match(bare.out, /requires --dispatch-prompt/, "the ui-lead needs its prompt");
  const thin = specRun(w, 3, "ui-lead", "passed", NO_FINDINGS, ["--dispatch-prompt", "ci/prompt.md"]);
  assert.equal(thin.status, 2, `a thin ui-lead transcript exits 2\n${thin.out}`);
  assert.match(thin.out, /opus\.ui\.design/, "the substantive check applies");
  const input = specRun(w, 3, "ui-lead", "passed", UI_BODY, ["--dispatch-prompt", "ci/prompt.md"]);
  assert.equal(input.status, 0, `the ui-lead's input is recorded\n${input.out}`);
  assert.match(logAt(w.studio, 3), /^# dispatch_prompt: ci\/prompt\.md$/m, "the input records its prompt");
  assert.match(logAt(w.studio, 3), /^# design_digest: sha256:[0-9a-f]{64}$/m, "the input records the design digest");
});

test("W-338-b2 behaviour 2: the UI input is the newest ui-lead spec log, whatever other seats' logs sit above it, and its brief is briefs/<id>.md before ready", { timeout: 1_800_000 }, () => {
  const w = uiWorld("w338-b2");
  putBrief(w);
  const first = uiInput(w, 1);
  assert.equal(first.status, 0, `the ui-lead's input is recorded on a record with no spec pointer\n${first.out}`);
  const read = (row: string) => {
    const r = inspect(w);
    return { ...r, row };
  };
  let r = read("the input alone");
  assert.equal(r.input?.relative, `ci/${OPUS}-spec-1.log`, `${r.row}: the input\n${r.problems.join("\n")}`);
  assert.deepEqual(r.problems, [], `${r.row}: the writer and the reader agree on the digest of briefs/W-900.md`);

  // the architect's signature and the review above it never mask it
  sign(w, 2);
  review(w, 3, "passed");
  r = read("a signature and a review above the input");
  assert.equal(r.input?.relative, `ci/${OPUS}-spec-1.log`, `${r.row}: still the input\n${r.problems.join("\n")}`);
  assert.deepEqual(r.problems, [], `${r.row}: no problem`);

  // the newest ui-lead log is judged, never skipped for an older one: stale after a brief edit, then replaced
  appendFileSync(briefPath(w), "\nEdited after the input.\n");
  r = read("an edited brief");
  assert.equal(r.input, undefined, `${r.row}: no current input`);
  assert.match(r.problems.join("\n"), /stale design_digest/, `${r.row}: the input is stale`);
  const second = uiInput(w, 4);
  assert.equal(second.status, 0, `a second input is recorded\n${second.out}`);
  r = read("a second input");
  assert.equal(r.input?.relative, `ci/${OPUS}-spec-4.log`, `${r.row}: the newest input\n${r.problems.join("\n")}`);
  writeFileSync(join(w.studio, "ci", `${OPUS}-spec-5.log`), logAt(w.studio, 4).replace("# round: 4", "# round: 9"));
  r = read("a malformed newest ui-lead log");
  assert.equal(r.input, undefined, `${r.row}: no input`);
  assert.match(r.problems.join("\n"), /does not match its opus, phase, round and sella/, `${r.row}: it is named`);
  // an unreadable spec log is a candidate, so it fails closed rather than being passed over
  rmSync(join(w.studio, "ci", `${OPUS}-spec-5.log`));
  mkdirSync(join(w.studio, "ci", `${OPUS}-spec-6.log`));
  r = read("an unreadable newest spec log");
  assert.equal(r.input, undefined, `${r.row}: no input`);
  assert.match(r.problems.join("\n"), /unsafe or unreadable/, `${r.row}: it is named`);
});

test("W-338-b3 behaviour 3: before the branch, a kind: ui opus takes the spec review, the ui-lead is ordered once it passes, and branch carries the input and its prompt", { timeout: 1_800_000 }, () => {
  const w = uiWorld("w338-b3");
  putBrief(w);
  const signed = specRun(w, 1, "architect", "passed", NO_FINDINGS);
  assert.equal(signed.status, 0, `the architect's signature is recorded\n${signed.out}`);
  reviewerOrder(specNext(w), 2, "a signed kind: ui spec goes to the reviewer");

  // a ui-lead log above the signature is not the review: the reviewer is still ordered
  const early = uiWorld("w338-b3-early");
  putBrief(early);
  sign(early, 1);
  const before = uiInput(early, 2);
  assert.equal(before.status, 0, `an input above the signature is recorded\n${before.out}`);
  reviewerOrder(specNext(early), 3, "an input above the signature holds nothing");

  review(w, 2, "passed");
  const o = specNext(w);
  expectStep(o, "spec", "named", "a passed review with no UI input orders the ui-lead");
  assert.equal(o.kv.get("actor"), "ui-lead", ran("actor", o));
  assert.equal(o.kv.get("role"), "ui-lead", ran("role", o));
  assert.equal(o.kv.get("sella"), "ui-lead", ran("sella", o));
  assert.equal(o.kv.get("round"), "3", ran("round", o));
  assert.match(o.kv.get("why") ?? "", /no ui-lead spec input exists/, ran("why", o));
  assert.equal(o.kv.get("inputs"), "briefs/W-900.md", ran("the brief is the one input (no handover)", o));
  assert.match(o.kv.get("command") ?? "", /keep the dispatch prompt as ci\/W-900-ui-prompt-3\.md under studio; record with: bisellium verdict W-900 --round 3 --sella ui-lead --outcome <passed\|failed\|revise> --phase spec --dispatch-prompt ci\/W-900-ui-prompt-3\.md --from <file> --studio studio$/, ran("the exact command", o));

  const input = uiInput(w, 3);
  assert.equal(input.status, 0, `the ordered input is recorded\n${input.out}`);
  const named = specNext(w);
  expectStep(named, "branch", "named", "the input above the passed review names branch");
  const master = git(w.repo, ["rev-parse", "master"]);
  expectStep(next(w, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", "branch commits the spec");
  assert.equal(git(w.repo, ["rev-parse", `${BRANCH}^`]), master, "opus/<id> is master plus one commit");
  assert.deepEqual(
    git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", BRANCH]).split("\n").sort(),
    [BRIEF_REL, specLog(1), specLog(2), specLog(3), `studio/ci/${OPUS}-ui-prompt-3.md`].sort(),
    "the brief, the three logs and the ui-lead's prompt",
  );
  const ready = next(w, [OPUS]);
  expectStep(ready, "ready", "named", "ready follows branch");
  assert.match(ready.out, /^attributed: architect \(signed ci\/W-900-spec-1\.log\)$/m, ran("attributed to the signer, never the ui-lead", ready));
});

test("W-338-b4 behaviour 4: after the branch, a ui-lead input recorded in the worktree passes its spec check and is committed with its prompt", { timeout: 1_800_000 }, () => {
  const w = uiWorld("w338-b4", { kind: "opus" });
  putBrief(w);
  sign(w, 1);
  review(w, 2, "passed");
  expectStep(next(w, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", "branch commits the spec");
  // D-088 E: UI work is amended to kind: ui when it starts, on the branch that owns the record
  editRecord(w, "wt", (doc) => doc.setIn(["kind"], "ui"));
  commit(w.wt, "studio: W-900 is a ui opus");

  const wtRel = ".worktrees/W-900/studio";
  const o = specNext(w);
  expectStep(o, "spec", "named", "a branch record amended to kind: ui orders the ui-lead");
  assert.equal(o.kv.get("role"), "ui-lead", ran("role", o));
  assert.equal(o.kv.get("round"), "3", ran("round", o));
  assert.match(o.kv.get("command") ?? "", new RegExp(`--dispatch-prompt ci/W-900-ui-prompt-3\\.md --from <file> --studio ${esc(wtRel)}$`), ran("the order names the worktree", o));

  const input = uiInput(w, 3, w.wtStudio);
  assert.equal(input.status, 0, `the input is recorded in the worktree\n${input.out}`);
  const pending = specNext(w);
  expectStep(pending, "spec", "named", "the uncommitted input is committed with the spec");
  assert.match(pending.kv.get("why") ?? "", /is not committed \(2 path\(s\)\)/, ran("the log and its prompt", pending));
  const tip = git(w.repo, ["rev-parse", BRANCH]);
  expectStep(next(w, [OPUS, "--perform", "--expect", "spec"]), "spec", "performed", "the spec commit");
  assert.equal(git(w.repo, ["rev-parse", `${BRANCH}^`]), tip, "one commit on the branch");
  assert.deepEqual(
    git(w.repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", BRANCH]).split("\n").sort(),
    [specLog(3), `studio/ci/${OPUS}-ui-prompt-3.md`].sort(),
    "the input and its prompt",
  );
  expectStep(next(w, [OPUS]), "ready", "named", "the worktree's input admits ready");

  // review round 1 #1: an input next refuses is ordered again after the branch, never committed as spec evidence
  for (const [name, spoil] of [
    ["a malformed log", (w: World) => writeFileSync(join(w.wtStudio, "ci", `${OPUS}-spec-3.log`), logAt(w.wtStudio, 3).replace("# round: 3", "# round: 9"))],
    ["a stale log", (w: World) => writeFileSync(join(w.wtStudio, "ci", `${OPUS}-spec-3.log`), logAt(w.wtStudio, 3).replace(/^# design_digest: sha256:[0-9a-f]{64}$/m, `# design_digest: sha256:${"0".repeat(64)}`))],
    ["a log with no prompt file", (w: World) => rmSync(join(w.wtStudio, "ci", `${OPUS}-ui-prompt-3.md`))],
  ] as [string, (w: World) => void][]) {
    const bad = uiWorld("w338-b4-bad", { kind: "opus" });
    putBrief(bad);
    sign(bad, 1);
    review(bad, 2, "passed");
    expectStep(next(bad, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", `${name}: branch commits the spec`);
    editRecord(bad, "wt", (doc) => doc.setIn(["kind"], "ui"));
    commit(bad.wt, "studio: W-900 is a ui opus");
    assert.equal(uiInput(bad, 3, bad.wtStudio).status, 0, `${name}: the input is recorded in the worktree`);
    spoil(bad);
    const tip = git(bad.repo, ["rev-parse", BRANCH]);
    const tree = git(bad.repo, ["ls-tree", "-r", BRANCH]);
    const refused = specNext(bad);
    expectStep(refused, "spec", "named", `${name}: next orders the ui-lead again`);
    assert.equal(refused.kv.get("role"), "ui-lead", ran(`${name}: role`, refused));
    assert.doesNotMatch(refused.kv.get("why") ?? "", /is not committed/, ran(`${name}: the why is not the commit's`, refused));
    assert.doesNotMatch(refused.kv.get("command") ?? "", /--perform --expect spec/, ran(`${name}: the command is not the commit's`, refused));
    const performed = next(bad, [OPUS, "--perform", "--expect", "spec"]);
    assert.doesNotMatch(performed.out, /performed/, ran(`${name}: --perform --expect spec commits nothing`, performed));
    assert.equal(git(bad.repo, ["rev-parse", BRANCH]), tip, `${name}: the branch's tip is unchanged`);
    assert.equal(git(bad.repo, ["ls-tree", "-r", BRANCH]), tree, `${name}: the branch's committed tree is unchanged`);
  }
});
test("W-338-b5 behaviour 5: the UI design digest is the caller's opus: a record whose id is not its opus id and file name gives no digest, so no input is written or read for another brief", { timeout: 1_800_000 }, () => {
  const w = uiWorld("w338-b5");
  putBrief(w);
  // a copied record: opera/W-900.md says id W-901, and briefs/W-901.md exists with other bytes
  put(w.studio, "briefs/W-901.md", "# another opus's brief\n");
  editRecord(w, "repo", (doc) => doc.setIn(["id"], "W-901"));
  for (const [name, pointer] of [["no spec pointer", false], ["a spec pointer", true]] as const) {
    if (pointer) editRecord(w, "repo", (doc) => doc.setIn(["spec"], "briefs/W-900.md"));
    const copied = uiInput(w, 1);
    assert.equal(copied.status, 2, `a copied id W-901 with ${name}: the ui-lead's input exits 2\n${copied.out}`);
    assert.match(copied.out, /record's id to be W-900/, `a copied id W-901 with ${name}: the refusal names the id`);
    assert.equal(existsSync(join(w.repo, specLog(1))), false, `a copied id W-901 with ${name}: no input is written`);
  }
  // the reader: an input written for W-900 is not read through a record whose id is not W-900
  editRecord(w, "repo", (doc) => doc.setIn(["id"], OPUS));
  const input = uiInput(w, 1);
  assert.equal(input.status, 0, `the matching id: the input is recorded\n${input.out}`);
  assert.equal(inspect(w).input?.relative, `ci/${OPUS}-spec-1.log`, "the matching id: the input is read");
  editRecord(w, "repo", (doc) => doc.setIn(["id"], "W-901"));
  const r = inspect(w);
  assert.equal(r.input, undefined, "a copied id W-901: no input is read");
  assert.match(r.problems.join("\n"), /record's id to be W-900/, "a copied id W-901: the reader names the id");
  // the officina check reads the record for its file name, W-900, too
  const checked = spawnSync(process.execPath, ["--import", TSX, MAIN, "check", w.studio, "--json"], { cwd: w.repo, env: SETUP_ENV, encoding: "utf8" });
  const findings = (JSON.parse(checked.stdout) as { findings: { rule: string; message: string }[] }).findings;
  assert.ok(findings.some((f) => f.rule === "opus.ui.design" && /record's id to be W-900/.test(f.message)), `a copied id W-901: check names the id under opus.ui.design\n${checked.stdout.slice(0, 2000)}`);
});

test("W-338-b6 behaviour 6: on an opus that is not kind: ui a ui-lead spec log stays in the strict signature-and-review sequence, before the branch and after", { timeout: 1_800_000 }, () => {
  const w = uiWorld("w338-b6", { kind: "opus" });
  putBrief(w);
  sign(w, 1);
  const plain = specRun(w, 2, "ui-lead", "passed", NO_FINDINGS);
  assert.equal(plain.status, 0, `a plain ui-lead verdict on a kind: opus record is recorded\n${plain.out}`);
  specHeld(specNext(w), "a ui-lead log above the signature of a kind: opus holds", /spec-2\.log/);

  const b = uiWorld("w338-b6-wt", { kind: "opus" });
  putBrief(b);
  sign(b, 1);
  review(b, 2, "passed");
  expectStep(next(b, [OPUS, "--perform", "--expect", "branch"]), "branch", "performed", "branch commits the spec");
  const after = specRun(b, 3, "ui-lead", "passed", NO_FINDINGS, [], b.wtStudio);
  assert.equal(after.status, 0, `a plain ui-lead verdict in the worktree is recorded\n${after.out}`);
  specHeld(specNext(b), "a new ui-lead log in the worktree of a kind: opus holds", /W-900-spec-3\.log is not a valid signature or spec review/);
});

// ---------------------------------------------------------------------------
// W-348 (D-091 D): a kind: ui opus has its own spec signer and reviewer pair.
// Rows are selectable with --test-name-pattern='^W-348-b<n>\s'.
// ---------------------------------------------------------------------------
const UI_ARCHITECT = "ui-architect";
const UI_ARCHITECT_MODEL = "gpt-5.6-sol";
const UI_REVIEWER = "ui-spec-reviewer";
const UI_REVIEWER_MODEL = "claude-opus-5-5";
const UI_ARCHITECT_ROW = { id: UI_ARCHITECT, collegium: "design", kind: "agent", model: UI_ARCHITECT_MODEL, harness: "codex" } as const;
const UI_REVIEWER_ROW = { id: UI_REVIEWER, collegium: "qa", kind: "agent", model: UI_REVIEWER_MODEL, harness: "claude-code" } as const;

function pairingManifest(edit: (m: Manifest & Record<string, unknown>) => void = () => {}): Manifest {
  const m = {
    bisellium: 1,
    studio: "pairing",
    collegia: [
      { id: "design", name: "Design", magister: "architect" },
      { id: "qa", name: "QA", magister: "qa-lead" },
    ],
    sellae: [
      { id: "architect", collegium: "design", kind: "agent", model: "claude-opus-5-5" },
      { id: SR, collegium: "qa", kind: "agent", model: SR_MODEL, harness: "codex" },
      { ...UI_ARCHITECT_ROW },
      { ...UI_REVIEWER_ROW },
    ],
    probationes: [],
    spec_reviewer: SR,
    ui_spec_signer: UI_ARCHITECT,
    ui_spec_reviewer: UI_REVIEWER,
  } as unknown as Manifest & Record<string, unknown>;
  edit(m);
  return m;
}

test("W-348-b1 behaviour 1: the UI spec pair is an atomic exact-model override, while every other kind keeps the design magister and configured reviewer", () => {
  const valid = readSpecReviewer(pairingManifest(), { state: "greenlit", kind: "ui" });
  assert.deepEqual(valid, {
    signer: UI_ARCHITECT,
    reviewer: { sella: UI_REVIEWER, model: UI_REVIEWER_MODEL, design: UI_ARCHITECT },
  }, "kind ui selects the configured UI signer and reviewer");

  const engineering = readSpecReviewer(pairingManifest(), { state: "greenlit", kind: "feature" });
  assert.deepEqual(engineering, {
    signer: "architect",
    reviewer: { sella: SR, model: SR_MODEL, design: "architect" },
  }, "every other kind keeps the design magister and spec_reviewer");

  const compatible = pairingManifest((m) => {
    delete m["ui_spec_signer"];
    delete m["ui_spec_reviewer"];
  });
  assert.deepEqual(readSpecReviewer(compatible, { state: "greenlit", kind: "ui" }), engineering, "both UI keys absent preserve the existing pair");

  const bad = (name: string, edit: (m: Manifest & Record<string, unknown>) => void, why: RegExp): void => {
    const got = readSpecReviewer(pairingManifest(edit), { state: "greenlit", kind: "ui" });
    assert.ok("error" in got, `${name}: the pairing is refused`);
    assert.match(got.error, why, `${name}: the refusal names the cause`);
  };
  bad("only the signer", (m) => delete m["ui_spec_reviewer"], /ui_spec_signer.*ui_spec_reviewer|ui_spec_reviewer.*ui_spec_signer/);
  bad("only the reviewer", (m) => delete m["ui_spec_signer"], /ui_spec_signer.*ui_spec_reviewer|ui_spec_reviewer.*ui_spec_signer/);
  bad("a non-string signer", (m) => (m["ui_spec_signer"] = 7), /ui_spec_signer/);
  bad("an unknown signer", (m) => (m["ui_spec_signer"] = "ghost"), /ghost.*not a declared seat/);
  bad("a duplicate signer", (m) => m.sellae.push({ ...UI_ARCHITECT_ROW }), /ui-architect is declared 2 times/);
  bad("a retired signer", (m) => (m.sellae.find((s) => s.id === UI_ARCHITECT)!.retired = true), /ui-architect is retired/);
  bad("a non-agent signer", (m) => (m.sellae.find((s) => s.id === UI_ARCHITECT)!.kind = "human"), /ui-architect must be kind: agent/);
  bad("a signer on another harness", (m) => (m.sellae.find((s) => s.id === UI_ARCHITECT)!.harness = "claude-code"), /ui-architect must be on the codex harness/);
  bad("a signer on another model", (m) => (m.sellae.find((s) => s.id === UI_ARCHITECT)!.model = "gpt-5.6-terra"), /ui-architect must declare model gpt-5\.6-sol/);
  bad("a reviewer on another harness", (m) => (m.sellae.find((s) => s.id === UI_REVIEWER)!.harness = "codex"), /ui-spec-reviewer must be on the claude-code harness/);
  bad("a reviewer on another model", (m) => (m.sellae.find((s) => s.id === UI_REVIEWER)!.model = SR_MODEL), /ui-spec-reviewer must declare model claude-opus-5-5/);
  bad("one seat for both roles", (m) => {
    m["ui_spec_reviewer"] = UI_ARCHITECT;
    const row = m.sellae.find((s) => s.id === UI_ARCHITECT)!;
    row.model = UI_REVIEWER_MODEL;
    row.harness = "claude-code";
  }, /signer and reviewer must be different seats/);
});

function uiPairWorld(tag: string): World {
  const w = srWorld(tag, {
    edit: (t) => `${t.replace(ARCHITECT_ROW, `${ARCHITECT_ROW}\n${UI_SEAT}\n  - { id: ${UI_ARCHITECT}, collegium: design, kind: agent, model: ${UI_ARCHITECT_MODEL}, harness: codex }`).replace(QA_ROW, `${QA_ROW}\n  - { id: ${UI_REVIEWER}, collegium: qa, kind: agent, model: ${UI_REVIEWER_MODEL}, harness: claude-code }`)}ui_spec_signer: ${UI_ARCHITECT}\nui_spec_reviewer: ${UI_REVIEWER}\n`,
  });
  editRecord(w, "repo", (doc) => doc.setIn(["kind"], "ui"));
  commit(w.repo, "studio: W-900 uses the UI spec pair");
  return w;
}

test("W-348-b2 behaviour 2: next reads every UI signature as ui-architect and every UI spec review as ui-spec-reviewer, then attributes ready to the UI signer", { timeout: 1_800_000 }, () => {
  const brief = briefText(1);
  const pin = `briefs/${OPUS}.md blob:${createHash("sha1").update(`blob ${Buffer.byteLength(brief)}\0`).update(brief).digest("hex")}`;
  const log = (round: number, sella: string, outcome: "passed" | "failed", body = NO_FINDINGS, model?: string): string =>
    [`# opus: ${OPUS}`, "# phase: spec", `# round: ${round}`, `# sella: ${sella}`, ...(model === undefined ? [] : [`# model: ${model}`]), `# outcome: ${outcome}`, `# at: 2026-10-21T00:00:0${round}.000Z`, `# brief: ${pin}`, "", body.trimEnd(), ""].join("\n");
  const src = (files: Record<string, string>) => ({
    read: (rel: string) => files[rel],
    list: (dir: string) => Object.keys(files).filter((rel) => rel.startsWith(`${dir}/`)).map((rel) => rel.slice(dir.length + 1)),
  });
  const manifest = pairingManifest();
  const rec = { id: OPUS, title: "UI fixture", kind: "ui", state: "greenlit", probationes: {} };
  const facts = (files: Record<string, string>, ui: string[] = []): Facts => ({
    id: OPUS,
    repo: "/fixture",
    studioRel: "studio",
    studioAbs: "/fixture/studio",
    excludes: [],
    design: "architect",
    tip: undefined,
    wt: { dir: "/fixture/.worktrees/W-900", studio: "/fixture/.worktrees/W-900/studio", usable: false },
    trunk: src({}),
    trunkRecord: rec,
    certified: () => false,
    branch: undefined,
    branchRecord: undefined,
    work: src(files),
    choreDone: false,
    residue: false,
    pushed: false,
    manifest,
    curTree: () => undefined,
    buildRounds: () => ({ error: "unused" }),
    gates: () => undefined,
    redFindings: () => [],
    replay: () => undefined,
    uiSpecProblems: () => ui,
    uiReviewProblems: () => [],
    uiReviewInput: () => undefined,
    pr: () => ({ kind: "none" }),
    owed: () => ({ owed: [] }),
    evidenceAt: () => 0,
    wtCiProblem: () => undefined,
    wtChanges: () => ({ spec: [], other: [], bad: [] }),
    mainChanges: () => ({ spec: [], other: [], bad: [] }),
  });
  const unsigned = deriveNext(facts({ [`briefs/${OPUS}.md`]: brief }));
  assert.equal(unsigned.order?.sella, UI_ARCHITECT, "an unsigned UI brief orders ui-architect");

  const signedFiles = { [`briefs/${OPUS}.md`]: brief, [`ci/${OPUS}-spec-1.log`]: log(1, UI_ARCHITECT, "passed") };
  const reviewOrder = deriveNext(facts(signedFiles));
  assert.equal(reviewOrder.order?.sella, UI_REVIEWER, "the UI signature orders ui-spec-reviewer");
  assert.equal(reviewOrder.order?.extra.find(([k]) => k === "model")?.[1], UI_REVIEWER_MODEL, "the order names the Claude model");
  assert.match(reviewOrder.order?.command ?? "", new RegExp(`--sella ${UI_REVIEWER} --model ${UI_REVIEWER_MODEL}`), "the record command names the UI reviewer pair");

  const failedFiles = { ...signedFiles, [`ci/${OPUS}-spec-2.log`]: log(2, UI_REVIEWER, "failed", BLOCKER, UI_REVIEWER_MODEL) };
  assert.equal(deriveNext(facts(failedFiles)).order?.sella, UI_ARCHITECT, "a failed UI review returns to ui-architect");

  const passedFiles = { ...signedFiles, [`ci/${OPUS}-spec-2.log`]: log(2, UI_REVIEWER, "passed", NO_FINDINGS, UI_REVIEWER_MODEL) };
  const lead = deriveNext(facts(passedFiles, ["no ui-lead spec input exists"]));
  assert.equal(lead.order?.sella, "ui-lead", "the passed UI review then orders ui-lead");
  assert.equal(lead.order?.round, 3, "the UI input is the next round");
});
