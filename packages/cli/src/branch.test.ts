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

// behaviour 8 (extra, not in the brief's numbered list; A6.5, mutation-
// record): missing branch. This logic predates round 5/6 entirely — the
// FAIL captured for this behaviour's evidence came from a deliberate
// mutation of the early-exit guard, not from the feature being unbuilt
// (re-run against round-5 code: PASS 1/1). Labelled in the check() name
// below so the log itself says so (A6.5), not only this comment.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    const result = mergeOpusBranch(dir, "W-999", studio);
    check(8, "mutation-record: refuses missing branch", result.ok === false, String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 9 (extra, not in the brief's numbered list): a clean-but-diverged
// merge under the ff-only model is refused, distinctly from a conflict —
// this is the acceptance-criterion gap round-2 review flags for the
// architect (finding 8): nothing here builds the rebase this needs.
// A6.5, mutation-record: same footing as 8 above — this logic predates
// round 5/6 (re-run against round-5 code: PASS 2/2); the recorded FAIL came
// from a deliberate mutation, not an unbuilt feature.
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
    check(9, "mutation-record: refuses a clean-but-diverged merge (ff-only)", result.ok === false, String(result.error));
    check(9, "mutation-record: names divergence, not a conflict", result.error === "branch opus/W-070 has diverged from master — rebase first", String(result.error));
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

// ---------------------------------------------------------------------------
// Round-4 review (studio/ci/W-026-review-4.log) — B1 fires once, then steps
// aside for the retry its own error message tells the operator to run, and
// never fires at all for an ff-ready branch that needed no rebase. New
// behaviours (22+, round 4; 22 is a mutation-record — see its own comment).
// ---------------------------------------------------------------------------

// behaviour 22 (A4.4, mutation-record): the SOURCE-tree exclude set, pinned
// with the studio INSIDE the repo — the real configuration. Round 4's own
// mutation (sourceExcludeDirs -> return []) found 0 FAIL because 18/19 keep
// the studio OUTSIDE the repo, where exclusion is inert either way. Here a
// trunk-only commit that touches nothing but studio bookkeeping (as a real
// `bisellium verify` front-matter write would) must never stale an
// otherwise-matching certificate.
//
// B5.1 (round 5): the certificate is committed to the BRANCH, not master —
// `mergeOpusBranch` now reads the opus record from `branch`, so a
// certificate written only to master's own checkout (this test's original
// shape) would never be seen at all, and the test would pass for the wrong
// reason (nothing to compare) rather than exercising the exclude set.
{
  const dir = tmpRepo();
  const studio = join(dir, "studio"); // INSIDE the repo — the real layout
  try {
    writeOpusFile(studio, "W-094", "done");
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    execSync("git add . && git commit -m 'studio bookkeeping: open W-094'", { cwd: dir, stdio: "pipe" });

    createOpusBranch(dir, "W-094");
    execSync("git checkout opus/W-094", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });

    // Certificate recorded ON THE BRANCH, before any trunk-side bookkeeping
    // churn — the exclude set is what has to keep it matching after that
    // churn lands and a real rebase replays these commits onto it.
    const matching = expectedPostRebaseTreeHash(dir, studio, "master", "opus/W-094");
    writeOpusFileWithCertifies(studio, "W-094", "done", "tests", matching);
    execSync("git add . && git commit -m 'bookkeeping: verify on the branch'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    // A bookkeeping-only commit lands on master, touching ONLY the studio
    // dir (e.g. another opus opening) — never the source tree.
    writeOpusFile(studio, "W-095", "backlog");
    execSync("git add . && git commit -m 'studio bookkeeping: open W-095'", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-094", studio);
    check(
      22,
      "mutation-record (A4.4): a trunk-side studio-only commit does not stale a matching certificate",
      result.ok === true,
      String(result.error),
    );
    check(22, "feature commit lands on master", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 23 (B1.4, pre-implementation): a stale certificate refuses the
// merge on EVERY invocation, not just the one that happened to perform the
// rebase. Round 4's reproduction: nothing changes between the two calls —
// no verify, no edit — yet unfixed code lands on the second call, because
// the first call's rebase already moved mergeBase to masterRev and the
// stale check lived only inside the "mergeBase !== masterRev" branch.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFileWithCertifies(studio, "W-096", "done", "tests", "tree:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    createOpusBranch(dir, "W-096");
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-096", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const first = mergeOpusBranch(dir, "W-096", studio);
    check(23, "first call refuses on the stale certificate", first.ok === false, String(first.error));

    // Nothing changed: no verify, no edit, no manifest change — retry the
    // exact same command.
    const second = mergeOpusBranch(dir, "W-096", studio);
    check(23, "the retry refuses too — the error's own remedy does not defeat it", second.ok === false, String(second.error));
    check(23, "master is still untouched after the retry", !masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
    check(23, "the branch still exists after the retry", branches(dir).includes("opus/W-096"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 24 (B1, pre-implementation): the fast-forward blind spot — a
// branch that already contains master's tip (no rebase needed at all, the
// default fast_forward strategy) is still refused when its own certificate
// predates its OWN last commit. Round 4: this case never even reached the
// old check, since that check lived entirely inside "mergeBase !==
// masterRev", which is false here by construction.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFile(studio, "W-097", "done");
    createOpusBranch(dir, "W-097");
    execSync("git checkout opus/W-097", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });

    // Certify against the tree as of THIS commit...
    const excludeDirs = [relative(dir, studio).split(sep).join("/"), ".bisellium"];
    const certified = `tree:${sourceTreeHash(dir, excludeDirs, "opus/W-097")}`;
    writeOpusFileWithCertifies(studio, "W-097", "done", "tests", certified);

    // ...then the branch gains ANOTHER commit after that — master never
    // moves, so this stays trivially fast-forwardable, but the certificate
    // no longer describes what's about to ship.
    writeFileSync(join(dir, "more.ts"), "more opus work");
    execSync("git add . && git commit -m 'feat: more work, uncertified'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-097", studio);
    check(24, "refuses a fast-forward-ready branch whose certificate predates its last commit", result.ok === false, String(result.error));
    check(24, "master is untouched", !masterLog(dir).includes("more opus work"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// behaviour 25 (B1.5, pre-implementation): the refusal names an achievable
// remedy. `bisellium verify <opus>` alone (default `--commit HEAD`, run from
// a trunk checkout — exactly CLAUDE.md's own documented invocation) certifies
// the TRUNK's tree, not the opus branch's — following the old message
// verbatim can never produce a matching certificate. The honest remedy is to
// check out the branch first.
{
  const dir = tmpRepo();
  const studio = tmpStudio();
  try {
    writeOpusFileWithCertifies(studio, "W-098", "done", "tests", "tree:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    writeIntegrationManifest(studio, "integration:\n  strategy: rebase\n");
    createOpusBranch(dir, "W-098");
    writeFileSync(join(dir, "other.ts"), "master work");
    execSync("git add . && git commit -m 'master work'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout opus/W-098", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-098", studio);
    check(25, "refuses on the stale certificate", result.ok === false, String(result.error));
    check(25, "names an achievable remedy: check out the branch, not a bare re-verify from here", (result.error ?? "").includes("check out opus/W-098"), String(result.error));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// round-5 review, B5.1: `mergeOpusBranch` read the opus record off whatever
// is checked out (the trunk, when `merge` runs there — CLAUDE.md's own
// documented invocation) but hashed the BRANCH ref. With `studio` INSIDE the
// repo — the real layout, and this repo's own — those are two different
// commits' worth of the same file. Every behaviour above except 22 puts
// `studio` OUTSIDE the repo (`tmpStudio()`), where the two reads are
// necessarily identical and B5.1 is structurally invisible; 26-28 all use
// `studio` INSIDE the repo (`join(dir, "studio")`, `git add .` tracks it) to
// close that blind spot.
// ---------------------------------------------------------------------------

// behaviour 26 (B5.1(a), pre-implementation): FAILS OPEN under the old code.
// The opus is opened on the trunk before any gate has run (master's own
// copy: no certificate at all). The builder then verifies on the branch —
// certifying the tree as of the feature commit — and one MORE, never-
// certified commit follows. `merge` runs from the trunk. Reading the trunk's
// copy finds nothing to compare and would let the uncertified commit land;
// reading the branch's own copy (the fix) finds a certificate that no longer
// matches the branch's own current tree and refuses.
{
  const dir = tmpRepo();
  const studio = join(dir, "studio"); // INSIDE the repo — the real layout
  try {
    mkdirSync(join(studio, "opera"), { recursive: true });
    writeFileSync(
      join(studio, "opera", "W-099.md"),
      "---\nid: \"W-099\"\nstate: done\nprobationes: { tests: { status: pending } }\n---\n",
    );
    execSync("git add . && git commit -m 'studio bookkeeping: open W-099'", { cwd: dir, stdio: "pipe" });

    createOpusBranch(dir, "W-099");
    execSync("git checkout opus/W-099", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });

    // Builder verifies on the branch: certifies the tree AS OF THIS commit.
    const excludeDirs = [relative(dir, studio).split(sep).join("/"), ".bisellium"];
    const certified = `tree:${sourceTreeHash(dir, excludeDirs, "opus/W-099")}`;
    writeFileSync(
      join(studio, "opera", "W-099.md"),
      `---\nid: "W-099"\nstate: done\nprobationes: { tests: { status: passed, evidence: "x", certifies: "${certified}" } }\n---\n`,
    );
    execSync("git add . && git commit -m 'bookkeeping: verify on the branch'", { cwd: dir, stdio: "pipe" });

    // ...then one more commit lands on the branch, never certified.
    writeFileSync(join(dir, "more.ts"), "more opus work, never certified");
    execSync("git add . && git commit -m 'feat: more work, never certified'", { cwd: dir, stdio: "pipe" });

    // Merge is run from the TRUNK — master's own copy of the opus record is
    // still the pre-verify version (probationes: pending, no certifies).
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });
    const result = mergeOpusBranch(dir, "W-099", studio);
    check(26, "B5.1(a): does not land a never-certified commit by trusting the trunk's own (uncertified) copy", result.ok === false, String(result.error));
    check(26, "master never advances past the trunk-side bookkeeping", !masterLog(dir).includes("never certified"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 27 (B5.1(b), pre-implementation): FAILS CLOSED under the old
// code — the instance this PR itself hit. The TRUNK's copy of the opus
// record carries a stale/wrong `tree:` certificate (left over from an
// earlier round); the BRANCH's own copy correctly certifies its own current
// tree. Reading the trunk's copy refuses a correct merge on evidence that
// exists only in the wrong file; reading the branch's own copy (the fix)
// lands it.
{
  const dir = tmpRepo();
  const studio = join(dir, "studio"); // INSIDE the repo — the real layout
  try {
    mkdirSync(join(studio, "opera"), { recursive: true });
    writeFileSync(
      join(studio, "opera", "W-100.md"),
      '---\nid: "W-100"\nstate: done\nprobationes: { tests: { status: passed, evidence: "x", certifies: "tree:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" } }\n---\n',
    );
    execSync("git add . && git commit -m 'studio bookkeeping: open W-100, certifies a stale tree'", { cwd: dir, stdio: "pipe" });

    createOpusBranch(dir, "W-100");
    execSync("git checkout opus/W-100", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });

    // Builder re-verifies on the branch: the branch's OWN copy now certifies
    // its own actual current tree, correctly.
    const excludeDirs = [relative(dir, studio).split(sep).join("/"), ".bisellium"];
    const correct = `tree:${sourceTreeHash(dir, excludeDirs, "opus/W-100")}`;
    writeFileSync(
      join(studio, "opera", "W-100.md"),
      `---\nid: "W-100"\nstate: done\nprobationes: { tests: { status: passed, evidence: "x", certifies: "${correct}" } }\n---\n`,
    );
    execSync("git add . && git commit -m 'bookkeeping: verify on the branch, correct certificate'", { cwd: dir, stdio: "pipe" });

    // Merge is run from the TRUNK — master's own copy still certifies the
    // stale tree from before the branch was ever re-verified.
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });
    const result = mergeOpusBranch(dir, "W-100", studio);
    check(27, "B5.1(b): a correct branch is not refused on a stale certificate that survives only in the trunk's copy", result.ok === true, String(result.error));
    check(27, "feature commit lands on master", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 28 (round 6, B6.1 — RETIRED, kept at this number per P-005):
// used to pin the "absence rule" (a `kind: automated` gate with no recorded
// `tree:` certificate at all refuses, rather than passing on the absence).
// Round-6 review found that rule refuses a Patron-waived gate FOREVER — the
// remedy it names ("run verify") can never clear a waived gate, since
// `verify` deliberately never touches one — and that its `kind ===
// "automated"` scoping was pinned by nothing (A6.3). It's removed: the
// guarantee it duplicated is `bisellium done`'s own gate (lifecycle.ts),
// which already refuses to write `state: done` while an automated
// probatio's `status`/`certifies` are missing. This behaviour's assertion
// is flipped to match — an uncertified automated gate no longer refuses a
// merge BY ITSELF (a raw front-matter write, bypassing `done`, is the only
// way to reach this shape at all, same as every other test file in this
// suite that writes opera front matter directly).
{
  const dir = tmpRepo();
  const studio = join(dir, "studio"); // INSIDE the repo — the real layout
  try {
    mkdirSync(join(studio, "opera"), { recursive: true });
    writeFileSync(join(studio, "opera", "W-101.md"), '---\nid: "W-101"\nstate: done\n---\n');
    writeFileSync(join(studio, "bisellium.yml"), "bisellium: 1\nstudio: Test\nprobationes:\n  - { id: tests, name: Tests, kind: automated }\n");
    execSync("git add . && git commit -m 'studio bookkeeping: open W-101'", { cwd: dir, stdio: "pipe" });

    createOpusBranch(dir, "W-101");
    execSync("git checkout opus/W-101", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work, never verified");
    execSync("git add . && git commit -m 'feat: add feature, never verified'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-101", studio);
    check(28, "absence rule removed: an automated gate with no recorded tree: certificate does not by itself refuse the merge", result.ok === true, String(result.error));
    check(28, "feature commit lands on master", masterLog(dir).includes("never verified"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// round-6 review: two blockers on top of B5.1's branch-ref read. B6.3 —
// `readOpusRecord` supplies `state` from the branch too, and nothing pinned
// that (M-1 in the review's mutation sweep was only caught by 26/27's
// certificate assertions). B6.2 — the stale-certificate remedy was one
// commit short of achievable end to end. Both use `studio` INSIDE the repo,
// same reason as 26-28.
// ---------------------------------------------------------------------------

// behaviour 29 (round 6, B6.3, pre-implementation): `state` is read from
// `branch`, not from whatever `--studio` shows on disk when `merge` runs.
{
  // (a) branch says done, the trunk's own (never-updated) disk copy still
  // says building — merge must trust the branch and succeed.
  const dir = tmpRepo();
  const studio = join(dir, "studio");
  try {
    mkdirSync(join(studio, "opera"), { recursive: true });
    writeFileSync(join(studio, "opera", "W-102.md"), '---\nid: "W-102"\nstate: building\n---\n');
    execSync("git add . && git commit -m 'studio bookkeeping: open W-102'", { cwd: dir, stdio: "pipe" });

    createOpusBranch(dir, "W-102");
    execSync("git checkout opus/W-102", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(studio, "opera", "W-102.md"), '---\nid: "W-102"\nstate: done\n---\n');
    execSync("git add . && git commit -m 'bookkeeping: done on the branch'", { cwd: dir, stdio: "pipe" });
    // master's own copy of the record is never touched — it still says
    // "building" on disk once checked out.
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-102", studio);
    check(29, "state read from the branch: a done branch merges even though the trunk's disk copy still says building", result.ok === true, String(result.error));
    check(29, "feature commit lands on master", masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  // (b) branch genuinely is not done; the trunk's own disk copy was (wrongly)
  // edited to say done — merge must trust the branch and refuse, naming it.
  const dir = tmpRepo();
  const studio = join(dir, "studio");
  try {
    mkdirSync(join(studio, "opera"), { recursive: true });
    writeFileSync(join(studio, "opera", "W-103.md"), '---\nid: "W-103"\nstate: building\n---\n');
    execSync("git add . && git commit -m 'studio bookkeeping: open W-103'", { cwd: dir, stdio: "pipe" });

    createOpusBranch(dir, "W-103");
    execSync("git checkout opus/W-103", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });
    // branch's OWN record is never advanced past "building".
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(studio, "opera", "W-103.md"), '---\nid: "W-103"\nstate: done\n---\n');
    execSync("git add . && git commit -m 'bookkeeping: (wrongly) mark done on master only'", { cwd: dir, stdio: "pipe" });

    const result = mergeOpusBranch(dir, "W-103", studio);
    check(29, "state read from the branch: a wrongly-edited trunk copy does not fool merge into landing an unfinished branch", result.ok === false, String(result.error));
    check(29, "the refusal names the branch, not just a bare state", (result.error ?? "").includes("opus/W-103"), String(result.error));
    check(29, "the refusal names the branch's real state", (result.error ?? "").includes("building"), String(result.error));
    check(29, "master untouched beyond its own bookkeeping commit", !masterLog(dir).includes("feat: add feature"), masterLog(dir).trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// behaviour 30 (round 6, B6.2, pre-implementation): the stale-certificate
// remedy, followed LITERALLY (check out the branch, re-verify, commit the
// result there, switch back, retry) lands the merge — proving the commit
// step the message now names is both necessary and sufficient (round-6
// lab9: the same sequence without that step never terminates).
{
  const dir = tmpRepo();
  const studio = join(dir, "studio");
  try {
    mkdirSync(join(studio, "opera"), { recursive: true });
    writeFileSync(join(studio, "opera", "W-104.md"), '---\nid: "W-104"\nstate: done\n---\n');
    execSync("git add . && git commit -m 'studio bookkeeping: open W-104'", { cwd: dir, stdio: "pipe" });

    createOpusBranch(dir, "W-104");
    execSync("git checkout opus/W-104", { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "feature.ts"), "opus work");
    execSync("git add . && git commit -m 'feat: add feature'", { cwd: dir, stdio: "pipe" });

    const excludeDirs = [relative(dir, studio).split(sep).join("/"), ".bisellium"];
    const firstCertified = `tree:${sourceTreeHash(dir, excludeDirs, "opus/W-104")}`;
    writeFileSync(
      join(studio, "opera", "W-104.md"),
      `---\nid: "W-104"\nstate: done\nprobationes: { tests: { status: passed, evidence: "x", certifies: "${firstCertified}" } }\n---\n`,
    );
    execSync("git add . && git commit -m 'bookkeeping: verify on the branch'", { cwd: dir, stdio: "pipe" });

    // one more commit lands after that certificate, uncertified.
    writeFileSync(join(dir, "more.ts"), "more opus work, uncertified");
    execSync("git add . && git commit -m 'feat: more work, uncertified'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const first = mergeOpusBranch(dir, "W-104", studio);
    check(30, "first attempt refuses on the stale certificate", first.ok === false, String(first.error));
    check(30, "the remedy names the missing commit step", (first.error ?? "").includes("commit the result on opus/W-104"), String(first.error));

    // Follow the remedy verbatim: check out the branch, re-verify, COMMIT
    // the result there, switch back, retry.
    execSync("git checkout opus/W-104", { cwd: dir, stdio: "pipe" });
    const secondCertified = `tree:${sourceTreeHash(dir, excludeDirs, "opus/W-104")}`;
    writeFileSync(
      join(studio, "opera", "W-104.md"),
      `---\nid: "W-104"\nstate: done\nprobationes: { tests: { status: passed, evidence: "x", certifies: "${secondCertified}" } }\n---\n`,
    );
    execSync("git add . && git commit -m 'bookkeeping: verify on the branch, again'", { cwd: dir, stdio: "pipe" });
    execSync("git checkout master", { cwd: dir, stdio: "pipe" });

    const second = mergeOpusBranch(dir, "W-104", studio);
    check(30, "the remedy, followed literally with the commit step, lands the merge", second.ok === true, String(second.error));
    check(30, "both commits reach master", masterLog(dir).includes("feat: add feature") && masterLog(dir).includes("more work, uncertified"), masterLog(dir).trim());
    check(30, "the branch is cleaned up", !branches(dir).includes("opus/W-104"), branches(dir).join(","));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
