/**
 * W-131 behaviours 1-3: `verdict` stores findings, not transcripts. Rows are
 * selected by name (`--test-name-pattern=W-131.behaviour.N:`), one failing row
 * per recorded red.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parseVerdictLog } from "@bisellium/commands/verdict.js";
import { runVerdict } from "./verdict.js";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function studio(): string {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w131-verdict-"));
  roots.push(root);
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-131 verdict",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: qa-lead, collegium: engineering, kind: agent }",
      "probationes:",
      "  - { id: review, name: Review, kind: agent }",
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(root, "opera"));
  writeFileSync(
    join(root, "opera", "W-300.md"),
    "---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: engineering\nstate: building\nprobationes: {}\n---\n",
  );
  return root;
}

/** Runs `verdict` on a fresh officina; returns exit code, stderr and whether the log exists. */
function record(body: string, extra: string[] = []): { exitCode: number; stderr: string; written: boolean } {
  const dir = studio();
  const input = join(dir, "input.md");
  writeFileSync(input, body);
  let stderr = "";
  const old = console.error;
  const oldLog = console.log;
  console.error = (...args: unknown[]) => {
    stderr += `${args.map(String).join(" ")}\n`;
  };
  console.log = () => {};
  try {
    const result = runVerdict(
      ["W-300", "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", input, "--studio", dir, ...extra],
      { now: NOW },
    );
    return { exitCode: result.exitCode, stderr, written: existsSync(join(dir, "ci", "W-300-review-1.log")) };
  } finally {
    console.error = old;
    console.log = oldLog;
  }
}

/** A findings-shaped body of exactly `bytes` bytes (padding lives in a second section). */
function findingsBody(bytes: number): string {
  const head = "## Findings\n1. advisory - one - check: packages/cli/src/verdict-findings.test.ts\n\n## Notes\n";
  return head + "x".repeat(bytes - head.length);
}

test("W-131 behaviour 1: verdict caps the body at 8192 bytes", () => {
  const over = record(findingsBody(8193));
  assert.equal(over.exitCode, 2, "an 8193-byte body is refused");
  assert.equal(over.written, false, "a refused body writes no log");
  assert.match(over.stderr, /verdict body is 8193 bytes; the cap is 8192 — record findings, not a transcript/);
  const at = record(findingsBody(8192));
  assert.equal(at.exitCode, 0, at.stderr);
  assert.equal(at.written, true);
});

const CHECKED = "1. blocking - prune deletes a cited log - check: packages/cli/src/prune.test.ts";
const SECTION_REFUSAL = /verdict body needs exactly one "## Findings" section holding numbered findings or the exact line "No findings"/;

test("W-131 behaviour 2: verdict needs exactly one non-empty ## Findings section", () => {
  for (const [name, body] of [
    ["no Findings heading", "Everything looked fine.\n"],
    ["two Findings sections", `## Findings\n${CHECKED}\n\n## Findings\n${CHECKED}\n`],
    ["an empty Findings section", "## Findings\n\n## Notes\nnothing here\n"],
  ] as const) {
    const refused = record(body);
    assert.equal(refused.exitCode, 2, `${name} is refused`);
    assert.equal(refused.written, false, `${name} writes no log`);
    assert.match(refused.stderr, SECTION_REFUSAL, name);
  }
  const clean = record("## Findings\nNo findings\n");
  assert.equal(clean.exitCode, 0, clean.stderr);
  assert.equal(clean.written, true);
});

test("W-131 behaviour 3: every numbered finding names check: <text>", () => {
  for (const [name, body, number] of [
    ["a finding with no check", "## Findings\n1. blocking - prune deletes a cited log\n", "1"],
    ["a second finding with a blank check", `## Findings\n${CHECKED}\n2. advisory - usage omits the cap - check:   \n`, "2"],
  ] as const) {
    const refused = record(body);
    assert.equal(refused.exitCode, 2, `${name} is refused`);
    assert.equal(refused.written, false, `${name} writes no log`);
    assert.match(
      refused.stderr,
      new RegExp(`finding ${number} names no check — end it with "check: <rule id \\| test path \\| none: <missing check>>"`),
      name,
    );
  }
  const accepted = record(`## Findings\n${CHECKED}\n2. advisory - usage omits the cap - check: none: a usage-string pin in verdict.test.ts\n`);
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  assert.equal(accepted.written, true);
});

test("W-131 round 2 finding 3: the existing flag checks run before the body cap", () => {
  const refused = record(findingsBody(8193), ["--dispatch-prompt", "ci/dispatch.md"]);
  assert.equal(refused.exitCode, 2);
  assert.match(refused.stderr, /--dispatch-prompt and --ui-input are UI-only flags/, "the flag error wins over the cap");
  assert.doesNotMatch(refused.stderr, /the cap is 8192/);
});

// ---------------------------------------------------------------------------
// W-215: a reviewer session and a handoff phase (b1); a dispute and earlier findings in the log (b2).
// Rows are selected by name (`--test-name-pattern=W-215-b<n>`), one failing row per recorded red.
// ---------------------------------------------------------------------------
const NO_FINDINGS = "## Findings\nNo findings\n";
const BLOCK = (n: number, text = "stale line"): string => `${n}. blocking — docs/SESSION-HANDOFF.md:${n + 2} ${text} — check: none: probe`;

/** One W-300 officina; `verdict(...)` runs the writer on it and reports the exit, stderr and the files it left in ci/. */
function sequenceStudio(): {
  dir: string;
  verdict: (round: number, extra: string[], body?: string, o?: { sella?: string; outcome?: string }) => { exitCode: number; stderr: string; ci: string[] };
} {
  const dir = studio();
  const verdict = (round: number, extra: string[], body = NO_FINDINGS, o: { sella?: string; outcome?: string } = {}): { exitCode: number; stderr: string; ci: string[] } => {
    const input = join(dir, "input.md");
    writeFileSync(input, body);
    let stderr = "";
    const [oldError, oldLog] = [console.error, console.log];
    console.error = (...args: unknown[]) => {
      stderr += `${args.map(String).join(" ")}\n`;
    };
    console.log = () => {};
    try {
      const result = runVerdict(
        ["W-300", "--round", String(round), "--sella", o.sella ?? "qa-lead", "--outcome", o.outcome ?? "passed", "--from", input, "--studio", dir, ...extra],
        { now: NOW },
      );
      return { exitCode: result.exitCode, stderr, ci: existsSync(join(dir, "ci")) ? readdirSync(join(dir, "ci")).sort() : [] };
    } finally {
      console.error = oldError;
      console.log = oldLog;
    }
  };
  return { dir, verdict };
}
const logOf = (dir: string, name: string): string => readFileSync(join(dir, "ci", name), "utf8");

test("W-215-b1 behaviour 1: a handoff verdict records a session, and a sequence keeps it", () => {
  const { dir, verdict } = sequenceStudio();
  const first = verdict(1, ["--phase", "handoff", "--session", "s-1"]);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.deepEqual(first.ci, ["W-300-handoff-1.log"]);
  const text = logOf(dir, "W-300-handoff-1.log");
  assert.match(text, /^# phase: handoff$/m);
  assert.match(text, /^# session: s-1$/m);
  assert.doesNotMatch(text, /^# brief: /m, "a handoff log pins no brief");

  const swapped = verdict(3, ["--phase", "handoff", "--session", "s-2"]);
  assert.equal(swapped.exitCode, 2, "a different session with no reason is refused");
  assert.deepEqual(swapped.ci, ["W-300-handoff-1.log"], "and writes nothing");
  const replaced = verdict(3, ["--phase", "handoff", "--session", "s-2", "--session-reason", "lost"]);
  assert.equal(replaced.exitCode, 0, replaced.stderr);
  assert.match(logOf(dir, "W-300-handoff-3.log"), /^# session_reason: lost$/m);

  for (const [name, round, extra] of [
    ["no session after a sessioned round", 4, []],
    ["the same session with a reason", 4, ["--session", "s-2", "--session-reason", "again"]],
    ["a round below the sessioned round 3", 2, ["--session", "s-2"]],
  ] as const) {
    const refused = verdict(round, ["--phase", "handoff", ...extra]);
    assert.equal(refused.exitCode, 2, `${name} is refused`);
    assert.deepEqual(refused.ci, ["W-300-handoff-1.log", "W-300-handoff-3.log"], `${name} writes nothing`);
  }

  const own = verdict(5, ["--phase", "handoff", "--session", "s-9"], NO_FINDINGS, { sella: "other-lead" });
  assert.equal(own.exitCode, 0, `another sella starts its own sequence: ${own.stderr}`);
});

test("W-215-b1 behaviour 1: a build sequence keeps its session, and a malformed session or reason is refused", () => {
  const { dir, verdict } = sequenceStudio();
  const first = verdict(1, ["--session", "b-1"]);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.match(logOf(dir, "W-300-review-1.log"), /^# session: b-1$/m);
  const swapped = verdict(2, ["--session", "b-2"]);
  assert.equal(swapped.exitCode, 2);
  assert.deepEqual(swapped.ci, ["W-300-review-1.log"]);

  const fresh = sequenceStudio();
  for (const [name, extra] of [
    ["a blank session", ["--session", ""]],
    ["a spaced session", ["--session", "a b"]],
    ["a two-line session", ["--session", "a\nb"]],
    ["a reason with no session", ["--session-reason", "lost"]],
  ] as const) {
    const refused = fresh.verdict(1, ["--phase", "handoff", ...extra]);
    assert.equal(refused.exitCode, 2, `${name} is refused`);
    assert.deepEqual(refused.ci, [], `${name} writes nothing`);
  }
  const reasoned = fresh.verdict(1, ["--phase", "handoff", "--session", "s-1", "--session-reason", "lost"]);
  assert.equal(reasoned.exitCode, 2, "a reason beside a first session (no predecessor session) is refused");
});

test("W-215-b1 behaviour 1: a kind: ui opus records a session like any other", () => {
  const dir = studio();
  writeFileSync(
    join(dir, "bisellium.yml"),
    readFileSync(join(dir, "bisellium.yml"), "utf8").replace("collegia:", "collegia:\n  - { id: qa, name: QA, magister: qa-lead }"),
  );
  mkdirSync(join(dir, "briefs"));
  mkdirSync(join(dir, "ci"));
  writeFileSync(join(dir, "briefs", "W-280.md"), "# UI brief\n\nBuild the settled interface.\n");
  writeFileSync(join(dir, "ci", "dispatch.md"), "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n");
  writeFileSync(
    join(dir, "opera", "W-280.md"),
    "---\nid: W-280\ntitle: Structured UI input\nkind: ui\ncollegium: engineering\nstate: building\nspec: briefs/W-280.md\nprobationes: {}\n---\n",
  );
  const run = (args: string[], body: string): number => {
    const [oldError, oldLog] = [console.error, console.log];
    console.error = () => {};
    console.log = () => {};
    try {
      return runVerdict(["W-280", ...args, "--studio", dir], { now: NOW, stdin: Buffer.from(body) }).exitCode;
    } finally {
      console.error = oldError;
      console.log = oldLog;
    }
  };
  const spec = [
    "## Findings",
    "No findings",
    "The navigation relationships remain legible across the complete narrow viewport arrangement.",
    "## Recommendation",
    "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.",
    "Additional original observations cover focus movement responsive density and stable content grouping throughout.",
    "Verdict: passed",
    "",
  ].join("\n");
  assert.equal(run(["--phase", "spec", "--round", "1", "--sella", "ui-lead", "--outcome", "passed", "--dispatch-prompt", "ci/dispatch.md"], spec), 0, "the UI spec input is recorded");
  const build = "## Findings\nNo findings\n\n## UI input disposition\n\nThe censor considered the complete ui-lead input and accepted its recommendation.\n";
  const exitCode = run(["--phase", "build", "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--ui-input", "ci/W-280-spec-1.log", "--session", "u-1"], build);
  assert.equal(exitCode, 0, "a UI build verdict records its session");
  assert.match(readFileSync(join(dir, "ci", "W-280-review-1.log"), "utf8"), /^# session: u-1$/m);
});

const FAILED_ROUND = `## Findings\n${BLOCK(1)}\n2. advisory — docs/SESSION-HANDOFF.md:9 minor — check: none: probe\n`;
const EARLIER = "ci/W-300-handoff-1.log";
const withdrawal = (ruling: string): string =>
  `## Findings\n${BLOCK(1)}\n\n## Rebuttal\n1. the line is current — docs/SESSION-HANDOFF.md:3\n\n## Ruling\n${ruling}\n`;

test("W-215-b2 behaviour 2: a withdrawn blocker does not stand, and the exchange has a grammar", () => {
  const withdrawn = parseVerdictLog(
    ["# opus: W-300", "# phase: build", "# round: 2", "# sella: qa-lead", "# outcome: passed", "# session: s-1", "", withdrawal("1. withdrawn — the line is current at docs/SESSION-HANDOFF.md:3"), "## Earlier findings", `- ${EARLIER} #1: closed — fixed at docs/SESSION-HANDOFF.md:3`, ""].join("\n"),
    "W-300",
    "ci/W-300-review-2.log",
  );
  assert.ok(!("error" in withdrawn), "error" in withdrawn ? withdrawn.error : "");
  if ("error" in withdrawn) return;
  assert.equal(withdrawn.findings[0]!.blocking, false, "a withdrawn blocker is not blocking");
  assert.equal(withdrawn.findings[0]!.withdrawn, true);
  assert.deepEqual(
    withdrawn.earlier.map((e) => [e.log, e.n, e.status]),
    [[EARLIER, 1, "closed"]],
  );
  assert.deepEqual(
    withdrawn.rebuttal.map((r) => r.n),
    [1],
  );
  const upheld = parseVerdictLog(
    ["# opus: W-300", "# phase: build", "# round: 2", "# sella: qa-lead", "# outcome: failed", "# session: s-1", "", withdrawal("1. upheld — the guard is absent, see a.ts:4"), ""].join("\n"),
    "W-300",
    "ci/W-300-review-2.log",
  );
  assert.ok(!("error" in upheld) && upheld.findings[0]!.blocking && upheld.findings[0]!.withdrawn === undefined, "an upheld blocker stands");

  const head = ["# opus: W-300", "# phase: build", "# round: 2", "# sella: qa-lead", "# outcome: failed", "# session: s-1", ""];
  const rebuttal = "## Rebuttal\n1. the line is current — docs/SESSION-HANDOFF.md:3\n";
  const ruling = "## Ruling\n1. withdrawn — the line is current\n";
  const findings = `## Findings\n${BLOCK(1)}\n`;
  for (const [name, body, message] of [
    ["a repeated Rebuttal heading", `${findings}\n${rebuttal}\n${rebuttal}\n${ruling}`, /Rebuttal/],
    ["a rebuttal of an unknown finding", `${findings}\n## Rebuttal\n2. no such finding — a.ts:1\n\n## Ruling\n2. withdrawn — x\n`, /2/],
    ["a rebuttal with no file:line", `${findings}\n## Rebuttal\n1. it is fine\n\n${ruling}`, /1/],
    ["a rebuttal with no ruling", `${findings}\n${rebuttal}`, /Ruling|Rebuttal/],
    ["a ruling with no rebuttal", `${findings}\n${ruling}`, /Ruling|Rebuttal/],
    ["a ruling on a finding that was not disputed", `${findings}2. advisory — a.ts:1 nit — check: none: x\n\n${rebuttal}\n## Ruling\n1. withdrawn — x\n2. withdrawn — y\n`, /2/],
    ["an upheld ruling with no file:line", `${findings}\n${rebuttal}\n## Ruling\n1. upheld — I disagree\n`, /1/],
    ["a stray line in a section", `${findings}\n${rebuttal}hello\n\n${ruling}`, /hello/],
    ["an earlier line that is not a verdict", `${findings}\n## Earlier findings\n- ${EARLIER} #1: maybe — x\n`, /maybe|Earlier/],
    ["a reversed earlier line with no file:line", `${findings}\n## Earlier findings\n- ${EARLIER} #1: reversed — it was wrong\n`, /reversed|Earlier|1/],
    ["a repeated earlier finding", `${findings}\n## Earlier findings\n- ${EARLIER} #1: closed — x\n- ${EARLIER} #1: open — y\n`, /#1|Earlier/],
  ] as const) {
    const p = parseVerdictLog([...head, body].join("\n"), "W-300", "ci/W-300-review-2.log");
    assert.ok("error" in p, `${name} is out of domain`);
    if ("error" in p) assert.match(p.error, message, name);
  }
  const open = parseVerdictLog([...head, `${findings}\n${rebuttal}\n## Ruling\n1. open — needs a ruling\n`].join("\n"), "W-300", "ci/W-300-review-2.log");
  assert.ok("error" in open && /Patron/.test(open.error), "an open ruling is not recordable and the message names the Patron");
});

test("W-215-b2 behaviour 2: a log without a session is read as on master, its exchange headings are prose", () => {
  const head = ["# opus: W-300", "# phase: build", "# round: 2", "# sella: qa-lead", "# outcome: failed", ""];
  const plain = parseVerdictLog([...head, withdrawal("1. withdrawn — the line is current at docs/SESSION-HANDOFF.md:3")].join("\n"), "W-300", "ci/W-300-review-2.log");
  assert.ok(!("error" in plain), "error" in plain ? plain.error : "");
  if ("error" in plain) return;
  assert.equal(plain.findings[0]!.blocking, true, "a free-form ruling withdraws nothing without a session");
  assert.equal(plain.findings[0]!.withdrawn, undefined);
  assert.deepEqual([plain.earlier, plain.rebuttal], [[], []]);
  // W-209-spec-10's shape: the heading before ## Findings, prose lines under it
  const freeForm = parseVerdictLog([...head, "Signed.", "", "## Rebuttal", "1. accepted — the title is false", "", `## Findings\n${BLOCK(1)}`, ""].join("\n"), "W-300", "ci/W-300-spec-10.log");
  assert.ok(!("error" in freeForm), "error" in freeForm ? freeForm.error : "");
  if (!("error" in freeForm)) assert.equal(freeForm.findings[0]!.blocking, true);
});

test("W-215-b2 behaviour 2: the writer accounts for every earlier blocker and every standing finding", () => {
  const { dir, verdict } = sequenceStudio();
  const session = ["--phase", "handoff", "--session", "s-1"];
  const r1 = verdict(1, session, FAILED_ROUND, { outcome: "failed" });
  assert.equal(r1.exitCode, 0, r1.stderr);

  const closed = `- ${EARLIER} #1: closed — fixed at docs/SESSION-HANDOFF.md:3`;
  for (const [name, body] of [
    ["omits the earlier line", NO_FINDINGS],
    ["adds an earlier line for an advisory finding", `${NO_FINDINGS}\n## Earlier findings\n${closed}\n- ${EARLIER} #2: closed — x\n`],
    ["adds an earlier line for an unknown finding", `${NO_FINDINGS}\n## Earlier findings\n${closed}\n- ci/W-300-handoff-9.log #1: closed — x\n`],
  ] as const) {
    const refused = verdict(2, session, body);
    assert.equal(refused.exitCode, 2, `round 2 that ${name} is refused`);
    assert.deepEqual(refused.ci, ["W-300-handoff-1.log"], `${name}: nothing is written`);
  }
  const open = verdict(2, session, `${NO_FINDINGS}\n## Earlier findings\n- ${EARLIER} #1: open — still stale at docs/SESSION-HANDOFF.md:3\n`);
  assert.equal(open.exitCode, 2, "an open earlier line beside passed is refused");
  const exact = verdict(2, session, `${NO_FINDINGS}\n## Earlier findings\n${closed}\n`);
  assert.equal(exact.exitCode, 0, exact.stderr);
  assert.match(logOf(dir, "W-300-handoff-2.log"), /## Earlier findings/);

  const still = sequenceStudio();
  assert.equal(still.verdict(1, session, FAILED_ROUND, { outcome: "failed" }).exitCode, 0);
  const stillFailing = still.verdict(2, session, `## Findings\n${BLOCK(1, "still stale")}\n\n## Earlier findings\n- ${EARLIER} #1: open — still stale at docs/SESSION-HANDOFF.md:3\n`, { outcome: "failed" });
  assert.equal(stillFailing.exitCode, 0, `an open earlier line beside failed is recorded: ${stillFailing.stderr}`);

  const alone = sequenceStudio();
  const passedByRuling = alone.verdict(1, session, withdrawal("1. withdrawn — the line is current at docs/SESSION-HANDOFF.md:3"));
  assert.equal(passedByRuling.exitCode, 0, `a passed whose only blocker was withdrawn writes: ${passedByRuling.stderr}`);
  const failedNothing = sequenceStudio().verdict(1, session, withdrawal("1. withdrawn — the line is current at docs/SESSION-HANDOFF.md:3"), { outcome: "failed" });
  assert.equal(failedNothing.exitCode, 2, "failed with nothing standing is refused");
  const failedUnstanding = sequenceStudio().verdict(1, session, NO_FINDINGS, { outcome: "failed" });
  assert.equal(failedUnstanding.exitCode, 2, "failed with no finding is refused");
  const odd = sequenceStudio().verdict(1, session, NO_FINDINGS, { outcome: "PASS" });
  assert.equal(odd.exitCode, 2, "a sessioned outcome is exactly passed or failed");
  const openRuling = sequenceStudio().verdict(1, session, withdrawal("1. open — only the Patron can rule"), { outcome: "failed" });
  assert.equal(openRuling.exitCode, 2, "an open ruling cannot be recorded");
  assert.match(openRuling.stderr, /Patron/);
  assert.deepEqual(openRuling.ci, []);
});

// W-246 build review round 1: a spec verdict's outcome is decided after the session's rulings are applied.
test("W-246-r1 a sessioned spec review whose only cited blocker is withdrawn is recorded passed", () => {
  const brief = (): ReturnType<typeof sequenceStudio> => {
    const s = sequenceStudio();
    mkdirSync(join(s.dir, "briefs"));
    writeFileSync(join(s.dir, "briefs", "W-300.md"), "# Brief\n\nline three\nline four\n");
    return s;
  };
  const session = ["--phase", "spec", "--session", "s-1"];
  const blocker = "1. blocking — brief:3 the guard is absent — check: none: probe";
  const ruled = (ruling: string): string => `## Findings\n${blocker}\n\n## Rebuttal\n1. the line is current — docs/SESSION-HANDOFF.md:3\n\n## Ruling\n${ruling}\n`;

  const w = brief();
  const withdrawn = w.verdict(1, session, ruled("1. withdrawn — the line is current at docs/SESSION-HANDOFF.md:3"), { outcome: "failed" });
  assert.equal(withdrawn.exitCode, 0, `failed with its only cited blocker withdrawn is recorded: ${withdrawn.stderr}`);
  assert.match(logOf(w.dir, "W-300-spec-1.log"), /^# outcome: passed$/m);
  assert.match(logOf(w.dir, "W-300-spec-1.log"), /^# submitted_outcome: failed$/m);

  const upheld = brief();
  assert.equal(upheld.verdict(1, session, ruled("1. upheld — the guard is absent, see a.ts:4"), { outcome: "failed" }).exitCode, 0);
  assert.match(logOf(upheld.dir, "W-300-spec-1.log"), /^# outcome: failed$/m, "an upheld cited blocker still fails the round");
  assert.doesNotMatch(logOf(upheld.dir, "W-300-spec-1.log"), /submitted_outcome/);

  const plain = brief();
  assert.equal(plain.verdict(1, session, `## Findings\n${blocker}\n`, { outcome: "failed" }).exitCode, 0);
  assert.match(logOf(plain.dir, "W-300-spec-1.log"), /^# outcome: failed$/m, "a cited blocker with no ruling still fails the round");

  // a round that also leaves an earlier blocker open cannot pass: still refused, nothing written
  const open = brief();
  assert.equal(open.verdict(1, session, `## Findings\n${blocker}\n`, { outcome: "failed" }).exitCode, 0);
  const stillOpen = open.verdict(2, session, `${ruled("1. withdrawn — the line is current at docs/SESSION-HANDOFF.md:3")}\n## Earlier findings\n- ci/W-300-spec-1.log #1: open — still absent at a.ts:4\n`, { outcome: "failed" });
  assert.equal(stillOpen.exitCode, 2, "an open earlier blocker keeps the round from passing");
  assert.deepEqual(stillOpen.ci, ["W-300-spec-1.log"]);
});

// W-215 build review round 1: the separator and the citation boundary are classes, not instances.
// Rows are selected by name (`--test-name-pattern=W-215-r1-<n>`).
const R1_HEAD = ["# opus: W-300", "# phase: build", "# round: 2", "# sella: qa-lead", "# outcome: failed", "# session: s-1", ""];
const r1Parse = (body: string) => parseVerdictLog([...R1_HEAD, body].join("\n"), "W-300", "ci/W-300-review-2.log");

test("W-215-r1-1 separator: ` - ` with one space on each side is accepted wherever ` — ` is", () => {
  const findings = `## Findings\n${BLOCK(1)}\n`;
  const rebuttal = "## Rebuttal\n1. the line is current - docs/SESSION-HANDOFF.md:3\n";
  for (const [name, body] of [
    ["a withdrawn ruling", `${findings}\n${rebuttal}\n## Ruling\n1. withdrawn - the line is current\n`],
    ["an upheld ruling", `${findings}\n${rebuttal}\n## Ruling\n1. upheld - the guard is absent, see a.ts:4\n`],
    ["a closed earlier line", `${findings}\n## Earlier findings\n- ${EARLIER} #1: closed - fixed at docs/SESSION-HANDOFF.md:3\n`],
    ["an open earlier line", `${findings}\n## Earlier findings\n- ${EARLIER} #1: open - still stale\n`],
    ["a reversed earlier line", `${findings}\n## Earlier findings\n- ${EARLIER} #1: reversed - wrong at docs/SESSION-HANDOFF.md:3\n`],
  ] as const) {
    const p = r1Parse(body);
    assert.ok(!("error" in p), `${name}: ${"error" in p ? p.error : ""}`);
  }
  const doubled = r1Parse(`${findings}\n${rebuttal}\n## Ruling\n1. withdrawn  - the line is current\n`);
  assert.ok("error" in doubled, "two spaces before the hyphen is not the grammar");
});

test("W-215-r1-2 citation: a token is bounded on its right by a non-word character", () => {
  const findings = `## Findings\n${BLOCK(1)}\n`;
  const cited = (text: string): string => `1. ${text}`;
  for (const [name, body] of [
    ["a rebuttal", `${findings}\n## Rebuttal\n${cited("fine at a.ts:4junk")}\n\n## Ruling\n1. withdrawn — x\n`],
    ["an upheld ruling", `${findings}\n## Rebuttal\n${cited("fine at a.ts:4")}\n\n## Ruling\n1. upheld — absent at a.ts:4junk\n`],
    ["a reversed earlier line", `${findings}\n## Earlier findings\n- ${EARLIER} #1: reversed — wrong at a.ts:4junk\n`],
  ] as const) {
    assert.ok("error" in r1Parse(body), `${name} with a.ts:4junk is out of domain`);
  }
  for (const text of ["see (a.ts:4)", "see a.ts:4.", "see a.ts:4, and more", "see a.ts:4"]) {
    const p = r1Parse(`${findings}\n## Rebuttal\n${cited(text)}\n\n## Ruling\n1. withdrawn — x\n`);
    assert.ok(!("error" in p), `${text}: ${"error" in p ? p.error : ""}`);
  }
});

// ---------------------------------------------------------------------------
// W-297 (D-085 C, D-086 A and C): the tags a spec or build finding carries, refused before anything is written.
// ---------------------------------------------------------------------------
test("W-297-b1 behaviour 1: verdict refuses a build finding without a severity, a blocker tagged S2-S4 and a spec blocker without a design tag", () => {
  /** One verdict on a fresh W-300 officina that holds a brief; the exit, stderr and whether a log was written. */
  const tagged = (body: string, phase: "spec" | "build" | "handoff", outcome: string): { exitCode: number; stderr: string; written: boolean } => {
    const dir = studio();
    mkdirSync(join(dir, "briefs"));
    writeFileSync(join(dir, "briefs", "W-300.md"), "# Brief\n\nline three\nline four\n");
    const input = join(dir, "input.md");
    writeFileSync(input, body);
    let stderr = "";
    const [oldError, oldLog] = [console.error, console.log];
    console.error = (...args: unknown[]) => {
      stderr += `${args.map(String).join(" ")}\n`;
    };
    console.log = () => {};
    try {
      const r = runVerdict(["W-300", "--round", "1", "--sella", "qa-lead", "--outcome", outcome, "--phase", phase, "--from", input, "--studio", dir], { now: NOW });
      return { exitCode: r.exitCode, stderr, written: existsSync(join(dir, "ci")) && readdirSync(join(dir, "ci")).length > 0 };
    } finally {
      console.error = oldError;
      console.log = oldLog;
    }
  };
  const body = (...lines: string[]): string => `## Findings\n${lines.map((l, i) => `${i + 1}. ${l} — check: none: probe`).join("\n")}\n`;
  const refused = (name: string, b: string, phase: "spec" | "build", outcome: string, problems: string[]): void => {
    const r = tagged(b, phase, outcome);
    assert.equal(r.exitCode, 2, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, false, `${name}: no log is written`);
    assert.equal(r.stderr, problems.map((p) => `W-300: finding tags: ${p}\n`).join(""), `${name}: stderr`);
  };
  const recorded = (name: string, b: string, phase: "spec" | "build" | "handoff", outcome: string): void => {
    const r = tagged(b, phase, outcome);
    assert.equal(r.exitCode, 0, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, true, `${name}: the log is written`);
  };
  const NO_SEVERITY = (n: number): string => `finding ${n} has no [severity: S1|S2|S3|S4] tag; every build finding carries one (D-085 C)`;
  const NOT_S1 = (n: number, s: number): string => `finding ${n} is blocking and tagged [severity: S${s}]; only an S1 blocks: reissue it as advisory, or fix the tag (D-086 C)`;
  const NO_DESIGN = (n: number): string => `finding ${n} is a blocking spec finding with no [design: changes|keeps] tag; it carries exactly one (D-086 A)`;

  // a build finding carries one severity tag
  refused("a build advisory with no severity", body("advisory — a.ts:3 a nit"), "build", "passed", [NO_SEVERITY(1)]);
  refused("a build blocker with no severity", body("blocking — brief:3 the guard is absent"), "build", "failed", [NO_SEVERITY(1)]);
  for (const form of ["[severity: s1]", "[severity:S1]", "[Severity: S1]", "[severity: S5]", "(severity: S1)", "severity: S1", "[severity: S1 ]"])
    refused(`the form ${form}`, body(`advisory — a.ts:3 a nit ${form}`), "build", "passed", [NO_SEVERITY(1)]);
  refused("two severity tags", body("advisory — a.ts:3 [severity: S4] a nit [severity: S4]"), "build", "passed", ["finding 1 carries 2 [severity:] tags; one only"]);
  // a blocker tagged S2, S3 or S4 is refused, in a build or a spec round, never downgraded
  for (const s of [2, 3, 4]) {
    refused(`a build blocker tagged S${s}`, body(`blocking — brief:3 the guard is absent [severity: S${s}]`), "build", "failed", [NOT_S1(1, s)]);
    refused(`a spec blocker tagged S${s}`, body(`blocking — brief:3 the guard is absent [severity: S${s}] [design: keeps]`), "spec", "failed", [NOT_S1(1, s)]);
  }
  // a blocking spec finding carries exactly one design tag
  refused("a spec blocker with no design tag", body("blocking — brief:3 the guard is absent [severity: S1]"), "spec", "failed", [NO_DESIGN(1)]);
  for (const form of ["[design: keep]", "[design:keeps]", "[Design: keeps]", "[design: changed]"])
    refused(`the design form ${form}`, body(`blocking — brief:3 the guard is absent ${form}`), "spec", "failed", [NO_DESIGN(1)]);
  refused("two design tags", body("blocking — brief:3 the guard is absent [design: keeps] [design: changes]"), "spec", "failed", ["finding 1 is a blocking spec finding with 2 [design: changes|keeps] tags; it carries exactly one (D-086 A)"]);
  // every problem, in finding order
  refused(
    "three findings, three problems",
    body("advisory — a.ts:3 a nit", "blocking — brief:3 the guard is absent [severity: S3]", "advisory — a.ts:4 [severity: S2] fine"),
    "build",
    "failed",
    [NO_SEVERITY(1), NOT_S1(2, 3)],
  );
  refused("a spec blocker tagged S2 with no design tag", body("blocking — brief:3 absent [severity: S2]"), "spec", "failed", [NOT_S1(1, 2), NO_DESIGN(1)]);

  // what is recorded
  for (const s of [1, 2, 3, 4]) recorded(`a build advisory tagged S${s}`, body(`advisory — a.ts:3 a nit [severity: S${s}] [class: tests×probe]`), "build", "passed");
  recorded("a build blocker tagged S1", body("blocking — brief:3 the guard is absent [severity: S1] [class: tests×probe]"), "build", "failed");
  recorded("a bold build blocker tagged S1", body("**blocking** — brief:3 the guard is absent [severity: S1]"), "build", "failed");
  recorded("a build round with no findings", "## Findings\nNo findings\n", "build", "passed");
  recorded("a spec blocker that keeps the design", body("blocking — brief:3 the guard is absent [severity: S1] [design: keeps]"), "spec", "failed");
  recorded("a spec blocker that changes the design", body("blocking — brief:3 [design: changes] the guard is absent"), "spec", "failed");
  recorded("a spec advisory with no tag", body("advisory — brief:3 a nit"), "spec", "passed");
  recorded("a handoff finding with no tag", body("advisory — docs/SESSION-HANDOFF.md:3 a nit"), "handoff", "passed");
});
