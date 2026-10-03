/**
 * W-125 focused red suite. Select exactly one numbered behaviour with
 * `--behaviour N`; omitting the selector runs all four plus the pre-existing
 * run regressions for test:suite.
 *
 * W-132 rows (the Git broker's transport is a pair of host-created named
 * pipes) sit at the end of the file. They are selected by name, never by
 * `--behaviour`: `--test-name-pattern=W-132-b1` through `W-132-b4`, one row
 * each. They register only when no `--behaviour` is given.
 *
 * W-134 rows (a red's identity survives a rebase) follow the W-132 rows, also
 * selected by name: `--test-name-pattern=W-134-b1` through `W-134-b4`. Rows
 * b1-b3 are live (the real runner, bwrap and a rebased branch); b4 is the
 * receipt gate's own seam. They register only when no `--behaviour` is given.
 *
 * Every row owns a fresh temporary repository and officina. Nothing here
 * reads from or writes to studio/ or examples/sample-studio.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { WorktreeProvider } from "@bisellium/shim";
import { readFront } from "@bisellium/adapter-native";

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
  writeFileSync(
    join(studio, "opera", `${OPUS}.md`),
    [
      "---",
      `id: ${OPUS}`,
      "title: W-125 builder runtime fixture",
      "kind: task",
      "collegium: engineering",
      "state: building",
      "probationes: {}",
      "---",
      "Fixture body.",
      "",
    ].join("\n"),
  );
  writeFileSync(join(repo, "source.txt"), "candidate source\n");
  prepare?.(repo, studio);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "test: establish W-125 fixture"]);
  git(repo, ["branch", `opus/${OPUS}`]);
  return { repo, studio };
}

async function run(args: string[], provider?: WorktreeProvider): Promise<{ exitCode: number; errors: string[]; out: string[] }> {
  // Lazy by design: a selected red must reach its assertion even if another
  // phase later introduces a private builder module beside run.ts.
  const { runCommand } = await import("./run.js");
  const oldLog = console.log;
  const oldError = console.error;
  const errors: string[] = [];
  const out: string[] = [];
  console.log = (...parts: unknown[]) => void out.push(parts.map(String).join(" "));
  console.error = (...parts: unknown[]) => errors.push(parts.map(String).join(" "));
  try {
    const result = await runCommand(args, { now: NOW, ...(provider === undefined ? {} : { provider }) });
    return { ...result, errors, out };
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

function builderRuntime(studio: string): unknown {
  return readFront<Record<string, unknown>>(join(studio, "opera", `${OPUS}.md`)).data["builder_runtime"];
}

// ---------------------------------------------------------------------------
// Live rows: the REAL scripts/run-builder-host.mjs, bwrap and all. Nothing here
// uses a WorktreeProvider seam. A row skips only where bwrap is genuinely
// unusable on the host (the fixture seam rows above still run).
// ---------------------------------------------------------------------------
const RUNNER = fileURLToPath(new URL("../../../scripts/run-builder-host.mjs", import.meta.url));
const bwrapUsable =
  spawnSync("bwrap", ["--unshare-all", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--", "true"], { timeout: 10_000 }).status === 0;
const liveSkip = !bwrapUsable ? "bwrap is unusable on this host" : false;
// Every live row is recorded here so W-132 behaviour 1 can count the ones the gate skips.
const liveRows: { skipped: boolean }[] = [];
const live = (name: string, fn: () => Promise<void>): void => {
  liveRows.push({ skipped: liveSkip !== false });
  test(name, { skip: liveSkip, timeout: 240_000 }, fn);
};

// W-130: one host directory pinned as the playwright browsers path for EVERY live row, so the builder cell's
// environment-name count (W-125's 18 plus PLAYWRIGHT_BROWSERS_PATH) is 19 on a CI runner that has no browsers too.
const BROWSERS = scratch("browsers-sentinel");
const SENTINEL_TEXT = "W-130 browser cache sentinel\n";
writeFileSync(join(BROWSERS, "sentinel.txt"), SENTINEL_TEXT);

/** Same algorithm as the runner's `sourceTree`, for an officina at `studio/`. */
function sourceTreeOf(repo: string, commit: string): string {
  const hash = createHash("sha1");
  for (const line of git(repo, ["ls-tree", "-r", commit]).split("\n")) {
    const path = line.slice(line.indexOf("\t") + 1);
    if (path === "studio" || path.startsWith("studio/") || path === ".bisellium" || path.startsWith(".bisellium/")) continue;
    hash.update(`${line}\n`);
  }
  return `tree:${hash.digest("hex")}`;
}

// Fixture "host tooling": the runner clones master and runs this file as the
// producer gate; it executes the candidate's gate.mjs the way `npm test` would.
const FAKE_TOOLING = [
  'import { spawnSync } from "node:child_process";',
  'import { basename, dirname, join } from "node:path";',
  'const at = process.argv.indexOf("--repo");',
  "const repo = at < 0 ? process.cwd() : process.argv[at + 1];",
  'const run = spawnSync(process.execPath, [join(repo, "gate.mjs")], { cwd: repo, stdio: "inherit" });',
  "process.exit(run.status ?? 1);",
  "",
].join("\n");
const DEFAULT_RED = [
  "import assert from 'node:assert/strict';",
  "import { readFileSync } from 'node:fs';",
  "assert.equal(readFileSync('source.txt', 'utf8'), 'fixed\\n');",
  "",
].join("\n");
const OWNED = ["source.txt", "gate.mjs", "evidence.json"];

interface LiveOptions {
  /** Brief `Files owned`; `null` omits the section entirely. */
  owned?: string[] | null;
  behaviours?: number;
  /** Behaviours that get a red log; default 1..behaviours. */
  reds?: number[];
  gate?: string;
  red?: string;
  /** Adds node_modules/leak -> this host path, an absolute link out of the tree. */
  escapingLink?: string;
  /**
   * W-134: the owning branch is rebased onto a master that moved with a source
   * change, so no commit's source tree equals a log's `# tree:` header. `logs`
   * says how the red logs reach the branch; `title` overrides the `not ok` title
   * the log records (the replay still prints REBASED_TITLE).
   */
  rebase?: { logs: RebaseLogs; title?: string };
  /** W-130: adds an apps/web workspace (@bisellium/web) whose `build` script runs this node source. */
  web?: string;
}
type RebaseLogs = "once" | "never" | "twice" | "with-source" | "decoy" | "after-implementation";
interface Live extends Fixture {
  tmp: string;
  base: string;
  /** W-134: the rebased commit that introduced the log bytes, and the header every log claims. */
  anchor?: string;
  claimed?: string;
}

function liveFixture(tag: string, o: LiveOptions = {}): Live {
  const owned = o.owned === undefined ? OWNED : o.owned;
  const behaviours = o.behaviours ?? 1;
  const f = fixture(tag, (repo, studio) => {
    writeFileSync(join(repo, ".gitignore"), `node_modules/\n.bisellium/\n${o.web === undefined ? "" : "apps/web/dist/\n"}`);
    if (o.web !== undefined) {
      writeFileSync(join(repo, "package.json"), '{"name":"w130-fixture","private":true,"workspaces":["apps/web"]}\n');
      mkdirSync(join(repo, "apps", "web"), { recursive: true });
      writeFileSync(join(repo, "apps", "web", "package.json"), '{"name":"@bisellium/web","version":"0.0.0","private":true,"type":"module","scripts":{"build":"node build.mjs"}}\n');
      writeFileSync(join(repo, "apps", "web", "build.mjs"), o.web);
    }
    writeFileSync(join(repo, "red.mjs"), o.red ?? DEFAULT_RED);
    writeFileSync(join(repo, "gate.mjs"), o.gate ?? "console.log('gate ok');\n");
    mkdirSync(join(repo, "packages", "cli", "src"), { recursive: true });
    writeFileSync(join(repo, "packages", "cli", "src", "main.ts"), FAKE_TOOLING);
    writeFileSync(join(studio, "notes.md"), "protected bookkeeping line one\nprotected bookkeeping line two\nline three\n");
    writeFileSync(
      join(studio, "briefs", `${OPUS}.md`),
      [
        "# W-125 live fixture brief",
        "",
        ...(owned === null ? [] : ["## Files owned", "", ...owned.map((path) => `- \`${path}\` - fixture`), ""]),
        "## Behaviours to test",
        "",
        ...Array.from({ length: behaviours }, (_, i) => `${i + 1}. **Fixture behaviour ${i + 1}.**`),
        "",
        "## Out of scope",
        "",
      ].join("\n"),
    );
  });
  // Untracked + gitignored: the runner copies it into every checkout it makes.
  mkdirSync(join(f.repo, "node_modules", "tsx"), { recursive: true });
  writeFileSync(join(f.repo, "node_modules", "tsx", "package.json"), '{"name":"tsx","version":"0.0.0","type":"module","exports":"./index.mjs"}\n');
  writeFileSync(join(f.repo, "node_modules", "tsx", "index.mjs"), "");
  // npm's own shape: a RELATIVE bin link. It must still point inside every copy.
  mkdirSync(join(f.repo, "node_modules", ".bin"), { recursive: true });
  symlinkSync("../tsx/index.mjs", join(f.repo, "node_modules", ".bin", "tool"));
  if (o.escapingLink !== undefined) symlinkSync(o.escapingLink, join(f.repo, "node_modules", "leak"));
  const base = git(f.repo, ["rev-parse", "HEAD"]);
  if (o.rebase !== undefined) return { ...rebasedBranch(f, o.rebase, behaviours), tmp: scratch(`${tag}-tmp`) };
  const redDir = join(f.studio, "ci", "reds", OPUS);
  mkdirSync(redDir, { recursive: true });
  for (const n of o.reds ?? Array.from({ length: behaviours }, (_, i) => i + 1)) {
    writeFileSync(
      join(redDir, `${String(n).padStart(2, "0")}.log`),
      [`# behaviour: ${n}`, "# command: node red.mjs", "# exit: 1", `# tree: ${sourceTreeOf(f.repo, base)}`, "", "AssertionError [ERR_ASSERTION]", ""].join("\n"),
    );
  }
  return { ...f, tmp: scratch(`${tag}-tmp`), base };
}

// W-134: a builder's own test-only commit, then the host's red logs, on opus/<id>; then master
// moves with a source change and the branch is rebased onto it. Everything the red logs name is
// then unreachable by source tree, exactly as after the ladder's `pr` step.
const REBASED_TITLE = "W-134 fixture red";
const REBASED_RED = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { readFileSync } from 'node:fs';",
  `test('${REBASED_TITLE}', () => {`,
  "  assert.equal(readFileSync('source.txt', 'utf8'), 'fixed\\n');",
  "});",
  "",
].join("\n");

function rebasedBranch(f: Fixture, o: { logs: RebaseLogs; title?: string }, behaviours: number): Omit<Live, "tmp"> {
  const { repo, studio } = f;
  const branch = `opus/${OPUS}`;
  const redDir = join(studio, "ci", "reds", OPUS);
  const logPath = (n: number): string => join(redDir, `${String(n).padStart(2, "0")}.log`);
  const commitAll = (message: string): void => {
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", message]);
  };
  git(repo, ["checkout", "-q", branch]);
  // The builder's committed test-only state: the pre-change commit every log names.
  writeFileSync(join(repo, "red.mjs"), REBASED_RED);
  commitAll("test: builder test-only state");
  const claimed = sourceTreeOf(repo, "HEAD");
  const logText = (n: number): string =>
    [
      `# behaviour: ${n}`,
      "# command: node --test-reporter=tap red.mjs",
      "# exit: 1",
      `# tree: ${claimed}`,
      "",
      "TAP version 13",
      `# Subtest: ${o.title ?? REBASED_TITLE}`,
      `not ok 1 - ${o.title ?? REBASED_TITLE}`,
      "  ---",
      "  code: 'ERR_ASSERTION'",
      "  ...",
      "1..1",
      "",
    ].join("\n");
  const writeLogs = (): void => {
    mkdirSync(redDir, { recursive: true });
    for (let n = 1; n <= behaviours; n++) writeFileSync(logPath(n), logText(n));
  };
  if (o.logs === "after-implementation") {
    writeFileSync(join(repo, "source.txt"), "fixed\n");
    commitAll("feat: implementation already present");
  }
  if (o.logs !== "never") {
    writeLogs();
    if (o.logs === "with-source") writeFileSync(join(repo, "smuggled.txt"), "source beside the log\n");
    commitAll("chore(studio): record reds");
  }
  if (o.logs === "twice") {
    writeFileSync(logPath(1), `${logText(1)}# rewritten\n`);
    commitAll("chore(studio): rewrite red");
    writeLogs();
    commitAll("chore(studio): restore reds");
  }
  if (o.logs === "decoy") {
    writeFileSync(logPath(1), `${logText(1)}# decoy\n`);
    commitAll("chore(studio): decoy log");
  }
  git(repo, ["checkout", "-q", "master"]);
  writeFileSync(join(repo, "master-moved.txt"), "master moved with a source change\n");
  git(repo, ["add", "master-moved.txt"]);
  git(repo, ["commit", "-q", "-m", "feat: master moves"]);
  git(repo, ["checkout", "-q", branch]);
  git(repo, ["rebase", "-q", "master"]);
  git(repo, ["checkout", "-q", "master"]);
  writeLogs(); // the host's copy: the checkout above removed what only the branch tracks
  const anchor = git(repo, ["log", branch, "--format=%H", "--fixed-strings", "--grep=chore(studio): record reds"]).split("\n")[0];
  return { ...f, base: git(repo, ["rev-parse", `refs/heads/${branch}`]), claimed, ...(anchor ? { anchor } : {}) };
}

/** Run `fn` with the producer's temp root pinned to the row's private directory. */
async function withTmp<T>(f: Live, fn: () => Promise<T>): Promise<T> {
  const old = process.env["TMPDIR"];
  const oldBrowsers = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  process.env["TMPDIR"] = f.tmp;
  process.env["PLAYWRIGHT_BROWSERS_PATH"] = BROWSERS;
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env["TMPDIR"];
    else process.env["TMPDIR"] = old;
    if (oldBrowsers === undefined) delete process.env["PLAYWRIGHT_BROWSERS_PATH"];
    else process.env["PLAYWRIGHT_BROWSERS_PATH"] = oldBrowsers;
  }
}
const leftovers = (f: Live): string[] => readdirSync(f.tmp).filter((name) => name.startsWith("bisellium-"));
const tip = (f: Live): string => git(f.repo, ["rev-parse", `refs/heads/opus/${OPUS}`]);

// A builder child that talks to Git only through the broker on PATH.
const PRE =
  "const {spawnSync}=require('node:child_process');const fs=require('node:fs');" +
  "const git=(...a)=>{const r=spawnSync('git',a,{encoding:'utf8'});return {status:r.status,out:r.stdout||'',err:r.stderr||''}};" +
  "const commit=(m)=>{for(const a of [['add','-A'],['commit','-m',m]]){const r=git(...a);if(r.status!==0){console.error('broker git '+a.join(' ')+': '+r.err);process.exit(1)}}};";
const builder = (body: string, ...args: string[]): string[] => ["node", "-e", `${PRE}${body}`, ...args];
const FIX_AND_COMMIT = "fs.writeFileSync('source.txt','fixed\\n');commit('builder: fix source');";

/** Drives the runner directly (no parent), the way a hostile caller env would. */
function directRequest(f: Live, cmd: string[], resultFile: string): string {
  return Buffer.from(
    JSON.stringify({
      repo: f.repo, studioRoot: f.studio, studioRelative: "studio", opus: OPUS, sella: `builder.${OPUS}`,
      slug: "w-125-focused-fixture", cmd, keep: false, now: NOW.toISOString(), sessionId: "direct", leaseOwned: false, resultFile,
    }),
  ).toString("base64url");
}
interface Direct {
  status: number | null;
  stdout: string;
  stderr: string;
  result: Record<string, unknown> | undefined;
}
function readResult(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
const RUNNER_ENV = (f: Live): NodeJS.ProcessEnv => ({
  PATH: process.env["PATH"] ?? "/usr/bin",
  TMPDIR: f.tmp,
  PLAYWRIGHT_BROWSERS_PATH: BROWSERS,
  // Hostile ambient environment: none of it may reach the tool runtime or the gates.
  GITHUB_TOKEN: "ghp_HOST_SECRET", NPM_TOKEN: "npm_HOST_SECRET", SSH_AUTH_SOCK: "/host/agent.sock",
  NODE_OPTIONS: "--no-warnings", HTTPS_PROXY: "http://proxy.invalid:3128", AWS_ACCESS_KEY_ID: "AKIAHOSTSECRET",
});
function runnerRun(f: Live, cmd: string[]): Direct {
  const resultFile = join(scratch("result"), "result.json");
  const r = spawnSync(process.execPath, [RUNNER, "--request", directRequest(f, cmd, resultFile)], {
    cwd: f.repo, env: RUNNER_ENV(f), encoding: "utf8", timeout: 240_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", result: readResult(resultFile) };
}
async function waitFor(what: string, ready: () => boolean, ms = 40_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    // sleep-seam: ready -- poll cadence only; the loop exits when the ready() predicate turns true or the deadline passes
    await new Promise((ok) => setTimeout(ok, 100));
  }
}
const survivors = (needle: string): string =>
  spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8" }).stdout.split("\n").filter((line) => line.includes(needle) && !line.includes(" ps ")).join("\n");

if (runs(1)) {
  test("W-125 behaviour 1: builder admission refuses in-place execution", async () => {
    const f = fixture("b1-admission");

    // Generic, non-builder execution remains an in-place runner contract.
    const generic = await run([
      "--sella", "eng-lead", "--studio", f.studio, "--repo", f.repo,
      "--no-worktree", "--", process.execPath, "-e", "process.exit(0)",
    ]);
    assert.equal(generic.exitCode, 0);
    assert.equal(builderRuntime(f.studio), undefined, "a non-builder run must not introduce the marker");

    // Genuine pre-change red: current run.ts accepts this builder flag and
    // executes the child in the caller's officina.
    const admitted = await run(builderArgs(f, ["--no-worktree"], [process.execPath, "-e", "process.exit(0)"]));
    assert.notEqual(admitted.exitCode, 0, "builder --no-worktree must be refused before dispatch");
    assert.equal(builderRuntime(f.studio), undefined, "a builder refused by flags must not introduce the marker");
  });

  test("W-125 behaviour 1 marker written: builder admission persists before preparation and survives failures", async () => {
    const preparation = fixture("b1-marker-preparation");
    let preparationCalls = 0;
    const preparationFailure: WorktreeProvider = {
      id: "w125-preparation-failure",
      async acquire() {
        preparationCalls++;
        assert.equal(builderRuntime(preparation.studio), "isolated", "the marker must exist before runtime preparation");
        throw new Error("fixture preparation failure");
      },
    };
    const prepared = await run(builderArgs(preparation, [], [process.execPath, "-e", "process.exit(0)"]), preparationFailure);
    assert.notEqual(prepared.exitCode, 0);
    assert.equal(preparationCalls, 1);
    assert.equal(builderRuntime(preparation.studio), "isolated", "preparation failure must retain the marker");

    const execution = fixture("b1-marker-execution");
    git(execution.repo, ["switch", "-q", `opus/${OPUS}`]);
    const executionFailure: WorktreeProvider = {
      id: "w125-execution-failure",
      async acquire() {
        assert.equal(builderRuntime(execution.studio), "isolated", "the marker must exist before child dispatch");
        return { path: execution.repo, branch: `opus/${OPUS}`, release: async () => undefined };
      },
    };
    const executed = await run(builderArgs(execution, [], [process.execPath, "-e", "process.exit(19)"]), executionFailure);
    assert.equal(executed.exitCode, 19);
    assert.equal(builderRuntime(execution.studio), "isolated", "unsuccessful execution must retain the marker");

    const successful = fixture("b1-marker-success");
    git(successful.repo, ["switch", "-q", `opus/${OPUS}`]);
    const successProvider: WorktreeProvider = {
      id: "w125-success",
      async acquire() {
        assert.equal(builderRuntime(successful.studio), "isolated");
        return { path: successful.repo, branch: `opus/${OPUS}`, release: async () => undefined };
      },
    };
    const success = await run(builderArgs(successful, [], [process.execPath, "-e", "process.exit(0)"]), successProvider);
    assert.equal(success.exitCode, 0, success.errors.join("; "));
    assert.equal(builderRuntime(successful.studio), "isolated", "successful builder execution retains the marker");

    const persistence = fixture("b1-marker-persistence");
    rmSync(join(persistence.studio, "opera", `${OPUS}.md`));
    let dispatched = 0;
    const dispatchSpy: WorktreeProvider = {
      id: "w125-persistence-dispatch-spy",
      async acquire() {
        dispatched++;
        return { path: persistence.repo, branch: `opus/${OPUS}`, release: async () => undefined };
      },
    };
    const refused = await run(builderArgs(persistence, [], [process.execPath, "-e", "process.exit(0)"]), dispatchSpy);
    assert.notEqual(refused.exitCode, 0, "failed marker persistence must fail the builder run");
    assert.equal(dispatched, 0, "failed marker persistence must prevent runtime preparation and dispatch");
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
    let runtimePath = "";
    const disposable: WorktreeProvider = {
      id: "w125-disposable-fixture",
      async acquire() {
        runtimePath = scratch("b4-runtime");
        cpSync(f.repo, runtimePath, { recursive: true });
        return { path: runtimePath, branch: `opus/${OPUS}`, release: async () => rmSync(runtimePath, { recursive: true, force: true }) };
      },
    };
    const result = await run(builderArgs(f, ["--keep"], [process.execPath, "-e", "process.exit(0)"]), disposable);
    assert.equal(result.exitCode, 0, `the zero-exit builder fixture must reach teardown: ${result.errors.join("; ")}`);
    const receipt = oneReceipt(f.studio);
    const runtime = receipt["cwd"];
    assert.equal(typeof runtime, "string", "the diagnostic receipt must name the runtime path");

    // Genuine pre-change red: current run.ts deliberately keeps a clean
    // generic worktree when --keep is supplied.
    assert.equal(existsSync(runtime as string), false, "the disposable runtime must be gone before run returns");
  });
}

if (runs(1)) {
  live("W-125 behaviour 1 live: the Git broker denies option and path escapes, raw .git writes and other refs", async () => {
    const f = liveFixture("b1-live-broker");
    const area = scratch("host-area");
    const secret = join(area, "secret.txt");
    const canary = join(area, "canary-output.txt");
    const SECRET_TEXT = "HOST-SECRET-CONTENT-9f3a";
    writeFileSync(secret, `${SECRET_TEXT}\n`);
    const body = `(async()=>{
      const [secret, canary, secretText] = process.argv.slice(1);
      const attempts = {
        showOutput: ['show', ':source.txt', '--output=' + canary],
        diffOutputAbbrev: ['diff', '--cached', '--out=' + canary],
        showOutputAbbrev: ['show', 'HEAD:source.txt', '--outp=' + canary],
        diffOutputSpaced: ['diff', '--output', canary],
        noIndexAbsolute: ['diff', '--no-index', '/dev/null', secret],
        noIndexRelative: ['diff', '--no-index', '/dev/null', '../secret'],
        noIndexAbbrev: ['diff', '--no-ind', '/dev/null', secret],
        excludeFrom: ['ls-files', '-o', '--exclude-from=' + secret],
        excludeFromShort: ['ls-files', '-o', '-X', secret],
        orderFile: ['diff', '-O' + secret],
        orderFileLong: ['diff', '--orderfile=' + secret],
        extDiff: ['diff', '--ext-diff'],
        textconv: ['show', '--textconv', 'HEAD:source.txt'],
        dashC: ['-c', 'core.hooksPath=/tmp', 'status'],
        dashCLate: ['status', '-c', 'core.hooksPath=/tmp'],
        gitDir: ['--git-dir=/tmp', 'status'],
        gitDirLate: ['status', '--git-dir=/tmp'],
        workTree: ['status', '--work-tree=/tmp'],
        absoluteAdd: ['add', secret],
        absoluteShow: ['show', 'HEAD:' + secret],
        absoluteAfterDashes: ['ls-files', '--', secret],
        dotDot: ['add', '../x'],
        dotDotMiddle: ['ls-files', 'a/../../b'],
        dotDotRevPath: ['show', 'HEAD:../../etc/passwd'],
        dotGitPath: ['add', '.git/config'],
        pathspecMagic: ['add', ':(top)../x'],
        logSignatureFormat: ['log', '--format=%GG'],
        logSignatureFormatNewline: ['log', '--format=x\\n%GG'],
        logSignatureFormatNewlineTrail: ['log', '--pretty=%H\\n\\n%G?\\n'],
        push: ['push', 'origin', 'HEAD'],
        fetch: ['fetch', 'origin'],
        config: ['config', 'user.name', 'x'],
        branchDelete: ['branch', '-D', 'master'],
        branchCreate: ['branch', 'other'],
        stash: ['stash'],
        reset: ['reset', '--hard', 'HEAD~1'],
        checkoutNew: ['checkout', '-b', 'other'],
        updateRef: ['update-ref', 'refs/heads/x', 'HEAD'],
        hashObject: ['hash-object', '-w', secret],
        gc: ['gc', '--prune=now'],
        commitFile: ['commit', '-F', secret],
        commitAmend: ['commit', '--amend', '-m', 'x'],
        commitAuthor: ['commit', '-m', 'x', '--author=Eve <eve@example.invalid>'],
        commitTemplate: ['commit', '--template=' + secret, '-m', 'x'],
        version: ['--version'],
        empty: [],
      };
      const result = {};
      for (const [name, args] of Object.entries(attempts)) {
        const r = git(...args);
        result[name] = { status: r.status, leaked: (r.out + r.err).includes(secretText) };
      }
      const w = (p) => { try { fs.writeFileSync(p, 'x'); return 'allowed'; } catch (e) { return e.code; } };
      const rawGit = { config: w('/workspace/.git/config'), hook: w('/workspace/.git/hooks/pre-commit'), head: w('/workspace/.git/HEAD'), index: w('/workspace/.git/index'), ref: w('/workspace/.git/refs/heads/evil') };
      const controls = {
        status: git('status', '--short').status,
        toplevel: git('rev-parse', '--show-toplevel').out.trim(),
        show: git('show', 'HEAD:source.txt').out,
        log: git('log', '--format=%H', '-n1').status,
        range: git('log', '--oneline', 'HEAD~0..HEAD').status,
        lsFiles: git('ls-files').out.trim().split('\\n').includes('source.txt'),
        branch: git('branch', '--show-current').out.trim(),
      };
      fs.writeFileSync('evidence.json', JSON.stringify({ result, rawGit, controls }));
      fs.writeFileSync('source.txt', 'fixed\\n');
      commit('builder: broker control');
    })();`;
    const res = runnerRun(f, builder(body, secret, canary, SECRET_TEXT));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2000));
    const evidence = JSON.parse(git(f.repo, ["show", `refs/heads/opus/${OPUS}:evidence.json`])) as {
      result: Record<string, { status: number | null; leaked: boolean }>;
      rawGit: Record<string, string>;
      controls: Record<string, unknown>;
    };
    for (const [name, row] of Object.entries(evidence.result)) {
      assert.notEqual(row.status, 0, `broker must deny ${name}`);
      assert.equal(row.leaked, false, `${name} must not return host file content`);
    }
    for (const [name, code] of Object.entries(evidence.rawGit)) assert.notEqual(code, "allowed", `raw .git write ${name} must fail`);
    assert.equal(existsSync(canary), false, "a brokered --output must never create a host file");
    assert.equal(evidence.controls["status"], 0);
    assert.equal(evidence.controls["toplevel"], "/workspace");
    assert.equal(evidence.controls["show"], "candidate source\n");
    assert.equal(evidence.controls["log"], 0);
    assert.equal(evidence.controls["range"], 0);
    assert.equal(evidence.controls["lsFiles"], true);
    assert.equal(evidence.controls["branch"], `opus/${OPUS}`);
    assert.equal(git(f.repo, ["for-each-ref", "--format=%(refname)"]).split("\n").sort().join(","), `refs/heads/master,refs/heads/opus/${OPUS}`);
    assert.deepEqual(leftovers(f), []);
  });
}

if (runs(1)) {
  live("W-125 behaviour 1 live: the broker's scratch-index probe never writes through a builder-plantable path", async () => {
    const f = liveFixture("b1-live-probe-symlink");
    const target = join(scratch("host-probe-target"), "host-file.txt");
    const ORIGINAL = "HOST-FILE-UNTOUCHED-4c1e\n";
    writeFileSync(target, ORIGINAL);
    const body = `(async()=>{
      const target = process.argv[1];
      const attempt = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
      // Redirect every probe-index-* name the broker left in /control (plus a fixed guess) at the host file,
      // then trigger the probe again: host git must not write its index through the link.
      const names = fs.readdirSync('/control').filter((n) => n.startsWith('probe-index-')).concat('probe-index-1');
      const planted = names.map((n) => ({ rm: attempt(() => fs.rmSync('/control/' + n, { force: true })), link: attempt(() => fs.symlinkSync(target, '/control/' + n)) }));
      const probe = git('bisellium-probe-index');
      fs.writeFileSync('evidence.json', JSON.stringify({ planted, probe: probe.status, control: fs.readdirSync('/control').sort() }));
      ${FIX_AND_COMMIT}
    })();`;
    const res = runnerRun(f, builder(body, target));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2000));
    assert.equal(readFileSync(target, "utf8"), ORIGINAL, "a symlink planted at the probe's index name must not redirect a host write");
    const evidence = JSON.parse(git(f.repo, ["show", `refs/heads/opus/${OPUS}:evidence.json`])) as {
      planted: { link: string }[];
      probe: number | null;
      control: string[];
    };
    assert.equal(evidence.probe, 0, "the probe still works");
    for (const row of evidence.planted) assert.notEqual(row.link, "ok", "the builder cannot plant anything in /control");
    assert.deepEqual(evidence.control, ["git-reply", "git-request"], "the builder reaches only the two host-created pipes");
    assert.deepEqual(leftovers(f), []);
  });
}

if (runs(2)) {
  live("W-125 behaviour 2 live: contained smoke - the builder runs in bwrap, commits through the broker and export succeeds", async () => {
    const f = liveFixture("b2-live-smoke", { behaviours: 2 });
    const hostCanary = join(scratch("host-canary"), "canary.txt");
    writeFileSync(hostCanary, "host-only\n");
    const body = `(async()=>{
      const ev = {};
      ev.env = Object.keys(process.env).sort();
      ev.leaks = ['GITHUB_TOKEN','SSH_AUTH_SOCK','NPM_TOKEN','HTTPS_PROXY','NODE_OPTIONS','AWS_ACCESS_KEY_ID'].filter((k) => k in process.env);
      ev.hostCanaryVisible = fs.existsSync(process.argv[1]);
      ev.homeEntries = fs.readdirSync('/home');
      ev.rootEntries = fs.readdirSync('/').sort();
      const w = (p) => { try { fs.writeFileSync(p, 'x'); return 'allowed'; } catch (e) { return e.code; } };
      ev.usrWrite = w('/usr/escape');
      ev.rootWrite = w('/escape');
      ev.gitDirWrite = w('/workspace/.git/escape');
      ev.privateTmp = w('/tmp/ok');
      ev.net = await new Promise((res) => {
        const s = require('node:net').connect({ host: '1.1.1.1', port: 443 });
        s.once('error', (e) => res(e.code));
        s.once('connect', () => { s.destroy(); res('connected'); });
        // sleep-waiver: guard -- the embedded script gives the socket probe five seconds, a deadline and not what correctness waits on
        setTimeout(() => { s.destroy(); res('timeout'); }, 5000);
      });
      ev.loopback = await new Promise((res) => {
        const srv = require('node:net').createServer().listen(0, '127.0.0.1', () => srv.close(() => res('bound')));
        srv.once('error', (e) => res(e.code));
      });
      ev.rawGit = spawnSync('/usr/bin/git', ['--version']).status;
      ev.nodeVersion = process.version;
      ev.binLink = fs.realpathSync('node_modules/.bin/tool');
      fs.writeFileSync('evidence.json', JSON.stringify(ev));
      ${FIX_AND_COMMIT}
    })();`;
    const result = await withTmp(f, () => run(builderArgs(f, [], builder(body, hostCanary))));
    assert.equal(result.exitCode, 0, `${result.errors.join("\n")}\n${result.out.join("\n")}`.slice(-2500));
    assert.notEqual(tip(f), f.base, "the exported commit must advance the owning branch");
    assert.equal(git(f.repo, ["show", `refs/heads/opus/${OPUS}:source.txt`]), "fixed");
    assert.equal(git(f.repo, ["log", "-1", "--format=%an", `refs/heads/opus/${OPUS}`]), `builder.${OPUS}`);

    // Everything below was observed from INSIDE the sandbox and exported as a commit.
    const ev = JSON.parse(git(f.repo, ["show", `refs/heads/opus/${OPUS}:evidence.json`])) as Record<string, unknown>;
    assert.deepEqual(ev["leaks"], [], "no credential or proxy variable may reach the tool runtime");
    assert.equal((ev["env"] as string[]).length, 19, `exact allowlist, got ${String(ev["env"])}`);
    assert.equal(ev["hostCanaryVisible"], false, "host paths are not mounted");
    assert.ok((ev["homeEntries"] as string[]).includes("builder"), "the private home exists");
    // Only the private home and, if Node lives under /home, its toolchain tree: never a user's home.
    const toolchain = realpathSync(process.execPath).match(/^\/home\/([^/]+)\//)?.[1];
    assert.deepEqual((ev["homeEntries"] as string[]).filter((entry) => entry !== "builder" && entry !== toolchain), [], "no other home directory is mounted");
    assert.equal((ev["rootEntries"] as string[]).includes("mnt"), false, "no host drive mounts");
    for (const key of ["usrWrite", "rootWrite", "gitDirWrite"]) assert.notEqual(ev[key], "allowed", `${key} must be refused`);
    assert.equal(ev["privateTmp"], "allowed", "private temp is writable");
    assert.match(String(ev["net"]), /^ENET/, "egress is denied");
    assert.equal(ev["loopback"], "bound", "private loopback works for tests");
    assert.notEqual(ev["rawGit"], 0, "the real git binary is not reachable");
    assert.match(String(ev["nodeVersion"]), /^v(2[5-9]|[3-9]\d)\./, "the host's Node, not the distro's old one");
    assert.equal(ev["binLink"], "/workspace/node_modules/tsx/index.mjs", "dependency bin links resolve inside the clone, not back to the host");

    assert.deepEqual(leftovers(f), [], "runtime and clone are gone");
    assert.equal(existsSync(join(f.repo, ".bisellium", "leases", OPUS)), false, "lease released");
    assert.equal(builderRuntime(f.studio), "isolated");
    const receipt = oneReceipt(f.studio) as { exitCode: number; completion?: Record<string, unknown> };
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.completion?.["completed"], true);
    assert.equal(receipt.completion?.["teardownComplete"], true);
    assert.equal(receipt.completion?.["finalCommit"], tip(f));
    assert.equal((receipt.completion?.["redReplays"] as unknown[]).length, 2);
    assert.equal(typeof readFront<Record<string, unknown>>(join(f.studio, "opera", `${OPUS}.md`)).data["run_receipt"], "string");
  });
}

if (runs(2)) {
  live("W-125 behaviour 2 live: a dependency tree whose links escape the checkout is refused before dispatch", async () => {
    const target = scratch("host-modules-target");
    const f = liveFixture("b2-escaping-link", { escapingLink: target });
    const result = await withTmp(f, () => run(builderArgs(f, [], builder(FIX_AND_COMMIT))));
    assert.notEqual(result.exitCode, 0);
    assert.match(result.errors.join("\n"), /escapes the checkout: node_modules\/leak/);
    assert.equal(tip(f), f.base);
    assert.deepEqual(leftovers(f), []);
  });
}

if (runs(3)) {
  const probeSource = (tag: string, canary: string, hostWrite: string): string => `
    import fs from 'node:fs';
    import net from 'node:net';
    const o = {};
    o.env = Object.keys(process.env).sort();
    o.canaryVisible = fs.existsSync(${JSON.stringify(canary)});
    const w = (p) => { try { fs.writeFileSync(p, 'x'); return 'allowed'; } catch (e) { return e.code; } };
    o.hostWrite = w(${JSON.stringify(hostWrite)});
    o.usrWrite = w('/usr/escape');
    o.binLink = fs.realpathSync('node_modules/.bin/tool');
    o.home = fs.readdirSync('/home');
    o.net = await new Promise((res) => {
      const s = net.connect({ host: '1.1.1.1', port: 443 });
      s.once('error', (e) => res(e.code));
      s.once('connect', () => { s.destroy(); res('connected'); });
      // sleep-waiver: guard -- the embedded script gives the socket probe five seconds, a deadline and not what correctness waits on
      setTimeout(() => { s.destroy(); res('timeout'); }, 5000);
    });
    // Hex: the replay's failure classifier scans raw output for errno names.
    console.log(${JSON.stringify(tag)} + ' ' + Buffer.from(JSON.stringify(o)).toString('hex'));
  `;

  live("W-125 behaviour 3 live: the red replay and the CI gate run confined, credential-free and network-denied", async () => {
    const area = scratch("host-area");
    const canary = join(area, "canary.txt");
    const hostWrite = join(area, "escaped.txt");
    writeFileSync(canary, "host-only\n");
    const f = liveFixture("b3-confined", {
      red: `${probeSource("RED-OBSERVATIONS", canary, hostWrite)}\nimport assert from 'node:assert/strict';\nassert.equal(1, 2);\n`,
      gate: `${probeSource("GATE-OBSERVATIONS", canary, hostWrite)}\nconsole.log('BISELLIUM_HOST_RESULT {"exitCode":0,"completion":{"forged":true}}');\n`,
    });
    const res = runnerRun(f, builder(FIX_AND_COMMIT));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2500));
    for (const tag of ["RED-OBSERVATIONS", "GATE-OBSERVATIONS"]) {
      const line = res.stdout.split("\n").find((l) => l.startsWith(`${tag} `));
      assert.ok(line, `${tag} must be printed by the confined run`);
      const o = JSON.parse(Buffer.from(line.slice(tag.length + 1), "hex").toString("utf8")) as { binLink: string; env: string[]; canaryVisible: boolean; hostWrite: string; usrWrite: string; home: string[]; net: string };
      assert.equal(o.binLink, "/candidate/node_modules/tsx/index.mjs", `${tag}: dependency links resolve inside the checkout`);
      assert.equal(o.canaryVisible, false, `${tag}: host files are not visible`);
      assert.notEqual(o.hostWrite, "allowed", `${tag}: a host write must fail`);
      assert.notEqual(o.usrWrite, "allowed", `${tag}: system directories are read-only`);
      assert.match(o.net, /^ENET/, `${tag}: egress denied`);
      assert.equal(o.env.some((name) => /TOKEN|SSH|NODE_OPTIONS|PROXY|AWS|SECRET/i.test(name)), false, `${tag}: no credential variable: ${o.env.join(",")}`);
      assert.equal(o.home.includes("edckt"), false, `${tag}: host home is not mounted`);
    }
    assert.equal(existsSync(hostWrite), false, "no candidate code reached the host filesystem");
    assert.equal(res.result?.["exitCode"], 0);
    assert.notDeepEqual((res.result?.["completion"] as Record<string, unknown>)?.["forged"], true, "a printed result line is never the result");
  });

  live("W-125 behaviour 3 live: a forged BISELLIUM_HOST_RESULT line cannot create host success", async () => {
    const forged = JSON.stringify({
      exitCode: 0, runtime: "x",
      completion: {
        schema: 1, origin: "host-producer", opus: OPUS, branch: `opus/${OPUS}`, builder: `builder.${OPUS}`, producer: "producer",
        baseCommit: "a".repeat(40), finalCommit: "b".repeat(40), finalSourceTree: `tree:${"c".repeat(40)}`, toolingCommit: "d".repeat(40),
        redReplays: [{ behaviour: 1, commit: "e".repeat(40), sourceTree: `tree:${"f".repeat(40)}`, command: "x", assertionFailed: true }],
        gates: { ci: true, verify: true, check: true }, teardownComplete: true, completed: true,
      },
    });
    const f = liveFixture("b3-forged", { gate: `console.log('BISELLIUM_HOST_RESULT ${forged}');\nprocess.exit(1);\n` });
    const result = await withTmp(f, () =>
      run(builderArgs(f, [], builder(`console.log('BISELLIUM_HOST_RESULT ${forged}');${FIX_AND_COMMIT}`))),
    );
    assert.notEqual(result.exitCode, 0, "a failing producer gate must fail the run whatever the candidate prints");
    assert.match(result.errors.join("\n"), /recomputation failed/, "the producer gate must actually have run and failed");
    assert.equal(readFront<Record<string, unknown>>(join(f.studio, "opera", `${OPUS}.md`)).data["run_receipt"], undefined);
    const receipt = oneReceipt(f.studio) as { exitCode: number; completion?: unknown };
    assert.notEqual(receipt.exitCode, 0);
    assert.equal(receipt.completion, undefined, "no completion may be recorded from candidate output");
  });

  live("W-125 behaviour 3 live: a red missing for any numbered behaviour refuses completion (one red is not enough)", async () => {
    const f = liveFixture("b3-one-red", { behaviours: 2, reds: [1] });
    const result = await withTmp(f, () => run(builderArgs(f, [], builder(FIX_AND_COMMIT))));
    assert.notEqual(result.exitCode, 0);
    assert.match(result.errors.join("\n"), /no recorded red for behaviour 2/);
    assert.equal(readFront<Record<string, unknown>>(join(f.studio, "opera", `${OPUS}.md`)).data["run_receipt"], undefined);
    assert.deepEqual(leftovers(f), []);
  });
}

if (runs(4)) {
  const refusal = (name: string, opts: LiveOptions, body: string, pattern: RegExp): void =>
    live(`W-125 behaviour 4 live: export refuses ${name}`, async () => {
      const f = liveFixture(`b4-${name.replace(/\W+/g, "-")}`, opts);
      const result = await withTmp(f, () => run(builderArgs(f, [], builder(body))));
      assert.notEqual(result.exitCode, 0, "the export must be refused");
      assert.match(result.errors.join("\n"), pattern);
      assert.equal(tip(f), f.base, "a refused export must not move the owning branch");
      assert.equal(readFront<Record<string, unknown>>(join(f.studio, "opera", `${OPUS}.md`)).data["run_receipt"], undefined);
      assert.deepEqual(leftovers(f), [], "the hostile runtime is deleted even on refusal");
    });

  refusal(
    "a protected bookkeeping path",
    {},
    "fs.mkdirSync('studio/ci',{recursive:true});fs.writeFileSync('studio/ci/forged.log','x');commit('forge');",
    /unowned\/protected path: studio\/ci\/forged\.log/,
  );
  refusal(
    "a path outside Files owned",
    {},
    "fs.writeFileSync('evil.txt','x');commit('evil');",
    /unowned\/protected path: evil\.txt/,
  );
  refusal(
    "a rename-disguised deletion of protected bookkeeping",
    {},
    "fs.writeFileSync('evidence.json',fs.readFileSync('studio/notes.md','utf8'));fs.unlinkSync('studio/notes.md');commit('disguise');",
    /unowned\/protected path: studio\/notes\.md/,
  );
  refusal(
    "a symlink at an owned path",
    {},
    "fs.rmSync('source.txt');fs.symlinkSync('/etc/passwd','source.txt');commit('link');",
    /symlink|gitlink/,
  );
  refusal("any export when the brief declares no Files owned list", { owned: null }, FIX_AND_COMMIT, /Files owned/);

  live("W-125 behaviour 4 live: SIGTERM to the runner kills the group and removes the runtime and lease", async () => {
    const f = liveFixture("b4-sigterm");
    const resultFile = join(scratch("result"), "result.json");
    // sleep-waiver: fixture -- the builder script keeps itself alive with an interval so the runner can be signalled mid-run
    const cmd = builder("fs.writeFileSync('/tmp/ready','1');setInterval(()=>{},1000);");
    const child = spawn(process.execPath, [RUNNER, "--request", directRequest(f, cmd, resultFile)], { cwd: f.repo, env: RUNNER_ENV(f), stdio: "ignore" });
    const exited = new Promise<void>((ok) => child.once("exit", () => ok()));
    try {
      await waitFor("the confined builder to start", () => leftovers(f).some((name) => existsSync(join(f.tmp, name, "tmp", "ready"))));
      const runtime = join(f.tmp, leftovers(f)[0]!);
      assert.ok(existsSync(join(f.repo, ".bisellium", "leases", OPUS)), "the lease is held while running");
      child.kill("SIGTERM");
      await exited;
      assert.deepEqual(leftovers(f), [], "the runtime must be removed on SIGTERM");
      assert.equal(existsSync(join(f.repo, ".bisellium", "leases", OPUS)), false, "the lease must be released on SIGTERM");
      assert.equal(survivors(runtime), "", "no descendant of the builder survives");
    } finally {
      child.kill("SIGKILL");
    }
  });

  live("W-125 behaviour 4 live: after a SIGKILLed runner the parent cleans the reported runtime", async () => {
    const f = liveFixture("b4-sigkill");
    const resultFile = join(scratch("result"), "result.json");
    // sleep-waiver: fixture -- the builder script keeps itself alive with an interval so the runner can be signalled mid-run
    const cmd = builder("fs.writeFileSync('/tmp/ready','1');setInterval(()=>{},1000);");
    const child = spawn(process.execPath, [RUNNER, "--request", directRequest(f, cmd, resultFile)], { cwd: f.repo, env: RUNNER_ENV(f), stdio: "ignore" });
    const exited = new Promise<void>((ok) => child.once("exit", () => ok()));
    try {
      await waitFor("the confined builder to start", () => leftovers(f).some((name) => existsSync(join(f.tmp, name, "tmp", "ready"))));
      const runtime = join(f.tmp, leftovers(f)[0]!);
      child.kill("SIGKILL");
      await exited;
      assert.equal(readResult(resultFile)?.["runtime"], runtime, "the runner must report its runtime before it can die");
      await waitFor("the sandbox to die with its parent", () => survivors(runtime) === "");
      assert.equal(existsSync(runtime), true, "precondition: an uncatchable kill leaves the runtime behind");
      // Typed by cast so this row can precede the helper it pins.
      const { cleanupAbandonedRuntime } = (await import("./builder-run.js")) as unknown as {
        cleanupAbandonedRuntime: (resultFile: string, tmpRoot: string) => void;
      };
      cleanupAbandonedRuntime(resultFile, f.tmp);
      assert.deepEqual(leftovers(f), [], "the parent must remove the dead runner's runtime");
    } finally {
      child.kill("SIGKILL");
    }
  });

  test("W-125 behaviour 4: a dead owner's lease is reclaimed; a live owner's is not", async () => {
    const repo = scratch("lease");
    const { acquireProducerLease } = (await import("./builder-run.js")) as unknown as {
      acquireProducerLease: (repo: string, opus: string) => string | undefined;
    };
    const first = acquireProducerLease(repo, OPUS);
    assert.ok(first, "a free lease is granted");
    assert.equal(acquireProducerLease(repo, OPUS), undefined, "a lease held by a live process is refused");
    writeFileSync(join(first!, "pid"), `${spawnSync("true").pid}\n`);
    assert.ok(acquireProducerLease(repo, OPUS), "a lease whose owner is dead is reclaimed");
  });
}

// ---------------------------------------------------------------------------
// W-132: the Git broker's transport is a pair of host-created named pipes
// (`git-request`, `git-reply`) in the read-only /control mount; no socket. Rows
// are selected by name, one per behaviour: --test-name-pattern=W-132-b1 .. b4.
// The new modules are loaded dynamically, so their absence is one assertion
// failure and never a module-load error. Titles and messages are fixed text:
// no child output is ever interpolated into a red row's message.
// ---------------------------------------------------------------------------
if (only === undefined) {
  const SCRIPTS = fileURLToPath(new URL("../../../scripts/", import.meta.url));
  const BROKER = join(SCRIPTS, "git-broker.mjs");
  const CELL_CLIENT = join(SCRIPTS, "git-cell-client.mjs");
  const OWNED_SCRIPTS = [RUNNER, BROKER, CELL_CLIENT];
  const PIPES = ["git-reply", "git-request"];

  interface Frame {
    id?: string | null;
    status?: number;
    stdout?: string;
    stderr?: string;
  }
  interface HostLine {
    t: string;
    head?: string;
    n?: number;
    len?: number;
    heap?: number;
    buffers?: number;
  }

  // The host side: `openCellChannel` in a process of its own, with a `serve`
  // that is a stand-in policy (status verbs served, everything else denied).
  // A separate process lets the row prove close() leaves nothing alive, and
  // gc() makes the buffer bound a retained-memory measurement, not a guess.
  const HOST_SCRIPT = `
const { openCellChannel } = await import(process.argv[1]);
const emit = (line) => process.stdout.write(JSON.stringify(line) + '\\n');
const channel = await openCellChannel(process.argv[2], (args) => {
  emit({ t: 'served', head: args.map((a) => a.slice(0, 8)).join(' '), n: args.length, len: args.reduce((sum, a) => sum + a.length, 0) });
  if (args[0] === 'status') return { status: 0, stdout: 'served:' + args.map((a) => a.slice(0, 16)).join(' ') + '\\n', stderr: '' };
  return { status: 2, stdout: '', stderr: 'git broker: Git command denied: ' + args[0] + '\\n' };
});
process.stdin.setEncoding('utf8');
let buffered = '';
process.stdin.on('data', (part) => {
  buffered += part;
  for (let at = buffered.indexOf('\\n'); at >= 0; at = buffered.indexOf('\\n')) {
    const command = buffered.slice(0, at);
    buffered = buffered.slice(at + 1);
    if (command === 'sample') {
      gc();
      const m = process.memoryUsage();
      emit({ t: 'mem', heap: m.heapUsed, buffers: m.arrayBuffers });
    }
    if (command === 'close') {
      channel.close();
      process.stdin.destroy();
    }
  }
});
emit({ t: 'ready' });
`;

  // The hostile cell: blocking synchronous I/O on the two pipes, like the real
  // client. Each scenario ends by reading replies until a sentinel's own reply
  // arrives, so every earlier reply is in hand and nothing here sleeps.
  const CELL_SCRIPT = `
const fs = require('node:fs');
const [dir, scenario, canary] = process.argv.slice(1);
const reply = fs.openSync(dir + '/git-reply', fs.constants.O_RDWR);
const open = () => fs.openSync(dir + '/git-request', fs.constants.O_WRONLY);
const sendAll = (fd, text) => {
  const bytes = Buffer.from(text);
  let at = 0;
  while (at < bytes.length) at += fs.writeSync(fd, bytes, at);
};
let pending = '';
const readUntil = (done) => {
  const frames = [];
  const chunk = Buffer.alloc(65536);
  for (;;) {
    const n = fs.readSync(reply, chunk, 0, chunk.length, null);
    pending += chunk.toString('utf8', 0, n);
    for (let at = pending.indexOf('\\n'); at >= 0; at = pending.indexOf('\\n')) {
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      let frame;
      try { frame = JSON.parse(line); } catch { frame = { unparsable: true }; }
      frames.push(frame);
      if (done(frames)) return frames;
    }
  }
};
const frame = (id, ...args) => JSON.stringify({ id, args }) + '\\n';
const a = open();
const sentinel = (id) => { sendAll(a, frame(id, 'status')); return readUntil((all) => all.some((x) => x.id === id)); };
const out = {};
if (scenario === 'malformed') {
  const pad = (n) => 'a'.repeat(n);
  sendAll(a, JSON.stringify({ id: 'big', args: ['status', pad(200 * 1024)] }) + '\\n');
  sendAll(a, 'this is not json\\n');
  sendAll(a, '{"id":"a1","args":"status"}\\n');
  sendAll(a, '{"id":"a2","args":["status",1]}\\n');
  sendAll(a, '{"id":"a3","args":[["status"]]}\\n');
  sendAll(a, '{"id":"a4"}\\n');
  sendAll(a, '{"args":["status"]}\\n');
  sendAll(a, frame('mid', 'status', pad(100 * 1024)));
  sendAll(a, frame('d1', 'push', 'origin', 'HEAD'));
  out.frames = sentinel('s1');
}
if (scenario === 'interleave') {
  const b = open();
  for (let i = 0; i < 20; i++) {
    sendAll(a, frame('A' + i, 'status', 'A' + i));
    sendAll(b, frame('B' + i, 'status', 'B' + i));
  }
  out.frames = sentinel('s3');
}
if (scenario === 'torn') {
  const b = open();
  sendAll(a, '{"id":"T1","ar');
  sendAll(b, '{"id":"T2","args":["status"]}\\n');
  sendAll(a, 'gs":["status"]}\\n');
  out.frames = sentinel('s4');
}
if (scenario === 'forged') {
  sendAll(reply, JSON.stringify({ id: 'forged', status: 0, stdout: 'forged\\n', stderr: '' }) + '\\n');
  sendAll(a, JSON.stringify({ id: 'f1', args: ['status', 'x'], reply: canary, pipe: canary, path: canary }) + '\\n');
  out.frames = readUntil((all) => all.some((x) => x.id === 'f1'));
}
if (scenario === 'flood') {
  const piece = Buffer.alloc(1024 * 1024, 120);
  for (let i = 0; i < 32; i++) {
    let at = 0;
    while (at < piece.length) at += fs.writeSync(a, piece, at);
  }
}
if (scenario === 'resume') {
  sendAll(a, '\\n');
  out.frames = sentinel('u1');
}
if (scenario === 'sentinel') {
  out.frames = sentinel('z1');
}
if (scenario === 'deaf') {
  // Never reads a reply. Non-blocking: the flood ends when the pipe refuses it, not when the host stops caring.
  const w = fs.openSync(dir + '/git-request', fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
  let count = 0;
  for (; count < 5000; count++) {
    try { fs.writeSync(w, frame('d' + count, 'status')); } catch (e) { if (e.code === 'EAGAIN') break; throw e; }
  }
  out.count = count;
}
process.stdout.write(JSON.stringify(out));
`;

  function startHost(control: string) {
    const lines: HostLine[] = [];
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let stderr = "";
    const child = spawn(
      process.execPath,
      ["--expose-gc", "--input-type=module", "-e", HOST_SCRIPT, pathToFileURL(BROKER).href, control],
      { stdio: ["pipe", "pipe", "pipe"], timeout: 180_000, killSignal: "SIGKILL" },
    );
    let buffered = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part: string) => {
      buffered += part;
      for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
        try {
          lines.push(JSON.parse(buffered.slice(0, at)) as HostLine);
        } catch {
          lines.push({ t: "garbled" });
        }
        buffered = buffered.slice(at + 1);
      }
    });
    child.stderr.on("data", (part: Buffer) => (stderr += part.toString("utf8")));
    child.once("exit", (code, signal) => {
      exit = { code, signal };
    });
    return {
      child,
      lines,
      exit: () => exit,
      stderr: () => stderr.slice(-1500),
      served: () => lines.filter((line) => line.t === "served"),
      command: (text: string) => child.stdin.write(`${text}\n`),
    };
  }
  type Host = ReturnType<typeof startHost>;

  async function hostReady(host: Host): Promise<void> {
    await waitFor("the host channel to open", () => host.lines.some((line) => line.t === "ready") || host.exit() !== undefined);
    assert.equal(host.lines.some((line) => line.t === "ready"), true, `the host channel opened: ${host.stderr()}`);
  }

  function runCell(control: string, scenario: string, canary = ""): Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }> {
    return new Promise((done) => {
      const child = spawn(process.execPath, ["-e", CELL_SCRIPT, control, scenario, canary], {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 90_000,
        killSignal: "SIGKILL",
      });
      let out = "";
      child.stdout.on("data", (part: Buffer) => (out += part.toString("utf8")));
      child.once("close", (code, signal) => done({ code, signal, out }));
    });
  }
  async function cellFrames(control: string, scenario: string, canary = ""): Promise<Frame[]> {
    const cell = await runCell(control, scenario, canary);
    assert.equal(cell.signal, null, `b4: the cell got every reply it waited on (${scenario})`);
    assert.equal(cell.code, 0, `b4: the cell scenario finished (${scenario})`);
    return (JSON.parse(cell.out) as { frames?: Frame[] }).frames ?? [];
  }
  const answered = (frames: Frame[], status: number): (string | null | undefined)[] =>
    frames.filter((frame) => frame.status === status).map((frame) => frame.id).sort();

  test("W-132-b1 behaviour 1: the live rows are not gated on a socket", () => {
    // Tokens only: the raw gate text holds a word the red replay's output filter rejects.
    const gate = liveSkip === false ? "ungated" : /socket/i.test(liveSkip) ? "socket-gated" : "bwrap-gated";
    assert.notEqual(gate, "socket-gated", "b1: liveSkip is a socket refusal");
    assert.equal(gate, bwrapUsable ? "ungated" : "bwrap-gated", "b1: liveSkip is false exactly when bwrap is usable");
    assert.equal(liveRows.filter((row) => row.skipped).length, bwrapUsable ? 0 : liveRows.length, "b1: a usable bwrap leaves no live row skipped");
    // 14 W-125 live rows, the 2 W-132 live rows (L2, L3) and the 3 W-134 live rows (b1-b3).
    assert.equal(liveRows.length, 19, "b1: every live row is registered, none dropped or added unrecorded");
    // Assembled, so this assertion is not itself the text it forbids.
    const probe = ["socket", "Usable"].join("");
    assert.equal(readFileSync(fileURLToPath(import.meta.url), "utf8").includes(probe), false, "b1: the live gate still consults a socket probe");
  });

  test("W-132-b2 behaviour 2: no socket primitive survives in the owned scripts", () => {
    const tokens: [string, RegExp][] = [
      ["node:net", /node:net/],
      ["createServer", /createServer/],
      ["createConnection", /createConnection/],
      [".sock", /\.sock(?![A-Za-z])/],
    ];
    const hits: Record<string, string[]> = {};
    const missing: string[] = [];
    for (const path of OWNED_SCRIPTS) {
      if (!existsSync(path)) {
        missing.push(basename(path));
        continue;
      }
      const text = readFileSync(path, "utf8");
      const found = tokens.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
      if (found.length > 0) hits[basename(path)] = found; // token names only, never the matching lines
    }
    assert.deepEqual(hits, {}, "b2: socket primitives remain in the owned scripts");
    assert.deepEqual(missing, [], "b2: all three owned scripts exist");
  });

  live("W-132-L2 behaviour 2 live: /control holds exactly the host-created pipes and the cell cannot tamper with them", async () => {
    const f = liveFixture("b2-live-pipes");
    const body = `(async()=>{
      const attempt = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
      const names = fs.readdirSync('/control').sort();
      const fifo = Object.fromEntries(names.map((n) => [n, fs.lstatSync('/control/' + n).isFIFO()]));
      const tamper = {
        unlink: attempt(() => fs.unlinkSync('/control/git-request')),
        rename: attempt(() => fs.renameSync('/control/git-reply', '/control/git-reply-moved')),
        chmod: attempt(() => fs.chmodSync('/control/git-request', 0o666)),
        symlink: attempt(() => fs.symlinkSync('/etc/passwd', '/control/planted')),
      };
      const after = { names: fs.readdirSync('/control').sort(), status: git('status', '--short').status };
      fs.writeFileSync('evidence.json', JSON.stringify({ names, fifo, tamper, after }));
      ${FIX_AND_COMMIT}
    })();`;
    const res = runnerRun(f, builder(body));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2000));
    const evidence = JSON.parse(git(f.repo, ["show", `refs/heads/opus/${OPUS}:evidence.json`])) as {
      names: string[];
      fifo: Record<string, boolean>;
      tamper: Record<string, string>;
      after: { names: string[]; status: number | null };
    };
    assert.deepEqual(evidence.names, PIPES, "/control lists exactly the host-created names");
    assert.deepEqual(evidence.fifo, { "git-reply": true, "git-request": true }, "each name in /control is a FIFO");
    for (const [action, code] of Object.entries(evidence.tamper)) assert.notEqual(code, "ok", `${action} in /control must fail`);
    assert.deepEqual(evidence.after.names, PIPES, "a failed tamper leaves /control as the host made it");
    assert.equal(evidence.after.status, 0, "the broker still answers after the tamper attempts");
    assert.deepEqual(leftovers(f), []);
  });

  test("W-132-b3 behaviour 3: a git call reaches the host broker from any process depth", async () => {
    assert.equal(existsSync(CELL_CLIENT), true, "b3: scripts/git-cell-client.mjs exists as a standalone cell client");
    assert.equal(readFileSync(RUNNER, "utf8").includes("git-cell-client.mjs"), true, "b3: the runner installs the standalone cell client");
    assert.equal(existsSync(BROKER), true, "b3: scripts/git-broker.mjs exists as the transport module");

    const control = scratch("b3-control");
    const tools = scratch("b3-tools");
    // Installed the way the runner installs it: copied to /tools/git, mode 0555.
    copyFileSync(CELL_CLIENT, join(tools, "git"));
    chmodSync(join(tools, "git"), 0o555);
    const host = startHost(control);
    try {
      await hostReady(host);
      // node -> sh -> client: the client is a grandchild of a process that was
      // given no descriptor beyond stdio, as when an agent shells out. The
      // client's mutex lives under TMPDIR, the cell's private /tmp.
      const chain = `
const { spawn } = require('node:child_process');
const sh = (script) => new Promise((done) => {
  const c = spawn('sh', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (err += d));
  c.on('close', (code) => done({ code, out, err }));
});
(async () => {
  const served = await sh('git status --short');
  const denied = await sh('git push origin HEAD');
  const parallel = await Promise.all([1, 2, 3].map((i) => sh('git status p' + i)));
  process.stdout.write(JSON.stringify({ served, denied, parallel }));
})();
`;
      const env = { PATH: `${tools}:${dirname(process.execPath)}:/usr/bin:/bin`, BISELLIUM_GIT_CONTROL: control, TMPDIR: scratch("b3-tmp"), HOME: tools };
      const ran = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }>((done) => {
        const child = spawn(process.execPath, ["-e", chain], { env, stdio: ["ignore", "pipe", "ignore"], timeout: 90_000, killSignal: "SIGKILL" });
        let out = "";
        child.stdout.on("data", (part: Buffer) => (out += part.toString("utf8")));
        child.once("close", (code, signal) => done({ code, signal, out }));
      });
      assert.equal(ran.signal, null, "b3: every call from a grandchild got a reply");
      assert.equal(ran.code, 0, "b3: the process chain finished");
      const result = JSON.parse(ran.out) as {
        served: { code: number; out: string; err: string };
        denied: { code: number; out: string; err: string };
        parallel: { code: number; out: string; err: string }[];
      };
      assert.deepEqual(result.served, { code: 0, out: "served:status --short\n", err: "" }, "b3: an allowlisted verb is served from a grandchild");
      assert.deepEqual(
        result.denied,
        { code: 2, out: "", err: "git broker: Git command denied: push\n" },
        "b3: a denied verb is refused with the broker's message",
      );
      assert.deepEqual(
        result.parallel.map((run) => `${run.code}:${run.out}`).sort(),
        [1, 2, 3].map((i) => `0:served:status p${i}\n`),
        "b3: concurrent callers each get their own reply",
      );
      assert.equal(host.served().length, 5, "b3: serve saw exactly the five calls");
    } finally {
      host.child.kill("SIGKILL");
    }
  });

  live("W-132-L3 behaviour 3 live: a commit made from a shell inside the builder command reaches the host broker", async () => {
    const f = liveFixture("b3-live-depth");
    // node (the builder command) -> sh -> git: two levels below the process the runtime started.
    const body = `(async()=>{
      fs.writeFileSync('source.txt','fixed\\n');
      require('node:child_process').execFileSync('sh',['-c','git add -A && git commit -m deep'],{stdio:'inherit'});
    })();`;
    const res = runnerRun(f, builder(body));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2000));
    assert.notEqual(tip(f), f.base, "the exported commit must advance the owning branch");
    assert.equal(git(f.repo, ["show", `refs/heads/opus/${OPUS}:source.txt`]), "fixed");
    assert.equal(git(f.repo, ["log", "-1", "--format=%s", `refs/heads/opus/${OPUS}`]), "deep");
    assert.deepEqual(leftovers(f), []);
  });

  test("W-132-b4 behaviour 4: a hostile cell cannot make the host misbehave through the request pipe", async () => {
    assert.equal(existsSync(BROKER), true, "b4: scripts/git-broker.mjs exists as the transport module");
    const transport = (await import(pathToFileURL(BROKER).href)) as { openCellChannel?: unknown };
    assert.equal(typeof transport.openCellChannel, "function", "b4: git-broker.mjs exports openCellChannel");

    const control = scratch("b4-control");
    const canary = join(scratch("b4-canary"), "reply-target");
    const host = startHost(control);
    const sample = async (ms = 40_000): Promise<number> => {
      const seen = host.lines.filter((line) => line.t === "mem").length;
      host.command("sample");
      await waitFor("a memory sample", () => host.lines.filter((line) => line.t === "mem").length > seen, ms);
      const latest = host.lines.filter((line) => line.t === "mem").at(-1);
      return (latest?.heap ?? 0) + (latest?.buffers ?? 0);
    };
    try {
      await hostReady(host);
      // The host made exactly the two pipes, owner-only.
      assert.deepEqual(readdirSync(control).sort(), PIPES, "b4: the channel is exactly the two host-created names");
      for (const name of PIPES) {
        const info = statSync(join(control, name));
        assert.equal(info.isFIFO(), true, `b4: ${name} is a named pipe`);
        assert.equal(info.mode & 0o777, 0o600, `b4: ${name} is mode 0600`);
      }

      // Malformed frames: each is answered with an error frame and never reaches serve.
      const malformed = await cellFrames(control, "malformed");
      for (const id of ["a1", "a2", "a3", "a4"]) {
        assert.equal(malformed.filter((frame) => frame.id === id && frame.status === 2).length, 1, `b4: ${id} is answered with one error frame`);
      }
      assert.equal(
        malformed.filter((frame) => frame.status === 2 && frame.id !== "d1").length >= 7,
        true,
        "b4: the oversize, non-JSON, bad-args and id-less frames each get an error frame",
      );
      assert.deepEqual(answered(malformed, 0), ["mid", "s1"], "b4: only the well-formed frames are served");
      const denied = malformed.find((frame) => frame.id === "d1");
      assert.equal(denied?.status === 2 && denied.stderr === "git broker: Git command denied: push\n", true, "b4: a denied verb carries the broker's message");
      assert.deepEqual(
        host.served().map((line) => [line.head, line.n, line.len]),
        [
          ["status aaaaaaaa", 2, 6 + 100 * 1024],
          ["push origin HEAD", 3, 14],
          ["status", 1, 6],
        ],
        "b4: serve is called once per well-formed frame, with the frame intact",
      );

      // Two writers interleaving whole frames: one answer each, none lost or doubled.
      const mixed = await cellFrames(control, "interleave");
      const expected = [...Array.from({ length: 20 }, (_, i) => `A${i}`), ...Array.from({ length: 20 }, (_, i) => `B${i}`), "s3"].sort();
      assert.deepEqual(mixed.map((frame) => frame.id).sort(), expected, "b4: interleaved writers get exactly one answer per frame");
      assert.equal(
        mixed.every((frame) => frame.status === 0 && (frame.id === "s3" || frame.stdout === `served:status ${frame.id}\n`)),
        true,
        "b4: every interleaved frame is answered with its own reply",
      );

      // A frame torn between two writers is garbage to the host, never a request.
      const servedBefore = host.served().length;
      const torn = await cellFrames(control, "torn");
      assert.equal(torn.some((frame) => frame.status === 2), true, "b4: a torn frame is answered with an error frame");
      assert.deepEqual(answered(torn, 0), ["s4"], "b4: nothing but the sentinel is served after a torn frame");
      assert.equal(host.served().length - servedBefore, 1, "b4: a torn frame never reaches serve");

      // A forged reply is the cell talking to itself; the extra fields name nothing the host writes.
      const forged = await cellFrames(control, "forged", canary);
      const planted = forged.filter((frame) => frame.id === "forged");
      assert.equal(planted.length, 1, "b4: the host neither consumes nor repeats a forged reply");
      assert.equal(planted[0]?.stdout, "forged\n", "b4: a forged reply is left as the cell wrote it");
      assert.equal(forged.filter((frame) => frame.id === "f1" && frame.status === 0).length, 1, "b4: the real request is still answered");
      assert.equal(existsSync(canary), false, "b4: the host writes only into the pipe it created");
      assert.equal(host.served().at(-1)?.head, "status x", "b4: the forged reply never reaches serve");

      // An unterminated request is discarded at the 128 KiB cap, not buffered.
      const baseline = await sample();
      const flood = await runCell(control, "flood");
      assert.equal(flood.signal === null && flood.code === 0, true, "b4: the host keeps draining an unterminated request");
      const grown = (await sample()) - baseline;
      assert.equal(grown < 8 * 1024 * 1024, true, "b4: an unterminated request does not grow the host's buffer");
      const servedAfterForged = host.served().length;
      const resumed = await cellFrames(control, "resume");
      assert.deepEqual(answered(resumed, 0), ["u1"], "b4: the host serves the next well-formed frame after a discard");
      assert.equal(resumed.every((frame) => frame.status === 2 || frame.id === "u1"), true, "b4: a discarded request is never answered as success");
      assert.equal(host.served().length - servedAfterForged, 1, "b4: a discarded request never reaches serve");

      // 4a: a deaf, flooding cell. It never reads git-reply and refuses to wait on git-request.
      const deafBaseline = await sample();
      const deafServedFrom = host.served().length;
      const deaf = await runCell(control, "deaf");
      assert.equal(deaf.signal === null && deaf.code === 0, true, "b4a: the deaf cell was refused, not parked");
      const got = (JSON.parse(deaf.out) as { count?: number }).count ?? 0;
      assert.equal(got > 0, true, "b4a: the deaf cell got frames in");
      // The host is alive and its event loop is free: a blocked reply write would never answer a sample. A sample
      // round-trips the host's event loop, and its mem line follows every served line on the same stream, so the
      // served count it leaves is complete. Sample until two in a row leave the same count: a host still reading
      // serves at least one frame per turn, so it cannot sit through one, and each sample that sees growth
      // consumed a frame, so there are at most `got` of them. No clock.
      let seen: number;
      let deafAfter: number | undefined;
      let probes = 0;
      do {
        seen = host.served().length;
        deafAfter = await sample(15_000).catch(() => undefined);
      } while (deafAfter !== undefined && host.served().length !== seen && ++probes <= got);
      assert.equal(deafAfter !== undefined, true, "b4a: the host answers a sample after the flood");
      // The host stopped reading requests rather than queueing replies.
      const heldAt = host.served().length - deafServedFrom;
      assert.equal(heldAt < got, true, "b4a: the host served fewer frames than the cell got in");
      // One more sample: a host still reading would have served more by it.
      const settled = await sample(15_000).catch(() => undefined);
      assert.equal(host.served().length - deafServedFrom, heldAt, "b4a: the host stays paused while no reply is read");
      // Memory is bounded: one reply frame at most, never a queued flood.
      assert.equal((settled ?? Infinity) - deafBaseline < 8 * 1024 * 1024, true, "b4a: a deaf flood does not grow the host's memory");

      // The stall is a pause, not a death: the test reads git-reply, the held replies arrive intact and the host serves on.
      const sink = openSync(join(control, "git-reply"), constants.O_RDWR | constants.O_NONBLOCK);
      let drained = "";
      const drain = (): void => {
        const chunk = Buffer.alloc(65536);
        for (;;) {
          try {
            const n = readSync(sink, chunk, 0, chunk.length, null);
            if (n === 0) return;
            drained += chunk.toString("utf8", 0, n);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EAGAIN") return;
            throw error;
          }
        }
      };
      const replies = (): string[] => drained.split("\n").slice(0, -1);
      try {
        await waitFor("the host to deliver every held reply", () => {
          drain();
          return host.served().length - deafServedFrom >= got && replies().length >= got;
        });
        drain();
      } finally {
        closeSync(sink);
      }
      assert.equal(host.served().length - deafServedFrom, got, "b4a: every frame the cell got in is served once the replies are read");
      assert.equal(
        replies().every((line) => {
          try {
            return (JSON.parse(line) as Frame).status === 0;
          } catch {
            return false;
          }
        }),
        true,
        "b4a: every held reply arrives whole",
      );
      assert.equal(replies().length, got, "b4a: one reply per frame, none dropped or repeated");
      const servedBeforeSentinel = host.served().length;
      const fresh = await cellFrames(control, "sentinel");
      assert.deepEqual(answered(fresh, 0), ["z1"], "b4a: a fresh request is answered with its own id");
      assert.equal(host.served().length > servedBeforeSentinel, true, "b4a: the host serves again after the stall");

      // Teardown with a remainder pending: the host is holding an undelivered frame when close() runs below.
      const pendingFrom = host.served().length;
      const again = await runCell(control, "deaf");
      assert.equal(again.signal === null && again.code === 0, true, "b4a: a second deaf cell was refused, not parked");
      const alive = await sample(15_000).catch(() => undefined);
      assert.equal(alive !== undefined, true, "b4a: the host still answers with a reply held");
      assert.equal(host.served().length > pendingFrom, true, "b4a: the second flood reached serve before the stall");

      assert.deepEqual(readdirSync(control).sort(), PIPES, "b4: the host created nothing else");
      host.command("close");
      await waitFor("the host to exit", () => host.exit() !== undefined, 20_000).catch(() => undefined);
      assert.deepEqual(host.exit(), { code: 0, signal: null }, "b4: close() lets the process exit");
    } finally {
      host.child.kill("SIGKILL");
    }
  });
}

// ---------------------------------------------------------------------------
// W-134: a recorded red's identity survives a rebase. The runner finds the red
// log's own commit (the unique commit that introduced its bytes, source-free),
// replays there, and the receipt binds both the claim and the replayed commit.
// Rows are selected by name, one per behaviour: --test-name-pattern=W-134-b1 ..
// b4. Messages are fixed text: no child output is ever interpolated into one,
// so a refusal is asserted as a boolean about the captured stderr.
// ---------------------------------------------------------------------------
if (only === undefined) {
  const hostLogs = (f: Live): Record<string, string> => {
    const dir = join(f.studio, "ci", "reds", OPUS);
    return Object.fromEntries(readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
  };
  const frontOf = (f: Live): Record<string, unknown> => readFront<Record<string, unknown>>(join(f.studio, "opera", `${OPUS}.md`)).data;
  interface Verdict {
    exitCode: number;
    said: (pattern: RegExp) => boolean;
    minted: boolean;
    untouched: boolean;
    clean: boolean;
  }
  /** One run of the real runner on `f`; what it printed, whether it minted, and whether the logs moved. */
  async function attempt(f: Live, cmd: string[]): Promise<Verdict> {
    const before = hostLogs(f);
    const result = await withTmp(f, () => run(builderArgs(f, [], cmd)));
    const receipt = oneReceipt(f.studio) as { exitCode: number; completion?: unknown };
    const errors = result.errors.join("\n");
    return {
      exitCode: result.exitCode,
      said: (pattern) => pattern.test(errors),
      minted: frontOf(f)["run_receipt"] !== undefined || receipt.completion !== undefined,
      untouched: JSON.stringify(hostLogs(f)) === JSON.stringify(before),
      clean: leftovers(f).length === 0,
    };
  }
  const redOf = (f: Live): Record<string, unknown> => {
    const receipt = oneReceipt(f.studio) as { completion?: { redReplays?: Record<string, unknown>[] } };
    return receipt.completion?.redReplays?.[0] ?? {};
  };

  live("W-134-b1 behaviour 1: a rebased branch mints a receipt that names the replayed commit", async () => {
    const f = liveFixture("w134-b1", { rebase: { logs: "once" } });
    const anchor = f.anchor ?? "";
    const before = hostLogs(f);
    const result = await withTmp(f, () => run(builderArgs(f, [], builder(FIX_AND_COMMIT))));
    assert.equal(result.exitCode, 0, "b1: the runner completes on a rebased branch");
    const red = redOf(f);
    assert.equal(red["sourceTree"], f.claimed, "b1: sourceTree keeps the identity the log claims");
    assert.equal(red["commit"], anchor, "b1: commit is the rebased red-log commit");
    assert.equal(red["replayedTree"], sourceTreeOf(f.repo, anchor), "b1: replayedTree is that commit's recomputed source tree");
    assert.notEqual(red["replayedTree"], red["sourceTree"], "b1: the rebase moved the tree the log claims");
    assert.equal(red["assertionFailed"], true, "b1: the replay failed at the assertion");
    assert.equal(typeof frontOf(f)["run_receipt"], "string", "b1: the receipt is attached to the record");
    assert.equal(JSON.stringify(hostLogs(f)), JSON.stringify(before), "b1: the runner only reads the log");
    assert.equal(leftovers(f).length, 0, "b1: runtime and clones are gone");
  });

  live("W-134-b2 behaviour 2: identification is unique and source-free, or it refuses", async () => {
    const refused = (v: Verdict, tag: string): void => {
      assert.notEqual(v.exitCode, 0, `b2${tag}: the run is refused`);
      assert.equal(v.minted, false, `b2${tag}: no receipt is written`);
      assert.equal(v.untouched, true, `b2${tag}: the log is untouched`);
      assert.equal(v.clean, true, `b2${tag}: nothing is left behind`);
    };

    const a = await attempt(liveFixture("w134-b2a", { rebase: { logs: "never" } }), ["true"]);
    refused(a, "a");
    assert.equal(a.said(/producer red replay refused 01\.log: behaviour 1: no commit on the branch introduced its recorded bytes/), true, "b2a: names behaviour 1, the file, and that no commit introduced the bytes");

    const b = await attempt(liveFixture("w134-b2b", { rebase: { logs: "twice" } }), ["true"]);
    refused(b, "b");
    assert.equal(b.said(/producer red replay refused 01\.log: behaviour 1: 2 commits introduced its recorded bytes/), true, "b2b: names behaviour 1, the file, and that two commits introduced the bytes");

    const cFixture = liveFixture("w134-b2c", { rebase: { logs: "with-source" } });
    const c = await attempt(cFixture, ["true"]);
    refused(c, "c");
    assert.equal(
      c.said(new RegExp(`producer red replay refused 01\\.log: behaviour 1: identifying commit ${cFixture.anchor ?? "none"} carries source`)),
      true,
      "b2c: names behaviour 1, the file and the commit that carries source",
    );

    const d = liveFixture("w134-b2d", { rebase: { logs: "decoy" } });
    const decoy = git(d.repo, ["log", `opus/${OPUS}`, "--format=%H", "--fixed-strings", "--grep=chore(studio): decoy log"]);
    const dv = await attempt(d, builder(FIX_AND_COMMIT));
    assert.equal(dv.exitCode, 0, "b2d: a decoy later commit does not stop the run");
    assert.equal(dv.untouched, true, "b2d: the log is untouched");
    assert.equal(redOf(d)["commit"], d.anchor, "b2d: the commit carrying the replayed bytes is selected");
    assert.notEqual(redOf(d)["commit"], decoy, "b2d: the decoy is not selected");
  });

  live("W-134-b3 behaviour 3: a replay that does not reproduce voids the red", async () => {
    const present = liveFixture("w134-b3a", { rebase: { logs: "after-implementation" } });
    const a = await attempt(present, ["true"]);
    assert.notEqual(a.exitCode, 0, "b3a: the run is refused when the implementation is present");
    assert.equal(a.minted, false, "b3a: no receipt is written");
    assert.equal(a.untouched, true, "b3a: the log is byte-identical on disk");
    assert.equal(
      a.said(new RegExp(`red 1 did not reproduce its assertion failure at ${present.anchor ?? "none"}`)),
      true,
      "b3a: names the behaviour and the commit tried",
    );

    const other = liveFixture("w134-b3b", { rebase: { logs: "once", title: "W-134 recorded failure" } });
    const b = await attempt(other, ["true"]);
    assert.notEqual(b.exitCode, 0, "b3b: the run is refused when a recorded title is absent");
    assert.equal(b.minted, false, "b3b: no receipt is written");
    assert.equal(b.untouched, true, "b3b: the log is byte-identical on disk");
    assert.equal(
      b.said(new RegExp(`red 1 did not reproduce its recorded failure at ${other.anchor ?? "none"}`)),
      true,
      "b3b: names the behaviour and the commit tried",
    );
  });

  test("W-134-b4 behaviour 4: the gate admits the rebased identity and re-derives it", async () => {
    const { admitCurrentRunReceipt } = await import("./builder-run.js");
    const { editOpusFrontMatter, markIsolatedBuilderRuntime } = await import("./frontmatter.js");
    const f = liveFixture("w134-b4", { rebase: { logs: "once" } });
    rmSync(join(f.studio, "ci", "reds"), { recursive: true, force: true }); // the branch tracks these logs now
    git(f.repo, ["checkout", "-q", `opus/${OPUS}`]);
    const opusPath = join(f.studio, "opera", `${OPUS}.md`);
    markIsolatedBuilderRuntime(opusPath);
    const finalCommit = git(f.repo, ["rev-parse", "HEAD"]);
    const anchor = f.anchor ?? "";
    const wrong = git(f.repo, ["rev-parse", `${anchor}^`]); // same source tree as the anchor, not the anchor
    let serial = 0;
    const admit = (red: Record<string, unknown>) => {
      serial += 1;
      const rel = `receipts/builder.${OPUS}/b4-${serial}.json`;
      mkdirSync(join(f.studio, "receipts", `builder.${OPUS}`), { recursive: true });
      writeFileSync(
        join(f.studio, rel),
        JSON.stringify({
          schema: 1, harness: "run", sella: `builder.${OPUS}`, sessionId: `b4-${serial}`, startedAt: NOW.toISOString(), cwd: "/disposed",
          cmd: ["builder"], endedAt: NOW.toISOString(), exitCode: 0, durationMs: 1,
          completion: {
            schema: 1, origin: "host-producer", opus: OPUS, branch: `opus/${OPUS}`, builder: `builder.${OPUS}`, producer: "producer",
            baseCommit: finalCommit, finalCommit, finalSourceTree: sourceTreeOf(f.repo, finalCommit), toolingCommit: finalCommit,
            redReplays: [{ behaviour: 1, command: "node --test-reporter=tap red.mjs", assertionFailed: true, ...red }],
            gates: { ci: true, verify: true, check: true }, teardownComplete: true, completed: true,
          },
        }),
      );
      editOpusFrontMatter(opusPath, (doc) => { doc.set("run_receipt", rel); return undefined; });
      return admitCurrentRunReceipt(f.studio, OPUS);
    };
    const refusedAs = (verdict: ReturnType<typeof admit>, pattern: RegExp): boolean => !verdict.ok && pattern.test(verdict.error);

    const rebased = admit({ commit: anchor, sourceTree: f.claimed, replayedTree: sourceTreeOf(f.repo, anchor) });
    assert.equal(rebased.ok, true, "b4: a rebased identity whose replayedTree matches the named commit is admitted");

    const elsewhere = admit({ commit: wrong, sourceTree: f.claimed, replayedTree: sourceTreeOf(f.repo, wrong) });
    assert.equal(refusedAs(elsewhere, /not the rebased pre-change commit/), true, "b4: a receipt naming another commit for a rebased entry is refused");

    const forged = admit({ commit: anchor, sourceTree: f.claimed, replayedTree: `tree:${"b".repeat(40)}` });
    assert.equal(refusedAs(forged, /unreachable or mismatched red identity/), true, "b4: a replayedTree that is not the commit's recomputed tree is refused");

    const direct = admit({ commit: anchor, sourceTree: sourceTreeOf(f.repo, anchor) });
    assert.equal(direct.ok, true, "b4: no replayedTree, a matching sourceTree: today's rule admits");

    const stale = admit({ commit: anchor, sourceTree: f.claimed });
    assert.equal(refusedAs(stale, /unreachable or mismatched red identity/), true, "b4: no replayedTree, a sourceTree no commit has: today's rule refuses");
  });
}

// ---------------------------------------------------------------------------
// W-130 acceptance rows. NOT behaviours and NOT reds: a skipped live row exits 0,
// so none of this can be a recorded red (the five W-130 reds are the unit rows in
// scripts/host-cells.test.mjs and scripts/replay-accept.test.mjs). These carry the
// confined demonstrations, run through the real runner, and are required to RUN
// (not skip) where the socket works. Outside every runs(n) gate; a selected
// W-125 behaviour never runs them.
// ---------------------------------------------------------------------------
if (only === undefined) {
  const W125_ENV = [
    "BISELLIUM_SELLA", "BISELLIUM_SESSION", "BISELLIUM_STUDIO", "CI", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_NAME",
    "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_NAME", "HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ",
    "npm_config_cache", "npm_config_globalconfig", "npm_config_registry", "npm_config_userconfig",
  ];
  const hexLine = <T>(stdout: string, tag: string): T => {
    const line = stdout.split("\n").find((l) => l.startsWith(`${tag} `));
    assert.ok(line, `${tag} must be printed by the confined run`);
    return JSON.parse(Buffer.from(line.slice(tag.length + 1), "hex").toString("utf8")) as T;
  };
  const completion = (res: Direct): { completed?: boolean; redReplays?: { behaviour: number; assertionFailed: boolean }[] } | undefined =>
    res.result?.["completion"] as { completed?: boolean; redReplays?: { behaviour: number; assertionFailed: boolean }[] } | undefined;
  const leaseHeld = (f: Live): boolean => existsSync(join(f.repo, ".bisellium", "leases", OPUS));
  const WRITE = "const w = (p) => { try { fs.writeFileSync(p, 'x'); return 'allowed'; } catch (e) { return e.code; } };";

  live("W-130 acceptance: the browser cache is bound read-only into the builder cell and the replay cell", async () => {
    const builderBody = `${WRITE}
      fs.writeFileSync('evidence.json', JSON.stringify({
        env: Object.keys(process.env).sort(),
        browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
        sentinel: fs.readFileSync('/browsers/sentinel.txt', 'utf8'),
        entries: fs.readdirSync('/browsers'),
        write: w('/browsers/escape'),
      }));
      ${FIX_AND_COMMIT}`;
    const replayRed = [
      "import fs from 'node:fs';",
      "import assert from 'node:assert/strict';",
      WRITE,
      "const o = { browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH, sentinel: fs.readFileSync('/browsers/sentinel.txt', 'utf8'), write: w('/browsers/escape') };",
      // Hex: the replay's failure classifier scans raw output for errno names.
      "console.log('REPLAY-BROWSERS ' + Buffer.from(JSON.stringify(o)).toString('hex'));",
      "assert.equal(1, 2);",
      "",
    ].join("\n");
    const f = liveFixture("w130-browsers", { red: replayRed });
    const res = runnerRun(f, builder(builderBody));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2500));
    assert.match(res.stderr, /browser cache bound read-only at \/browsers from /, "the runner names the bind it made");
    assert.equal(/no playwright browser cache found/.test(res.stderr), false, "exactly one of the two resolution lines is logged");

    const ev = JSON.parse(git(f.repo, ["show", `refs/heads/opus/${OPUS}:evidence.json`])) as { env: string[]; browsersPath: string; sentinel: string; entries: string[]; write: string };
    assert.equal(ev.browsersPath, "/browsers", "builder cell: the fixed cell path is the browsers path");
    assert.equal(ev.sentinel, SENTINEL_TEXT, "builder cell: the host cache is readable at /browsers");
    assert.deepEqual(ev.entries, ["sentinel.txt"], "builder cell: /browsers holds exactly the host cache");
    assert.equal(ev.write, "EROFS", "builder cell: /browsers is read-only");
    assert.equal(ev.env.length, 19, `builder cell: exactly 19 environment names, got ${ev.env.join(",")}`);
    assert.deepEqual(ev.env.filter((name) => !W125_ENV.includes(name)), ["PLAYWRIGHT_BROWSERS_PATH"], "builder cell: W-125's 18 plus the one new name");
    assert.deepEqual(W125_ENV.filter((name) => !ev.env.includes(name)), [], "builder cell: all of W-125's 18 are present");

    const o = hexLine<{ browsersPath: string; sentinel: string; write: string }>(res.stdout, "REPLAY-BROWSERS");
    assert.equal(o.browsersPath, "/browsers", "replay cell: the fixed cell path is the browsers path");
    assert.equal(o.sentinel, SENTINEL_TEXT, "replay cell: the host cache is readable at /browsers");
    assert.equal(o.write, "EROFS", "replay cell: /browsers is read-only");

    assert.deepEqual(readdirSync(BROWSERS), ["sentinel.txt"], "the host cache gained no file from either cell");
    assert.equal(readFileSync(join(BROWSERS, "sentinel.txt"), "utf8"), SENTINEL_TEXT, "the host cache bytes are unchanged");
    assert.deepEqual(leftovers(f), []);
    assert.equal(leaseHeld(f), false, "lease released");
  });

  const buildProbe = (canary: string, hostWrite: string): string => `
    import fs from 'node:fs';
    import net from 'node:net';
    ${WRITE}
    const o = {
      lifecycle: process.env.npm_lifecycle_event,
      pkg: process.env.npm_package_name,
      leaks: ['GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'NPM_TOKEN', 'HTTPS_PROXY', 'NODE_OPTIONS', 'AWS_ACCESS_KEY_ID'].filter((k) => k in process.env),
      canaryVisible: fs.existsSync(${JSON.stringify(canary)}),
      hostWrite: w(${JSON.stringify(hostWrite)}),
      usrWrite: w('/usr/escape'),
    };
    // No timer: with no network namespace interface the connect fails at once, and a hung one ends at the row's own deadline.
    o.net = await new Promise((res) => {
      const s = net.connect({ host: '1.1.1.1', port: 443 });
      s.once('error', (e) => res(e.code));
      s.once('connect', () => { s.destroy(); res('connected'); });
    });
    fs.mkdirSync('dist', { recursive: true });
    fs.writeFileSync('dist/index.html', '<!doctype html>\\n');
    fs.writeFileSync('dist/observations.json', JSON.stringify(o));
  `;

  live("W-130 acceptance: replay preparation builds the web bundle with the fixed host command, confined", async () => {
    const area = scratch("w130-host-area");
    const canary = join(area, "canary.txt");
    const hostWrite = join(area, "escaped.txt");
    writeFileSync(canary, "host-only\n");
    const red = [
      "import fs from 'node:fs';",
      "import assert from 'node:assert/strict';",
      "const bundle = fs.existsSync('apps/web/dist/index.html');",
      "const o = bundle ? JSON.parse(fs.readFileSync('apps/web/dist/observations.json', 'utf8')) : {};",
      "console.log('BUILD-OBSERVATIONS ' + Buffer.from(JSON.stringify({ bundle, ...o })).toString('hex'));",
      "assert.equal(1, 2);",
      "",
    ].join("\n");
    const f = liveFixture("w130-bundle", { web: buildProbe(canary, hostWrite), red });
    const res = runnerRun(f, builder(""));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2500));
    const o = hexLine<{ bundle: boolean; lifecycle: string; pkg: string; leaks: string[]; canaryVisible: boolean; hostWrite: string; usrWrite: string; net: string }>(res.stdout, "BUILD-OBSERVATIONS");
    assert.equal(o.bundle, true, "the bundle exists before the recorded command runs");
    assert.equal(o.lifecycle, "build", "the fixed host command ran the web workspace's build script");
    assert.equal(o.pkg, "@bisellium/web", "the fixed host command selected the web workspace");
    assert.deepEqual(o.leaks, [], "the build saw no credential or proxy variable");
    assert.equal(o.canaryVisible, false, "the build saw no host file");
    assert.notEqual(o.hostWrite, "allowed", "the build could not write a host path");
    assert.notEqual(o.usrWrite, "allowed", "the build could not write the system tree");
    assert.match(o.net, /^ENET/, "the build had no egress");
    assert.equal(existsSync(hostWrite), false, "no build code reached the host filesystem");
    assert.equal(completion(res)?.completed, true, "the run completed");
    assert.deepEqual(completion(res)?.redReplays?.map((r) => [r.behaviour, r.assertionFailed]), [[1, true]], "the replay was accepted after the build");
    assert.deepEqual(leftovers(f), []);
  });

  for (const [name, web, pattern] of [
    ["a build that exits nonzero", "process.exit(3);\n", /red 1 replay preparation failed: web bundle build exited 3/],
    ["a build that exits 0 and leaves no bundle", "\n", /red 1 replay preparation failed: the web bundle build left no apps\/web\/dist\/index\.html/],
  ] as const)
    live(`W-130 acceptance: ${name} refuses the replay with a preparation message`, async () => {
      const f = liveFixture(`w130-prep-${name.replace(/\W+/g, "-")}`, { web });
      const res = runnerRun(f, builder(""));
      assert.notEqual(res.status, 0, "the run must fail");
      assert.match(res.stderr, pattern, "the preparation message is named");
      assert.equal(/did not reproduce its assertion failure/.test(res.stderr), false, "a preparation failure is never read as a refused red");
      assert.equal(completion(res), undefined, "no completion is recorded");
      assert.equal(tip(f), f.base, "the owning branch is unmoved");
      assert.equal(leaseHeld(f), false, "lease released");
      assert.deepEqual(leftovers(f), [], "no bisellium-* directory behind");
    });

  const PW_MATCHER = "  1) [chromium] > walk.spec.ts:10:1 > the walk\n\n    Error: expect(locator).toHaveCount(expected) failed\n\n";
  const PW_ONE = `Running 1 test using 1 worker\n\n${PW_MATCHER}  1 failed\n`;
  const PW_MISSING_BROWSER = "Running 1 test using 1 worker\n\n  Error: browserType.launch: Executable doesn't exist at /a/b/c\n\n  1 failed\n";
  const PW_THREE_AND_NOT_OK = `Running 3 tests using 1 worker\nnot ok 1 - setup\n\n${PW_MATCHER}  3 failed\n`;
  const canned = (transcript: string): string => `process.stdout.write(${JSON.stringify(transcript)});\nprocess.exit(1);\n`;

  live("W-130 acceptance: a canned playwright transcript completes a run through the classifier", async () => {
    const f = liveFixture("w130-pw-accepted", { red: canned(PW_ONE) });
    const res = runnerRun(f, builder(""));
    assert.equal(res.status, 0, `${res.stderr}\n${res.stdout}`.slice(-2500));
    assert.equal(completion(res)?.completed, true, "the run completed");
    assert.deepEqual(completion(res)?.redReplays?.map((r) => [r.behaviour, r.assertionFailed]), [[1, true]], "the playwright red was accepted");
    assert.equal(leaseHeld(f), false, "lease released");
    assert.deepEqual(leftovers(f), []);
  });

  for (const [name, transcript, pattern] of [
    ["a canned missing-browser transcript", PW_MISSING_BROWSER, /did not reproduce its assertion failure: the output names an environment failure \(browserType\.launch\)/],
    ["a canned three-failure transcript carrying an echoed not ok line", PW_THREE_AND_NOT_OK, /did not reproduce its assertion failure: playwright reported 3 failed tests/],
  ] as const)
    live(`W-130 acceptance: ${name} refuses the run before the gate cell`, async () => {
      const f = liveFixture(`w130-pw-${name.replace(/\W+/g, "-")}`, { red: canned(transcript) });
      const res = runnerRun(f, builder(""));
      assert.notEqual(res.status, 0, "the run must fail");
      assert.match(res.stderr, pattern, "the refusal names its reason");
      assert.equal(/replay preparation failed/.test(res.stderr), false, "a refused red is never read as a preparation failure");
      assert.equal(res.stdout.includes("gate ok"), false, "the gate cell never ran");
      assert.equal(completion(res), undefined, "no completion is recorded");
      assert.equal(tip(f), f.base, "the owning branch is unmoved");
      assert.equal(leaseHeld(f), false, "lease released");
      assert.deepEqual(leftovers(f), [], "no bisellium-* directory behind");
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
    const worktree = join(scratch("generic-opus-base"), "worktree");
    const cloneProvider: WorktreeProvider = {
      id: "w125-generic-clone-fixture",
      async acquire({ repo, base }) {
        assert.equal(base, `opus/${OPUS}`);
        cpSync(repo, worktree, { recursive: true });
        writeFileSync(join(worktree, "opus-marker.txt"), "opus base marker\n");
        return { path: worktree, branch: "bisellium/eng-lead/1", release: async () => undefined };
      },
    };
    const based = await run([
      "--sella", "eng-lead", "--opus", OPUS, "--studio", f.studio,
      "--repo", f.repo, "--keep", "--", process.execPath, "-e", "process.exit(0)",
    ], cloneProvider);
    assert.equal(based.exitCode, 0, based.errors.join("; "));
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
    assert.equal(matchingInstance.exitCode, 2);
    assert.equal(existsSync(join(f.studio, "receipts", "builder.W-200")), false);
    const mismatch = await run([
      "--sella", "builder.W-200", "--opus", "W-999", "--studio", f.studio,
      "--no-worktree", "--", "true",
    ]);
    assert.equal(mismatch.exitCode, 2);

    const minted = await run([
      "--sella", "builder", "--opus", "W-200", "--studio", f.studio,
      "--no-worktree", "--", process.execPath, "-e", "process.exit(0)",
    ]);
    assert.equal(minted.exitCode, 2);
  });
}
