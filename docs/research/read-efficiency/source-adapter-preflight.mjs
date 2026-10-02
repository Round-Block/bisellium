import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  constants as FS,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { runSource as productionRunSource } from "../../../packages/commands/src/source.ts";

export const LIMITS = Object.freeze({
  callAttempts: 4,
  totalResultBytes: 32768,
  resultReservationBytes: 8192,
  inboundLineBytes: 16384,
  protocolMessages: 64,
  modelEventLines: 256,
  modelEventBytes: 1048576,
  stderrBytes: 65536,
  canaryDeadlineMs: 120000,
  startupDeadlineMs: 10000,
  productionDeadlineMs: 10000,
});

export const FIXED = Object.freeze({
  version: 1,
  project: "w108-canary",
  repository: "w108-fixture",
  repositoryIds: ["w108-fixture"],
  state: "public-synthetic",
  corpusFiles: ["AGENTS.md", "source.md"],
  instructionFiles: ["AGENTS.md"],
  orientQuery: "__W108_ORIENT_NO_MATCH__",
});

const LOCATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["repository", "path", "startLine", "endLine"],
  properties: {
    repository: { type: "string", enum: ["w108-fixture"] },
    path: { type: "string", enum: ["AGENTS.md", "source.md"] },
    startLine: { type: "integer", minimum: 1, maximum: 64 },
    endLine: { type: "integer", minimum: 1, maximum: 64 },
  },
});

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "orient",
    description: "Bind this session to the frozen public synthetic source fixture.",
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  {
    name: "locate",
    description: "Locate a bounded query in the bound fixture.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^(?!.*[\\u0000-\\u001f\\u007f])[\\s\\S]+$",
        },
        maxResults: { type: "integer", minimum: 1, maximum: 4, default: 4 },
      },
    },
  },
  {
    name: "read",
    description: "Read exact locations returned by the preceding locate call.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["locations"],
      properties: {
        locations: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: LOCATION_SCHEMA,
        },
        maxSectionChars: { type: "integer", minimum: 1, maximum: 1024, default: 1024 },
      },
    },
  },
]);

function invalid() {
  throw new Error("INVALID_ARGUMENTS");
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function closed(value, allowed, required) {
  if (!object(value)) invalid();
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
  if (required.some((key) => !Object.hasOwn(value, key))) invalid();
}

function exactKeys(value, allowed, required = allowed) {
  if (!object(value)) throw new Error("IDENTITY");
  const keys = Object.keys(value).sort();
  if (keys.join("\n") !== [...allowed].sort().join("\n")) throw new Error("IDENTITY");
  if (required.some((key) => !Object.hasOwn(value, key))) throw new Error("IDENTITY");
}

function boundedInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}

function boundedString(value, minimum, maximum) {
  if (typeof value !== "string") invalid();
  const points = [...value];
  if (points.length < minimum || points.length > maximum) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) invalid();
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) invalid();
  }
  return value;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
      .join(",") +
    "}"
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateToolArguments(tool, value) {
  if (tool === "orient") {
    closed(value, [], []);
    return {};
  }
  if (tool === "locate") {
    closed(value, ["query", "maxResults"], ["query"]);
    const answer = { query: boundedString(value.query, 1, 128) };
    if (Object.hasOwn(value, "maxResults")) answer.maxResults = boundedInteger(value.maxResults, 1, 4);
    return answer;
  }
  if (tool === "read") {
    closed(value, ["locations", "maxSectionChars"], ["locations"]);
    if (!Array.isArray(value.locations) || value.locations.length < 1 || value.locations.length > 4) invalid();
    const locations = value.locations.map((location) => {
      closed(location, ["repository", "path", "startLine", "endLine"], [
        "repository",
        "path",
        "startLine",
        "endLine",
      ]);
      if (location.repository !== FIXED.repository) invalid();
      if (!FIXED.corpusFiles.includes(location.path)) invalid();
      const startLine = boundedInteger(location.startLine, 1, 64);
      const endLine = boundedInteger(location.endLine, 1, 64);
      if (endLine < startLine) invalid();
      return { repository: location.repository, path: location.path, startLine, endLine };
    });
    if (new Set(locations.map(canonicalJson)).size !== locations.length) invalid();
    const answer = { locations };
    if (Object.hasOwn(value, "maxSectionChars"))
      answer.maxSectionChars = boundedInteger(value.maxSectionChars, 1, 1024);
    return answer;
  }
  invalid();
}

function beneath(anchor, target) {
  const rel = relative(anchor, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

function assertNoSymlinks(anchorInput, targetInput) {
  const anchor = resolve(anchorInput);
  const target = resolve(targetInput);
  if (!beneath(anchor, target)) throw new Error("IDENTITY");
  let current = anchor;
  if (lstatSync(current).isSymbolicLink()) throw new Error("IDENTITY");
  const rel = relative(anchor, target);
  for (const part of rel ? rel.split(sep) : []) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("IDENTITY");
  }
}

function readRegular(path, maximum) {
  let before;
  try {
    before = lstatSync(path);
  } catch {
    throw new Error("IDENTITY");
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw new Error("IDENTITY");
  let fd;
  try {
    fd = openSync(path, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw new Error("IDENTITY");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size)
      throw new Error("IDENTITY");
    return bytes;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function gitValue(root, args) {
  try {
    const value = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: 3000,
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function sourceRootIdentity(root) {
  return sha256(canonicalJson(["source-root-v1", FIXED.project, FIXED.repository, root]));
}

export function captureFixtureIdentity(registryPathInput, checkoutRootInput = dirname(resolve(registryPathInput))) {
  const registryPath = resolve(registryPathInput);
  const checkoutRoot = realpathSync(resolve(checkoutRootInput));
  assertNoSymlinks(checkoutRoot, registryPath);
  const registryBytes = readRegular(registryPath, 65536);
  let registry;
  try {
    registry = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(registryBytes));
  } catch {
    throw new Error("IDENTITY");
  }
  exactKeys(registry, ["version", "projects"]);
  if (registry.version !== 1 || !Array.isArray(registry.projects) || registry.projects.length !== 1)
    throw new Error("IDENTITY");
  const project = registry.projects[0];
  exactKeys(project, ["id", "repositories"]);
  if (project.id !== FIXED.project || !Array.isArray(project.repositories) || project.repositories.length !== 1)
    throw new Error("IDENTITY");
  const repository = project.repositories[0];
  exactKeys(repository, ["id", "root", "corpusFiles", "instructionFiles", "state"]);
  if (
    repository.id !== FIXED.repository ||
    repository.state !== FIXED.state ||
    canonicalJson(repository.corpusFiles) !== canonicalJson(FIXED.corpusFiles) ||
    canonicalJson(repository.instructionFiles) !== canonicalJson(FIXED.instructionFiles) ||
    typeof repository.root !== "string" ||
    !isAbsolute(repository.root)
  )
    throw new Error("IDENTITY");
  const root = realpathSync(repository.root);
  if (root !== repository.root || !beneath(checkoutRoot, root)) throw new Error("IDENTITY");
  assertNoSymlinks(checkoutRoot, root);
  const files = {};
  for (const path of FIXED.corpusFiles) {
    const target = resolve(root, path);
    assertNoSymlinks(root, target);
    const bytes = readRegular(target, 4096);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
    if (lines > 64 || text.includes(FIXED.orientQuery)) throw new Error("IDENTITY");
    files[path] = { bytes: bytes.length, sha256: sha256(bytes), lines };
  }
  return {
    checkoutRoot,
    registryPath,
    registryBytes: registryBytes.length,
    registrySha256: sha256(registryBytes),
    registry,
    root,
    rootIdentity: sourceRootIdentity(root),
    gitHead: gitValue(root, ["rev-parse", "--verify", "HEAD"]),
    gitBranch: gitValue(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    files,
  };
}

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function toolResult(text, isError = false) {
  return { isError, content: [{ type: "text", text }] };
}

function successful(result, op) {
  return (
    object(result) &&
    result.version === 1 &&
    result.ok === true &&
    result.op === op &&
    result.project === FIXED.project &&
    typeof result.orientationDigest === "string" &&
    /^[0-9a-f]{64}$/.test(result.orientationDigest) &&
    Array.isArray(result.items) &&
    Array.isArray(result.errors) &&
    Array.isArray(result.omissions) &&
    result.errors.length === 0 &&
    result.omissions.length === 0
  );
}

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("PRODUCTION_TIMEOUT")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createAdapterSession(config) {
  if (!object(config) || typeof config.registryPath !== "string" || typeof config.objective !== "string")
    throw new Error("INVALID_CONFIG");
  boundedString(config.objective, 1, 1024);
  if (!object(config.expected)) throw new Error("INVALID_CONFIG");
  const runSourceImpl = config.runSourceImpl ?? productionRunSource;
  let state = "new";
  let attempts = 0;
  let resultBytes = 0;
  let digest = null;
  let located = [];
  const requests = [];
  const transcript = [];

  const current = () =>
    captureFixtureIdentity(config.registryPath, config.expected.checkoutRoot ?? dirname(resolve(config.registryPath)));
  const identityOkay = () => sameIdentity(current(), config.expected);
  const refusal = (reason, response = true) => {
    state = "closed";
    const text = JSON.stringify({ ok: false, error: reason });
    const bytes = Buffer.byteLength(text);
    if (!response || resultBytes + bytes > LIMITS.totalResultBytes) return { isError: true, content: [] };
    resultBytes += bytes;
    return toolResult(text, true);
  };
  const record = (sequence, rpcId, tool, args, productionRequest, response) => {
    const resultText =
      response.content?.length === 1 &&
      response.content[0]?.type === "text" &&
      typeof response.content[0].text === "string"
        ? response.content[0].text
        : null;
    const row = {
      sequence,
      rpcId,
      tool,
      arguments: structuredClone(args),
      canonicalArguments: canonicalJson(args),
      productionRequest: productionRequest ? structuredClone(productionRequest) : null,
      resultText,
      resultBytes: resultText === null ? 0 : Buffer.byteLength(resultText),
      resultSha256: resultText === null ? null : sha256(resultText),
    };
    transcript.push(row);
    if (config.transcriptPath)
      appendFileSync(config.transcriptPath, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
    return response;
  };
  const expectedBody = (location) => {
    const bytes = readRegular(resolve(config.expected.root, location.path), 4096);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parts = text.split("\n");
    const terminal = text.endsWith("\n");
    const lines = parts.slice(0, terminal ? -1 : undefined).map((line, index, all) => {
      if (index < all.length - 1 || terminal) return line + "\n";
      return line;
    });
    return lines.slice(location.startLine - 1, location.endLine).join("");
  };

  return {
    get state() {
      return state;
    },
    get attempts() {
      return attempts;
    },
    get resultBytes() {
      return resultBytes;
    },
    get requests() {
      return structuredClone(requests);
    },
    get transcript() {
      return structuredClone(transcript);
    },
    async call(tool, rawArguments, rpcId = null) {
      attempts += 1;
      const sequence = attempts;
      let productionRequest = null;
      const done = (response) =>
        record(sequence, rpcId, tool, rawArguments, productionRequest, response);
      if (
        attempts > LIMITS.callAttempts ||
        resultBytes + LIMITS.resultReservationBytes > LIMITS.totalResultBytes
      )
        return done(refusal("LIMIT", false));
      if (state === "closed") return done(refusal("CLOSED"));
      const expectedTool =
        state === "new" ? "orient" : state === "oriented" ? "locate" : state === "located" ? "read" : null;
      if (tool !== expectedTool) return done(refusal("ORDER"));
      let args;
      try {
        args = validateToolArguments(tool, rawArguments);
      } catch {
        return done(refusal("INVALID_ARGUMENTS"));
      }
      try {
        if (!identityOkay()) return done(refusal("IDENTITY"));
      } catch {
        return done(refusal("IDENTITY"));
      }
      const common = {
        version: 1,
        project: FIXED.project,
        objective: config.objective,
        repositoryIds: [...FIXED.repositoryIds],
      };
      if (tool === "read") {
        const allowed = new Map(
          located.map((item) => [
            canonicalJson({
              repository: item.repository,
              path: item.path,
              startLine: item.startLine,
              endLine: item.endLine,
            }),
            item,
          ]),
        );
        if (args.locations.some((location) => !allowed.has(canonicalJson(location))))
          return done(refusal("LOCATION"));
      }
      if (tool === "orient") {
        productionRequest = {
          ...common,
          op: "locate",
          query: FIXED.orientQuery,
          maxResults: 1,
          maxBytes: LIMITS.resultReservationBytes,
        };
      } else if (tool === "locate") {
        productionRequest = {
          ...common,
          op: "locate",
          query: args.query,
          maxResults: args.maxResults ?? 4,
          maxBytes: LIMITS.resultReservationBytes,
        };
      } else {
        productionRequest = {
          ...common,
          op: "read",
          orientationDigest: digest,
          locations: args.locations,
          maxSectionChars: args.maxSectionChars ?? 1024,
          maxBytes: LIMITS.resultReservationBytes,
        };
      }
      requests.push(structuredClone(productionRequest));
      let result;
      try {
        result = await within(
          Promise.resolve(runSourceImpl(config.expected.registry, productionRequest)),
          LIMITS.productionDeadlineMs,
        );
      } catch {
        return done(refusal("PRODUCTION"));
      }
      try {
        if (!identityOkay()) return done(refusal("IDENTITY"));
      } catch {
        return done(refusal("IDENTITY"));
      }
      const text = JSON.stringify(result);
      const bytes = Buffer.byteLength(text);
      if (bytes > LIMITS.resultReservationBytes || resultBytes + bytes > LIMITS.totalResultBytes)
        return done(refusal("LIMIT"));
      if (!successful(result, tool === "read" ? "read" : "locate"))
        return done(refusal("PRODUCTION"));
      if (tool === "orient") {
        const repository = result.orientation?.repositories?.[0];
        if (
          result.items.length !== 0 ||
          result.orientation?.project !== FIXED.project ||
          result.orientation?.objective !== config.objective ||
          result.orientation?.repositories?.length !== 1 ||
          repository?.id !== FIXED.repository ||
          repository?.rootIdentity !== config.expected.rootIdentity ||
          repository?.instructions?.length !== 1 ||
          repository.instructions[0]?.path !== "AGENTS.md" ||
          repository.instructions[0]?.sha256 !== config.expected.files["AGENTS.md"].sha256 ||
          typeof repository.instructions[0]?.body !== "string"
        )
          return done(refusal("IDENTITY"));
        digest = result.orientationDigest;
        state = "oriented";
      } else if (tool === "locate") {
        if (result.orientationDigest !== digest || result.items.length < 1)
          return done(refusal("PRODUCTION"));
        if (
          result.items.some(
            (item) =>
              item.repository !== FIXED.repository ||
              !FIXED.corpusFiles.includes(item.path) ||
              !Number.isSafeInteger(item.startLine) ||
              !Number.isSafeInteger(item.endLine) ||
              item.startLine < 1 ||
              item.endLine > 64 ||
              item.endLine < item.startLine ||
              item.rootIdentity !== config.expected.rootIdentity ||
              item.gitHead !== config.expected.gitHead ||
              item.gitBranch !== config.expected.gitBranch ||
              item.sha256 !== config.expected.files[item.path]?.sha256 ||
              item.body !== null,
          )
        )
          return done(refusal("IDENTITY"));
        located = result.items.map((item) => ({
          repository: item.repository,
          path: item.path,
          startLine: item.startLine,
          endLine: item.endLine,
          rootIdentity: item.rootIdentity,
          gitHead: item.gitHead,
          gitBranch: item.gitBranch,
          sha256: item.sha256,
        }));
        state = "located";
      } else {
        const memory = new Map(
          located.map((item) => [
            canonicalJson({
              repository: item.repository,
              path: item.path,
              startLine: item.startLine,
              endLine: item.endLine,
            }),
            item,
          ]),
        );
        if (
          result.orientationDigest !== digest ||
          result.items.length !== args.locations.length ||
          result.items.some((item, index) => {
            const requested = args.locations[index];
            if (!requested) return true;
            const remembered = memory.get(canonicalJson(requested));
            return (
              !remembered ||
              item.repository !== requested.repository ||
              item.path !== requested.path ||
              item.startLine !== requested.startLine ||
              item.endLine !== requested.endLine ||
              item.rootIdentity !== remembered.rootIdentity ||
              item.gitHead !== remembered.gitHead ||
              item.gitBranch !== remembered.gitBranch ||
              item.sha256 !== remembered.sha256 ||
              item.body !== expectedBody(requested)
            );
          })
        )
          return done(refusal("PRODUCTION"));
        state = "complete";
      }
      resultBytes += bytes;
      return done(toolResult(text, false));
    },
  };
}

export function assessLivePreflight(frozen) {
  if (!object(frozen)) return "FREEZE";
  if (
    canonicalJson(frozen.deterministicBehaviours) !== canonicalJson([1, 2, 3, 4, 5]) ||
    frozen.deterministicOutcome !== "PASS"
  )
    return "DETERMINISTIC";
  if (frozen.fixtureHashesMatch !== true) return "FIXTURE_HASH";
  if (frozen.sourceHashesMatch !== true) return "SOURCE_HASH";
  if (frozen.commandFrozen !== true) return "COMMAND";
  if (frozen.configPreflightPassed !== true) return "CONFIG";
  if (frozen.markerAbsent !== true) return "ATTEMPT_EXISTS";
  if (frozen.evidenceAbsent !== true) return "EVIDENCE_EXISTS";
  if (typeof frozen.executable !== "string" || !isAbsolute(frozen.executable)) return "EXECUTABLE";
  if (!/^[0-9a-f]{64}$/.test(frozen.executableSha256 ?? "")) return "EXECUTABLE_HASH";
  if (typeof frozen.executableVersion !== "string" || !frozen.executableVersion) return "EXECUTABLE_VERSION";
  if (frozen.model !== "gpt-5.6-luna") return "MODEL";
  if (frozen.effort !== "low") return "EFFORT";
  if (!Array.isArray(frozen.argv) || frozen.argv.length === 0) return "ARGV";
  if (frozen.maxCalls !== LIMITS.callAttempts) return "CALL_CAP";
  if (frozen.maxResultBytes !== LIMITS.totalResultBytes) return "BYTE_CAP";
  return null;
}

export async function runLiveCanary(frozen, dependencies) {
  const reason = assessLivePreflight(frozen);
  if (reason) return { outcome: "REFUSED", reason, modelSpawns: 0 };
  if (!object(dependencies) || typeof dependencies.createMarker !== "function" || typeof dependencies.spawnModel !== "function")
    return { outcome: "REFUSED", reason: "DEPENDENCIES", modelSpawns: 0 };
  try {
    if (dependencies.createMarker() !== true)
      return { outcome: "REFUSED", reason: "MARKER", modelSpawns: 0 };
  } catch {
    return { outcome: "REFUSED", reason: "MARKER", modelSpawns: 0 };
  }
  try {
    const processResult = await dependencies.spawnModel(Object.freeze(structuredClone(frozen)));
    return { outcome: "SPAWNED", modelSpawns: 1, processResult };
  } catch (error) {
    return {
      outcome: "FAIL",
      reason: "SPAWN",
      modelSpawns: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function verifyCanary(input) {
  const reasons = [];
  const fail = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (!object(input)) return { outcome: "FAIL", reasons: ["INPUT"] };
  if (input.exitCode !== 0) fail("EXIT");
  if (input.model !== "gpt-5.6-luna") fail("MODEL");
  if (input.effort !== "low") fail("EFFORT");
  if (typeof input.server !== "string" || !input.server) fail("SERVER");
  if (typeof input.fact !== "string" || !input.fact) fail("FACT_CONFIG");
  if (typeof input.citation !== "string" || !input.citation) fail("CITATION_CONFIG");

  const rows = Array.isArray(input.serverRows) ? input.serverRows : [];
  if (rows.length !== 3) fail("SERVER_CALL_COUNT");
  const rpcIds = new Set();
  let totalBytes = 0;
  const requiredTools = ["orient", "locate", "read"];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!object(row)) {
      fail("SERVER_ROW");
      continue;
    }
    if (row.sequence !== index + 1) fail("SERVER_ORDER");
    if (row.tool !== requiredTools[index]) fail("SERVER_TOOL");
    const rpcKey = canonicalJson(row.rpcId);
    if (row.rpcId === null || row.rpcId === undefined || rpcIds.has(rpcKey)) fail("SERVER_RPC_ID");
    rpcIds.add(rpcKey);
    try {
      const validated = validateToolArguments(row.tool, row.arguments);
      if (canonicalJson(validated) !== canonicalJson(row.arguments)) fail("SERVER_ARGUMENTS");
      if (row.canonicalArguments !== canonicalJson(row.arguments)) fail("SERVER_CANONICAL_ARGUMENTS");
    } catch {
      fail("SERVER_ARGUMENTS");
    }
    if (typeof row.resultText !== "string") {
      fail("SERVER_RESULT_TEXT");
      continue;
    }
    const bytes = Buffer.byteLength(row.resultText);
    totalBytes += bytes;
    if (row.resultBytes !== bytes) fail("SERVER_RESULT_BYTES");
    if (row.resultSha256 !== sha256(row.resultText)) fail("SERVER_RESULT_HASH");
    try {
      const result = JSON.parse(row.resultText);
      if (!object(result) || result.ok !== true || result.op !== (row.tool === "read" ? "read" : "locate"))
        fail("SERVER_RESULT");
    } catch {
      fail("SERVER_RESULT");
    }
  }
  if (rows.length > LIMITS.callAttempts || totalBytes > LIMITS.totalResultBytes) fail("SERVER_CAP");

  const events = Array.isArray(input.modelEvents) ? input.modelEvents : [];
  if (events.length > LIMITS.modelEventLines || Buffer.byteLength(events.map((x) => JSON.stringify(x)).join("\n")) > LIMITS.modelEventBytes)
    fail("EVENT_CAP");
  if (events[0]?.type !== "thread.started" || events[1]?.type !== "turn.started") fail("EVENT_PREFIX");
  const lastTurn = events.findLastIndex((event) => event?.type === "turn.completed");
  if (lastTurn !== events.length - 1) fail("TURN_TERMINAL");
  if (events.filter((event) => event?.type === "thread.started").length !== 1) fail("THREAD_COUNT");
  if (events.filter((event) => event?.type === "turn.started").length !== 1) fail("TURN_START_COUNT");
  if (events.filter((event) => event?.type === "turn.completed").length !== 1) fail("TURN_COMPLETE_COUNT");

  const lifecycle = new Map();
  const completedCalls = [];
  const messages = [];
  const allIds = new Set();
  const allowedEvents = new Set([
    "thread.started",
    "turn.started",
    "item.started",
    "item.updated",
    "item.completed",
    "turn.completed",
  ]);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!object(event) || !allowedEvents.has(event.type)) {
      fail("EVENT_TYPE");
      continue;
    }
    if (event.type === "thread.started") {
      if (
        Object.keys(event).sort().join(",") !== "thread_id,type" ||
        typeof event.thread_id !== "string" ||
        !event.thread_id
      )
        fail("THREAD_SCHEMA");
      continue;
    }
    if (event.type === "turn.started") {
      if (Object.keys(event).join(",") !== "type") fail("TURN_START_SCHEMA");
      continue;
    }
    if (event.type === "turn.completed") {
      if (Object.keys(event).sort().join(",") !== "type,usage" || !object(event.usage)) {
        fail("USAGE");
        continue;
      }
      const usageKeys = [
        "input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
      ];
      if (
        Object.keys(event.usage).sort().join(",") !== usageKeys.sort().join(",") ||
        usageKeys.some((key) => !Number.isSafeInteger(event.usage[key]) || event.usage[key] < 0)
      )
        fail("USAGE");
      continue;
    }
    if (Object.keys(event).sort().join(",") !== "item,type" || !object(event.item)) {
      fail("ITEM_SCHEMA");
      continue;
    }
    const item = event.item;
    if (typeof item.id !== "string" || !item.id) {
      fail("ITEM_ID");
      continue;
    }
    if (item.type === "mcp_tool_call") {
      const itemKeys = ["arguments", "error", "id", "result", "server", "status", "tool", "type"];
      if (Object.keys(item).sort().join(",") !== itemKeys.sort().join(",")) fail("MCP_SCHEMA");
      if (
        item.server !== input.server ||
        !requiredTools.includes(item.tool) ||
        !object(item.arguments)
      )
        fail("MCP_IDENTITY");
      if (event.type === "item.started") {
        if (lifecycle.has(item.id) || allIds.has(item.id)) fail("MCP_DUPLICATE_ID");
        allIds.add(item.id);
        if (item.result !== null || item.error !== null || item.status !== "in_progress") fail("MCP_STARTED");
        lifecycle.set(item.id, {
          server: item.server,
          tool: item.tool,
          arguments: canonicalJson(item.arguments),
          completed: false,
        });
      } else {
        const remembered = lifecycle.get(item.id);
        if (
          !remembered ||
          remembered.server !== item.server ||
          remembered.tool !== item.tool ||
          remembered.arguments !== canonicalJson(item.arguments)
        )
          fail("MCP_LIFECYCLE");
        if (event.type === "item.updated") {
          if (item.result !== null || item.error !== null || item.status !== "in_progress")
            fail("MCP_UPDATED");
        } else {
          if (!remembered || remembered.completed) fail("MCP_COMPLETION");
          if (remembered) remembered.completed = true;
          if (
            item.error !== null ||
            item.status !== "completed" ||
            !object(item.result) ||
            Object.keys(item.result).sort().join(",") !== "content,structured_content" ||
            item.result.structured_content !== null ||
            !Array.isArray(item.result.content) ||
            item.result.content.length !== 1 ||
            !object(item.result.content[0]) ||
            Object.keys(item.result.content[0]).sort().join(",") !== "text,type" ||
            item.result.content[0].type !== "text" ||
            typeof item.result.content[0].text !== "string"
          )
            fail("MCP_RESULT");
          else
            completedCalls.push({
              id: item.id,
              server: item.server,
              tool: item.tool,
              arguments: item.arguments,
              text: item.result.content[0].text,
            });
        }
      }
    } else if (item.type === "agent_message") {
      if (
        event.type !== "item.completed" ||
        Object.keys(item).sort().join(",") !== "id,text,type" ||
        typeof item.text !== "string" ||
        allIds.has(item.id)
      )
        fail("MESSAGE_SCHEMA");
      else {
        allIds.add(item.id);
        messages.push(item.text);
      }
    } else if (item.type === "reasoning") {
      if (
        event.type !== "item.completed" ||
        Object.keys(item).sort().join(",") !== "id,text,type" ||
        typeof item.text !== "string" ||
        allIds.has(item.id)
      )
        fail("REASONING_SCHEMA");
      else allIds.add(item.id);
    } else {
      fail("ITEM_TYPE");
    }
  }
  for (const value of lifecycle.values()) if (!value.completed) fail("MCP_INCOMPLETE");
  if (completedCalls.length !== 3) fail("MCP_CALL_COUNT");
  for (let index = 0; index < Math.min(completedCalls.length, rows.length); index += 1) {
    const call = completedCalls[index];
    const row = rows[index];
    if (
      call.server !== input.server ||
      call.tool !== row.tool ||
      canonicalJson(call.arguments) !== row.canonicalArguments ||
      call.text !== row.resultText ||
      Buffer.byteLength(call.text) !== row.resultBytes ||
      sha256(call.text) !== row.resultSha256
    )
      fail("TRANSCRIPT_JOIN");
  }
  if (messages.length !== 1) fail("FINAL_MESSAGE");
  else {
    if (!messages[0].includes(input.fact)) fail("FACT");
    if (!messages[0].includes(input.citation)) fail("CITATION");
  }
  return {
    outcome: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    calls: completedCalls.length,
    resultBytes: totalBytes,
    usage:
      lastTurn >= 0 && object(events[lastTurn]?.usage) ? structuredClone(events[lastTurn].usage) : null,
    answer: messages.length === 1 ? messages[0] : null,
  };
}

const OBJECTIVE =
  "Find the public synthetic fact and cite its exact source.md line.";
const PROMPT =
  "Use only the w108_source tools. Call orient first, then locate and read to find the requested public synthetic fact. Reply with the fact and its exact source.md:<line> citation. Do not guess or use any other tool.";

const DISABLED_FEATURES = Object.freeze([
  "apps",
  "artifact",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode_host",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "plugin_sharing",
  "plugins",
  "shell_snapshot",
  "shell_snapshot_v2",
  "shell_tool",
  "skill_env_var_dependency_prompt",
  "skill_mcp_dependency_install",
  "skill_search",
  "sleep_tool",
  "standalone_web_search",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "view_image",
  "workspace_dependencies",
]);

function writeJsonNew(path, value) {
  if (!isAbsolute(path) || existsSync(path)) throw new Error("OUTPUT_EXISTS");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function executableIdentity(pathInput, versionArgs) {
  const path = realpathSync(pathInput);
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new Error("EXECUTABLE");
  const run = spawnSync(path, versionArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
    maxBuffer: 65536,
  });
  if (run.status !== 0) throw new Error("EXECUTABLE_VERSION");
  return { path, bytes: stat.size, sha256: sha256(readFileSync(path)), version: run.stdout.trim() };
}

function collectToolInventories(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectToolInventories(item, found);
  } else if (object(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "tools" && Array.isArray(item)) found.push(item);
      collectToolInventories(item, found);
    }
  }
  return found;
}

export function exactCanaryArgv({ node, script, registry, transcript, freeze, cwd }) {
  const configs = [
    'model_reasoning_effort="low"',
    "mcp_servers.w108_source.command=" + JSON.stringify(node),
    "mcp_servers.w108_source.args=" +
      JSON.stringify([script, "mcp-server", "--registry", registry, "--transcript", transcript, "--freeze", freeze]),
    "mcp_servers.w108_source.env={}",
  ];
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--model",
    "gpt-5.6-luna",
    ...configs.flatMap((config) => ["-c", config]),
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "--sandbox",
    "read-only",
    "-C",
    cwd,
    "-",
  ];
}

export function runConfigPreflight(options) {
  const repo = realpathSync(options.repo);
  const registry = resolve(options.registry);
  const freezePath = resolve(options.freeze);
  const transcript = resolve(options.transcript);
  const output = resolve(options.output);
  const stdoutPath = resolve(options.stdout);
  const stderrPath = resolve(options.stderr);
  const runtime = resolve(options.runtime);
  if ([freezePath, transcript, output, stdoutPath, stderrPath, runtime].some((path) => !beneath(repo, path)))
    throw new Error("OUTPUT_CONFINEMENT");
  if ([freezePath, transcript, output, stdoutPath, stderrPath].some((path) => existsSync(path)))
    throw new Error("OUTPUT_EXISTS");
  mkdirSync(runtime, { recursive: true });
  const codex = executableIdentity(options.codex, ["--version"]);
  const node = executableIdentity(process.execPath, ["--version"]);
  const script = realpathSync(new URL(import.meta.url).pathname);
  const fixtureIdentity = captureFixtureIdentity(registry, repo);
  const provisional = {
    version: 1,
    kind: "w108-config-preflight",
    protocolVersion: "2025-06-18",
    objective: OBJECTIVE,
    fixtureIdentity,
  };
  writeJsonNew(freezePath, provisional);
  const serverArgs = [
    script,
    "mcp-server",
    "--registry",
    registry,
    "--transcript",
    transcript,
    "--freeze",
    freezePath,
  ];
  const configs = [
    'model="gpt-5.6-luna"',
    'model_reasoning_effort="low"',
    "mcp_servers.w108_source.command=" + JSON.stringify(node.path),
    "mcp_servers.w108_source.args=" + JSON.stringify(serverArgs),
    "mcp_servers.w108_source.env={}",
  ];
  const argv = [
    "debug",
    "prompt-input",
    ...configs.flatMap((config) => ["-c", config]),
    ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    PROMPT,
  ];
  const environment = {
    CODEX_HOME: runtime,
    HOME: runtime,
    PATH: [dirname(codex.path), dirname(node.path), "/usr/bin", "/bin"].join(":"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  const run = spawnSync(codex.path, argv, {
    cwd: runtime,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: LIMITS.startupDeadlineMs,
    maxBuffer: LIMITS.modelEventBytes,
  });
  writeFileSync(stdoutPath, run.stdout ?? "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(stderrPath, (run.stderr ?? "").slice(0, LIMITS.stderrBytes), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {}
  const inventories = parsed === null ? [] : collectToolInventories(parsed);
  const exactTools = inventories.some(
    (tools) =>
      canonicalJson(tools.map((tool) => tool?.name).sort()) ===
      canonicalJson(["locate", "orient", "read"]),
  );
  const result = {
    version: 1,
    kind: "w108-final-config-preflight",
    outcome: run.status === 0 && exactTools ? "PASS" : "REFUSED",
    reason:
      run.status !== 0
        ? "CONFIG_COMMAND_FAILED"
        : exactTools
          ? null
          : "EFFECTIVE_TOOL_INVENTORY_UNPROVEN",
    modelSpawns: 0,
    command: [codex.path, ...argv],
    executable: codex,
    node,
    disabledFeatures: DISABLED_FEATURES,
    expectedTools: ["orient", "locate", "read"],
    explicitToolInventoryFound: exactTools,
    exitCode: run.status,
    signal: run.signal ?? null,
    stdoutBytes: Buffer.byteLength(run.stdout ?? ""),
    stdoutSha256: sha256(run.stdout ?? ""),
    stderrBytes: Buffer.byteLength(run.stderr ?? ""),
    stderrSha256: sha256(run.stderr ?? ""),
    runtime,
    environmentKeys: Object.keys(environment).sort(),
  };
  writeJsonNew(output, result);
  return result;
}

function fileIdentity(path) {
  const bytes = readRegular(path, 16 * 1024 * 1024);
  return { path: realpathSync(path), bytes: bytes.length, sha256: sha256(bytes) };
}

export function writeRefusalEvidence(options) {
  const repo = realpathSync(options.repo);
  const evidence = resolve(options.evidence);
  const configPreflightPath = resolve(options.configPreflight);
  if (!beneath(repo, evidence) || !beneath(evidence, configPreflightPath)) throw new Error("EVIDENCE_CONFINEMENT");
  const configPreflight = JSON.parse(readFileSync(configPreflightPath, "utf8"));
  if (
    configPreflight.outcome !== "REFUSED" ||
    configPreflight.modelSpawns !== 0 ||
    configPreflight.reason !== "EFFECTIVE_TOOL_INVENTORY_UNPROVEN"
  )
    throw new Error("NOT_A_REFUSAL");
  const driverPath = realpathSync(new URL(import.meta.url).pathname);
  const testPath = resolve(dirname(driverPath), "source-adapter-preflight.test.mjs");
  const productionPath = resolve(repo, "packages/commands/src/source.ts");
  const registryPath = resolve(repo, "docs/research/read-efficiency/fixtures/W-108/registry.json");
  const fixtureIdentity = captureFixtureIdentity(registryPath, repo);
  const deterministicPath = resolve(evidence, "deterministic-result.json");
  const freezePath = resolve(evidence, "freeze.json");
  const liveCommandPath = resolve(evidence, "live-command.json");
  const serverTranscriptPath = resolve(evidence, "server-transcript.jsonl");
  const modelEventsPath = resolve(evidence, "model-events.jsonl");
  const resultPath = resolve(evidence, "result.json");
  const readmePath = resolve(evidence, "README.md");
  const emptyCwd = resolve(evidence, "empty-cwd");
  for (const path of [
    deterministicPath,
    freezePath,
    liveCommandPath,
    serverTranscriptPath,
    modelEventsPath,
    resultPath,
    readmePath,
  ])
    if (existsSync(path)) throw new Error("EVIDENCE_EXISTS");
  mkdirSync(emptyCwd, { recursive: false });
  const deterministicCommand = [
    process.execPath,
    "--import",
    "tsx",
    testPath,
    repo,
  ];
  const deterministicRun = spawnSync(deterministicCommand[0], deterministicCommand.slice(1), {
    cwd: repo,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
    maxBuffer: 1048576,
  });
  const passLines = (deterministicRun.stdout ?? "")
    .split("\n")
    .filter((line) => /^PASS b[1-5] /.test(line));
  const behaviours = passLines.map((line) => Number(/^PASS b([1-5]) /.exec(line)?.[1]));
  const deterministicOutcome =
    deterministicRun.status === 0 &&
    canonicalJson(behaviours) === canonicalJson([1, 2, 3, 4, 5]) &&
    !(deterministicRun.stdout ?? "").includes("FAIL ")
      ? "PASS"
      : "FAIL";
  const deterministic = {
    version: 1,
    kind: "w108-deterministic-result",
    outcome: deterministicOutcome,
    command: deterministicCommand,
    exitCode: deterministicRun.status,
    signal: deterministicRun.signal ?? null,
    behaviours,
    stdout: deterministicRun.stdout ?? "",
    stderr: deterministicRun.stderr ?? "",
    stdoutSha256: sha256(deterministicRun.stdout ?? ""),
    stderrSha256: sha256(deterministicRun.stderr ?? ""),
  };
  writeJsonNew(deterministicPath, deterministic);
  if (deterministicOutcome !== "PASS") throw new Error("DETERMINISTIC_FAILED");

  const codex = configPreflight.executable;
  const node = configPreflight.node;
  const argv = exactCanaryArgv({
    node: node.path,
    script: driverPath,
    registry: registryPath,
    transcript: serverTranscriptPath,
    freeze: freezePath,
    cwd: emptyCwd,
  });
  const hashes = {
    driver: fileIdentity(driverPath),
    test: fileIdentity(testPath),
    productionSource: fileIdentity(productionPath),
    registry: fileIdentity(registryPath),
    fixtures: Object.fromEntries(
      FIXED.corpusFiles.map((path) => [
        path,
        fileIdentity(resolve(fixtureIdentity.root, path)),
      ]),
    ),
  };
  const configPreflightIdentity = fileIdentity(configPreflightPath);
  const freeze = {
    version: 1,
    kind: "w108-source-adapter-freeze",
    createdAt: new Date().toISOString(),
    protocolVersion: "2025-06-18",
    objective: OBJECTIVE,
    prompt: PROMPT,
    expectedFact: "cobalt-orchid-731",
    citationPredicate: { path: "source.md", line: 3, exact: "source.md:3" },
    limits: LIMITS,
    schemas: TOOL_DEFINITIONS,
    eventSchema: {
      allowedEvents: [
        "thread.started",
        "turn.started",
        "item.started",
        "item.updated",
        "item.completed",
        "turn.completed",
      ],
      allowedItems: ["reasoning", "agent_message", "mcp_tool_call"],
      server: "w108_source",
    },
    hashes,
    fixtureIdentity,
    deterministic: {
      path: deterministicPath,
      sha256: sha256(readFileSync(deterministicPath)),
      outcome: deterministic.outcome,
      behaviours: deterministic.behaviours,
    },
    executable: codex,
    node,
    argv,
    model: "gpt-5.6-luna",
    effort: "low",
    effectiveConfiguration: {
      ignoreUserConfig: true,
      ignoreRules: true,
      strictConfig: true,
      sandbox: "read-only",
      disabledFeatures: configPreflight.disabledFeatures,
      mcpServers: ["w108_source"],
    },
    configPreflight: {
      path: configPreflightPath,
      sha256: configPreflightIdentity.sha256,
      outcome: configPreflight.outcome,
      reason: configPreflight.reason,
      explicitToolInventoryFound: configPreflight.explicitToolInventoryFound,
      modelSpawns: configPreflight.modelSpawns,
    },
  };
  writeJsonNew(freezePath, freeze);
  const liveCommand = {
    version: 1,
    kind: "w108-live-command",
    executed: false,
    refusalReason: configPreflight.reason,
    executable: codex,
    argv,
    stdin: PROMPT,
    cwd: emptyCwd,
    cwdEntries: [],
    model: "gpt-5.6-luna",
    effort: "low",
    environmentPolicy: {
      inherited: ["authentication only"],
      credentialValuesRetained: false,
      ambientMcpServers: false,
      projectInstructions: false,
    },
  };
  writeJsonNew(liveCommandPath, liveCommand);
  writeFileSync(serverTranscriptPath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  writeFileSync(modelEventsPath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  const result = {
    version: 1,
    kind: "w108-source-adapter-preflight",
    outcome: "REFUSED",
    reason: configPreflight.reason,
    canaryExecuted: false,
    modelSpawns: 0,
    attempts: 0,
    calls: 0,
    resultBytes: 0,
    usage: null,
    deterministicOutcome: deterministic.outcome,
    configPreflightOutcome: configPreflight.outcome,
    transcriptSha256: sha256(""),
    modelEventsSha256: sha256(""),
    passingThisGateAuthorizesLargerEvaluation: false,
  };
  writeJsonNew(resultPath, result);
  const readme = [
    "# W-108 source adapter preflight",
    "",
    "Outcome: **REFUSED  zero model spawns**.",
    "",
    "The five deterministic behaviours pass. The installed Codex configuration parser accepted the frozen feature disables, but its no-model debugger did not expose an explicit effective tool inventory. That cannot prove shell, file, web, and ambient tools were absent, so the live canary was not started.",
    "",
    "## Commands",
    "",
    "- Deterministic: `" + deterministicCommand.join(" ") + "`",
    "- Configuration preflight: `" + configPreflight.command.join(" ") + "`",
    "- Frozen live command: retained in `live-command.json`; executed: false.",
    "",
    "## Frozen identities",
    "",
    "- Driver SHA-256: `" + hashes.driver.sha256 + "`",
    "- Test SHA-256: `" + hashes.test.sha256 + "`",
    "- Production source SHA-256: `" + hashes.productionSource.sha256 + "`",
    "- Registry SHA-256: `" + hashes.registry.sha256 + "`",
    "- AGENTS.md SHA-256: `" + hashes.fixtures["AGENTS.md"].sha256 + "`",
    "- source.md SHA-256: `" + hashes.fixtures["source.md"].sha256 + "`",
    "- Codex: `" + codex.version + "`, SHA-256 `" + codex.sha256 + "`",
    "- Node: `" + node.version + "`, SHA-256 `" + node.sha256 + "`",
    "",
    "## Result",
    "",
    "- Deterministic behaviours: 1, 2, 3, 4, 5  PASS",
    "- Configuration preflight: REFUSED (`" + configPreflight.reason + "`)",
    "- Model usage: none",
    "- Tool calls: 0",
    "- Tool-result bytes: 0",
    "- Server transcript SHA-256: `" + sha256("") + "`",
    "- Model events SHA-256: `" + sha256("") + "`",
    "",
    "## Limits",
    "",
    "This is a usability feasibility preflight only. It makes no adoption, answer-quality, token, subscription, byte-efficiency, or savings claim. The refusal authorizes no canary retry, tuning run, multi-project trial, held-out trial, or larger evaluation.",
    "",
  ].join("\n");
  writeFileSync(readmePath, readme, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { freeze, deterministic, result, liveCommand };
}

export async function serveMcpServer(options) {
  if (
    !object(options) ||
    typeof options.registryPath !== "string" ||
    typeof options.transcriptPath !== "string" ||
    typeof options.freezePath !== "string" ||
    !isAbsolute(options.registryPath) ||
    !isAbsolute(options.transcriptPath) ||
    !isAbsolute(options.freezePath)
  )
    throw new Error("INVALID_SERVER_CONFIG");
  const freezeBytes = readRegular(options.freezePath, 262144);
  let freeze;
  try {
    freeze = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(freezeBytes));
  } catch {
    throw new Error("INVALID_SERVER_CONFIG");
  }
  if (
    !object(freeze) ||
    !object(freeze.fixtureIdentity) ||
    typeof freeze.objective !== "string" ||
    freeze.protocolVersion !== "2025-06-18"
  )
    throw new Error("INVALID_SERVER_CONFIG");
  const session = createAdapterSession({
    registryPath: options.registryPath,
    objective: freeze.objective,
    expected: freeze.fixtureIdentity,
    transcriptPath: options.transcriptPath,
  });
  let messages = 0;
  let initialized = false;
  let terminal = false;
  const ids = new Set();
  const send = (id, result, error) => {
    if (terminal) return;
    const response = { jsonrpc: "2.0", id };
    if (error) response.error = error;
    else response.result = result;
    process.stdout.write(JSON.stringify(response) + "\n");
  };
  const terminate = (reason) => {
    terminal = true;
    process.stderr.write(reason + "\n");
    process.stdin.pause();
    process.exitCode = 1;
  };
  const startupTimer = setTimeout(() => terminate("STARTUP_TIMEOUT"), LIMITS.startupDeadlineMs);
  const handle = async (line) => {
    messages += 1;
    if (messages > LIMITS.protocolMessages || Buffer.byteLength(line) > LIMITS.inboundLineBytes)
      return terminate("PROTOCOL_LIMIT");
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return terminate("MALFORMED_JSON");
    }
    if (!object(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string")
      return terminate("MALFORMED_MESSAGE");
    const notification = request.id === undefined;
    if (!notification) {
      const idKey = canonicalJson(request.id);
      if (ids.has(idKey)) return terminate("DUPLICATE_RPC_ID");
      ids.add(idKey);
    }
    if (request.method === "initialize") {
      if (notification || initialized || !object(request.params)) return terminate("INITIALIZE");
      initialized = true;
      clearTimeout(startupTimer);
      return send(request.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "w108-source", version: "1" },
      });
    }
    if (request.method === "notifications/initialized") {
      if (!notification || !initialized) return terminate("INITIALIZED_NOTIFICATION");
      return;
    }
    if (!initialized) return terminate("NOT_INITIALIZED");
    if (request.method === "ping") {
      if (notification) return terminate("PING_NOTIFICATION");
      return send(request.id, {});
    }
    if (request.method === "tools/list") {
      if (notification) return terminate("TOOLS_LIST_NOTIFICATION");
      return send(request.id, {
        tools: TOOL_DEFINITIONS.map((tool) => ({
          ...tool,
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        })),
      });
    }
    if (request.method === "tools/call") {
      if (
        notification ||
        !object(request.params) ||
        typeof request.params.name !== "string" ||
        !object(request.params.arguments)
      )
        return terminate("TOOLS_CALL_SHAPE");
      const answer = await session.call(request.params.name, request.params.arguments, request.id);
      if (answer.content.length === 0) return terminate("SESSION_LIMIT");
      return send(request.id, answer);
    }
    return terminate("METHOD_NOT_ALLOWED");
  };
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue = Promise.resolve();
  reader.on("line", (line) => {
    queue = queue.then(() => handle(line)).catch(() => terminate("SERVER_ERROR"));
  });
  await new Promise((resolveDone) => reader.on("close", resolveDone));
  await queue;
  clearTimeout(startupTimer);
  return { terminal, state: session.state, attempts: session.attempts };
}

function namedArguments(args, names) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!names.includes(name) || value === undefined || Object.hasOwn(result, name)) throw new Error("ARGUMENTS");
    result[name] = value;
  }
  if (names.some((name) => !Object.hasOwn(result, name))) throw new Error("ARGUMENTS");
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (command === "record-refusal") {
    const named = namedArguments(args.slice(1), ["--repo", "--evidence", "--config-preflight"]);
    const evidence = writeRefusalEvidence({ repo: named["--repo"], evidence: named["--evidence"], configPreflight: named["--config-preflight"] });
    process.stdout.write(JSON.stringify(evidence.result) + "\n");
    return;
  }
  if (command === "config-preflight") {
    const named = namedArguments(args.slice(1), ["--repo", "--registry", "--freeze", "--transcript", "--output", "--stdout", "--stderr", "--runtime", "--codex"]);
    const result = runConfigPreflight({ repo: named["--repo"], registry: named["--registry"], freeze: named["--freeze"], transcript: named["--transcript"], output: named["--output"], stdout: named["--stdout"], stderr: named["--stderr"], runtime: named["--runtime"], codex: named["--codex"] });
    process.stdout.write(JSON.stringify(result) + "\n");
    if (result.outcome !== "PASS") process.exitCode = 1;
    return;
  }
  if (command === "mcp-server") {
    const named = namedArguments(args.slice(1), ["--registry", "--transcript", "--freeze"]);
    await serveMcpServer({
      registryPath: resolve(named["--registry"]),
      transcriptPath: resolve(named["--transcript"]),
      freezePath: resolve(named["--freeze"]),
    });
    return;
  }
  throw new Error("usage: source-adapter-preflight.mjs mcp-server --registry <abs> --transcript <abs> --freeze <abs>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
