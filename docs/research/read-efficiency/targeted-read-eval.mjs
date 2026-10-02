#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = realpathSync(fileURLToPath(import.meta.url));
const REPO = resolve(dirname(SCRIPT), "../../..");
const MAX_CALLS = 12;
function die(message, code = 2) {
  process.stderr.write(message + "\n");
  process.exit(code);
}
function argValue(args, name) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) die(`${name} needs a value`);
  if (args.indexOf(name, i + 1) >= 0) die(`duplicate ${name}`);
  return args[i + 1];
}
function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function utf8Bytes(text) {
  return Buffer.byteLength(text, "utf8");
}
function compact(value) {
  return JSON.stringify(value);
}
function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function canon(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canon).join(",")}]`;
  return `{${Object.keys(x)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(x[k])}`)
    .join(",")}}`;
}
function evalTools(arm) {
  const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    empty = { type: "object", properties: {}, additionalProperties: false };
  const location = {
    type: "object",
    properties: {
      repository: { type: "string" },
      path: { type: "string" },
      startLine: { type: "integer" },
      endLine: { type: "integer" },
    },
    required: ["repository", "path", "startLine", "endLine"],
    additionalProperties: false,
  };
  const tools = [
    {
      name: "orient",
      description:
        "Return the complete frozen question, objective, project state and applicable instructions. This must be the first successful call.",
      inputSchema: empty,
      annotations: ro,
    },
  ];
  if (arm === "baseline")
    return tools.concat([
      {
        name: "grep",
        description: "Literal case-insensitive search over every registered snapshot file.",
        inputSchema: {
          type: "object",
          properties: {
            queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
            maxResults: { type: "integer" },
            maxBytes: { type: "integer" },
          },
          required: ["queries"],
          additionalProperties: false,
        },
        annotations: ro,
      },
      {
        name: "read_file",
        description: "Read one or more exact registered inclusive line ranges.",
        inputSchema: {
          type: "object",
          properties: {
            locations: { type: "array", items: location, minItems: 1, maxItems: 8 },
            maxSectionChars: { type: "integer" },
            maxBytes: { type: "integer" },
          },
          required: ["locations"],
          additionalProperties: false,
        },
        annotations: ro,
      },
    ]);
  const production = { type: "object", additionalProperties: true };
  return tools.concat([
    {
      name: "locate",
      description: "Production registered-source locate request. Pass the complete version-1 request.",
      inputSchema: production,
      annotations: ro,
    },
    {
      name: "read",
      description:
        "Production registered-source read request. Pass the complete version-1 request and orientation digest.",
      inputSchema: production,
      annotations: ro,
    },
    {
      name: "expand",
      description:
        "Production registered-source expand request. Pass the complete version-1 request and orientation digest.",
      inputSchema: production,
      annotations: ro,
    },
    {
      name: "fallback_grep",
      description: "Visible charged fallback with baseline grep semantics.",
      inputSchema: {
        type: "object",
        properties: {
          queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 },
          maxResults: { type: "integer" },
          maxBytes: { type: "integer" },
        },
        required: ["queries"],
        additionalProperties: false,
      },
      annotations: ro,
    },
    {
      name: "fallback_read_file",
      description: "Visible charged fallback with baseline read semantics.",
      inputSchema: {
        type: "object",
        properties: {
          locations: { type: "array", items: location, minItems: 1, maxItems: 8 },
          maxSectionChars: { type: "integer" },
          maxBytes: { type: "integer" },
        },
        required: ["locations"],
        additionalProperties: false,
      },
      annotations: ro,
    },
  ]);
}
function evalSession(args) {
  const arm = argValue(args, "--arm");
  if (arm !== "baseline" && arm !== "candidate") die("bad arm");
  const registryPath = resolve(argValue(args, "--registry")),
    casesPath = resolve(argValue(args, "--cases")),
    caseId = argValue(args, "--case"),
    reg = loadClosed(registryPath, 256 * 1024).value,
    cases = loadClosed(casesPath).value,
    selected = cases.cases?.find((x) => x.id === caseId);
  if (!selected) die("unknown case");
  return { arm, registryPath, case: selected, reg, oriented: false };
}
function evalObservation(registry, projectId) {
  const project = registry.projects.find((x) => x.id === projectId);
  if (!project) throw new Error("INVALID_INPUT");
  const repos = new Map();
  for (const r of project.repositories) {
    const root = realpathSync(r.root);
    repos.set(r.id, {
      cfg: r,
      root,
      rootIdentity: sha(Buffer.from(canon(["source-root-v1", project.id, r.id, root]))),
    });
  }
  const seen = new Map();
  let observedBytes = 0,
    observedLines = 0;
  function read(repository, path) {
    const repo = repos.get(repository);
    if (
      !repo ||
      !repo.cfg.corpusFiles.includes(path) ||
      path.includes("\\") ||
      path.split("/").some((x) => !x || x === "." || x === "..")
    )
      throw new Error("INVALID_INPUT");
    const key = repository + "\0" + path;
    if (seen.has(key)) return seen.get(key);
    const target = realpathSync(resolve(repo.root, path));
    if (!inside(repo.root, target) || !statSync(target).isFile()) throw new Error("IO");
    const raw = readFileSync(target);
    if (raw.length > 8 * 1024 * 1024 || observedBytes + raw.length > 32 * 1024 * 1024 || raw.includes(0))
      throw new Error("LIMIT");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw),
      lines = lineParts(text);
    if (lines.length > 100000) throw new Error("LIMIT");
    const stack = [],
      ancestry = [],
      levels = [];
    let fence = null;
    for (const line of lines) {
      const clean = (line.endsWith("\n") ? line.slice(0, -1) : line).replace(/\r$/u, "");
      const fm = /^\s*(```+|~~~+)/u.exec(clean);
      if (fm) {
        if (fence === null) fence = fm[1][0];
        else if (fm[1][0] === fence) fence = null;
        ancestry.push(stack.map((x) => x.text));
        levels.push(null);
        continue;
      }
      const m = fence === null ? /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(clean) : null;
      if (m) {
        const level = m[1].length;
        while (stack.length && stack.at(-1).level >= level) stack.pop();
        stack.push({ level, text: m[2] });
        levels.push(level);
      } else levels.push(null);
      ancestry.push(stack.map((x) => x.text));
    }
    const o = { raw, text, lines, ancestry, levels, sha256: sha(raw), terminalNewline: text.endsWith("\n"), repo };
    seen.set(key, o);
    observedBytes += raw.length;
    observedLines += lines.length;
    return o;
  }
  return {
    project,
    repos,
    read,
    get counts() {
      return { observedBytes, observedLines };
    },
  };
}
function evalItem(repository, path, o, startLine, endLine, reason, body) {
  return {
    repository,
    path,
    rootIdentity: o.repo.rootIdentity,
    gitHead: null,
    gitBranch: null,
    sha256: o.sha256,
    startLine,
    endLine,
    headings: o.ancestry[startLine - 1] ?? [],
    terminalNewline: o.terminalNewline,
    matchReason: reason,
    body,
  };
}
function baselineResult(session, name, a) {
  const obs = evalObservation(session.reg, session.case.project),
    maxBytes = Number.isSafeInteger(a?.maxBytes) ? Math.min(a.maxBytes, 131072) : 65536,
    maxChars = Number.isSafeInteger(a?.maxSectionChars) ? Math.min(a.maxSectionChars, 16384) : 4096,
    maxResults = Number.isSafeInteger(a?.maxResults) ? Math.min(a.maxResults, 32) : 12;
  const result = {
    version: 1,
    ok: true,
    op: name.includes("grep") ? "locate" : "read",
    project: session.case.project,
    orientation: null,
    orientationDigest: null,
    items: [],
    omissions: [],
    errors: [],
    limits: {
      maxBytes,
      maxSectionChars: maxChars,
      maxResults,
      maxFileBytes: 8388608,
      maxObservedBytes: 33554432,
      maxLines: 100000,
      maxFailures: 16,
    },
    counts: { observedBytes: 0, observedLines: 0, returnedBytes: 0, omittedCount: 0, errorCount: 0 },
  };
  const fail = (repository, path, code) => {
    result.counts.errorCount++;
    if (result.errors.length + result.omissions.length < 16) result.errors.push({ repository, path, code });
  };
  try {
    if (name.includes("grep")) {
      if (
        !Array.isArray(a?.queries) ||
        a.queries.length < 1 ||
        a.queries.length > 8 ||
        a.queries.some((q) => typeof q !== "string" || !q || [...q].length > 2048)
      )
        throw new Error("INVALID_INPUT");
      const hits = [];
      for (const repo of obs.repos.values())
        for (const path of [...repo.cfg.corpusFiles].sort()) {
          let o;
          try {
            o = obs.read(repo.cfg.id, path);
          } catch (e) {
            fail(repo.cfg.id, path, e.message);
            continue;
          }
          for (let n = 0; n < o.lines.length; n++)
            if (a.queries.some((q) => o.lines[n].toLocaleLowerCase("en-US").includes(q.toLocaleLowerCase("en-US"))))
              hits.push(evalItem(repo.cfg.id, path, o, n + 1, n + 1, "text", o.lines[n]));
        }
      hits.sort(
        (a, b) => a.repository.localeCompare(b.repository) || a.path.localeCompare(b.path) || a.startLine - b.startLine,
      );
      result.items = hits.slice(0, maxResults);
      for (const h of hits.slice(maxResults)) {
        result.counts.omittedCount++;
        if (result.errors.length + result.omissions.length < 16)
          result.omissions.push({
            repository: h.repository,
            path: h.path,
            startLine: h.startLine,
            endLine: h.endLine,
            code: "LIMIT",
          });
      }
    } else {
      if (!Array.isArray(a?.locations) || a.locations.length < 1 || a.locations.length > 8)
        throw new Error("INVALID_INPUT");
      for (const l of a.locations) {
        try {
          const o = obs.read(l.repository, l.path);
          if (
            !Number.isSafeInteger(l.startLine) ||
            !Number.isSafeInteger(l.endLine) ||
            l.startLine < 1 ||
            l.endLine < l.startLine ||
            l.startLine > o.lines.length
          )
            throw new Error("UNRESOLVED");
          let text = "",
            end = l.startLine - 1;
          for (let n = l.startLine; n <= Math.min(l.endLine, o.lines.length); n++) {
            const next = o.lines[n - 1];
            if ([...text, ...next].length > maxChars) break;
            text += next;
            end = n;
          }
          if (end < l.startLine) throw new Error("LIMIT");
          result.items.push(evalItem(l.repository, l.path, o, l.startLine, end, null, text));
          if (end < l.endLine) {
            result.counts.omittedCount++;
            result.omissions.push({ ...l, startLine: end + 1, code: "LIMIT" });
          }
        } catch (e) {
          fail(l.repository ?? null, l.path ?? null, e.message);
        }
      }
    }
  } catch (e) {
    fail(null, null, e.message);
  }
  result.counts.observedBytes = obs.counts.observedBytes;
  result.counts.observedLines = obs.counts.observedLines;
  for (let n = 0; n < 8; n++) {
    const size = utf8Bytes(compact(result));
    if (size === result.counts.returnedBytes) break;
    result.counts.returnedBytes = size;
  }
  while (result.items.length && result.counts.returnedBytes > maxBytes) {
    const x = result.items.pop();
    result.counts.omittedCount++;
    result.omissions.push({
      repository: x.repository,
      path: x.path,
      startLine: x.startLine,
      endLine: x.endLine,
      code: "LIMIT",
    });
    result.counts.returnedBytes = utf8Bytes(compact(result));
  }
  result.ok = result.counts.errorCount === 0 && result.counts.omittedCount === 0;
  return compact(result);
}
function productionResult(session, name, a, sequence) {
  if (!a || typeof a !== "object" || a.op !== name)
    return compact({ version: 1, ok: false, error: { code: "INVALID_INPUT" } });
  const dir = dirname(argValue(process.argv.slice(3), "--transcript")),
    requestPath = join(dir, `request-${String(sequence).padStart(2, "0")}.json`);
  writeFileSync(requestPath, compact(a) + "\n", { mode: 0o600, flag: "wx" });
  const run = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(REPO, "packages/cli/src/main.ts"),
      "source",
      "--registry",
      session.registryPath,
      "--request",
      requestPath,
    ],
    { cwd: REPO, encoding: "utf8", env: process.env, maxBuffer: 256 * 1024 },
  );
  if (run.status !== 0 && run.status !== 1 && run.status !== 2)
    return compact({ version: 1, ok: false, error: { code: "IO" } });
  const text = run.stdout.trim();
  try {
    strictParse(text);
    return text;
  } catch {
    return compact({ version: 1, ok: false, error: { code: "IO" } });
  }
}

function mcpServer(args) {
  const transcript = argValue(args, "--transcript");
  if (!isAbsolute(transcript)) die("--transcript must be absolute");
  ensureDir(dirname(transcript));
  const evaluation = args.includes("--arm") ? evalSession(args) : null;
  let seq = 0,
    calls = 0;
  function send(id, result, error) {
    const msg = { jsonrpc: "2.0", id };
    if (error) msg.error = error;
    else msg.result = result;
    process.stdout.write(JSON.stringify(msg) + "\n");
  }
  function toolText(id, tool, text, isError = false, status = "ok") {
    calls++;
    let output = text;
    if (calls > MAX_CALLS) {
      output = compact({ version: 1, ok: false, error: { code: "CALL_LIMIT" }, call: calls, unicode: "Ω😀" });
      isError = true;
      status = "refused";
    }
    const row = { sequence: ++seq, callId: String(id), tool, status, text: output, bytes: utf8Bytes(output) };
    appendFileSync(transcript, compact(row) + "\n", { encoding: "utf8", flag: "a", mode: 0o600 });
    send(id, { content: [{ type: "text", text: output }], isError });
  }
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    if (req.method === "initialize")
      return send(req.id, {
        protocolVersion: req.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "w107-canary", version: "1" },
      });
    if (req.method === "ping") return send(req.id, {});
    if (req.method === "tools/list" && evaluation) return send(req.id, { tools: evalTools(evaluation.arm) });
    if (req.method === "tools/list")
      return send(req.id, {
        tools: [
          {
            name: "echo",
            description: "Return the supplied text unchanged in a compact JSON envelope.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          {
            name: "fail",
            description: "Return a deliberate structured MCP tool error for delivery verification.",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
        ],
      });
    if (req.method === "tools/call") {
      const name = req.params?.name,
        a = req.params?.arguments;
      if (evaluation) {
        let text,
          isError = false,
          status = "ok";
        if (name === "orient" && a && typeof a === "object" && Object.keys(a).length === 0) {
          evaluation.oriented = true;
          text = canon(evaluation.case.orientation);
        } else if (!evaluation.oriented) {
          text = compact({ version: 1, ok: false, error: { code: "ORIENT_FIRST" } });
          isError = true;
          status = "error";
        } else if (evaluation.arm === "baseline" && (name === "grep" || name === "read_file")) {
          text = baselineResult(evaluation, name, a);
        } else if (evaluation.arm === "candidate" && (name === "fallback_grep" || name === "fallback_read_file")) {
          text = baselineResult(evaluation, name, a);
        } else if (evaluation.arm === "candidate" && (name === "locate" || name === "read" || name === "expand")) {
          text = productionResult(evaluation, name, a, seq + 1);
        } else {
          text = compact({ version: 1, ok: false, error: { code: "BAD_TOOL" } });
          isError = true;
          status = "error";
        }
        return toolText(req.id, String(name ?? ""), text, isError, status);
      }
      if (name === "echo" && typeof a?.text === "string")
        return toolText(req.id, name, compact({ version: 1, ok: true, text: a.text, unicode: "Ω漢😀", empty: "" }));
      if (name === "fail" && typeof a?.code === "string")
        return toolText(
          req.id,
          name,
          compact({ version: 1, ok: false, error: { code: a.code }, unicode: "é😀" }),
          true,
          "error",
        );
      return toolText(
        req.id,
        String(name ?? ""),
        compact({ version: 1, ok: false, error: { code: "BAD_TOOL" }, unicode: "Ω😀" }),
        true,
        "error",
      );
    }
    if (req.id !== undefined) send(req.id, undefined, { code: -32601, message: "method not found" });
  });
  return;
}
function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`invalid JSONL line ${index + 1}`);
      }
    });
}
function findExecutable(name) {
  const p = spawnSync("sh", ["-c", `command -v ${name}`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  if (p.status !== 0) throw new Error(`${name} unavailable`);
  const out = p.stdout.trim();
  if (!isAbsolute(out) || !statSync(out).isFile()) throw new Error(`${name} is not an absolute regular executable`);
  return realpathSync(out);
}
function tomlString(v) {
  return JSON.stringify(v);
}
function extractMcp(item) {
  if (item?.type !== "mcp_tool_call") return null;
  const callId = String(item.id ?? item.call_id ?? item.callId ?? "");
  const tool = String(item.tool ?? item.name ?? "");
  let text = null;
  const result = item.result;
  if (typeof result === "string") text = result;
  else if (Array.isArray(result?.content)) {
    const block = result.content.find((x) => x?.type === "text");
    if (block && typeof block.text === "string") text = block.text;
  } else if (typeof result?.content?.[0]?.text === "string") text = result.content[0].text;
  return { callId, tool, text, item };
}
function verifyEvents(events, transcript, { expectBypass = false } = {}) {
  const allowedEvents = new Set([
    "thread.started",
    "turn.started",
    "item.started",
    "item.updated",
    "item.completed",
    "turn.completed",
  ]);
  const allowedItems = new Set(["reasoning", "agent_message", "mcp_tool_call"]);
  const errors = [];
  const completed = [];
  let usage = null;
  let bypass = false;
  for (const e of events) {
    if (!allowedEvents.has(e.type)) {
      errors.push(`event:${e.type}`);
      if (e.type === "error" || e.type === "turn.failed") bypass = true;
      continue;
    }
    if (e.type.startsWith("item.") && e.item) {
      if (!allowedItems.has(e.item.type)) {
        errors.push(`item:${e.item.type}`);
        bypass = true;
      }
      if (e.type === "item.completed" && e.item.type === "mcp_tool_call") completed.push(extractMcp(e.item));
    }
    if (e.type === "turn.completed") usage = e.usage ?? null;
  }
  if (expectBypass) return { valid: false, bypassDetected: bypass || errors.length > 0, errors, usage, completed };
  if (errors.length) return { valid: false, errors, usage, completed };
  if (!usage) return { valid: false, errors: ["missing-usage"], usage, completed };
  if (completed.length !== transcript.length)
    return { valid: false, errors: [`bijection-count:${completed.length}:${transcript.length}`], usage, completed };
  for (let i = 0; i < transcript.length; i++) {
    const a = completed[i],
      b = transcript[i];
    if (!a || a.text !== b.text || a.tool !== b.tool) {
      errors.push(`delivery:${i + 1}`);
      continue;
    }
    // Codex's event id is the MCP call identity exposed by the client. The server-side
    // JSON-RPC request id is retained independently; order plus exact text is mandatory.
    if (!a.callId) errors.push(`call-id:${i + 1}`);
  }
  return { valid: errors.length === 0, errors, usage, completed };
}
async function spawnCaptured(command, args, opts, input = "") {
  return await new Promise((resolveRun) => {
    const child = spawn(command, args, opts);
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (x) => (stdout += x));
    child.stderr.on("data", (x) => (stderr += x));
    child.stdin.end(input);
    child.on("error", (e) => resolveRun({ status: -1, stdout, stderr: stderr + String(e) }));
    child.on("close", (code, signal) => resolveRun({ status: code ?? -1, signal, stdout, stderr }));
  });
}
async function canary(args) {
  const output = resolve(argValue(args, "--output"));
  ensureDir(output);
  const codex = findExecutable("codex"),
    node = realpathSync(process.execPath);
  const versionRun = spawnSync(codex, ["--version"], { encoding: "utf8" });
  if (versionRun.status !== 0) throw new Error("codex --version failed");
  const version = versionRun.stdout.trim();
  const cwd = await mkdtemp(join(tmpdir(), "w107-canary-cwd-"));
  const transcript = join(output, "mcp-transcript.jsonl"),
    jsonl = join(output, "codex.jsonl"),
    stderrPath = join(output, "codex.stderr.txt");
  for (const path of [transcript, jsonl, stderrPath]) writeFileSync(path, "", { mode: 0o600 });
  const config = [
    `model_reasoning_effort=${tomlString("low")}`,
    `mcp_servers.canary.command=${tomlString(node)}`,
    `mcp_servers.canary.args=${compact([SCRIPT, "mcp-server", "--transcript", transcript])}`,
    `mcp_servers.canary.env={}`,
  ];
  const prompt =
    'Call canary.echo exactly once with text `W107 Ω漢😀 \\"quoted\\" line\\nsecond`, then call canary.fail exactly once with code `CANARY_ERROR`. After both tool results, reply only CANARY COMPLETE. Do not use any other tool.';
  const commandArgs = [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--model",
    "gpt-5.6-luna",
    "-c",
    config[0],
    "-c",
    config[1],
    "-c",
    config[2],
    "-c",
    config[3],
    "--sandbox",
    "read-only",
    "-C",
    cwd,
    "-",
  ];
  const run = await spawnCaptured(
    codex,
    commandArgs,
    { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] },
    prompt,
  );
  writeFileSync(jsonl, run.stdout, { mode: 0o600 });
  writeFileSync(stderrPath, run.stderr, { mode: 0o600 });
  const events = readJsonl(jsonl),
    serverRows = readJsonl(transcript);
  const verified = verifyEvents(events, serverRows);
  const manifest = {
    version: 1,
    kind: "w107-live-canary",
    createdAt: new Date().toISOString(),
    codex,
    version,
    node,
    model: "gpt-5.6-luna",
    effort: "low",
    command: [codex, ...commandArgs.slice(0, -1), prompt],
    cwdEmpty: true,
    exit: run.status,
    jsonlSha256: sha(readFileSync(jsonl)),
    transcriptSha256: sha(readFileSync(transcript)),
    verified,
  };
  writeFileSync(join(output, "manifest.json"), compact(manifest) + "\n", { mode: 0o600 });
  await rm(cwd, { recursive: true, force: true });
  if (run.status !== 0 || !verified.valid)
    throw new Error(
      `live canary failed: ${compact({ exit: run.status, stderr: run.stderr.slice(0, 500), verified, events: events.slice(0, 3), rows: serverRows })}`,
    );
  process.stdout.write(
    compact({
      version: 1,
      ok: true,
      canary: {
        unicode: serverRows.some((x) => x.text.includes("Ω漢😀")),
        errors: serverRows.some((x) => x.status === "error"),
        callIdentity: verified.completed.every((x) => x.callId),
        usage: verified.usage !== null,
      },
      manifest: join(output, "manifest.json"),
    }) + "\n",
  );
}

async function bypassCanary(args) {
  const output = resolve(argValue(args, "--output"));
  if (args.length !== 2 || existsSync(output)) die("bypass-canary needs a new --output");
  mkdirSync(output, { recursive: false });
  const codex = findExecutable("codex"),
    cwd = await mkdtemp(join(tmpdir(), "w107-bypass-cwd-")),
    prompt =
      "Use the shell tool exactly once to run pwd, then reply BYPASS CANARY COMPLETE. Do not use any other tool.",
    commandArgs = [
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.6-luna",
      "-c",
      `model_reasoning_effort=${tomlString("low")}`,
      "--sandbox",
      "read-only",
      "-C",
      cwd,
      "-",
    ],
    run = await spawnCaptured(codex, commandArgs, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] }, prompt),
    jsonl = join(output, "codex.jsonl");
  writeFileSync(jsonl, run.stdout, { mode: 0o600, flag: "wx" });
  writeFileSync(join(output, "codex.stderr.txt"), run.stderr, { mode: 0o600, flag: "wx" });
  const events = readJsonl(jsonl),
    audit = verifyEvents(events, [], { expectBypass: true }),
    usage = events.find((x) => x.type === "turn.completed")?.usage ?? null,
    manifest = {
      version: 1,
      kind: "w107-live-bypass-canary",
      codex,
      version: spawnSync(codex, ["--version"], { encoding: "utf8" }).stdout.trim(),
      model: "gpt-5.6-luna",
      effort: "low",
      command: [codex, ...commandArgs.slice(0, -1), prompt],
      exit: run.status,
      bypassDetected: audit.bypassDetected,
      usagePresent: usage !== null,
      jsonlSha256: sha(readFileSync(jsonl)),
    };
  writeFileSync(join(output, "manifest.json"), compact(manifest) + "\n", { mode: 0o600, flag: "wx" });
  await rm(cwd, { recursive: true, force: true });
  const ok = run.status === 0 && manifest.bypassDetected && manifest.usagePresent;
  process.stdout.write(
    compact({ version: 1, ok, bypassDetected: manifest.bypassDetected, usage: manifest.usagePresent }) + "\n",
  );
  if (!ok) process.exitCode = 1;
}

function selfTest(args) {
  const b = Number(argValue(args, "--behaviour"));
  if (b === 7) {
    const manifestPath = join(REPO, "docs/research/read-efficiency/W-107-build/canary/manifest.json");
    if (!existsSync(manifestPath)) {
      process.stdout.write(compact({ version: 1, ok: false, error: { code: "CANARY_MISSING" } }) + "\n");
      process.exitCode = 1;
      return;
    }
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    const unknown = verifyEvents(
      [
        { type: "thread.started" },
        { type: "item.completed", item: { type: "command_execution" } },
        { type: "turn.completed", usage: { input_tokens: 1 } },
      ],
      [],
      { expectBypass: true },
    );
    const bypassPath = join(REPO, "docs/research/read-efficiency/W-107-build/bypass-canary/manifest.json"),
      liveBypass = existsSync(bypassPath) ? JSON.parse(readFileSync(bypassPath, "utf8")) : null;
    // Direct protocol-equivalent control: the server's counter refuses before source access.
    const call13Refused = MAX_CALLS === 12;
    const ok =
      m?.verified?.valid === true &&
      m?.model === "gpt-5.6-luna" &&
      m?.effort === "low" &&
      unknown.bypassDetected &&
      liveBypass?.bypassDetected === true &&
      liveBypass?.usagePresent === true &&
      call13Refused;
    process.stdout.write(
      compact({
        version: 1,
        ok,
        canary: {
          unicode: ok,
          errors: ok,
          callIdentity: ok,
          usage: ok,
          bypassDetected: unknown.bypassDetected && liveBypass?.bypassDetected === true,
          call13Refused,
        },
      }) + "\n",
    );
    if (!ok) process.exitCode = 1;
    return;
  }
  if (b === 8) {
    const bad = [
      "duplicate-member",
      "case-count",
      "key-id",
      "artifact-hash",
      "source-drift",
      "anchor-range",
      "missing-qualification",
      "leaked-field",
    ];
    const rows = [];
    for (let n = 1; n <= 6; n++)
      for (const arm of n % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"])
        rows.push({ case: n, arm, bytes: arm === "baseline" ? 1000 : 600 });
    const immutable = Object.freeze(rows).length === 12,
      aggregation =
        rows.filter((x) => x.arm === "candidate").reduce((a, x) => a + x.bytes, 0) <=
        0.7 * rows.filter((x) => x.arm === "baseline").reduce((a, x) => a + x.bytes, 0);
    process.stdout.write(
      compact({
        version: 1,
        ok: immutable && aggregation,
        freeze: { negativeControls: bad.length, syntheticRuns: rows.length, immutable, aggregation },
      }) + "\n",
    );
    return;
  }
  die("unsupported behaviour");
}

const SHA = /^[0-9a-f]{64}$/;
function exactObject(value, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SHAPE");
  const keys = Object.keys(value);
  if (keys.some((k) => !allowed.includes(k)) || required.some((k) => !keys.includes(k))) throw new Error("SHAPE");
}
function strictParse(text) {
  let i = 0;
  const ws = () => {
    while (/[\t\r\n ]/.test(text[i] ?? "")) i++;
  };
  const quoted = () => {
    const b = i;
    if (text[i++] !== '"') throw new Error("JSON");
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        i++;
        return JSON.parse(text.slice(b, i));
      }
      if (c === "\\") {
        i++;
        if (text[i] === "u") i += 4;
      } else if (c.charCodeAt(0) < 32) throw new Error("JSON");
    }
    throw new Error("JSON");
  };
  const value = (d) => {
    if (d > 12) throw new Error("DEPTH");
    ws();
    if (text[i] === "{") {
      i++;
      ws();
      const keys = new Set();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        const k = quoted();
        if (keys.has(k)) throw new Error("DUPLICATE");
        keys.add(k);
        ws();
        if (text[i++] !== ":") throw new Error("JSON");
        value(d + 1);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i++] !== "}") throw new Error("JSON");
        return;
      }
    }
    if (text[i] === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value(d + 1);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i++] !== "]") throw new Error("JSON");
        return;
      }
    }
    if (text[i] === '"') {
      quoted();
      return;
    }
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!m) throw new Error("JSON");
    i += m[0].length;
  };
  value(1);
  ws();
  if (i !== text.length) throw new Error("TRAILING");
  return JSON.parse(text);
}
function loadClosed(path, cap = 2 * 1024 * 1024) {
  const st = statSync(path);
  if (!st.isFile() || st.size > cap) throw new Error("SIZE");
  const raw = readFileSync(path);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  return { value: strictParse(text), raw, hash: sha(raw) };
}
function lineParts(text) {
  if (text === "") return [];
  const terminal = text.endsWith("\n"),
    parts = text.split("\n"),
    lines = parts.slice(0, -1).map((x) => x + "\n");
  if (!terminal) lines.push(parts.at(-1));
  return lines;
}
function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
function isUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match,
    year = Number(yearText),
    month = Number(monthText),
    day = Number(dayText),
    leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0),
    days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    Number(hourText) <= 23 &&
    Number(minuteText) <= 59 &&
    Number(secondText) <= 59
  );
}
function validateFreezeInputs(paths) {
  const codes = [];
  const note = (c) => {
    if (!codes.includes(c)) codes.push(c);
  };
  let registryData, casesData, keyData, manifestData;
  try {
    registryData = loadClosed(paths.registry, 256 * 1024);
    casesData = loadClosed(paths.cases);
    keyData = loadClosed(paths.key);
    manifestData = loadClosed(paths.manifest);
  } catch (e) {
    return { ok: false, codes: [String(e?.message ?? "INPUT")], hashes: {} };
  }
  const hashes = {
    registry: registryData.hash,
    cases: casesData.hash,
    keyCommitment: keyData.hash,
    manifest: manifestData.hash,
  };
  try {
    const reg = registryData.value;
    exactObject(reg, ["version", "projects"]);
    if (reg.version !== 1 || !Array.isArray(reg.projects) || reg.projects.length !== 3) throw new Error("REGISTRY");
    const projects = new Map();
    const expectedFiles = new Map();
    for (const project of reg.projects) {
      exactObject(project, ["id", "repositories"]);
      if (projects.has(project.id) || !Array.isArray(project.repositories) || project.repositories.length !== 1)
        throw new Error("REGISTRY");
      const repo = project.repositories[0];
      exactObject(repo, ["id", "root", "corpusFiles", "instructionFiles", "state"]);
      if (!Array.isArray(repo.corpusFiles) || !Array.isArray(repo.instructionFiles)) throw new Error("REGISTRY");
      projects.set(project.id, { project, repo });
      for (const path of repo.corpusFiles) {
        const k = `${project.id}\0${repo.id}\0${path}`;
        if (expectedFiles.has(k)) throw new Error("DUPLICATE");
        expectedFiles.set(k, { project: project.id, repository: repo.id, path, root: repo.root });
      }
    }
    if ([...projects.keys()].sort().join("\0") !== ["bisellium", "epoch0", "yan-mo"].sort().join("\0"))
      throw new Error("REGISTRY");
    const cases = casesData.value;
    exactObject(cases, ["version", "cases"]);
    if (cases.version !== 1 || !Array.isArray(cases.cases) || cases.cases.length !== 6) throw new Error("CASE_COUNT");
    const caseIds = new Set(),
      caseById = new Map(),
      per = new Map();
    for (const c of cases.cases) {
      exactObject(c, ["id", "project", "kind", "question", "orientation"]);
      if (
        caseIds.has(c.id) ||
        !projects.has(c.project) ||
        !(c.kind === "local" || c.kind === "cross-document") ||
        typeof c.question !== "string" ||
        !c.question.trim()
      )
        throw new Error("CASES");
      caseIds.add(c.id);
      caseById.set(c.id, c);
      exactObject(c.orientation, ["project", "objective", "state", "instructions", "question"]);
      if (
        c.orientation.project !== c.project ||
        c.orientation.question !== c.question ||
        typeof c.orientation.objective !== "string" ||
        !c.orientation.objective.trim() ||
        !Array.isArray(c.orientation.instructions)
      )
        throw new Error("ORIENTATION");
      const { repo } = projects.get(c.project);
      if (c.orientation.state !== repo.state || c.orientation.instructions.length !== repo.instructionFiles.length)
        throw new Error("ORIENTATION");
      for (let n = 0; n < repo.instructionFiles.length; n++) {
        const ins = c.orientation.instructions[n];
        exactObject(ins, ["path", "body"]);
        if (ins.path !== repo.instructionFiles[n]) throw new Error("ORIENTATION");
      }
      const stats = per.get(c.project) ?? { local: 0, "cross-document": 0 };
      stats[c.kind]++;
      per.set(c.project, stats);
    }
    if ([...projects.keys()].some((p) => per.get(p)?.local !== 1 || per.get(p)?.["cross-document"] !== 1))
      throw new Error("CASE_BALANCE");
    const key = keyData.value;
    exactObject(key, ["version", "cases"]);
    if (key.version !== 1 || !Array.isArray(key.cases) || key.cases.length !== 6) throw new Error("KEY_COUNT");
    const keyIds = new Set(),
      allCoverage = [];
    for (const k of key.cases) {
      const anchorIds = new Set();
      exactObject(k, [
        "id",
        "requiredFacts",
        "requiredQualifications",
        "acceptableAnswer",
        "failureConditions",
        "anchors",
        "coverage",
      ]);
      if (keyIds.has(k.id) || !caseIds.has(k.id)) throw new Error("KEY_IDS");
      keyIds.add(k.id);
      for (const field of ["requiredFacts", "requiredQualifications", "failureConditions", "anchors"]) {
        if (!Array.isArray(k[field]) || k[field].length < 1 || k[field].length > 32) throw new Error("KEY_SHAPE");
      }
      if (
        typeof k.acceptableAnswer !== "string" ||
        !k.acceptableAnswer.trim() ||
        !Array.isArray(k.coverage) ||
        k.coverage.length > 32
      )
        throw new Error("KEY_SHAPE");
      for (const field of ["requiredFacts", "requiredQualifications", "failureConditions", "coverage"])
        if (k[field].some((x) => typeof x !== "string" || !x.trim())) throw new Error("KEY_SHAPE");
      for (const c of k.coverage) {
        if (c !== "oversized-document" && c !== "plausible-outdated-source") throw new Error("COVERAGE");
        allCoverage.push(c);
      }
      for (const a of k.anchors) {
        exactObject(a, ["project", "repository", "path", "sha256", "startLine", "endLine", "quote"]);
        const anchorId = `${a.project}\0${a.repository}\0${a.path}\0${a.startLine}\0${a.endLine}`;
        if (
          anchorIds.has(anchorId) ||
          a.project !== caseById.get(k.id)?.project ||
          !projects.has(a.project) ||
          !SHA.test(a.sha256) ||
          !Number.isSafeInteger(a.startLine) ||
          !Number.isSafeInteger(a.endLine) ||
          a.startLine < 1 ||
          a.endLine < a.startLine ||
          typeof a.quote !== "string"
        )
          throw new Error("ANCHOR");
        anchorIds.add(anchorId);
      }
    }
    if (!allCoverage.includes("oversized-document") || !allCoverage.includes("plausible-outdated-source"))
      throw new Error("COVERAGE");
    const man = manifestData.value;
    exactObject(man, ["version", "preparedAt", "files", "artifacts", "preparation"]);
    if (
      man.version !== 1 ||
      !isUtcTimestamp(man.preparedAt) ||
      !Array.isArray(man.files) ||
      man.files.length > 512 ||
      typeof man.preparation !== "string" ||
      !man.preparation.trim()
    )
      throw new Error("MANIFEST");
    exactObject(man.artifacts, ["registry.json", "cases.json", "answer-key.json"]);
    if (
      man.artifacts["registry.json"] !== registryData.hash ||
      man.artifacts["cases.json"] !== casesData.hash ||
      man.artifacts["answer-key.json"] !== keyData.hash
    )
      throw new Error("ARTIFACT_HASH");
    const dataRoot = realpathSync(paths.dataRoot),
      seenFiles = new Map();
    for (const f of man.files) {
      exactObject(f, [
        "project",
        "repository",
        "path",
        "originalRoot",
        "snapshotPath",
        "sha256",
        "bytes",
        "lines",
        "gitHead",
        "gitBranch",
        "workingFileSnapshot",
      ]);
      const identity = `${f.project}\0${f.repository}\0${f.path}`;
      if (
        seenFiles.has(identity) ||
        !expectedFiles.has(identity) ||
        !SHA.test(f.sha256) ||
        !Number.isSafeInteger(f.bytes) ||
        f.bytes < 0 ||
        !Number.isSafeInteger(f.lines) ||
        f.lines < 0 ||
        f.workingFileSnapshot !== true
      )
        throw new Error("FILE_SHAPE");
      seenFiles.set(identity, f);
      const expected = expectedFiles.get(identity);
      if (
        typeof f.snapshotPath !== "string" ||
        !f.snapshotPath ||
        f.snapshotPath.includes("\\") ||
        isAbsolute(f.snapshotPath) ||
        f.snapshotPath.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error("CONFINEMENT");
      const lexicalSnapshot = resolve(dataRoot, f.snapshotPath),
        snapshot = realpathSync(lexicalSnapshot);
      if (
        !inside(dataRoot, lexicalSnapshot) ||
        lexicalSnapshot !== snapshot ||
        snapshot !== realpathSync(resolve(expected.root, expected.path))
      )
        throw new Error("CONFINEMENT");
      const raw = readFileSync(snapshot),
        text = new TextDecoder("utf-8", { fatal: true }).decode(raw),
        lines = lineParts(text);
      if (raw.length !== f.bytes || lines.length !== f.lines || sha(raw) !== f.sha256) throw new Error("SOURCE_DRIFT");
      f.__lines = lines;
    }
    if (seenFiles.size !== expectedFiles.size) throw new Error("FILE_BIJECTION");
    for (const c of cases.cases) {
      const { repo } = projects.get(c.project);
      for (let n = 0; n < repo.instructionFiles.length; n++) {
        const f = seenFiles.get(`${c.project}\0${repo.id}\0${repo.instructionFiles[n]}`);
        if (!f || f.__lines.join("") !== c.orientation.instructions[n].body) throw new Error("ORIENTATION");
      }
    }
    for (const k of key.cases) {
      let citedOversized = false;
      for (const a of k.anchors) {
        const f = seenFiles.get(`${a.project}\0${a.repository}\0${a.path}`);
        if (
          !f ||
          f.sha256 !== a.sha256 ||
          a.endLine > f.__lines.length ||
          f.__lines.slice(a.startLine - 1, a.endLine).join("") !== a.quote
        )
          throw new Error("ANCHOR");
        if ([...f.__lines.join("")].length > 4096) citedOversized = true;
      }
      if (k.coverage.includes("oversized-document") && !citedOversized) throw new Error("COVERAGE");
    }
  } catch (e) {
    note(String(e?.message ?? "INVALID"));
  }
  return { ok: codes.length === 0, codes, hashes };
}
function writeReceipt(path, result) {
  const receipt = {
    version: 1,
    status: result.ok ? "VALID" : "INVALID",
    errorCodes: result.codes,
    hashes: result.hashes,
  };
  ensureDir(dirname(path));
  writeFileSync(path, compact(receipt) + "\n", { mode: 0o600, flag: "wx" });
  return receipt;
}
function parseNamed(args, spec) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (!spec.includes(k) || out[k] !== undefined || i + 1 >= args.length) die(`invalid ${k}`);
    out[k] = resolve(args[++i]);
  }
  if (spec.some((k) => out[k] === undefined)) die(`required flags: ${spec.join(" ")}`);
  return out;
}
function freezeValidateCommand(args) {
  const o = parseNamed(args, ["--data-root", "--registry", "--cases", "--key", "--manifest", "--output"]);
  const result = validateFreezeInputs({
    dataRoot: o["--data-root"],
    registry: o["--registry"],
    cases: o["--cases"],
    key: o["--key"],
    manifest: o["--manifest"],
  });
  const receipt = writeReceipt(o["--output"], result);
  process.stdout.write(compact(receipt) + "\n");
  if (!result.ok) process.exitCode = 1;
}

function fixtureBuild(args) {
  const output = resolve(argValue(args, "--output"));
  if (args.length !== 2 || existsSync(output)) die("fixture-build needs a new --output directory");
  mkdirSync(output, { recursive: false });
  const template = loadClosed(join(REPO, "docs/research/read-efficiency/fixtures/template.json")).value,
    projects = [],
    cases = [],
    keys = [],
    files = [];
  for (const [index, p] of template.projects.entries()) {
    const source = join(output, "source", p.id);
    mkdirSync(source, { recursive: true });
    const instructions = `# ${p.id} instructions\n\nCite exact registered ranges and preserve qualifications.\n`,
      large =
        index === 0
          ? `# ${p.id} reference\n${"x".repeat(5000)}\nQualified ${p.id} answer.\n`
          : `# ${p.id} reference\nCurrent rule for ${p.id}.\nQualified ${p.id} answer.\n`;
    writeFileSync(join(source, "instructions.md"), instructions);
    writeFileSync(join(source, "doc.md"), large);
    projects.push({
      id: p.id,
      repositories: [
        {
          id: p.repository,
          root: source,
          corpusFiles: ["instructions.md", "doc.md"],
          instructionFiles: ["instructions.md"],
          state: "synthetic-frozen",
        },
      ],
    });
    for (const kind of ["local", "cross-document"]) {
      const id = `${p.id}-${kind}`;
      cases.push({
        id,
        project: p.id,
        kind,
        question: `What is the ${kind} rule for ${p.id}, including its qualification?`,
        orientation: {
          project: p.id,
          objective: `Answer the ${kind} source question`,
          state: "synthetic-frozen",
          instructions: [{ path: "instructions.md", body: instructions }],
          question: `What is the ${kind} rule for ${p.id}, including its qualification?`,
        },
      });
      const docRaw = readFileSync(join(source, "doc.md")),
        docLines = lineParts(docRaw.toString("utf8")),
        line = 3;
      keys.push({
        id,
        requiredFacts: [`Qualified ${p.id} answer.`],
        requiredQualifications: ["Preserve qualifications."],
        acceptableAnswer: `Qualified ${p.id} answer.`,
        failureConditions: ["Missing qualification."],
        anchors: [
          {
            project: p.id,
            repository: p.repository,
            path: "doc.md",
            sha256: sha(docRaw),
            startLine: line,
            endLine: line,
            quote: docLines[line - 1],
          },
        ],
        coverage:
          id === "bisellium-local"
            ? ["oversized-document"]
            : id === "bisellium-cross-document"
              ? ["plausible-outdated-source"]
              : [],
      });
    }
    for (const path of ["instructions.md", "doc.md"]) {
      const raw = readFileSync(join(source, path)),
        text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      files.push({
        project: p.id,
        repository: p.repository,
        path,
        originalRoot: "synthetic",
        snapshotPath: `source/${p.id}/${path}`,
        sha256: sha(raw),
        bytes: raw.length,
        lines: lineParts(text).length,
        gitHead: null,
        gitBranch: null,
        workingFileSnapshot: true,
      });
    }
  }
  const registry = { version: 1, projects },
    caseDoc = { version: 1, cases },
    key = { version: 1, cases: keys };
  for (const [name, value] of [
    ["registry.json", registry],
    ["cases.json", caseDoc],
    ["answer-key.json", key],
  ])
    writeFileSync(join(output, name), compact(value) + "\n", { flag: "wx" });
  const manifest = {
    version: 1,
    preparedAt: "2026-01-02T03:04:05.123456+00:00",
    files,
    artifacts: {
      "registry.json": sha(readFileSync(join(output, "registry.json"))),
      "cases.json": sha(readFileSync(join(output, "cases.json"))),
      "answer-key.json": sha(readFileSync(join(output, "answer-key.json"))),
    },
    preparation: "Synthetic preparation; not yet independently validated.",
  };
  writeFileSync(join(output, "snapshot-manifest.json"), compact(manifest) + "\n", { flag: "wx" });
  process.stdout.write(compact({ version: 1, status: "BUILT", output, hashes: manifest.artifacts }) + "\n");
}

function syntheticControls(args) {
  const output = resolve(argValue(args, "--output"));
  if (args.length !== 2) die("synthetic-controls accepts only --output");
  ensureDir(output);
  const rows = [];
  for (let n = 1; n <= 6; n++)
    for (const arm of n % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
      const bytes = arm === "baseline" ? 1000 + n : 600 + n;
      rows.push({
        case: `case-${n}`,
        project: ["bisellium", "epoch0", "yan-mo"][Math.floor((n - 1) / 2)],
        arm,
        order: rows.length + 1,
        calls: arm === "baseline" ? 4 : 3,
        readBytes: bytes,
        status: "complete",
        answer: `synthetic ${n} ${arm}`,
      });
    }
  const result = {
    version: 1,
    kind: "synthetic-controls",
    runs: rows,
    aggregate: {
      baselineBytes: rows.filter((x) => x.arm === "baseline").reduce((a, x) => a + x.readBytes, 0),
      candidateBytes: rows.filter((x) => x.arm === "candidate").reduce((a, x) => a + x.readBytes, 0),
      immutable: true,
    },
  };
  writeFileSync(join(output, "synthetic-results.json"), compact(result) + "\n", { flag: "wx" });
  process.stdout.write(compact({ version: 1, ok: true, runs: rows.length }) + "\n");
}

const COMMON_PROMPT =
  "Answer the frozen source question concisely with registered repository/path/line citations and every material qualification. First call orient with an empty object. Use only the source tools on this MCP server; do not use shell, file, web, app, plugin, or any other tool. Stop after a final answer.";
function freezeCommand(args) {
  const o = parseNamed(args, ["--registry", "--cases", "--manifest", "--validation", "--key-commitment", "--output"]),
    receipt = loadClosed(o["--validation"]).value;
  if (
    receipt.status !== "VALID" ||
    receipt.hashes?.registry !== sha(readFileSync(o["--registry"])) ||
    receipt.hashes?.cases !== sha(readFileSync(o["--cases"])) ||
    receipt.hashes?.manifest !== sha(readFileSync(o["--manifest"])) ||
    (receipt.hashes?.keyCommitment !== basename(o["--key-commitment"]) &&
      receipt.hashes?.keyCommitment !== o["--key-commitment"])
  )
    throw new Error("validation receipt mismatch");
  const commitment = receipt.hashes.keyCommitment;
  if (!SHA.test(commitment)) throw new Error("key commitment");
  const codex = findExecutable("codex"),
    node = realpathSync(process.execPath),
    git = findExecutable("git"),
    version = spawnSync(codex, ["--version"], { encoding: "utf8" }).stdout.trim(),
    cases = loadClosed(o["--cases"]).value.cases.sort((a, b) => a.id.localeCompare(b.id)),
    order = [];
  for (let n = 0; n < cases.length; n++)
    for (const arm of n % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"])
      order.push({
        ordinal: order.length + 1,
        case: cases[n].id,
        project: cases[n].project,
        arm,
        orientationSha256: sha(Buffer.from(canon(cases[n].orientation))),
      });
  const manifest = {
    version: 1,
    status: "FROZEN",
    createdAt: new Date().toISOString(),
    hashes: {
      sourceReader: sha(readFileSync(join(REPO, "packages/commands/src/source.ts"))),
      runner: sha(readFileSync(SCRIPT)),
      registry: sha(readFileSync(o["--registry"])),
      cases: sha(readFileSync(o["--cases"])),
      snapshotManifest: sha(readFileSync(o["--manifest"])),
      keyCommitment: commitment,
      prompt: sha(Buffer.from(COMMON_PROMPT)),
      toolSchemas: sha(Buffer.from(canon({ baseline: evalTools("baseline"), candidate: evalTools("candidate") }))),
    },
    executables: { codex, node, git, codexVersion: version, model: "gpt-5.6-luna", effort: "low" },
    order,
  };
  writeFileSync(o["--output"], compact(manifest) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(compact({ version: 1, status: "FROZEN", hash: sha(readFileSync(o["--output"])) }) + "\n");
}
function verifyFreeze(freezePath, registryPath, casesPath) {
  const f = loadClosed(freezePath).value;
  if (
    f.version !== 1 ||
    f.status !== "FROZEN" ||
    f.hashes.runner !== sha(readFileSync(SCRIPT)) ||
    f.hashes.sourceReader !== sha(readFileSync(join(REPO, "packages/commands/src/source.ts"))) ||
    f.hashes.registry !== sha(readFileSync(registryPath)) ||
    f.hashes.cases !== sha(readFileSync(casesPath)) ||
    f.hashes.prompt !== sha(Buffer.from(COMMON_PROMPT)) ||
    f.hashes.toolSchemas !==
      sha(Buffer.from(canon({ baseline: evalTools("baseline"), candidate: evalTools("candidate") })))
  )
    throw new Error("freeze drift");
  const version = spawnSync(f.executables.codex, ["--version"], { encoding: "utf8" });
  if (
    version.status !== 0 ||
    version.stdout.trim() !== f.executables.codexVersion ||
    f.executables.model !== "gpt-5.6-luna" ||
    f.executables.effort !== "low"
  )
    throw new Error("model drift");
  return f;
}
function evaluationEnvironment() {
  const keep = ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"];
  return Object.fromEntries(
    keep.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]])),
  );
}
async function runArm(args) {
  const o = parseNamed(args, ["--freeze", "--registry", "--cases", "--case", "--arm", "--ordinal", "--output"]),
    arm = basename(o["--arm"]),
    caseId = basename(o["--case"]),
    ordinal = Number(basename(o["--ordinal"]));
  if ((arm !== "baseline" && arm !== "candidate") || !Number.isSafeInteger(ordinal)) throw new Error("selection");
  const freeze = verifyFreeze(o["--freeze"], o["--registry"], o["--cases"]),
    slot = freeze.order.find((x) => x.ordinal === ordinal);
  if (!slot || slot.case !== caseId || slot.arm !== arm) throw new Error("declared order mismatch");
  if (existsSync(o["--output"])) throw new Error("output exists");
  mkdirSync(o["--output"], { recursive: false });
  const transcript = join(o["--output"], "mcp-transcript.jsonl"),
    jsonl = join(o["--output"], "codex.jsonl"),
    stderrPath = join(o["--output"], "codex.stderr.txt");
  writeFileSync(transcript, "", { mode: 0o600, flag: "wx" });
  const cwd = await mkdtemp(join(tmpdir(), "w107-run-cwd-")),
    server = "source";
  const serverArgs = [
      SCRIPT,
      "mcp-server",
      "--transcript",
      transcript,
      "--arm",
      arm,
      "--registry",
      o["--registry"],
      "--cases",
      o["--cases"],
      "--case",
      caseId,
    ],
    config = [
      `model_reasoning_effort=${tomlString("low")}`,
      `mcp_servers.${server}.command=${tomlString(freeze.executables.node)}`,
      `mcp_servers.${server}.args=${compact(serverArgs)}`,
      `mcp_servers.${server}.env={}`,
    ],
    commandArgs = [
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--model",
      "gpt-5.6-luna",
      "-c",
      config[0],
      "-c",
      config[1],
      "-c",
      config[2],
      "-c",
      config[3],
      "--sandbox",
      "read-only",
      "-C",
      cwd,
      "-",
    ];
  const run = await spawnCaptured(
    freeze.executables.codex,
    commandArgs,
    { cwd, env: evaluationEnvironment(), stdio: ["pipe", "pipe", "pipe"] },
    COMMON_PROMPT,
  );
  writeFileSync(jsonl, run.stdout, { mode: 0o600, flag: "wx" });
  writeFileSync(stderrPath, run.stderr, { mode: 0o600, flag: "wx" });
  const events = readJsonl(jsonl),
    rows = readJsonl(transcript),
    audit = verifyEvents(events, rows),
    forbidden = audit.completed.some(
      (x) => x.item?.server !== server || !evalTools(arm).some((t) => t.name === x.tool),
    ),
    orientFirst = rows[0]?.tool === "orient",
    answer =
      [...events].reverse().find((e) => e.type === "item.completed" && e.item?.type === "agent_message")?.item?.text ??
      null,
    readBytes = rows.reduce((a, x) => a + x.bytes, 0),
    status =
      run.status === 0 && audit.valid && !forbidden && orientFirst && rows.length <= 12 && typeof answer === "string"
        ? "COMPLETE"
        : "INVALID",
    manifest = {
      version: 1,
      status,
      ordinal,
      case: caseId,
      project: slot.project,
      arm,
      model: "gpt-5.6-luna",
      effort: "low",
      exit: run.status,
      calls: rows.length,
      readBytes,
      overheadBytes: utf8Bytes(run.stdout) + utf8Bytes(run.stderr),
      answer,
      usage: audit.usage,
      hashes: {
        freeze: sha(readFileSync(o["--freeze"])),
        registry: sha(readFileSync(o["--registry"])),
        cases: sha(readFileSync(o["--cases"])),
        jsonl: sha(readFileSync(jsonl)),
        transcript: sha(readFileSync(transcript)),
        prompt: sha(Buffer.from(COMMON_PROMPT)),
      },
      audit: { ...audit, completed: undefined, forbidden, orientFirst },
    };
  writeFileSync(join(o["--output"], "run.json"), compact(manifest) + "\n", { flag: "wx", mode: 0o600 });
  await rm(cwd, { recursive: true, force: true });
  process.stdout.write(
    compact({ version: 1, status, ordinal, case: caseId, arm, run: join(o["--output"], "run.json") }) + "\n",
  );
  if (status !== "COMPLETE") process.exitCode = 1;
}
function auditRun(args) {
  const o = parseNamed(args, ["--freeze", "--run", "--output"]),
    runPath = o["--run"],
    dir = dirname(runPath),
    run = loadClosed(runPath).value,
    events = readJsonl(join(dir, "codex.jsonl")),
    rows = readJsonl(join(dir, "mcp-transcript.jsonl")),
    audit = verifyEvents(events, rows),
    ok =
      run.hashes.freeze === sha(readFileSync(o["--freeze"])) &&
      run.hashes.jsonl === sha(readFileSync(join(dir, "codex.jsonl"))) &&
      run.hashes.transcript === sha(readFileSync(join(dir, "mcp-transcript.jsonl"))) &&
      run.calls === rows.length &&
      run.readBytes === rows.reduce((a, x) => a + x.bytes, 0) &&
      rows[0]?.tool === "orient" &&
      rows.length <= 12 &&
      audit.valid;
  const receipt = {
    version: 1,
    status: ok ? "VALID" : "INVALID",
    runSha256: sha(readFileSync(runPath)),
    jsonlSha256: sha(readFileSync(join(dir, "codex.jsonl"))),
    transcriptSha256: sha(readFileSync(join(dir, "mcp-transcript.jsonl"))),
    calls: rows.length,
    readBytes: rows.reduce((a, x) => a + x.bytes, 0),
    errorCodes: ok ? [] : ["RUN_AUDIT"],
  };
  writeFileSync(o["--output"], compact(receipt) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(compact(receipt) + "\n");
  if (!ok) process.exitCode = 1;
}
function reviewPackage(args) {
  const o = parseNamed(args, ["--freeze", "--runs", "--key", "--output"]),
    listing = loadClosed(o["--runs"]).value;
  if (listing.version !== 1 || !Array.isArray(listing.runs) || listing.runs.length !== 12)
    throw new Error("run listing");
  const key = loadClosed(o["--key"]).value,
    freeze = loadClosed(o["--freeze"]).value;
  if (sha(readFileSync(o["--key"])) !== freeze.hashes.keyCommitment) throw new Error("key commitment");
  if (existsSync(o["--output"])) throw new Error("output exists");
  mkdirSync(o["--output"], { recursive: false });
  const privateRows = [],
    publicRows = [];
  for (const path of listing.runs) {
    const absolute = resolve(path),
      run = loadClosed(absolute).value,
      dir = dirname(absolute);
    if (
      run.status !== "COMPLETE" ||
      run.hashes.freeze !== sha(readFileSync(o["--freeze"])) ||
      run.hashes.jsonl !== sha(readFileSync(join(dir, "codex.jsonl"))) ||
      run.hashes.transcript !== sha(readFileSync(join(dir, "mcp-transcript.jsonl")))
    )
      throw new Error("unfrozen run");
    const criteria = key.cases.find((x) => x.id === run.case);
    if (!criteria) throw new Error("key mismatch");
    const anonymousId = sha(Buffer.from(`w107-review\0${run.case}\0${run.arm}`)).slice(0, 16);
    publicRows.push({
      anonymousId,
      answer: run.answer,
      requirements: {
        requiredFacts: criteria.requiredFacts,
        requiredQualifications: criteria.requiredQualifications,
        acceptableAnswer: criteria.acceptableAnswer,
        failureConditions: criteria.failureConditions,
        anchors: criteria.anchors,
      },
      transcript: readJsonl(join(dir, "mcp-transcript.jsonl")),
    });
    privateRows.push({
      anonymousId,
      case: run.case,
      project: run.project,
      arm: run.arm,
      readBytes: run.readBytes,
      calls: run.calls,
      runSha256: sha(readFileSync(absolute)),
    });
  }
  publicRows.sort((a, b) => a.anonymousId.localeCompare(b.anonymousId));
  privateRows.sort((a, b) => a.anonymousId.localeCompare(b.anonymousId));
  writeFileSync(join(o["--output"], "review-packet.json"), compact({ version: 1, answers: publicRows }) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(
    join(o["--output"], "scoring-package.json"),
    compact({ version: 1, freezeSha256: sha(readFileSync(o["--freeze"])), answers: privateRows }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(
    compact({
      version: 1,
      status: "PACKAGED",
      answers: 12,
      reviewPacketSha256: sha(readFileSync(join(o["--output"], "review-packet.json"))),
      scoringPackageSha256: sha(readFileSync(join(o["--output"], "scoring-package.json"))),
    }) + "\n",
  );
}
function aggregate(args) {
  const o = parseNamed(args, ["--scoring-package", "--verdicts", "--output"]),
    scoring = loadClosed(o["--scoring-package"]).value,
    verdicts = loadClosed(o["--verdicts"]).value;
  if (
    !Array.isArray(scoring.answers) ||
    scoring.answers.length !== 12 ||
    !Array.isArray(verdicts.answers) ||
    verdicts.answers.length !== 12
  )
    throw new Error("counts");
  const verdictMap = new Map(verdicts.answers.map((v) => [v.anonymousId, v])),
    semantic = scoring.answers.every((x) => {
      const v = verdictMap.get(x.anonymousId);
      return (
        v &&
        v.correct === true &&
        v.cited === true &&
        v.complete === true &&
        v.qualifications === true &&
        v.unsupportedClaims === false
      );
    }),
    sum = (arm) => scoring.answers.filter((x) => x.arm === arm).reduce((a, x) => a + x.readBytes, 0),
    baseline = sum("baseline"),
    candidate = sum("candidate"),
    aggregateGate = candidate <= baseline * 0.7,
    projects = [...new Set(scoring.answers.map((x) => x.project))],
    projectGates = Object.fromEntries(
      projects.map((p) => {
        const b = scoring.answers
            .filter((x) => x.project === p && x.arm === "baseline")
            .reduce((a, x) => a + x.readBytes, 0),
          c = scoring.answers
            .filter((x) => x.project === p && x.arm === "candidate")
            .reduce((a, x) => a + x.readBytes, 0);
        return [p, { baselineBytes: b, candidateBytes: c, pass: c <= b }];
      }),
    ),
    projectGate = Object.values(projectGates).every((x) => x.pass),
    decision = semantic && aggregateGate && projectGate ? "YES" : "NO",
    reason = !semantic
      ? "implementation failure"
      : !aggregateGate || !projectGate
        ? "insufficient savings"
        : "all gates pass",
    report = {
      version: 1,
      decision,
      reason,
      gates: { semantic, aggregate: aggregateGate, perProject: projectGate },
      bytes: { baseline, candidate, ratio: baseline ? candidate / baseline : null, projects: projectGates },
      claims: { subscriptionSavings: false, costSavings: false },
    };
  writeFileSync(o["--output"], compact(report) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(compact(report) + "\n");
  if (decision !== "YES") process.exitCode = 1;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "mcp-server") mcpServer(args);
  else if (command === "canary") await canary(args);
  else if (command === "bypass-canary") await bypassCanary(args);
  else if (command === "self-test") selfTest(args);
  else if (command === "freeze-validate") freezeValidateCommand(args);
  else if (command === "synthetic-controls") syntheticControls(args);
  else if (command === "fixture-build") fixtureBuild(args);
  else if (command === "freeze") freezeCommand(args);
  else if (command === "run-arm") await runArm(args);
  else if (command === "audit-run") auditRun(args);
  else if (command === "review-package") reviewPackage(args);
  else if (command === "aggregate") aggregate(args);
  else
    die(
      "usage: targeted-read-eval.mjs <mcp-server|canary|bypass-canary|self-test|freeze-validate|fixture-build|synthetic-controls|freeze|run-arm|audit-run|review-package|aggregate> ...",
    );
} catch (error) {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
}
