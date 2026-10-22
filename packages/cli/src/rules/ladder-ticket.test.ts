/**
 * W-268 rows b1-b3 (studio/briefs/W-268.md): ladder.ticket. node:test TAP, selected by `--test-name-pattern='^W-268-b<n>\s'`.
 * W-358 rows b1-b3 (studio/briefs/W-358.md): ladder.ticket on the record's tickets: entries, and ladder.order.
 * Every row builds its own officina under the OS tmp dir and reads no studio/ file.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkStudio } from "../check.js";
import { initStudio } from "../init.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const ID = "W-900";
const HEX = "0123456789abcdef0123456789abcdef01234567";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Ticket { opus?: string; action?: string; round?: number; at: string }
/** The canonical line `ticketLine` writes. */
const ticket = (t: Ticket): string =>
  JSON.stringify({ opus: t.opus ?? ID, step: "spec", action: t.action ?? "verdict-spec", round: t.round ?? 1, actor: "architect", studio: "studio", head: HEX, brief: HEX, at: t.at });
/** A verdict log: `# opus`, `# phase`, `# round`, `# at`, then each ticket line given. */
function verdict(root: string, name: string, h: { opus?: string; phase: string; round: number; at: string }, tickets: string[]): void {
  mkdirSync(join(root, "ci"), { recursive: true });
  const lines = [`# opus: ${h.opus ?? ID}`, `# phase: ${h.phase}`, `# round: ${h.round}`, "# sella: architect", "# outcome: passed", `# at: ${h.at}`, ...tickets.map((t) => `# ticket: ${t}`)];
  writeFileSync(join(root, "ci", name), `${lines.join("\n")}\n\n## Findings\nNo findings\n`);
}
/** A red log under ci/reds/<opus>/. */
function red(root: string, opus: string, name: string, behaviour: number, at: string, tickets: string[]): void {
  mkdirSync(join(root, "ci", "reds", opus), { recursive: true });
  const lines = [`# behaviour: ${behaviour}`, "# command: node --test x", "# exit: 1", `# at: ${at}`, "# sella: builder", ...tickets.map((t) => `# ticket: ${t}`)];
  writeFileSync(join(root, "ci", "reds", opus, name), `${lines.join("\n")}\n\nnot ok 1 - x\n`);
}
function record(root: string, id: string, state: string): void {
  writeFileSync(join(root, "opera", `${id}.md`), `---\nid: "${id}"\ntitle: "An opus"\nkind: "feature"\ncollegium: "production"\nstate: ${state}\n---\n`);
}
/** An officina with `step_tickets` (default required) and W-900 in `state`, its spec, red and build logs each ticketed. */
function officina(w: { state?: string; tickets?: string | null } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w268-"));
  dirs.push(root);
  assert.ok(initStudio(root, { now: NOW }).root);
  if (w.tickets !== null) {
    const manifest = join(root, "bisellium.yml");
    writeFileSync(manifest, `${readFileSync(manifest, "utf8")}step_tickets: ${w.tickets ?? "required"}\n`);
  }
  record(root, ID, w.state ?? "greenlit");
  verdict(root, `${ID}-spec-1.log`, { phase: "spec", round: 1, at: "2026-10-15T00:00:10.000Z" }, [ticket({ at: "2026-10-15T00:00:05.000Z" })]);
  red(root, ID, "01.log", 1, "2026-10-15T00:10:10.000Z", [ticket({ action: "red", round: 1, at: "2026-10-15T00:10:05.000Z" })]);
  verdict(root, `${ID}-review-1.log`, { phase: "build", round: 1, at: "2026-10-15T00:20:10.000Z" }, [ticket({ action: "verdict-build", round: 1, at: "2026-10-15T00:20:05.000Z" })]);
  return root;
}
const LATE = "2026-10-15T00:30:10.000Z";
/** W-900's round-2 spec log at LATE with the tickets given. */
const spec2 = (root: string, tickets: string[], at = LATE): string => {
  verdict(root, `${ID}-spec-2.log`, { phase: "spec", round: 2, at }, tickets);
  return root;
};
const ladder = (root: string) => checkStudio(root, NOW).findings.filter((f) => f.rule === "ladder.ticket");
const found = (root: string): string[] => ladder(root).map((f) => `${f.level} ${f.where}`);
const SPEC2 = [`block ci/${ID}-spec-2.log`];

test("W-268-b1 behaviour 1: a covered log with no ticket, two, or one that is not a step ticket line blocks ladder.ticket at the log", () => {
  const bare = spec2(officina(), []);
  assert.deepEqual(found(bare), SPEC2, "an un-ticketed spec verdict log: one block at the log");
  assert.match(ladder(bare)[0]!.message, /carries 0 # ticket: lines, want exactly one: run bisellium next W-900 before the write/, "the message names the count and the next call");
  const twice = officina();
  red(twice, ID, "02.log", 2, LATE, [ticket({ action: "red", round: 2, at: "2026-10-15T00:30:05.000Z" }), ticket({ action: "red", round: 2, at: "2026-10-15T00:30:06.000Z" })]);
  assert.deepEqual(found(twice), [`block ci/reds/${ID}/02.log`], "a red log with two ticket lines blocks");
  assert.match(ladder(twice)[0]!.message, /carries 2 # ticket: lines, want exactly one/, "the message names the count");
  const loose = officina();
  verdict(loose, `${ID}-review-2.log`, { phase: "build", round: 2, at: LATE }, [ticket({ action: "verdict-build", round: 2, at: "2026-10-15T00:30:05.000Z" }).replace(",", ", ")]);
  assert.deepEqual(found(loose), [`block ci/${ID}-review-2.log`], "a build verdict log whose ticket is not canonical blocks");
  assert.match(ladder(loose)[0]!.message, /is not a step ticket line \(not the canonical line/, "the message names parseTicketLine's reason");
  assert.deepEqual(found(officina()), [], "every covered log ticketed: no finding");
  const other = officina();
  verdict(other, `${ID}-handoff-1.log`, { phase: "handoff", round: 1, at: LATE }, []);
  writeFileSync(join(other, "ci", `${ID}-tests-${HEX}.log`), `certifies: tree:${HEX}\nexit code: 0\n`);
  assert.deepEqual(found(other), [], "a handoff-phase log and a gate log are not covered");
  assert.deepEqual(found(spec2(officina({ tickets: null }), [])), [], "no step_tickets: the rule is off");
});

test("W-268-b2 behaviour 2: a ticket naming another opus, action or round, issued after its log, or not after the opus's previous covered log blocks", () => {
  const foreign = spec2(officina(), [ticket({ opus: "W-901", round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  assert.deepEqual(found(foreign), SPEC2, "a ticket naming another opus blocks");
  assert.match(ladder(foreign)[0]!.message, /its ticket names W-901 verdict-spec round 2, want W-900 verdict-spec round 2/, "the message names both");
  assert.deepEqual(found(spec2(officina(), [ticket({ action: "verdict-build", round: 2, at: "2026-10-15T00:30:05.000Z" })])), SPEC2, "a ticket for another action blocks");
  assert.deepEqual(found(spec2(officina(), [ticket({ round: 1, at: "2026-10-15T00:30:05.000Z" })])), SPEC2, "a ticket for another round blocks");
  const behaviour = officina();
  red(behaviour, ID, "02.log", 2, LATE, [ticket({ action: "red", round: 1, at: "2026-10-15T00:30:05.000Z" })]);
  assert.deepEqual(found(behaviour), [`block ci/reds/${ID}/02.log`], "a red ticket for another behaviour blocks");
  const late = spec2(officina(), [ticket({ round: 2, at: "2026-10-15T00:30:11.000Z" })]);
  assert.deepEqual(found(late), SPEC2, "a ticket issued after its log blocks");
  assert.match(ladder(late)[0]!.message, /issued at 2026-10-15T00:30:11\.000Z, after the log \(2026-10-15T00:30:10\.000Z\)/, "the message names both times");
  const spent = spec2(officina(), [ticket({ round: 2, at: "2026-10-15T00:20:00.000Z" })]);
  assert.deepEqual(found(spent), SPEC2, "a ticket issued before the opus's previous covered log blocks");
  assert.match(ladder(spent)[0]!.message, /is not after W-900's previous covered log ci\/W-900-review-1\.log \(2026-10-15T00:20:10\.000Z\)/, "the message names the previous log");
  const lanes = officina();
  record(lanes, "W-901", "building");
  verdict(lanes, "W-901-spec-1.log", { opus: "W-901", phase: "spec", round: 1, at: "2026-10-15T00:05:10.000Z" }, [ticket({ opus: "W-901", at: "2026-10-15T00:00:07.000Z" })]);
  assert.deepEqual(found(lanes), [], "another opus's logs between this one's are no finding: the order is per opus");
  assert.deepEqual(found(spec2(officina(), [ticket({ round: 2, at: "2026-10-15T00:30:05.000Z" })])), [], "the matching, fresh ticket is no finding");
});

test("W-268-b3 behaviour 3: only an open opus's logs from the officina's first ticket on are judged, a malformed step_tickets blocks, and a judged log needs an exact UTC at", () => {
  const before = officina();
  record(before, "W-902", "greenlit");
  verdict(before, "W-902-spec-1.log", { opus: "W-902", phase: "spec", round: 1, at: "2026-10-14T00:00:00.000Z" }, []);
  assert.deepEqual(found(before), [], "a log written before the officina's first ticket is no finding");
  const lone = (): string => {
    const root = officina();
    rmSync(join(root, "ci", "reds"), { recursive: true });
    rmSync(join(root, "ci", `${ID}-review-1.log`));
    return root;
  };
  const late = lone();
  verdict(late, `${ID}-spec-1.log`, { phase: "spec", round: 1, at: "2026-10-15T00:00:10.000Z" }, [ticket({ at: "2026-10-16T00:00:00.000Z" })]);
  assert.deepEqual(found(late), [`block ci/${ID}-spec-1.log`], "a lone ticket issued after its own log blocks: the boundary never passes over a log that carries a ticket");
  assert.match(ladder(late)[0]!.message, /issued at 2026-10-16T00:00:00\.000Z, after the log \(2026-10-15T00:00:10\.000Z\)/, "the message names both times");
  record(late, "W-902", "greenlit");
  verdict(late, "W-902-spec-1.log", { opus: "W-902", phase: "spec", round: 1, at: "2026-10-15T12:00:00.000Z" }, []);
  assert.deepEqual(found(late), [`block ci/${ID}-spec-1.log`, "block ci/W-902-spec-1.log"], "an un-ticketed log after the first ticketed log but before its late ticket's at is judged");
  const garbled = lone();
  verdict(garbled, `${ID}-spec-1.log`, { phase: "spec", round: 1, at: "2026-10-15T00:00:10.000Z" }, ["{not a ticket}"]);
  assert.deepEqual(found(garbled), [`block ci/${ID}-spec-1.log`], "a lone ticket line that is not canonical, with no canonical ticket anywhere, blocks");
  // spec round 4's S2: no exact time among the candidates, so the boundary is +Infinity (not NaN, not a throw)
  const inexact = lone();
  verdict(inexact, `${ID}-spec-1.log`, { phase: "spec", round: 1, at: "2026-10-15T00:00:10+00:00" }, ["{not a ticket}"]);
  record(inexact, "W-902", "greenlit");
  verdict(inexact, "W-902-spec-1.log", { opus: "W-902", phase: "spec", round: 1, at: "2026-10-15T12:00:00.000Z" }, []);
  record(inexact, "W-904", "greenlit");
  verdict(inexact, "W-904-spec-1.log", { opus: "W-904", phase: "spec", round: 1, at: "2026-10-15T12:00:00+00:00" }, []);
  assert.deepEqual(found(inexact), [`block ci/${ID}-spec-1.log`, "block ci/W-904-spec-1.log"], "no exact time among the candidates: the boundary is +Infinity, so only logs with an inexact at are judged");
  for (const state of ["done", "halted", "backlog"]) assert.deepEqual(found(spec2(officina({ state }), [])), [], `${state}: not judged`);
  for (const state of ["building", "verifying", "review"]) assert.deepEqual(found(spec2(officina({ state }), [])), SPEC2, `${state}: judged`);
  const orphan = officina();
  verdict(orphan, "W-903-spec-1.log", { opus: "W-903", phase: "spec", round: 1, at: LATE }, []);
  assert.deepEqual(found(orphan), [], "a log of an opus with no record is not judged");
  const malformed = officina({ tickets: "yes" });
  assert.deepEqual(found(malformed), ["block bisellium.yml"], "a malformed step_tickets blocks at bisellium.yml");
  assert.match(ladder(malformed)[0]!.message, /step_tickets is malformed \(step_tickets must be exactly "required", or absent/, "the message names readStepTickets' reason");
  const offset = spec2(officina(), [ticket({ round: 2, at: "2026-10-15T00:30:05.000Z" })], "2026-10-15T00:30:10+00:00");
  assert.deepEqual(found(offset), SPEC2, "a judged log whose at is not exact UTC blocks");
  assert.match(ladder(offset)[0]!.message, /has no exact UTC # at: \(2026-10-15T00:30:10\+00:00\)/, "the message names the at");
  const fresh = officina();
  for (const f of [`${ID}-spec-1.log`, `${ID}-review-1.log`]) verdict(fresh, f, { phase: f.includes("spec") ? "spec" : "build", round: 1, at: "2026-10-15T00:00:10+00:00" }, []);
  rmSync(join(fresh, "ci", "reds"), { recursive: true });
  assert.deepEqual(found(fresh), [], "an officina with no ticket yet judges nothing, not even a log with no exact UTC at");
});

// ---- W-358 (W-268 part 2): the record's tickets: entries and ladder.order
/** A record entry's canonical line: `ready`/`done` at round 0, `review` at its evidence round. */
const entryLine = (action: string, at: string, w: { opus?: string; round?: number } = {}): string =>
  JSON.stringify({ opus: w.opus ?? ID, step: action, action, round: w.round ?? (action === "review" ? 1 : 0), actor: "producer", studio: "studio", head: HEX, brief: HEX, at });
/** W-900's record in `state` with the `tickets:` value given (a list or any other YAML value), written as JSON flow. */
function entries(root: string, value: unknown, state = "greenlit"): string {
  writeFileSync(join(root, "opera", `${ID}.md`), `---\nid: "${ID}"\ntitle: "An opus"\nkind: "feature"\ncollegium: "production"\nstate: ${state}\ntickets: ${JSON.stringify(value)}\n---\n`);
  return root;
}
const READY = entryLine("ready", "2026-10-15T00:05:00.000Z");
const REVIEW = entryLine("review", "2026-10-15T00:25:00.000Z");
const DONE = entryLine("done", "2026-10-15T00:40:00.000Z");
const RECORD = [`block opera/${ID}.md`];
const of = (rule: string) => (root: string) => checkStudio(root, NOW).findings.filter((f) => f.rule === rule);
const ticketRule = of("ladder.ticket");
const orderRule = of("ladder.order");
const at = (fs: { level: string; where: string }[]): string[] => fs.map((f) => `${f.level} ${f.where}`);

test("W-358-b1 behaviour 1: ladder.ticket blocks a record's tickets: entry that is not a step ticket line, names another opus, or names another action or round", () => {
  const loose = entries(officina(), [READY.replace(",", ", "), REVIEW]);
  assert.deepEqual(at(ticketRule(loose)), RECORD, "an entry that is not the canonical line blocks at the record");
  assert.match(ticketRule(loose)[0]!.message, /W-900's tickets: entry 1 is not a step ticket line \(not the canonical line/, "the message names the entry and parseTicketLine's reason");
  assert.deepEqual(at(ticketRule(entries(officina(), { ready: READY }))), RECORD, "a tickets: value that is not a list blocks");
  assert.deepEqual(at(ticketRule(entries(officina(), [READY, 7]))), RECORD, "an entry that is not a string blocks");
  const foreign = entries(officina(), [entryLine("ready", "2026-10-15T00:05:00.000Z", { opus: "W-901" })]);
  assert.deepEqual(at(ticketRule(foreign)), RECORD, "an entry naming another opus blocks");
  assert.match(ticketRule(foreign)[0]!.message, /entry 1 names W-901, want W-900/, "the message names both");
  const action = entries(officina(), [READY, entryLine("red", "2026-10-15T00:25:00.000Z", { round: 1 })]);
  assert.deepEqual(at(ticketRule(action)), RECORD, "an entry for an action a record does not hold blocks");
  assert.match(ticketRule(action)[0]!.message, /entry 2 is a red ticket; a record's tickets: holds only ready, review and done/, "the message names the action");
  const ready = entries(officina(), [entryLine("ready", "2026-10-15T00:05:00.000Z", { round: 1 })]);
  assert.deepEqual(at(ticketRule(ready)), RECORD, "a ready entry for round 1 blocks");
  assert.match(ticketRule(ready)[0]!.message, /entry 1 \(ready\) names round 1, want round 0/, "the message names the round");
  const review = entries(officina(), [READY, entryLine("review", "2026-10-15T00:25:00.000Z", { round: 2 })]);
  assert.deepEqual(at(ticketRule(review)), RECORD, "a review entry whose round has no build verdict log blocks");
  assert.match(ticketRule(review)[0]!.message, /entry 2 \(review\) names round 2, but ci\/W-900-review-2\.log is not W-900's build verdict log for round 2/, "the message names the missing log");
  // spec round 2: the named log's own headers must agree with the entry, in a done record too
  const copied = entries(officina(), [READY, REVIEW, entryLine("review", "2026-10-15T00:35:00.000Z", { round: 2 }), entryLine("done", "2026-10-15T00:40:00.000Z")], "done");
  verdict(copied, `${ID}-review-2.log`, { phase: "build", round: 1, at: "2026-10-15T00:30:10.000Z" }, [ticket({ action: "verdict-build", round: 1, at: "2026-10-15T00:30:05.000Z" })]);
  assert.deepEqual(at(ticketRule(copied)), RECORD, "a review entry whose named log has another header round blocks");
  assert.match(ticketRule(copied)[0]!.message, /entry 3 \(review\) names round 2, but ci\/W-900-review-2\.log is not W-900's build verdict log for round 2/, "the message names the log and the round");
  const borrowed = entries(officina(), [READY, REVIEW, entryLine("review", "2026-10-15T00:35:00.000Z", { round: 2 })], "done");
  verdict(borrowed, `${ID}-review-2.log`, { opus: "W-901", phase: "build", round: 2, at: "2026-10-15T00:30:10.000Z" }, [ticket({ opus: "W-901", action: "verdict-build", round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  assert.deepEqual(at(ticketRule(borrowed)), RECORD, "a review entry whose named log has another header opus blocks");
  const specLog = entries(officina(), [READY, REVIEW, entryLine("review", "2026-10-15T00:35:00.000Z", { round: 2 })], "done");
  verdict(specLog, `${ID}-review-2.log`, { phase: "spec", round: 2, at: "2026-10-15T00:30:10.000Z" }, [ticket({ round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  assert.deepEqual(at(ticketRule(specLog)), RECORD, "a review entry whose named log has another header phase blocks");
  const twoRounds = entries(officina(), [READY, REVIEW, entryLine("review", "2026-10-15T00:35:00.000Z", { round: 2 })], "done");
  writeFileSync(join(twoRounds, "ci", `${ID}-review-2.log`), `# opus: ${ID}\n# phase: build\n# round: 2\n# round: 2\n# at: 2026-10-15T00:30:10.000Z\n\n## Findings\nNo findings\n`);
  assert.deepEqual(at(ticketRule(twoRounds)), RECORD, "a review entry whose named log repeats its round header blocks");
  const agreeing = entries(officina(), [READY, REVIEW, entryLine("review", "2026-10-15T00:35:00.000Z", { round: 2 })], "done");
  verdict(agreeing, `${ID}-review-2.log`, { phase: "build", round: 2, at: "2026-10-15T00:30:10.000Z" }, [ticket({ action: "verdict-build", round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  assert.deepEqual(at(ticketRule(agreeing)), [], "a done record's review entry whose named log's headers agree: no finding");
  const doneRound = entries(officina(), [READY, REVIEW, entryLine("done", "2026-10-15T00:40:00.000Z", { round: 3 })], "done");
  assert.deepEqual(at(ticketRule(doneRound)), RECORD, "a done record's entries are judged: a done entry for round 3 blocks");
  const two = entries(officina(), [READY.replace(",", ", "), entryLine("ready", "2026-10-15T00:06:00.000Z", { opus: "W-901" })]);
  assert.deepEqual(at(ticketRule(two)), [...RECORD, ...RECORD], "one finding per entry");
  assert.deepEqual(at(ticketRule(entries(officina(), [READY, REVIEW]))), [], "a ready and a review entry whose round has its build verdict log: no finding");
  assert.deepEqual(at(ticketRule(entries(officina(), [READY, REVIEW, DONE], "done"))), [], "a done record's ready, review and done entries: no finding");
  assert.deepEqual(at(ticketRule(entries(officina({ tickets: null }), [READY.replace(",", ", ")]))), [], "no step_tickets: the entries are not judged");
});

test("W-358-b2 behaviour 2: ladder.order blocks a judged verdict log whose round does not follow its time within its opus and phase (W-183's late verdict)", () => {
  const late = officina();
  verdict(late, `${ID}-spec-2.log`, { phase: "spec", round: 2, at: LATE }, [ticket({ round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  verdict(late, `${ID}-spec-3.log`, { phase: "spec", round: 3, at: "2026-10-15T00:25:10.000Z" }, [ticket({ round: 3, at: "2026-10-15T00:25:05.000Z" })]);
  assert.deepEqual(at(ticketRule(late)), [], "each ticket binds its own log, so ladder.ticket finds nothing");
  assert.deepEqual(at(orderRule(late)), [`block ci/${ID}-spec-3.log`], "a round written before the round below it blocks at the later round's log");
  assert.match(orderRule(late)[0]!.message, /W-900's spec round 3 \(2026-10-15T00:25:10\.000Z\) is not after round 2's log ci\/W-900-spec-2\.log \(2026-10-15T00:30:10\.000Z\): rounds are recorded in order/, "the message names the opus, both logs and both times");
  const tie = officina();
  verdict(tie, `${ID}-spec-2.log`, { phase: "spec", round: 2, at: LATE }, [ticket({ round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  verdict(tie, `${ID}-spec-3.log`, { phase: "spec", round: 3, at: LATE }, [ticket({ round: 3, at: "2026-10-15T00:30:06.000Z" })]);
  assert.deepEqual(at(orderRule(tie)), [`block ci/${ID}-spec-3.log`], "a round at the same instant as the round below it blocks");
  const build = officina();
  verdict(build, `${ID}-review-2.log`, { phase: "build", round: 2, at: "2026-10-15T00:15:10.000Z" }, [ticket({ action: "verdict-build", round: 2, at: "2026-10-15T00:15:05.000Z" })]);
  assert.deepEqual(at(orderRule(build)), [`block ci/${ID}-review-2.log`], "build rounds are a sequence of their own");
  const again = officina();
  verdict(again, `${ID}-spec-2.log`, { phase: "spec", round: 2, at: LATE }, [ticket({ round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  verdict(again, `${ID}-spec-2b.log`, { phase: "spec", round: 2, at: "2026-10-15T00:40:10.000Z" }, [ticket({ round: 2, at: "2026-10-15T00:40:05.000Z" })]);
  assert.deepEqual(at(orderRule(again)), [`block ci/${ID}-spec-2b.log`], "a round recorded twice blocks at the second log");
  assert.match(orderRule(again)[0]!.message, /W-900's spec round 2 is recorded again after ci\/W-900-spec-2\.log: one log per round/, "the message names the first log");
  const inOrder = officina();
  verdict(inOrder, `${ID}-spec-2.log`, { phase: "spec", round: 2, at: LATE }, [ticket({ round: 2, at: "2026-10-15T00:30:05.000Z" })]);
  assert.deepEqual(at(orderRule(inOrder)), [], "spec rounds 1 and 2 in time order, build round 1 between them: no finding");
  const lanes = officina();
  record(lanes, "W-901", "building");
  verdict(lanes, "W-901-spec-1.log", { opus: "W-901", phase: "spec", round: 1, at: "2026-10-15T00:01:10.000Z" }, [ticket({ opus: "W-901", round: 1, at: "2026-10-15T00:01:05.000Z" })]);
  assert.deepEqual(at(orderRule(lanes)), [], "another opus's rounds are their own sequence");
  const history = officina();
  record(history, "W-902", "greenlit");
  verdict(history, "W-902-spec-1.log", { opus: "W-902", phase: "spec", round: 1, at: "2026-10-14T00:10:00.000Z" }, []);
  verdict(history, "W-902-spec-2.log", { opus: "W-902", phase: "spec", round: 2, at: "2026-10-14T00:05:00.000Z" }, []);
  assert.deepEqual(at(orderRule(history)), [], "a late verdict before the officina's first ticket is history: no finding");
  for (const state of ["done", "halted", "backlog"]) {
    const closed = officina({ state });
    verdict(closed, `${ID}-spec-2.log`, { phase: "spec", round: 2, at: "2026-10-14T23:00:00.000Z" }, [ticket({ round: 2, at: "2026-10-14T22:59:00.000Z" })]);
    assert.deepEqual(at(orderRule(closed)), [], `${state}: not judged`);
  }
  const off = officina({ tickets: null });
  verdict(off, `${ID}-spec-2.log`, { phase: "spec", round: 2, at: "2026-10-14T23:00:00.000Z" }, []);
  assert.deepEqual(at(orderRule(off)), [], "no step_tickets: the rule is off");
});

test("W-358-b3 behaviour 3: ladder.order blocks a record's tickets: entry that is not after the entry before it", () => {
  const swapped = entries(officina(), [REVIEW, READY]);
  assert.deepEqual(at(orderRule(swapped)), RECORD, "an entry earlier than the entry before it blocks at the record");
  assert.match(orderRule(swapped)[0]!.message, /W-900's tickets: entry 2 \(ready, 2026-10-15T00:05:00\.000Z\) is not after entry 1 \(review, 2026-10-15T00:25:00\.000Z\): entries are appended in time order/, "the message names the opus, both entries and both times");
  assert.deepEqual(at(orderRule(entries(officina(), [READY, entryLine("review", "2026-10-15T00:05:00.000Z")]))), RECORD, "an entry at the same instant as the one before it blocks");
  assert.deepEqual(at(orderRule(entries(officina(), [READY, DONE, REVIEW], "done"))), RECORD, "a done record's entries are judged");
  const gap = entries(officina(), [READY, READY.replace(",", ", "), REVIEW]);
  assert.deepEqual(at(orderRule(gap)), [], "an entry that is not a ticket line is ladder.ticket's; the order compares the canonical entries around it");
  assert.deepEqual(at(ticketRule(gap)), RECORD, "and ladder.ticket blocks it");
  assert.deepEqual(at(orderRule(entries(officina(), [READY, REVIEW, DONE], "done"))), [], "entries in time order: no finding");
  assert.deepEqual(at(orderRule(entries(officina({ tickets: null }), [REVIEW, READY]))), [], "no step_tickets: the rule is off");
});
