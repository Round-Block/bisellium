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
function record(body: string): { exitCode: number; stderr: string; written: boolean } {
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
      ["W-300", "--round", "1", "--sella", "qa-lead", "--outcome", "PASS", "--from", input, "--studio", dir],
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
