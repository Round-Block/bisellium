/**
 * packages/cli/src/provider-portability.test.ts — W-046 (studio/briefs/
 * W-046.md): the decreed model (`sellae[].model`) travels from the manifest
 * through `performTalk` into both vendor profiles, and the codex profile
 * gains a command policy of its own. Eight behaviours (7 and 8 added by the
 * censor's round-1 review, F-1/F-2; 7 re-specced by round 2's review, F-4 —
 * the count stays eight), driven against a temp copy of
 * `examples/sample-studio` (`eng-lead` there is `claude-opus-5`, `art-lead`
 * is `gpt-6-astra` — a mismatch on the default claude-code harness, used by
 * behaviour 7) through stub `claude`/`codex` binaries that log their own
 * argv, stdin and cwd and never execute what they're handed — evidence here
 * is string-level, never a working vendor call.
 *
 * Imports only what exists at HEAD. `claudeCodeProfile`/`codexProfile` are
 * used directly by behaviour 7's spawn-failure scenarios (D/E, round 3):
 * PATH resolution happens before argv is looked at, so no stub file can
 * fail a real turn's spawn without failing `--version` identically — there
 * is no shape that makes `available()` succeed and the real spawn fail.
 * Instead, a thin wrapper whose `available()` always answers true and whose
 * `start`/`resume` delegate to the real profile with a PATH pointed at
 * nothing runs the REAL profile code and produces the REAL
 * `Turn.raw = { error }` shape, through `runTalk`'s `harnesses` override —
 * an intended test seam, not a race. Every red here is still
 * assertion-level, never a module-load error.
 *
 * `BISELLIUM_ONLY_BEHAVIOUR` (comma-separated behaviour numbers) restricts
 * the run to those blocks — same pattern as lifecycle.test.ts and
 * talk-boundary.test.ts, since each behaviour's red is recorded from its own
 * single-behaviour run.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeCodeProfile, codexProfile } from "@bisellium/shim";
import { runTalk } from "./talk.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");

const only = process.env["BISELLIUM_ONLY_BEHAVIOUR"];
const selected = only ? new Set(only.split(",").map(Number)) : undefined;
const runs = (behaviour: number): boolean => selected === undefined || selected.has(behaviour);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshFixture(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w046-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}
function tmpBinDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w046-${tag}-bin-`));
  dirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// The expected claude policy — written out literally (the test is the spec,
// not a mirror of claude-code.ts). Mirrors talk-boundary.test.ts's W-044
// literals, since behaviour 1 asserts the model slot lands inside that same
// policy, not instead of it.
// ---------------------------------------------------------------------------
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
const CLAUDE_POLICY_TAIL = ["--restricted", "--strict-mcp-config", "--permission-mode", "dontAsk", "--tools", "Read,Grep,Glob,Bash", "--allowedTools", ...EXPECTED_ALLOWED_TOOLS];

function claudeStartFile(argv: string[]): string {
  const idx = argv.indexOf("--append-system-prompt-file");
  return idx === -1 ? "" : (argv[idx + 1] ?? "");
}
function expectedClaudeStart(file: string, model: string): string[] {
  return ["-p", "--output-format", "json", "--model", model, "--append-system-prompt-file", file, ...CLAUDE_POLICY_TAIL];
}
function expectedClaudeResume(sessionId: string, model: string): string[] {
  return ["-p", "--resume", sessionId, "--output-format", "json", "--model", model, ...CLAUDE_POLICY_TAIL];
}

// ---------------------------------------------------------------------------
// The expected codex policy — written out literally, exactly as the brief's
// Interfaces section specifies it (this is the spec, not a mirror of
// codex.ts).
// ---------------------------------------------------------------------------
const CODEX_POLICY = [
  "--json",
  "--skip-git-repo-check",
  "--ignore-user-config",
  "--ignore-rules",
  "-c",
  "sandbox_mode=read-only",
  "-c",
  "model_provider=openai",
  "--disable",
  "browser_use",
  "--disable",
  "browser_use_external",
  "--disable",
  "browser_use_full_cdp_access",
  "--disable",
  "in_app_browser",
  "--disable",
  "apps",
  "--disable",
  "plugins",
  "--disable",
  "remote_plugin",
  "--disable",
  "plugin_sharing",
];
function expectedCodexStart(model: string): string[] {
  return ["exec", ...CODEX_POLICY, "-m", model, "-"];
}
function expectedCodexResume(sessionId: string, model: string): string[] {
  return ["exec", "resume", sessionId, ...CODEX_POLICY, "-m", model, "-"];
}
function checkCodexSafety(name: string, rec: LogRecord, expectedCwd: string, message: string): void {
  check(`${name}: no token is -C or --cd`, !rec.args.includes("-C") && !rec.args.includes("--cd"), rec.args.join(" "));
  check(`${name}: no token starts with --dangerously-bypass`, !rec.args.some((t) => t.startsWith("--dangerously-bypass")), rec.args.join(" "));
  check(`${name}: logged cwd is the studio root`, resolve(rec.cwd) === resolve(expectedCwd), rec.cwd);
  check(`${name}: logged stdin is non-empty and ends with the message`, rec.stdin.length > 0 && rec.stdin.endsWith(message), JSON.stringify(rec.stdin.slice(-120)));
}

// ---------------------------------------------------------------------------
// Stubs — never execute what they're handed. Each exits 0 on --version/-V;
// on every other call it appends one JSON line — {bin, args, stdin, cwd} —
// to a log path baked into the stub's own source text (never an env var,
// which W-049 scrubs), then prints a canned envelope. Fidelity mirrors two
// measured vendor refusals: codex `resume` rejects `-s`/`--sandbox`/`-C`/
// `--cd`, and claude rejects a non-claude `--model`.
// ---------------------------------------------------------------------------
interface LogRecord {
  bin: string;
  args: string[];
  stdin: string;
  cwd: string;
  sysPromptContent?: string | null;
}

function readLog(logPath: string): LogRecord[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LogRecord);
}

const READ_STDIN = `function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}`;

function claudeStubSource(
  logPath: string,
  opts: { reply?: string; model?: string; sessionId?: string; failStderr?: string; envelopeOwnStderr?: string } = {},
): string {
  const reply = opts.reply ?? "ack";
  const model = opts.model ?? "claude-opus-5-20260101";
  const sessionId = opts.sessionId ?? "sess-w046";
  return `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
${READ_STDIN}
const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) process.exit(0);
${opts.failStderr !== undefined ? `await readStdin();\nprocess.stderr.write(${JSON.stringify(opts.failStderr)} + "\\n");\nprocess.exit(1);\n` : ""}
${
  opts.envelopeOwnStderr !== undefined
    ? `await readStdin();
// A hypothetical future vendor envelope that ships its OWN "stderr" field
// (round-3 mutation R5: the capture guard must never overwrite this with
// the real process stderr, which carries a deliberately different string).
process.stdout.write(JSON.stringify({ session_id: ${JSON.stringify(sessionId)}, is_error: true, api_error_status: 500, result: "synthetic failure", stderr: ${JSON.stringify(opts.envelopeOwnStderr)} }) + "\\n");
process.stderr.write("REAL-PROCESS-STDERR-MUST-NOT-APPEAR\\n");
process.exit(1);
`
    : ""
}
const modelIdx = args.indexOf("--model");
const requestedModel = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
if (requestedModel !== undefined && !requestedModel.startsWith("claude-")) {
  // The real vendor's MEASURED shape (censor round 2, F-4, re-measured by
  // the architect on claude 2.1.280 with streams separated): a VALID,
  // PARSEABLE envelope on stdout (is_error true, api_error_status 404,
  // subtype "success", no "error" key, the cause in "result") AND a
  // separate stderr line — never "nothing on stdout" (round 2's stub
  // shape, which is why F-4 passed review).
  await readStdin();
  process.stdout.write(
    JSON.stringify({
      session_id: "sess-w046",
      is_error: true,
      api_error_status: 404,
      subtype: "success",
      result:
        "There's an issue with the selected model (" +
        requestedModel +
        "). It may not exist or you may not have access to it. Run --model to pick a different model.",
    }) + "\\n",
  );
  process.stderr.write("[claude-code:unrecognized_model] " + JSON.stringify({ model: requestedModel, query_source: "sdk" }) + "\\n");
  process.exit(1);
}
const fileIdx = args.indexOf("--append-system-prompt-file");
const sysPromptContent = fileIdx !== -1 ? readFileSync(args[fileIdx + 1], "utf8") : null;
const stdin = await readStdin();
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ bin: "claude", args, stdin, cwd: process.cwd(), sysPromptContent }) + "\\n");
process.stdout.write(JSON.stringify({ session_id: ${JSON.stringify(sessionId)}, result: ${JSON.stringify(reply)}, is_error: false, model: ${JSON.stringify(model)} }) + "\\n");
process.exit(0);
`;
}

function codexStubSource(
  logPath: string,
  opts: { includeAgentMessage?: boolean; sessionId?: string; reply?: string; failStderr?: string } = {},
): string {
  const includeAgentMessage = opts.includeAgentMessage ?? true;
  const sessionId = opts.sessionId ?? "thr-w046";
  const reply = opts.reply ?? "ack";
  const agentLine = includeAgentMessage
    ? `process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: ${JSON.stringify(reply)} } }) + "\\n");`
    : "";
  return `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
${READ_STDIN}
const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--version" || args[0] === "-V")) process.exit(0);
const isResume = args[0] === "exec" && args[1] === "resume";
if (isResume && (args.includes("-s") || args.includes("--sandbox") || args.includes("-C") || args.includes("--cd"))) {
  await readStdin();
  process.stderr.write("error: unexpected argument found\\n");
  process.exit(2);
}
${opts.failStderr !== undefined ? `await readStdin();\nprocess.stderr.write(${JSON.stringify(opts.failStderr)} + "\\n");\nprocess.exit(1);\n` : ""}
const stdin = await readStdin();
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ bin: "codex", args, stdin, cwd: process.cwd() }) + "\\n");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: ${JSON.stringify(sessionId)} }) + "\\n");
${agentLine}
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }) + "\\n");
process.exit(0);
`;
}

function writeStub(binDir: string, name: string, source: string): void {
  const p = join(binDir, name);
  writeFileSync(p, source);
  chmodSync(p, 0o755);
}

function withPath(binDir: string, fn: () => Promise<void>): Promise<void> {
  const orig = process.env["PATH"];
  process.env["PATH"] = `${binDir}:${orig ?? ""}`;
  return fn().finally(() => {
    if (orig === undefined) delete process.env["PATH"];
    else process.env["PATH"] = orig;
  });
}

async function withCapturedStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const orig = console.error;
  let out = "";
  console.error = (...args: unknown[]) => {
    out += args.map(String).join(" ") + "\n";
  };
  try {
    const result = await fn();
    return { result, stderr: out };
  } finally {
    console.error = orig;
  }
}

function readTimeline(dir: string, sella: string): Array<Record<string, unknown>> {
  const p = join(dir, "timeline", `${sella}.jsonl`);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function extractSection(doc: string, heading: string): string {
  const lines = doc.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.trim() === heading);
  if (startIdx === -1) return "";
  const rest = lines.slice(startIdx + 1);
  const endOffset = rest.findIndex((l) => /^##\s/.test(l));
  return (endOffset === -1 ? rest : rest.slice(0, endOffset)).join("\n");
}

/** The file's leading `/** ... *\/` block comment (behaviour 8: codex.ts's
 *  header, where the signed limit lives), with each line's `* ` JSDoc
 *  continuation marker stripped — left in, a phrase that wraps across
 *  comment lines picks up a stray "*" splitting it (e.g. "in-app-browser,
 *  apps" becomes "in-app-browser, * apps"), which would corrupt exactly the
 *  literal-substring matching this behaviour depends on. */
function extractHeaderComment(source: string): string {
  const start = source.indexOf("/**");
  if (start === -1) return "";
  const end = source.indexOf("*/", start);
  const raw = end === -1 ? source.slice(start) : source.slice(start, end);
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n");
}

try {
  // ---- 1: claude session spawns carry the decreed model, right slot -------
  if (runs(1)) {
    const dir = freshFixture("b1");
    const binDir = tmpBinDir("b1");
    const logPath = join(binDir, "log.jsonl");
    writeStub(binDir, "claude", claudeStubSource(logPath));
    await withPath(binDir, async () => {
      const first = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]);
      check("behaviour 1: first runTalk call exit 0", first.exitCode === 0, String(first.exitCode));
      const second = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello again"]);
      check("behaviour 1: second runTalk call exit 0", second.exitCode === 0, String(second.exitCode));

      const log = readLog(logPath);
      check("behaviour 1: two calls logged (start, resume)", log.length === 2, String(log.length));
      const [startRec, resumeRec] = log;
      if (startRec) {
        const file = claudeStartFile(startRec.args);
        const expected = expectedClaudeStart(file, "claude-opus-5");
        check("behaviour 1 start: argv deep-equals the expected policy with --model", JSON.stringify(startRec.args) === JSON.stringify(expected), JSON.stringify(startRec.args));
        const modelIdx = startRec.args.indexOf("--model");
        const allowedIdx = startRec.args.indexOf("--allowedTools");
        check(
          "behaviour 1 start: index of --model is lower than index of --allowedTools",
          modelIdx !== -1 && allowedIdx !== -1 && modelIdx < allowedIdx,
          `${modelIdx} vs ${allowedIdx}`,
        );
        const tail = startRec.args.slice(allowedIdx + 1);
        check("behaviour 1 start: --allowedTools is terminal with exactly W-044's ten values", JSON.stringify(tail) === JSON.stringify(EXPECTED_ALLOWED_TOOLS), JSON.stringify(tail));
      } else check("behaviour 1 start: argv logged", false);
      if (resumeRec) {
        const expected = expectedClaudeResume("sess-w046", "claude-opus-5");
        check("behaviour 1 resume: argv deep-equals the expected policy with --model", JSON.stringify(resumeRec.args) === JSON.stringify(expected), JSON.stringify(resumeRec.args));
        const modelIdx = resumeRec.args.indexOf("--model");
        const allowedIdx = resumeRec.args.indexOf("--allowedTools");
        check(
          "behaviour 1 resume: index of --model is lower than index of --allowedTools",
          modelIdx !== -1 && allowedIdx !== -1 && modelIdx < allowedIdx,
          `${modelIdx} vs ${allowedIdx}`,
        );
        const tail = resumeRec.args.slice(allowedIdx + 1);
        check("behaviour 1 resume: --allowedTools is terminal with exactly W-044's ten values", JSON.stringify(tail) === JSON.stringify(EXPECTED_ALLOWED_TOOLS), JSON.stringify(tail));
      } else check("behaviour 1 resume: argv logged", false);
    });
  }

  // ---- 2: codex session spawns carry the decreed model and the policy -----
  if (runs(2)) {
    const dir = freshFixture("b2");
    const binDir = tmpBinDir("b2");
    const logPath = join(binDir, "log.jsonl");
    writeStub(binDir, "codex", codexStubSource(logPath));
    await withPath(binDir, async () => {
      const first = await runTalk(["--sella", "eng-lead", "--harness", "codex", "--model-only", "--studio", dir, "hello"]);
      check("behaviour 2: first runTalk call exit 0", first.exitCode === 0, String(first.exitCode));
      const second = await runTalk(["--sella", "eng-lead", "--harness", "codex", "--model-only", "--studio", dir, "hello again"]);
      check("behaviour 2: second runTalk call exit 0", second.exitCode === 0, String(second.exitCode));

      const log = readLog(logPath);
      check("behaviour 2: two calls logged (start, resume)", log.length === 2, String(log.length));
      const [startRec, resumeRec] = log;
      if (startRec) {
        const expected = expectedCodexStart("claude-opus-5");
        check("behaviour 2 start: argv deep-equals exec + POLICY + -m + -", JSON.stringify(startRec.args) === JSON.stringify(expected), JSON.stringify(startRec.args));
        checkCodexSafety("behaviour 2 start", startRec, dir, "hello");
      } else check("behaviour 2 start: argv logged", false);
      if (resumeRec) {
        const expected = expectedCodexResume("thr-w046", "claude-opus-5");
        check("behaviour 2 resume: argv deep-equals exec resume + POLICY + -m + -", JSON.stringify(resumeRec.args) === JSON.stringify(expected), JSON.stringify(resumeRec.args));
        checkCodexSafety("behaviour 2 resume", resumeRec, dir, "hello again");
      } else check("behaviour 2 resume: argv logged", false);
    });
  }

  // ---- 3: exit 0 with an empty reply is a failure; nothing is persisted ---
  if (runs(3)) {
    // claude half
    {
      const dir = freshFixture("b3-claude");
      const binDir = tmpBinDir("b3-claude");
      writeStub(binDir, "claude", claudeStubSource(join(binDir, "log.jsonl"), { reply: "" }));
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() => runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]));
        check("behaviour 3 claude: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 3 claude: no sessions/eng-lead.json", !existsSync(join(dir, "sessions", "eng-lead.json")));
        check("behaviour 3 claude: no timeline/eng-lead.jsonl", !existsSync(join(dir, "timeline", "eng-lead.jsonl")));
        const receiptsDir = join(dir, "receipts", "eng-lead");
        const noReceipts = !existsSync(receiptsDir) || readdirSync(receiptsDir).length === 0;
        check("behaviour 3 claude: no receipt under receipts/eng-lead/", noReceipts, existsSync(receiptsDir) ? readdirSync(receiptsDir).join(",") : "(no dir)");
        check("behaviour 3 claude: stderr names the sella", stderr.includes("eng-lead"), stderr);
        check("behaviour 3 claude: stderr names the harness", stderr.includes("claude-code"), stderr);
        check("behaviour 3 claude: stderr names the requested model", stderr.includes("claude-opus-5"), stderr);
      });
    }
    // codex half
    {
      const dir = freshFixture("b3-codex");
      const binDir = tmpBinDir("b3-codex");
      writeStub(binDir, "codex", codexStubSource(join(binDir, "log.jsonl"), { includeAgentMessage: false }));
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() =>
          runTalk(["--sella", "eng-lead", "--harness", "codex", "--model-only", "--studio", dir, "hello"]),
        );
        check("behaviour 3 codex: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 3 codex: no sessions/eng-lead.json", !existsSync(join(dir, "sessions", "eng-lead.json")));
        check("behaviour 3 codex: no timeline/eng-lead.jsonl", !existsSync(join(dir, "timeline", "eng-lead.jsonl")));
        const receiptsDir = join(dir, "receipts", "eng-lead");
        const noReceipts = !existsSync(receiptsDir) || readdirSync(receiptsDir).length === 0;
        check("behaviour 3 codex: no receipt under receipts/eng-lead/", noReceipts, existsSync(receiptsDir) ? readdirSync(receiptsDir).join(",") : "(no dir)");
        check("behaviour 3 codex: stderr names the sella", stderr.includes("eng-lead"), stderr);
        check("behaviour 3 codex: stderr names the harness", stderr.includes("codex"), stderr);
        check("behaviour 3 codex: stderr names the requested model", stderr.includes("claude-opus-5"), stderr);
      });
    }
  }

  // ---- 4: the decreed model is what the timeline records; vendor wins -----
  if (runs(4)) {
    // codex half: no vendor-echoed model anywhere -> out.model is the request
    {
      const dir = freshFixture("b4-codex");
      const binDir = tmpBinDir("b4-codex");
      writeStub(binDir, "codex", codexStubSource(join(binDir, "log.jsonl")));
      await withPath(binDir, async () => {
        const result = await runTalk(["--sella", "eng-lead", "--harness", "codex", "--model-only", "--studio", dir, "hello"]);
        check("behaviour 4 codex: runTalk exit 0", result.exitCode === 0, String(result.exitCode));
        const lines = readTimeline(dir, "eng-lead");
        check("behaviour 4 codex: two timeline lines", lines.length === 2, String(lines.length));
        const [inEntry, outEntry] = lines;
        check("behaviour 4 codex: in entry carries no model", inEntry !== undefined && !("model" in inEntry), JSON.stringify(inEntry));
        check("behaviour 4 codex: out entry model is the requested model (vendor echoed none)", outEntry?.["model"] === "claude-opus-5", JSON.stringify(outEntry));
      });
    }
    // claude half: vendor echoes a model -> out.model is the vendor's answer
    {
      const dir = freshFixture("b4-claude");
      const binDir = tmpBinDir("b4-claude");
      writeStub(binDir, "claude", claudeStubSource(join(binDir, "log.jsonl")));
      await withPath(binDir, async () => {
        const result = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]);
        check("behaviour 4 claude: runTalk exit 0", result.exitCode === 0, String(result.exitCode));
        const lines = readTimeline(dir, "eng-lead");
        check("behaviour 4 claude: two timeline lines", lines.length === 2, String(lines.length));
        const [inEntry, outEntry] = lines;
        check("behaviour 4 claude: in entry carries no model", inEntry !== undefined && !("model" in inEntry), JSON.stringify(inEntry));
        check("behaviour 4 claude: out entry model is the vendor-echoed model, not the request", outEntry?.["model"] === "claude-opus-5-20260101", JSON.stringify(outEntry));
      });
    }
  }

  // ---- 5: one fixture sella, a talk turn on each harness, in one run ------
  if (runs(5)) {
    const dir = freshFixture("b5");
    const binDir = tmpBinDir("b5");
    const logPath = join(binDir, "log.jsonl");
    writeStub(binDir, "claude", claudeStubSource(logPath));
    writeStub(binDir, "codex", codexStubSource(logPath));
    await withPath(binDir, async () => {
      const claudeResult = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]);
      check("behaviour 5: claude call exit 0", claudeResult.exitCode === 0, String(claudeResult.exitCode));
      const codexResult = await runTalk(["--sella", "eng-lead", "--harness", "codex", "--model-only", "--studio", dir, "hello again"]);
      check("behaviour 5: codex call exit 0", codexResult.exitCode === 0, String(codexResult.exitCode));

      const log = readLog(logPath);
      check("behaviour 5: two calls logged", log.length === 2, String(log.length));
      const [claudeRec, codexRec] = log;

      const sessionPath = join(dir, "sessions", "eng-lead.json");
      if (existsSync(sessionPath)) {
        const session = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<string, unknown>;
        check("behaviour 5: session ends pinned to codex", session["harness"] === "codex", JSON.stringify(session));
        check("behaviour 5: session sessionId is thr-w046", session["sessionId"] === "thr-w046", JSON.stringify(session));
        check("behaviour 5: session turns is 1 (harness switch restarted)", session["turns"] === 1, JSON.stringify(session));
      } else {
        check("behaviour 5: session file exists", false);
      }

      const lines = readTimeline(dir, "eng-lead");
      check("behaviour 5: exactly four timeline lines", lines.length === 4, String(lines.length));
      const outLines = lines.filter((l) => l["direction"] === "out");
      check("behaviour 5: two out lines", outLines.length === 2, String(outLines.length));
      check("behaviour 5: first out line model is the claude vendor echo", outLines[0]?.["model"] === "claude-opus-5-20260101", JSON.stringify(outLines[0]));
      check("behaviour 5: second out line model is the requested model (codex echoes none)", outLines[1]?.["model"] === "claude-opus-5", JSON.stringify(outLines[1]));

      const receiptsDir = join(dir, "receipts", "eng-lead");
      const receiptFiles = existsSync(receiptsDir) ? readdirSync(receiptsDir) : [];
      check("behaviour 5: exactly two receipts", receiptFiles.length === 2, receiptFiles.join(","));
      const receipts = receiptFiles.map((f) => JSON.parse(readFileSync(join(receiptsDir, f), "utf8")) as Record<string, unknown>);
      const harnesses = receipts.map((r) => r["harness"]).sort();
      check("behaviour 5: receipts name each harness", JSON.stringify(harnesses) === JSON.stringify(["claude-code", "codex"]), JSON.stringify(harnesses));

      if (claudeRec) {
        const bundleLines = (claudeRec.sysPromptContent ?? "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        const firstLine = bundleLines[0];
        check("behaviour 5: claude call's system-prompt file carried a non-empty boot bundle line", typeof firstLine === "string" && firstLine.length > 0, JSON.stringify(firstLine));
        if (codexRec && typeof firstLine === "string") {
          check("behaviour 5: codex call's stdin carries the same boot-bundle line", codexRec.stdin.includes(firstLine), JSON.stringify(firstLine));
        } else check("behaviour 5: codex call logged (to compare stdin against)", false);

        const file = claudeStartFile(claudeRec.args);
        const expectedClaude = expectedClaudeStart(file, "claude-opus-5");
        check("behaviour 5: claude argv carries its own harness's model and policy", JSON.stringify(claudeRec.args) === JSON.stringify(expectedClaude), JSON.stringify(claudeRec.args));
      } else check("behaviour 5: claude call logged", false);

      if (codexRec) {
        const expectedCodex = expectedCodexStart("claude-opus-5");
        check("behaviour 5: codex argv carries its own harness's model and policy", JSON.stringify(codexRec.args) === JSON.stringify(expectedCodex), JSON.stringify(codexRec.args));
      } else check("behaviour 5: codex call logged", false);
    });
  }

  // ---- 6: the documented contract names the codex policy and its limits --
  if (runs(6)) {
    const doc = readFileSync(join(repo, "docs", "ADOPTION.md"), "utf8");
    // Prose is hard-wrapped at ~80 columns, so a literal can straddle a line
    // break (a newline where prose would render a plain space) — collapse
    // whitespace before matching so a check names a genuinely missing claim,
    // never a mid-phrase wrap.
    const section = extractSection(doc, "## Running talk").replace(/\s+/g, " ");
    check("behaviour 6: 'Running talk' section found", section.length > 0);

    const items: [string, string][] = [
      ["policy token --ignore-user-config present", "--ignore-user-config"],
      ["policy token --ignore-rules present", "--ignore-rules"],
      ["policy token sandbox_mode=read-only present", "sandbox_mode=read-only"],
      ["policy token model_provider=openai present", "model_provider=openai"],
      ["--disable browser_use present", "--disable browser_use"],
      ["--disable browser_use_external present", "--disable browser_use_external"],
      ["--disable browser_use_full_cdp_access present", "--disable browser_use_full_cdp_access"],
      ["--disable in_app_browser present", "--disable in_app_browser"],
      ["--disable apps present", "--disable apps"],
      ["--disable plugins present", "--disable plugins"],
      ["--disable remote_plugin present", "--disable remote_plugin"],
      ["--disable plugin_sharing present", "--disable plugin_sharing"],
      ["decreed model source sellae[].model named", "sellae[].model"],
      ["talk has no --model flag, stated", "no `--model` flag"],
      ["codex policy stated not equivalent to claude's", "not equivalent to the claude profile"],
      ["residual: no tool allowlist named", "no tool allowlist"],
      ["residual: unbounded reads named", "unbounded reads"],
      ["residual: AGENTS.md still loads named", "AGENTS.md still loads"],
      ["residual: configuration channels beyond user config unmeasured named", "configuration channels beyond the user config file"],
      ["codex auth location named", "$HOME/.codex/auth.json"],
      ["CODEX_HOME not passed named", "CODEX_HOME"],
      ["OPENAI_API_KEY not passed named", "OPENAI_API_KEY"],
    ];
    const sectionLower = section.toLowerCase();
    for (const [name, needle] of items) check(`behaviour 6: ${name}`, sectionLower.includes(needle.toLowerCase()), needle);
  }

  // ---- 7: a failed turn's message carries the vendor's own diagnostic -----
  // (round 2, censor F-2). Each scenario its own fresh fixture and stub dir.
  if (runs(7)) {
    function assertNothingPersisted(label: string, dir: string, sella: string): void {
      check(`${label}: no sessions/${sella}.json`, !existsSync(join(dir, "sessions", `${sella}.json`)));
      check(`${label}: no timeline/${sella}.jsonl`, !existsSync(join(dir, "timeline", `${sella}.jsonl`)));
      const receiptsDir = join(dir, "receipts", sella);
      const noReceipts = !existsSync(receiptsDir) || readdirSync(receiptsDir).length === 0;
      check(`${label}: no receipt under receipts/${sella}/`, noReceipts, existsSync(receiptsDir) ? readdirSync(receiptsDir).join(",") : "(no dir)");
    }
    function seedSession(dir: string, sella: string, harness: string, sessionId: string): void {
      const sessDir = join(dir, "sessions");
      mkdirSync(sessDir, { recursive: true });
      const now = new Date().toISOString();
      writeFileSync(join(sessDir, `${sella}.json`), JSON.stringify({ harness, sessionId, startedAt: now, lastAt: now, turns: 1 }, null, 2) + "\n");
    }

    // Scenario A — claude, real vendor literal: a mismatched model
    // (art-lead's fixture model gpt-6-astra can't run on the default
    // claude-code harness), driven through the start path.
    {
      const dir = freshFixture("b7-claude-model");
      const binDir = tmpBinDir("b7-claude-model");
      writeStub(binDir, "claude", claudeStubSource(join(binDir, "log.jsonl")));
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() => runTalk(["--sella", "art-lead", "--model-only", "--studio", dir, "hello"]));
        check("behaviour 7 claude-model: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 7 claude-model: stderr names the sella", stderr.includes("art-lead"), stderr);
        check("behaviour 7 claude-model: stderr names the harness", stderr.includes("claude-code"), stderr);
        check("behaviour 7 claude-model: stderr names the requested model", stderr.includes("gpt-6-astra"), stderr);
        // Re-specced, round 3 (F-4b): the real vendor emits BOTH a parseable
        // envelope (result sentence) and a stderr line, and both are useful
        // — the seam must carry both, not just whichever one used to be
        // reachable through the old (unmeasured) stub shape.
        check(
          "behaviour 7 claude-model: message carries a substring of the envelope's own result sentence",
          stderr.includes("issue with the selected model"),
          stderr,
        );
        check(
          "behaviour 7 claude-model: message carries a substring of the vendor's stderr line",
          stderr.includes("unrecognized_model"),
          stderr,
        );
        assertNothingPersisted("behaviour 7 claude-model", dir, "art-lead");
      });
    }

    // Scenario B — codex, real vendor literal: a bad model provider, driven
    // through the start path.
    {
      const dir = freshFixture("b7-codex-provider");
      const binDir = tmpBinDir("b7-codex-provider");
      writeStub(binDir, "codex", codexStubSource(join(binDir, "log.jsonl"), { failStderr: "Error: Model provider `zzbogus` not found" }));
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() =>
          runTalk(["--sella", "eng-lead", "--harness", "codex", "--model-only", "--studio", dir, "hello"]),
        );
        check("behaviour 7 codex-provider: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 7 codex-provider: stderr names the sella", stderr.includes("eng-lead"), stderr);
        check("behaviour 7 codex-provider: stderr names the harness", stderr.includes("codex"), stderr);
        check("behaviour 7 codex-provider: stderr names the requested model", stderr.includes("claude-opus-5"), stderr);
        check(
          "behaviour 7 codex-provider: stderr carries a non-empty substring of the vendor's own diagnostic",
          stderr.includes("Model provider"),
          stderr,
        );
        assertNothingPersisted("behaviour 7 codex-provider", dir, "eng-lead");
      });
    }

    // Scenario C — claude, real vendor literal from the live smoke: a
    // resumed session the vendor no longer recognizes. Seeded so the ONLY
    // runTalk call here takes the resume branch; the pre-existing session
    // record must survive untouched (never overwritten by a refused turn).
    {
      const dir = freshFixture("b7-claude-resume");
      const binDir = tmpBinDir("b7-claude-resume");
      writeStub(binDir, "claude", claudeStubSource(join(binDir, "log.jsonl"), { failStderr: "No conversation found with session ID: sess-w046" }));
      seedSession(dir, "eng-lead", "claude-code", "sess-w046");
      const seeded = readFileSync(join(dir, "sessions", "eng-lead.json"), "utf8");
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() => runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]));
        check("behaviour 7 claude-resume: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 7 claude-resume: stderr names the sella", stderr.includes("eng-lead"), stderr);
        check("behaviour 7 claude-resume: stderr names the harness", stderr.includes("claude-code"), stderr);
        check("behaviour 7 claude-resume: stderr names the requested model", stderr.includes("claude-opus-5"), stderr);
        check(
          "behaviour 7 claude-resume: stderr carries a non-empty substring of the vendor's own diagnostic",
          stderr.includes("No conversation found"),
          stderr,
        );
        check("behaviour 7 claude-resume: the pre-existing session record is untouched", readFileSync(join(dir, "sessions", "eng-lead.json"), "utf8") === seeded);
        check("behaviour 7 claude-resume: no timeline/eng-lead.jsonl", !existsSync(join(dir, "timeline", "eng-lead.jsonl")));
        const receiptsDir = join(dir, "receipts", "eng-lead");
        const noReceipts = !existsSync(receiptsDir) || readdirSync(receiptsDir).length === 0;
        check("behaviour 7 claude-resume: no receipt under receipts/eng-lead/", noReceipts);
      });
    }

    // Scenario D — spawn failure, claude (NEW, round 3, F-4c: instance I-2).
    // No stub file can fail the real spawn without failing `--version`
    // identically (PATH resolution happens before argv is even looked at),
    // so `available()` and the real call can never diverge through a plain
    // stub. Instead: a thin wrapper around the REAL claudeCodeProfile whose
    // `available()` always answers true and whose `start`/`resume` force
    // `env.PATH` to somewhere with no claude — the real profile code still
    // runs and still produces the real `Turn.raw = { error }` shape
    // (claude-code.ts's `spawnSync` `r.error` branch), through the real
    // `performTalk`/`vendorDiagnostic` pipeline via `runTalk`'s `harnesses`
    // override (an intended test seam).
    {
      const dir = freshFixture("b7-spawn-claude");
      const brokenPathClaude = {
        ...claudeCodeProfile,
        async available() {
          return true;
        },
        async start(opts: Parameters<typeof claudeCodeProfile.start>[0]) {
          return claudeCodeProfile.start({ ...opts, env: { PATH: "/nonexistent-w046-bin" } });
        },
        async resume(opts: Parameters<typeof claudeCodeProfile.resume>[0]) {
          return claudeCodeProfile.resume({ ...opts, env: { PATH: "/nonexistent-w046-bin" } });
        },
      };
      const { result, stderr } = await withCapturedStderr(() =>
        runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"], { harnesses: { "claude-code": brokenPathClaude } }),
      );
      check("behaviour 7 spawn-claude: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
      check("behaviour 7 spawn-claude: stderr names the sella", stderr.includes("eng-lead"), stderr);
      check("behaviour 7 spawn-claude: stderr names the harness", stderr.includes("claude-code"), stderr);
      check("behaviour 7 spawn-claude: stderr names the requested model", stderr.includes("claude-opus-5"), stderr);
      check("behaviour 7 spawn-claude: stderr carries a non-empty substring of the spawn error", stderr.includes("ENOENT"), stderr);
      assertNothingPersisted("behaviour 7 spawn-claude", dir, "eng-lead");
    }

    // Scenario E — spawn failure, codex (NEW, round 3, F-4c: instance I-3).
    // Same shape, same read, the other profile — separate from D so a
    // one-profile fix cannot pass (codex.ts needs no capture change: both
    // its non-zero returns already carry stderr, only I-3's spawn-error
    // shape was ever unread).
    {
      const dir = freshFixture("b7-spawn-codex");
      const brokenPathCodex = {
        ...codexProfile,
        async available() {
          return true;
        },
        async start(opts: Parameters<typeof codexProfile.start>[0]) {
          return codexProfile.start({ ...opts, env: { PATH: "/nonexistent-w046-bin" } });
        },
        async resume(opts: Parameters<typeof codexProfile.resume>[0]) {
          return codexProfile.resume({ ...opts, env: { PATH: "/nonexistent-w046-bin" } });
        },
      };
      const { result, stderr } = await withCapturedStderr(() =>
        runTalk(["--sella", "eng-lead", "--harness", "codex", "--model-only", "--studio", dir, "hello"], { harnesses: { codex: brokenPathCodex } }),
      );
      check("behaviour 7 spawn-codex: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
      check("behaviour 7 spawn-codex: stderr names the sella", stderr.includes("eng-lead"), stderr);
      check("behaviour 7 spawn-codex: stderr names the harness", stderr.includes("codex"), stderr);
      check("behaviour 7 spawn-codex: stderr names the requested model", stderr.includes("claude-opus-5"), stderr);
      check("behaviour 7 spawn-codex: stderr carries a non-empty substring of the spawn error", stderr.includes("ENOENT"), stderr);
      assertNothingPersisted("behaviour 7 spawn-codex", dir, "eng-lead");
    }

    // Scenario F — the redact pass-through: a secret-shaped token in the
    // vendor's own stderr must not reach the printed message.
    {
      const dir = freshFixture("b7-redact");
      const binDir = tmpBinDir("b7-redact");
      const secret = "abcdefabcdefabcdefabcdefabcdefabcdef1234567890";
      writeStub(binDir, "claude", claudeStubSource(join(binDir, "log.jsonl"), { failStderr: `auth failed, token=${secret} please retry` }));
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() => runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]));
        check("behaviour 7 redact: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 7 redact: the secret-shaped token does not reach the printed message", !stderr.includes(secret), stderr);
        check("behaviour 7 redact: the redacted diagnostic still reaches the message", stderr.includes("token=***") || stderr.includes("auth failed"), stderr);
        assertNothingPersisted("behaviour 7 redact", dir, "eng-lead");
      });
    }

    // Scenario G — bounded, deliberately: a long vendor stderr is truncated,
    // never carried whole. Spaced words, not one long run — a 32+ character
    // unbroken run is exactly redact()'s secret-shaped pattern and would be
    // masked to "*".repeat(8) regardless of length, which would prove
    // nothing about truncation.
    {
      const dir = freshFixture("b7-truncate");
      const binDir = tmpBinDir("b7-truncate");
      const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
      writeStub(binDir, "claude", claudeStubSource(join(binDir, "log.jsonl"), { failStderr: long }));
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() => runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]));
        check("behaviour 7 truncate: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 7 truncate: some of the diagnostic reaches the message", stderr.includes("word0 word1 word2"), stderr);
        check("behaviour 7 truncate: the diagnostic is bounded, not carried whole", !stderr.includes("word99"), stderr);
        assertNothingPersisted("behaviour 7 truncate", dir, "eng-lead");
      });
    }

    // The 300-character budget applies to the JOINED string, not once per
    // collected part: two parts each well under 300 alone (so a per-part
    // budget would let both through whole), joined past 300 together.
    {
      const dir = freshFixture("b7-joined-budget");
      const partA = Array.from({ length: 35 }, (_, i) => `alpha${i}`).join(" "); // 269 chars, under budget alone
      const partB = Array.from({ length: 35 }, (_, i) => `beta${i}`).join(" "); // 234 chars, under budget alone — 506 joined
      const jointBudgetProfile = {
        ...claudeCodeProfile,
        async available() {
          return true;
        },
        async start() {
          return { sessionId: "", reply: "", exitCode: 1, raw: { is_error: true, result: partA, stderr: partB } };
        },
      };
      const { result, stderr } = await withCapturedStderr(() =>
        runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"], { harnesses: { "claude-code": jointBudgetProfile } }),
      );
      check("behaviour 7 joined-budget: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
      // Collection order is stderr, then result (behaviour 7's "widened
      // read, exactly") — so partB (stderr) lands first, whole, and partA
      // (result) is what the shared 300-char budget cuts into.
      check("behaviour 7 joined-budget: the first collected part reaches the message whole", stderr.includes("beta0 beta1") && stderr.includes("beta34"), stderr);
      check(
        "behaviour 7 joined-budget: the second part is cut short — one budget for the joined string, not one per part",
        !stderr.includes("alpha34"),
        stderr,
      );
      assertNothingPersisted("behaviour 7 joined-budget", dir, "eng-lead");
    }

    // Additional assertions, not their own lettered scenario: gaps the
    // round-3 mutation run itself exposed while drafting this round (kept
    // rather than shipped as a red mutation run). Each uses runTalk's
    // `harnesses`/stub seams to reach a Turn.raw shape the real profiles
    // don't happen to produce today, to pin a property that must hold
    // regardless — a future vendor version is exactly what F-1 says never
    // to assume safe by omission.

    // `result` must be read only when `is_error === true` — a raw shape
    // that merely happens to carry a `result` key (no real profile
    // produces one without is_error, so this is deliberately synthetic)
    // must never leak it into the message.
    {
      const dir = freshFixture("b7-result-gate");
      const gatedProfile = {
        ...claudeCodeProfile,
        async available() {
          return true;
        },
        async start() {
          return {
            sessionId: "",
            reply: "",
            exitCode: 1,
            raw: { is_error: false, result: "GATED-RESULT-MUST-NOT-APPEAR", stderr: "real diagnostic text" },
          };
        },
      };
      const { result, stderr } = await withCapturedStderr(() =>
        runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"], { harnesses: { "claude-code": gatedProfile } }),
      );
      check("behaviour 7 result-gate: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
      check(
        "behaviour 7 result-gate: result is not surfaced when is_error is not true",
        !stderr.includes("GATED-RESULT-MUST-NOT-APPEAR"),
        stderr,
      );
      check("behaviour 7 result-gate: stderr is still surfaced", stderr.includes("real diagnostic text"), stderr);
      assertNothingPersisted("behaviour 7 result-gate", dir, "eng-lead");
    }

    // claude-code.ts's capture guard must never overwrite an envelope's OWN
    // `stderr` key with the real process stderr — real stub, real profile.
    {
      const dir = freshFixture("b7-own-stderr");
      const binDir = tmpBinDir("b7-own-stderr");
      writeStub(binDir, "claude", claudeStubSource(join(binDir, "log.jsonl"), { envelopeOwnStderr: "ENVELOPE-OWN-STDERR-VALUE" }));
      await withPath(binDir, async () => {
        const { result, stderr } = await withCapturedStderr(() => runTalk(["--sella", "eng-lead", "--model-only", "--studio", dir, "hello"]));
        check("behaviour 7 own-stderr: runTalk returns non-zero exit", result.exitCode !== 0, String(result.exitCode));
        check("behaviour 7 own-stderr: the envelope's own stderr key is preserved", stderr.includes("ENVELOPE-OWN-STDERR-VALUE"), stderr);
        check(
          "behaviour 7 own-stderr: the real process stderr never overwrites it",
          !stderr.includes("REAL-PROCESS-STDERR-MUST-NOT-APPEAR"),
          stderr,
        );
        assertNothingPersisted("behaviour 7 own-stderr", dir, "eng-lead");
      });
    }

    // One doc assertion, in behaviour 7 (round 3, F-4) — not behaviour 8,
    // whose log is valid and unmoved. The "Running talk" section's sentence
    // about a mismatched model must name BOTH diagnostics scenario A proves
    // are printed, and promise nothing scenario A doesn't check.
    {
      const doc = readFileSync(join(repo, "docs", "ADOPTION.md"), "utf8");
      const section = extractSection(doc, "## Running talk").replace(/\s+/g, " ").toLowerCase();
      check("behaviour 7 doc: names the envelope's own error text", section.includes("the envelope's own error text"), section);
      check("behaviour 7 doc: names the vendor's stderr line", section.includes("the vendor's stderr line"), section);
    }
  }

  // ---- 8: the documented contract names the egress residual --------------
  // (round 2, censor F-1). Same mechanism as behaviour 6, numbered
  // separately because `red` overwrites 06.log by behaviour number.
  if (runs(8)) {
    const doc = readFileSync(join(repo, "docs", "ADOPTION.md"), "utf8");
    const docSection = extractSection(doc, "## Running talk").replace(/\s+/g, " ");
    const codexSource = readFileSync(join(repo, "packages/shim/src/harness/codex.ts"), "utf8");
    const codexHeader = extractHeaderComment(codexSource).replace(/\s+/g, " ");
    check("behaviour 8: 'Running talk' section found", docSection.length > 0);
    check("behaviour 8: codex.ts header comment found", codexHeader.length > 0);

    const texts: [string, string][] = [
      ["docs/ADOPTION.md 'Running talk'", docSection],
      ["codex.ts header", codexHeader],
    ];
    for (const [label, text] of texts) {
      const lower = text.toLowerCase();
      check(
        `behaviour 8: ${label} states a vendor-side web fetch/search channel survives, closed by none of the eight --disable names`,
        lower.includes("web fetch/search") && lower.includes("closed by none of the eight"),
        text,
      );
      check(
        `behaviour 8: ${label} has no unqualified "no browser ... feature" claim reading as no egress`,
        !lower.includes("no browser, in-app-browser, apps or plugin feature"),
        text,
      );
      check(
        `behaviour 8: ${label} pairs the egress residual with unbounded reads, naming W-044's refusal of that pairing`,
        lower.includes("paired with unbounded reads") && lower.includes("w-044") && lower.includes("refused"),
        text,
      );
    }
  }
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
