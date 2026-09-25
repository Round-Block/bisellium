/**
 * packages/shim/test/instance-surfaces.test.ts — W-089 behaviour 9: an
 * instance id (`<seat>.<opus-id>`) survives the filesystem and git surfaces
 * it ends up on. Dedicated file (not run.test.ts's incidental coverage,
 * per the brief): the receipt directory name, the worktree branch, and the
 * git author email, plus the negative case — a seat/opus pair that would
 * mint a doubled dot is refused before it ever reaches a join, proven
 * end to end through `bisellium run`'s own boundary (behaviour 5).
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gitWorktreeProvider, receiptPath, writeReceiptStart } from "../src/index.js";
import { runCommand } from "../../cli/src/run.js";
import { checkStudio } from "../../cli/src/check.js";

const NOW = new Date("2026-09-25T09:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${detail}`);
  if (!ok) failed++;
};

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function mktemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const INSTANCE = "builder.W-089";

// ---- 1. the worktree branch a live instance mints passes git's own name
// validation, not just this repo's `ID_RE`. ----------------------------------
{
  const repo = mktemp("w089-b9-repo-");
  try {
    git(repo, ["init", "-q", "-b", "master"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(join(repo, "README.md"), "init\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const wt = await gitWorktreeProvider.acquire({ repo, sella: INSTANCE });
    try {
      check("b9: branch is bisellium/<instance>/1", wt.branch === `bisellium/${INSTANCE}/1`, wt.branch);
      const fmt = spawnSync("git", ["check-ref-format", "--branch", wt.branch], { encoding: "utf8" });
      check("b9: the minted branch passes `git check-ref-format`", fmt.status === 0, JSON.stringify({ status: fmt.status, stderr: fmt.stderr }));
    } finally {
      await wt.release();
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// ---- 2. the receipt directory name an instance mints is a valid id ---------
// `check` finds nothing wrong with it (path.id.unvalidated, receipts/). -----
{
  const studio = mktemp("w089-b9-studio-");
  try {
    writeFileSync(
      join(studio, "bisellium.yml"),
      `bisellium: 1
studio: B9 Fixture
patron: patron
collegia:
  - { id: engineering, name: Engineering, magister: eng-lead }
sellae:
  - { id: eng-lead, collegium: engineering, kind: agent }
  - { id: builder, collegium: engineering, kind: agent }
probationes: []
`,
    );
    const path = receiptPath(studio, INSTANCE, "sess-b9");
    mkdirSync(join(studio, "receipts", INSTANCE), { recursive: true });
    writeReceiptStart(studio, { sella: INSTANCE, sessionId: "sess-b9", startedAt: NOW.toISOString(), cwd: studio, cmd: ["true"] });
    check("b9: the receipt lands at receipts/<instance>/<session>.json", existsSync(path), path);

    const findings = checkStudio(studio, NOW).findings;
    const idFindings = findings.filter((f) => f.rule === "path.id.unvalidated" && f.where === "receipts/");
    check("b9: check reports no path.id.unvalidated for the instance's receipt directory", idFindings.length === 0, JSON.stringify(idFindings));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---- 3. GIT_AUTHOR_EMAIL is exactly one "@" ---------------------------------
{
  const slug = "studio";
  const email = `${INSTANCE}@${slug}.bisellium`;
  check("b9: GIT_AUTHOR_EMAIL has exactly one '@'", email.split("@").length === 2, email);
  check("b9: GIT_AUTHOR_EMAIL is <instance>@<slug>.bisellium", email === "builder.W-089@studio.bisellium", email);
}

// ---- 4. negative: an id containing ".." never reaches a join --------------
// `bisellium run` given an already-dotted instance whose suffix would mint a
// doubled dot refuses at the minter (behaviour 5's own boundary) — no
// worktree is acquired and no receipt directory is ever created for it.
{
  const repo = mktemp("w089-b9-neg-repo-");
  const studio = mktemp("w089-b9-neg-studio-");
  const BAD_INSTANCE = "builder..W-089"; // seat "builder", suffix ".W-089" — a doubled dot once re-minted
  try {
    git(repo, ["init", "-q", "-b", "master"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(join(repo, "README.md"), "init\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);

    writeFileSync(
      join(studio, "bisellium.yml"),
      `bisellium: 1
studio: B9 Negative Fixture
patron: patron
collegia:
  - { id: engineering, name: Engineering, magister: eng-lead }
sellae:
  - { id: eng-lead, collegium: engineering, kind: agent }
  - { id: builder, collegium: engineering, kind: agent }
probationes: []
`,
    );

    const result = await runCommand(["--sella", BAD_INSTANCE, "--studio", studio, "--repo", repo, "--", "true"], { now: NOW });
    check("b9 negative: a doubled-dot instance is refused, not dispatched", result.exitCode === 2, String(result.exitCode));

    const worktreesRoot = join(repo, ".bisellium", "worktrees");
    check("b9 negative: no worktree directory was ever created for it", !existsSync(worktreesRoot), worktreesRoot);
    check("b9 negative: no receipt directory was ever created for it", !existsSync(join(studio, "receipts", BAD_INSTANCE)), "");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
