/**
 * packages/cli/src/close.test.ts — W-028: bisellium close.
 * Pure function tests for closeChecks; integration uses a temp studio.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeChecks, executeClose, runClose } from "./close.js";

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

// behaviour 7: closeChecks passes when opus is in verifying state
// (the real lifecycle state a "close after checks pass" command exists for)
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: verifying\n---\n");
    const result = closeChecks(studio, "W-099");
    check(7, "verifying opus passes", result.ok === true, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 8: closeChecks passes when opus is in review state
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: review\n---\n");
    const result = closeChecks(studio, "W-099");
    check(8, "review opus passes", result.ok === true, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 9: closeChecks fails when opus is in greenlit state — runDone
// (DONE_FROM_STATES) never accepts it, so closeChecks must not either.
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: greenlit\n---\n");
    const result = closeChecks(studio, "W-099");
    check(9, "greenlit opus fails", result.ok === false, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 10: closeChecks fails when opus is in "reviewing" — not a real
// lifecycle state.
{
  const studio = tmpStudio();
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: reviewing\n---\n");
    const result = closeChecks(studio, "W-099");
    check(10, '"reviewing" (not a real state) fails', result.ok === false, String(result.error));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

function tmpRepoWithDossier(exitStatus: number): string {
  const repo = mkdtempSync(join(tmpdir(), "bisellium-close-repo-"));
  const dossierDir = join(repo, "docs", "design", "dossier");
  mkdirSync(dossierDir, { recursive: true });
  const script = join(dossierDir, "build.sh");
  writeFileSync(script, `#!/bin/sh\nexit ${exitStatus}\n`);
  chmodSync(script, 0o755);
  return repo;
}

// behaviour 11: runClose reports success and exits 0 only when the dossier
// rebuild actually succeeds.
{
  const studio = tmpStudio();
  const repo = tmpRepoWithDossier(0);
  const orig = console.log;
  let out = "";
  let result: { exitCode: number } = { exitCode: -1 };
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: building\nprobationes:\n  spec: { sella: guest, status: passed, evidence: briefs/W-099.md }\n---\n");
    console.log = (msg?: unknown) => { out += `${String(msg)}\n`; };
    result = runClose(["W-099", "--studio", studio, "--repo", repo]);
  } finally {
    console.log = orig;
    rmSync(studio, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
  check(11, "runClose exits 0 and reports rebuilt on dossier success", result.exitCode === 0 && out.includes("dossier rebuilt"), `exit=${result.exitCode} out=${out}`);
}

// behaviour 12: runClose must not claim "dossier rebuilt" and must exit
// non-zero when the dossier build script fails.
{
  const studio = tmpStudio();
  const repo = tmpRepoWithDossier(1);
  const orig = console.log;
  let out = "";
  let result: { exitCode: number } = { exitCode: -1 };
  try {
    writeFileSync(join(studio, "opera", "W-099.md"), "---\nid: W-099\ntitle: test\nstate: building\nprobationes:\n  spec: { sella: guest, status: passed, evidence: briefs/W-099.md }\n---\n");
    console.log = (msg?: unknown) => { out += `${String(msg)}\n`; };
    result = runClose(["W-099", "--studio", studio, "--repo", repo]);
  } finally {
    console.log = orig;
    rmSync(studio, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
  check(12, "runClose exits non-zero and does not claim rebuilt on dossier failure", result.exitCode !== 0 && !out.includes("dossier rebuilt"), `exit=${result.exitCode} out=${out}`);
}

process.exit(failed ? 1 : 0);
