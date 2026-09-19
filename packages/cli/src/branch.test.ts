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
import { join, relative, sep } from "node:path";
import { sourceTreeHash } from "@bisellium/shim";
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

// D-015 B1: an opus carrying a recorded `tree:` certificate on one gate.
function writeOpusFileWithCertifies(studio: string, id: string, state: string, gateId: string, certifies: string): void {
  mkdirSync(join(studio, "opera"), { recursive: true });
  writeFileSync(
    join(studio, "opera", `${id}.md`),
    `---\nid: "${id}"\nstate: ${state}\nprobationes: { ${gateId}: { status: passed, evidence: "x", certifies: "${certifies}" } }\n---\n`,
  );
}

// The exact SOURCE tree hash `mergeOpusBranch` will compare a recorded
// certificate against post-rebase (branch.ts's own `sourceExcludeDirs` —
// same two-line exclude-set build check.ts and verify.ts each also inline).
// `git merge-tree --write-tree <trunk> <branch>` computes the resulting tree
// object for a clean, non-conflicting rebase/merge without touching the
// working directory — confirmed to match a real rebase's tree byte for byte.
function expectedPostRebaseTreeHash(repo: string, studio: string, trunk: string, branch: string): string {
  const mergeTreeOid = execSync(`git merge-tree --write-tree ${trunk} ${branch}`, { cwd: repo, encoding: "utf8" }).trim();
  const excludeDirs = [relative(repo, studio).split(sep).join("/"), ".bisellium"];
  return `tree:${sourceTreeHash(repo, excludeDirs, mergeTreeOid)}`;
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

// ---------------------------------------------------------------------------
// D-015 — integration strategy is configuration, not a fixed flow. Extra
// behaviours (11+, not in W-026's original numbered list — same footing as
// 8/9 above): `mergeOpusBranch` reading `integration:` off the manifest.
// ---------------------------------------------------------------------------

/** A minimal manifest with just the `integration:` block under test —
 *  `readManifest` never validates shape (that's `check`'s job), so nothing
 *  else in the manifest is read by `resolveIntegration`. */
function writeIntegrationManifest(studio: string, block: string): void {
  writeFileSync(join(studio, "bisellium.yml"), `bisellium: 1\nstudio: Test\n${block}\n`);
}

/** A bare repo under the OS tmp dir wired as `origin` — a real remote, but
 *  never `origin` itself: these tests must never touch the private remote
 *  this repo actually pushes to. */
function addLocalOrigin(dir: string): string {
  const bare = mkdtempSync(join(tmpdir(), "bisellium-origin-"));
  execSync(`git init -q --bare "${bare}"`, { stdio: "pipe" });
  execSync(`git remote add origin "${bare}"`, { cwd: dir, stdio: "pipe" });
  return bare;
}

function originMasterRev(bare: string): string {
  try {
    return execSync("git rev-parse master", { cwd: bare, encoding: "utf8" }).trim();
  } catch {
    return "(origin has no master — nothing was pushed)";
  }
}

// behaviour 11: integration.strategy "rebase" actually rebases the opus
// branch onto the trunk, then fast-forwards — not the fast-forward-only
// refusal behaviour 9 covers. Also covers D-015's own named consequence:
// the rebase rewrites the opus's tree, so `mergeOpusBranch` must say so.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-080", "done");
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    createOpusBranch(dir, "W-080");
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-080", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-080", studio);
    check(11, "rebase strategy succeeds where ff-only would refuse", result.ok === true, String(result.error));
    check(11, "feature commit lands on master after rebase", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(11, "opus branch deleted after a rebased merge", !branches(dir).includes("opus/W-080"), branches(dir).join(","));
    const merges = execSync("git log --merges --oneline master", { cwd: dir, encoding: "utf8" }).trim();
    check(11, "rebase produced a linear history, no merge commit", merges === "", merges);
    check(
      17,
      "round-4 (D-015 B1): the rebase note no longer cites probatio.certifies.stale, a rule that never fires for a done opus",
      (result.note ?? "").includes("was rebased onto master") && !(result.note ?? "").includes("probatio.certifies.stale"),
      String(result.note),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 12: a genuine conflict under the "rebase" strategy is refused
// distinctly from behaviour 5's ff-only conflict wording, and never leaves
// a rebase in progress or a deleted branch behind.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-081", "done");
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    createOpusBranch(dir, "W-081");
    writeFileSync(join(dir, "README.md"), "master change");
    execSync("git add . && git commit -m 'master diverge'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-081", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "README.md"), "opus change");
    execSync("git add . && git commit -m 'opus diverge'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-081", studio);
    check(12, "refuses a real rebase conflict", result.ok === false, String(result.error));
    check(12, "error names the rebase, not the ff-only wording", (result.error ?? "").includes("could not be rebased"), String(result.error));
    check(12, "no rebase left in progress", execSync("git status --porcelain=v1 --branch", { cwd: dir, encoding: "utf8" }).includes("## master"), "");
    check(12, "opus branch survives a failed rebase", branches(dir).includes("opus/W-081"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 13: integration.push, gated on the setting — a successful merge
// pushes the trunk to a (local, throwaway) origin; the default (no
// integration block, all existing behaviours above) never touches a remote
// at all, since none of those tests configure one.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  let bare: string | undefined;
  try {
    writeOpusFile(studio, "W-082", "done");
    writeIntegrationManifest(studio, "integration:\n  push: true\n  pull_after_push: true\n");
    bare = addLocalOrigin(dir);
    createOpusBranch(dir, "W-082");
    execSync("git checkout opus/W-082", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "done");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-082", studio);
    check(13, "merge with integration.push succeeds", result.ok === true, String(result.error));
    const localMaster = execSync("git rev-parse master", { cwd: dir, encoding: "utf8" }).trim();
    check(13, "origin's master matches the local trunk after push", originMasterRev(bare) === localMaster, originMasterRev(bare));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
    if (bare) rmSync(bare, { recursive: true, force: true });
  }
}

// behaviour 14: integration.pr.required stops `merge` short of landing the
// change locally — the seam this opus leaves for W-028 (PR creation) rather
// than building it. The branch survives, untouched, for a PR to carry.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-083", "done");
    writeIntegrationManifest(studio, "integration:\n  pr:\n    required: true\n    reviewer: qa-lead\n");
    createOpusBranch(dir, "W-083");
    execSync("git checkout opus/W-083", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "done");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-083", studio);
    check(14, "pr.required still reports success (merge did its half)", result.ok === true, String(result.error));
    check(14, "pr.required does not land the change on the trunk", result.landed === false, String(result.landed));
    check(14, "master is untouched", !masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(14, "opus branch survives for a PR to carry", branches(dir).includes("opus/W-083"), branches(dir).join(","));
    check(14, "note names the reviewer", (result.note ?? "").includes("qa-lead"), String(result.note));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 15: integration.strategy "merge_commit" is declared (D-015
// names it as a valid strategy) but not built here — a clear, immediate
// error beats half a merge-commit policy nobody asked to exercise yet.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-084", "done");
    writeIntegrationManifest(studio, "integration:\n  strategy: merge_commit\n");
    createOpusBranch(dir, "W-084");
    execSync("git checkout opus/W-084", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "done");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-084", studio);
    check(15, "merge_commit is refused, not silently downgraded", result.ok === false, String(result.error));
    check(15, "error names the strategy as not implemented", (result.error ?? "").includes("merge_commit") && (result.error ?? "").includes("not implemented"), String(result.error));
    check(15, "master is untouched", !masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(15, "opus branch is untouched", branches(dir).includes("opus/W-084"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 16 (adjacent bug fix, branch.ts:172): a repo whose trunk is
// `main` merges into `main`, and `mergeOpusBranch` reports `main` as the
// trunk it touched — never a hardcoded "master" (see runMerge's use of
// `result.trunk`).
{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-branch-"));
  const studio = tmpStudio();
  try {
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync("git config user.name test", { cwd: dir, stdio: "pipe" });
    execSync("git config user.email test@test", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "README.md"), "init");
    execSync("git add . && git commit -m init", { cwd: dir, stdio: "pipe" });

    writeOpusFile(studio, "W-085", "done");
    createOpusBranch(dir, "W-085");
    execSync("git checkout opus/W-085", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "done");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout main", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-085", studio);
    check(16, "merges into main when main is the trunk", result.ok === true, String(result.error));
    check(16, "reports the real trunk name (main), not a hardcoded master", result.trunk === "main", String(result.trunk));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// D-015 B1 (round-3 review) — merge refuses when a recorded gate certificate
// no longer matches the post-rebase source tree, rather than leaning on
// `check`'s probatio.certifies.stale (which never fires for a `done` opus).
// New behaviours (17+, W-026 round 4 — 17 sits in behaviour 11's own block
// above, the corrected note text; 18-20 are here).
// ---------------------------------------------------------------------------

// behaviour 18: a recorded tree: certificate that does NOT match the
// rebased tree refuses the merge — master is left untouched.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    writeOpusFileWithCertifies(studio, "W-090", "done", "tests", "tree:0000000000000000000000000000000000000000");
    createOpusBranch(dir, "W-090");
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-090", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-090", studio);
    check(18, "refuses when the recorded certificate no longer matches the rebased tree", result.ok === false, String(result.error));
    check(18, "error names the stale gate and points at re-verify", (result.error ?? "").includes('gate "tests"') && (result.error ?? "").includes("bisellium verify"), String(result.error));
    check(18, "master is untouched", !masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(18, "the branch is left in place for a retry after verify, not deleted", branches(dir).includes("opus/W-090"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 19: a recorded tree: certificate that DOES match the rebased
// tree is not refused — the merge proceeds and lands as behaviour 11 does.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    createOpusBranch(dir, "W-091");
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-091", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const matching = expectedPostRebaseTreeHash(dir, studio, "master", "opus/W-091");
    writeOpusFileWithCertifies(studio, "W-091", "done", "tests", matching);

    const result = mergeOpusBranch(dir, "W-091", studio);
    check(19, "a matching certificate does not block the merge", result.ok === true, String(result.error));
    check(19, "feature commit lands on master", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 20: every post-rebase failure path carries the rebase note, not
// just the two success paths the old code comment ("either exit path
// below") actually covered — here, the branch-delete failure (branch.ts's
// third such path; the other two are the ff-merge and trunk-fetch failures,
// which get the identical one-line `note: staleNote` addition).
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    writeOpusFile(studio, "W-092", "done");
    createOpusBranch(dir, "W-092");
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-092", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    // stays checked out on opus/W-092 (the rebase runs in this same
    // worktree, then the eventual `git branch -D` fails: git refuses to
    // delete the branch you're standing on).

    const result = mergeOpusBranch(dir, "W-092", studio);
    check(20, "branch-delete failure after a rebase is still reported as a failure", result.ok === false, String(result.error));
    check(20, "master genuinely advanced despite the reported failure", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(20, "the failure still carries the rebase note", (result.note ?? "").includes("was rebased onto master"), String(result.note));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// D-015 B2 (round-3 review) — a rebase-then-push must use
// --force-with-lease: a plain `git push origin <branch>` is rejected
// non-fast-forward the moment the branch already has a remote counterpart
// (exactly PR #2's own situation). New behaviour (21, W-026 round 4).
// ---------------------------------------------------------------------------

// behaviour 21: the branch was already pushed to origin (a PR is open on
// it) BEFORE merge runs — the one case no existing test covers, and exactly
// studio/bisellium.yml's own configured flow (rebase + push + pr.required).
// A rebase then a plain push is rejected non-fast-forward (round-3 review's
// reproduction); force-with-lease must still land it on origin.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  let bare: string | undefined;
  try {
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n  push: true\n  pr:\n    required: true\n");
    writeOpusFile(studio, "W-093", "done");
    bare = addLocalOrigin(dir);
    createOpusBranch(dir, "W-093");
    execSync("git checkout opus/W-093", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    // The branch is pushed to origin BEFORE trunk diverges — the PR-already-
    // open case: origin now holds the pre-rebase commit.
    execSync("git push origin opus/W-093", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-093", studio);
    check(21, "rebase-then-push succeeds even though the branch was already on origin", result.ok === true, String(result.error));
    check(21, "pr.required still stops merge from landing locally", result.landed === false, String(result.landed));
    const localBranchRev = execSync("git rev-parse opus/W-093", { cwd: dir, encoding: "utf8" }).trim();
    const originBranchRev = execSync(`git --git-dir="${bare}" rev-parse opus/W-093`, { encoding: "utf8" }).trim();
    check(21, "origin's branch was force-with-lease-pushed to the rebased tip, not left diverged", originBranchRev === localBranchRev, `local ${localBranchRev} origin ${originBranchRev}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
    if (bare) rmSync(bare, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
