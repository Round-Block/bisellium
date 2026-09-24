/**
 * packages/cli/src/harness-env.test.ts — W-049 (studio/briefs/W-049.md): the
 * harness env is scrubbed. Every vendor spawn a harness profile makes
 * projects the parent environment onto a fixed ten-name allowlist — exact,
 * case-sensitive set membership, no regex, no prefix/suffix, no case
 * folding. Four behaviours cover the four spawn expressions
 * (`claude-code.ts`'s `runClaude`/`available()`, `codex.ts`'s
 * `runCodex`/`available()`) across all six entry paths: direct
 * `start`/`resume` calls, the two `available()` probes, and the two
 * `process.env`-reading callers (`runTalk`, `runTick`).
 *
 * Stubs never execute what they're handed — they log their own argv and
 * env, then print a canned envelope. Evidence here is name-level only: an
 * assertion's `detail` is always a sorted list of variable NAMES (or a
 * literal that isn't a secret), never a value (the brief's "Evidence is
 * name-level, never a live exploit").
 *
 * `BISELLIUM_ONLY_BEHAVIOUR` (comma-separated behaviour numbers) restricts
 * the run to those blocks — same pattern as lifecycle.test.ts — since each
 * behaviour's red is recorded from its own single-behaviour run.
 */
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { claudeCodeProfile, codexProfile } from "@bisellium/shim";
import { runTalk } from "./talk.js";
import { runTick } from "./tick.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-23T09:00:00Z");

const only = process.env["BISELLIUM_ONLY_BEHAVIOUR"];
const selected = only ? new Set(only.split(",").map(Number)) : undefined;
const runs = (behaviour: number): boolean => selected === undefined || selected.has(behaviour);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
};

// ---------------------------------------------------------------------------
// The expected allowlist — written out literally (this test is a second,
// independent spec of the list, not a mirror of harness/env.ts; neither
// exists at HEAD so every red here stays assertion-level).
// ---------------------------------------------------------------------------
const ALLOWLIST = ["PATH", "HOME", "SHELL", "TMPDIR", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"];

/** The guard set: named overrides, credentials, host-session links, trust
 *  and runtime injection, near-misses (prefix/suffix/regex/case-folding
 *  killers) and test-only plumbing — none of these may ever reach a stub. */
const GUARD_SET = [
  // Endpoint overrides
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "OPENAI_BASE_URL",
  "USE_STAGING_OAUTH",
  "USE_LOCAL_OAUTH",
  // Credentials and provider switches
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "OPENAI_API_KEY",
  "ANTHROPIC_MODEL",
  // Config-home redirects
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  // Host-session links
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  // Trust and runtime injection
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "SSL_CERT_FILE",
  "ALL_PROXY",
  // Near-misses: prefix, suffix, regex and case-folding killers, and a
  // re-added locale rule.
  "PATH_ZZ",
  "ZZ_HOME",
  "HTTPS_PROXY_ZZ",
  "Path",
  "home",
  "LANG",
  "LC_ALL",
  // Test plumbing — no test-only channel may survive.
  "TALK_STUB_LOG",
  "STUB_SCENARIO",
  "BISELLIUM_FAKE_MODE",
  // A future vendor var
  "ZZ_FUTURE_VENDOR_BASE_URL",
];

const sentinel = (name: string): string => `SYNTH-${name}-VALUE`;

/** Builds a synthetic parent env: every allowlisted name except
 *  `http_proxy` (left out so the no-invention property is tested), plus the
 *  whole guard set, each with a sentinel value. */
function buildSynth(binDir: string, homeDir: string, tmpDir: string): NodeJS.ProcessEnv {
  const proxyValue = "http://proxy.w049.invalid:3128";
  const synth: NodeJS.ProcessEnv = {
    PATH: `${binDir}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: homeDir,
    SHELL: "/bin/sh",
    TMPDIR: tmpDir,
    HTTPS_PROXY: proxyValue,
    https_proxy: proxyValue,
    HTTP_PROXY: proxyValue,
    NO_PROXY: proxyValue,
    no_proxy: proxyValue,
  };
  for (const name of GUARD_SET) synth[name] = sentinel(name);
  return synth;
}

// ---------------------------------------------------------------------------
// Env comparison helpers — every detail printed is a sorted NAME list,
// never a value.
// ---------------------------------------------------------------------------
function sortedKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).sort();
}
function envDeepEqual(a: NodeJS.ProcessEnv, b: NodeJS.ProcessEnv): boolean {
  const ak = sortedKeys(a);
  const bk = sortedKeys(b);
  if (JSON.stringify(ak) !== JSON.stringify(bk)) return false;
  return ak.every((k) => a[k] === b[k]);
}
function diffNames(a: NodeJS.ProcessEnv, b: NodeJS.ProcessEnv): string {
  const ak = new Set(sortedKeys(a));
  const bk = new Set(sortedKeys(b));
  const onlyA = [...ak].filter((k) => !bk.has(k));
  const onlyB = [...bk].filter((k) => !ak.has(k));
  const changed = [...ak].filter((k) => bk.has(k) && a[k] !== b[k]);
  return `onlyA=[${onlyA.join(",")}] onlyB=[${onlyB.join(",")}] changed=[${changed.join(",")}]`;
}
function expectedNames(parent: NodeJS.ProcessEnv): string[] {
  return ALLOWLIST.filter((n) => parent[n] !== undefined).sort();
}

function checkSynthGuards(label: string, synth: NodeJS.ProcessEnv): void {
  const missing = GUARD_SET.filter((n) => synth[n] === undefined);
  check(`${label}: SYNTH contains the whole guard set`, missing.length === 0, missing.join(","));
  check(`${label}: http_proxy is absent from SYNTH`, synth["http_proxy"] === undefined);
}

// ---------------------------------------------------------------------------
// Stubs — a stub never executes what it's handed. The log path is a literal
// baked into the stub's own source text, never read from env (an env-carried
// path would itself be scrubbed).
// ---------------------------------------------------------------------------
interface LogRecord {
  bin: string;
  kind: "version" | "turn";
  args: string[];
  env: NodeJS.ProcessEnv;
}

function readLog(logPath: string): LogRecord[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogRecord);
}

function claudeStubSource(logPath: string): string {
  return `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const kind = args.length === 1 && args[0] === "--version" ? "version" : "turn";
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ bin: "claude", kind, args, env: process.env }) + "\\n");
if (kind === "version") process.exit(0);
process.stdout.write(JSON.stringify({ session_id: "sess-w049", result: "ack", is_error: false, model: "stub" }) + "\\n");
process.exit(0);
`;
}

function codexStubSource(logPath: string): string {
  return `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const kind = args.length === 1 && args[0] === "--version" ? "version" : "turn";
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ bin: "codex", kind, args, env: process.env }) + "\\n");
if (kind === "version") process.exit(0);
process.stdout.write(JSON.stringify({ type: "session.created", session_id: "sess-w049" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "agent_message", message: "ack" }) + "\\n");
process.exit(0);
`;
}

function writeStub(binDir: string, name: string, source: string): void {
  const p = join(binDir, name);
  writeFileSync(p, source);
  chmodSync(p, 0o755);
}

function claudeForm(args: string[]): { form: "start" | "resume"; resumeId?: string } {
  const idx = args.indexOf("--resume");
  return idx === -1 ? { form: "start" } : { form: "resume", resumeId: args[idx + 1] };
}
function codexForm(args: string[]): { form: "start" | "resume"; resumeId?: string } {
  if (args[0] === "exec" && args[1] === "resume") return { form: "resume", resumeId: args[2] };
  return { form: "start" };
}

/** The property, checked on every logged record: the stub's env name set
 *  equals the allowlist projected onto `parent`'s name set, and each
 *  surviving value is identical to the parent's. */
function checkProjection(label: string, record: LogRecord, parent: NodeJS.ProcessEnv): void {
  const expected = expectedNames(parent);
  const actual = sortedKeys(record.env);
  check(`${label}: env name set is exactly the allowlist projection`, JSON.stringify(actual) === JSON.stringify(expected), `expected=[${expected.join(",")}] actual=[${actual.join(",")}]`);
  const mismatched = expected.filter((n) => record.env[n] !== parent[n]);
  check(`${label}: every surviving value is identical to the parent's`, mismatched.length === 0, `mismatched=[${mismatched.join(",")}]`);
  check(`${label}: http_proxy is absent from the child env`, record.env["http_proxy"] === undefined);
}

function swapEnv(synth: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const original = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, synth);
  return original;
}
function restoreEnv(original: NodeJS.ProcessEnv): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, original);
}

const cleanupDirs: string[] = [];
function tmp(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w049-${tag}-`));
  cleanupDirs.push(dir);
  return dir;
}

try {
  // ---- 1: claude's session spawns (start, resume) hand claude exactly the
  //         allowlist projection; the parent is never mutated -------------
  if (runs(1)) {
    const binDir = tmp("b1-bin");
    const homeDir = tmp("b1-home");
    const tmpDir = tmp("b1-tmp");
    const logPath = join(binDir, "log.jsonl");
    writeStub(binDir, "claude", claudeStubSource(logPath));
    const synth = buildSynth(binDir, homeDir, tmpDir);
    checkSynthGuards("behaviour 1", synth);
    const synthSnapshot = { ...synth };

    await claudeCodeProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "boot", message: "hi", env: synth });
    let log = readLog(logPath);
    check("behaviour 1: start adds exactly one record", log.length === 1, String(log.length));
    const startRec = log[0];
    if (startRec) {
      check("behaviour 1 start: bin is claude", startRec.bin === "claude", startRec.bin);
      check("behaviour 1 start: kind is turn", startRec.kind === "turn", startRec.kind);
      check("behaviour 1 start: argv form has no --resume", claudeForm(startRec.args).form === "start", JSON.stringify(startRec.args));
      checkProjection("behaviour 1 start", startRec, synth);
    }

    await claudeCodeProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture", message: "hi again", env: synth });
    log = readLog(logPath);
    check("behaviour 1: resume adds exactly one more record", log.length === 2, String(log.length));
    const resumeRec = log[1];
    if (resumeRec) {
      check("behaviour 1 resume: bin is claude", resumeRec.bin === "claude", resumeRec.bin);
      check("behaviour 1 resume: kind is turn", resumeRec.kind === "turn", resumeRec.kind);
      const form = claudeForm(resumeRec.args);
      check("behaviour 1 resume: argv is --resume sess-fixture", form.form === "resume" && form.resumeId === "sess-fixture", JSON.stringify(resumeRec.args));
      checkProjection("behaviour 1 resume", resumeRec, synth);
    }

    check("behaviour 1: SYNTH not mutated by start+resume", envDeepEqual(synth, synthSnapshot), diffNames(synth, synthSnapshot));
  }

  // ---- 2: claude's availability probe hands claude --version exactly the
  //         allowlist projection; process.env is not mutated -------------
  if (runs(2)) {
    const binDir = tmp("b2-bin");
    const homeDir = tmp("b2-home");
    const tmpDir = tmp("b2-tmp");
    const logPath = join(binDir, "log.jsonl");
    writeStub(binDir, "claude", claudeStubSource(logPath));
    const synth = buildSynth(binDir, homeDir, tmpDir);
    checkSynthGuards("behaviour 2", synth);

    const original = swapEnv(synth);
    try {
      const ok = await claudeCodeProfile.available();
      check("behaviour 2: available() returns true", ok === true, String(ok));
      const log = readLog(logPath);
      check("behaviour 2: exactly one record logged", log.length === 1, String(log.length));
      const rec = log[0];
      if (rec) {
        check("behaviour 2: bin is claude", rec.bin === "claude", rec.bin);
        check("behaviour 2: kind is version", rec.kind === "version", rec.kind);
        check("behaviour 2: argv is exactly [--version]", JSON.stringify(rec.args) === JSON.stringify(["--version"]), JSON.stringify(rec.args));
        checkProjection("behaviour 2", rec, synth);
      }
      check("behaviour 2: process.env still deep-equals SYNTH after the call", envDeepEqual(process.env, synth), diffNames(process.env, synth));
    } finally {
      restoreEnv(original);
    }
  }

  // ---- 3: the codex profile, all three spawns ----------------------------
  if (runs(3)) {
    const binDir = tmp("b3-bin");
    const homeDir = tmp("b3-home");
    const tmpDir = tmp("b3-tmp");
    const logPath = join(binDir, "log.jsonl");
    writeStub(binDir, "codex", codexStubSource(logPath));
    const synth = buildSynth(binDir, homeDir, tmpDir);
    checkSynthGuards("behaviour 3", synth);
    const synthSnapshot = { ...synth };

    await codexProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "", message: "hi", env: synth });
    let log = readLog(logPath);
    check("behaviour 3: start adds exactly one record", log.length === 1, String(log.length));
    let rec = log[0];
    if (rec) {
      check("behaviour 3 start: bin is codex", rec.bin === "codex", rec.bin);
      check("behaviour 3 start: kind is turn", rec.kind === "turn", rec.kind);
      const form = codexForm(rec.args);
      check("behaviour 3 start: argv begins exec, no resume", rec.args[0] === "exec" && form.form === "start", JSON.stringify(rec.args));
      checkProjection("behaviour 3 start", rec, synth);
    }

    await codexProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture-codex", message: "hi again", env: synth });
    log = readLog(logPath);
    check("behaviour 3: resume adds exactly one more record", log.length === 2, String(log.length));
    rec = log[1];
    if (rec) {
      check("behaviour 3 resume: bin is codex", rec.bin === "codex", rec.bin);
      check("behaviour 3 resume: kind is turn", rec.kind === "turn", rec.kind);
      const form = codexForm(rec.args);
      check(
        "behaviour 3 resume: argv begins exec resume sess-fixture-codex",
        form.form === "resume" && form.resumeId === "sess-fixture-codex",
        JSON.stringify(rec.args),
      );
      checkProjection("behaviour 3 resume", rec, synth);
    }

    check("behaviour 3: SYNTH not mutated by start+resume", envDeepEqual(synth, synthSnapshot), diffNames(synth, synthSnapshot));

    const original = swapEnv(synth);
    try {
      const ok = await codexProfile.available();
      check("behaviour 3: available() returns true", ok === true, String(ok));
      log = readLog(logPath);
      check("behaviour 3: available adds exactly one more record", log.length === 3, String(log.length));
      rec = log[2];
      if (rec) {
        check("behaviour 3 available: bin is codex", rec.bin === "codex", rec.bin);
        check("behaviour 3 available: kind is version", rec.kind === "version", rec.kind);
        check("behaviour 3 available: argv is exactly [--version]", JSON.stringify(rec.args) === JSON.stringify(["--version"]), JSON.stringify(rec.args));
        checkProjection("behaviour 3 available", rec, synth);
      }
      check("behaviour 3: process.env still deep-equals SYNTH after available()", envDeepEqual(process.env, synth), diffNames(process.env, synth));
    } finally {
      restoreEnv(original);
    }
  }

  // ---- 4: both talk entry points, and the unattended path, carry the
  //         scrub; tick still writes its dailies -------------------------
  if (runs(4)) {
    const binDir = tmp("b4-bin");
    const homeDir = tmp("b4-home");
    const tmpDir = tmp("b4-tmp");
    const studioDir = tmp("b4-studio");
    cpSync(sampleStudio, studioDir, { recursive: true });
    const logPath = join(binDir, "log.jsonl");
    writeStub(binDir, "claude", claudeStubSource(logPath));
    const synth = buildSynth(binDir, homeDir, tmpDir);
    checkSynthGuards("behaviour 4", synth);

    const original = swapEnv(synth);
    try {
      const first = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", studioDir, "hello"]);
      check("behaviour 4: first runTalk exit 0", first.exitCode === 0, String(first.exitCode));
      let log = readLog(logPath);
      const seg1 = log.slice(0, 2);
      check(
        "behaviour 4: first runTalk logs exactly [version, turn]",
        seg1.length === 2 && seg1[0]?.kind === "version" && seg1[1]?.kind === "turn",
        JSON.stringify(seg1.map((r) => r.kind)),
      );
      if (seg1[0]) {
        check("behaviour 4 first-call version: bin is claude", seg1[0].bin === "claude", seg1[0].bin);
        check("behaviour 4 first-call version: argv is exactly [--version]", JSON.stringify(seg1[0].args) === JSON.stringify(["--version"]), JSON.stringify(seg1[0].args));
        checkProjection("behaviour 4 first-call version", seg1[0], synth);
      }
      if (seg1[1]) {
        check("behaviour 4 first-call turn: is a claude start", claudeForm(seg1[1].args).form === "start", JSON.stringify(seg1[1].args));
        checkProjection("behaviour 4 first-call turn", seg1[1], synth);
      }

      const second = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", studioDir, "hello again"]);
      check("behaviour 4: second runTalk exit 0", second.exitCode === 0, String(second.exitCode));
      log = readLog(logPath);
      const seg2 = log.slice(2, 4);
      check(
        "behaviour 4: second runTalk logs exactly [version, turn]",
        seg2.length === 2 && seg2[0]?.kind === "version" && seg2[1]?.kind === "turn",
        JSON.stringify(seg2.map((r) => r.kind)),
      );
      if (seg2[0]) {
        check("behaviour 4 second-call version: bin is claude", seg2[0].bin === "claude", seg2[0].bin);
        checkProjection("behaviour 4 second-call version", seg2[0], synth);
      }
      if (seg2[1]) {
        const form = claudeForm(seg2[1].args);
        check("behaviour 4 second-call turn: is a claude resume of sess-w049", form.form === "resume" && form.resumeId === "sess-w049", JSON.stringify(seg2[1].args));
        checkProjection("behaviour 4 second-call turn", seg2[1], synth);
      }

      const before = readdirSync(join(studioDir, "acta"));
      const tickResult = await runTick(["--studio", studioDir], { now: NOW });
      check("behaviour 4: tick exit 0", tickResult.exitCode === 0, String(tickResult.exitCode));
      const after = readdirSync(join(studioDir, "acta"));
      const added = after.filter((f) => !before.includes(f));
      check("behaviour 4: tick writes one daily acta per due magister", added.length === 5, added.join(", "));

      log = readLog(logPath);
      const tickSeg = log.slice(4);
      check("behaviour 4: tick logs exactly one [version, turn] pair per due magister", tickSeg.length === added.length * 2, String(tickSeg.length));
      for (let i = 0; i < tickSeg.length; i += 2) {
        const versionRec = tickSeg[i];
        const turnRec = tickSeg[i + 1];
        const pair = i / 2;
        check(`behaviour 4 tick pair ${pair}: version then turn`, versionRec?.kind === "version" && turnRec?.kind === "turn", `${versionRec?.kind},${turnRec?.kind}`);
        if (versionRec) {
          check(`behaviour 4 tick pair ${pair}: version argv is exactly [--version]`, JSON.stringify(versionRec.args) === JSON.stringify(["--version"]), JSON.stringify(versionRec.args));
          checkProjection(`behaviour 4 tick pair ${pair} version`, versionRec, synth);
        }
        if (turnRec) {
          const form = claudeForm(turnRec.args);
          check(
            `behaviour 4 tick pair ${pair}: turn is a start, or a resume of sess-w049`,
            form.form === "start" || (form.form === "resume" && form.resumeId === "sess-w049"),
            JSON.stringify(turnRec.args),
          );
          checkProjection(`behaviour 4 tick pair ${pair} turn`, turnRec, synth);
        }
      }

      check("behaviour 4: process.env still deep-equals SYNTH after the whole flow", envDeepEqual(process.env, synth), diffNames(process.env, synth));
    } finally {
      restoreEnv(original);
    }
  }
} finally {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
