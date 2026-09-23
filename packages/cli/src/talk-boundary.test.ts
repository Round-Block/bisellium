/**
 * packages/cli/src/talk-boundary.test.ts — W-044 (briefs/W-044.md): the talk
 * profile is a permission boundary. `Bash(bisellium *)` used to admit the
 * whole CLI to anything a talked-to sella's harness could be made to run
 * (`run`/`red`'s arbitrary passthrough, the Patron-stamped
 * `answer`/`greenlight`/`budget`, git-moving `branch`/`merge`/`close`); this
 * file is the spec of the fix, written out literally rather than mirroring
 * `claude-code.ts`. It drives a stub `claude` (never the real vendor CLI)
 * that logs argv and never executes anything it's handed — evidence here is
 * string-level, never a working exploit.
 *
 * `BISELLIUM_ONLY_BEHAVIOUR` (comma-separated behaviour numbers) restricts
 * the run to those blocks — the red-capture harness (studio/ci/reds/W-044)
 * invokes this file directly per behaviour, same pattern as
 * lifecycle.test.ts.
 */
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeCodeProfile } from "@bisellium/shim";
import { runTalk } from "./talk.js";
import { runTick } from "./tick.js";
import { USAGE } from "./usage.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-23T09:00:00Z");

const only = process.env["BISELLIUM_ONLY_BEHAVIOUR"];
const selected = only ? new Set(only.split(",").map(Number)) : undefined;
const runs = (behaviour: number): boolean => selected === undefined || selected.has(behaviour);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(74)} ${detail}`);
  if (!ok) failed++;
};

// ---------------------------------------------------------------------------
// The expected policy — written out literally (the test is the spec, not a
// mirror of claude-code.ts).
// ---------------------------------------------------------------------------
const EXPECTED_TOOLS = ["Read", "Grep", "Glob", "Bash"];
const EXPECTED_ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(bisellium)",
  "Bash(bisellium context)",
  "Bash(bisellium context *)",
  "Bash(bisellium query)",
  "Bash(bisellium query *)",
  "Bash(bisellium check)",
  "Bash(bisellium check *)",
];
// ---------------------------------------------------------------------------
// argv parsing helpers — a logged argv is a flat string[], flags start with
// "-", and none of this profile's flag *values* (session ids, "dontAsk",
// tool names) do.
// ---------------------------------------------------------------------------

/** Every value from EVERY occurrence of `flag`, concatenated — a repeated
 * variadic flag (`--tools`, `--allowedTools`) merges on the installed vendor
 * CLI, so a caller judging "what does this admit" must see every group, not
 * just the first (F1, W-044 review round 1). */
function valuesAfterAll(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== flag) continue;
    for (let j = i + 1; j < argv.length && !argv[j]!.startsWith("-"); j++) out.push(argv[j]!);
  }
  return out;
}

/**
 * The conservative Bash-rule matcher (brief: "unrecognized rule shapes count
 * as admitting everything"):
 *  - `Bash(P)` with no `*` admits exactly `P`.
 *  - `Bash(P *)` admits `P` and anything starting with `P ` (a space).
 *  - anything else — bare `Bash`, a `*` in any other position, a `:` form —
 *    admits every command.
 */
function ruleAdmits(rule: string, cmd: string): boolean {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return true; // bare "Bash", or any shape that isn't "Bash(...)"
  const inner = m[1]!;
  if (inner.includes(":")) return true;
  const starIdx = inner.indexOf("*");
  if (starIdx === -1) return cmd === inner;
  if (starIdx === inner.length - 1 && inner[starIdx - 1] === " ") {
    const prefix = inner.slice(0, starIdx - 1);
    return cmd === prefix || cmd.startsWith(`${prefix} `);
  }
  return true; // "*" anywhere else — conservative: admits everything
}

function admits(allowedTools: string[], cmd: string): boolean {
  return allowedTools.filter((t) => t.startsWith("Bash")).some((r) => ruleAdmits(r, cmd));
}

// ---------------------------------------------------------------------------
// Verb universe: harvested from the USAGE banner (first token after
// "bisellium" on each line) plus one verb the CLI does not have.
// ---------------------------------------------------------------------------
function verbsFromUsage(usage: string): string[] {
  const verbs = new Set<string>();
  for (const line of usage.split("\n")) {
    const m = /\bbisellium\s+(\S+)/.exec(line);
    if (m) verbs.add(m[1]!);
  }
  return [...verbs];
}
const VERBS = verbsFromUsage(USAGE);
const FUTURE_VERB = "zz-future-verb";

// ---------------------------------------------------------------------------
// Stub `claude`: exits 0 on --version; on every other call, logs its own
// argv as one JSON line to the file named by TALK_STUB_LOG, and prints a
// normal JSON envelope. It never executes anything it's handed.
// filterEnv (@bisellium/shim) drops any env var name matching
// TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL — "TALK_STUB_LOG" matches none of
// those, so it survives talk.ts's env filtering into the child process.
// ---------------------------------------------------------------------------
const LOG_ENV = "TALK_STUB_LOG";
const CLAUDE_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
const logPath = process.env.${LOG_ENV};
if (logPath) appendFileSync(logPath, JSON.stringify(args) + "\\n");
process.stdout.write(
  JSON.stringify({ session_id: "sess-" + Math.random().toString(36).slice(2, 10), result: "ack", is_error: false, model: "stub" }) + "\\n",
);
process.exit(0);
`;

const binDir = mkdtempSync(join(tmpdir(), "bisellium-talk-boundary-bin-"));
function writeStub(): void {
  const p = join(binDir, "claude");
  writeFileSync(p, CLAUDE_STUB);
  chmodSync(p, 0o755);
}
writeStub();

function envFor(logPath: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${binDir}:${process.env["PATH"] ?? ""}`, [LOG_ENV]: logPath };
}

function readLog(logPath: string): string[][] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as string[]);
}

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-talk-boundary-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

/**
 * The full policy tail shared by `start` and `resume` — literal, in the
 * exact order claude-code.ts's POLICY_FLAGS emits it. Round-2 review (F2):
 * a first-VALUE read of a variadic flag (`valuesAfter(argv, "--tools")[0]`)
 * missed a second token appended inside the same `--tools` group; comparing
 * the whole argv literally is the one fix that also catches a stray token
 * after any other flag (F2's siblings, M11–M14).
 */
const POLICY_TAIL = [
  "--restricted",
  "--strict-mcp-config",
  "--permission-mode",
  "dontAsk",
  "--tools",
  EXPECTED_TOOLS.join(","),
  "--allowedTools",
  ...EXPECTED_ALLOWED_TOOLS,
];

/** The exact expected argv. The system-prompt temp file path (start) and the
 *  resume session id (resume) are the only tokens neither side can predict
 *  in advance — both are pulled from the actual argv at the fixed position
 *  claude-code.ts's header documents, so a widening or reordering anywhere
 *  else in the array still fails the deep-equality check below. */
function expectedStartArgv(sysPromptFile: string): string[] {
  return ["-p", "--output-format", "json", "--append-system-prompt-file", sysPromptFile, ...POLICY_TAIL];
}
function expectedResumeArgv(sessionId: string): string[] {
  return ["-p", "--resume", sessionId, "--output-format", "json", ...POLICY_TAIL];
}

/** Behaviour-1 style policy assertion against one logged argv: the argv
 *  deep-equals the literal expected array. */
function checkPolicy(name: string, argv: string[], form: "start" | "resume"): void {
  const expected = form === "start" ? expectedStartArgv(argv[4] ?? "") : expectedResumeArgv(argv[2] ?? "");
  check(`${name}: argv is exactly the ${form} policy`, JSON.stringify(argv) === JSON.stringify(expected), JSON.stringify(argv));
}

try {
  // ---- 1: the argv is the policy, on both start and resume ---------------
  if (runs(1)) {
    const logPath = join(binDir, "b1.jsonl");
    const env = envFor(logPath);
    await claudeCodeProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "boot", message: "hi", env });
    await claudeCodeProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture", message: "hi again", env });
    const [startArgv, resumeArgv] = readLog(logPath);
    check(
      "behaviour 1: two calls logged (start, resume)",
      startArgv !== undefined && resumeArgv !== undefined,
      JSON.stringify(readLog(logPath)),
    );
    if (startArgv) checkPolicy("behaviour 1 start", startArgv, "start");
    if (resumeArgv) checkPolicy("behaviour 1 resume", resumeArgv, "resume");
  }

  // ---- 2: every existing CLI verb outside {context, query, check} denied -
  if (runs(2)) {
    check(
      "behaviour 2 guard: derived verb universe contains run/red/greenlight/answer/budget/talk/tick/providers",
      ["run", "red", "greenlight", "answer", "budget", "talk", "tick", "providers"].every((v) => VERBS.includes(v)),
      VERBS.join(","),
    );
    for (const form of ["start", "resume"] as const) {
      const logPath = join(binDir, `b2-${form}.jsonl`);
      const env = envFor(logPath);
      if (form === "start") await claudeCodeProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "boot", message: "hi", env });
      else await claudeCodeProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture", message: "hi", env });
      const [argv] = readLog(logPath);
      if (!argv) {
        check(`behaviour 2 ${form}: argv logged`, false);
        continue;
      }
      const allowed = valuesAfterAll(argv, "--allowedTools");
      for (const v of VERBS) {
        const expectAdmit = v === "context" || v === "query" || v === "check";
        check(
          `behaviour 2 ${form}: bisellium ${v} ${expectAdmit ? "admitted" : "denied"}`,
          admits(allowed, `bisellium ${v}`) === expectAdmit,
        );
        check(
          `behaviour 2 ${form}: bisellium ${v} --probe x ${expectAdmit ? "admitted" : "denied"}`,
          admits(allowed, `bisellium ${v} --probe x`) === expectAdmit,
        );
      }
      check(`behaviour 2 ${form}: bare bisellium admitted`, admits(allowed, "bisellium"));
    }
  }

  // ---- 3: a verb the CLI does not have yet is denied ----------------------
  if (runs(3)) {
    for (const form of ["start", "resume"] as const) {
      const logPath = join(binDir, `b3-${form}.jsonl`);
      const env = envFor(logPath);
      if (form === "start") await claudeCodeProfile.start({ cwd: repo, sella: "eng-lead", systemPrompt: "boot", message: "hi", env });
      else await claudeCodeProfile.resume({ cwd: repo, sella: "eng-lead", sessionId: "sess-fixture", message: "hi", env });
      const [argv] = readLog(logPath);
      if (!argv) {
        check(`behaviour 3 ${form}: argv logged`, false);
        continue;
      }
      const allowed = valuesAfterAll(argv, "--allowedTools");
      check(`behaviour 3 ${form}: bisellium ${FUTURE_VERB} denied`, !admits(allowed, `bisellium ${FUTURE_VERB}`));
      check(`behaviour 3 ${form}: bisellium ${FUTURE_VERB} --probe x denied`, !admits(allowed, `bisellium ${FUTURE_VERB} --probe x`));
    }
  }

  // ---- 4: both talk entry points carry the policy; tick still writes -----
  if (runs(4)) {
    const dir = freshStudio("b4");
    const logPath = join(binDir, "b4.jsonl");
    const origPath = process.env["PATH"];
    const origLog = process.env[LOG_ENV];
    process.env["PATH"] = `${binDir}:${origPath ?? ""}`;
    process.env[LOG_ENV] = logPath;
    try {
      const first = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]);
      check("behaviour 4: first runTalk call exit 0", first.exitCode === 0, String(first.exitCode));
      const second = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello again"]);
      check("behaviour 4: second runTalk call exit 0", second.exitCode === 0, String(second.exitCode));

      const talkLog = readLog(logPath);
      check("behaviour 4: two talk calls logged", talkLog.length === 2, String(talkLog.length));
      if (talkLog.length === 2) {
        check("behaviour 4: first call has no --resume (start)", !talkLog[0]!.includes("--resume"));
        check("behaviour 4: second call carries --resume", talkLog[1]!.includes("--resume"));
        checkPolicy("behaviour 4 talk start", talkLog[0]!, "start");
        checkPolicy("behaviour 4 talk resume", talkLog[1]!, "resume");
      }

      const before = readdirSync(join(dir, "acta"));
      const tickResult = await runTick(["--studio", dir], { now: NOW });
      check("behaviour 4: tick exit 0", tickResult.exitCode === 0, String(tickResult.exitCode));
      const after = readdirSync(join(dir, "acta"));
      const added = after.filter((f) => !before.includes(f));
      check("behaviour 4: tick writes one daily acta per due magister", added.length === 5, added.join(", "));

      const tickLog = readLog(logPath).slice(2);
      check("behaviour 4: tick logged one call per due magister", tickLog.length === 5, String(tickLog.length));
      for (const argv of tickLog) checkPolicy("behaviour 4 tick call", argv, argv.includes("--resume") ? "resume" : "start");
    } finally {
      if (origPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = origPath;
      if (origLog === undefined) delete process.env[LOG_ENV];
      else process.env[LOG_ENV] = origLog;
    }
  }
} finally {
  rmSync(binDir, { recursive: true, force: true });
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
