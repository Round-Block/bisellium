/**
 * W-127: a brief is admitted with one decree family and a bounded set of
 * numbered behaviours. Behaviours 1-4 drive `runReady` in-process on a copy of
 * examples/sample-studio with `brief_behaviour_limit` set; behaviour 5 drives
 * `checkStudio` on the same copy. Select one behaviour with
 * `--test-name-pattern=behaviour.<n>`. node:test TAP, one describe per
 * behaviour. No timers, no polling.
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL } from "@bisellium/core";
import { checkStudio } from "./check.js";
import { runReady } from "./lifecycle.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(HERE, "..", "..", "..", "examples", "sample-studio");
const NOW = new Date("2026-10-05T12:00:00Z");
const BRIEF_REL = "briefs/W-900.md";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** `limit` standing for a manifest with no `brief_behaviour_limit` key (undefined would take the default). */
const ABSENT = Symbol("absent");

/** A copy of the sample officina with `brief_behaviour_limit` set (or absent). */
function studio(limit: unknown = 6): string {
  const dir = mkdtempSync(join(tmpdir(), "w127-"));
  dirs.push(dir);
  cpSync(SAMPLE, dir, { recursive: true });
  const path = join(dir, "bisellium.yml");
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (limit !== ABSENT) doc.setIn(["brief_behaviour_limit"], limit);
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
  return dir;
}

interface BriefSpec {
  /** `Decree family:` lines in the Intent section. */
  families?: string[];
  /** `Behaviour limit exception:` lines in the Intent section. */
  exceptions?: string[];
  /** Genuine-red markers each numbered behaviour carries; its length is the count. */
  reds?: number[];
  /** Lines under "## Behaviours to test" before item 1. */
  before?: string[];
  /** Lines appended after numbered behaviour i (1-based). */
  after?: Record<number, string[]>;
  /** Lines inside a fenced block under "## Behaviours to test". */
  fenced?: string[];
  /** Lines inside a fenced block in the Intent section. */
  fencedIntent?: string[];
}

const RED = "**Genuine red:**";

function brief(s: BriefSpec = {}): string {
  const reds = s.reds ?? [1, 1];
  const out: string[] = ["# W-900 fixture", "", "## Intent", ""];
  for (const f of s.families ?? ["brief-admission"]) out.push(`Decree family: ${f}`);
  for (const e of s.exceptions ?? []) out.push(`Behaviour limit exception: ${e}`);
  if (s.fencedIntent) out.push("```", ...s.fencedIntent, "```");
  out.push("", "## Files owned", "", "- a.ts", "", "## Interfaces", "", "none", "", "## Behaviours to test", "");
  out.push(...(s.before ?? []));
  reds.forEach((k, i) => {
    out.push(`${i + 1}. Behaviour ${i + 1} refuses a thing.`);
    for (let j = 0; j < k; j++) out.push(`   ${RED} row ${i + 1}.${j + 1} fails on its assertion.`);
    out.push(...(s.after?.[i + 1] ?? []));
  });
  if (s.fenced) out.push("```", ...s.fenced, "```");
  out.push("", "## Acceptance", "", "green", "", "## Out of scope", "", "none", "");
  return out.join("\n");
}

function put(dir: string, rel: string, text: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

function opus(dir: string, state: string, spec = true): void {
  put(
    dir,
    "opera/W-900.md",
    `---\nid: W-900\ntitle: Admission fixture\nkind: feature\ncollegium: engineering\nstate: ${state}\nprobationes: {}\n${spec ? `spec: ${BRIEF_REL}\n` : ""}---\nbody\n`,
  );
}

function decision(dir: string, id: string, by: string, body: string): void {
  put(dir, `decisions/${id}.md`, `---\nid: ${id}\nby: ${by}\n---\n${body}\n`);
}

interface Ran {
  exitCode: number;
  stderr: string[];
  opusBefore: string;
  dir: string;
  eventsSame: boolean;
}

function ready(text: string, limit: unknown = 6, setup?: (dir: string) => void): Ran {
  const dir = studio(limit);
  put(dir, BRIEF_REL, text);
  opus(dir, "greenlit", false);
  setup?.(dir);
  const opusPath = join(dir, "opera/W-900.md");
  const opusBefore = readFileSync(opusPath, "utf8");
  const eventsPath = join(dir, EVENTS_LOG_REL);
  const eventsBefore = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : undefined;
  const errors: string[] = [];
  const err = console.error;
  const log = console.log;
  console.error = (...a: unknown[]) => void errors.push(a.join(" "));
  console.log = () => undefined;
  let exitCode: number;
  try {
    exitCode = runReady(["W-900", "--sella", "architect", "--studio", dir], { now: NOW }).exitCode;
  } finally {
    console.error = err;
    console.log = log;
  }
  const eventsAfter = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : undefined;
  return {
    exitCode,
    stderr: errors.join("\n").split("\n").filter((l) => l.trim().length > 0),
    opusBefore,
    dir,
    eventsSame: eventsBefore === eventsAfter,
  };
}

const line = (problem: string): string => `W-900: brief.admission: ${BRIEF_REL} ${problem}`;

function refused(r: Ran, problems: string[], label: string): void {
  assert.equal(r.exitCode, 1, `${label}: exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.deepEqual(r.stderr, problems.map(line), `${label}: stderr`);
  assert.equal(readFileSync(join(r.dir, "opera/W-900.md"), "utf8"), r.opusBefore, `${label}: opus bytes`);
  assert.ok(r.eventsSame, `${label}: events log`);
}

function accepted(r: Ran, label: string): void {
  assert.equal(r.exitCode, 0, `${label}: exit (stderr ${JSON.stringify(r.stderr)})`);
  assert.equal(readFront<{ state: string }>(join(r.dir, "opera/W-900.md")).data.state, "building", `${label}: state`);
}

const NO_FAMILY = 'declares no decree family; add one line "Decree family: <slug>"';
const TAIL = "each numbered behaviour names exactly one, so number every independent behaviour";
const SEVEN = [1, 1, 1, 1, 1, 1, 1];
const OVER =
  'numbers 7 behaviours; the limit is 6 (brief_behaviour_limit); split it by decree family, or cite a Patron decision on a "Behaviour limit exception:" line';

describe("behaviour 1", () => {
  test("no Decree family line is refused", () => {
    refused(ready(brief({ families: [] })), [NO_FAMILY], "no family");
  });
  test("two Decree family lines are refused", () => {
    refused(
      ready(brief({ families: ["brief-admission", "verdict-grammar"] })),
      ["declares 2 decree families (brief-admission, verdict-grammar); one per brief, file each other family as its own opus"],
      "two families",
    );
  });
  test("a family that is not one slug is refused", () => {
    refused(ready(brief({ families: ["a, b"] })), ['decree family "a, b" is not one slug'], "not a slug");
  });
  test("a Decree family line only inside a fence reads as none", () => {
    refused(ready(brief({ families: [], fencedIntent: ["Decree family: x"] })), [NO_FAMILY], "fenced family");
  });
  test("one family and one marker per behaviour is accepted", () => {
    accepted(ready(brief()), "admitted");
  });
  test("control: the no-family brief is accepted when the officina declares no limit", () => {
    accepted(ready(brief({ families: [] }), ABSENT), "no key");
  });
});

describe("behaviour 2", () => {
  test("seven behaviours over the limit are refused", () => {
    refused(ready(brief({ reds: SEVEN })), [OVER], "seven");
  });
  test("zero numbered behaviours are refused", () => {
    refused(ready(brief({ reds: [] })), ['numbers no behaviours under "## Behaviours to test"'], "zero");
  });
  test("an oversized multi-family brief gives the family line then the count line", () => {
    refused(
      ready(brief({ families: ["brief-admission", "verdict-grammar"], reds: SEVEN })),
      ["declares 2 decree families (brief-admission, verdict-grammar); one per brief, file each other family as its own opus", OVER],
      "multi-family oversized",
    );
  });
  test("a limit of 0 or a non-number is refused with the positive-integer line", () => {
    for (const bad of [0, "six"]) {
      const r = ready(brief(), bad);
      assert.equal(r.exitCode, 1, `limit ${String(bad)}: exit`);
      assert.deepEqual(r.stderr, ["W-900: brief.admission: brief_behaviour_limit must be a positive integer"], `limit ${String(bad)}: stderr`);
      assert.equal(readFileSync(join(r.dir, "opera/W-900.md"), "utf8"), r.opusBefore, `limit ${String(bad)}: opus bytes`);
    }
  });
  test("six behaviours are accepted", () => {
    accepted(ready(brief({ reds: [1, 1, 1, 1, 1, 1] })), "six");
  });
  test("numbered lines inside a fence are not counted", () => {
    accepted(ready(brief({ reds: [1, 1, 1, 1, 1, 1], fenced: ["7. not a behaviour", "8. nor this"] })), "six plus fenced");
  });
});

describe("behaviour 3", () => {
  test("a second marker in an indented bullet is refused", () => {
    refused(
      ready(brief({ reds: [1, 1, 1], after: { 2: [`   - ${RED} hidden second red`] } })),
      [`behaviour 2 names 2 genuine reds; ${TAIL}`],
      "bullet",
    );
  });
  test("a second marker in a table row is refused", () => {
    refused(
      ready(brief({ reds: [1, 1], after: { 1: ["", "   | a | b |", "   | - | - |", `   | ${RED} hidden | y |`] } })),
      [`behaviour 1 names 2 genuine reds; ${TAIL}`],
      "table",
    );
  });
  test("a behaviour with no marker is refused", () => {
    refused(ready(brief({ reds: [1, 1, 0] })), [`behaviour 3 names 0 genuine reds; ${TAIL}`], "none");
  });
  test("a marker before item 1 is refused", () => {
    refused(
      ready(brief({ before: [`${RED} before anything`, ""] })),
      ['has a "**Genuine red:**" outside any numbered behaviour'],
      "before item 1",
    );
  });
  test("markers inside backticks or a fence are not counted; unmarked bullets and tables pass", () => {
    accepted(
      ready(
        brief({
          reds: [1, 1],
          fenced: [`${RED} in a fence`],
          after: {
            1: [`   - the marker is written \`${RED}\` in prose`, "   - a plain bullet", "", "   | a | b |", "   | - | - |", "   | x | y |"],
          },
        }),
      ),
      "backticks, fence, bullets, table",
    );
  });
});

describe("behaviour 4", () => {
  const exc = (id: string) => brief({ reds: SEVEN, exceptions: [id] });
  test("a Patron decision naming the opus lifts the limit", () => {
    accepted(ready(exc("D-900"), 6, (d) => decision(d, "D-900", "patron", "Lifted for W-900.")), "valid exception");
  });
  test("an architect decision is refused", () => {
    refused(
      ready(exc("D-900"), 6, (d) => decision(d, "D-900", "architect", "Lifted for W-900.")),
      ['behaviour limit exception: decision "D-900" is by "architect", not patron "patron"'],
      "architect",
    );
  });
  test("a missing decision is refused", () => {
    refused(ready(exc("D-901"), 6, (d) => decision(d, "D-900", "patron", "W-900")), ['behaviour limit exception: decision "D-901" not found'], "missing");
  });
  test("a Patron decision that never names the opus is refused", () => {
    refused(
      ready(exc("D-900"), 6, (d) => decision(d, "D-900", "patron", "Lifted for another opus.")),
      ['behaviour limit exception: decision "D-900" does not name W-900'],
      "does not name",
    );
  });
  test("two exception lines are refused", () => {
    refused(
      ready(brief({ reds: SEVEN, exceptions: ["D-900", "D-900"] }), 6, (d) => decision(d, "D-900", "patron", "W-900")),
      ['has 2 "Behaviour limit exception:" lines; at most one'],
      "two exceptions",
    );
  });
  test("a valid exception does not excuse a missing family", () => {
    refused(
      ready(brief({ families: [], reds: SEVEN, exceptions: ["D-900"] }), 6, (d) => decision(d, "D-900", "patron", "W-900")),
      [NO_FAMILY],
      "exception without family",
    );
  });
  test("a bogus exception id on an in-limit brief is not read", () => {
    accepted(ready(brief({ reds: [1, 1, 1, 1, 1, 1], exceptions: ["D-404"] })), "bogus exception, in limit");
  });
});

describe("behaviour 5", () => {
  function admission(state: string, limit: unknown = 6, spec = true) {
    const dir = studio(limit);
    put(dir, BRIEF_REL, brief({ reds: SEVEN }));
    opus(dir, state, spec);
    const found = checkStudio(dir, NOW).findings;
    return { admission: found.filter((f) => f.rule === "brief.admission"), shape: found.filter((f) => f.rule === "manifest.shape") };
  }
  for (const state of ["building", "verifying", "review"]) {
    test(`an active opus (${state}) whose brief is over the limit is blocked`, () => {
      const { admission: found } = admission(state);
      assert.equal(found.length, 1, JSON.stringify(found));
      assert.equal(found[0]!.level, "block");
      assert.equal(found[0]!.where, "opera/W-900.md");
      assert.ok(found[0]!.message.startsWith("briefs/W-900.md numbers 7 behaviours; "), found[0]!.message);
    });
  }
  for (const state of ["done", "halted", "greenlit"]) {
    test(`a ${state} opus is left alone`, () => {
      assert.equal(admission(state).admission.length, 0);
    });
  }
  test("no key means no finding", () => {
    assert.equal(admission("building", ABSENT).admission.length, 0);
  });
  test("a limit of 0 is a manifest.shape block and no brief.admission", () => {
    const { admission: found, shape } = admission("building", 0);
    assert.equal(found.length, 0);
    const mine = shape.filter((f) => f.where === "bisellium.yml#brief_behaviour_limit");
    assert.equal(mine.length, 1, JSON.stringify(shape));
    assert.equal(mine[0]!.level, "block");
    assert.equal(mine[0]!.message, "brief_behaviour_limit must be a positive integer");
  });
});
