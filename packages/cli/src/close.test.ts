/**
 * packages/cli/src/close.test.ts — W-028: bisellium close.
 * Pure function tests for closeChecks; integration uses a temp studio.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeChecks, executeClose } from "./close.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

function tmpStudio(): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-close-"));
  writeFileSync(join(dir, "bisellium.yml"), "studio: test\nsellae:\n  - id: guest\n    collegia: [engineering]\nprobationes:\n  - { id: spec, name: Spec, kind: agent }\n");
  mkdirSync(join(dir, "opera"), { recursive: true });
  return dir;
}

// behaviour 0: closeChecks passes when opus is in building state
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: building\n---\n");
    const result = closeChecks(studio, "W-099");
    check(0, "building opus passes", result.ok === true, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 1: closeChecks fails when opus doesn't exist
{
  const studio = tmpStudio();
  try {
    const result = closeChecks(studio, "W-999");
    check(1, "missing opus fails", result.ok === false, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 2: closeChecks fails when opus is already done
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: done\n---\n");
    const result = closeChecks(studio, "W-099");
    check(2, "done opus fails", result.ok === false, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 3: closeChecks fails when opus is in backlog
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: backlog\n---\n");
    const result = closeChecks(studio, "W-099");
    check(3, "backlog opus fails", result.ok === false, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 4: executeClose transitions opus to done
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: building\nprobationes:\n  spec: { sella: guest, status: passed, evidence: briefs/W-099.md }\n---\n");
    const result = executeClose(studio, "W-099");
    const content = readFileSync(join(studio, "opera", "W-099.md"), "utf8");
    check(4, "executeClose transitions opus to done", result.ok && /state: done/.test(content), result.error ?? content);
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 5: executeClose fails when opus is already done
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: done\n---\n");
    const result = executeClose(studio, "W-099");
    check(5, "executeClose fails on done opus", result.ok === false, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 6: executeClose fails when gates haven't passed
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: building\nprobationes: {}\n---\n");
    const result = executeClose(studio, "W-099");
    check(6, "executeClose fails when gates not passed", result.ok === false, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
