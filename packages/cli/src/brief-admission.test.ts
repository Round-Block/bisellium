/**
 * W-127: a brief is admitted with one decree family and a bounded set of
 * numbered behaviours. Behaviours 1-4 drive `runReady` in-process on a copy of
 * examples/sample-studio with `brief_behaviour_limit` set; behaviour 5 drives
 * `checkStudio` on the same copy. Select one behaviour with
 * `--test-name-pattern=behaviour.<n>`. node:test TAP, one describe per
 * behaviour. No timers, no polling.
 *
 * W-140 rows: `--test-name-pattern=W-140-b2` and `W-140-b3` (one top-level test each).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { readBriefAdmission } from "@bisellium/commands/brief-admission.js";
import { EVENTS_LOG_REL } from "@bisellium/core";
import { checkStudio } from "./check.js";
import { runReady } from "./lifecycle.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(HERE, "..", "..", "..", "examples", "sample-studio");
const NOW = new Date("2026-10-05T12:00:00Z");
const BRIEF_REL = "briefs/W-900.md";
/** The sample copy's other active opera name no spec, so the check rows read W-900's findings only (W-161 b6 blocks them). */
const W900 = "opera/W-900.md";

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
  /** Lines inside the real behaviours section, after the last numbered behaviour. */
  inside?: string[];
  /** Lines after "## Out of scope". */
  tail?: string[];
  /** W-161: the lines under the `## Input domain` heading, placed before "## Behaviours to test"; `[]` writes no heading. */
  domain?: string[];
}

const RED = "**Genuine red:**";

/** W-161: the default Input domain section body, the one valid one-row table. */
const DOMAIN = [
  "Each record has one valid domain and one rejecting function; a rejection fails closed.",
  "",
  "| Record | Valid domain | Rejected by |",
  "|---|---|---|",
  "| fixture record | a string | `readFixture` |",
];

function brief(s: BriefSpec = {}): string {
  const reds = s.reds ?? [1, 1];
  const out: string[] = ["# W-900 fixture", "", "## Intent", ""];
  for (const f of s.families ?? ["brief-admission"]) out.push(`Decree family: ${f}`);
  for (const e of s.exceptions ?? []) out.push(`Behaviour limit exception: ${e}`);
  if (s.fencedIntent) out.push("```", ...s.fencedIntent, "```");
  out.push("", "## Files owned", "", "- a.ts", "", "## Interfaces", "", "none", "");
  const domain = s.domain ?? DOMAIN;
  if (domain.length > 0) out.push("## Input domain", "", ...domain, "");
  out.push("## Behaviours to test", "");
  out.push(...(s.before ?? []));
  reds.forEach((k, i) => {
    out.push(`${i + 1}. Behaviour ${i + 1} refuses a thing.`);
    for (let j = 0; j < k; j++) out.push(`   ${RED} row ${i + 1}.${j + 1} fails on its assertion.`);
    out.push(...(s.after?.[i + 1] ?? []));
  });
  if (s.fenced) out.push("```", ...s.fenced, "```");
  out.push(...(s.inside ?? []));
  out.push("", "## Acceptance", "", "green", "", "## Out of scope", "", "none", "", ...(s.tail ?? []));
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
  'numbers 7 behaviours; the limit is 6 (brief_behaviour_limit); split it by decree family, or cite an architect ruling on a "Behaviour limit exception:" line';

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

/** Rewrites the copy's manifest through the yaml Document. */
function editManifest(dir: string, edit: (doc: ReturnType<typeof parseDocument>) => void): void {
  const path = join(dir, "bisellium.yml");
  const doc = parseDocument(readFileSync(path, "utf8"));
  edit(doc);
  writeFileSync(path, doc.toString({ lineWidth: 0 }));
}

describe("behaviour 4", () => {
  const exc = (id: string) => brief({ reds: SEVEN, exceptions: [id] });
  const ruling = (d: string) => decision(d, "D-900", "architect", "Lifted for W-900.");
  test("an architect ruling naming the opus lifts the limit", () => {
    accepted(ready(exc("D-900"), 6, ruling), "valid exception");
  });
  test("a patron decision is refused", () => {
    refused(
      ready(exc("D-900"), 6, (d) => decision(d, "D-900", "patron", "Lifted for W-900.")),
      ['behaviour limit exception: decision "D-900" is by "patron", not "architect"'],
      "patron",
    );
  });
  test("a missing decision is refused", () => {
    refused(ready(exc("D-901"), 6, ruling), ['behaviour limit exception: decision "D-901" not found'], "missing");
  });
  test("an architect ruling that never names the opus is refused", () => {
    refused(
      ready(exc("D-900"), 6, (d) => decision(d, "D-900", "architect", "Lifted for another opus.")),
      ['behaviour limit exception: decision "D-900" does not name W-900'],
      "does not name",
    );
  });
  test("two exception lines are refused", () => {
    refused(
      ready(brief({ reds: SEVEN, exceptions: ["D-900", "D-900"] }), 6, ruling),
      ['has 2 "Behaviour limit exception:" lines; at most one'],
      "two exceptions",
    );
  });
  test("a valid exception does not excuse a missing family", () => {
    refused(ready(brief({ families: [], reds: SEVEN, exceptions: ["D-900"] }), 6, ruling), [NO_FAMILY], "exception without family");
  });
  test("a copy with no design collegium has nobody to grant exceptions", () => {
    refused(
      ready(exc("D-900"), 6, (d) => {
        ruling(d);
        editManifest(d, (doc) => {
          const rows = doc.getIn(["collegia"]) as { items: { get(k: string): unknown }[] };
          const at = rows.items.findIndex((row) => row.get("id") === "design");
          doc.deleteIn(["collegia", at]);
        });
      }),
      ["behaviour limit exception: no design collegium declares a magister"],
      "no design collegium",
    );
  });
  test("the author is the design magister the manifest names, not a hard-coded one", () => {
    accepted(
      ready(exc("D-900"), 6, (d) => {
        decision(d, "D-900", "chief-architect", "Lifted for W-900.");
        editManifest(d, (doc) => {
          const rows = doc.getIn(["collegia"]) as { items: { get(k: string): unknown }[] };
          const at = rows.items.findIndex((row) => row.get("id") === "design");
          doc.setIn(["collegia", at, "magister"], "chief-architect");
        });
      }),
      "renamed magister",
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
    return { admission: found.filter((f) => f.rule === "brief.admission" && f.where === W900), shape: found.filter((f) => f.rule === "manifest.shape") };
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

describe("review round 1", () => {
  const FIX = "W-127-r1";
  test("a fenced decoy heading does not stand in for the real section", () => {
    refused(
      ready(brief({ reds: SEVEN, fencedIntent: ["## Behaviours to test", "", "1. decoy", `   ${RED} decoy`] })),
      [OVER],
      "fenced decoy",
    );
  });
  test("a comment line that looks like a heading does not end the section early", () => {
    // reds [1x7], the comment sits between behaviours 3 and 4
    const lines = brief({ reds: SEVEN }).split("\n");
    const at = lines.findIndex((l) => l.startsWith("4. "));
    lines.splice(at, 0, "<!--", "## Not a heading", "-->");
    refused(ready(lines.join("\n")), [OVER], "comment heading");
  });
  test("numbered lines and markers inside a comment are not counted", () => {
    accepted(ready(brief({ reds: [1, 1], inside: ["<!--", "3. hidden", `   ${RED} one`, `   ${RED} two`, "-->"] })), "comment content");
  });
  test("a repeated real heading is itself a problem", () => {
    refused(
      ready(brief({ tail: ["## Behaviours to test", "", "1. second section", ""] })),
      ['has 2 "## Behaviours to test" headings; one section only'],
      "repeated heading",
    );
  });
  test("a decision naming only a longer id does not name the opus", () => {
    refused(
      ready(brief({ reds: SEVEN, exceptions: ["D-900"] }), 6, (d) => decision(d, "D-900", "architect", "Lifted for W-9001 only.")),
      ['behaviour limit exception: decision "D-900" does not name W-900'],
      "longer id",
    );
    accepted(ready(brief({ reds: SEVEN, exceptions: ["D-900"] }), 6, (d) => decision(d, "D-900", "architect", "Lifted for W-900.")), "whole token");
  });
  test("check returns a finding, not a throw, when collegia is missing, null or not a list", () => {
    for (const bad of [ABSENT, null, "design"]) {
      const dir = studio(6);
      put(dir, BRIEF_REL, brief({ reds: SEVEN, exceptions: ["D-900"] }));
      decision(dir, "D-900", "architect", "Lifted for W-900.");
      opus(dir, "building");
      editManifest(dir, (doc) => (bad === ABSENT ? doc.deleteIn(["collegia"]) : doc.setIn(["collegia"], bad)));
      let findings: ReturnType<typeof checkStudio>["findings"] = [];
      assert.doesNotThrow(() => (findings = checkStudio(dir, NOW).findings), String(bad));
      const found = findings.filter((f) => f.rule === "brief.admission" && f.where === W900);
      assert.deepEqual(
        found.map((f) => f.message),
        [`${BRIEF_REL} behaviour limit exception: no design collegium declares a magister`],
        String(bad),
      );
    }
  });
  test("the exception decision is read once, through the contained read", () => {
    const src = readFileSync(join(HERE, "..", "..", "commands", "src", "lifecycle.ts"), "utf8");
    const at = src.indexOf("export function patronDecisionProblem");
    const body = src.slice(at, src.indexOf("\n}\n", at));
    assert.ok(at > 0 && !/readFront\b/.test(body), "patronDecisionProblem reopens the path with readFront");
  });
  test("readBriefAdmission returns only problems and exception", () => {
    const r = readBriefAdmission(brief({ reds: SEVEN, exceptions: ["D-900"] }), 6);
    assert.deepEqual(Object.keys(r).sort(), ["exception", "problems"], FIX);
  });
});

const ROOT = join(HERE, "..", "..", "..");

test("W-140-b2 behaviour 2: admission's parser is the only behaviour counter in the tree, and the plain-node host loads it", () => {
  const sources: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !entry.name.includes(".test.")) sources.push(child);
    }
  };
  for (const top of ["packages", "adapters", "apps"])
    for (const pkg of readdirSync(join(ROOT, top), { withFileTypes: true }))
      if (pkg.isDirectory() && existsSync(join(ROOT, top, pkg.name, "src"))) walk(`${top}/${pkg.name}/src`);
  walk("scripts");
  const census = sources.filter((rel) => readFileSync(join(ROOT, rel), "utf8").includes("## Behaviours to test")).sort();
  assert.deepEqual(census, ["packages/commands/src/brief-admission.ts"], "b2: the one source holding the section heading");

  const host = readFileSync(join(ROOT, "scripts", "run-builder-host.mjs"), "utf8");
  assert.ok(
    host.split("\n").includes('import { countBehaviours } from "../packages/commands/src/brief-admission.ts";'),
    "b2: the host imports the shared counter",
  );

  const file = pathToFileURL(join(ROOT, "packages", "commands", "src", "brief-admission.ts")).href;
  const comment = "## Behaviours to test\n1. a\n<!--\n2. b\n-->\n";
  const src = `import { countBehaviours } from ${JSON.stringify(file)}; console.log(countBehaviours(${JSON.stringify(comment)}));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", src], { env: { PATH: process.env["PATH"] ?? "" }, encoding: "utf8" });
  assert.equal(run.status, 0, `b2: plain node exits 0 (${run.stderr})`);
  assert.equal(run.stdout.trim(), "1", "b2: the comment row counts 1");
  assert.equal(run.stderr, "", "b2: nothing on stderr");
});

test("W-140-b3 behaviour 3: readBriefAdmission's export is the signed two-argument signature, and exception problems keep their place", () => {
  assert.equal(readBriefAdmission.length, 2, "b3: two parameters");
  const neverCalled = (): void => {
    // @ts-expect-error W-140: the signed signature has no third parameter
    readBriefAdmission("", 6, () => undefined);
  };
  void neverCalled;
  const EXC = 'behaviour limit exception: decision "D-404" not found';
  const noFamily = ready(brief({ families: [], reds: SEVEN, exceptions: ["D-404"] }));
  assert.deepEqual(noFamily.stderr, [NO_FAMILY, EXC].map(line), "b3: family problem, then the exception problem");
  const twice = ready(brief({ reds: SEVEN, exceptions: ["D-404"], inside: ["## Behaviours to test"] }));
  assert.deepEqual(
    twice.stderr,
    [EXC, 'has 2 "## Behaviours to test" headings; one section only'].map(line),
    "b3: the exception problem, then the heading problem",
  );
});

const NO_DOMAIN =
  'declares no input domain; add one "## Input domain" section: a table with "Record", "Valid domain" and "Rejected by" columns, or one line "None: <reason>" if it reads no officina records';
const NO_TABLE = 'input domain has no table with "Record", "Valid domain" and "Rejected by" columns and at least one row';
const MIX = 'input domain mixes "None:" with a table or repeats it; one table or one "None: <reason>" line';
const NOT_CLOSED = "input domain does not say that a rejection fails closed";
const CELL = (k: number): string => `input domain row ${k} has an empty or missing cell`;
const NO_FN = (k: number): string =>
  `input domain row ${k} names no rejecting function; its "Rejected by" cell opens with one \`function\` name`;
const CLOSED = "A rejection fails closed.";
const HEAD = ["| Record | Valid domain | Rejected by |", "|---|---|---|"];
const OKROW = "| fixture record | a string | `readFixture` |";
/** A section body from table lines, with the `fails closed` prose first unless `prose` is false. */
const sect = (rows: string[], head: string[] = HEAD, prose = true): string[] => [...(prose ? [CLOSED, ""] : []), ...head, ...rows];

/** `checkStudio` on a copy with W-900 in `state`, the brief `text` (or none), and the `brief.admission` findings. */
function checked(state: string, text: string | undefined, limit: unknown = 6, opusText?: string) {
  const dir = studio(limit);
  if (text !== undefined) put(dir, BRIEF_REL, text);
  if (opusText === undefined) opus(dir, state);
  else put(dir, "opera/W-900.md", opusText);
  const found = checkStudio(dir, NOW).findings;
  return { admission: found.filter((f) => f.rule === "brief.admission" && f.where === W900), shape: found.filter((f) => f.rule === "manifest.shape"), dir };
}

test("W-161-b1 behaviour 1: a brief with no Input domain section is refused, by ready and by check", () => {
  refused(ready(brief({ domain: [] })), [NO_DOMAIN], "no section");
  accepted(ready(brief()), "default");
  refused(ready(brief({ domain: [], fencedIntent: ["## Input domain", "", ...DOMAIN] })), [NO_DOMAIN], "fenced heading");
  refused(ready(brief({ domain: [], tail: ["<!--", "## Input domain", "", ...DOMAIN, "-->"] })), [NO_DOMAIN], "comment heading");
  refused(ready(brief({ domain: [], tail: ["#### Input domain", "", ...DOMAIN] })), [NO_DOMAIN], "level four heading");
  refused(
    ready(brief({ tail: ["## Input domain", "", ...DOMAIN] })),
    ['has 2 "Input domain" headings; one section only'],
    "two sections",
  );
  const { admission } = checked("building", brief({ domain: [] }));
  assert.equal(admission.length, 1, JSON.stringify(admission));
  assert.equal(admission[0]!.level, "block");
  assert.ok(admission[0]!.message.endsWith(NO_DOMAIN), admission[0]!.message);
  assert.equal(checked("done", brief({ domain: [] })).admission.length, 0, "done opus");
  accepted(ready(brief({ domain: [] }), ABSENT), "no key");
});

test("W-161-b2 behaviour 2: the section holds a three-column table with at least one complete row", () => {
  const none = (domain: string[], label: string): void => refused(ready(brief({ domain })), [NO_TABLE], label);
  none([CLOSED], "prose only");
  none(sect([]), "header, no data row");
  none(sect(["| a | `f` |"], ["| Valid domain | Rejected by |", "|---|---|"]), "two columns");
  none(sect(["| a | b | `f` |"], ["| Record | Domain | Checked by |", "|---|---|---|"]), "other names");
  none(sect(["| a | b | `f` |"], ["| Valid domain | Record | Rejected by |", "|---|---|---|"]), "other order");
  none(sect(["| a | b | `f` | n |"], ["| Record | Valid domain | Rejected by | Note |", "|---|---|---|---|"]), "fourth column");
  const cell = (row: string, label: string): void => refused(ready(brief({ domain: sect([row]) })), [CELL(1)], label);
  cell("|  | a string | `f` |", "empty record");
  cell("| rec |  | `f` |", "empty valid domain");
  cell("| rec | a string |", "one cell fewer");
  accepted(ready(brief({ domain: sect(["| rec | (blocking\\|advisory) | `f` |"]) })), "escaped pipe");
  accepted(ready(brief({ domain: sect([OKROW], ["| Input | Valid domain | Rejected by |", "|---|---|---|"]) })), "Input header");
  accepted(ready(brief({ domain: sect([OKROW], ["| RECORD | VALID DOMAIN | REJECTED BY |", "|---|---|---|"]) })), "upper case");
});

test("W-161-b3 behaviour 3: every row names its one rejecting function", () => {
  refused(ready(brief({ domain: sect([OKROW, "| other | a string | the parser |"]) })), [NO_FN(2)], "prose cell");
  for (const bad of ["see `readOpusVerdicts`", "`containment.test.ts`", "`bisellium check`"])
    refused(ready(brief({ domain: sect([`| rec | a string | ${bad} |`]) })), [NO_FN(1)], bad);
  for (const good of ["`instant` (schema), the one parser", "`readOpusVerdicts(root, id)`", "`schema.instant`"])
    accepted(ready(brief({ domain: sect([`| rec | a string | ${good} |`]) })), good);
});

test("W-161-b4 behaviour 4: a table section says that a rejection fails closed", () => {
  refused(ready(brief({ domain: sect([OKROW], HEAD, false) })), [NOT_CLOSED], "no phrase");
  accepted(ready(brief({ domain: sect(["| rec | a string; Fails closed | `f` |"], HEAD, false) })), "phrase in a cell");
  refused(ready(brief({ domain: sect(["|  | a string | `f` |"], HEAD, false) })), [CELL(1), NOT_CLOSED], "empty cell, no phrase");
});

test("W-161-b5 behaviour 5: a brief that reads no records declares one None line, with a reason, instead of a table", () => {
  accepted(ready(brief({ domain: ["None: docs only, reads no officina records"] })), "None with reason");
  refused(ready(brief({ domain: ["None:"] })), ['input domain "None:" line gives no reason'], "None, no reason");
  refused(ready(brief({ domain: ["None: docs only", "", ...DOMAIN] })), [MIX], "None and a table");
  refused(ready(brief({ domain: ["None: docs only", "None: and more"] })), [MIX], "two None lines");
  refused(ready(brief({ domain: ["None: docs only", "None:"] })), [MIX], "None and an empty None");
  refused(ready(brief({ domain: ["```", "None: docs only", "```"] })), [NO_TABLE], "None in a fence");
});

test("W-161-b6 behaviour 6: check blocks an active opus whose brief it cannot read, instead of skipping admission", () => {
  const front = (spec: string): string =>
    `---\nid: W-900\ntitle: Admission fixture\nkind: feature\ncollegium: engineering\nstate: building\nprobationes: {}\n${spec}---\nbody\n`;
  const missing = checked("building", brief(), 6, front("spec: briefs/W-901.md\n")).admission;
  assert.equal(missing.length, 1, JSON.stringify(missing));
  assert.ok(missing[0]!.message.startsWith("briefs/W-901.md "), missing[0]!.message);
  assert.ok(missing[0]!.message.length > "briefs/W-901.md ".length, "carries the read error");
  const link = studio(6);
  put(link, BRIEF_REL, brief());
  symlinkSync("W-900.md", join(link, "briefs/W-901.md"));
  put(link, "opera/W-900.md", front("spec: briefs/W-901.md\n"));
  const linked = checkStudio(link, NOW).findings.filter((f) => f.rule === "brief.admission" && f.where === W900);
  assert.equal(linked.length, 1, JSON.stringify(linked));
  for (const spec of ["", "spec: 7\n"]) {
    const found = checked("building", brief(), 6, front(spec)).admission;
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]!.message, "active opus names no spec: brief", spec);
  }
  assert.equal(checked("done", brief(), 6, front("spec: briefs/W-901.md\n").replace("state: building", "state: done")).admission.length, 0, "done");
  assert.equal(checked("building", brief(), ABSENT, front("spec: briefs/W-901.md\n")).admission.length, 0, "no key");
  for (const bad of [0, null]) {
    const { admission, shape } = checked("building", brief(), bad, front("spec: briefs/W-901.md\n"));
    assert.equal(admission.length, 0, `limit ${String(bad)}: admission`);
    const mine = shape.filter((f) => f.where === "bisellium.yml#brief_behaviour_limit");
    assert.equal(mine.length, 1, `limit ${String(bad)}: ${JSON.stringify(shape)}`);
    assert.equal(mine[0]!.message, "brief_behaviour_limit must be a positive integer");
  }
});
