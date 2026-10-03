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
 * Every row owns a fresh temporary repository and officina. Nothing here
 * reads from or writes to studio/ or examples/sample-studio.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
// The Git broker is a Unix socket; a host sandbox that forbids binding one cannot run the production runner.
const socketUsable =
  spawnSync(process.execPath, ["-e", "require('net').createServer().on('error',()=>process.exit(1)).listen(process.argv[1],()=>process.exit(0))", join(tmpdir(), `w125-sock-${process.pid}`)], { timeout: 10_000 }).status === 0;
const liveSkip = !bwrapUsable ? "bwrap is unusable on this host" : !socketUsable ? "this host's sandbox forbids binding a Unix socket (the Git broker needs one)" : false;
// Every live row is recorded here so W-132 behaviour 1 can count the ones the gate skips.
const liveRows: { skipped: boolean }[] = [];
const live = (name: string, fn: () => Promise<void>): void => {
  liveRows.push({ skipped: liveSkip !== false });
  test(name, { skip: liveSkip, timeout: 240_000 }, fn);
};

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
}
interface Live extends Fixture {
  tmp: string;
  base: string;
}

function liveFixture(tag: string, o: LiveOptions = {}): Live {
  const owned = o.owned === undefined ? OWNED : o.owned;
  const behaviours = o.behaviours ?? 1;
  const f = fixture(tag, (repo, studio) => {
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n.bisellium/\n");
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

/** Run `fn` with the producer's temp root pinned to the row's private directory. */
async function withTmp<T>(f: Live, fn: () => Promise<T>): Promise<T> {
  const old = process.env["TMPDIR"];
  process.env["TMPDIR"] = f.tmp;
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env["TMPDIR"];
    else process.env["TMPDIR"] = old;
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
    assert.equal((ev["env"] as string[]).length, 18, `exact allowlist, got ${String(ev["env"])}`);
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
    assert.equal(liveRows.length >= 14, true, "b1: no pre-existing live row was dropped");
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
    const sample = async (): Promise<number> => {
      const seen = host.lines.filter((line) => line.t === "mem").length;
      host.command("sample");
      await waitFor("a memory sample", () => host.lines.filter((line) => line.t === "mem").length > seen);
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

      assert.deepEqual(readdirSync(control).sort(), PIPES, "b4: the host created nothing else");
      host.command("close");
      await waitFor("the host to exit", () => host.exit() !== undefined, 20_000).catch(() => undefined);
      assert.deepEqual(host.exit(), { code: 0, signal: null }, "b4: close() lets the process exit");
    } finally {
      host.child.kill("SIGKILL");
    }
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
