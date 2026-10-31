/**
 * packages/cli/src/retro-daily.test.ts — W-459: the daily retro is a verb, `bisellium retro --daily` (row b1), `check`
 * warns while the previous UTC day has no entry (row b2), and `next` holds a new start on it (row b3, next-done.test.ts).
 * `node:test`; select one row with --test-name-pattern='^W-459-b<k>\s'. Fixtures are temp officinae; nothing is written
 * in `studio/` or `examples/`.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { checkStudio, type Finding } from "./check.js";
import { initStudio } from "./init.js";
import { previousUtcDay, runRetro } from "./retro.js";

const NOW = new Date("2026-10-31T09:00:00Z");
const DAY = "2026-10-30";
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const put = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
function officina(tag: string): string {
  const root = join(mkdtempSync(join(tmpdir(), `bisellium-w459-${tag}-`)), "studio");
  made.push(join(root, ".."));
  initStudio(root, { now: NOW });
  // the record directories the daily retro requires (dailyDir), so each refusal below is refused for its own reason
  for (const d of ["ci", "opera"]) mkdirSync(join(root, d), { recursive: true });
  put(
    root,
    "bisellium.yml",
    [
      "bisellium: 1",
      "studio: w459",
      "patron: patron",
      "collegia:",
      "  - { id: production, name: Production, magister: producer }",
      "  - { id: design, name: Design, magister: architect }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: producer, collegium: production, kind: agent }",
      "  - { id: architect, collegium: design, kind: agent }",
      "  - { id: qa-lead, collegium: qa, kind: agent }",
      "probationes:",
      "  - { id: tests, name: Tests, kind: automated }",
      "wip_limit: 9",
      "",
    ].join("\n"),
  );
  return root;
}
const TRACKER_HEAD = `---\nauthor: producer\nkind: daily\ntitle: "Improvements tracker"\nat: 2026-10-17T00:00:00Z\n---\n# Improvements tracker\n\n| Change | Status |\n|---|---|\n| W-1 | done |\n\n## Daily retro\n`;
const tracker = (root: string, days: string[], tail = ""): void => put(root, "acta/improvements.md", TRACKER_HEAD + days.map((d) => `\n### ${d}\n\n- fixture entry\n`).join("") + tail);
function opus(root: string, id: string, state: string, end?: string): void {
  put(root, `opera/${id}.md`, `---\nid: "${id}"\ntitle: "fixture ${id}"\nkind: "opus"\ncollegium: "qa"\nstate: ${state}\nprobationes: {}\n${end === undefined ? "" : `end: ${end}\n`}---\n`);
}
function round(root: string, id: string, phase: "spec" | "review", n: number, at: string | undefined, outcome: string, blockers: string[] = [], brief = "aaa"): void {
  const head = [`# opus: ${id}`, `# outcome: ${outcome}`, ...(at === undefined ? [] : [`# at: ${at}`]), `# brief: briefs/${id}.md blob:${brief}`].join("\n");
  const body = blockers.length === 0 ? "No findings" : blockers.map((b, i) => `${i + 1}. blocking — fixture ${b}`).join("\n");
  put(root, `ci/${id}-${phase}-${n}.log`, `${head}\n\n## Findings\n${body}\n`);
}
const gate = (root: string, id: string, kind: "tests" | "lint" | "types", tree: string, exit: number, body: string): void =>
  put(root, `ci/${id}-${kind}-${tree}.log`, `certifies: tree:${tree}${"0".repeat(40 - tree.length)}\ncommand: npm test\nexit code: ${exit}\n\n${body}`);
const lesson = (root: string, id: string, cls: string, addressedBy: string): void =>
  put(root, `lessons/${id}.md`, `---\nid: "${id}"\nat: 2026-10-20T10:00:00Z\nclass: "${cls}"\nevidence: ["bisellium.yml"]\naddressed_by: "${addressedBy}"\n---\nFixture.\n`);

function daily(root: string, now = NOW): { status: number; out: string; err: string } {
  const [log, error] = [console.log, console.error];
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...a: unknown[]): void => void out.push(a.join(" "));
  console.error = (...a: unknown[]): void => void err.push(a.join(" "));
  try {
    return { status: runRetro(["--daily", "--studio", root, "--now", now.toISOString()]).exitCode, out: out.join("\n"), err: err.join("\n") };
  } finally {
    [console.log, console.error] = [log, error];
  }
}
const shown = (r: { status: number; out: string; err: string }): string => `exit ${r.status}\n--- stdout\n${r.out}\n--- stderr\n${r.err}`;

/** The day's records: W-10 done on the day with a two-round loop and two failing gate logs, the window's other opera, and
 *  the window's edges: W-15 done on day−13 (10-17, inside) and W-16 on day−14 (10-16, outside), each failing at a W-8 row. */
function day(root: string): void {
  opus(root, "W-10", "done", `${DAY}T12:00:00Z`);
  round(root, "W-10", "spec", 1, `${DAY}T08:00:00Z`, "passed");
  round(root, "W-10", "review", 1, `${DAY}T10:00:00Z`, "failed", ["[class: tests×loop] [severity: S1]", "[class: spec×owed-b] [severity: S2]"]);
  round(root, "W-10", "review", 2, `${DAY}T10:30:00Z`, "failed", ["[class: tests×loop] [severity: S1]"]);
  round(root, "W-10", "review", 3, `${DAY}T11:00:00Z`, "passed");
  gate(root, "W-10", "tests", "aaaaaaaa", 1, "✖ W-7-b2 behaviour 2: a census row fails (5ms)\n  AssertionError [ERR_ASSERTION]\n✖ failing tests:\n✖ W-7-b2 behaviour 2: a census row fails (5ms)\n");
  gate(root, "W-10", "lint", "aaaaaaaa", 0, "");
  gate(root, "W-10", "types", "bbbbbbbb", 2, "error TS2322: no row here\n");
  opus(root, "W-11", "done", "2026-10-25T09:00:00Z");
  gate(root, "W-11", "tests", "cccccccc", 1, "TAP version 13\nnot ok 3 - W-7-b1 behaviour 1: another row of W-7\n");
  opus(root, "W-12", "greenlit");
  round(root, "W-12", "review", 1, "2026-10-28T10:00:00Z", "failed", ["[class: tests×loop] [severity: S2]", "[class: spec×owed-b] [severity: S1]"]);
  opus(root, "W-13", "done", "2026-10-01T09:00:00Z");
  gate(root, "W-13", "tests", "dddddddd", 1, "✖ W-7-b3 behaviour 3: outside the window\n");
  opus(root, "W-14", "done", "2026-10-29T09:00:00Z");
  round(root, "W-14", "review", 1, undefined, "failed", ["[class: spec×owed-b] [severity: S1]"]);
  opus(root, "W-15", "done", "2026-10-17T00:00:00Z");
  gate(root, "W-15", "tests", "eeeeeeee", 1, "✖ W-8-b1 behaviour 1: day−13, inside the window\n");
  opus(root, "W-16", "done", "2026-10-16T23:59:59Z");
  gate(root, "W-16", "tests", "ffffffff", 1, "✖ W-8-b2 behaviour 2: day−14, outside the window\n");
  opus(root, "W-18", "done", "2026-10-25T10:00:00Z");
  gate(root, "W-18", "tests", "abababab", 1, "✖ W-8-b3 behaviour 3: inside the window\n");
  opus(root, "W-20", "greenlit");
  opus(root, "W-21", "backlog");
  lesson(root, "L-1", "tests×loop", "W-20");
  lesson(root, "L-2", "spec×owed-b", "W-21");
}

test("W-459-b1 behaviour 1: retro --daily appends the previous UTC day's retro, gate failures classed by their rows' owning opus and the recurring classes with no cause fix listed as owed", () => {
  const root = officina("b1");
  tracker(root, ["2026-10-29"]);
  day(root);
  const before = readFileSync(join(root, "acta/improvements.md"), "utf8");

  const r = daily(root);
  assert.equal(r.status, 0, `retro --daily exits 0: ${shown(r)}`);
  const after = readFileSync(join(root, "acta/improvements.md"), "utf8");
  assert.equal(after.slice(0, before.length), before, `the tracker is appended to, never rewritten: ${shown(r)}`);
  const section = after.slice(before.length);
  assert.deepEqual(section.split("\n").slice(0, 3), ["", `### ${DAY}`, ""], `the section is headed by the previous UTC day: ${section}`);
  assert.ok(r.out.includes(`### ${DAY}`), `the section is printed too: ${shown(r)}`);
  const lines = section.split("\n");
  const has = (line: string, label: string): void => assert.ok(lines.includes(line), `${label}: ${JSON.stringify(line)} in\n${section}`);
  const lacks = (frag: string, label: string): void => assert.ok(!section.includes(frag), `${label}: ${JSON.stringify(frag)} absent from\n${section}`);

  has("| W-10 | 240 | 2 | S1 2, S2 1 |", "the opus done on the day: cycle minutes from its first spec round to its end, failed rounds, blockers by severity");
  lacks("| W-11 |", "an opus done on another day is not in the day's table");
  has("| W-10 | review | 2 | failed | 30 | tests×loop S1 |", "each round of the day, with minutes since the previous round");
  lacks("| W-12 | review |", "a round of another day is not in the day's rounds");
  has("- LOOP W-10 review: class tests×loop, rounds 1-2 (minutes since previous round: r1 -, r2 30)", "a loop: two adjacent failed rounds sharing a class under one brief");
  has("| W-10 | ci/W-10-tests-aaaaaaaa.log | gate×W-7 | W-7-b2 |", "a failing tests log is classed by the owning opus of its failing row");
  has("| W-10 | ci/W-10-types-bbbbbbbb.log | gate×types |  |", "a failing gate log that names no row is classed by its gate");
  lacks("ci/W-10-lint-aaaaaaaa.log", "a passing gate log is not a failure");
  has("- class gate×W-7 seen in 2 opera: W-10, W-11", "a gate class counts across opera done in the window");
  lacks("class gate×types seen", "a class seen in one opus only is not listed");
  lacks("W-13", "an opus done before the window is not counted");
  has("- class gate×W-8 seen in 2 opera: W-15, W-18", "the window is the 14 calendar days from day−13 through day: day−13 counts, day−14 does not");
  has("- class tests×loop seen in 2 opera: W-10, W-12", "a verdict class counts across opera by its round's day");
  has("- class spec×owed-b seen in 2 opera: W-10, W-12", "a log with no # at: (W-14's) is not read");
  has("- OWED class gate×W-7 (W-10, W-11): no lesson of it names a greenlit cause-fix opus in addressed_by", "a recurring class with no lesson is owed");
  has("- OWED class spec×owed-b (W-10, W-12): no lesson of it names a greenlit cause-fix opus in addressed_by", "a recurring class whose lesson names a backlog opus is owed");
  lacks("OWED class tests×loop", "a recurring class whose lesson names a greenlit opus is not owed");

  const again = daily(root);
  assert.equal(again.status, 2, `a second run for the same day is refused: ${shown(again)}`);
  assert.match(again.err, /already holds the daily retro of 2026-10-30/, `the refusal names the day: ${shown(again)}`);
  assert.equal(readFileSync(join(root, "acta/improvements.md"), "utf8"), after, "a refused run writes nothing");

  const none = officina("b1-none");
  const absent = daily(none);
  assert.equal(absent.status, 2, `an officina with no tracker is refused: ${shown(absent)}`);
  assert.match(absent.err, /acta\/improvements\.md: no tracker/, `the refusal names the tracker: ${shown(absent)}`);
  assert.equal(existsSync(join(none, "acta/improvements.md")), false, "and no tracker is created");

  const other = officina("b1-other");
  tracker(other, ["2026-10-29"], "\n## Notes\n\nA later section.\n");
  const misplaced = daily(other);
  assert.equal(misplaced.status, 2, `a tracker whose last section is not the daily retro is refused: ${shown(misplaced)}`);
  assert.match(misplaced.err, /last "## " section is not "## Daily retro"/, `the refusal names the section: ${shown(misplaced)}`);

  const link = officina("b1-link");
  tracker(link, []);
  const real = join(link, "..", "elsewhere.md");
  writeFileSync(real, TRACKER_HEAD);
  rmSync(join(link, "acta/improvements.md"));
  symlinkSync(real, join(link, "acta/improvements.md"));
  const linked = daily(link);
  assert.equal(linked.status, 2, `a tracker reached through a symlink is refused: ${shown(linked)}`);
  assert.equal(readFileSync(real, "utf8"), TRACKER_HEAD, "and its target is not written");

  const flags = officina("b1-flags");
  tracker(flags, []);
  const [log, error] = [console.log, console.error];
  console.error = (): void => undefined;
  console.log = (): void => undefined;
  try {
    assert.equal(runRetro(["--daily", "--cascade", "1", "--studio", flags]).exitCode, 2, "--daily excludes --cascade");
    assert.equal(runRetro(["--daily", "--opus", "W-1", "--studio", flags]).exitCode, 2, "--daily excludes --opus");
    assert.equal(runRetro(["--daily", "--from", "x.json", "--studio", flags]).exitCode, 2, "--daily excludes --from");
  } finally {
    [console.log, console.error] = [log, error];
  }
  assert.equal(readFileSync(join(flags, "acta/improvements.md"), "utf8"), TRACKER_HEAD, "a refused flag combination writes nothing");

  // the record directories: ci/ and opera/ are required, lessons/ absent is no lesson, and a symlinked one is refused
  for (const [dir, label] of [["ci", "an officina with no ci/ directory is refused"], ["opera", "an officina with no opera/ directory is refused"]] as const) {
    const bare = officina(`b1-no-${dir}`);
    tracker(bare, []);
    for (const d of ["ci", "opera", "lessons"]) mkdirSync(join(bare, d), { recursive: true });
    rmSync(join(bare, dir), { recursive: true, force: true });
    const r = daily(bare);
    assert.equal(r.status, 2, `${label}: ${shown(r)}`);
    assert.equal(r.err, `${dir}/: no directory; the daily retro reads its records`, `the refusal names ${dir}/: ${shown(r)}`);
    assert.equal(readFileSync(join(bare, "acta/improvements.md"), "utf8"), TRACKER_HEAD, `${label}, and writes nothing`);
  }
  const linkedLessons = officina("b1-lessons-link");
  tracker(linkedLessons, []);
  day(linkedLessons);
  const elsewhere = join(linkedLessons, "..", "lessons-elsewhere");
  mkdirSync(elsewhere);
  rmSync(join(linkedLessons, "lessons"), { recursive: true, force: true });
  symlinkSync(elsewhere, join(linkedLessons, "lessons"));
  const viaLink = daily(linkedLessons);
  assert.equal(viaLink.status, 2, `a lessons/ reached through a symlink is refused: ${shown(viaLink)}`);
  assert.equal(readFileSync(join(linkedLessons, "acta/improvements.md"), "utf8"), TRACKER_HEAD, "a refused lessons/ writes nothing");
  const noLessons = officina("b1-no-lessons");
  tracker(noLessons, []);
  day(noLessons);
  rmSync(join(noLessons, "lessons"), { recursive: true, force: true });
  const bareRun = daily(noLessons);
  assert.equal(bareRun.status, 0, `an officina with no lessons/ is read as no lesson: ${shown(bareRun)}`);
  assert.ok(bareRun.out.includes("- OWED class tests×loop (W-10, W-12)"), `so every recurring class is owed: ${shown(bareRun)}`);
});

test("W-459-b2 behaviour 2: check warns retro.daily.missing while the tracker has no entry for the previous UTC day, and blocks a tracker it cannot read", () => {
  const root = officina("b2");
  const missing = (r: string, now = NOW): Finding[] => checkStudio(r, now).findings.filter((f) => f.rule === "retro.daily.missing");
  tracker(root, ["2026-10-29"]);
  const warned = missing(root);
  assert.equal(warned.length, 1, `one finding while the previous UTC day has no entry: ${JSON.stringify(warned)}`);
  assert.equal(warned[0]!.level, "advise", "the finding is an advisory, so no in-flight branch's gates fail on the clock");
  assert.equal(warned[0]!.where, "acta/improvements.md", "it names the tracker");
  assert.match(warned[0]!.message, /^no daily retro for 2026-10-30: bisellium retro --daily$/, `it names the day and the verb: ${warned[0]!.message}`);
  assert.deepEqual(missing(root, new Date("2026-10-30T23:59:59Z")), [], "the day before, the previous UTC day (10-29) has its entry");
  assert.equal(missing(root, new Date("2026-10-31T00:00:00Z")).length, 1, "at UTC midnight the day just ended is owed");

  tracker(root, ["2026-10-29", "2026-10-30"]);
  assert.deepEqual(missing(root), [], "an entry for the previous UTC day clears it");
  tracker(root, ["2026-10-29"], "\n## Notes\n\n### 2026-10-30\n");
  assert.equal(missing(root).length, 1, "an entry outside the daily retro section is not one");
  tracker(root, ["2026-10-29"], "\n#### 2026-10-30\n- ### 2026-10-30\n");
  assert.equal(missing(root).length, 1, "a heading of another level or a list line is not an entry");

  const none = officina("b2-none");
  assert.deepEqual(missing(none), [], "an officina with no tracker is not asked for one");

  const dir = officina("b2-dir");
  mkdirSync(join(dir, "acta/improvements.md"), { recursive: true });
  const blocked = missing(dir);
  assert.equal(blocked.length, 1, `a tracker that is not a regular file is one finding: ${JSON.stringify(blocked)}`);
  assert.equal(blocked[0]!.level, "block", "and it blocks: unreadable is never no entry owed");
  assert.match(blocked[0]!.message, /^acta\/improvements\.md: .+$/, `it names the tracker: ${blocked[0]!.message}`);
  // the clock's domain: years 0000-0099 are stepped back as written, never remapped to 1900-1999
  assert.equal(previousUtcDay(new Date("0050-03-01T09:00:00Z")), "0050-02-28", "a year below 100 is not remapped");
});
