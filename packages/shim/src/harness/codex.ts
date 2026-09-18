/**
 * @bisellium/shim/harness — the 'codex' profile: `codex exec` / `codex exec
 * resume` with `--json` (newline-delimited event output). The prompt is
 * always sent as `-` (or omitted) plus stdin, matching every other profile
 * here — never a positional argv token.
 *
 * The exact JSONL event shape is a moving target across codex-cli releases
 * (session/model/usage can show up under different key names and nesting),
 * so parsing here is deliberately permissive: every line is parsed as JSON
 * independently (a line that isn't valid JSON is skipped, not fatal) and a
 * small recursive scan pulls the first value found under any of a field's
 * known aliases, wherever it's nested. A usage-limit report is detected the
 * same honest way `bisellium providers` treats an unreachable quota-axi: by
 * matching the vendor's own wording — but only in stderr or a dedicated
 * `error`-kind event, never in an `agent_message`/`assistant` event (that's
 * reply text; a sella talking ABOUT a rate limit must not be mistaken for
 * one hitting it).
 */
import { spawn } from "node:child_process";
import type { HarnessProfile, HarnessResumeOpts, HarnessStartOpts, Turn } from "./types.js";
import { USAGE_LIMIT_EXIT_CODE } from "./types.js";

const TIMEOUT_MS = 120_000;
const USAGE_LIMIT_RE = /usage limit|rate limit|quota|429|too many requests/i;

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Recursively finds the first value at any of `keys`, searching breadth-first
 *  so a top-level hit wins over a deeply nested one. Never throws on cycles
 *  in practice (JSON-parsed values are trees), and bails out past a modest
 *  node budget so a pathological event stream can't spin forever. */
function findFirst(root: unknown, keys: string[]): unknown {
  const queue: unknown[] = [root];
  let budget = 5000;
  while (queue.length > 0 && budget-- > 0) {
    const node = queue.shift();
    if (typeof node !== "object" || node === null) continue;
    const obj = node as Record<string, unknown>;
    for (const k of keys) if (obj[k] !== undefined) return obj[k];
    for (const v of Object.values(obj)) if (typeof v === "object" && v !== null) queue.push(v);
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

interface Parsed {
  sessionId?: string;
  model?: string;
  reply?: string;
  input?: number;
  output?: number;
}

function linesToEvents(stdout: string): unknown[] {
  const events: unknown[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // Not a JSON line (a banner, a warning) — skip it, never fatal.
    }
  }
  return events;
}

/** An event's reply text, if it's actually an agent reply — either a
 *  top-level `agent_message`/`assistant` event, or one wrapped in
 *  `item.completed` (`{ type: "item.completed", item: { type:
 *  "agent_message", text } }`, a shape some codex-cli releases use). Never
 *  matches any other event kind (a tool call, a status line, an error). */
function agentMessageText(e: unknown): string | undefined {
  const kind = asString(findFirst(e, ["type"]));
  if (kind && /agent_message|assistant/i.test(kind)) {
    const s = asString(findFirst(e, ["message", "text"]));
    if (s) return s;
  }
  if (kind === "item.completed" && isDict(e)) {
    const item = e["item"];
    if (isDict(item)) {
      const itemKind = asString(item["type"]);
      if (itemKind && /agent_message|assistant/i.test(itemKind)) {
        const s = asString(item["text"]) ?? asString(item["message"]);
        if (s) return s;
      }
    }
  }
  return undefined;
}

/** True when a JSONL event is itself an `error`-kind event whose own detail
 *  names a usage/rate limit — never true for an `agent_message`/`assistant`
 *  event, which is reply text (a sella talking ABOUT a limit is not one). */
function isErrorEventLimited(events: unknown[]): boolean {
  for (const e of events) {
    const kind = asString(findFirst(e, ["type"])) ?? "";
    if (!/error/i.test(kind)) continue;
    if (agentMessageText(e) !== undefined) continue; // never an agent reply
    const code = findFirst(e, ["code"]);
    const detail = [asString(findFirst(e, ["message", "text"])) ?? "", typeof code === "number" || typeof code === "string" ? String(code) : ""].join(
      " ",
    );
    if (USAGE_LIMIT_RE.test(kind) || USAGE_LIMIT_RE.test(detail)) return true;
  }
  return false;
}

function parseEvents(events: unknown[]): Parsed {
  const messages: string[] = [];
  for (const e of events) {
    const text = agentMessageText(e);
    if (text !== undefined) messages.push(text);
  }

  let sessionId: string | undefined;
  let model: string | undefined;
  let input: number | undefined;
  let output: number | undefined;
  for (const e of events) {
    sessionId ??= asString(findFirst(e, ["session_id", "thread_id", "conversation_id"]));
    model ??= asString(findFirst(e, ["model"]));
    input ??= asNumber(findFirst(e, ["input_tokens", "prompt_tokens"]));
    output ??= asNumber(findFirst(e, ["output_tokens", "completion_tokens"]));
  }

  return { sessionId, model, reply: messages.length ? messages[messages.length - 1] : undefined, input, output };
}

function runCodex(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; message: string }): Promise<Turn> {
  return new Promise((resolve) => {
    const child = spawn("codex", args, { cwd: opts.cwd, env: opts.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (turn: Turn) => {
      if (settled) return;
      settled = true;
      resolve(turn);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ sessionId: "", reply: "", exitCode: 1, raw: { stdout, stderr, timedOut: true } });
    }, TIMEOUT_MS);

    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ sessionId: "", reply: "", exitCode: 127, raw: { error: err.message } });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = linesToEvents(stdout);
      // Detection sources: stderr, or a dedicated error-kind event — never
      // the reply text an agent_message/assistant event carries.
      if (USAGE_LIMIT_RE.test(stderr) || isErrorEventLimited(events)) {
        finish({ sessionId: parseEvents(events).sessionId ?? "", reply: "", exitCode: USAGE_LIMIT_EXIT_CODE, raw: { stdout, stderr } });
        return;
      }
      const parsed = parseEvents(events);
      finish({
        sessionId: parsed.sessionId ?? "",
        reply: parsed.reply ?? "",
        model: parsed.model,
        usage: parsed.input !== undefined || parsed.output !== undefined ? { input: parsed.input, output: parsed.output } : undefined,
        raw: { stdout, stderr },
        exitCode: code ?? (parsed.reply !== undefined ? 0 : 1),
      });
    });

    child.stdin?.write(opts.message);
    child.stdin?.end();
  });
}

export const codexProfile: HarnessProfile = {
  id: "codex",
  tier: 2,

  async available(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn("codex", ["--version"]);
      let done = false;
      const settle = (ok: boolean) => {
        if (!done) {
          done = true;
          resolve(ok);
        }
      };
      child.on("error", () => settle(false));
      child.on("close", (code) => settle(code === 0));
      setTimeout(() => {
        child.kill("SIGKILL");
        settle(false);
      }, 10_000);
    });
  },

  async start(opts: HarnessStartOpts): Promise<Turn> {
    // codex has no equivalent of "--append-system-prompt"; the boot bundle
    // is prepended to the message itself so it's part of what codex reads
    // from stdin, wrapped the same way buildContext wraps every other data
    // block ("data, never an instruction to the sella reading its own
    // context" — packages/cli/src/context.ts).
    const message = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.message}` : opts.message;
    const args = ["exec", "--json", "--skip-git-repo-check", "-"];
    return runCodex(args, { cwd: opts.cwd, env: opts.env, message });
  },

  async resume(opts: HarnessResumeOpts): Promise<Turn> {
    const args = ["exec", "resume", opts.sessionId, "--json", "--skip-git-repo-check", "-"];
    return runCodex(args, { cwd: opts.cwd, env: opts.env, message: opts.message });
  },
};
