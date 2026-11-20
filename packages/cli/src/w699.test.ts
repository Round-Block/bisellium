/**
 * W-699 rows (studio/briefs/W-699.md, D-245): the path check at sign (b1), the contract digests a re-signature is read by
 * (b2), `verdict --check` (b3), the 200k handoff at the prompt hook (b4), gate evidence after the newest red (b5) and
 * the D-246 measure in `retro --daily` (b6). node:test TAP, selected by `--test-name-pattern='^W-699-b<n>\s'`. The worlds
 * are next-world's (./next-world.test.ts) and, for b6, a temp officina, under the OS tmp dir.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkStudio } from "./check.js";
import { BRIEF_REL, NO_FINDINGS, OPUS, T, briefText, direct, expectStep, put, ran, review, reviewerOrder, sign, specLog, specNext, srWorld, world, type World } from "./next-world.test.js";

/** A fixture brief whose Files owned bullets are `owned`, every other section as briefText's. */
const withOwned = (owned: string[]): string => briefText(1).replace(/## Files owned\n\n(?:- .*\n)+/, `## Files owned\n\n${owned.map((o) => `- ${o}`).join("\n")}\n`);
/** The architect's signature, round n, through the real writer, run directly: its result is data. */
const signDirect = (w: World, n: number, extra: string[] = []) => {
  const from = join(w.root, `w699-sign-${n}.md`);
  writeFileSync(from, NO_FINDINGS);
  return direct(w, w.repo, ["verdict", OPUS, "--round", String(n), "--sella", "architect", "--outcome", "passed", "--phase", "spec", "--from", from, "--studio", w.studio, "--now", T.spec, ...extra]);
};
const logExists = (w: World, n: number): boolean => existsSync(join(w.repo, specLog(n)));
const editBrief = (w: World, from: string, to: string): void => {
  const path = join(w.repo, BRIEF_REL);
  const text = readFileSync(path, "utf8");
  assert.ok(text.includes(from), `the fixture brief holds ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
};

test("W-699-b1 behaviour 1: a signature refuses a Files owned path that is not an existing file, an existing directory ending /, or marked (new)", { timeout: 600_000 }, () => {
  const refused: [string, string, RegExp][] = [
    ["a missing file", "`missing.txt`", /owns `missing\.txt`, which is not an existing file of the repository/],
    ["a missing directory", "`nowhere/`", /owns `nowhere\/`, which is not an existing directory of the repository/],
    ["a file named as a directory", "`source.txt/`", /owns `source\.txt\/`, which is not an existing directory/],
    ["a directory named as a file", "`docs`", /owns `docs`, which is not an existing file/],
    ["a path out of the repository", "`../outside.txt` (new)", /owns `\.\.\/outside\.txt`, which is not a repo-relative path/],
    ["an absolute path", "`/etc/hosts`", /owns `\/etc\/hosts`, which is not a repo-relative path/],
    ["a bullet with no path", "the rest of the tree", /is a Files owned bullet with no path/],
  ];
  for (const [name, bullet, why] of refused) {
    const w = world(`w699-b1-${name.replace(/\W+/g, "-")}`, "greenlight");
    put(w.repo, BRIEF_REL, withOwned(["`source.txt`", bullet]));
    const r = signDirect(w, 1);
    assert.equal(r.status, 2, ran(`${name}: the signature is refused`, r));
    assert.match(r.err, /W-900: brief admission: brief:\d+ /, ran(`${name}: the refusal is admission's`, r));
    assert.match(r.err, why, ran(`${name}: the refusal names the path`, r));
    assert.equal(logExists(w, 1), false, `${name}: no signature log is written`);
  }
  const w = world("w699-b1-admitted", "greenlight");
  put(w.repo, BRIEF_REL, withOwned(["`source.txt`: an existing file", "`./docs/`: an existing directory", "`packages/new.ts` (new): a new file", "`w699 two words.test.ts` (new, a test file)"]));
  const ok = signDirect(w, 1);
  assert.equal(ok.status, 0, ran("an existing file, an existing directory and two (new) paths are admitted", ok));
  assert.equal(logExists(w, 1), true, "the signature log is written");
});

/** The delta rule's switch line in bisellium.yml (`spec: { delta_review: <v> }`), or none. */
const switchTo = (v: string | null) => ({ edit: (t: string): string => (v === null ? t : `${t}spec: { delta_review: ${v} }\n`) });

test("W-699-b2 behaviour 2: a re-signature whose contract digests equal the reviewed signature's stands with that review; an edited Behaviour line still orders the review", { timeout: 1_800_000 }, () => {
  const signedReviewed = (tag: string, v: string | null = "on"): World => {
    const w = srWorld(tag, switchTo(v));
    put(w.repo, BRIEF_REL, briefText(w.behaviours));
    sign(w, 1);
    review(w, 2, "passed");
    return w;
  };
  const acceptance = signedReviewed("w699-b2-acceptance");
  editBrief(acceptance, "## Acceptance\n\nFixture.", "## Acceptance\n\nFixture, reworded.");
  sign(acceptance, 3);
  assert.match(readFileSync(join(acceptance.repo, specLog(3)), "utf8"), /^# contract: intent:[0-9a-f]{16} behaviours:[0-9a-f]{16} domain:[0-9a-f]{16} interfaces:[0-9a-f]{16} limits:[0-9a-f]{16} files:[0-9a-f]{16} other:[0-9a-f]{16}$/m, "the signature pins the contract digests");
  const stands = specNext(acceptance);
  expectStep(stands, "branch", "named", "an Acceptance-only edit, re-signed, stands with the passed review");
  assert.equal(stands.kv.has("role"), false, ran("no reviewer is ordered", stands));

  const respelled = signedReviewed("w699-b2-respelled");
  editBrief(respelled, "- `source.txt`\n", "- `./source.txt`: respelled\n");
  sign(respelled, 3);
  expectStep(specNext(respelled), "branch", "named", "Files owned respelled to the same set stands with the passed review");

  const behaviour = signedReviewed("w699-b2-behaviour");
  editBrief(behaviour, "1. **Fixture behaviour 1.**", "1. **Fixture behaviour 1, edited.**");
  sign(behaviour, 3);
  reviewerOrder(specNext(behaviour), 4, "an edited Behaviour line orders the review");

  const owned = signedReviewed("w699-b2-owned");
  editBrief(owned, "- `source.txt`\n", "- `source.txt`\n- `README.md`\n");
  sign(owned, 3);
  reviewerOrder(specNext(owned), 4, "a path added to Files owned orders the review");

  const unheaded = signedReviewed("w699-b2-unheaded");
  editBrief(unheaded, "## Acceptance\n\nFixture.", "## Acceptance\n\nFixture, reworded.");
  sign(unheaded, 3);
  const log1 = join(unheaded.repo, specLog(1));
  writeFileSync(log1, readFileSync(log1, "utf8").replace(/^# contract: .*\n/m, ""));
  reviewerOrder(specNext(unheaded), 4, "a reviewed signature with no contract digests is unclassifiable: review");

  const claimed = signedReviewed("w699-b2-claimed");
  editBrief(claimed, "1. **Fixture behaviour 1.**", "1. **Fixture behaviour 1, edited.**");
  sign(claimed, 3);
  const log3 = join(claimed.repo, specLog(3));
  const contract1 = /^# contract: .*$/m.exec(readFileSync(join(claimed.repo, specLog(1)), "utf8"))![0];
  writeFileSync(log3, readFileSync(log3, "utf8").replace(/^# contract: .*$/m, contract1));
  reviewerOrder(specNext(claimed), 4, "a contract value the current brief does not make is no delta: review");

  // r4b (class census): a log between the review and the re-signature that is neither a valid signature nor a valid review
  // (here a failed review whose outcome is out of grammar) is never skipped for the older passed review: no delta
  const between = signedReviewed("w699-b2-between");
  review(between, 3, "failed");
  const log3b = join(between.repo, specLog(3));
  writeFileSync(log3b, readFileSync(log3b, "utf8").replace(/^# outcome: failed$/m, "# outcome: maybe"));
  editBrief(between, "## Acceptance\n\nFixture.", "## Acceptance\n\nFixture, reworded.");
  sign(between, 4);
  reviewerOrder(specNext(between), 5, "a malformed review below the re-signature is unclassifiable: review");

  // D-061 §4: after the signature that stood by the split, a delta re-signature resets no count
  const split = srWorld("w699-b2-split", switchTo("on"));
  put(split.repo, BRIEF_REL, briefText(split.behaviours));
  sign(split, 1);
  review(split, 2, "failed");
  editBrief(split, "## Intent\n\nFixture.", "## Intent\n\nFixture, revised.");
  sign(split, 3);
  review(split, 4, "failed");
  sign(split, 5);
  editBrief(split, "## Out of scope\n\nFixture.", "## Out of scope\n\nFixture, reworded.");
  sign(split, 6);
  const after6 = specNext(split);
  expectStep(after6, "branch", "named", "a delta re-signature after the standing one keeps the count: it stands, no third review");
  assert.equal(after6.kv.has("role"), false, ran("no reviewer is ordered", after6));

  // the switch (D-246 item 2): off, missing or malformed, an Acceptance-only re-signature orders the review as on master
  for (const [v, name] of [["off", "off"], [null, "missing"], ["yes", "malformed"]] as const) {
    const w = signedReviewed(`w699-b2-switch-${name}`, v);
    editBrief(w, "## Acceptance\n\nFixture.", "## Acceptance\n\nFixture, reworded.");
    sign(w, 3);
    reviewerOrder(specNext(w), 4, `spec.delta_review ${name}: an Acceptance-only re-signature orders the review`);
  }
  // the check rule: a missing or malformed switch blocks; on, an open escape lesson blocks, an addressed one does not
  const ruled = (w: World) => checkStudio(w.studio, new Date(T.spec)).findings.filter((f) => f.rule === "spec.delta_review");
  const missing = ruled(srWorld("w699-b2-check-missing", switchTo(null)));
  assert.deepEqual(missing.map((f) => [f.level, f.where, f.message]), [["block", "bisellium.yml#spec.delta_review", "spec.delta_review is missing (on or off): the delta rule's switch (D-246 item 2); next reads it as off"]], "a missing switch blocks");
  const malformed = ruled(srWorld("w699-b2-check-malformed", switchTo("true")));
  assert.deepEqual(malformed.map((f) => [f.level, f.message]), [["block", "spec.delta_review must be exactly on or off, not true: the delta rule's switch (D-246 item 2); next reads it as off"]], "a malformed switch blocks");
  const on = srWorld("w699-b2-check-escape", switchTo("on"));
  assert.deepEqual(ruled(on), [], "on with no escape: no finding");
  const unlisted = srWorld("w699-b2-check-unlisted", switchTo("on"));
  rmSync(join(unlisted.studio, "lessons"), { recursive: true, force: true });
  writeFileSync(join(unlisted.studio, "lessons"), "not a directory\n");
  assert.deepEqual(ruled(unlisted).map((f) => [f.level, f.where]), [["block", "lessons/"]], "an unlistable lessons/ blocks while the switch is on");
  const lesson = (n: string, addressed: string): void => put(on.studio, `lessons/${n}.md`, `---\nid: "${n}"\nat: ${T.spec}\nclass: "escape×delta-rule"\nevidence: ["ci/${OPUS}-spec-3.log"]\nopus: "${OPUS}"\nseverity: high\n${addressed}---\nA skipped review hid a spec error.\n`);
  lesson("L-901", "");
  lesson("L-902", 'addressed_by: "D-901"\n');
  assert.deepEqual(ruled(on).map((f) => [f.level, f.where]), [["block", "lessons/L-901.md"]], "an open escape blocks while the switch is on");
  assert.equal(ruled(on)[0]?.message, "an escape of the delta rule is recorded while spec.delta_review is on: D-246 item 2 switches it off at once (spec: { delta_review: off }), then a leads' meet; its decision closes the lesson (addressed_by)", "the finding names the switch-off");
  const off = srWorld("w699-b2-check-off", switchTo("off"));
  put(off.studio, "lessons/L-901.md", readFileSync(join(on.studio, "lessons/L-901.md"), "utf8"));
  assert.deepEqual(ruled(off), [], "switched off, the escape no longer blocks");
});
