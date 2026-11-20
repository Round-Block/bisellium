/**
 * W-699 rows (studio/briefs/W-699.md, D-245): the path check at sign (b1), the contract digests a re-signature is read by
 * (b2), `verdict --check` (b3), the 200k handoff at the prompt hook (b4), gate evidence after the newest red (b5) and
 * the D-246 measure in `retro --daily` (b6). node:test TAP, selected by `--test-name-pattern='^W-699-b<n>\s'`. The worlds
 * are next-world's (./next-world.test.ts) and, for b6, a temp officina, under the OS tmp dir.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { checkStudio } from "./check.js";
import { ladderWrite } from "./guard.js";
import { runHookEvent } from "./hooks.js";
import { currentLightCommands, runLightGates } from "@bisellium/commands/light-gates.js";
import { BRIEF_REL, BUDGET, NO_FINDINGS, OPUS, T, briefText, commit, direct, editRecord, expectStep, git, next, put, ran, review, reviewerOrder, sign, sourceTree, specLog, specNext, srWorld, ticketed, verb, world, writeGates, type World } from "./next-world.test.js";

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

  // fix round 1 (class: signer identity normalized at one place): a signer invoked through `sella_aliases` is the signer
  // everywhere: its signature pins the contract header, and its Acceptance-only re-signature stands with the review
  const aliased = srWorld("w699-b2-alias", {
    edit: (t) =>
      t
        .replace("magister: architect }", "magister: design-architect }")
        .replace("{ id: architect, collegium: design", "{ id: design-architect, collegium: design")
        .concat("sella_aliases:\n  since: 2026-11-01T00:00:00Z\n  live_until: 2027-02-18T00:00:00Z\n  ids: { architect: design-architect }\n"),
  });
  put(aliased.repo, BRIEF_REL, briefText(aliased.behaviours));
  sign(aliased, 1);
  assert.match(readFileSync(join(aliased.repo, specLog(1)), "utf8"), /^# contract: intent:[0-9a-f]{16} /m, "a signature by the alias writes the contract header, as the canonical sella's does");
  review(aliased, 2, "passed");
  editBrief(aliased, "## Acceptance\n\nFixture.", "## Acceptance\n\nFixture, reworded.");
  sign(aliased, 3);
  const aliasStands = specNext(aliased);
  expectStep(aliasStands, "branch", "named", "an alias signer's Acceptance-only re-signature stands with the passed review");
  assert.equal(aliasStands.kv.has("role"), false, ran("no reviewer is ordered for the alias signer", aliasStands));

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

// ---------------------------------------------------------------------------
// behaviour 5 (next-gate-meet-1119, W-503's case; W-531's case): gate evidence admits review only when committed after the
// newest red, by git ancestry; before a passed review a failed full-gate log committed after the light log refuses it
// ---------------------------------------------------------------------------
const OWN_TESTS = ["w326.test.mjs", "w462.test.mjs"];
/** An automated world past its reds whose main manifest keeps a light-gate list and whose builder has handed over (W-610's). */
function handedLight(tag: string): World {
  const w = world(tag, "reds", { automated: true });
  const manifest = join(w.studio, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("source_excludes:", 'light_gates:\n  - "node -e 0"\nsource_excludes:'));
  commit(w.repo, "studio: the light-gate list");
  for (const f of OWN_TESTS) writeFileSync(join(w.wt, f), 'import { test } from "node:test";\ntest("own", () => {});\n');
  commit(w.wt, `test(${OPUS}): its own test files`);
  verb(w.wt, ["handoff", "--opus", OPUS, "--sella", `builder.${OPUS}`, "--next", "ready for review", "--studio", w.wtStudio, "--now", T.handoffFresh]);
  commit(w.wt, `studio(${OPUS}): builder handoff`);
  return w;
}
const performLight = (w: World): ReturnType<typeof next> => next(w, [OPUS, "--perform", "--expect", "build", ...BUDGET]);
/** Records red 01 again (its `# at:` moved on), a commit that touches only studio/: the source tree is unchanged. */
function reRed(w: World, at: string): void {
  const rel = `studio/ci/reds/${OPUS}/01.log`;
  const text = readFileSync(join(w.wt, rel), "utf8");
  assert.ok(text.includes(`# at: ${T.reds}`), "the fixture red 01 carries the reds' time");
  writeFileSync(join(w.wt, rel), text.replace(`# at: ${T.reds}`, `# at: ${at}`));
  commit(w.wt, `studio(${OPUS}): red 01 again`);
}
const RE_RED = "2026-10-02T09:30:00.000Z";

const FAILED_LOG = (t: string): string => `certifies: ${t}\ncommand: node -e 1\nexit code: 1\n\nnot ok 1\n`;
/** The full ci fails at the tip's tree: its log and the record's failed status, committed together. */
function failFull(w: World): void {
  writeGates(w, { log: FAILED_LOG, commit: false });
  editRecord(w, "wt", (doc) => doc.setIn(["probationes", "tests", "status"], "failed"));
  commit(w.wt, `studio(${OPUS}): full ci failed`);
}
/** One more light run at the tip's tree, by the light-gate runner itself (next orders none), committed alone. */
function lightAgain(w: World): void {
  const cmds = currentLightCommands(w.wtStudio, OPUS);
  assert.ok(Array.isArray(cmds), `the light-gate commands read: ${JSON.stringify(cmds)}`);
  const run = runLightGates(w.wtStudio, OPUS, cmds);
  assert.ok(!("error" in run) && run.exitCode === 0, `the light run passes: ${JSON.stringify(run)}`);
  commit(w.wt, `chore(studio): ${OPUS} light gates`);
}
const failedLogOf = (w: World): RegExp => new RegExp(`ci/${OPUS}-tests-${sourceTree(w.wt).slice(5, 13)}\\.log`);
/** The builder, dispatched with the failed full-gate log at the tip's tree. */
function builderWithFailed(o: ReturnType<typeof next>, w: World, what: string): void {
  expectStep(o, "build", "named", what);
  assert.equal(o.kv.get("sella"), `builder.${OPUS}`, ran(`${what}: the builder is dispatched`, o));
  assert.match(o.kv.get("inputs") ?? "", failedLogOf(w), ran(`${what}: the builder is handed the failed log`, o));
}
/** After a red newer than the builder's handover: the builder's order, held on that handover, the failed log underneath. */
function builderHeld(o: ReturnType<typeof next>, w: World, what: string): void {
  expectStep(o, "build", "held", what);
  assert.equal(o.kv.get("actor"), "builder", ran(`${what}: the builder's`, o));
  assert.match(o.kv.get("why") ?? "", /^stale handover: run bisellium handoff first/, ran(`${what}: the handover predates the red`, o)); // one-sided: the rest names the handover's and the red's times, reused text the underlying line follows
  assert.match(o.kv.get("underlying") ?? "", new RegExp(`${failedLogOf(w).source} failed at this source tree; a light pass at the same tree does not cure it`), ran(`${what}: the failed log underneath`, o));
}
/** The producer's full-gate order with a stale line naming a red at this source tree. */
function fullOrder(o: ReturnType<typeof next>, what: string): void {
  expectStep(o, "build", "named", what);
  assert.equal(o.kv.get("actor"), "producer", ran(`${what}: the producer's`, o));
  assert.equal(o.kv.has("light-gates"), false, ran(`${what}: no light run is ordered`, o));
  assert.match(o.kv.get("command") ?? "", /ci --opus W-900/, ran(`${what}: the order names the full ci`, o));
  assert.match(o.kv.get("stale") ?? "", /was committed at this source tree, so no light run admits review/, ran(`${what}: the stale line says why`, o));
}

/** The producer's full-gate order, refused on the committed tree's gate logs (spec review r2 #1), its stale line saying why. */
function refusedFull(o: ReturnType<typeof next>, what: string, why: RegExp): void {
  expectStep(o, "build", "named", what);
  assert.equal(o.kv.get("actor"), "producer", ran(`${what}: the producer's`, o));
  assert.match(o.kv.get("command") ?? "", /ci --opus W-900/, ran(`${what}: the order names the full ci`, o));
  assert.match(o.kv.get("stale") ?? "", why, ran(`${what}: the stale line says why`, o));
}
const PASSED_LOG = (t: string): string => `certifies: ${t}\ncommand: node -e 0\nexit code: 0\n\nok 1\n`;

test("W-699-b5 behaviour 5: gate evidence admits review only when committed after the newest red; a red at the review tree or a failed full-gate log there needs a full pass or a source change", { timeout: 1_800_000 }, () => {
  // W-503 historical: light pass, full ci failed, then a studio-only red at the same tree
  const w503 = handedLight("w699-b5-w503");
  assert.equal(performLight(w503).status, 0, "the light gates pass at the tree");
  failFull(w503);
  const tree = sourceTree(w503.wt);
  reRed(w503, RE_RED);
  assert.equal(sourceTree(w503.wt), tree, "the red commit leaves the source tree as it was");
  builderHeld(next(w503, [OPUS, ...BUDGET]), w503, "a light log committed before the newest red does not admit review");
  lightAgain(w503);
  builderHeld(next(w503, [OPUS, ...BUDGET]), w503, "one more light run at the same tree does not supersede the failed full-gate log");
  writeFileSync(join(w503.wt, "source.txt"), "fixed by the builder\n");
  commit(w503.wt, `fix(${OPUS}): the source changes`);
  verb(w503.wt, ["handoff", "--opus", OPUS, "--sella", `builder.${OPUS}`, "--next", "ready for review", "--studio", w503.wtStudio, "--now", "2026-10-02T10:00:00.000Z"]);
  commit(w503.wt, `studio(${OPUS}): builder handoff after the fix`);
  const relit = next(w503, [OPUS, ...BUDGET]);
  expectStep(relit, "build", "named", "at a changed source tree the light gates are ordered");
  assert.equal(relit.kv.has("light-gates"), true, ran("the producer's light run", relit));
  assert.equal(performLight(w503).status, 0, "the light gates pass at the changed tree");
  const lightLog = readFileSync(join(w503.wtStudio, `ci/${OPUS}-light-${sourceTree(w503.wt).slice(5, 13)}.log`), "utf8").split("\n");
  assert.equal(lightLog[3], `head: ${git(w503.wt, ["rev-parse", "HEAD~1"])}`, "the fresh light log names the commit it ran at");
  expectStep(next(w503, [OPUS, ...BUDGET]), "review", "named", "a light log at a source tree changed after the newest red admits review");

  // the evidence-only red: light pass, review named, then a studio-only red at the same tree and no failed full log
  const ev = handedLight("w699-b5-evidence");
  assert.equal(performLight(ev).status, 0, "the light gates pass at the tree");
  expectStep(next(ev, [OPUS, ...BUDGET]), "review", "named", "a light log committed after the reds admits review");
  reRed(ev, RE_RED);
  fullOrder(next(ev, [OPUS, ...BUDGET]), "an evidence-only red at the review tree orders the full gates");
  lightAgain(ev);
  fullOrder(next(ev, [OPUS, ...BUDGET]), "a light log committed after an evidence-only red at the same tree does not admit review");
  writeGates(ev);
  expectStep(next(ev, [OPUS, ...BUDGET]), "review", "named", "a full-gate pass committed after the red at the same tree admits review");

  // the full gates, no light_gates: `gates.ok` does not bypass the order either
  const full = world("w699-b5-full", "reds", { automated: true });
  writeGates(full);
  expectStep(next(full, [OPUS, ...BUDGET]), "review", "named", "full-gate logs committed after the reds admit review");
  reRed(full, RE_RED);
  const fullStale = next(full, [OPUS, ...BUDGET]);
  expectStep(fullStale, "build", "named", "a full-gate log committed before the newest red does not admit review");
  assert.match(fullStale.kv.get("command") ?? "", /ci --opus W-900/, ran("the order names a fresh full ci", fullStale));
  writeGates(full, { log: (t) => `certifies: ${t}\ncommand: node -e 0\nexit code: 0\n\nrerun after the red\n` });
  expectStep(next(full, [OPUS, ...BUDGET]), "review", "named", "a full-gate log committed after the newest red admits review");

  // W-531 actual: the light gates pass, then the full ci fails at the same tree
  const actual = handedLight("w699-b5-w531");
  assert.equal(performLight(actual).status, 0, "the light gates pass before the full ci");
  failFull(actual);
  builderWithFailed(next(actual, [OPUS, ...BUDGET]), actual, "a failed full-gate log committed after the light log does not admit review");
  // W-531 reverse: the full ci fails first, then the light gates pass at the same tree
  const reverse = handedLight("w699-b5-w531-reverse");
  failFull(reverse);
  assert.equal(performLight(reverse).status, 0, "the light gates pass after the failed full ci");
  builderWithFailed(next(reverse, [OPUS, ...BUDGET]), reverse, "a light log committed after the failed full-gate log does not admit review");
  writeGates(reverse);
  expectStep(next(reverse, [OPUS, ...BUDGET]), "review", "named", "a full-gate pass at the same tree admits review");

  // spec review r2 #1: the failed full-gate log is read from the committed opus/<id> tree; the worktree's copy never hides it
  const kept = handedLight("w699-b5-committed");
  failFull(kept);
  assert.equal(performLight(kept).status, 0, "the light gates pass after the failed full ci");
  const failedPath = join(kept.wtStudio, `ci/${OPUS}-tests-${sourceTree(kept.wt).slice(5, 13)}.log`);
  const failedBytes = readFileSync(failedPath, "utf8");
  rmSync(failedPath);
  builderWithFailed(next(kept, [OPUS, ...BUDGET]), kept, "a tracked failed log deleted in the worktree does not admit review");
  writeFileSync(failedPath, failedBytes.replace(/^certifies: .*\n/, ""));
  builderWithFailed(next(kept, [OPUS, ...BUDGET]), kept, "a tracked failed log edited in the worktree to lose its certifies line does not admit review");
  // spec review r4 #2: a committed failed log stays the builder's whatever its worktree copy (only a committed passed log, below, orders the full gates again)
  writeFileSync(failedPath, failedBytes);
  git(kept.wt, ["mv", failedPath, `${failedPath}.moved`]);
  builderWithFailed(next(kept, [OPUS, ...BUDGET]), kept, "a tracked failed log renamed in the worktree still dispatches the builder");

  // each committed form the scan cannot read refuses (the full gates again); an untracked worktree file never counts
  const shape = handedLight("w699-b5-shape");
  assert.equal(performLight(shape).status, 0, "the light gates pass at the tree");
  const cur = sourceTree(shape.wt);
  const extra = join(shape.wtStudio, `ci/${OPUS}-extra-${cur.slice(5, 13)}.log`);
  writeFileSync(extra, FAILED_LOG(cur));
  expectStep(next(shape, [OPUS, ...BUDGET]), "review", "named", "an untracked failed-gate log in the worktree does not count");
  writeFileSync(extra, PASSED_LOG(cur));
  commit(shape.wt, `studio(${OPUS}): a passed extra gate log`);
  expectStep(next(shape, [OPUS, ...BUDGET]), "review", "named", "a committed passed full-gate log at the tree keeps review");
  git(shape.wt, ["mv", extra, `${extra}.moved`]);
  refusedFull(next(shape, [OPUS, ...BUDGET]), "a tracked full-gate log renamed in the worktree does not admit review", /differs in the worktree from opus\/W-900 \(a tracked modification or deletion\)/);
  git(shape.wt, ["mv", `${extra}.moved`, extra]);
  writeFileSync(extra, FAILED_LOG(cur));
  refusedFull(next(shape, [OPUS, ...BUDGET]), "a tracked full-gate log modified in the worktree does not admit review", /differs in the worktree from opus\/W-900 \(a tracked modification or deletion\)/);
  rmSync(extra);
  refusedFull(next(shape, [OPUS, ...BUDGET]), "a tracked full-gate log deleted in the worktree does not admit review", /differs in the worktree from opus\/W-900 \(a tracked modification or deletion\)/);
  writeFileSync(extra, PASSED_LOG(cur).replace("certifies: tree:", "certifies: dirty:"));
  commit(shape.wt, `studio(${OPUS}): the extra log certifies a dirty run`);
  refusedFull(next(shape, [OPUS, ...BUDGET]), "a committed full-gate log with another opening does not admit review", /does not open with certifies: tree:/);
  writeFileSync(extra, PASSED_LOG(cur).replace("exit code: 0", "exit code: zero"));
  commit(shape.wt, `studio(${OPUS}): the extra log's status in no writer form`);
  refusedFull(next(shape, [OPUS, ...BUDGET]), "a committed full-gate log with no writer-form status does not admit review", /carries no readable status \(line 3 is in no writer form\)/);
  rmSync(extra);
  symlinkSync(`${OPUS}-light-${cur.slice(5, 13)}.log`, extra);
  commit(shape.wt, `studio(${OPUS}): the extra log is a symlink`);
  refusedFull(next(shape, [OPUS, ...BUDGET]), "a committed full-gate log that is a symlink does not admit review", /is not a regular file on opus\/W-900 \(mode 120000\)/);
  rmSync(extra);
  commit(shape.wt, `studio(${OPUS}): the extra log deleted`);
  refusedFull(next(shape, [OPUS, ...BUDGET]), "a full-gate log deleted in a commit does not admit review", /was deleted in a commit/);

  // legacy: an unmarked record (no builder_runtime marker) never reaches the gates; a gate marked waived is the one exemption
  const unmarked = world("w699-b5-unmarked", "reds", { automated: true, legacy: true });
  const bare = next(unmarked, [OPUS, ...BUDGET]);
  expectStep(bare, "ready", "held", "an unmarked legacy record does not admit review");
  assert.match(bare.kv.get("why") ?? "", /carries no builder_runtime marker \(a legacy record is outside the ladder\)/, ran("the hold names the missing marker", bare));
  const marked = world("w699-b5-marked", "reds", { automated: true });
  editRecord(marked, "wt", (doc) => doc.setIn(["probationes", "tests"], { status: "waived", reason: "fixture", waived_by: "D-900", sella: "guest", at: T.reds }));
  commit(marked.wt, `studio(${OPUS}): tests waived`);
  expectStep(next(marked, [OPUS, ...BUDGET]), "review", "named", "a record whose every automated gate is marked waived admits review with no gate log");
});

// ---------------------------------------------------------------------------
// behaviour 6 (D-246): retro --daily prints the spec measure of the first 5 opera to start their spec after W-699 is done
// ---------------------------------------------------------------------------
function measureOfficina(tag: string): string {
  const root = join(mkdtempSync(join(tmpdir(), `w699-b6-${tag}-`)), "studio");
  dirs.push(join(root, ".."));
  for (const d of ["ci", "opera", "lessons", ".bisellium"]) mkdirSync(join(root, d), { recursive: true });
  // spec_seats (as the live officina declares them): each collegium's signer, read by readSpecSeats as next and verdict read it
  const seat = (id: string, collegium: string, model: string): string => `  - { id: ${id}, collegium: ${collegium}, kind: agent, model: ${model} }`;
  const seats = ["engineering: { signer: architect, reviewer: spec-reviewer }", "ops: { signer: ops-lead, reviewer: spec-reviewer }", "qa: { signer: qa-lead, reviewer: spec-reviewer }", "production: { signer: ladder-lead, reviewer: spec-reviewer }", "design: { signer: design-lead, reviewer: spec-reviewer }"];
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: w699",
      "patron: patron",
      "collegia:",
      "  - { id: production, name: Production, magister: producer }",
      "  - { id: design, name: Design, magister: architect }",
      "  - { id: engineering, name: Engineering, magister: architect }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "  - { id: ops, name: Ops, magister: ops-lead }",
      "sellae:",
      seat("producer", "production", "m-a"),
      seat("ladder-lead", "production", "m-a"),
      seat("architect", "engineering", "m-a"),
      seat("design-lead", "design", "m-a"),
      seat("qa-lead", "qa", "m-a"),
      seat("ops-lead", "ops", "m-a"),
      seat("spec-reviewer", "qa", "m-b"),
      "wip_limit: 9",
      "spec_seats:",
      "  since: 2026-01-01T00:00:00.000Z",
      "  collegia:",
      ...seats.map((r) => `    ${r}`),
      "",
    ].join("\n"),
  );
  return root;
}
function measured(root: string, id: string, kind: string, o: { state?: string; end?: string; specAt?: string; collegium?: string }): void {
  const spec = o.specAt === undefined ? "{}" : `{ spec: { sella: architect, status: passed, evidence: briefs/${id}.md, at: ${o.specAt} } }`;
  writeFileSync(join(root, "opera", `${id}.md`), `---\nid: "${id}"\ntitle: "fixture ${id}"\nkind: "${kind}"\ncollegium: "${o.collegium ?? "engineering"}"\nstate: ${o.state ?? "building"}\nprobationes: ${spec}\n${o.end === undefined ? "" : `end: ${o.end}\n`}---\n`);
}
/** Spec logs of `id` from `start` (an hour apart): `s` a signature (by `signer`), `p` a passed review, `f` a failed one. */
function specLogs(root: string, id: string, start: string, seq: string, signer = "architect"): void {
  [...seq].forEach((c, i) => {
    const at = new Date(new Date(start).getTime() + i * 3_600_000).toISOString();
    const outcome = c === "f" ? "failed" : "passed";
    const sella = c === "s" ? signer : "spec-reviewer";
    writeFileSync(join(root, "ci", `${id}-spec-${i + 1}.log`), `# opus: ${id}\n# outcome: ${outcome}\n# at: ${at}\n# sella: ${sella}\n# brief: briefs/${id}.md blob:aaa\n\n## Findings\n${c === "f" ? "1. blocking — fixture [class: spec×fixture] [severity: S2]" : "No findings"}\n`);
  });
}
const measureLine = (section: string): string => section.split("\n").find((l) => l.startsWith("D-246 measure: ")) ?? `(no measure line in)\n${section}`;

test("W-699-b6 behaviour 6: retro --daily prints spec review rounds, skipped reviews, escapes and spec hours of the first 5 opera after W-699, ui and engineering apart, median and max, and the pass mark", async () => {
  const { draftDailyRetro, reviewRounds } = await import("./retro.js");
  const root = measureOfficina("pass");
  measured(root, "W-699", "feature", { state: "done", end: "2026-10-20T00:00:00.000Z", specAt: "2026-10-10T00:00:00.000Z" });
  specLogs(root, "W-699", "2026-10-09T00:00:00.000Z", "sfsfsp");
  measured(root, "W-700", "feature", { specAt: "2026-10-19T12:00:00.000Z" });
  specLogs(root, "W-700", "2026-10-19T00:00:00.000Z", "sfsfsfsp");
  // each opus is signed by the signer its collegium declares in spec_seats (a kind: ui opus keeps the design magister, the legacy route)
  const cohort: [string, string, string, string, string, string][] = [
    ["W-701", "feature", "2026-10-21T00:00:00.000Z", "sp", "production", "ladder-lead"],
    ["W-702", "ui", "2026-10-21T01:00:00.000Z", "sfsfsp", "design", "architect"],
    ["W-703", "feature", "2026-10-21T02:00:00.000Z", "sps", "qa", "qa-lead"],
    ["W-704", "ui", "2026-10-21T03:00:00.000Z", "sp", "design", "architect"],
    ["W-705", "feature", "2026-10-21T04:00:00.000Z", "sfsp", "design", "design-lead"],
  ];
  for (const [id, kind, start, seq, collegium, signer] of cohort) {
    measured(root, id, kind, { collegium, specAt: new Date(new Date(start).getTime() + seq.length * 3_600_000).toISOString() });
    specLogs(root, id, start, seq, signer);
  }
  measured(root, "W-706", "feature", { collegium: "ops", specAt: "2026-10-23T00:00:00.000Z" });
  specLogs(root, "W-706", "2026-10-22T00:00:00.000Z", "sfsfsfsfsfsp", "ops-lead");
  writeFileSync(join(root, ".bisellium", "events.jsonl"), `${JSON.stringify({ id: "cli:1", name: "workflow.greenlight", ts: "2026-10-20T22:00:00.000Z", attrs: { "workflow.item.id": "W-701", "workflow.greenlight": "granted" } })}\nnot json\n`);
  const day = "2026-10-25";
  const draft = draftDailyRetro(root, day);
  assert.ok(!("error" in draft), `the daily retro drafts: ${JSON.stringify(draft)}`);
  const section = "section" in draft ? draft.section : "";
  const lines = section.split("\n");
  assert.equal(measureLine(section), "D-246 measure: 5 of 5 opera; median 1 (pass at most 2), max 3 (pass at most 4), escapes 0 (pass 0): PASS", "the measure names the five opera's rounds and the pass mark");
  for (const row of ["| W-701 | engineering | 1 | 0 | 0 | 4.0 |", "| W-702 | ui | 3 | 0 | 0 | n/a |", "| W-703 | engineering | 1 | 1 | 0 | n/a |", "| W-704 | ui | 1 | 0 | 0 | n/a |", "| W-705 | engineering | 2 | 0 | 0 | n/a |"])
    assert.ok(lines.includes(row), `each opus of the window has its row, signatures excluded and a stood re-signature counted skipped: ${row} in\n${section}`);
  assert.ok(!section.includes("| W-700 |") && !section.includes("| W-706 |") && !section.includes("| W-699 |"), `an opus before the landing, the sixth and W-699 itself are outside the window:\n${section}`);
  assert.ok(lines.includes("- ui: 2 opera; median 2, max 3") && lines.includes("- engineering: 3 opera; median 1, max 2"), `ui and engineering apart, median and max:\n${section}`);
  assert.ok(!section.slice(section.indexOf("#### Spec measure")).split(/[^A-Za-z]+/).includes("mean"), "never the mean");
  // spec review r4 #1: a signer of another collegium (ops, qa, production, a non-ui design) is a signature, never a reviewer round
  const rounds = reviewRounds(root);
  assert.ok(!("error" in rounds), `the review rounds read: ${JSON.stringify(rounds)}`);
  assert.equal("opus" in rounds ? rounds.opus.get("W-706")?.spec : undefined, 6, "an ops signer's six signatures are not counted among the reviews");
  writeFileSync(join(root, "lessons", "L-9.md"), `---\nid: "L-9"\nat: 2026-10-24T00:00:00Z\nclass: "escape×delta-rule"\nevidence: ["opera/W-703.md"]\nopus: "W-703"\n---\nThe stood re-signature hid a wrong Acceptance row.\n`);
  const escaped = draftDailyRetro(root, day);
  assert.equal(measureLine("section" in escaped ? escaped.section : ""), "D-246 measure: 5 of 5 opera; median 1 (pass at most 2), max 3 (pass at most 4), escapes 1 (pass 0): MISS", "an escape misses the mark");
  writeFileSync(join(root, "lessons", "L-9.md"), readFileSync(join(root, "lessons", "L-9.md"), "utf8").replace('opus: "W-703"\n', ""));
  assert.deepEqual(draftDailyRetro(root, day), { error: "lessons/L-9.md: an escape×delta-rule lesson names no opus (opus: W-<n>), so the D-246 measure cannot count it" }, "an escape naming no opus refuses the measure");
  rmSync(join(root, "lessons", "L-9.md"));
  specLogs(root, "W-705", "2026-10-21T04:00:00.000Z", "sfsfsfsfsp", "design-lead");
  const over = draftDailyRetro(root, day);
  assert.equal(measureLine("section" in over ? over.section : ""), "D-246 measure: 5 of 5 opera; median 1 (pass at most 2), max 5 (pass at most 4), escapes 0 (pass 0): MISS", "an opus over 4 rounds misses the mark");
  for (let n = 5; n <= 10; n++) rmSync(join(root, "ci", `W-705-spec-${n}.log`));
  measured(root, "W-704", "ui", {});
  const open = draftDailyRetro(root, day);
  assert.equal(measureLine("section" in open ? open.section : ""), "D-246 measure: 5 of 5 opera; median 1 (pass at most 2), max 3 (pass at most 4), escapes 0 (pass 0): PENDING", "an opus whose spec is still open keeps the mark pending");
  measured(root, "W-699", "feature", { state: "building", specAt: "2026-10-10T00:00:00.000Z" });
  const before = draftDailyRetro(root, day);
  assert.ok(("section" in before ? before.section : "").includes("- W-699 is not done: no opus is in the comparison window yet; D-246 measure: PENDING"), "before W-699 is done no opus is measured");
});
