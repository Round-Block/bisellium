/**
 * packages/cli/src/branch.test.ts — W-026: per-opus branching.
 * Uses a real temp git repo for integration, pure functions where possible.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpusBranch, mergeOpusBranch, opusBranchName } from "./branch.js";

const repo = resolve(process.argv[2] ?? ".");
let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-branch-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name test", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "init");
  execSync("git add . && git commit -m init", { cwd: dir, stdio: "pipe" });
  return dir;
}

function branches(dir: string): string[] {
  return execSync("git branch --format='%(refname:short)'", { cwd: dir, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
}

function currentBranch(dir: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf8" }).trim();
}

// behaviour 0: opusBranchName produces the right format
{
  check(0, "opusBranchName('W-026') === 'opus/W-026'", opusBranchName("W-026") === "opus/W-026");
}

// behaviour 1: createOpusBranch creates opus/<id> from HEAD
{
  const dir = tmpRepo();
  try {
    const result = createOpusBranch(dir, "W-026");
    check(1, "createOpusBranch succeeds", result.ok === true, String(result.ok));
    check(1, "branch exists after create", branches(dir).includes("opus/W-026"), branches(dir).join(","));
    check(1, "stays on original branch", currentBranch(dir) === "master" || currentBranch(dir) === "main", currentBranch(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 2: createOpusBranch refuses if branch already exists
{
  const dir = tmpRepo();
  try {
    createOpusBranch(dir, "W-026");
    const result = createOpusBranch(dir, "W-026");
    check(2, "refuses duplicate branch", result.ok === false, String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 3: mergeOpusBranch fast-forwards master when clean
{
  const dir = tmpRepo();
  try {
    createOpusBranch(dir, "W-030");
    execSync("git checkout opus/W-030", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-030");
    check(3, "merge succeeds", result.ok === true, String(result.error));
    const log = execSync("git log --oneline", { cwd: dir, encoding: "utf8" });
    check(3, "feature commit on master after merge", log.includes("feat: add feature"), log.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 4: mergeOpusBranch refuses when branch doesn't exist
{
  const dir = tmpRepo();
  try {
    const result = mergeOpusBranch(dir, "W-999");
    check(4, "refuses missing branch", result.ok === false, String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 5: mergeOpusBranch refuses when branch has conflicts
{
  const dir = tmpRepo();
  try {
    createOpusBranch(dir, "W-031");
    // diverge master
    writeFileSync(join(dir, "README.md"), "master change");
    execSync("git add . && git commit -m 'master diverge'", { cwd: dir, stdio: "pipe" });
    // diverge opus branch
    execSync("git checkout opus/W-031", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "README.md"), "opus change");
    execSync("git add . && git commit -m 'opus diverge'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-031");
    check(5, "refuses conflicting branch", result.ok === false, String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 6: mergeOpusBranch deletes the branch after merge
{
  const dir = tmpRepo();
  try {
    createOpusBranch(dir, "W-032");
    execSync("git checkout opus/W-032", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "clean.ts"), "done");
    execSync("git add . && git commit -m 'done'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    mergeOpusBranch(dir, "W-032");
    check(6, "branch deleted after merge", !branches(dir).includes("opus/W-032"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
