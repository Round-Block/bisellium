/**
 * packages/cli/src/branch.test.ts — W-026: per-opus branching.
 * Pure temp git repos, one per case — nothing here touches the real repo.
 * Behaviour numbers match studio/briefs/W-026.md's "Behaviours to test"
 * list (1-6 here; behaviour 7, `bisellium run --opus`, is tested in
 * packages/commands/src/run.test.ts since it lives in run.ts). Numbers
 * outside 1-7 (0, 8, 9) are extra regression coverage, not brief behaviours.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpusBranch, mergeOpusBranch, opusBranchName } from "./branch.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

// A fixed initial branch name ("master") so behaviour is not at the mercy of
// the local `init.defaultBranch` git config.
function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-branch-"));
  execSync("git init -q -b master", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name test", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "init");
  execSync("git add . && git commit -m init", { cwd: dir, stdio: "pipe" });
  return dir;
}

// A studio dir separate from the git repo — `--studio` and `--repo` are
// independent flags, and keeping opera/ out of the repo also means a test's
// `git add .` can never accidentally commit it onto one branch and not the
// other, which is a real trap: git then deletes it on checkout to the
// branch that never had it.
function tmpStudio(): string {
  return mkdtempSync(join(tmpdir(), "bisellium-branch-studio-"));
}

function writeOpusFile(studio: string, id: string, state: string): void {
  mkdirSync(join(studio, "opera"), { recursive: true });
  writeFileSync(join(studio, "opera", `${id}.md`), `---\nid: "${id}"\nstate: ${state}\n---\n`);
}

function branches(dir: string): string[] {
  return execSync("git branch --format='%(refname:short)'", { cwd: dir, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
}

function currentBranch(dir: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf8" }).trim();
}

function masterLog(dir: string): string {
  return execSync("git log --oneline master", { cwd: dir, encoding: "utf8" });
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
    check(1, "stays on original branch", currentBranch(dir) === "master", currentBranch(dir));
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

// behaviour 3: mergeOpusBranch fast-forwards master when clean — regardless
// of which branch happens to be checked out when merge runs. The interface
// line says "merge opus branch to master"; a merge that lands somewhere
// else and calls it master is not this behaviour (round-2 review finding 5,
// 6 — the operator's actual checkout when running `bisellium merge` must
// not change where the commits land).
{
  // (a) invoked from master itself
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-030", "done");
    createOpusBranch(dir, "W-030");
    execSync("git checkout opus/W-030", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-030", studio);
    check(3, "merge from master succeeds", result.ok === true, String(result.error));
    check(3, "feature commit on master (from master)", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}
{
  // (b) invoked from an unrelated third branch — round-2 review's own probe
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-050", "done");
    createOpusBranch(dir, "W-050");
    execSync("git checkout opus/W-050", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });
    execSync("git checkout -q -b sidebranch", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-050", studio);
    check(3, "feature commit on master (from a third branch)", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(3, "merge from a third branch leaves it checked out", currentBranch(dir) === "sidebranch", currentBranch(dir));
    check(3, "merge from a third branch still reports success", result.ok === true, String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}
{
  // (c) invoked from the opus branch itself — the likely operator path,
  // since builders work in a worktree checked out on opus/<id>
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-060", "done");
    createOpusBranch(dir, "W-060");
    execSync("git checkout opus/W-060", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    // stays on opus/W-060 — no further checkout

    mergeOpusBranch(dir, "W-060", studio);
    check(3, "feature commit on master (from the opus branch itself)", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 4: mergeOpusBranch refuses when opus state is not `done`
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-040", "building");
    createOpusBranch(dir, "W-040");
    execSync("git checkout opus/W-040", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-040", studio);
    check(4, "refuses a non-done opus", result.ok === false, String(result.error));
    check(4, "error names the actual state", (result.error ?? "").includes("building"), String(result.error));
    check(4, "master untouched", !masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(4, "opus branch still exists", branches(dir).includes("opus/W-040"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 5: mergeOpusBranch refuses when branch has conflicts with master
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-031", "done");
    createOpusBranch(dir, "W-031");
    // diverge master
    writeFileSync(join(dir, "README.md"), "master change");
    execSync("git add . && git commit -m 'master diverge'", { cwd: dir, stdio: "pipe" });
    // diverge opus branch, same line, real conflict
    execSync("git checkout opus/W-031", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "README.md"), "opus change");
    execSync("git add . && git commit -m 'opus diverge'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-031", studio);
    check(5, "refuses conflicting branch", result.ok === false, String(result.error));
    check(5, "error names the conflict, not divergence", result.error === "branch opus/W-031 conflicts with master", String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}
{
  // conflicts must be judged against master even when merge runs from
  // elsewhere — checking a third branch's tree for conflicts (as HEAD-based
  // logic would) can miss a real conflict against master entirely.
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-032", "done");
    createOpusBranch(dir, "W-032");
    writeFileSync(join(dir, "README.md"), "master change");
    execSync("git add . && git commit -m 'master diverge'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-032", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "README.md"), "opus change");
    execSync("git add . && git commit -m 'opus diverge'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });
    execSync("git checkout -q -b sidebranch", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-032", studio);
    check(5, "refuses conflicting branch even from a third branch", result.ok === false, String(result.error));
    check(5, "names the conflict against master, not sidebranch", result.error === "branch opus/W-032 conflicts with master", String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 6: mergeOpusBranch deletes the branch after merge
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-032b", "done");
    createOpusBranch(dir, "W-032b");
    execSync("git checkout opus/W-032b", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "clean.ts"), "done");
    execSync("git add . && git commit -m 'done'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    mergeOpusBranch(dir, "W-032b", studio);
    check(6, "branch deleted after merge", !branches(dir).includes("opus/W-032b"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}
{
  // deletion can legitimately fail — git refuses to delete the branch you
  // are standing on. That must surface as a reported failure, never a
  // silent no-op reported as success (round-2 review finding 6).
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-032c", "done");
    createOpusBranch(dir, "W-032c");
    execSync("git checkout opus/W-032c", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "clean.ts"), "done");
    execSync("git add . && git commit -m 'done'", { cwd: dir, stdio: "pipe" });
    // stays checked out on opus/W-032c

    const result = mergeOpusBranch(dir, "W-032c", studio);
    check(6, "never a false success when the branch can't be deleted", result.ok === false, JSON.stringify(result));
    check(6, "branch left in place when deletion fails", branches(dir).includes("opus/W-032c"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 8 (extra, not in the brief's numbered list): missing branch
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    const result = mergeOpusBranch(dir, "W-999", studio);
    check(8, "refuses missing branch", result.ok === false, String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 9 (extra, not in the brief's numbered list): a clean-but-diverged
// merge under the ff-only model is refused, distinctly from a conflict —
// this is the acceptance-criterion gap round-2 review flags for the
// architect (finding 8): nothing here builds the rebase this needs.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-070", "done");
    createOpusBranch(dir, "W-070");
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-070", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-070", studio);
    check(9, "refuses a clean-but-diverged merge (ff-only)", result.ok === false, String(result.error));
    check(9, "names divergence, not a conflict", result.error === "branch opus/W-070 has diverged from master — rebase first", String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
