/**
 * packages/shim/test/harness.test.ts — usage-limit detection must never come
 * from reply text (docs/ADOPTION.md talk section / integrator fixups): a
 * reply that merely *mentions* "rate limit"/"429"/"quota" must be delivered
 * normally. `claude-code` detects a real limit only from the JSON envelope's
 * `is_error`/`subtype`/`error` fields or from stderr; `codex` only from
 * stderr or a dedicated `error` event (never an `agent_message`/`assistant`
 * event, which is reply text). Also covers claude-code's system prompt now
 * going through `--append-system-prompt-file` (a temp file, deleted after)
 * instead of argv, and codex's `item.completed`-wrapped agent messages.
 *
 * Drives real stub executables (never the real `claude`/`codex` CLIs). Each
 * scenario gets its own bin directory (W-049 test hardening): the stub's
 * behaviour is baked into its source text, and the scenario is selected by
 * which directory PATH points at — never an env var (an env-carried
 * scenario flag would itself be scrubbed by W-049's harness env allowlist).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeProfile, codexProfile } from "../src/index.js";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const binDir = mkdtempSync(join(tmpdir(), "bisellium-harness-bin-"));

const CLAUDE_PREAMBLE = `import { readFileSync } from "node:fs";
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
const args = process.argv.slice(2);
const fileIdx = args.indexOf("--append-system-prompt-file");
const promptFilePath = fileIdx !== -1 ? args[fileIdx + 1] : undefined;
const promptFileContent = promptFilePath ? readFileSync(promptFilePath, "utf8") : undefined;
const inlineIdx = args.indexOf("--append-system-prompt");
const inlinePrompt = inlineIdx !== -1 ? args[inlineIdx + 1] : undefined;
const message = (await readStdin()).trim();
function out(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }`;

const CLAUDE_SCENARIOS: Record<string, string> = {
  normal: `out({ session_id: "sess-normal", result: "echo:" + message + " (mentions: rate limit, 429, quota exceeded)", is_error: false, model: "stub" });
process.exit(0);`,
  limited_envelope: `out({ session_id: "sess-limited", is_error: true, subtype: "usage_limit_error", error: "You have exceeded your usage limit for this period." });
process.exit(0);`,
  limited_stderr: `out({ session_id: "sess-x", result: "fine", is_error: false });
process.stderr.write("error: rate limit exceeded, please retry later\\n");
process.exit(1);`,
  prompt_echo: `out({ session_id: "sess-prompt", result: "PROMPT:" + (promptFileContent ?? ""), promptFilePath: promptFilePath ?? null, inlinePrompt: inlinePrompt ?? null, model: "stub" });
process.exit(0);`,
};

const CODEX_PREAMBLE = `function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}
const message = (await readStdin()).trim();
function line(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }`;

const CODEX_SCENARIOS: Record<string, string> = {
  normal: `line({ type: "session.created", session_id: "codex-normal" });
line({ type: "agent_message", message: "echo:" + message + " (mentions: rate limit, 429, quota)" });
process.exit(0);`,
  limited_error_event: `line({ type: "session.created", session_id: "codex-limited" });
line({ type: "error", message: "usage limit reached for this workspace" });
process.exit(1);`,
  limited_stderr: `line({ type: "session.created", session_id: "codex-stderr" });
line({ type: "agent_message", message: "all good here" });
process.stderr.write("rate limit hit, backoff required\\n");
process.exit(1);`,
  item_completed: `line({ type: "session.created", session_id: "codex-item" });
line({ type: "item.completed", item: { type: "agent_message", text: "wrapped:" + message } });
process.exit(0);`,
};

function writeScenarioStub(bin: "claude" | "codex", scenario: string, preamble: string, action: string): string {
  const dir = join(binDir, `${bin}-${scenario}`);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, bin);
  writeFileSync(p, `#!/usr/bin/env node\n${preamble}\n${action}\n`);
  chmodSync(p, 0o755);
  return dir;
}

const claudeDirs: Record<string, string> = {};
for (const [scenario, action] of Object.entries(CLAUDE_SCENARIOS)) claudeDirs[scenario] = writeScenarioStub("claude", scenario, CLAUDE_PREAMBLE, action);
const codexDirs: Record<string, string> = {};
for (const [scenario, action] of Object.entries(CODEX_SCENARIOS)) codexDirs[scenario] = writeScenarioStub("codex", scenario, CODEX_PREAMBLE, action);

function envForClaude(scenario: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${claudeDirs[scenario]}:${process.env["PATH"] ?? ""}` };
}
function envForCodex(scenario: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${codexDirs[scenario]}:${process.env["PATH"] ?? ""}` };
}

try {
  // ---- claude-code: envelope-based limit detection (never reply text) -----
  {
    const turn = await claudeCodeProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt: "you are eng-lead",
      message: "status?",
      env: envForClaude("normal"),
    });
    check("claude-code normal: exitCode 0", turn.exitCode === 0, String(turn.exitCode));
    check(
      "claude-code normal: reply mentioning 'rate limit'/'429'/'quota' delivered as-is, not limited",
      turn.reply.includes("mentions: rate limit, 429, quota exceeded"),
      turn.reply,
    );
  }
  {
    const turn = await claudeCodeProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt: "you are eng-lead",
      message: "status?",
      env: envForClaude("limited_envelope"),
    });
    check("claude-code limited envelope: exitCode 3", turn.exitCode === 3, String(turn.exitCode));
  }
  {
    const turn = await claudeCodeProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt: "you are eng-lead",
      message: "status?",
      env: envForClaude("limited_stderr"),
    });
    check("claude-code limited stderr: exitCode 3", turn.exitCode === 3, String(turn.exitCode));
  }

  // ---- claude-code: system prompt via --append-system-prompt-file, temp file deleted after --
  {
    const systemPrompt = "boot bundle contents for eng-lead\nline two";
    const turn = await claudeCodeProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt,
      message: "status?",
      env: envForClaude("prompt_echo"),
    });
    check("claude-code prompt file: exitCode 0", turn.exitCode === 0, String(turn.exitCode));
    check("claude-code prompt file: content reached the process via the file", turn.reply === `PROMPT:${systemPrompt}`, turn.reply);
    const raw = turn.raw as { promptFilePath?: string; inlinePrompt?: string | null } | undefined;
    check("claude-code prompt file: a file path was used (not argv)", typeof raw?.promptFilePath === "string" && raw.promptFilePath.length > 0, JSON.stringify(raw));
    check("claude-code prompt file: never passed inline via --append-system-prompt", raw?.inlinePrompt === null, JSON.stringify(raw));
    if (raw?.promptFilePath) {
      check("claude-code prompt file: temp file deleted after the call", !existsSync(raw.promptFilePath), raw.promptFilePath);
    }
  }

  // ---- codex: error-event / stderr detection (never agent_message text) ---
  {
    const turn = await codexProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt: "",
      message: "status?",
      env: envForCodex("normal"),
    });
    check("codex normal: exitCode 0", turn.exitCode === 0, String(turn.exitCode));
    check(
      "codex normal: reply mentioning 'rate limit'/'429'/'quota' delivered as-is, not limited",
      turn.reply.includes("mentions: rate limit, 429, quota"),
      turn.reply,
    );
  }
  {
    const turn = await codexProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt: "",
      message: "status?",
      env: envForCodex("limited_error_event"),
    });
    check("codex limited error event: exitCode 3", turn.exitCode === 3, String(turn.exitCode));
  }
  {
    const turn = await codexProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt: "",
      message: "status?",
      env: envForCodex("limited_stderr"),
    });
    check("codex limited stderr: exitCode 3", turn.exitCode === 3, String(turn.exitCode));
  }
  {
    const turn = await codexProfile.start({
      cwd: process.cwd(),
      sella: "eng-lead",
      systemPrompt: "",
      message: "hello",
      env: envForCodex("item_completed"),
    });
    check("codex item.completed: exitCode 0", turn.exitCode === 0, String(turn.exitCode));
    check("codex item.completed: agent message text extracted", turn.reply === "wrapped:hello", turn.reply);
  }
} finally {
  for (const f of readdirSync(binDir)) {
    try {
      rmSync(join(binDir, f));
    } catch {
      /* best effort */
    }
  }
  rmSync(binDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
