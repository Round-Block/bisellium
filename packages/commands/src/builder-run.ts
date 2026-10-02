/** Private W-125 builder runtime and current-tree review admission seam. */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFront, readManifest } from "@bisellium/adapter-native";
import {
  isDirtyOutside, makeSessionId, sourceTreeHash, writeReceiptEnd, writeReceiptStart,
  type WorktreeProvider,
} from "@bisellium/shim";
import { builderRuntimeObligation, editOpusFrontMatter, markIsolatedBuilderRuntime } from "./frontmatter.js";

interface BuilderRunCompletion {
  schema: 1; origin: "host-producer"; opus: string; branch: string; builder: string; producer: string;
  baseCommit: string; finalCommit: string; finalSourceTree: `tree:${string}`; toolingCommit: string;
  redReplays: Array<{ behaviour: number; commit: string; sourceTree: `tree:${string}`; command: string; assertionFailed: true }>;
  gates: { ci: true; verify: true; check: true }; teardownComplete: true; completed: true;
}

const HOST_RUNNER = fileURLToPath(new URL("../../../scripts/run-builder-host.mjs", import.meta.url));
const GIT_TIMEOUT_MS = 30_000;
const TOOL_PATH = "/usr/local/bin:/usr/bin:/bin";

export interface BuilderRunRequest {
  repo: string; studioRoot: string; studioRelative: string; opus: string;
  sella: string; slug: string; cmd: string[]; keep: boolean; now: Date;
  /** Test-only. Production never supplies a generic worktree provider. */
  provider?: WorktreeProvider;
}
export interface BuilderRunResult { exitCode: number }
interface HostResult { exitCode: number; runtime: string; completion?: BuilderRunCompletion; error?: string }

function childExit(cmd: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((done) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env, stdio: "inherit" });
    child.once("error", (error) => { console.error(`bisellium run: failed to start "${cmd[0]}": ${error.message}`); done(127); });
    child.once("exit", (code, signal) => {
      if (code !== null) return done(code);
      const number = signal === "SIGTERM" ? 15 : signal === "SIGKILL" ? 9 : signal === "SIGINT" ? 2 : 0;
      done(signal ? 128 + number : 1);
    });
  });
}

function fixedBuilderEnv(request: BuilderRunRequest, sessionId: string): NodeJS.ProcessEnv {
  const privateRoot = join(tmpdir(), `bisellium-builder-test-${process.pid}`);
  return {
    PATH: TOOL_PATH, HOME: privateRoot, TMPDIR: privateRoot, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", CI: "1",
    GIT_AUTHOR_NAME: request.sella, GIT_AUTHOR_EMAIL: `${request.sella}@${request.slug}.bisellium`,
    GIT_COMMITTER_NAME: request.sella, GIT_COMMITTER_EMAIL: `${request.sella}@${request.slug}.bisellium`,
    BISELLIUM_SELLA: request.sella, BISELLIUM_STUDIO: request.slug, BISELLIUM_SESSION: sessionId,
    npm_config_cache: join(privateRoot, "npm-cache"), npm_config_userconfig: join(privateRoot, "npmrc"),
    npm_config_globalconfig: join(privateRoot, "npmrc-global"), npm_config_registry: "https://registry.npmjs.org",
  };
}

/** A real object+scratch-index write; the caller's index is never touched. */
function gitWriteProbe(cwd: string): boolean {
  // The provider fixture deliberately models the historical index.lock
  // denial. Production uses the broker-owned scratch index probe in the
  // retained host runner; this fast seam avoids depending on nested Git in a
  // test sandbox that may deny spawning it altogether.
  const lock = join(cwd, ".git", "index.lock");
  try {
    const fd = openSync(lock, "wx", 0o600);
    closeSync(fd);
    unlinkSync(lock);
    return true;
  } catch { return false; }
}

function runFixtureProducerGates(cwd: string): boolean {
  for (const name of readdirSync(cwd).filter((entry) => entry.endsWith(".test.mjs")).sort()) {
    const result = spawnSync(process.execPath, ["--test", name], { cwd, stdio: "inherit", timeout: 60_000 });
    if (result.status !== 0) return false;
  }
  return true;
}

async function runProviderFixture(request: BuilderRunRequest): Promise<BuilderRunResult> {
  let acquired: Awaited<ReturnType<WorktreeProvider["acquire"]>> | undefined;
  let exitCode = 1;
  let receiptFile: string | undefined;
  const sessionId = makeSessionId(request.now);
  const wallStart = Date.now();
  try {
    acquired = await request.provider!.acquire({ repo: request.repo, sella: request.sella, base: `opus/${request.opus}` });
    receiptFile = writeReceiptStart(request.studioRoot, { sella: request.sella, sessionId, startedAt: request.now.toISOString(), cwd: acquired.path, cmd: request.cmd });
    exitCode = await childExit(request.cmd, acquired.path, fixedBuilderEnv(request, sessionId));
    if (exitCode === 0 && !gitWriteProbe(acquired.path)) { console.error(`bisellium run: builder Git write probe failed in ${acquired.path}`); exitCode = 1; }
    if (exitCode === 0 && !runFixtureProducerGates(acquired.path)) { console.error("bisellium run: producer recomputation failed"); exitCode = 1; }
  } catch (error) {
    console.error(`bisellium run: builder fixture failed: ${(error as Error).message}`);
    exitCode = 1;
  } finally {
    if (acquired !== undefined) {
      try { await acquired.release(); }
      catch (error) { console.error(`bisellium run: mandatory runtime disposal failed: ${(error as Error).message}`); exitCode = 1; }
    }
    if (receiptFile !== undefined) writeReceiptEnd(receiptFile, { endedAt: new Date().toISOString(), exitCode, durationMs: Date.now() - wallStart });
  }
  return { exitCode };
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

function attachReceipt(studioRoot: string, opus: string, receiptFile: string): void {
  const opusPath = join(studioRoot, "opera", `${opus}.md`);
  if (!existsSync(opusPath)) throw new Error(`missing owning opus record ${opusPath}`);
  const rel = relative(studioRoot, receiptFile).split(sep).join("/");
  editOpusFrontMatter(opusPath, (doc) => { doc.set("run_receipt", rel); return undefined; });
}

/**
 * The per-opus producer lease: an atomically created directory naming its
 * owner. A lease whose owner process is gone (a double kill) is reclaimed; a
 * live owner's is refused. A lease with no readable owner is treated as live.
 */
export function acquireProducerLease(repo: string, opus: string): string | undefined {
  const lease = join(repo, ".bisellium", "leases", opus);
  mkdirSync(dirname(lease), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lease);
      writeFileSync(join(lease, "pid"), `${process.pid}\n`);
      return lease;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number.parseInt(readOptional(join(lease, "pid")) ?? "", 10);
      if (!Number.isInteger(owner) || owner <= 0 || ownerAlive(owner)) return undefined;
      rmSync(lease, { recursive: true, force: true });
    }
  }
  return undefined;
}

function readOptional(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

function ownerAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * A runner that died without running its `finally` (SIGKILL, OOM, our own
 * timeout) reported its runtime in the result file before it could be killed;
 * remove exactly that directory, and only if it is a runner-made directory
 * directly under the temp root.
 */
export function cleanupAbandonedRuntime(resultFile: string, tmpRoot: string = tmpdir()): void {
  let runtime: unknown;
  try { runtime = (JSON.parse(readFileSync(resultFile, "utf8")) as { runtime?: unknown }).runtime; } catch { return; }
  if (typeof runtime !== "string" || !isAbsolute(runtime)) return;
  if (dirname(runtime) !== resolve(tmpRoot) || !/^bisellium-W-[0-9]+-/.test(basename(runtime))) return;
  rmSync(runtime, { recursive: true, force: true });
}

/** Same rule as rules/evidence.ts `countBehaviours` (packages/commands cannot import the CLI package). */
function declaredBehaviours(briefText: string): number {
  const lines = briefText.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Behaviours to test");
  if (start === -1) return 0;
  let count = 0;
  let inFence = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\s{0,3}```/.test(line)) inFence = !inFence;
    else if (inFence) continue;
    else if (/^## /.test(line)) break;
    else if (/^\s{0,3}\d+\.\s/.test(line)) count++;
  }
  return count;
}

export async function runBuilderCommand(request: BuilderRunRequest): Promise<BuilderRunResult> {
  const opusPath = join(request.studioRoot, "opera", `${request.opus}.md`);
  if (request.provider !== undefined) {
    try { markIsolatedBuilderRuntime(opusPath); }
    catch (error) {
      console.error(`bisellium run: could not persist builder_runtime: ${(error as Error).message}`);
      return { exitCode: 1 };
    }
    return runProviderFixture(request);
  }

  const branch = `opus/${request.opus}`;
  const branchResult = spawnSync("git", ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`], {
    cwd: request.repo, encoding: "utf8", timeout: GIT_TIMEOUT_MS,
  });
  if (branchResult.status !== 0) {
    console.error(`bisellium run: owning branch ${branch} is unavailable`);
    return { exitCode: 1 };
  }

  let leasePath: string | undefined;
  try {
    leasePath = acquireProducerLease(request.repo, request.opus);
  } catch (error) {
    console.error(`bisellium run: producer lease for ${request.opus} is unavailable: ${(error as Error).message}`);
    return { exitCode: 1 };
  }
  if (leasePath === undefined) {
    console.error(`bisellium run: producer lease for ${request.opus} is held by a live run`);
    return { exitCode: 1 };
  }

  // The host result travels through a file in a directory no sandbox can see
  // (never stdout, which candidate code shares): the only source of truth.
  const resultDir = mkdtempSync(join(tmpdir(), "bisellium-result-"));
  const resultFile = join(resultDir, "result.json");
  try {
    try { markIsolatedBuilderRuntime(opusPath); }
    catch (error) {
      console.error(`bisellium run: could not persist builder_runtime: ${(error as Error).message}`);
      return { exitCode: 1 };
    }

    const sessionId = makeSessionId(request.now);
    const receiptFile = writeReceiptStart(request.studioRoot, { sella: request.sella, sessionId, startedAt: request.now.toISOString(), cwd: "disposable-clone (pending)", cmd: request.cmd });
    const wallStart = Date.now();
    const encoded = Buffer.from(JSON.stringify({ ...request, now: request.now.toISOString(), sessionId, leaseOwned: true, resultFile })).toString("base64url");
    const child = spawnSync(process.execPath, [HOST_RUNNER, "--request", encoded], {
      cwd: request.repo,
      env: { PATH: process.env["PATH"] ?? TOOL_PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", ...(process.env["TMPDIR"] ? { TMPDIR: process.env["TMPDIR"] } : {}) },
      encoding: "utf8", timeout: 60 * 60_000, maxBuffer: 512 * 1024 * 1024,
    });
    if (child.stdout) console.log(child.stdout.trimEnd());
    if (child.stderr) console.error(child.stderr.trimEnd());
    let host: HostResult = { exitCode: child.status ?? 1, runtime: "unknown", error: child.error?.message };
    try { host = JSON.parse(readFileSync(resultFile, "utf8")) as HostResult; }
    catch { host = { exitCode: child.status === 0 ? 1 : (child.status ?? 1), runtime: "unknown", error: "host runner left no result" }; }
    // A runner killed before its own teardown (timeout, OOM, SIGKILL) leaves its runtime behind.
    cleanupAbandonedRuntime(resultFile);
    let exitCode = host.exitCode;
    if (child.error !== undefined || child.status === null || child.status !== 0 || host.completion === undefined) exitCode = exitCode === 0 ? 1 : exitCode;
    writeReceiptEnd(receiptFile, { endedAt: new Date().toISOString(), exitCode, durationMs: Date.now() - wallStart, ...(exitCode === 0 && host.completion ? { completion: host.completion } : {}) });
    if (exitCode === 0) {
      try { attachReceipt(request.studioRoot, request.opus, receiptFile); }
      catch (error) {
        console.error(`bisellium run: could not attach host receipt: ${(error as Error).message}`);
        exitCode = 1;
        writeReceiptEnd(receiptFile, { endedAt: new Date().toISOString(), exitCode, durationMs: Date.now() - wallStart });
      }
    }
    return { exitCode };
  } finally {
    rmSync(resultDir, { recursive: true, force: true });
    rmSync(leasePath, { recursive: true, force: true });
  }
}

export type RunReceiptAdmission = { ok: true; receipt: string } | { ok: false; error: string };

/** Shared by producer dispatch and direct/manual review. No verdict bypass. */
export function admitCurrentRunReceipt(studioRoot: string, opus: string): RunReceiptAdmission {
  try {
    const opusPath = join(studioRoot, "opera", `${opus}.md`);
    const obligation = builderRuntimeObligation(opusPath);
    if (obligation.kind === "invalid") return { ok: false, error: obligation.error };
    if (obligation.kind === "legacy") return { ok: true, receipt: "legacy-unmarked" };
    const front = readFront<{ run_receipt?: unknown }>(opusPath).data;
    if (typeof front.run_receipt !== "string" || front.run_receipt.trim() === "") return { ok: false, error: `${opus}: review requires a current host-produced run receipt` };
    const path = resolve(studioRoot, front.run_receipt);
    if (!contained(studioRoot, path) || !contained(join(studioRoot, "receipts"), path)) return { ok: false, error: `${opus}: run_receipt escapes receipts/` };
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !contained(realpathSync(studioRoot), realpathSync(path))) return { ok: false, error: `${opus}: run_receipt is not a contained regular file` };
    const receipt = JSON.parse(readFileSync(path, "utf8")) as { sella?: unknown; harness?: unknown; exitCode?: unknown; completion?: Partial<BuilderRunCompletion> };
    const c = receipt.completion;
    const oid = /^[0-9a-f]{40}$/;
    if (receipt.exitCode !== 0 || c?.schema !== 1 || c.origin !== "host-producer" || c.completed !== true || c.teardownComplete !== true ||
        c.opus !== opus || c.branch !== `opus/${opus}` || c.gates?.ci !== true || c.gates?.verify !== true || c.gates?.check !== true ||
        typeof c.builder !== "string" || receipt.sella !== c.builder || receipt.harness !== "run" || typeof c.producer !== "string" ||
        !Array.isArray(c.redReplays) || c.redReplays.length === 0 || !oid.test(c.baseCommit ?? "") || !oid.test(c.finalCommit ?? "") || !oid.test(c.toolingCommit ?? "") ||
        !/^tree:[0-9a-f]{40}$/.test(c.finalSourceTree ?? "") || c.redReplays.some((red) => !Number.isInteger(red.behaviour) || red.behaviour < 1 ||
          !oid.test(red.commit) || !/^tree:[0-9a-f]{40}$/.test(red.sourceTree) || red.assertionFailed !== true))
      return { ok: false, error: `${opus}: run_receipt is failed, malformed, incomplete or not host-produced` };
    const rootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: studioRoot, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
    if (rootResult.status !== 0) return { ok: false, error: `${opus}: current source tree is unavailable` };
    const repo = resolve(rootResult.stdout.trim());
    const manifest = readManifest(studioRoot);
    const studioRel = relative(repo, studioRoot).split(sep).join("/");
    const exclusions = [studioRel, ".bisellium", ...(manifest.source_excludes ?? [])];
    if (isDirtyOutside(repo, exclusions)) return { ok: false, error: `${opus}: current source tree is dirty` };
    const currentTree = `tree:${sourceTreeHash(repo, exclusions, "HEAD")}`;
    if (c.finalSourceTree !== currentTree) return { ok: false, error: `${opus}: run_receipt is stale for the current source tree` };
    const reachable = spawnSync("git", ["merge-base", "--is-ancestor", c.finalCommit!, "HEAD"], { cwd: repo, timeout: GIT_TIMEOUT_MS });
    if (reachable.status !== 0) return { ok: false, error: `${opus}: run_receipt final commit is not reachable` };
    const behaviours = new Set<number>();
    for (const red of c.redReplays) {
      if (behaviours.has(red.behaviour)) return { ok: false, error: `${opus}: run_receipt has duplicate red behaviour ${red.behaviour}` };
      behaviours.add(red.behaviour);
      const redReachable = spawnSync("git", ["merge-base", "--is-ancestor", red.commit, c.finalCommit!], { cwd: repo, timeout: GIT_TIMEOUT_MS });
      if (redReachable.status !== 0 || `tree:${sourceTreeHash(repo, exclusions, red.commit)}` !== red.sourceTree)
        return { ok: false, error: `${opus}: run_receipt has an unreachable or mismatched red identity` };
    }
    // One red does not suffice: every numbered behaviour in the brief needs its replayed red.
    const declared = declaredBehaviours(readFileSync(join(studioRoot, "briefs", `${opus}.md`), "utf8"));
    if (declared === 0) return { ok: false, error: `${opus}: brief declares no numbered behaviours to replay` };
    for (let n = 1; n <= declared; n++)
      if (!behaviours.has(n)) return { ok: false, error: `${opus}: run_receipt lacks a replayed red for behaviour ${n}` };
    return { ok: true, receipt: front.run_receipt };
  } catch (error) {
    return { ok: false, error: `${opus}: invalid run_receipt: ${(error as Error).message}` };
  }
}
