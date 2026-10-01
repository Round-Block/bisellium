/**
 * packages/commands/src/run.test.ts — W-026 behaviour 7: `bisellium run
 * --opus <id>` forks its worktree from `opus/<id>`, not HEAD. Round-2
 * review (studio/ci/W-026-review-2.log, finding 3): every existing runCommand
 * test passes `--no-worktree`, so run.ts's `--opus`/`--base` guard and the
 * `base = opus/${opus}` wiring (run.ts, around the mutual-exclusion check
 * and the `--opus` branch) were never exercised by any test.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// W-089 behaviour 6 — the group-A membership site at run.ts:160 refuses a
// retired sella (exact name or one of its instance ids), no worktree
// acquired, no receipt written.
// ---------------------------------------------------------------------------
function writeStudioRetired(root: string): void {
  writeFileSync(
    join(root, "bisellium.yml"),
    `bisellium: 1
studio: Run Retired Test Studio
patron: patron
collegia:
  - { id: engineering, name: Engineering, magister: builder }
sellae:
  - { id: builder, collegium: engineering, kind: agent }
  - { id: builder-a, collegium: engineering, kind: agent, retired: true }
probationes: []
`,
  );
}

{
  const studio = mkdtempSync(join(tmpdir(), "run-retired-studio-"));
  writeStudioRetired(studio);

  const exact = await runCommand(["--sella", "builder-a", "--studio", studio, "--no-worktree", "--", "true"]);
  check("run: an exact retired sella exits 2", exact.exitCode === 2, String(exact.exitCode));

  const instance = await runCommand(["--sella", "builder-a.W-200", "--studio", studio, "--no-worktree", "--", "true"]);
  check("run: an instance of a retired sella also exits 2", instance.exitCode === 2, String(instance.exitCode));

  const live = await runCommand(["--sella", "builder", "--opus", "W-1", "--studio", studio, "--no-worktree", "--", "true"]);
  check("run: the live template itself is unaffected", live.exitCode === 0, String(live.exitCode));

  rmSync(studio, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// W-089 behaviour 5: run --sella <builder-class template> --opus <id> mints
// the instance before dispatch and carries it into BISELLIUM_SELLA and the
// receipt. A non-builder-class seat is unaffected.
// ---------------------------------------------------------------------------
{
  const studio = mkdtempSync(join(tmpdir(), "run-mint-studio-"));
  writeStudioRetired(studio); // declares "builder" (live) and "builder-a" (retired)
  const outFile = join(studio, "out.txt");

  const minted = await runCommand([
    "--sella",
    "builder",
    "--opus",
    "W-100",
    "--studio",
    studio,
    "--no-worktree",
    "--",
    process.execPath,
    "-e",
    "require('fs').writeFileSync(process.argv[1], process.env.BISELLIUM_SELLA)",
    outFile,
  ]);
  check("run: mints the instance — exits 0", minted.exitCode === 0, String(minted.exitCode));
  check("run: the child sees BISELLIUM_SELLA=builder.W-100", readFileSync(outFile, "utf8") === "builder.W-100", readFileSync(outFile, "utf8"));
  const receiptDirs = readdirSync(join(studio, "receipts"));
  check("run: the receipt lives under receipts/builder.W-100/, not receipts/builder/", receiptDirs.includes("builder.W-100") && !receiptDirs.includes("builder"), JSON.stringify(receiptDirs));

  const bareTemplate = await runCommand(["--sella", "builder", "--studio", studio, "--no-worktree", "--", "true"]);
  check("run: a bare builder template with no --opus cannot be minted — refused", bareTemplate.exitCode === 2, String(bareTemplate.exitCode));

  const alreadyInstance = await runCommand(["--sella", "builder.W-200", "--opus", "W-200", "--studio", studio, "--no-worktree", "--", "true"]);
  check("run: a supplied instance whose suffix matches --opus succeeds", alreadyInstance.exitCode === 0, String(alreadyInstance.exitCode));

  const disagreement = await runCommand(["--sella", "builder.W-200", "--opus", "W-999", "--studio", studio, "--no-worktree", "--", "true"]);
  check("run: a supplied instance disagreeing with --opus exits 2 before dispatch", disagreement.exitCode === 2, String(disagreement.exitCode));

  rmSync(studio, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
