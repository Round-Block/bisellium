/**
 * W-126: a blocking verdict finding cites a line of the opus's declared brief,
 * or the writer records it as advisory. Behaviours 1-3 drive `runVerdict`,
 * behaviour 4 `runReview`, both in-process on a minimal officina. Select one
 * with `--test-name-pattern=behaviour.<n>`. node:test TAP, one describe per
 * behaviour. No timers, no polling.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { parseVerdictHeader } from "@bisellium/commands/opus-model.js";
import { ruledCases } from "@bisellium/commands/brief-admission.js";
import { runReview } from "./lifecycle.js";
import { runVerdict } from "./verdict.js";
import { USAGE } from "@bisellium/commands/usage.js";
// W-306: a namespace import, so on a writer without usageVerbs the row fails at an assertion, never at load
import * as verdictModule from "@bisellium/commands/verdict.js";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Ten lines, newline-terminated, line 4 blank. */
const BRIEF = `${Array.from({ length: 10 }, (_, i) => (i === 3 ? "" : `brief line ${i + 1}`)).join("\n")}\n`;

interface Options {
  /** The opus's `spec:` value; `false` omits the key. */
  spec?: string | false;
  /** Write briefs/W-300.md. */
  brief?: boolean;
  state?: string;
  /** Put the officina in a `studio/` directory of a git repository. */
  git?: boolean | "root";
}

function studio(o: Options = {}): string {
  const { spec = "briefs/W-300.md", brief = true, state = "building", git = false } = o;
  const base = mkdtempSync(join(tmpdir(), "bisellium-w126-"));
  roots.push(base);
  const root = git === true ? join(base, "studio") : base;
  if (git) {
    if (git === true) mkdirSync(root);
    for (const args of [["init", "-q", "-b", "main"], ["config", "user.email", "fixture@example.invalid"], ["config", "user.name", "Fixture"]])
      execFileSync("git", args, { cwd: base, stdio: "ignore" });
    writeFileSync(join(base, "source.txt"), "clean\n");
  }
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-126 citation",
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
    `---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: engineering\nstate: ${state}\n${spec === false ? "" : `spec: ${spec}\n`}probationes: {}\n---\n`,
  );
  if (brief) {
    mkdirSync(join(root, "briefs"));
    writeFileSync(join(root, "briefs", "W-300.md"), BRIEF);
  }
  if (git) {
    execFileSync("git", ["add", "."], { cwd: base, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: base, stdio: "ignore" });
  }
  return root;
}

function capture<T>(run: () => T): { result: T; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const [log, error] = [console.log, console.error];
  console.log = (...args: unknown[]) => void (stdout += `${args.map(String).join(" ")}\n`);
  console.error = (...args: unknown[]) => void (stderr += `${args.map(String).join(" ")}\n`);
  try {
    return { result: run(), stdout, stderr };
  } finally {
    [console.log, console.error] = [log, error];
  }
}

interface Recorded {
  exitCode: number;
  stdout: string;
  stderr: string;
  header: Map<string, string>;
  /** The header's keys in file order. */
  keys: string[];
  /** The header lines, before the blank line. */
  headerLines: string[];
  /** The bytes after the header's blank line. */
  body: string;
}

function verdict(dir: string, body: string, outcome = "passed", extra: string[] = []): Recorded {
  const input = join(dir, "input.md");
  writeFileSync(input, body);
  const { result, stdout, stderr } = capture(() =>
    runVerdict(["W-300", "--round", "1", "--sella", "qa-lead", "--outcome", outcome, "--from", input, "--studio", dir, ...extra], { now: NOW }),
  );
  const phase = extra.includes("spec") ? "spec" : "review";
  const log = join(dir, "ci", `W-300-${phase}-1.log`);
  const raw = existsSync(log) ? readFileSync(log, "utf8") : "";
  const parsed = parseVerdictHeader(raw);
  return { exitCode: result.exitCode, stdout, stderr, header: parsed.values, keys: [...parsed.values.keys()], headerLines: raw === "" ? [] : raw.slice(0, raw.indexOf("\n\n")).split("\n"), body: raw.slice(raw.indexOf("\n\n") + 2) };
}

/** A findings-shaped body: one numbered line per entry, each ending in a check. */
function findings(...lines: string[]): string {
  return `## Findings\n${lines.map((line, i) => `${i + 1}. ${line} [severity: S1] [design: changes] — check: none: x`).join("\n")}\n`;
}

const BLOB = `blob:${createHash("sha1").update(`blob ${Buffer.byteLength(BRIEF)}\0`).update(BRIEF).digest("hex")}`;

describe("behaviour 1", () => {
  test("a blocking finding that cites no brief line is recorded as advisory, with its reason", () => {
    const body = findings(
      "blocking — packages/x.ts:3 the writer drops a line",
      "advisory — the usage line is long",
      "BLOCKING — brief:2 the first behaviour is missing",
      "**Blocking** — briefs/W-300.md:5 the second behaviour is missing",
    );
    const dir = studio();
    const r = verdict(dir, body);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("brief"), `briefs/W-300.md ${BLOB}`);
    assert.equal(r.header.get("converted"), "1 (cites no line of briefs/W-300.md)");
    assert.equal(r.header.get("outcome"), "passed");
    assert.equal(r.header.has("submitted_outcome"), false);
    assert.deepEqual(r.keys.slice(-3), ["tree", "brief", "converted"]);
    assert.equal(r.body, body, "body exact");
    assert.match(r.stdout, /^W-300: finding 1 recorded as advisory: cites no line of briefs\/W-300\.md$/m);
  });

  test("a body with only advisory findings gets # brief: and no # converted:", () => {
    const r = verdict(studio(), findings("advisory — packages/x.ts:3 a nit", "advisory — another"));
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("brief"), `briefs/W-300.md ${BLOB}`);
    assert.equal(r.header.has("converted"), false);
  });

  test("the same four-finding body in the spec phase gets # brief: and the same # converted:", () => {
    const body = findings("blocking — packages/x.ts:3 a", "advisory — b", "BLOCKING — brief:2 c", "**Blocking** — briefs/W-300.md:5 d");
    const r = verdict(studio(), body, "passed", ["--phase", "spec"]);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("brief"), `briefs/W-300.md ${BLOB}`);
    assert.equal(r.header.get("converted"), "1 (cites no line of briefs/W-300.md)");
  });
});

describe("behaviour 2", () => {
  const rows: [string, string, string | RegExp][] = [
    ["a brief that is not the declared one", "briefs/W-301.md:2", "cites briefs/W-301.md, not the declared brief briefs/W-300.md"],
    ["an absolute path", "/home/x/studio/briefs/W-300.md:2", "cites /home/x/studio/briefs/W-300.md, not the declared brief briefs/W-300.md"],
    ["a line past the end", "brief:11", "briefs/W-300.md has 10 lines, no line 11"],
    ["a blank line", "brief:4", "briefs/W-300.md:4 is blank"],
    ["the first citation's reason when a later one is also bad", "brief:11 then briefs/W-301.md:2", "briefs/W-300.md has 10 lines, no line 11"],
  ];
  for (const [name, cite, reason] of rows)
    test(`${name} is converted`, () => {
      const r = verdict(studio(), findings(`blocking — a defect, ${cite}`));
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.header.get("converted"), `1 (${reason})`);
    });

  test("no spec: the finding is converted and no # brief: is written", () => {
    const r = verdict(studio({ spec: false, brief: false }), findings("blocking — a defect, brief:2"));
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("converted"), "1 (the opus declares no readable brief: no spec)");
    assert.equal(r.header.has("brief"), false);
  });

  test("a spec naming a missing file: the finding is converted and no # brief: is written", () => {
    const r = verdict(studio({ spec: "briefs/missing.md", brief: false }), findings("blocking — a defect, brief:2"));
    assert.equal(r.exitCode, 0, r.stderr);
    assert.match(r.header.get("converted") ?? "", /^1 \(the opus declares no readable brief: \S/);
    assert.equal(r.header.has("brief"), false);
  });

  const stays: [string, string][] = [
    ["the last line", "brief:10"],
    ["the first line", "briefs/W-300.md:1"],
    ["a bad citation then a good one", "briefs/W-301.md:2 then brief:3"],
  ];
  for (const [name, cite] of stays)
    test(`${name} keeps the finding blocking`, () => {
      const r = verdict(studio(), findings(`blocking — a defect, ${cite}`));
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.header.has("converted"), false);
    });

  test("the officina's repo-relative path keeps the finding blocking", () => {
    const r = verdict(studio({ git: true }), findings("blocking — a defect, studio/briefs/W-300.md:3"));
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.has("converted"), false);
  });
});

describe("behaviour 3", () => {
  const UNCITED = "blocking — packages/x.ts:3 the writer drops a line";
  const CITED = "blocking — brief:2 the first behaviour is missing";
  const ADVISORY = "advisory — the usage line is long";

  for (const raw of ["failed", "FAIL", "VERDICT: FAIL — x"])
    test(`${raw} with every blocking finding converted is recorded as passed`, () => {
      const body = findings(UNCITED, ADVISORY);
      const r = verdict(studio(), body, raw);
      assert.equal(r.exitCode, 0, r.stderr);
      assert.equal(r.header.get("outcome"), "passed");
      assert.equal(r.header.get("submitted_outcome"), raw);
      assert.deepEqual(r.keys.slice(r.keys.indexOf("outcome"), r.keys.indexOf("outcome") + 2), ["outcome", "submitted_outcome"]);
      assert.equal(r.body, body, "body exact");
      assert.match(r.stdout, new RegExp(`^W-300: outcome "${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" recorded as passed: no blocking finding cites a line of the brief$`, "m"));
    });

  test("failed with one uncited and one valid blocker stays failed", () => {
    const r = verdict(studio(), findings(UNCITED, CITED), "failed");
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("outcome"), "failed");
    assert.match(r.header.get("converted") ?? "", /^1 \(/);
    assert.equal(r.header.has("submitted_outcome"), false);
  });

  test("failed with only advisory findings stays failed", () => {
    const r = verdict(studio(), findings(ADVISORY), "failed");
    assert.equal(r.header.get("outcome"), "failed");
    assert.equal(r.header.has("submitted_outcome"), false);
  });

  test("passed with a valid blocker stays passed", () => {
    const r = verdict(studio(), findings(CITED), "passed");
    assert.equal(r.header.get("outcome"), "passed");
    assert.equal(r.header.has("submitted_outcome"), false);
  });

  test("a spec-phase failed outcome with an uncited blocker is recorded passed", () => {
    const r = verdict(studio(), findings(UNCITED), "failed", ["--phase", "spec"]);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("outcome"), "passed");
    assert.equal(r.header.get("submitted_outcome"), "failed");
  });
});

describe("behaviour 4", () => {
  const FAIL_ARGS = ["W-300", "--fail", "--evidence", "ci/W-300-review-1.log", "--round", "1", "--sella", "qa-lead"];
  const REFUSAL =
    "W-300: review --fail: ci/W-300-review-1.log records outcome passed; every blocking finding was recorded as advisory (see its # converted line). Record a new verdict round whose blocking finding cites a brief line.";

  /** An officina with W-300 at review and a verdict log recorded by the writer. */
  function reviewed(body: string, outcome: string): string {
    const dir = studio({ state: "review" });
    const r = verdict(dir, body, outcome);
    assert.equal(r.exitCode, 0, r.stderr);
    return dir;
  }

  function review(dir: string, args: string[]): { exitCode: number; stderr: string } {
    const { result, stderr } = capture(() => runReview([...args, "--studio", dir], { now: NOW }));
    return { exitCode: result.exitCode, stderr };
  }

  const eventsPath = (dir: string): string => join(dir, ".bisellium", "events.jsonl");
  const eventsOf = (dir: string): string => (existsSync(eventsPath(dir)) ? readFileSync(eventsPath(dir), "utf8") : "");

  test("--fail refuses a log whose failure was reconciled away", () => {
    const dir = reviewed(findings("blocking — packages/x.ts:3 the writer drops a line", "advisory — a nit"), "failed");
    const opus = readFileSync(join(dir, "opera", "W-300.md"), "utf8");
    const events = eventsOf(dir);
    const r = review(dir, FAIL_ARGS);
    assert.equal(r.exitCode, 2, r.stderr);
    assert.equal(r.stderr.trim(), REFUSAL);
    assert.equal(readFileSync(join(dir, "opera", "W-300.md"), "utf8"), opus, "opus bytes unchanged");
    assert.equal(eventsOf(dir), events, "no event written");
  });

  test("--pass with the same log is accepted", () => {
    const dir = reviewed(findings("blocking — packages/x.ts:3 the writer drops a line"), "failed");
    const r = review(dir, ["W-300", "--pass", "--evidence", "ci/W-300-review-1.log", "--round", "1", "--sella", "qa-lead"]);
    assert.equal(r.exitCode, 0, r.stderr);
  });

  test("--fail with a log whose failure kept a valid blocker is accepted", () => {
    const dir = reviewed(findings("blocking — brief:2 the first behaviour is missing"), "failed");
    const r = review(dir, FAIL_ARGS);
    assert.equal(r.exitCode, 0, r.stderr);
  });

  test("--fail with a pre-W-126 log written by hand is accepted", () => {
    const dir = studio({ state: "review" });
    mkdirSync(join(dir, "ci"));
    writeFileSync(
      join(dir, "ci", "W-300-review-1.log"),
      `# opus: W-300\n# phase: build\n# round: 1\n# sella: qa-lead\n# outcome: FAIL\n# at: 2026-10-01T12:00:00.000Z\n# tree: unknown\n\n${findings("blocking — packages/x.ts:3 the writer drops a line")}`,
    );
    const r = review(dir, FAIL_ARGS);
    assert.equal(r.exitCode, 0, r.stderr);
  });
});

test("W-348-b3 behaviour 3: on a kind ui opus the configured UI signer alone owes the promise ledger, while the design magister and reviewer do not", () => {
  const dir = studio();
  const manifest = join(dir, "bisellium.yml");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8")
      .replace("collegia:\n", "collegia:\n  - { id: design, name: Design, magister: architect }\n  - { id: qa, name: QA, magister: qa-lead }\n")
      .replace("sellae:\n", "sellae:\n  - { id: architect, collegium: design, kind: agent, model: claude-opus-5-5, harness: claude-code }\n  - { id: ui-architect, collegium: design, kind: agent, model: gpt-5.6-sol, harness: codex }\n  - { id: ui-spec-reviewer, collegium: qa, kind: agent, model: claude-opus-5-5, harness: claude-code }\n") +
      "ui_spec_signer: ui-architect\nui_spec_reviewer: ui-spec-reviewer\n",
  );
  writeFileSync(join(dir, "opera", "W-300.md"), readFileSync(join(dir, "opera", "W-300.md"), "utf8").replace("kind: feature", "kind: ui"));
  writeFileSync(join(dir, "briefs", "W-300.md"), LEDGER_BRIEF);
  const ledgerPath = join(dir, "promise-ledger.md");
  writeFileSync(ledgerPath, COVERING);
  const log = join(dir, "ci", "W-300-spec-1.log");
  let input = 0;
  const sign = (sella: string, body: string): { exit: number; stderr: string; written: boolean } => {
    const from = join(dir, `w348-${++input}.md`);
    writeFileSync(from, body);
    const r = capture(() => runVerdict(["W-300", "--round", "1", "--sella", sella, "--outcome", "passed", "--phase", "spec", "--from", from, "--studio", dir], { now: NOW }));
    const written = existsSync(log);
    if (written) rmSync(log);
    return { exit: r.result.exitCode, stderr: r.stderr, written };
  };
  const no = "## Findings\nNo findings\n";
  const missing = sign("ui-architect", no);
  assert.equal(missing.exit, 2, `the UI signer without a ledger is refused: ${missing.stderr}`);
  assert.match(missing.stderr, /promise ledger/, "the refusal names the promise ledger");
  assert.equal(missing.written, false, "the refused signature writes no log");

  const covered = sign("ui-architect", `Promise ledger: ${ledgerPath}\n\n${no}`);
  assert.equal(covered.exit, 0, `the UI signer with a covering ledger signs: ${covered.stderr}`);
  assert.equal(covered.written, true, "the signature is written");
  for (const seat of ["architect", "ui-spec-reviewer"]) {
    const other = sign(seat, no);
    assert.equal(other.exit, 0, `${seat} owes no signer ledger: ${other.stderr}`);
    assert.equal(other.written, true, `${seat}'s plain spec verdict is written`);
  }
});

describe("review round 1 rows", () => {
  test("a git-root officina does not admit an absolute citation", () => {
    const dir = studio({ git: "root" });
    const absolute = verdict(dir, findings("blocking — a defect, /briefs/W-300.md:3"));
    assert.equal(absolute.exitCode, 0, absolute.stderr);
    assert.equal(absolute.header.get("converted"), "1 (cites /briefs/W-300.md, not the declared brief briefs/W-300.md)");
    const relative = verdict(studio({ git: "root" }), findings("blocking — a defect, briefs/W-300.md:3"));
    assert.equal(relative.header.has("converted"), false, "the declared path still cites");
  });

  const INJECT = "\n# submitted_outcome: failed";
  const SHAPE = /^# [a-z_]+: /;

  test("a readable brief at a path with a line break is still read and cited, and cannot inject or end the header", () => {
    const spec = `briefs/W-300.md${INJECT}`;
    const fixture = (state: string): string => {
      const dir = studio({ spec: JSON.stringify(spec), brief: false, state });
      mkdirSync(join(dir, "briefs"));
      writeFileSync(join(dir, spec), BRIEF);
      return dir;
    };
    const body = findings("blocking — brief:2 a cited defect");
    const dir = fixture("review");
    const r = verdict(dir, body, "failed");
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("outcome"), "failed");
    assert.equal(r.header.has("converted"), false);
    assert.equal(r.header.has("submitted_outcome"), false);
    assert.ok(r.headerLines.every((line) => SHAPE.test(line)), r.headerLines.join("|"));
    assert.equal(r.keys.length, r.headerLines.length, "no header key is written twice");
    assert.equal(r.body, body, "body exact");
    const reviewed = capture(() =>
      runReview(["W-300", "--fail", "--evidence", "ci/W-300-review-1.log", "--round", "1", "--sella", "qa-lead", "--studio", dir], { now: NOW }),
    );
    assert.equal(reviewed.result.exitCode, 0, reviewed.stderr);
    const uncited = verdict(fixture("building"), findings("blocking — packages/x.ts:3 an uncited defect"), "passed");
    assert.ok(uncited.headerLines.every((line) => SHAPE.test(line)), uncited.headerLines.join("|"));
    assert.equal(uncited.keys.length, uncited.headerLines.length, "no header key is written twice");
    assert.equal(uncited.header.has("submitted_outcome"), false);
    assert.match(uncited.header.get("converted") ?? "", /^1 \(cites no line of briefs\/W-300\.md\\n# submitted_outcome: failed\)$/);
  });

  test("a missing spec path with a line break keeps its read error on one line", () => {
    const spec = `briefs/missing.md${INJECT}`;
    const body = findings("blocking — brief:2 a defect");
    const dir = studio({ spec: JSON.stringify(spec), brief: false });
    mkdirSync(join(dir, "briefs"));
    const r = verdict(dir, body, "passed");
    assert.equal(r.exitCode, 0, r.stderr);
    assert.ok(r.headerLines.every((line) => SHAPE.test(line)), r.headerLines.join("|"));
    assert.match(r.header.get("converted") ?? "", /^1 \(the opus declares no readable brief: \S/);
    assert.equal(r.header.has("submitted_outcome"), false);
    assert.equal(r.body, body, "body exact");
  });
});

// W-306: the design magister's spec signature cites a promise ledger that covers every caller its brief names in code
const LEDGER_BRIEF = [
  "# W-300 fixture brief",
  "## Intent",
  "After this, `ready` refuses the brief and `next` orders the architect.",
  "Files owned: `packages/cli/src/next.ts` and `bisellium red W-300 --behaviour 1 -- node x`.",
  "`check` blocks it; `ready` again.",
  "",
].join("\n");
const NEXT_ENTRY = "brief:3, next, orders the architect: NX:20 — scoped";
const COVERING = ["brief:3, ready, refuses: packages/x.ts:10 — holds", NEXT_ENTRY, "brief:5, check and ready: CK:30 — holds"].join("\n");

test("W-306-b1 behaviour 1: an architect spec signature cites a promise ledger covering every caller its brief names, or verdict refuses", () => {
  const dir = studio();
  const manifest = join(dir, "bisellium.yml");
  const base = readFileSync(manifest, "utf8");
  const DESIGN = "  - { id: design, name: Design, magister: drafter }\n";
  const withDesign = (rows: string): string => base.replace("collegia:\n", `collegia:\n${rows}`);
  writeFileSync(manifest, withDesign(DESIGN));
  assert.ok(readFileSync(manifest, "utf8").includes(DESIGN), "the manifest names drafter as the design magister");
  writeFileSync(join(dir, "briefs", "W-300.md"), LEDGER_BRIEF);
  const log = join(dir, "ci", "W-300-spec-1.log");
  let n = 0;
  const sign = (body: string, sella = "drafter"): { exitCode: number; stderr: string; written: boolean } => {
    const input = join(dir, `input-${++n}.md`);
    writeFileSync(input, body);
    const r = capture(() => runVerdict(["W-300", "--round", "1", "--sella", sella, "--outcome", "passed", "--phase", "spec", "--from", input, "--studio", dir], { now: NOW }));
    const written = existsSync(log);
    if (written) rmSync(log);
    return { exitCode: r.result.exitCode, stderr: r.stderr, written };
  };
  const ledger = (text: string): string => {
    const p = join(dir, `ledger-${++n}.md`);
    writeFileSync(p, text);
    return p;
  };
  const refused = (name: string, body: string, stderr: string, sella = "drafter"): void => {
    const r = sign(body, sella);
    assert.equal(r.exitCode, 2, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, false, `${name}: no log is written`);
    assert.equal(r.stderr, stderr, `${name}: stderr`);
  };
  const admitted = (name: string, body: string, sella = "drafter"): void => {
    const r = sign(body, sella);
    assert.equal(r.exitCode, 0, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, true, `${name}: the log is written`);
  };
  const NO = findings("advisory — fine");
  const cite = (text: string): string => `Promise ledger: ${ledger(text)}\n\n${NO}`;
  const MISSING = 'W-300: promise ledger: briefs/W-300.md names a CLI verb in code on lines 3, 5; cite the promise ledger on one line above "## Findings": "Promise ledger: <absolute path>"\n';
  const uncovered = (line: number, verb: string): string => `W-300: promise ledger: brief:${line} names \`${verb}\`, and no ledger line cites brief:${line} with ${verb}, a <file>:<line> and holds or scoped\n`;

  refused("no ledger line", NO, MISSING);
  refused("the ledger line under Findings", `${NO}Promise ledger: ${ledger(COVERING)}\n`, MISSING);
  const trailing = NO.replace("## Findings\n", "## Findings   \n");
  refused("the ledger line under a Findings heading with trailing spaces", `${trailing}Promise ledger: ${ledger(COVERING)}\n`, MISSING);
  // W-275: the ledger reader finds this heading, but next's reader does not, so the writer refuses the log
  refused("a covering ledger above a Findings heading with trailing spaces", `Promise ledger: ${ledger(COVERING)}\n\n${trailing}`, 'W-300: not a spec log next can read: ci/W-300-spec-1.log: expected exactly one "## Findings" heading, found 0\n');
  const two = ledger(COVERING);
  refused("two ledger lines", `Promise ledger: ${two}\nPromise ledger: ${two}\n\n${NO}`, 'W-300: promise ledger: 2 "Promise ledger:" lines above "## Findings"; one only\n');
  refused("a relative path", `Promise ledger: ledger.md\n\n${NO}`, 'W-300: promise ledger: "ledger.md" is not an absolute or ~/ path\n');
  refused("a missing file", `Promise ledger: ${join(dir, "absent.md")}\n\n${NO}`, `W-300: promise ledger: ${join(dir, "absent.md")} is not a readable regular file\n`);
  refused("one caller uncovered", cite(COVERING.replace(`${NEXT_ENTRY}\n`, "")), uncovered(3, "next"));
  for (const [name, entry] of [
    ["no status", NEXT_ENTRY.replace(" — scoped", "")],
    ["no <file>:<line>", NEXT_ENTRY.replace("NX:20", "next.ts")],
    ["brief:3x", NEXT_ENTRY.replace("brief:3,", "brief:3x,")],
    ["brief:3.5", NEXT_ENTRY.replace("brief:3,", "brief:3.5,")],
    ["NX:20x", NEXT_ENTRY.replace("NX:20", "NX:20x")],
    ["NX:20.5", NEXT_ENTRY.replace("NX:20", "NX:20.5")],
    ["brief:3-5", NEXT_ENTRY.replace("brief:3,", "brief:3-5,")],
    ["NX:20/notes", NEXT_ENTRY.replace("NX:20", "NX:20/notes")],
    ["next.ts for the verb", NEXT_ENTRY.replace("next,", "next.ts,")],
  ] as const)
    refused(`an entry with ${name}`, cite(COVERING.replace(NEXT_ENTRY, entry)), uncovered(3, "next"));
  refused("an empty ledger", cite(""), uncovered(3, "ready") + uncovered(3, "next") + uncovered(5, "check") + uncovered(5, "ready"));
  admitted("a covering ledger", cite(COVERING));
  admitted("another seat's spec verdict with no ledger (architect is not this officina's design magister)", NO, "architect");
  admitted("another seat's spec verdict with no ledger", NO, "qa-lead");

  // the design magister is read strictly: no design row means architect; a duplicate or a blank magister refuses every spec verdict
  writeFileSync(manifest, base);
  refused("no design row: architect is the magister", NO, MISSING, "architect");
  writeFileSync(manifest, withDesign(DESIGN + DESIGN));
  refused("two design rows", NO, "W-300: bisellium.yml#collegia declares the design collegium 2 times; exactly one row names the magister\n", "qa-lead");
  for (const bad of ['""', '"  "', "3"]) {
    writeFileSync(manifest, withDesign(`  - { id: design, name: Design, magister: ${bad} }\n`));
    refused(`a design magister ${bad}`, cite(COVERING), "W-300: bisellium.yml#collegia: the design row's magister must be a nonblank string\n");
  }
  writeFileSync(manifest, base.replace(/collegia:\n(?: {2}- .*\n)+/, "collegia: none\n"));
  assert.ok(readFileSync(manifest, "utf8").includes("collegia: none\nsellae:"), "the manifest's collegia is not a list");
  refused("collegia not a list", NO, "W-300: bisellium.yml#collegia must be a list\n", "qa-lead");
  writeFileSync(manifest, withDesign(DESIGN));
  writeFileSync(join(dir, "briefs", "W-300.md"), BRIEF);
  admitted("a brief naming no verb in code needs no ledger", NO);

  // the verbs come from the usage text, one whole command per line, or the reader refuses
  const { usageVerbs } = verdictModule;
  const real = usageVerbs(USAGE);
  assert.ok("verbs" in real && ["check", "ready", "next", "verdict", "hook-event"].every((v) => real.verbs.has(v)), `the usage text's verbs: ${JSON.stringify(real)}`);
  assert.deepEqual(usageVerbs("usage: bisellium check [dir]\n       bisellium new-verb <x>\n"), { verbs: new Set(["check", "new-verb"]) });
  for (const [name, text, line] of [
    ["a token with a digit", "usage: bisellium check\n       bisellium v2 <x>\n", 2],
    ["a line with two commands", "usage: bisellium check or bisellium next\n", 1],
    ["a line with no command", "usage: bisellium check\n       see the docs\n", 2],
  ] as const)
    assert.deepEqual(usageVerbs(text), { error: `usage line ${line} does not name exactly one command "bisellium <[a-z][a-z-]*>"` }, name);
});

// W-319: the same ledger covers every Input domain row (a reader) with a brief:<n>, a <file>:<line> and holds or scoped
const ROWS_BRIEF = [
  "# W-300 fixture brief",
  "## Input domain",
  "A rejection fails closed.",
  "| Record | Valid domain | Rejected by |",
  "|---|---|---|",
  // W-322: each row names its pinning test row and assertion
  '| the flag | a string | `parseFlag`: exit 2, pinned by `W-300-b1` "exit 2" |',
  '| the file | a regular file | `readIt`: exit 2, pinned by `W-300-b1` "exit 2" |',
  "",
  "| a second table | not | read |",
  "|---|---|---|",
  "| its row | is not | a row |",
  "## Behaviours to test",
  "| after the section | is not | a row |",
  "",
].join("\n");
const ROW_7 = "brief:7, the file: packages/x.ts:12 readIt exits 2 — scoped";
const ROWS_COVERING = ["brief:6, the flag: packages/x.ts:5 parseFlag exits 2 — holds", ROW_7].join("\n");

test("W-319-b1 behaviour 1: an architect spec signature's ledger covers every Input domain row, or verdict refuses", () => {
  const dir = studio();
  writeFileSync(join(dir, "briefs", "W-300.md"), ROWS_BRIEF);
  assert.ok(readFileSync(join(dir, "briefs", "W-300.md"), "utf8").startsWith("# W-300 fixture brief\n## Input domain\n"), "the brief is the rows fixture");
  const log = join(dir, "ci", "W-300-spec-1.log");
  let n = 0;
  const sign = (body: string, sella = "architect"): { exitCode: number; stderr: string; written: boolean } => {
    const input = join(dir, `input-${++n}.md`);
    writeFileSync(input, body);
    const r = capture(() => runVerdict(["W-300", "--round", "1", "--sella", sella, "--outcome", "passed", "--phase", "spec", "--from", input, "--studio", dir], { now: NOW }));
    const written = existsSync(log);
    if (written) rmSync(log);
    return { exitCode: r.result.exitCode, stderr: r.stderr, written };
  };
  const ledger = (text: string): string => {
    const p = join(dir, `ledger-${++n}.md`);
    writeFileSync(p, text);
    return p;
  };
  const refused = (name: string, body: string, stderr: string, sella = "architect"): void => {
    const r = sign(body, sella);
    assert.equal(r.exitCode, 2, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, false, `${name}: no log is written`);
    assert.equal(r.stderr, stderr, `${name}: stderr`);
  };
  const admitted = (name: string, body: string, sella = "architect"): void => {
    const r = sign(body, sella);
    assert.equal(r.exitCode, 0, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, true, `${name}: the log is written`);
  };
  const NO = findings("advisory — fine");
  const cite = (text: string): string => `Promise ledger: ${ledger(text)}\n\n${NO}`;
  const row = (line: number): string => `W-300: promise ledger: brief:${line} is an Input domain row, and no ledger line cites brief:${line} with a <file>:<line> and holds or scoped\n`;

  refused("no ledger line", NO, 'W-300: promise ledger: briefs/W-300.md has Input domain rows on lines 6, 7; cite the promise ledger on one line above "## Findings": "Promise ledger: <absolute path>"\n');
  refused("one row uncovered", cite(ROWS_COVERING.replace(ROW_7, "")), row(7));
  for (const [name, entry] of [
    ["no status", ROW_7.replace(" — scoped", "")],
    ["no <file>:<line>", ROW_7.replace("packages/x.ts:12", "packages/x.ts")],
    ["brief:7x", ROW_7.replace("brief:7,", "brief:7x,")],
    ["brief:7-9", ROW_7.replace("brief:7,", "brief:7-9,")],
    ["a range for its <file>:<line>", ROW_7.replace("packages/x.ts:12", "packages/x.ts:12-14")],
  ] as const)
    refused(`a row entry with ${name}`, cite(ROWS_COVERING.replace(ROW_7, entry)), row(7));
  refused("an empty ledger", cite(""), row(6) + row(7));
  admitted("a ledger covering both rows", cite(ROWS_COVERING));
  admitted("another seat's spec verdict with no ledger", NO, "qa-lead");

  // with a promise line too, the missing citation names both, and the verb pairs come before the rows
  writeFileSync(join(dir, "briefs", "W-300.md"), ROWS_BRIEF.replace("A rejection fails closed.", "A rejection fails closed; `ready` refuses."));
  refused("a verb line and rows, no ledger line", NO, 'W-300: promise ledger: briefs/W-300.md names a CLI verb in code on lines 3 and has Input domain rows on lines 6, 7; cite the promise ledger on one line above "## Findings": "Promise ledger: <absolute path>"\n');
  refused("a ledger covering only the verb", cite("brief:3, ready, refuses: packages/x.ts:1 — holds"), row(6) + row(7));
  refused("a ledger covering only the rows", cite(ROWS_COVERING), "W-300: promise ledger: brief:3 names `ready`, and no ledger line cites brief:3 with ready, a <file>:<line> and holds or scoped\n");

  // no table, a "None:" line, or a table in a fence or a comment: no row
  for (const [name, text] of [
    ["no Input domain section", "# W-300 fixture brief\n## Intent\nNothing.\n"],
    ["a None: line", "# W-300 fixture brief\n## Input domain\nNone: it reads no records.\n"],
    ["a table in a fence", ROWS_BRIEF.replace("| Record |", "```\n| Record |").replace("## Behaviours", "```\n## Behaviours")],
    ["a table in a comment", ROWS_BRIEF.replace("| Record |", "<!--\n| Record |").replace("## Behaviours", "-->\n## Behaviours")],
  ] as const) {
    writeFileSync(join(dir, "briefs", "W-300.md"), text);
    admitted(`${name}: no ledger needed`, NO);
  }
});

// W-322: every ruled case names the test row and assertion that pin it; the design magister's signature is refused otherwise
/** The W-319-b1 sign, ledger, refused and admitted steps for one brief, on a fresh officina with no design row. */
function specSigner(brief: string): {
  refused: (name: string, body: string, stderr: string) => void;
  admitted: (name: string, body: string, sella?: string) => void;
  cite: (text: string) => string;
  setBrief: (text: string) => void;
  NO: string;
} {
  const dir = studio();
  const setBrief = (text: string): void => {
    writeFileSync(join(dir, "briefs", "W-300.md"), text);
    assert.equal(readFileSync(join(dir, "briefs", "W-300.md"), "utf8"), text, "the brief rewrite took");
  };
  setBrief(brief);
  const log = join(dir, "ci", "W-300-spec-1.log");
  let n = 0;
  const sign = (body: string, sella: string): { exitCode: number; stderr: string; written: boolean } => {
    const input = join(dir, `input-${++n}.md`);
    writeFileSync(input, body);
    const r = capture(() => runVerdict(["W-300", "--round", "1", "--sella", sella, "--outcome", "passed", "--phase", "spec", "--from", input, "--studio", dir], { now: NOW }));
    const written = existsSync(log);
    if (written) rmSync(log);
    return { exitCode: r.result.exitCode, stderr: r.stderr, written };
  };
  const NO = findings("advisory — fine");
  const cite = (text: string): string => {
    const p = join(dir, `ledger-${++n}.md`);
    writeFileSync(p, text);
    return `Promise ledger: ${p}\n\n${NO}`;
  };
  const refused = (name: string, body: string, stderr: string): void => {
    const r = sign(body, "architect");
    assert.equal(r.exitCode, 2, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, false, `${name}: no log is written`);
    assert.equal(r.stderr, stderr, `${name}: stderr`);
  };
  const admitted = (name: string, body: string, sella = "architect"): void => {
    const r = sign(body, sella);
    assert.equal(r.exitCode, 0, `${name}: exit (stderr ${JSON.stringify(r.stderr)})`);
    assert.equal(r.written, true, `${name}: the log is written`);
  };
  return { refused, admitted, cite, setBrief, NO };
}
const uncoveredRow = (line: number): string =>
  `W-300: promise ledger: brief:${line} is an Input domain row, and no ledger line cites brief:${line} with a <file>:<line> and holds or scoped\n`;

const PIN_6 = 'pinned by `W-300-b1` "flag: exit 2"';
const PINS_BRIEF = [
  "# W-300 fixture brief",
  "## Input domain",
  "A rejection fails closed.",
  "| Record | Valid domain | Rejected by |",
  "|---|---|---|",
  `| the flag | a string | \`parseFlag\`: exit 2, ${PIN_6} |`,
  '| the file | a regular file | `readIt`: exit 2, Pinned by `W-300-b1` "file: exit 2" and pinned by `W-300-b2` "no log" |',
  "| the job | its step exits 0 | runner: `gates` fails the merge; unpinned |",
  "## Behaviours to test",
  "",
].join("\n");
const ROW_8 = "brief:8, the job: .github/workflows/ci.yml:20 gates — scoped";
const PINS_COVERING = ["brief:6, the flag: packages/x.ts:5 parseFlag exits 2 — holds", "brief:7, the file: packages/x.ts:12 readIt exits 2 — holds", ROW_8].join("\n");

test("W-322-b1 behaviour 1: an architect spec signature is refused for an Input domain row that names no pinning test row and assertion", () => {
  const { refused, admitted, cite, setBrief, NO } = specSigner(PINS_BRIEF);
  const noPin = (line: number): string =>
    `W-300: promise ledger: brief:${line} is an Input domain row with no pin: name the test row and assertion that exercise it as pinned by \`<row>\` "<assertion>", or say unpinned (a stated limit, scoped in the ledger)\n`;
  const notScoped = (line: number): string => `W-300: promise ledger: brief:${line} says unpinned, and no ledger line cites brief:${line} as scoped\n`;

  // the row with no pin, and each malformed pin, is refused at that row; every other row stands
  for (const [name, pin] of [
    ["no pin", ""],
    ["no backticks round the row", 'pinned by W-300-b1 "flag: exit 2"'],
    ["no quotes round the assertion", "pinned by `W-300-b1` flag: exit 2"],
    ["an empty assertion", 'pinned by `W-300-b1` ""'],
    ["a blank row name", 'pinned by ` ` "flag: exit 2"'],
    ["a word run into it", 'repinned by `W-300-b1` "flag: exit 2"'],
    ["the pin in an HTML comment", `<!-- ${PIN_6} -->`],
  ] as const) {
    setBrief(PINS_BRIEF.replace(PIN_6, pin));
    refused(`row 6 with ${name}`, cite(PINS_COVERING), noPin(6));
  }
  setBrief(PINS_BRIEF.replace(PIN_6, "").replace(/, Pinned by .*" \|$/m, " |"));
  refused("rows 6 and 7 with no pin, in row order", cite(PINS_COVERING), noPin(6) + noPin(7));
  refused("an uncovered row with no pin: its coverage problem, then its pin problem", cite(PINS_COVERING.replace("brief:7,", "brief:70,")), uncoveredRow(7) + noPin(6) + noPin(7));

  // unpinned is a stated limit: its covering ledger line says scoped
  setBrief(PINS_BRIEF);
  refused("an unpinned row covered as holds", cite(PINS_COVERING.replace(ROW_8, ROW_8.replace("scoped", "holds"))), notScoped(8));
  refused("an unpinned row covered by no line: the W-319 problem only", cite(PINS_COVERING.replace(ROW_8, "")), uncoveredRow(8));
  refused("an empty ledger: coverage only, the pins stand", cite(""), uncoveredRow(6) + uncoveredRow(7) + uncoveredRow(8));
  admitted("every row pinned or unpinned and scoped, two pins on one row, a capital P", cite(PINS_COVERING));
  setBrief(PINS_BRIEF.replace(PIN_6, `${PIN_6} (an ordinary edit: a comment after it)`));
  admitted("a pin followed by prose", cite(PINS_COVERING));
  setBrief(PINS_BRIEF.replace(PIN_6, ""));
  admitted("another seat's spec verdict needs no pin", NO, "qa-lead");
});

const GRAMMAR_BRIEF = [
  "# W-300 fixture brief",
  "## Interfaces",
  '- a static `import` from the runner, pinned by `W-300-b1` "static import"',
  '- a free `require` call, pinned by `W-300-b1` "require call"',
  '- a dynamic `import(` call, pinned by `W-300-b1` "dynamic import"',
  "## Input domain",
  "A rejection fails closed.",
  "| Record | Valid domain | Rejected by |",
  "|---|---|---|",
  '| the source | any text; recognises the forms on brief:3-4 and brief:5; every other form is a limit | `count`: never errors, pinned by `W-300-b1` "counts" |',
  '| the name | any string; recognises `a-z` and `0-9`, every other form a limit | `name`: exit 2, pinned by `W-300-b2` "name" |',
  '| the file | a regular file | `readIt`: exit 2 on any text it cannot decode, pinned by `W-300-b3` "file" |',
  "## Behaviours to test",
  "",
].join("\n");
const SOURCE_DOMAIN = "any text; recognises the forms on brief:3-4 and brief:5; every other form is a limit";
const GRAMMAR_COVERING = [10, 11, 12].map((n) => `brief:${n}, a reader: packages/x.ts:${n} exits 2 — holds`).join("\n");

test("W-322-b2 behaviour 2: a row ruling any text or any string lists the forms it recognises, each cited grammar line pinned, or the signature is refused", () => {
  const { refused, admitted, cite, setBrief } = specSigner(GRAMMAR_BRIEF);
  const grammar = (line: number, row: number): string =>
    `W-300: promise ledger: brief:${line} is a grammar line brief:${row} recognises, with no pin: name its test row and assertion as pinned by \`<row>\` "<assertion>"\n`;
  const formless = (row: number): string =>
    `W-300: promise ledger: brief:${row} rules any text or any string and lists no forms: say "recognises", then the forms (code spans, or brief:<line> citations of the lines that list them), then "every other form" and "limit"\n`;
  const ledger = cite(GRAMMAR_COVERING);

  // each line a forms clause cites, singly or in a range, holds its own pin; unpinned does not excuse a grammar line
  for (const [name, from, to, line] of [
    ["the range's first line", 'pinned by `W-300-b1` "static import"', "", 3],
    ["the range's last line", 'pinned by `W-300-b1` "require call"', "unpinned", 4],
    ["a single citation", 'pinned by `W-300-b1` "dynamic import"', "", 5],
  ] as const) {
    setBrief(GRAMMAR_BRIEF.replace(from, to));
    refused(`a grammar line with no pin: ${name}`, ledger, grammar(line, 10));
  }
  setBrief(GRAMMAR_BRIEF.replace("brief:5;", "brief:13;"));
  refused("a cited line holding no pin (the Behaviours heading)", ledger, grammar(13, 10));

  // the forms clause: recognises, at least one form, then every other form and limit, in that order
  for (const [name, domain] of [
    ["no recognises", "any text; the forms on brief:3-4 and brief:5; every other form is a limit"],
    ["no every other form", "any text; recognises the forms on brief:3-4 and brief:5"],
    ["no limit", "any text; recognises the forms on brief:3-4 and brief:5; every other form is counted"],
    ["no form", "any text; recognises whatever it is given; every other form is a limit"],
    ["a malformed citation only", "any text; recognises brief:3to4; every other form is a limit"],
    ["the limit before the forms", "any text; every other form is a limit; recognises brief:3"],
  ] as const) {
    setBrief(GRAMMAR_BRIEF.replace(SOURCE_DOMAIN, domain));
    refused(`a source row with ${name}`, ledger, formless(10));
  }
  setBrief(GRAMMAR_BRIEF.replace(SOURCE_DOMAIN, "Any Text, as given").replace("any string; recognises `a-z` and `0-9`,", "any string, as given,"));
  refused("both rows formless, Any Text capitalised, in row order", ledger, formless(10) + formless(11));
  setBrief(GRAMMAR_BRIEF.replace("recognises the forms", "recognizes the forms").replace("is a limit", "are limits"));
  admitted("recognizes and limits spelled otherwise", ledger);

  // a range beginning beyond the last line clamps to the last line; a pin there admits it
  const BEYOND = "any text; recognises brief:999-1000; every other form is a limit";
  setBrief(GRAMMAR_BRIEF.replace(SOURCE_DOMAIN, BEYOND));
  refused("a range beginning beyond the last line clamps to it", ledger, grammar(14, 10));
  setBrief(GRAMMAR_BRIEF.replace(SOURCE_DOMAIN, BEYOND) + 'a last line, pinned by `W-300-b1` "last"');
  admitted("a pin on the last line admits a range beginning beyond it", ledger);

  // a ruled case holds exactly the keys line, row, pins and unpinned
  const { cases } = ruledCases(GRAMMAR_BRIEF);
  assert.ok(cases.length > 0, "the brief has cases");
  for (const c of cases) assert.deepEqual(Object.keys(c).sort(), ["line", "pins", "row", "unpinned"], "a case has exactly the keys line, row, pins and unpinned");

  // a row citing its own line is reported as a grammar line, after its row problem
  const SELF_ROW = GRAMMAR_BRIEF.replace(SOURCE_DOMAIN, "any text; recognises brief:10; every other form is a limit").replace(', pinned by `W-300-b1` "counts"', "");
  setBrief(SELF_ROW);
  refused(
    "a self-cited row is reported as a grammar line",
    ledger,
    `W-300: promise ledger: brief:10 is an Input domain row with no pin: name the test row and assertion that exercise it as pinned by \`<row>\` "<assertion>", or say unpinned (a stated limit, scoped in the ledger)\n` + grammar(10, 10),
  );

  // any text outside the Valid domain cell, or no any text at all, needs no forms clause
  setBrief(GRAMMAR_BRIEF);
  admitted("every form listed and pinned; any text in a Rejected by cell", ledger);
});
// W-336: a row ruling a path, a command line or an environment value holds a forms clause, and its line or a line the
// clause cites names a space, a quote, a non-ASCII name and a symlinked parent, each pinned or a stated limit
const PATH_DOMAIN = "a checkout path; recognises brief:3-4; every other form is a limit";
const HOSTILE_NAMED = "a space, a quote, a non-ASCII name and a symlinked parent exit 0";
const PATH_BRIEF = [
  "# W-300 fixture brief",
  "## Interfaces",
  '- an absolute checkout, pinned by `W-300-b1` "absolute"',
  '- a relative checkout under the repository, pinned by `W-300-b1` "relative"',
  "- a parent reached through a link, pinned by `W-300-b1` \"linked\"",
  "## Input domain",
  "A rejection fails closed.",
  "| Record | Valid domain | Rejected by |",
  "|---|---|---|",
  `| the checkout | ${PATH_DOMAIN} | \`runIt\`: exit 2 on a missing one; ${HOSTILE_NAMED}, pinned by \`W-300-b1\` "checkout" |`,
  '| the flag | a string | `parseFlag`: exit 2, pinned by `W-300-b1` "flag" |',
  "## Behaviours to test",
  "",
].join("\n");
const PATH_COVERING = [10, 11].map((n) => `brief:${n}, a reader: packages/x.ts:${n} exits 2 — holds`).join("\n");
const pathFormless = (row: number): string =>
  `W-300: promise ledger: brief:${row} rules a path, a command line or an environment value and lists no forms: say "recognises", then the forms (code spans, or brief:<line> citations of the lines that list them), then "every other form" and "limit"\n`;

test("W-336-b1 behaviour 1: an architect spec signature is refused for a row ruling a path, a command line or an environment value with no forms clause", () => {
  const { refused, admitted, cite, setBrief, NO } = specSigner(PATH_BRIEF);
  const ledger = cite(PATH_COVERING);
  const anyTextFormless = `W-300: promise ledger: brief:10 rules any text or any string and lists no forms: say "recognises", then the forms (code spans, or brief:<line> citations of the lines that list them), then "every other form" and "limit"\n`;

  // each word of the vocabulary, in the Valid domain cell, with no forms clause: one problem at the row
  for (const [name, domain] of [
    ["path", "a checkout path"],
    ["paths, capitalised", "two Paths"],
    ["directory", "a writable directory"],
    ["directories", "existing directories"],
    ["command line", "a command line"],
    ["command-line", "a command-line flag"],
    ["argv", "an argv of two tokens"],
    ["argument", "one argument"],
    ["arguments", "two arguments"],
    ["environment", "an environment value"],
    ["a clause with no form", "a checkout path; recognises whatever it is given; every other form is a limit"],
    ["the limit before the forms", "a checkout path; every other form is a limit; recognises brief:3-4"],
  ] as const) {
    setBrief(PATH_BRIEF.replace(PATH_DOMAIN, domain));
    refused(`a ${name} row with no forms clause`, ledger, pathFormless(10));
  }
  // a line a path row's clause cites holds a pin of its own, as W-322 rules for an any-text row's
  setBrief(PATH_BRIEF.replace(', pinned by `W-300-b1` "absolute"', ""));
  refused(
    "a cited line of a path row with no pin",
    ledger,
    `W-300: promise ledger: brief:3 is a grammar line brief:10 recognises, with no pin: name its test row and assertion as pinned by \`<row>\` "<assertion>"\n`,
  );
  // a row that is any text and path-typed, with no clause, has the any-text problem only
  setBrief(PATH_BRIEF.replace(PATH_DOMAIN, "any text naming a path"));
  refused("an any-text path row with no clause: the any-text problem only", ledger, anyTextFormless);

  // the vocabulary is whole words in the Valid domain cell only
  for (const [name, domain] of [
    ["a pathname", "a pathname"],
    ["a file-path", "a file-path"],
    ["xpath", "an xpath"],
    ["a regular file", "a regular file"],
    ["command-lines", "two command-lines"],
  ] as const) {
    setBrief(PATH_BRIEF.replace(PATH_DOMAIN, domain));
    admitted(name === "command-lines" ? "command-lines is not path-typed" : `${name}: not path-typed, no clause needed`, ledger);
  }
  setBrief(PATH_BRIEF.replace(PATH_DOMAIN, "a string").replace("`runIt`: exit 2", "`runIt`: exit 2 on a bad path"));
  admitted("path in a Rejected by cell only: no clause needed", ledger);
  setBrief(PATH_BRIEF.replace(PATH_DOMAIN, "a checkout path"));
  admitted("another seat's spec verdict needs no clause", NO, "qa-lead");
  setBrief(PATH_BRIEF);
  admitted("a path row with its forms clause and every hostile form named", ledger);
});

const pathUnnamed = (row: number, missing: string): string =>
  `W-300: promise ledger: brief:${row} rules a path, a command line or an environment value and does not name ${missing}: name each by the word space, quote, non-ASCII or symlink, on the row or on a line its forms clause cites, as a recognised form with its pin or as a stated limit\n`;

test("W-336-b2 behaviour 2: a path-typed row's line, or a line its forms clause cites, names a space, a quote, a non-ASCII name and a symlinked parent, or the signature is refused", () => {
  const { refused, admitted, cite, setBrief } = specSigner(PATH_BRIEF);
  const ledger = cite(PATH_COVERING);

  // each hostile form not named on the row's line: one problem naming it
  for (const [form, text] of [
    ["a space", "a space, "],
    ["a quote", "a quote, "],
    ["a non-ASCII name", "a non-ASCII name and "],
    ["a symlinked parent", " and a symlinked parent"],
  ] as const) {
    setBrief(PATH_BRIEF.replace(HOSTILE_NAMED, HOSTILE_NAMED.replace(text, "")));
    refused(`${form} not named`, ledger, pathUnnamed(10, form));
  }
  setBrief(PATH_BRIEF.replace(HOSTILE_NAMED, "every one exits 0"));
  refused("none named, in order", ledger, pathUnnamed(10, "a space, a quote, a non-ASCII name, a symlinked parent"));
  setBrief(PATH_BRIEF.replace(PATH_DOMAIN, "a checkout path").replace(HOSTILE_NAMED, "every one exits 0"));
  refused("no clause and none named: both problems, the clause first", ledger, pathFormless(10) + pathUnnamed(10, "a space, a quote, a non-ASCII name, a symlinked parent"));
  setBrief(PATH_BRIEF.replace(PATH_DOMAIN, "any text naming a path; recognises brief:3-4; every other form is a limit").replace(HOSTILE_NAMED, "every one exits 0"));
  refused("an any-text path row with a clause still names the hostile forms", ledger, pathUnnamed(10, "a space, a quote, a non-ASCII name, a symlinked parent"));

  // whole words only: a word run into another, or in an HTML comment, names nothing
  for (const [name, from, to] of [
    ["namespace", "a space,", "a namespace,"],
    ["unquoted", "a quote,", "an unquoted one,"],
    ["symlinkless", "a symlinked parent", "a symlinkless parent"],
    ["a comment", "a symlinked parent", "<!-- a symlinked parent -->"],
    ["whitespaces", "a space,", "whitespaces,"],
  ] as const) {
    setBrief(PATH_BRIEF.replace(from, to));
    refused(`${name} names nothing`, ledger, pathUnnamed(10, name === "namespace" || name === "whitespaces" ? "a space" : name === "unquoted" ? "a quote" : "a symlinked parent"));
  }
  // other inflections and cases name the form
  setBrief(PATH_BRIEF.replace("a space, a quote, a non-ASCII name and a symlinked parent", "whitespace, Quoted names, a NON-ASCII name and symlinks"));
  admitted("whitespace, Quoted, NON-ASCII and symlinks name the forms", ledger);
  setBrief(PATH_BRIEF.replace("a space,", "spaces,").replace("a symlinked parent", "a symlink"));
  admitted("spaces and symlink name the forms", ledger);

  // a line the clause cites names a form; a line it does not cite, or cites after "every other form", does not
  const ON_LINE_5 = PATH_BRIEF.replace(" and a symlinked parent", "").replace("a parent reached through a link", "a symlinked parent");
  setBrief(ON_LINE_5.replace("brief:3-4", "brief:3-5"));
  admitted("a form named on a cited grammar line", ledger);
  setBrief(ON_LINE_5);
  refused("a form named on a line the clause does not cite", ledger, pathUnnamed(10, "a symlinked parent"));
  setBrief(ON_LINE_5.replace("every other form is a limit", "every other form is a limit (brief:5)"));
  refused("a form named on a line cited after every other form", ledger, pathUnnamed(10, "a symlinked parent"));
});
