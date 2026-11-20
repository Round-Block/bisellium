/**
 * W-699 rows (studio/briefs/W-699.md, D-245): the path check at sign (b1), the contract digests a re-signature is read by
 * (b2), `verdict --check` (b3), the 200k handoff at the prompt hook (b4), gate evidence after the newest red (b5) and
 * the D-246 measure in `retro --daily` (b6). node:test TAP, selected by `--test-name-pattern='^W-699-b<n>\s'`. The worlds
 * are next-world's (./next-world.test.ts) and, for b6, a temp officina, under the OS tmp dir.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { checkStudio } from "./check.js";
import { ladderWrite } from "./guard.js";
import { runHookEvent } from "./hooks.js";
import { BRIEF_REL, NO_FINDINGS, OPUS, T, briefText, direct, expectStep, put, ran, review, reviewerOrder, sign, specLog, specNext, srWorld, ticketed, world, type World } from "./next-world.test.js";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

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

test("W-699-b3 behaviour 3: verdict --check runs the write's validators, writes nothing and claims no ticket; the real write still runs", { timeout: 900_000 }, () => {
  const w = srWorld("w699-b3");
  ticketed(w);
  put(w.repo, BRIEF_REL, briefText(w.behaviours));
  const order = specNext(w);
  assert.equal(order.kv.get("role"), "architect", ran("next orders the signature and writes its ticket", order));
  const tickets = (): string[] => {
    const dir = join(w.repo, ".git", "bisellium", "tickets");
    return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")) : [];
  };
  const before = tickets();
  const checked = signDirect(w, 1, ["--check"]);
  assert.equal(checked.status, 0, ran("a valid signature passes the check", checked));
  assert.match(checked.out, /^W-900: verdict check passed: spec round 1 -> ci\/W-900-spec-1\.log; nothing written, no ticket claimed$/m, ran("the check names what it would write", checked));
  assert.equal(logExists(w, 1), false, "the check writes no log");
  assert.deepEqual(tickets(), before, "the check claims no ticket");
  const wrongRound = signDirect(w, 2, ["--check"]);
  assert.equal(wrongRound.status, 2, ran("a round the ticket does not name fails the check", wrongRound));
  assert.match(wrongRound.err, /round is 1, want 2/, ran("the check reads the ticket as the write does", wrongRound));
  const written = signDirect(w, 1);
  assert.equal(written.status, 0, ran("the real write runs on the same ticket", written));
  assert.equal(logExists(w, 1), true, "the real write writes the log");

  const bad = world("w699-b3-bad", "greenlight");
  put(bad.repo, BRIEF_REL, withOwned(["`missing.txt`"]));
  const checkedBad = signDirect(bad, 1, ["--check"]);
  const writtenBad = signDirect(bad, 1);
  assert.equal(checkedBad.status, 2, ran("a refused signature fails the check", checkedBad));
  assert.equal(checkedBad.err, writtenBad.err, "the check refuses with the write's own words");
  assert.equal(logExists(bad, 1), false, "neither writes a log");

  const ctx = { cwd: "/home/u/agents/bisellium", home: "/home/u" };
  const cmd = "npm run -s bisellium -- verdict W-900 --round 1 --sella architect --outcome passed --phase spec --from /tmp/s.md --studio studio";
  assert.equal(ladderWrite(`${cmd} --check`, ctx), undefined, "the guard lets the main thread run verdict --check");
  assert.equal(ladderWrite(cmd, ctx), "verdict --phase spec", "the write itself stays a ladder write");
  assert.equal(ladderWrite(cmd.replace("--outcome passed", "--outcome --check"), ctx), "verdict --phase spec", "a --check that is a flag's value is no check");
});

/** A home whose fresh status-line file reads `tokens` context tokens, `agoMs` old. */
function home(tokens: number, agoMs = 0): string {
  const h = mkdtempSync(join(tmpdir(), "w699-"));
  dirs.push(h);
  const usage = join(h, ".bisellium-evidence", "usage");
  mkdirSync(usage, { recursive: true });
  writeFileSync(join(usage, "claude-latest.json"), JSON.stringify({ at: new Date(Date.now() - agoMs).toISOString(), rl: { seven_day: { used_percentage: 19 } }, ctx: { current_usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }));
  return h;
}
/** What the guard hands the model at a main-thread prompt, HOME set to `h`. */
async function promptContext(h: string): Promise<string> {
  const out: string[] = [];
  const { log, error } = console;
  const saved = process.env["HOME"];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = () => undefined;
  process.env["HOME"] = h;
  try {
    const input = { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "next" };
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    assert.equal(r.exitCode, 0, "a prompt is never blocked");
  } finally {
    console.log = log;
    console.error = error;
    if (saved === undefined) delete process.env["HOME"];
    else process.env["HOME"] = saved;
  }
  const o = out.join("\n");
  return o === "" ? "" : ((JSON.parse(o) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? "");
}

test("W-699-b4 behaviour 4: at 200000 context tokens on a fresh status line the prompt hook names the handoff first, at every prompt", async () => {
  const at = await promptContext(home(200_000));
  assert.match(at, /^CONTEXT HANDOFF NOW \(D-245\): context 200000 tokens is past 200000: let running tasks finish, refresh the session handoff, and start no new work \(W-430\)\. Dispatch nothing new; `next` holds every dispatch order\. Usage now: /, "at 200k the handoff opens the context"); // one-sided: the text after the prefix is the reading, which the next assertion pins by its limit
  assert.match(at, /context 200k of 200k/, "the reading names the 200k limit");
  const below = await promptContext(home(199_999));
  assert.equal(below.startsWith("Usage now: "), true, `below 200k only the reading: ${below}`);
  assert.doesNotMatch(below, /HANDOFF/, "below 200k no handoff is named");
  const stale = await promptContext(home(250_000, 31 * 60_000));
  assert.doesNotMatch(stale, /HANDOFF/, "a status line 31 minutes old names no handoff");
});
