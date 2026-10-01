/**
 * W-125 focused red suite. Select exactly one numbered behaviour with
 * `--behaviour N`; omitting the selector runs all four plus the pre-existing
 * run regressions for test:suite.
 *
 * Every row owns a fresh temporary repository and officina. Nothing here
 * reads from or writes to studio/ or examples/sample-studio.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { gitWorktreeProvider, type WorktreeProvider } from "@bisellium/shim";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 4)) {
  console.error("run.test.ts: --behaviour must be an integer from 1 through 4");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;
const NOW = new Date("2026-10-02T00:00:00.000Z");
const OPUS = "W-125";

const roots: string[] = [];
function scratch(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `w125-run-${tag}-`));
  roots.push(root);
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${detail}`);
  }
}

interface Fixture {
  repo: string;
  studio: string;
}

function writeManifest(studio: string): void {
  mkdirSync(join(studio, "opera"), { recursive: true });
  mkdirSync(join(studio, "briefs"), { recursive: true });
  mkdirSync(join(studio, "ci"), { recursive: true });
  writeFileSync(
    join(studio, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-125 focused fixture",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: eng-lead, collegium: engineering, kind: agent }",
      "  - { id: builder, collegium: engineering, kind: agent }",
      "  - { id: builder-a, collegium: engineering, kind: agent, retired: true }",
      "probationes: []",
      "source_excludes: [studio/]",
      "",
    ].join("\n"),
  );
}

function fixture(tag: string, prepare?: (repo: string, studio: string) => void): Fixture {
  const repo = scratch(tag);
  git(repo, ["init", "-q", "-b", "master"]);
  git(repo, ["config", "user.name", "W-125 Test"]);
  git(repo, ["config", "user.email", "w125@example.invalid"]);
  const studio = join(repo, "studio");
  writeManifest(studio);
  writeFileSync(join(repo, "source.txt"), "candidate source\n");
  prepare?.(repo, studio);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "test: establish W-125 fixture"]);
  git(repo, ["branch", `opus/${OPUS}`]);
  return { repo, studio };
}

async function run(args: string[], provider?: WorktreeProvider): Promise<{ exitCode: number; errors: string[] }> {
  // Lazy by design: a selected red must reach its assertion even if another
  // phase later introduces a private builder module beside run.ts.
  const { runCommand } = await import("./run.js");
  const oldLog = console.log;
  const oldError = console.error;
  const errors: string[] = [];
  console.log = () => undefined;
  console.error = (...parts: unknown[]) => errors.push(parts.map(String).join(" "));
  try {
    const result = await runCommand(args, { now: NOW, ...(provider === undefined ? {} : { provider }) });
    return { ...result, errors };
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
}

function builderArgs(f: Fixture, extra: string[], cmd: string[]): string[] {
  return [
    "--sella", "builder", "--opus", OPUS, "--studio", f.studio,
    "--repo", f.repo, ...extra, "--", ...cmd,
  ];
}

function oneReceipt(studio: string, sella = `builder.${OPUS}`): Record<string, unknown> {
  const receiptDir = join(studio, "receipts", sella);
  const files = readdirSync(receiptDir).filter((name) => name.endsWith(".json"));
  if (files.length !== 1) throw new Error(`expected one receipt in ${receiptDir}, found ${files.length}`);
  return JSON.parse(readFileSync(join(receiptDir, files[0]!), "utf8")) as Record<string, unknown>;
}

if (runs(1)) {
  test("W-125 behaviour 1: builder admission refuses in-place execution", async () => {
    const f = fixture("b1-admission");

    // Generic, non-builder execution remains an in-place runner contract.
    const generic = await run([
      "--sella", "eng-lead", "--studio", f.studio, "--repo", f.repo,
      "--no-worktree", "--", process.execPath, "-e", "process.exit(0)",
    ]);
    assert.equal(generic.exitCode, 0);

    // Genuine pre-change red: current run.ts accepts this builder flag and
    // executes the child in the caller's officina.
    const admitted = await run(builderArgs(f, ["--no-worktree"], [process.execPath, "-e", "process.exit(0)"]));
    assert.notEqual(admitted.exitCode, 0, "builder --no-worktree must be refused before dispatch");
  });
}

if (runs(2)) {
  test("W-125 behaviour 2: missing Git-write capability fails a zero-exit builder", async () => {
    const f = fixture("b2-capability");
    git(f.repo, ["switch", "-q", `opus/${OPUS}`]);
    const marker = join(f.repo, "git-write-capability.txt");
    writeFileSync(join(f.repo, "untracked-for-index-probe.txt"), "probe\n");

    // A private test provider exposes a real repository whose object/index
    // metadata is readable but cannot create an index lock. The wrapped
    // builder deliberately exits zero after observing the denial: run, not
    // the child fixture, owns the capability decision.
    const provider: WorktreeProvider = {
      id: "w125-unwritable-index",
      async acquire() {
        return { path: f.repo, branch: `opus/${OPUS}`, release: async () => undefined };
      },
    };
    chmodSync(join(f.repo, ".git"), 0o555);
    try {
      const probe = [
        "const {spawnSync}=require('node:child_process');",
        "const {writeFileSync}=require('node:fs');",
        "const result=spawnSync('git',['add','untracked-for-index-probe.txt'],{encoding:'utf8'});",
        "writeFileSync(process.argv[1],result.status===0?'available':'unavailable');",
        "process.exit(0);",
      ].join("");
      const result = await run(builderArgs(f, [], [process.execPath, "-e", probe, marker]), provider);
      assert.equal(readFileSync(marker, "utf8"), "unavailable", "fixture must observe the unavailable Git index write");
      assert.notEqual(result.exitCode, 0, "run must fail even though the builder fixture exits zero");
    } finally {
      chmodSync(join(f.repo, ".git"), 0o755);
    }
  });
}

if (runs(3)) {
  test("W-125 behaviour 3: producer gates reject a zero-exit builder when an existing suite fails", async () => {
    const f = fixture("b3-producer-gates", (repo) => {
      writeFileSync(
        join(repo, "existing-suite.test.mjs"),
        [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "test('existing candidate regression', () => assert.equal('broken', 'green'));",
          "",
        ].join("\n"),
      );
    });
    git(f.repo, ["switch", "-q", `opus/${OPUS}`]);
    assert.match(readFileSync(join(f.repo, "existing-suite.test.mjs"), "utf8"), /assert\.equal\('broken', 'green'\)/);

    const provider: WorktreeProvider = {
      id: "w125-existing-suite-fixture",
      async acquire() {
        return { path: f.repo, branch: `opus/${OPUS}`, release: async () => undefined };
      },
    };

    // Genuine pre-change red: current run.ts treats the child exit alone as
    // success and never performs independent producer recomputation.
    const result = await run(builderArgs(f, [], [process.execPath, "-e", "process.exit(0)"]), provider);
    assert.notEqual(result.exitCode, 0, "producer recomputation must make the run fail");
  });
}

if (runs(4)) {
  test("W-125 behaviour 4: --keep never preserves the disposable builder runtime", async () => {
    const f = fixture("b4-disposal");
    const result = await run(builderArgs(f, ["--keep"], [process.execPath, "-e", "process.exit(0)"]), gitWorktreeProvider);
    assert.equal(result.exitCode, 0, `the zero-exit builder fixture must reach teardown: ${result.errors.join("; ")}`);
    const receipt = oneReceipt(f.studio);
    const runtime = receipt["cwd"];
    assert.equal(typeof runtime, "string", "the diagnostic receipt must name the runtime path");

    // Genuine pre-change red: current run.ts deliberately keeps a clean
    // generic worktree when --keep is supplied.
    assert.equal(existsSync(runtime as string), false, "the disposable runtime must be gone before run returns");
  });
}

// The W-026/W-089 coverage that occupied this file before W-125 remains in
// the ordinary suite, but never contaminates a selected one-row red.
if (only === undefined) {
  test("existing run regressions: opus base, retirement and instance surfaces", async () => {
    const conflict = await run(["--sella", "builder", "--opus", "W-100", "--base", "other", "--", "true"]);
    assert.equal(conflict.exitCode, 2);

    const f = fixture("legacy-opus-base");
    git(f.repo, ["switch", "-q", `opus/${OPUS}`]);
    writeFileSync(join(f.repo, "opus-marker.txt"), "opus base marker\n");
    git(f.repo, ["add", "opus-marker.txt"]);
    git(f.repo, ["commit", "-q", "-m", "test: add opus-only marker"]);
    git(f.repo, ["switch", "-q", "master"]);
    const worktree = join(f.repo, ".bisellium", "worktrees", "eng-lead-1");
    const based = await run([
      "--sella", "eng-lead", "--opus", OPUS, "--studio", f.studio,
      "--repo", f.repo, "--keep", "--", process.execPath, "-e", "process.exit(0)",
    ], gitWorktreeProvider);
    assert.equal(based.exitCode, 0);
    assert.equal(readFileSync(join(worktree, "opus-marker.txt"), "utf8"), "opus base marker\n");
    assert.equal(existsSync(join(f.repo, "opus-marker.txt")), false);

    const exactRetired = await run([
      "--sella", "builder-a", "--studio", f.studio, "--no-worktree", "--", "true",
    ]);
    assert.equal(exactRetired.exitCode, 2);
    const retiredInstance = await run([
      "--sella", "builder-a.W-200", "--studio", f.studio, "--no-worktree", "--", "true",
    ]);
    assert.equal(retiredInstance.exitCode, 2);
    const bare = await run(["--sella", "builder", "--studio", f.studio, "--no-worktree", "--", "true"]);
    assert.equal(bare.exitCode, 2);
    const matchingInstance = await run([
      "--sella", "builder.W-200", "--opus", "W-200", "--studio", f.studio,
      "--no-worktree", "--", "true",
    ]);
    assert.equal(matchingInstance.exitCode, 0);
    rmSync(join(f.studio, "receipts", "builder.W-200"), { recursive: true, force: true });
    const mismatch = await run([
      "--sella", "builder.W-200", "--opus", "W-999", "--studio", f.studio,
      "--no-worktree", "--", "true",
    ]);
    assert.equal(mismatch.exitCode, 2);

    const out = join(f.repo, "instance-email.txt");
    const minted = await run([
      "--sella", "builder", "--opus", "W-200", "--studio", f.studio,
      "--no-worktree", "--", process.execPath, "-e",
      "require('node:fs').writeFileSync(process.argv[1],process.env.GIT_AUTHOR_EMAIL)", out,
    ]);
    assert.equal(minted.exitCode, 0);
    assert.equal(readFileSync(out, "utf8").split("@")[0], "builder.W-200");
    assert.equal(readFileSync(out, "utf8"), "builder.W-200@w-125-focused-fixture.bisellium");
    assert.equal(oneReceipt(f.studio, "builder.W-200")["exitCode"], 0);
  });
}
