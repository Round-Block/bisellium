import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanupOnly, runProcessController, runPublicCanary, validateRawEvidence } from "./W-109-public-canary.mjs";

const behaviour = process.argv[2];
const repo = resolve(process.argv[3] ?? new URL("../../..", import.meta.url).pathname);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "w109-b1-"));
  const auth = join(root, "auth.json");
  const evidence = join(root, "evidence");
  const cwd = join(root, "cwd");
  const runtimeParent = join(root, "private");
  mkdirSync(evidence, { mode: 0o700 });
  mkdirSync(cwd, { mode: 0o700 });
  mkdirSync(runtimeParent, { mode: 0o700 });
  writeFileSync(auth, JSON.stringify({ tokens: { access_token: "secret-canary-token" } }), { mode: 0o600 });
  return { root, auth, evidence, cwd, runtimeParent };
}

function options(f) {
  return {
    repo,
    registry: join(repo, "docs/research/read-efficiency/fixtures/W-108/registry.json"),
    evidence: f.evidence,
    cwd: f.cwd,
    runtimeParent: f.runtimeParent,
    auth: f.auth,
    codex: process.execPath,
    node: process.execPath,
    runner: join(repo, "docs/research/read-efficiency/W-109-public-canary.mjs"),
    test: join(repo, "docs/research/read-efficiency/W-109-public-canary.test.mjs"),
    adapter: join(repo, "docs/research/read-efficiency/source-adapter-preflight.mjs"),
    productionSource: join(repo, "packages/commands/src/source.ts"),
  };
}

async function behaviour1() {
  const f = fixture();
  let spawns = 0;
  process.env.W109_AMBIENT_SECRET = "must-not-pass";
  const result = await runPublicCanary(options(f), {
    controller: async (request) => {
      spawns += 1;
      assert.deepEqual(Object.keys(request.env).sort(), ["CODEX_HOME", "HOME", "LANG", "LC_ALL", "PATH"]);
      assert.equal(request.env.W109_AMBIENT_SECRET, undefined);
      assert.equal(statSync(join(request.env.CODEX_HOME, "auth.json")).mode & 0o777, 0o600);
      throw new Error("synthetic post-marker failure");
    },
  });
  assert.equal(spawns, 1);
  assert.equal(result.outcome, "FAIL");
  assert.equal(result.reason, "SPAWN");
  assert.equal(statSync(join(f.evidence, "attempt-marker.json")).isFile(), true);
  assert.equal(statSync(join(f.evidence, "result.json")).isFile(), true);
  assert.equal(readFileSync(join(f.evidence, "result.json"), "utf8").includes("secret-canary-token"), false);
  assert.equal(statSync(f.runtimeParent).mode & 0o777, 0o700);
  const retainedMarker = JSON.parse(readFileSync(join(f.evidence, "attempt-marker.json"), "utf8"));
  assert.equal(existsSync(retainedMarker.runtime), false);
  const repeat = await runPublicCanary(options(f), { controller: async () => { spawns += 1; } });
  assert.equal(repeat.outcome, "REFUSED");
  assert.equal(spawns, 1);

  const unsafe = fixture();
  chmodSync(unsafe.auth, 0o644);
  const unsafeResult = await runPublicCanary(options(unsafe), { controller: async () => { spawns += 1; } });
  assert.equal(unsafeResult.reason, "AUTH_UNSAFE");
  rmSync(unsafe.auth);
  const missingResult = await runPublicCanary(options(unsafe), { controller: async () => { spawns += 1; } });
  assert.equal(missingResult.outcome, "REFUSED");

  const occupied = fixture();
  writeFileSync(join(occupied.cwd, "occupied"), "x");
  const occupiedResult = await runPublicCanary(options(occupied), { controller: async () => { spawns += 1; } });
  assert.equal(occupiedResult.reason, "CWD_NOT_EMPTY");

  const drift = fixture();
  const driftSource = join(drift.root, "source.ts");
  writeFileSync(driftSource, "before\n", { mode: 0o600 });
  const driftOptions = { ...options(drift), productionSource: driftSource };
  const driftResult = await runPublicCanary(driftOptions, {
    beforeMarker: () => writeFileSync(driftSource, "after\n"),
    controller: async () => { spawns += 1; },
  });
  assert.equal(driftResult.reason, "DRIFT");
  assert.equal(existsSync(join(drift.evidence, "attempt-marker.json")), false);
  assert.equal(spawns, 1);

  const crash = fixture();
  const crashRuntime = join(crash.runtimeParent, "attempt-crash");
  mkdirSync(crashRuntime, { mode: 0o700 });
  const privateFreeze = Buffer.from("frozen\n");
  writeFileSync(join(crashRuntime, "freeze.json"), privateFreeze, { mode: 0o600 });
  const crashMarker = join(crash.evidence, "attempt-marker.json");
  writeFileSync(crashMarker, JSON.stringify({ version: 1, runtime: crashRuntime, freezeSha256: sha(privateFreeze) }) + "\n", { mode: 0o600 });
  const cleaned = cleanupOnly({ marker: crashMarker, runtimeParent: crash.runtimeParent });
  assert.equal(cleaned.markerRetained, true);
  assert.equal(existsSync(crashRuntime), false);
  assert.equal(existsSync(crashMarker), true);
}


async function behaviour2() {
  const root = mkdtempSync(join(tmpdir(), "w109-b2-"));
  const fake = join(root, "fake.mjs");
  writeFileSync(fake, `
import { spawn } from "node:child_process";
const mode = process.argv[2];
if (mode === "stdin") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  process.stdout.write(Buffer.concat(chunks));
} else if (mode === "grandchild") {
  setInterval(() => {}, 1000);
} else if (mode === "hang") {
  spawn(process.execPath, [new URL(import.meta.url).pathname, "grandchild"], { stdio: ["ignore", "ignore", "ignore"] });
  setInterval(() => {}, 1000);
} else if (mode === "flood") {
  for (let i = 0; i < 128; i += 1) process.stdout.write("x".repeat(1024));
}
`.replace(/^\+/gm, ""));
  const base = {
    executable: process.execPath,
    env: { HOME: root, PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", CODEX_HOME: root },
    cwd: root,
    transcript: join(root, "transcript.jsonl"),
    limits: { stdoutBytes: 4096, stdoutRecords: 256, stderrBytes: 1024, transcriptBytes: 4096, deadlineMs: 1000, termGraceMs: 100 },
  };
  const stdin = await runProcessController({ ...base, argv: [fake, "stdin"], prompt: "closed-input\n" }).catch(() => ({ exitCode: null }));
  assert.equal(stdin.exitCode, 0);
  assert.equal(stdin.stdout.toString("utf8"), "closed-input\n");
  assert.equal(stdin.groupAlive, false);

  const started = Date.now();
  const hang = await runProcessController({ ...base, argv: [fake, "hang"], prompt: "x", limits: { ...base.limits, deadlineMs: 150 } });
  assert.equal(hang.reason, "TIMEOUT");
  assert.equal(hang.groupAlive, false);
  assert.ok(Date.now() - started < 2000);

  const flood = await runProcessController({ ...base, argv: [fake, "flood"], prompt: "x" });
  assert.equal(flood.reason, "STDOUT_CAP");
  assert.equal(flood.stdout.length, 4096);
  assert.ok(flood.stdoutBytes > flood.stdout.length);
  assert.equal(flood.groupAlive, false);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validEvidence(answer = "cobalt-orchid-731 source.md:3") {
  const calls = [
    { tool: "orient", arguments: {}, result: { version: 1, ok: true, op: "locate", project: "w108-canary", orientationDigest: "a".repeat(64), items: [], errors: [], omissions: [] } },
    { tool: "locate", arguments: { query: "cobalt-orchid-731" }, result: { version: 1, ok: true, op: "locate", project: "w108-canary", orientationDigest: "a".repeat(64), items: [], errors: [], omissions: [] } },
    { tool: "read", arguments: { locations: [{ repository: "w108-fixture", path: "source.md", startLine: 3, endLine: 3 }] }, result: { version: 1, ok: true, op: "read", project: "w108-canary", orientationDigest: "a".repeat(64), items: [], errors: [], omissions: [] } },
  ];
  const rows = calls.map((call, index) => {
    const resultText = JSON.stringify(call.result);
    return { sequence: index + 1, rpcId: index + 1, tool: call.tool, arguments: call.arguments, canonicalArguments: canonical(call.arguments), resultText, resultBytes: Buffer.byteLength(resultText), resultSha256: sha(resultText) };
  });
  const events = [{ type: "thread.started", thread_id: "thread-1" }, { type: "turn.started" }];
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const id = `call-${index + 1}`;
    events.push({ type: "item.started", item: { id, type: "mcp_tool_call", server: "w108_source", tool: call.tool, arguments: call.arguments, result: null, error: null, status: "in_progress" } });
    events.push({ type: "item.completed", item: { id, type: "mcp_tool_call", server: "w108_source", tool: call.tool, arguments: call.arguments, result: { content: [{ type: "text", text: rows[index].resultText }], structured_content: null }, error: null, status: "completed" } });
  }
  events.push({ type: "item.completed", item: { id: "message-1", type: "agent_message", text: answer } });
  events.push({ type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 8, reasoning_output_tokens: 1 } });
  return { rows, events, stdout: Buffer.from(events.map(JSON.stringify).join("\n") + "\n"), transcript: Buffer.from(rows.map(JSON.stringify).join("\n") + "\n") };
}

function fakeCodex(root, evidence) {
  const fake = join(root, "codex-fake");
  const script = `#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv[2] === "--version") { process.stdout.write("codex-cli fake\\n"); process.exit(0); }
const config = process.argv.find((value) => value.startsWith("mcp_servers.w108_source.args="));
const args = JSON.parse(config.slice(config.indexOf("=") + 1));
const transcript = args[args.indexOf("--transcript") + 1];
for await (const _chunk of process.stdin) {}
writeFileSync(transcript, Buffer.from(${JSON.stringify(evidence.transcript.toString("base64"))}, "base64"));
process.stderr.write(Buffer.from(${JSON.stringify((evidence.stderr ?? Buffer.alloc(0)).toString("base64"))}, "base64"));
process.stdout.write(Buffer.from(${JSON.stringify(evidence.stdout.toString("base64"))}, "base64"));
`.replace(/^\+/gm, "");
  writeFileSync(fake, script, { mode: 0o700 });
  chmodSync(fake, 0o700);
  return fake;
}

async function behaviour3() {
  const valid = validEvidence();
  let framed;
  try {
    framed = validateRawEvidence({ stdout: valid.stdout, transcript: valid.transcript, exitCode: 0 });
  } catch {
    framed = null;
  }
  assert.equal(framed?.outcome, "PASS");

  for (const [bytes, reason] of [
    [Buffer.from([0xff, 0x0a]), "MODEL_UTF8"],
    [Buffer.from("{}"), "MODEL_FRAMING"],
    [Buffer.from("{}\n\n"), "MODEL_FRAMING"],
    [Buffer.from("not-json\n"), "MODEL_JSON"],
  ]) {
    assert.equal(validateRawEvidence({ stdout: bytes, transcript: valid.transcript, exitCode: 0 }).reason, reason);
  }

  const f = fixture();
  const fake = fakeCodex(f.root, valid);
  const live = await runPublicCanary({ ...options(f), codex: fake });
  assert.equal(live.outcome, "PASS");
  assert.equal(live.calls, 3);
  assert.equal(live.answer.includes("cobalt-orchid-731"), true);
  assert.equal(existsSync(join(f.evidence, "model-events.jsonl")), true);
  assert.equal(existsSync(join(f.evidence, "server-transcript.jsonl")), true);
  assert.equal(existsSync(join(f.runtimeParent, "attempt-")), false);

  const forbidden = structuredClone(valid);
  forbidden.events = structuredClone(valid.events);
  forbidden.events.splice(2, 0, { type: "item.completed", item: { id: "command-1", type: "command_execution", command: "pwd" } });
  forbidden.stdout = Buffer.from(forbidden.events.map(JSON.stringify).join("\n") + "\n");
  assert.equal(validateRawEvidence({ stdout: forbidden.stdout, transcript: valid.transcript, exitCode: 0 }).reason, "SEMANTIC");

  const leakFixture = fixture();
  const leak = validEvidence("secret-canary-token cobalt-orchid-731 source.md:3");
  const leakFake = fakeCodex(leakFixture.root, leak);
  const leaked = await runPublicCanary({ ...options(leakFixture), codex: leakFake });
  assert.equal(leaked.outcome, "FAIL");
  assert.equal(leaked.reason, "CREDENTIAL_LEAK");
  assert.equal(existsSync(join(leakFixture.evidence, "model-events.jsonl")), false);
  assert.equal(readFileSync(join(leakFixture.evidence, "result.json"), "utf8").includes("secret-canary-token"), false);
}

async function behaviour4() {
  const valid = validEvidence();
  for (const stream of ["stdout", "stderr", "transcript"]) {
    const f = fixture();
    const credentialBytes = readFileSync(f.auth);
    const candidate = { ...valid, stderr: Buffer.alloc(0) };
    candidate[stream] = credentialBytes;
    const fake = fakeCodex(f.root, candidate);
    const result = await runPublicCanary({ ...options(f), codex: fake });
    assert.equal(result.outcome, "FAIL", stream);
    assert.equal(result.reason, "CREDENTIAL_LEAK", stream);
    assert.equal(existsSync(join(f.evidence, "model-events.jsonl")), false, stream);
    assert.equal(existsSync(join(f.evidence, "server-transcript.jsonl")), false, stream);
    const publicResult = readFileSync(join(f.evidence, "result.json"), "utf8");
    assert.equal(publicResult.includes("secret-canary-token"), false, stream);
    assert.equal(publicResult.includes(sha(credentialBytes)), false, stream);
    assert.equal(Object.hasOwn(JSON.parse(publicResult), "stdoutSha256"), false, stream);
    assert.equal(Object.hasOwn(JSON.parse(publicResult), "stderrSha256"), false, stream);
  }
}
if (behaviour === "b1") await behaviour1();
else if (behaviour === "b2") await behaviour2();
else if (behaviour === "b3") await behaviour3();
else if (behaviour === "b4") await behaviour4();
else throw new Error("usage: W-109-public-canary.test.mjs b1|b2|b3|b4 <repo>");
