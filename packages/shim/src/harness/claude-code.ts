/**
 * @bisellium/shim/harness — the 'claude-code' profile: `claude -p` with JSON
 * output and session resume. W-044: the talk profile is a permission
 * boundary, deny-by-default. `Bash(bisellium *)` used to admit the whole
 * CLI (`run`/`red`'s arbitrary passthrough, the Patron-stamped
 * `answer`/`greenlight`/`budget`, git-moving `branch`/`merge`/`close`), and
 * `--allowedTools` alone never restricted which tools exist or which
 * settings files loaded. Both `start` and `resume` now pass the full policy
 * below on every call:
 *
 *  - `--restricted`: ignores user/project/local settings files, refuses
 *    `bypassPermissions`, confines file tools to the working directory
 *    (the studio root, for talk).
 *  - `--strict-mcp-config` with no `--mcp-config`: no MCP servers.
 *  - `--permission-mode dontAsk`: anything not pre-approved is denied, never
 *    prompted for.
 *  - `--tools`: exactly Read, Grep, Glob, Bash are available. `WebFetch` is
 *    dropped — paired with `Read` it would be the profile's only egress.
 *  - `--allowedTools`: Read, Grep, Glob, and seven `Bash(bisellium …)` rules
 *    admitting only `context`, `query`, `check` and the bare usage banner —
 *    `providers` is cut (its default source spawns `npx --yes quota-axi`,
 *    a network fetch plus third-party code neither talk nor tick needs).
 *
 * W-049: every spawn below — `start`, `resume` and `available()` — hands
 * `claude` `harnessEnv(…)`, never the caller's `opts.env`/`process.env`
 * verbatim. That's the ten-name allowlist projection (harness/env.ts), not
 * this file's permission boundary; see docs/ADOPTION.md, "Running talk".
 *
 * A `claude` that doesn't know `--restricted`/`dontAsk` exits non-zero, and
 * talk relays that failure — it fails closed, which is intended. The
 * message is sent over stdin, never as a positional argv token: `claude
 * --allowedTools <tools...>` is variadic and would otherwise happily eat a
 * trailing prompt argument as one more "tool name". The boot bundle (the
 * system prompt) similarly never travels as an argv token: it's written to a
 * temp file and passed via `--append-system-prompt-file`, deleted once the
 * call returns — an argv-sized prompt risks the platform's argv length limit
 * and shows up in `ps`, neither of which is a problem for a file.
 *
 * W-046: `HarnessStartOpts.model`/`HarnessResumeOpts.model` (the manifest's
 * `sellae[].model`, D-020's decreed tier) is passed as `--model <id>` when
 * present — absent means no override, the vendor decides. `--allowedTools`
 * is variadic and terminal, so `--model` MUST be placed before POLICY_FLAGS
 * in argv (right after `--output-format json`); a flag appended after
 * POLICY_FLAGS would be silently eaten as one more tool name. A `claude`
 * that doesn't recognize the requested model exits non-zero
 * (`[claude-code:unrecognized_model]`), and talk relays that failure closed
 * — the manifest declaring a model that doesn't belong to this harness is a
 * bug in the manifest, not something this profile papers over.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessEnv } from "./env.js";
import type { HarnessProfile, HarnessResumeOpts, HarnessStartOpts, Turn } from "./types.js";
import { USAGE_LIMIT_EXIT_CODE } from "./types.js";

const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** Built-in tools available at all — availability, not approval
 *  (`--allowedTools` below is approval). `WebFetch` is deliberately absent. */
const TOOLS = "Read,Grep,Glob,Bash";

/** Approval list: Read/Grep/Glob plus exactly the Bash rules that admit
 *  `context`, `query`, `check` and the bare `bisellium` usage banner —
 *  nothing else, including `providers` (cut; see file header). */
const ALLOWED_TOOLS = [
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

/** The five settings-isolation flags shared by both `start` and `resume` —
 *  argv is the only boundary, since permissions aren't saved with a
 *  session. */
const POLICY_FLAGS = ["--restricted", "--strict-mcp-config", "--permission-mode", "dontAsk", "--tools", TOOLS, "--allowedTools", ...ALLOWED_TOOLS];

/** Matches only against the JSON envelope's own `subtype`/`error` fields (or
 *  stderr) — never against `result`, the reply text. A sella talking ABOUT a
 *  usage limit (e.g. relaying an incident) must never be mistaken for one. */
const USAGE_LIMIT_RE = /usage limit|rate limit|quota exceeded|429|overloaded/i;

interface ClaudeJsonResult {
  session_id?: string;
  result?: string;
  model?: string;
  is_error?: boolean;
  /** Vendor-specific error discriminant, e.g. "usage_limit_error" — an
   *  envelope field, never reply text. */
  subtype?: string;
  error?: string | { message?: string };
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

/** True when the JSON envelope ITSELF (never `result`) says this turn hit a
 *  usage/rate limit: `is_error` plus a `subtype`/`error` naming it. */
function envelopeIsUsageLimited(parsed: ClaudeJsonResult | undefined): boolean {
  if (!parsed || parsed.is_error !== true) return false;
  const subtype = parsed.subtype ?? "";
  const errText = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? "");
  return USAGE_LIMIT_RE.test(subtype) || USAGE_LIMIT_RE.test(errText);
}

function runClaude(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; message: string }): Turn {
  const r = spawnSync("claude", args, {
    cwd: opts.cwd,
    env: harnessEnv(opts.env),
    input: opts.message,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });

  if (r.error) return { sessionId: "", reply: "", exitCode: 127, raw: { error: r.error.message } };

  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const parsed = parseJson(stdout);

  // Detection sources: the envelope's own error/is_error/subtype fields, or
  // stderr — never `stdout` wholesale (that's where the reply text lives).
  if (envelopeIsUsageLimited(parsed) || USAGE_LIMIT_RE.test(stderr))
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
    const r = spawnSync("claude", ["--version"], { env: harnessEnv(process.env), encoding: "utf8", timeout: 10_000 });
    return !r.error && r.status === 0;
  },

  async start(opts: HarnessStartOpts): Promise<Turn> {
    const dir = mkdtempSync(join(tmpdir(), "bisellium-sysprompt-"));
    const file = join(dir, "system-prompt.md");
    try {
      writeFileSync(file, opts.systemPrompt);
      const modelArgs = opts.model ? ["--model", opts.model] : [];
      const args = ["-p", "--output-format", "json", ...modelArgs, "--append-system-prompt-file", file, ...POLICY_FLAGS];
      return runClaude(args, { cwd: opts.cwd, env: opts.env, message: opts.message });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },

  async resume(opts: HarnessResumeOpts): Promise<Turn> {
    const modelArgs = opts.model ? ["--model", opts.model] : [];
    const args = ["-p", "--resume", opts.sessionId, "--output-format", "json", ...modelArgs, ...POLICY_FLAGS];
    return runClaude(args, { cwd: opts.cwd, env: opts.env, message: opts.message });
  },
};
