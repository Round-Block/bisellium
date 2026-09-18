/**
 * packages/shim/test/shim.test.ts — W-008 (worktree seam + run receipts).
 * Exercises gitWorktreeProvider directly and runCommand/checkStudio (which
 * live in packages/cli/src) end to end against a temp git repo / studio.
 * `now` is pinned so receipt/age-derived text never drifts.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitWorktreeProvider, filterEnv } from "../src/index.js";
import { runCommand } from "../../cli/src/run.js";
import { checkStudio } from "../../cli/src/check.js";
import { localPipeline } from "../../pipeline/src/index.js";

const NOW = new Date("2026-09-18T09:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
};

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function readReceipt(studio: string, sella: string): { path: string; data: Record<string, unknown> } {
  const dir = join(studio, "receipts", sella);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  if (files.length !== 1) throw new Error(`expected exactly 1 receipt in ${dir}, found ${files.length}`);
  const path = join(dir, files[0]!);
  return { path, data: JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> };
}

// ---- gitWorktreeProvider: acquire on a new branch, release removes it -------

{
  const repo = mktemp("shim-git-repo-");
  try {
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "README.md"), "hello\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const wt = await gitWorktreeProvider.acquire({ repo, sella: "builder-1" });
    check("acquire: worktree path exists", existsSync(wt.path), wt.path);
    check("acquire: branch is bisellium/builder-1/1", wt.branch === "bisellium/builder-1/1", wt.branch);

    const branchList = spawnSync("git", ["-C", repo, "worktree", "list"], { encoding: "utf8" }).stdout;
    check("acquire: `git worktree list` includes the new worktree", branchList.includes(wt.path), branchList);

    await wt.release();
    check("release: worktree path removed", !existsSync(wt.path));
    const branches = spawnSync("git", ["-C", repo, "branch", "--list", "bisellium/builder-1/1"], { encoding: "utf8" }).stdout.trim();
    check("release: branch deleted", branches === "", JSON.stringify(branches));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// ---- runCommand: --no-worktree, exit codes and receipts ---------------------

{
  const studio = mktemp("shim-studio-");
  try {
    writeStudio(studio);

    const ok = await runCommand(["--sella", "builder-1", "--studio", studio, "--no-worktree", "--", "true"], { now: NOW });
    check("run true: exitCode 0", ok.exitCode === 0, String(ok.exitCode));
    const okReceipt = readReceipt(studio, "builder-1");
    check("run true: receipt exitCode 0", okReceipt.data["exitCode"] === 0, JSON.stringify(okReceipt.data));
    check("run true: receipt has endedAt", typeof okReceipt.data["endedAt"] === "string", JSON.stringify(okReceipt.data));
    rmSync(join(studio, "receipts"), { recursive: true, force: true });

    const bad = await runCommand(["--sella", "builder-1", "--studio", studio, "--no-worktree", "--", "false"], { now: NOW });
    check("run false: exitCode 1", bad.exitCode === 1, String(bad.exitCode));
    const badReceipt = readReceipt(studio, "builder-1");
    check("run false: receipt exitCode 1", badReceipt.data["exitCode"] === 1, JSON.stringify(badReceipt.data));
    rmSync(join(studio, "receipts"), { recursive: true, force: true });

    const unknown = await runCommand(["--sella", "nobody", "--studio", studio, "--no-worktree", "--", "true"], { now: NOW });
    check("run: unknown sella exits 2", unknown.exitCode === 2, String(unknown.exitCode));

    const noSep = await runCommand(["--sella", "builder-1", "--studio", studio, "--no-worktree"], { now: NOW });
    check("run: missing '--' exits 2", noSep.exitCode === 2, String(noSep.exitCode));

    const emptyCmd = await runCommand(["--sella", "builder-1", "--studio", studio, "--no-worktree", "--"], { now: NOW });
    check("run: empty cmd exits 2", emptyCmd.exitCode === 2, String(emptyCmd.exitCode));

    // ---- checkStudio: receipt.shape fires on a garbage receipt -------------
    const garbageDir = join(studio, "receipts", "builder-1");
    mkdirSync(garbageDir, { recursive: true });
    writeFileSync(join(garbageDir, "garbage.json"), "not json at all {{{");
    const result = checkStudio(studio, NOW);
    const rules = result.findings.map((f) => f.rule);
    check("checkStudio: receipt.shape fires on garbage receipt", rules.includes("receipt.shape"), JSON.stringify(rules));
    rmSync(garbageDir, { recursive: true, force: true });

    // ---- logs and receipts hygiene: a receipt's cmd is masked --------------
    const secretRun = await runCommand(["--sella", "builder-1", "--studio", studio, "--no-worktree", "--", "echo", "--token=abc123"], { now: NOW });
    check("run echo --token=abc123: exitCode 0", secretRun.exitCode === 0, String(secretRun.exitCode));
    const secretReceipt = readReceipt(studio, "builder-1");
    const cmd = secretReceipt.data["cmd"] as string[];
    check(
      "run: receipt cmd masks token=... rather than storing it verbatim",
      cmd.join(" ").includes("token=***") && !cmd.join(" ").includes("abc123"),
      JSON.stringify(cmd),
    );
    rmSync(join(studio, "receipts"), { recursive: true, force: true });

    // ---- flag parsing: a value that looks like another flag is an error ----
    const swallowed = await runCommand(["--sella", "--no-worktree", "--studio", studio, "--", "true"], { now: NOW });
    check("run: --sella --no-worktree does not swallow the flag as a value", swallowed.exitCode === 2, String(swallowed.exitCode));

    const missingStudioValue = await runCommand(["--sella", "builder-1", "--no-worktree", "--studio"], { now: NOW });
    check("run: --studio as the last arg (no value) exits 2", missingStudioValue.exitCode === 2, String(missingStudioValue.exitCode));

    // ---- child killed by signal -> exit 128+signal -------------------------
    const killed = await runCommand(
      ["--sella", "builder-1", "--studio", studio, "--no-worktree", "--", process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"],
      { now: NOW },
    );
    check("run: child killed by SIGTERM exits 128+15", killed.exitCode === 143, String(killed.exitCode));
  } finally {
    rmSync(studio, { recursive: true, force: true });
  }
}

// ---- filterEnv: GIT_CONFIG_* is an atomic family, never partially dropped --
// A sandbox that injects git config via GIT_CONFIG_COUNT/KEY_n/VALUE_n has
// KEY_n match /KEY/i (secret-shaped) while COUNT and VALUE_n don't. Dropping
// only the KEY_ns leaves git a config count with no keys behind it — it dies
// on every invocation. VALUE_n can itself carry an injected credential, so
// the fix is not to allowlist the family through; it's to drop the whole
// family together whenever any member of it would be dropped.

{
  const withGitConfig: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "Test",
    GIT_CONFIG_KEY_1: "user.email",
    GIT_CONFIG_VALUE_1: "test@example.com",
    SOME_API_TOKEN: "shhh",
  };
  const out = filterEnv(withGitConfig);
  const gitConfigKeysKept = Object.keys(out).filter((k) => k.startsWith("GIT_CONFIG_"));
  check("filterEnv: GIT_CONFIG_* family dropped atomically (none kept)", gitConfigKeysKept.length === 0, JSON.stringify(gitConfigKeysKept));
  check("filterEnv: unrelated secret-shaped var still dropped", !("SOME_API_TOKEN" in out), JSON.stringify(Object.keys(out)));
  check("filterEnv: PATH still passed through", out["PATH"] === "/usr/bin", JSON.stringify(out));

  const withoutKeys: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
  const out2 = filterEnv(withoutKeys);
  check("filterEnv: no GIT_CONFIG_* present -> nothing to drop, PATH kept", out2["PATH"] === "/usr/bin", JSON.stringify(out2));
}

// ---- integration: a probatio command shelling to git survives a --------
// ---- GIT_CONFIG_*-injecting env (packages/pipeline's localPipeline) -----

{
  const repo = mktemp("shim-gitconfig-repo-");
  const logDir = mktemp("shim-gitconfig-logs-");
  const savedEnv: Record<string, string | undefined> = {};
  const injected = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_KEY_1", "GIT_CONFIG_VALUE_1"];
  for (const k of injected) savedEnv[k] = process.env[k];
  try {
    git(repo, ["init", "-q"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "README.md"), "hello\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "init"]);

    process.env["GIT_CONFIG_COUNT"] = "2";
    process.env["GIT_CONFIG_KEY_0"] = "user.name";
    process.env["GIT_CONFIG_VALUE_0"] = "Sandbox";
    process.env["GIT_CONFIG_KEY_1"] = "user.email";
    process.env["GIT_CONFIG_VALUE_1"] = "sandbox@example.com";

    const results = await localPipeline.run({
      opus: { id: "W-GITCONFIG" } as never,
      repo,
      commands: { tests: "git rev-parse HEAD" },
      treeHash: "0000000000000000000000000000000000000",
      logDir,
      now: NOW,
      studioDir: logDir,
    });
    check(
      "localPipeline: `git rev-parse HEAD` passes under a GIT_CONFIG_*-injecting env",
      results["tests"]?.status === "passed",
      JSON.stringify(results),
    );
  } finally {
    for (const k of injected) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
}

function mktemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeStudio(root: string): void {
  writeFileSync(
    join(root, "bisellium.yml"),
    `bisellium: 1
studio: Shim Test Studio
patron: patron
collegia:
  - { id: production, name: Production, magister: builder-1 }
sellae:
  - { id: builder-1, collegium: production, kind: agent }
probationes: []
`,
  );
}

process.exit(failed ? 1 : 0);
