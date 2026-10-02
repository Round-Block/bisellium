import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  TOOL_DEFINITIONS,
  canonicalJson,
  captureFixtureIdentity,
  createAdapterSession,
  runLiveCanary,
  validateToolArguments,
  verifyCanary,
} from "./source-adapter-preflight.mjs";

const only = Number(process.argv[3] ?? "0");
const repo = resolve(process.argv[2] ?? ".");
const scratch = [];
let failed = 0;

function runs(behaviour) {
  return only === 0 || only === behaviour;
}

async function test(behaviour, name, body) {
  if (!runs(behaviour)) return;
  try {
    await body();
    process.stdout.write("PASS b" + behaviour + " " + name + "\n");
  } catch (error) {
    failed += 1;
    process.stdout.write("FAIL b" + behaviour + " " + name + "\n" + (error?.stack ?? error) + "\n");
  }
}

function fixture(tag) {
  const root = mkdtempSync(join(tmpdir(), "w108-" + tag + "-"));
  scratch.push(root);
  const projectRoot = join(root, "project");
  cpSync(join(repo, "docs/research/read-efficiency/fixtures/W-108/project"), projectRoot, {
    recursive: true,
  });
  const registryPath = join(root, "registry.json");
  const registry = {
    version: 1,
    projects: [
      {
        id: "w108-canary",
        repositories: [
          {
            id: "w108-fixture",
            root: projectRoot,
            corpusFiles: ["AGENTS.md", "source.md"],
            instructionFiles: ["AGENTS.md"],
            state: "public-synthetic",
          },
        ],
      },
    ],
  };
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
  return { root, projectRoot, registryPath };
}

function sourceResult(op, request, overrides = {}) {
  return {
    version: 1,
    ok: true,
    op,
    project: "w108-canary",
    orientation:
      op === "locate"
        ? {
            objective: request.objective,
            project: "w108-canary",
            repositories: [
              {
                id: "w108-fixture",
                rootIdentity: overrides.rootIdentity ?? "fixture-root",
                state: "public-synthetic",
                instructions: [{ path: "AGENTS.md", sha256: overrides.instructionSha ?? "c".repeat(64), body: "# Rules\n" }],
              },
            ],
          }
        : null,
    orientationDigest: "a".repeat(64),
    items:
      op === "locate" && request.query !== "__W108_ORIENT_NO_MATCH__"
        ? [
            {
              repository: "w108-fixture",
              path: "source.md",
              startLine: 3,
              endLine: 3,
              rootIdentity: overrides.rootIdentity ?? "fixture-root",
              gitHead: null,
              gitBranch: null,
              sha256: overrides.sha256 ?? "b".repeat(64),
              headings: ["Public synthetic facts"],
              terminalNewline: true,
              matchReason: "text",
              body: null,
            },
          ]
        : [],
    omissions: [],
    errors: [],
    limits: {
      maxBytes: 8192,
      maxSectionChars: 1024,
      maxResults: 4,
      maxFileBytes: 8388608,
      maxObservedBytes: 33554432,
      maxLines: 100000,
      maxFailures: 16,
    },
    counts: { observedBytes: 0, observedLines: 0, returnedBytes: 1, omittedCount: 0, errorCount: 0 },
    ...overrides,
  };
}

await test(1, "closed concrete schemas and strict argument validation", () => {
  assert.deepEqual(
    TOOL_DEFINITIONS.map((entry) => entry.name),
    ["orient", "locate", "read"],
  );
  for (const entry of TOOL_DEFINITIONS) {
    assert.equal(entry.inputSchema.type, "object");
    assert.equal(entry.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(validateToolArguments("orient", {}), {});
  assert.throws(() => validateToolArguments("orient", { surprise: true }), /INVALID_ARGUMENTS/);
  assert.throws(() => validateToolArguments("locate", { query: "" }), /INVALID_ARGUMENTS/);
  assert.throws(() => validateToolArguments("locate", { query: "\u0000" }), /INVALID_ARGUMENTS/);
  assert.throws(() => validateToolArguments("locate", { query: "x", maxResults: 5 }), /INVALID_ARGUMENTS/);
  assert.throws(
    () =>
      validateToolArguments("read", {
        locations: [{ repository: "w108-fixture", path: "source.md", startLine: 2, endLine: 1 }],
      }),
    /INVALID_ARGUMENTS/,
  );
  assert.throws(
    () =>
      validateToolArguments("read", {
        locations: [
          { repository: "w108-fixture", path: "source.md", startLine: 1, endLine: 1, extra: true },
        ],
      }),
    /INVALID_ARGUMENTS/,
  );
});

await test(2, "session binding injects trusted identity and detects drift", async () => {
  const f = fixture("binding");
  const expected = captureFixtureIdentity(f.registryPath);
  const requests = [];
  const runSourceImpl = async (_registry, request) => {
    requests.push(structuredClone(request));
    return sourceResult(request.op, request, {
      rootIdentity: expected.rootIdentity,
      sha256: expected.files["source.md"].sha256,
      instructionSha: expected.files["AGENTS.md"].sha256,
    });
  };
  const config = {
    registryPath: f.registryPath,
    objective: "Find the public synthetic fact and cite its exact source.md line.",
    expected,
    runSourceImpl,
  };

  const unbound = createAdapterSession(config);
  const before = await unbound.call("locate", { query: "cobalt" }, "rpc-pre");
  assert.equal(JSON.parse(before.content[0].text).error, "ORDER");
  assert.equal(requests.length, 0);

  const session = createAdapterSession(config);
  const oriented = await session.call("orient", {}, "rpc-orient");
  assert.equal(oriented.isError, false);
  assert.equal(requests[0].op, "locate");
  assert.equal(requests[0].query, "__W108_ORIENT_NO_MATCH__");
  assert.equal(requests[0].maxResults, 1);
  assert.equal(requests[0].maxBytes, 8192);
  assert.equal(JSON.parse(oriented.content[0].text).orientationDigest, "a".repeat(64));

  const located = await session.call("locate", { query: "cobalt", maxResults: 2 }, "rpc-locate");
  assert.equal(located.isError, false);
  assert.deepEqual(requests[1], {
    version: 1,
    op: "locate",
    project: "w108-canary",
    objective: config.objective,
    repositoryIds: ["w108-fixture"],
    query: "cobalt",
    maxResults: 2,
    maxBytes: 8192,
  });
  assert.equal(Object.hasOwn(requests[1], "orientationDigest"), false);

  const repeated = createAdapterSession(config);
  assert.equal((await repeated.call("orient", {}, "rpc-first")).isError, false);
  const repeatResult = await repeated.call("orient", {}, "rpc-second");
  assert.equal(JSON.parse(repeatResult.content[0].text).error, "ORDER");

  const callsBeforeDrift = requests.length;
  writeFileSync(join(f.projectRoot, "source.md"), readFileSync(join(f.projectRoot, "source.md"), "utf8") + "drift\n");
  const drifted = await session.call(
    "read",
    {
      locations: [{ repository: "w108-fixture", path: "source.md", startLine: 3, endLine: 3 }],
    },
    "rpc-read",
  );
  assert.equal(JSON.parse(drifted.content[0].text).error, "IDENTITY");
  assert.equal(requests.length, callsBeforeDrift);

  const g = fixture("registry-drift");
  const registryExpected = captureFixtureIdentity(g.registryPath);
  const registrySession = createAdapterSession({
    ...config,
    registryPath: g.registryPath,
    expected: registryExpected,
  });
  writeFileSync(g.registryPath, readFileSync(g.registryPath, "utf8") + " ");
  const registryDrift = await registrySession.call("orient", {}, "rpc-registry");
  assert.equal(JSON.parse(registryDrift.content[0].text).error, "IDENTITY");
});


await test(3, "real source sequence, exact transcript, and fail-closed caps", async () => {
  const registryPath = join(repo, "docs/research/read-efficiency/fixtures/W-108/registry.json");
  const expected = captureFixtureIdentity(registryPath, repo);
  const transcriptPath = join(fixture("transcript").root, "server-transcript.jsonl");
  const session = createAdapterSession({
    registryPath,
    objective: "Find the public synthetic fact and cite its exact source.md line.",
    expected,
    transcriptPath,
  });
  const orient = await session.call("orient", {}, 101);
  assert.equal(orient.isError, false);
  const locate = await session.call("locate", { query: "cobalt-orchid-731", maxResults: 1 }, 205);
  assert.equal(locate.isError, false);
  const located = JSON.parse(locate.content[0].text).items[0];
  assert.deepEqual(
    {
      repository: located.repository,
      path: located.path,
      startLine: located.startLine,
      endLine: located.endLine,
    },
    { repository: "w108-fixture", path: "source.md", startLine: 3, endLine: 3 },
  );
  const read = await session.call(
    "read",
    {
      locations: [
        {
          repository: located.repository,
          path: located.path,
          startLine: located.startLine,
          endLine: located.endLine,
        },
      ],
      maxSectionChars: 1024,
    },
    309,
  );
  assert.equal(read.isError, false);
  const readResult = JSON.parse(read.content[0].text);
  assert.equal(readResult.items[0].body, "The W-108 fixture code is cobalt-orchid-731.\n");
  assert.equal(readResult.items[0].sha256, expected.files["source.md"].sha256);
  assert.equal(session.state, "complete");
  assert.equal(Array.isArray(session.transcript), true);

  const rows = readFileSync(transcriptPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((row) => row.sequence), [1, 2, 3]);
  assert.deepEqual(rows.map((row) => row.rpcId), [101, 205, 309]);
  assert.deepEqual(rows.map((row) => row.tool), ["orient", "locate", "read"]);
  for (const row of rows) {
    assert.equal(row.canonicalArguments, canonicalJson(row.arguments));
    assert.equal(row.resultBytes, Buffer.byteLength(row.resultText));
    assert.equal(row.resultSha256, createHash("sha256").update(row.resultText).digest("hex"));
    assert.equal(row.resultText, [orient, locate, read][row.sequence - 1].content[0].text);
  }

  let failureCalls = 0;
  const failed = createAdapterSession({
    registryPath,
    objective: "Find the public synthetic fact and cite its exact source.md line.",
    expected,
    runSourceImpl: async () => {
      failureCalls += 1;
      return { version: 1, ok: false, error: { code: "IO" } };
    },
  });
  const failure = await failed.call("orient", {}, "failure");
  assert.equal(failure.isError, true);
  assert.equal(failure.content[0].text.includes("cobalt-orchid-731"), false);
  await failed.call("orient", {}, "retry");
  assert.equal(failureCalls, 1);

  const oversized = createAdapterSession({
    registryPath,
    objective: "Find the public synthetic fact and cite its exact source.md line.",
    expected,
    runSourceImpl: async () => ({
      ...sourceResult("locate", {
        objective: "Find the public synthetic fact and cite its exact source.md line.",
        query: "__W108_ORIENT_NO_MATCH__",
      }, { rootIdentity: expected.rootIdentity, instructionSha: expected.files["AGENTS.md"].sha256 }),
      padding: "x".repeat(9000),
    }),
  });
  const limited = await oversized.call("orient", {}, "oversized");
  assert.equal(JSON.parse(limited.content[0].text).error, "LIMIT");

  const extra = createAdapterSession({
    registryPath,
    objective: "Find the public synthetic fact and cite its exact source.md line.",
    expected,
  });
  const a = await extra.call("orient", {}, "a");
  const b = await extra.call("locate", { query: "cobalt-orchid-731", maxResults: 1 }, "b");
  const hit = JSON.parse(b.content[0].text).items[0];
  await extra.call(
    "read",
    {
      locations: [
        { repository: hit.repository, path: hit.path, startLine: hit.startLine, endLine: hit.endLine },
      ],
    },
    "c",
  );
  const fourth = await extra.call("read", { locations: [] }, "d");
  assert.equal(JSON.parse(fourth.content[0].text).error, "ORDER");
  const fifth = await extra.call("orient", {}, "e");
  assert.deepEqual(fifth.content, []);
  assert.equal(extra.attempts, 5);
});


await test(4, "live runner gates every frozen predicate before one spawn", async () => {
  const valid = {
    deterministicBehaviours: [1, 2, 3, 4, 5],
    deterministicOutcome: "PASS",
    fixtureHashesMatch: true,
    sourceHashesMatch: true,
    commandFrozen: true,
    configPreflightPassed: true,
    markerAbsent: true,
    evidenceAbsent: true,
    executable: "/usr/bin/codex",
    executableSha256: "d".repeat(64),
    executableVersion: "codex-cli 1.0.0",
    model: "gpt-5.6-luna",
    effort: "low",
    argv: ["exec", "--json", "--sandbox", "read-only"],
    maxCalls: 4,
    maxResultBytes: 32768,
  };
  const invalid = [
    ["deterministicOutcome", "FAIL"],
    ["fixtureHashesMatch", false],
    ["sourceHashesMatch", false],
    ["commandFrozen", false],
    ["configPreflightPassed", false],
    ["markerAbsent", false],
    ["evidenceAbsent", false],
    ["model", "gpt-6-luna"],
    ["effort", "medium"],
    ["maxCalls", 5],
    ["maxResultBytes", 32769],
  ];
  for (const [key, value] of invalid) {
    let spawns = 0;
    const result = await runLiveCanary(
      { ...valid, [key]: value },
      {
        createMarker: () => {
          throw new Error("marker must not be created on refusal");
        },
        spawnModel: async () => {
          spawns += 1;
          return { exitCode: 0 };
        },
      },
    );
    assert.equal(result.outcome, "REFUSED", key);
    assert.equal(spawns, 0, key);
  }

  let markerCreates = 0;
  let spawns = 0;
  const accepted = await runLiveCanary(valid, {
    createMarker: () => {
      markerCreates += 1;
      return true;
    },
    spawnModel: async (frozen) => {
      spawns += 1;
      assert.equal(frozen.model, "gpt-5.6-luna");
      assert.equal(frozen.effort, "low");
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(accepted.outcome, "SPAWNED");
  assert.equal(markerCreates, 1);
  assert.equal(spawns, 1);
});


await test(5, "synthetic live verifier enforces event and transcript conjunction", () => {
  const serverRows = [
    {
      sequence: 1,
      rpcId: 11,
      tool: "orient",
      arguments: {},
      canonicalArguments: "{}",
      resultText: '{"version":1,"ok":true,"op":"locate","items":[]}',
    },
    {
      sequence: 2,
      rpcId: 12,
      tool: "locate",
      arguments: { query: "cobalt-orchid-731", maxResults: 1 },
      canonicalArguments: '{"maxResults":1,"query":"cobalt-orchid-731"}',
      resultText: '{"version":1,"ok":true,"op":"locate","items":[{"path":"source.md","startLine":3,"endLine":3}]}',
    },
    {
      sequence: 3,
      rpcId: 13,
      tool: "read",
      arguments: {
        locations: [
          { repository: "w108-fixture", path: "source.md", startLine: 3, endLine: 3 },
        ],
      },
      canonicalArguments:
        '{"locations":[{"endLine":3,"path":"source.md","repository":"w108-fixture","startLine":3}]}',
      resultText:
        '{"version":1,"ok":true,"op":"read","items":[{"path":"source.md","startLine":3,"endLine":3,"body":"The W-108 fixture code is cobalt-orchid-731.\\n"}]}',
    },
  ].map((row) => ({
    ...row,
    resultBytes: Buffer.byteLength(row.resultText),
    resultSha256: createHash("sha256").update(row.resultText).digest("hex"),
  }));
  const started = (id, row) => ({
    type: "item.started",
    item: {
      id,
      type: "mcp_tool_call",
      server: "w108_source",
      tool: row.tool,
      arguments: structuredClone(row.arguments),
      result: null,
      error: null,
      status: "in_progress",
    },
  });
  const completed = (id, row) => ({
    type: "item.completed",
    item: {
      id,
      type: "mcp_tool_call",
      server: "w108_source",
      tool: row.tool,
      arguments: structuredClone(row.arguments),
      result: {
        content: [{ type: "text", text: row.resultText }],
        structured_content: null,
      },
      error: null,
      status: "completed",
    },
  });
  const events = [
    { type: "thread.started", thread_id: "thread-synthetic" },
    { type: "turn.started" },
    started("codex-a", serverRows[0]),
    completed("codex-a", serverRows[0]),
    started("codex-b", serverRows[1]),
    { ...started("codex-b", serverRows[1]), type: "item.updated" },
    completed("codex-b", serverRows[1]),
    started("codex-c", serverRows[2]),
    completed("codex-c", serverRows[2]),
    {
      type: "item.completed",
      item: {
        id: "message-final",
        type: "agent_message",
        text: "The fixture code is cobalt-orchid-731 (source.md:3).",
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 20,
        cache_write_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 5,
      },
    },
  ];
  const base = {
    serverRows,
    modelEvents: events,
    exitCode: 0,
    model: "gpt-5.6-luna",
    effort: "low",
    server: "w108_source",
    fact: "cobalt-orchid-731",
    citation: "source.md:3",
  };
  assert.equal(verifyCanary(base).outcome, "PASS");

  const cases = [
    { name: "model drift", alter: (x) => (x.model = "gpt-6-luna") },
    { name: "effort drift", alter: (x) => (x.effort = "medium") },
    { name: "nonzero exit", alter: (x) => (x.exitCode = 1) },
    {
      name: "missing usage",
      alter: (x) => {
        x.modelEvents.at(-1).usage = {};
      },
    },
    {
      name: "changed arguments",
      alter: (x) => {
        x.modelEvents[4].item.arguments.query = "changed";
      },
    },
    {
      name: "changed result text",
      alter: (x) => {
        x.modelEvents[6].item.result.content[0].text += " ";
      },
    },
    {
      name: "changed server hash",
      alter: (x) => {
        x.serverRows[1].resultSha256 = "0".repeat(64);
      },
    },
    {
      name: "changed server bytes",
      alter: (x) => {
        x.serverRows[1].resultBytes += 1;
      },
    },
    {
      name: "missing result",
      alter: (x) => {
        x.modelEvents[3].item.result = null;
      },
    },
    {
      name: "forbidden started item",
      alter: (x) => {
        x.modelEvents[2].item.type = "command_execution";
      },
    },
    {
      name: "foreign updated server",
      alter: (x) => {
        x.modelEvents[5].item.server = "foreign";
      },
    },
    {
      name: "forbidden completed item",
      alter: (x) => {
        x.modelEvents[6].item.type = "web_search";
      },
    },
    {
      name: "unknown event",
      alter: (x) => {
        x.modelEvents.splice(2, 0, { type: "mystery" });
      },
    },
    {
      name: "duplicate completion",
      alter: (x) => {
        x.modelEvents.splice(4, 0, structuredClone(x.modelEvents[3]));
      },
    },
    {
      name: "post turn event",
      alter: (x) => {
        x.modelEvents.push({ type: "turn.started" });
      },
    },
    {
      name: "wrong fact",
      alter: (x) => {
        x.fact = "wrong";
      },
    },
    {
      name: "wrong citation",
      alter: (x) => {
        x.citation = "source.md:99";
      },
    },
  ];
  for (const candidate of cases) {
    const changed = structuredClone(base);
    candidate.alter(changed);
    assert.equal(verifyCanary(changed).outcome, "FAIL", candidate.name);
  }

  const separateIds = structuredClone(base);
  separateIds.serverRows[0].rpcId = 9001;
  separateIds.serverRows[1].rpcId = 9002;
  separateIds.serverRows[2].rpcId = 9003;
  assert.equal(verifyCanary(separateIds).outcome, "PASS");
});

process.on("exit", () => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});
process.exitCode = failed ? 1 : 0;
