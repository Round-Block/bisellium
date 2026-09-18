/**
 * @bisellium/shim/harness — the 'claude-code' profile: `claude -p` with JSON
 * output, session resume, an appended system prompt (the sella's boot
 * bundle from `bisellium context`), and an allowed-tools list restricted to
 * read-only tools plus `Bash(bisellium *)` — a magister talking to the
 * Patron can look around and run bisellium's own CLI, never edit the repo.
 * The message is sent over stdin, never as a positional argv token: `claude
 * --allowedTools <tools...>` is variadic and would otherwise happily eat a
 * trailing prompt argument as one more "tool name".
 */
import { spawnSync } from "node:child_process";
import type { HarnessProfile, HarnessResumeOpts, HarnessStartOpts, Turn } from "./types.js";
import { USAGE_LIMIT_EXIT_CODE } from "./types.js";

const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** Read-only built-ins plus the one write path a magister is allowed:
 *  bisellium's own CLI (new items, talk to other sellae, etc. — never a raw
 *  shell). */
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob", "WebFetch", "Bash(bisellium *)"];

const USAGE_LIMIT_RE = /usage limit|rate limit|quota exceeded|429|overloaded/i;

interface ClaudeJsonResult {
  session_id?: string;
  result?: string;
  model?: string;
  is_error?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseJson(stdout: string): ClaudeJsonResult | undefined {
  try {
    const v: unknown = JSON.parse(stdout);
    return typeof v === "object" && v !== null ? (v as ClaudeJsonResult) : undefined;
  } catch {
    return undefined;
  }
}

function runClaude(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; message: string }): Turn {
  const r = spawnSync("claude", args, {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.message,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });

  if (r.error) return { sessionId: "", reply: "", exitCode: 127, raw: { error: r.error.message } };

  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const parsed = parseJson(stdout);

  if (USAGE_LIMIT_RE.test(stdout) || USAGE_LIMIT_RE.test(stderr))
    return { sessionId: parsed?.session_id ?? "", reply: "", exitCode: USAGE_LIMIT_EXIT_CODE, raw: parsed ?? { stdout, stderr } };

  if (!parsed) return { sessionId: "", reply: "", exitCode: r.status ?? 1, raw: { stdout, stderr } };

  return {
    sessionId: parsed.session_id ?? "",
    reply: parsed.is_error ? "" : (parsed.result ?? ""),
    model: parsed.model,
    usage: parsed.usage ? { input: parsed.usage.input_tokens, output: parsed.usage.output_tokens } : undefined,
    raw: parsed,
    exitCode: parsed.is_error ? (r.status && r.status !== 0 ? r.status : 1) : (r.status ?? 0),
  };
}

export const claudeCodeProfile: HarnessProfile = {
  id: "claude-code",
  tier: 1,

  async available(): Promise<boolean> {
    const r = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10_000 });
    return !r.error && r.status === 0;
  },

  async start(opts: HarnessStartOpts): Promise<Turn> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--append-system-prompt",
      opts.systemPrompt,
      "--allowedTools",
      ...READ_ONLY_TOOLS,
    ];
    return runClaude(args, { cwd: opts.cwd, env: opts.env, message: opts.message });
  },

  async resume(opts: HarnessResumeOpts): Promise<Turn> {
    const args = ["-p", "--resume", opts.sessionId, "--output-format", "json", "--allowedTools", ...READ_ONLY_TOOLS];
    return runClaude(args, { cwd: opts.cwd, env: opts.env, message: opts.message });
  },
};
