/** Private W-125 builder runtime and current-tree review admission seam. */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFront, readManifest } from "@bisellium/adapter-native";
import {
  isDirtyOutside, makeSessionId, sourceTreeHash, writeReceiptEnd, writeReceiptStart,
  type WorktreeProvider,
} from "@bisellium/shim";
import { editOpusFrontMatter } from "./frontmatter.js";

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

export async function runBuilderCommand(request: BuilderRunRequest): Promise<BuilderRunResult> {
  if (request.provider !== undefined) return runProviderFixture(request);
  const sessionId = makeSessionId(request.now);
  const receiptFile = writeReceiptStart(request.studioRoot, { sella: request.sella, sessionId, startedAt: request.now.toISOString(), cwd: "disposable-clone (pending)", cmd: request.cmd });
  const wallStart = Date.now();
  const encoded = Buffer.from(JSON.stringify({ ...request, now: request.now.toISOString(), sessionId })).toString("base64url");
  const child = spawnSync(process.execPath, [HOST_RUNNER, "--request", encoded], {
    cwd: request.repo, env: { PATH: process.env["PATH"] ?? TOOL_PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
    encoding: "utf8", timeout: 60 * 60_000,
  });
  if (child.stdout) process.stdout.write(child.stdout.replace(/^BISELLIUM_HOST_RESULT .*$/gm, ""));
  if (child.stderr) process.stderr.write(child.stderr);
  let host: HostResult = { exitCode: child.status ?? 1, runtime: "unknown", error: child.error?.message };
  const resultLine = child.stdout?.split("\n").find((line) => line.startsWith("BISELLIUM_HOST_RESULT "));
  if (resultLine !== undefined) {
    try { host = JSON.parse(resultLine.slice("BISELLIUM_HOST_RESULT ".length)) as HostResult; }
    catch { host = { exitCode: 1, runtime: "unknown", error: "malformed host-runner result" }; }
  }
  let exitCode = host.exitCode;
  if (child.error !== undefined || child.status === null || host.completion === undefined) exitCode = exitCode === 0 ? 1 : exitCode;
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
}

export type RunReceiptAdmission = { ok: true; receipt: string } | { ok: false; error: string };

/** Shared by producer dispatch and direct/manual review. No verdict bypass. */
export function admitCurrentRunReceipt(studioRoot: string, opus: string): RunReceiptAdmission {
  try {
    const opusPath = join(studioRoot, "opera", `${opus}.md`);
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
    return { ok: true, receipt: front.run_receipt };
  } catch (error) {
    return { ok: false, error: `${opus}: invalid run_receipt: ${(error as Error).message}` };
  }
}
