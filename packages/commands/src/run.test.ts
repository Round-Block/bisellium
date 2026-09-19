/**
 * packages/commands/src/run.test.ts — W-026 behaviour 7: `bisellium run
 * --opus <id>` forks its worktree from `opus/<id>`, not HEAD. Round-2
 * review (studio/ci/W-026-review-2.log, finding 3): every existing runCommand
 * test passes `--no-worktree`, so run.ts's `--opus`/`--base` guard and the
 * `base = opus/${opus}` wiring (run.ts, around the mutual-exclusion check
 * and the `--opus` branch) were never exercised by any test.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitWorktreeProvider } from "@bisellium/shim";
import { runCommand } from "./run.js";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function writeStudio(root: string, sella: string): void {
  writeFileSync(
    join(root, "bisellium.yml"),
    `bisellium: 1
studio: Run Opus Test Studio
patron: patron
collegia:
  - { id: production, name: Production, magister: ${sella} }
sellae:
  - { id: ${sella}, collegium: production, kind: agent }
probationes: []
`,
  );
}

// --opus and --base are mutually exclusive (run.ts's guard on both flags) —
// this needs no repo or studio at all, since the check runs before either
// is touched.
{
  const result = await runCommand(["--sella", "builder-1", "--opus", "W-100", "--base", "other", "--", "true"]);
  check("--opus and --base together exits 2", result.exitCode === 2, String(result.exitCode));
}

// run --opus forks the worktree from the opus branch, not HEAD
{
  const repo = mkdtempSync(join(tmpdir(), "run-opus-repo-"));
  const studio = mkdtempSync(join(tmpdir(), "run-opus-studio-"));
  const sella = "builder-1";
  const worktreePath = join(repo, ".bisellium", "worktrees", `${sella}-1`);
  try {
    git(repo, ["init", "-q", "-b", "master"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(join(repo, "README.md"), "init\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    git(repo, ["branch", "opus/W-100"]);
    git(repo, ["checkout", "-q", "opus/W-100"]);
    writeFileSync(join(repo, "opus-marker.txt"), "only on the opus branch\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "opus work"]);
    git(repo, ["checkout", "-q", "master"]);

    writeStudio(studio, sella);

    const result = await runCommand(
      ["--sella", sella, "--studio", studio, "--repo", repo, "--opus", "W-100", "--keep", "--", "true"],
      { provider: gitWorktreeProvider },
    );
    check("run --opus: exits 0", result.exitCode === 0, String(result.exitCode));
    check(
      "worktree forked from the opus branch, not HEAD",
      existsSync(join(worktreePath, "opus-marker.txt")),
      worktreePath,
    );
    check("HEAD (master) never got the opus commit", !existsSync(join(repo, "opus-marker.txt")), repo);
  } finally {
    if (existsSync(worktreePath)) {
      try {
        git(repo, ["worktree", "remove", "--force", worktreePath]);
        git(repo, ["branch", "-D", `bisellium/${sella}/1`]);
      } catch {
        // best-effort cleanup — the rmSync below still removes the files
      }
    }
    rmSync(repo, { recursive: true, force: true });
    rmSync(studio, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
