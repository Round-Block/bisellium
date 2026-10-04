/**
 * W-131 behaviours 1-3: `verdict` stores findings, not transcripts. Rows are
 * selected by name (`--test-name-pattern=W-131.behaviour.N:`), one failing row
 * per recorded red.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
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
