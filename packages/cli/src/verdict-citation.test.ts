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
import { runReview } from "./lifecycle.js";
import { runVerdict } from "./verdict.js";

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
  git?: boolean;
}

function studio(o: Options = {}): string {
  const { spec = "briefs/W-300.md", brief = true, state = "building", git = false } = o;
  const base = mkdtempSync(join(tmpdir(), "bisellium-w126-"));
  roots.push(base);
  const root = git ? join(base, "studio") : base;
  if (git) {
    mkdirSync(root);
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
  return { exitCode: result.exitCode, stdout, stderr, header: parsed.values, keys: [...parsed.values.keys()], body: raw.slice(raw.indexOf("\n\n") + 2) };
}

/** A findings-shaped body: one numbered line per entry, each ending in a check. */
function findings(...lines: string[]): string {
  return `## Findings\n${lines.map((line, i) => `${i + 1}. ${line} — check: none: x`).join("\n")}\n`;
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

  test("the same four-finding body in the spec phase gets neither line", () => {
    const body = findings("blocking — packages/x.ts:3 a", "advisory — b", "BLOCKING — brief:2 c", "**Blocking** — briefs/W-300.md:5 d");
    const r = verdict(studio(), body, "passed", ["--phase", "spec"]);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.has("brief"), false);
    assert.equal(r.header.has("converted"), false);
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

  test("a spec-phase failed outcome with an uncited blocker is untouched", () => {
    const r = verdict(studio(), findings(UNCITED), "failed", ["--phase", "spec"]);
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.header.get("outcome"), "failed");
    assert.equal(r.header.has("submitted_outcome"), false);
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
