import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  constants as FS,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LIMITS,
  captureFixtureIdentity,
  exactCanaryArgv,
  verifyCanary,
} from "./source-adapter-preflight.mjs";

export const W109_LIMITS = Object.freeze({
  stdoutBytes: LIMITS.modelEventBytes,
  stdoutRecords: LIMITS.modelEventLines,
  stderrBytes: LIMITS.stderrBytes,
  transcriptBytes: 1048576,
  deadlineMs: LIMITS.canaryDeadlineMs,
  termGraceMs: 1000,
});

const PROMPT =
  "Use only the w108_source tools. Call orient first, then locate and read to find the requested public synthetic fact. Reply with the fact and its exact source.md:<line> citation. Do not guess or use any other tool.";
const FACT = "cobalt-orchid-731";
const CITATION = "source.md:3";
const SERVER = "w108_source";

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function beneath(parent, child) {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function fileIdentity(pathInput) {
  const path = realpathSync(pathInput);
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error("IDENTITY");
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: hash(bytes) };
}

function executableIdentity(pathInput) {
  const identity = fileIdentity(pathInput);
  const run = spawnSync(identity.path, ["--version"], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 65536,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (run.status !== 0 || !run.stdout.trim()) throw new Error("EXECUTABLE");
  return { ...identity, version: run.stdout.trim() };
}

function assertPrivateDirectory(pathInput, create = false) {
  const path = resolve(pathInput);
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700)
    throw new Error("PRIVATE_PARENT");
  return realpathSync(path);
}

function readSafeAuth(pathInput) {
  const path = resolve(pathInput);
  const fd = openSync(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600)
      throw new Error("AUTH_UNSAFE");
    const bytes = readFileSync(fd);
    if (bytes.length === 0 || bytes.length > 1048576) throw new Error("AUTH_UNSAFE");
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function writeNew(path, bytes, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx", mode });
}

function writeJsonNew(path, value) {
  writeNew(path, `${JSON.stringify(value, null, 2)}\n`);
}

function optionPaths(options) {
  const repo = realpathSync(options.repo);
  const evidence = resolve(options.evidence);
  const cwd = realpathSync(options.cwd);
  if (!statSync(cwd).isDirectory() || readdirSync(cwd).length !== 0) throw new Error("CWD_NOT_EMPTY");
  return {
    repo,
    evidence,
    cwd,
    runtimeParent: assertPrivateDirectory(options.runtimeParent),
    auth: resolve(options.auth),
    registry: resolve(options.registry),
    codex: resolve(options.codex),
    node: resolve(options.node),
    runner: resolve(options.runner),
    test: resolve(options.test),
    adapter: resolve(options.adapter),
    productionSource: resolve(options.productionSource),
    marker: join(evidence, "attempt-marker.json"),
    result: join(evidence, "result.json"),
    freeze: join(evidence, "freeze.json"),
  };
}

function safeRefusal(reason) {
  return { version: 1, outcome: "REFUSED", reason, modelSpawns: 0 };
}

function preflightReason(error) {
  const known = new Set(["OPTIONS", "CWD_NOT_EMPTY", "PRIVATE_PARENT", "AUTH_UNSAFE", "ATTEMPT_EXISTS", "IDENTITY", "EXECUTABLE"]);
  return error instanceof Error && known.has(error.message) ? error.message : "PREFLIGHT";
}

function validateOptions(options) {
  if (!options || typeof options !== "object") throw new Error("OPTIONS");
  const paths = optionPaths(options);
  mkdirSync(paths.evidence, { recursive: true });
  if (existsSync(paths.marker) || existsSync(paths.result)) throw new Error("ATTEMPT_EXISTS");
  const authBytes = readSafeAuth(paths.auth);
  const fixtureIdentity = captureFixtureIdentity(paths.registry, paths.repo);
  const codex = executableIdentity(paths.codex);
  const node = executableIdentity(paths.node);
  if (node.path !== realpathSync(process.execPath)) throw new Error("EXECUTABLE");
  const files = {
    runner: fileIdentity(paths.runner),
    test: fileIdentity(paths.test),
    adapter: fileIdentity(paths.adapter),
    productionSource: fileIdentity(paths.productionSource),
    registry: fileIdentity(paths.registry),
  };
  return { paths, authBytes, fixtureIdentity, codex, node, files };
}

function identitiesMatch(prepared) {
  try {
    return (
      canonical(prepared.fixtureIdentity) === canonical(captureFixtureIdentity(prepared.paths.registry, prepared.paths.repo)) &&
      Object.entries(prepared.files).every(([key, value]) => canonical(value) === canonical(fileIdentity(prepared.paths[key]))) &&
      canonical(prepared.codex) === canonical(executableIdentity(prepared.paths.codex)) &&
      canonical(prepared.node) === canonical(executableIdentity(prepared.paths.node))
    );
  } catch {
    return false;
  }
}

function stageAuth(runtime, bytes) {
  const codexHome = join(runtime, "codex-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeNew(join(codexHome, "auth.json"), bytes, 0o600);
  return codexHome;
}

function publishTerminal(paths, result) {
  writeJsonNew(paths.result, result);
  return result;
}

export async function runPublicCanary(options, dependencies = {}) {
  let prepared;
  try {
    prepared = validateOptions(options);
  } catch (error) {
    return safeRefusal(preflightReason(error));
  }
  const { paths } = prepared;
  const runtime = mkdtempSync(join(paths.runtimeParent, "attempt-"));
  let marked = false;
  try {
    const codexHome = stageAuth(runtime, prepared.authBytes);
    const transcript = join(runtime, "server-transcript.jsonl");
    const privateFreeze = join(runtime, "freeze.json");
    const argv = exactCanaryArgv({
      node: prepared.node.path,
      script: prepared.files.adapter.path,
      registry: prepared.paths.registry,
      transcript,
      freeze: privateFreeze,
      cwd: prepared.paths.cwd,
    });
    const env = Object.freeze({
      CODEX_HOME: codexHome,
      HOME: runtime,
      PATH: [...new Set([dirname(prepared.codex.path), dirname(prepared.node.path), "/usr/bin", "/bin"])].join(":"),
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    });
    const freeze = {
      version: 1,
      kind: "w109-public-canary",
      protocolVersion: "2025-06-18",
      objective: "Find the public synthetic fact and cite its exact source.md line.",
      fixtureIdentity: prepared.fixtureIdentity,
      executable: prepared.codex,
      node: prepared.node,
      files: prepared.files,
      model: "gpt-5.6-luna",
      effort: "low",
      prompt: PROMPT,
      argv,
      cwd: paths.cwd,
      environment: env,
      limits: W109_LIMITS,
    };
    writeJsonNew(privateFreeze, freeze);
    if (typeof dependencies.beforeMarker === "function") dependencies.beforeMarker();
    if (!identitiesMatch(prepared)) return safeRefusal("DRIFT");
    if (existsSync(paths.marker) || existsSync(paths.result)) return safeRefusal("ATTEMPT_EXISTS");
    const freezeBytes = Buffer.from(`${JSON.stringify(freeze, null, 2)}\n`);
    if (existsSync(paths.freeze)) {
      if (hash(readFileSync(paths.freeze)) !== hash(freezeBytes)) return safeRefusal("FREEZE_EXISTS");
    } else writeNew(paths.freeze, freezeBytes);
    const marker = { version: 1, freezeSha256: hash(freezeBytes), runtime, createdAt: new Date().toISOString() };
    writeJsonNew(paths.marker, marker);
    marked = true;
    const controller = dependencies.controller ?? runProcessController;
    let controlled;
    try {
      controlled = await controller({
        executable: prepared.codex.path,
        argv,
        prompt: PROMPT,
        env,
        cwd: paths.cwd,
        transcript,
        limits: W109_LIMITS,
      });
    } catch {
      return publishTerminal(paths, {
        version: 1,
        outcome: "FAIL",
        reason: "SPAWN",
        modelSpawns: 1,
        freezeSha256: marker.freezeSha256,
      });
    }
    return await finalizeAttempt({ prepared, freeze, marker, controlled, transcript });
  } catch {
    if (!marked) return safeRefusal("PREFLIGHT");
    if (!existsSync(paths.result)) {
      try {
        return publishTerminal(paths, { version: 1, outcome: "FAIL", reason: "INTERNAL", modelSpawns: 1 });
      } catch {}
    }
    return { version: 1, outcome: "FAIL", reason: "INTERNAL", modelSpawns: 1 };
  } finally {
    try { rmSync(runtime, { recursive: true, force: true }); } catch {}
  }
}

function decodeJsonl(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: `${label}_UTF8` };
  }
  if (!text.endsWith("\n")) return { error: `${label}_FRAMING` };
  const lines = text.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) return { error: `${label}_FRAMING` };
  const values = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value === null || typeof value !== "object" || Array.isArray(value)) return { error: `${label}_JSON` };
      values.push(value);
    } catch {
      return { error: `${label}_JSON` };
    }
  }
  return { values };
}

export function validateRawEvidence(input) {
  const stdout = Buffer.from(input.stdout ?? []);
  const transcript = Buffer.from(input.transcript ?? []);
  if (stdout.length > W109_LIMITS.stdoutBytes) return { outcome: "FAIL", reason: "MODEL_CAP" };
  if (transcript.length > W109_LIMITS.transcriptBytes) return { outcome: "FAIL", reason: "TRANSCRIPT_CAP" };
  const model = decodeJsonl(stdout, "MODEL");
  if (model.error) return { outcome: "FAIL", reason: model.error };
  if (model.values.length > W109_LIMITS.stdoutRecords) return { outcome: "FAIL", reason: "MODEL_RECORD_CAP" };
  const server = decodeJsonl(transcript, "TRANSCRIPT");
  if (server.error) return { outcome: "FAIL", reason: server.error };
  const semantic = verifyCanary({
    exitCode: input.exitCode,
    model: "gpt-5.6-luna",
    effort: "low",
    server: SERVER,
    fact: FACT,
    citation: CITATION,
    serverRows: server.values,
    modelEvents: model.values,
  });
  if (semantic.outcome !== "PASS") return { outcome: "FAIL", reason: "SEMANTIC", reasons: semantic.reasons };
  return { ...semantic, modelEvents: model.values, serverRows: server.values };
}

function credentialValues(authBytes) {
  const values = [];
  let parsed;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(authBytes)); } catch { return values; }
  const visit = (value) => {
    if (typeof value === "string" && value.length > 0) values.push(Buffer.from(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(parsed);
  return values;
}

function containsCredential(buffers, authBytes) {
  const needles = [Buffer.from(authBytes), ...credentialValues(authBytes)];
  return buffers.some((buffer) => needles.some((needle) => needle.length > 0 && buffer.indexOf(needle) !== -1));
}

function safeTranscript(path, cap) {
  const fd = openSync(path, FS.O_RDONLY | FS.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > cap) throw new Error(stat.size > cap ? "TRANSCRIPT_CAP" : "TRANSCRIPT_UNSAFE");
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

async function finalizeAttempt({ prepared, freeze, marker, controlled, transcript }) {
  if (!controlled || typeof controlled !== "object") {
    return publishTerminal(prepared.paths, {
      version: 1,
      outcome: "FAIL",
      reason: "CONTROLLER",
      modelSpawns: 1,
      freezeSha256: marker.freezeSha256,
    });
  }
  const stderr = Buffer.from(controlled.stderr ?? []);
  const stdout = Buffer.from(controlled.stdout ?? []);
  const counts = {
    stderrBytes: controlled.stderrBytes ?? stderr.length,
    stdoutBytes: controlled.stdoutBytes ?? stdout.length,
  };
  const fail = (reason, extra = {}, includeHashes = false) =>
    publishTerminal(prepared.paths, {
      version: 1,
      outcome: "FAIL",
      reason,
      modelSpawns: 1,
      freezeSha256: marker.freezeSha256,
      ...counts,
      ...(includeHashes ? { stderrSha256: hash(stderr), stdoutSha256: hash(stdout) } : {}),
      ...extra,
    });

  if (containsCredential([stdout, stderr], prepared.authBytes)) return fail("CREDENTIAL_LEAK");

  let transcriptBytes;
  try {
    transcriptBytes = safeTranscript(transcript, W109_LIMITS.transcriptBytes);
  } catch (error) {
    const reason =
      error instanceof Error && ["TRANSCRIPT_CAP", "TRANSCRIPT_UNSAFE"].includes(error.message)
        ? error.message
        : "TRANSCRIPT_MISSING";
    return fail(reason);
  }
  if (containsCredential([transcriptBytes], prepared.authBytes)) return fail("CREDENTIAL_LEAK");

  const streamsComplete = stdout.length === counts.stdoutBytes && stderr.length === counts.stderrBytes;
  if (controlled.reason) return fail(controlled.reason, {}, streamsComplete);
  if (controlled.groupAlive) return fail("CLEANUP", {}, streamsComplete);
  if (stderr.length !== 0) return fail("STDERR_PRESENT", { diagnostic: "STDERR_WITHHELD" }, streamsComplete);
  const validated = validateRawEvidence({ stdout, transcript: transcriptBytes, exitCode: controlled.exitCode });
  if (validated.outcome !== "PASS")
    return fail(validated.reason, { semanticReasons: validated.reasons ?? [] }, streamsComplete);
  writeNew(join(prepared.paths.evidence, "model-events.jsonl"), stdout);
  writeNew(join(prepared.paths.evidence, "server-transcript.jsonl"), transcriptBytes);
  return publishTerminal(prepared.paths, {
    version: 1,
    outcome: "PASS",
    modelSpawns: 1,
    model: "gpt-5.6-luna",
    effort: "low",
    calls: validated.calls,
    resultBytes: validated.resultBytes,
    answer: validated.answer,
    usage: validated.usage,
    freezeSha256: marker.freezeSha256,
    marker,
    command: { executable: prepared.codex.path, argv: freeze.argv, cwd: freeze.cwd },
    environment: freeze.environment,
    modelEventsSha256: hash(stdout),
    serverTranscriptSha256: hash(transcriptBytes),
    stderrBytes: counts.stderrBytes,
    stderrSha256: hash(stderr),
    stdoutBytes: counts.stdoutBytes,
    stdoutSha256: hash(stdout),
    diagnostic: "STDERR_EMPTY",
  });
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function runProcessController(request) {
  const limits = request.limits ?? W109_LIMITS;
  const child = spawn(request.executable, request.argv, {
    cwd: request.cwd,
    env: request.env,
    detached: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!child.pid) throw new Error("SPAWN");
  const pid = child.pid;
  let reason = null;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutRecords = 0;
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutRetained = 0;
  let stderrRetained = 0;
  let killTimer;
  const terminate = (nextReason) => {
    if (reason === null) reason = nextReason;
    signalProcessGroup(pid, "SIGTERM");
    if (killTimer === undefined) {
      killTimer = setTimeout(() => signalProcessGroup(pid, "SIGKILL"), limits.termGraceMs);
      killTimer.unref?.();
    }
  };
  const retain = (chunk, cap, chunks, retained) => {
    const remaining = Math.max(0, cap - retained);
    if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
    return retained + Math.min(remaining, chunk.length);
  };
  child.stdout.on("data", (value) => {
    const chunk = Buffer.from(value);
    stdoutBytes += chunk.length;
    stdoutRecords += chunk.reduce((count, byte) => count + (byte === 0x0a ? 1 : 0), 0);
    stdoutRetained = retain(chunk, limits.stdoutBytes, stdoutChunks, stdoutRetained);
    if (stdoutBytes > limits.stdoutBytes) terminate("STDOUT_CAP");
    else if (stdoutRecords > limits.stdoutRecords) terminate("STDOUT_RECORD_CAP");
  });
  child.stderr.on("data", (value) => {
    const chunk = Buffer.from(value);
    stderrBytes += chunk.length;
    stderrRetained = retain(chunk, limits.stderrBytes, stderrChunks, stderrRetained);
    if (stderrBytes > limits.stderrBytes) terminate("STDERR_CAP");
  });
  child.stdin.on("error", () => {});
  child.stdin.end(Buffer.from(request.prompt, "utf8"));

  const onParentSignal = () => terminate("PARENT_SIGNAL");
  process.once("SIGINT", onParentSignal);
  process.once("SIGTERM", onParentSignal);
  const deadline = setTimeout(() => terminate("TIMEOUT"), limits.deadlineMs);
  deadline.unref?.();
  const transcriptWatch = setInterval(() => {
    try {
      if (existsSync(request.transcript) && statSync(request.transcript).size > limits.transcriptBytes)
        terminate("TRANSCRIPT_CAP");
    } catch {
      terminate("TRANSCRIPT_STAT");
    }
  }, 20);
  transcriptWatch.unref?.();

  const streamClosed = Promise.all([
    new Promise((resolveClose) => child.stdout.once("close", resolveClose)),
    new Promise((resolveClose) => child.stderr.once("close", resolveClose)),
  ]);
  const exited = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  clearTimeout(deadline);
  clearInterval(transcriptWatch);
  process.removeListener("SIGINT", onParentSignal);
  process.removeListener("SIGTERM", onParentSignal);

  signalProcessGroup(pid, "SIGTERM");
  const cleanupDeadline = Date.now() + limits.termGraceMs;
  while (processGroupAlive(pid) && Date.now() < cleanupDeadline) await delay(10);
  if (processGroupAlive(pid)) {
    signalProcessGroup(pid, "SIGKILL");
    const killDeadline = Date.now() + limits.termGraceMs;
    while (processGroupAlive(pid) && Date.now() < killDeadline) await delay(10);
  }
  clearTimeout(killTimer);
  const closed = await Promise.race([streamClosed.then(() => true), delay(limits.termGraceMs).then(() => false)]);
  const groupAlive = processGroupAlive(pid);
  if ((!closed || groupAlive) && reason === null) reason = "CLEANUP";
  return {
    exitCode: exited.code,
    signal: exited.signal,
    reason,
    stdout: Buffer.concat(stdoutChunks),
    stderr: Buffer.concat(stderrChunks),
    stdoutBytes,
    stderrBytes,
    stdoutRecords,
    groupAlive,
  };
}



export function cleanupOnly({ marker, runtimeParent }) {
  const markerFd = openSync(resolve(marker), FS.O_RDONLY | FS.O_NOFOLLOW);
  let markerBytes;
  try {
    const markerStat = fstatSync(markerFd);
    if (!markerStat.isFile() || markerStat.uid !== process.getuid() || (markerStat.mode & 0o777) !== 0o600) throw new Error("CLEANUP_MARKER");
    markerBytes = readFileSync(markerFd);
  } finally { closeSync(markerFd); }
  const retained = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(markerBytes));
  if (retained.version !== 1 || typeof retained.runtime !== "string" || !/^[0-9a-f]{64}$/.test(retained.freezeSha256 ?? "")) throw new Error("CLEANUP_MARKER");
  const parent = assertPrivateDirectory(runtimeParent);
  const runtime = resolve(retained.runtime);
  if (!beneath(parent, runtime)) throw new Error("CLEANUP_CONFINEMENT");
  const stat = lstatSync(runtime);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || realpathSync(runtime) !== runtime) throw new Error("CLEANUP_UNSAFE");
  const freezeFd = openSync(join(runtime, "freeze.json"), FS.O_RDONLY | FS.O_NOFOLLOW);
  let freezeBytes;
  try {
    const freezeStat = fstatSync(freezeFd);
    if (!freezeStat.isFile() || freezeStat.uid !== process.getuid() || (freezeStat.mode & 0o777) !== 0o600) throw new Error("CLEANUP_FREEZE");
    freezeBytes = readFileSync(freezeFd);
  } finally { closeSync(freezeFd); }
  if (hash(freezeBytes) !== retained.freezeSha256) throw new Error("CLEANUP_FREEZE");
  rmSync(runtime, { recursive: true });
  return { outcome: "CLEANED", markerRetained: existsSync(marker) };
}

function named(args, allowed) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.includes(key) || value === undefined || Object.hasOwn(result, key)) throw new Error("ARGUMENTS");
    result[key] = value;
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === "cleanup-only") {
    const values = named(args.slice(1), ["--marker", "--runtime-parent"]);
    process.stdout.write(`${JSON.stringify(cleanupOnly({ marker: values["--marker"], runtimeParent: values["--runtime-parent"] }))}\n`);
    return;
  }
  if (args[0] === "run") {
    const names = ["--repo", "--registry", "--evidence", "--cwd", "--runtime-parent", "--auth", "--codex", "--node"];
    const values = named(args.slice(1), names);
    if (names.some((name) => !Object.hasOwn(values, name))) throw new Error("ARGUMENTS");
    const repo = resolve(values["--repo"]);
    const result = await runPublicCanary({ repo, registry: resolve(values["--registry"]), evidence: resolve(values["--evidence"]), cwd: resolve(values["--cwd"]), runtimeParent: resolve(values["--runtime-parent"]), auth: resolve(values["--auth"]), codex: resolve(values["--codex"]), node: resolve(values["--node"]), runner: new URL(import.meta.url).pathname, test: join(repo, "docs/research/read-efficiency/W-109-public-canary.test.mjs"), adapter: join(repo, "docs/research/read-efficiency/source-adapter-preflight.mjs"), productionSource: join(repo, "packages/commands/src/source.ts") });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.outcome !== "PASS") process.exitCode = 1;
    return;
  }
  throw new Error("ARGUMENTS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("W109_FAILED\n");
    process.exitCode = 1;
  });
}
