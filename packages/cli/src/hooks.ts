/**
 * packages/cli/src/hooks.ts — W-015: harness hooks, the Claude Code profile
 * as the event-native adapter. Two CLI surfaces, kept out of main.ts on
 * purpose (same as verify.ts/writes.ts) — the integrator wires:
 *
 *   bisellium hooks print --harness claude-code --sella <id> [--studio <dir>]
 *   bisellium hooks check --harness claude-code [--studio <dir>]
 *   bisellium hook-event <start|stop|tool|compact> --sella <id> [--studio <dir>]
 *
 * `hooks print`/`hooks check` are ordinary administrative commands (usage
 * errors exit 2, like every other command in this CLI). `hook-event` is
 * different: it IS the hook target Claude Code actually runs, so it must
 * never block the harness — every subcommand reads its payload from stdin
 * (JSON, bounded by @bisellium/shim's 2s self-timeout) and always exits 0,
 * printing at most one line to stderr on any failure (malformed payload,
 * missing session_id, an unreadable studio, …). All writes go through the
 * existing shim helpers: receipts.ts (writeReceiptStart/writeReceiptEnd),
 * redact.ts (redact), @bisellium/core's appendEvents into EVENTS_LOG_REL
 * (`<studio>/.bisellium/events.jsonl` — the same file a running Store
 * reads/appends to, so a hook-emitted event and a CLI/Store one never fork
 * the log).
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readFront, readManifest, listMd, type Manifest } from "@bisellium/adapter-native";
import { appendEvents, readLog, EVENTS_LOG_REL } from "@bisellium/core";
import { WF, type GantryEvent } from "@bisellium/schema";
import {
  claudeCodeHooksBlock,
  hookReceiptStatuses,
  readJsonFromStream,
  redact,
  receiptPath,
  writeReceiptEnd,
  writeReceiptStart,
} from "@bisellium/shim";

export interface HooksResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const SUPPORTED_HARNESS = "claude-code";
/** A handoff older than this, on an active opus, gets a Stop-hook reminder. */
const TRADITIO_STALE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATES = new Set(["building", "verifying", "review"]);

function isDict(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Minimal `--flag value` parser, shared by hooks/hook-event: any `--flag`
 *  not in `valued` is a usage error (same discipline writes.ts's
 *  parseFlags uses), positionals are ignored (neither command takes any). */
function parseFlags(args: string[], valued: string[]): { values: Map<string, string> } | { error: string } {
  const known = new Set(valued);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) continue;
    if (!known.has(a)) return { error: `unknown flag "${a}"` };
    const v = args[++i];
    if (v === undefined) return { error: `${a} needs a value` };
    values.set(a, v);
  }
  return { values };
}

function readManifestSafe(root: string): Manifest | undefined {
  try {
    return readManifest(root);
  } catch {
    return undefined;
  }
}

/** Same slug @bisellium/cli's writes.ts uses for its default projectId, so
 *  hook-emitted events line up with the studio's own snapshots. */
function projectIdFor(manifest: Manifest): string {
  return manifest.studio.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// ---------------------------------------------------------------------------
// `bisellium hooks print|check`
// ---------------------------------------------------------------------------

const HOOKS_USAGE =
  "usage: bisellium hooks print --harness claude-code --sella <id> [--studio <dir>]\n" +
  "       bisellium hooks check --harness claude-code [--studio <dir>]";

export function runHooks(args: string[], _opts: Record<string, never> = {}): HooksResult {
  const [sub, ...rest] = args;
  if (sub === "print") return runHooksPrint(rest);
  if (sub === "check") return runHooksCheck(rest);
  console.error(HOOKS_USAGE);
  return { exitCode: 2 };
}

function runHooksPrint(args: string[]): HooksResult {
  const parsed = parseFlags(args, ["--harness", "--sella", "--studio"]);
  if ("error" in parsed) {
    console.error(`hooks print: ${parsed.error}\n${HOOKS_USAGE}`);
    return { exitCode: 2 };
  }
  const harness = parsed.values.get("--harness");
  const sella = parsed.values.get("--sella");
  if (harness !== SUPPORTED_HARNESS) {
    console.error(`hooks print: --harness must be "${SUPPORTED_HARNESS}" (got ${JSON.stringify(harness ?? "")})\n${HOOKS_USAGE}`);
    return { exitCode: 2 };
  }
  if (!sella) {
    console.error(`hooks print: --sella is required\n${HOOKS_USAGE}`);
    return { exitCode: 2 };
  }
  const studio = parsed.values.get("--studio") ?? ".";

  const block = claudeCodeHooksBlock({ sella, studio });
  console.log(JSON.stringify(block, null, 2));
  console.error(
    'paste the block above into .claude/settings.json under its "hooks" key (merge with anything already there — ' +
      "bisellium never writes that file for you). SubagentStart is intentionally left unwired (documented, no-op: " +
      "a subagent has no sella of its own to hand a receipt or boot bundle to).",
  );
  return { exitCode: 0 };
}

function runHooksCheck(args: string[]): HooksResult {
  const parsed = parseFlags(args, ["--harness", "--studio"]);
  if ("error" in parsed) {
    console.error(`hooks check: ${parsed.error}\n${HOOKS_USAGE}`);
    return { exitCode: 2 };
  }
  const harness = parsed.values.get("--harness");
  if (harness !== SUPPORTED_HARNESS) {
    console.error(`hooks check: --harness must be "${SUPPORTED_HARNESS}" (got ${JSON.stringify(harness ?? "")})\n${HOOKS_USAGE}`);
    return { exitCode: 2 };
  }
  const studio = resolve(parsed.values.get("--studio") ?? ".");
  const manifest = readManifestSafe(studio);
  if (!manifest) {
    console.error(`hooks check: ${studio} is not a studio (bisellium.yml missing or unparseable)`);
    return { exitCode: 2 };
  }

  const statuses = hookReceiptStatuses(
    studio,
    manifest.sellae.map((s) => ({ id: s.id, harness: s.harness })),
  );
  for (const s of statuses) {
    const last = s.lastReceipt ? `${s.lastReceipt.sessionId} (started ${s.lastReceipt.startedAt})` : "none";
    console.log(`${s.sella}: harness=${s.harness} last=${last} ${s.dead ? "dead" : "alive"}`);
  }
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// `bisellium hook-event start|stop|tool|compact` — the actual hook target.
// Never blocks the harness: always exits 0, at most one stderr line.
// ---------------------------------------------------------------------------

export interface HookEventOptions {
  now?: Date;
  /** Defaults to process.stdin — a test passes a fake readable instead. */
  stdin?: NodeJS.ReadableStream;
  /** Defaults to 2000ms, the documented hard self-timeout. */
  stdinTimeoutMs?: number;
}

const HOOK_EVENT_USAGE = "usage: bisellium hook-event <start|stop|tool|compact> --sella <id> [--studio <dir>]";

/** `receipts/<sella>/<sessionId>.json` and `timeline/<sella>.jsonl` both
 *  join these two values straight into a filesystem path — `sella` is
 *  operator-controlled (it comes from the printed hooks block), but
 *  `sessionId` is NOT: it's read off the hook payload's `session_id`
 *  field, which the harness supplies and this process must treat as
 *  untrusted. A value like `../../../../tmp/pwned` would otherwise write a
 *  receipt anywhere on disk the process has permission to reach. Same
 *  containment discipline as writes.ts's `safeItemPath`/apps/server's
 *  `safeId`: no path separator, no bare `.`/`..`, and bounded in length so
 *  a malicious or malformed value can't also blow up into a giant
 *  ENAMETOOLONG error line (a hook target's "at most one stderr line"
 *  contract). */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
function isSafePathSegment(s: string): boolean {
  return SAFE_PATH_SEGMENT.test(s) && s !== "." && s !== "..";
}

export async function runHookEvent(args: string[], opts: HookEventOptions = {}): Promise<HooksResult> {
  const [sub, ...rest] = args;
  if (sub !== "start" && sub !== "stop" && sub !== "tool" && sub !== "compact") {
    console.error(`hook-event: unknown subcommand ${JSON.stringify(sub ?? "")}\n${HOOK_EVENT_USAGE}`);
    return { exitCode: 0 }; // a hook target never blocks the harness, even on a usage error
  }
  const parsed = parseFlags(rest, ["--sella", "--studio"]);
  if ("error" in parsed) {
    console.error(`hook-event ${sub}: ${parsed.error}`);
    return { exitCode: 0 };
  }
  const sella = parsed.values.get("--sella");
  if (!sella) {
    console.error(`hook-event ${sub}: --sella is required`);
    return { exitCode: 0 };
  }
  if (!isSafePathSegment(sella)) {
    console.error(`hook-event ${sub}: --sella must be a plain id (no path separators)`);
    return { exitCode: 0 };
  }
  const studio = resolve(parsed.values.get("--studio") ?? ".");
  const now = opts.now ?? new Date();

  const payload = await readJsonFromStream(opts.stdin ?? process.stdin, opts.stdinTimeoutMs ?? 2000);
  if (!payload.ok) {
    console.error(`hook-event ${sub}: ${payload.error}`);
    return { exitCode: 0 };
  }

  try {
    if (sub === "start") return handleStart(studio, sella, payload.data, now);
    if (sub === "stop") return handleStop(studio, sella, payload.data, now);
    if (sub === "tool") return handleTool(studio, sella, payload.data, now);
    return handleCompact(studio, sella, payload.data, now);
  } catch (e) {
    console.error(`hook-event ${sub}: ${(e as Error).message}`);
    return { exitCode: 0 };
  }
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function handleStart(studio: string, sella: string, payload: Record<string, unknown>, now: Date): HooksResult {
  const sessionId = stringField(payload, "session_id");
  if (!sessionId) {
    console.error("hook-event start: payload missing session_id");
    return { exitCode: 0 };
  }
  if (!isSafePathSegment(sessionId)) {
    // session_id is the harness's own value (untrusted external input),
    // joined straight into a filesystem path by receiptPath — never echo
    // it back (it could be arbitrarily large/secret-shaped), just refuse.
    console.error("hook-event start: payload session_id is not a plain id (no path separators)");
    return { exitCode: 0 };
  }
  const cwd = stringField(payload, "cwd") ?? studio;
  writeReceiptStart(studio, { sella, sessionId, startedAt: now.toISOString(), cwd, cmd: [], harness: SUPPORTED_HARNESS });
  return { exitCode: 0 };
}

function handleStop(studio: string, sella: string, payload: Record<string, unknown>, now: Date): HooksResult {
  const sessionId = stringField(payload, "session_id");
  if (!sessionId) {
    console.error("hook-event stop: payload missing session_id");
    return { exitCode: 0 };
  }
  if (!isSafePathSegment(sessionId)) {
    console.error("hook-event stop: payload session_id is not a plain id (no path separators)");
    return { exitCode: 0 };
  }
  const path = receiptPath(studio, sella, sessionId);
  let durationMs = 0;
  try {
    const existing = JSON.parse(readFileSync(path, "utf8")) as { startedAt?: string };
    if (typeof existing.startedAt === "string") {
      const startedAt = new Date(existing.startedAt);
      if (!Number.isNaN(startedAt.getTime())) durationMs = Math.max(0, now.getTime() - startedAt.getTime());
    }
  } catch {
    // No start receipt (hook-event start never ran, or a different studio) —
    // still leave an honest end record rather than refusing to close one.
  }
  writeReceiptEnd(path, { endedAt: now.toISOString(), exitCode: 0, durationMs });

  const reminder = staleTraditioReminder(studio, sella, now);
  if (reminder) console.log(reminder);
  return { exitCode: 0 };
}

/** The first active opus (building/verifying/review) handed to `sella`
 *  whose traditio.at is older than TRADITIO_STALE_MS — or undefined. Never
 *  throws: an unreadable opera/ or a malformed opus just yields no reminder. */
function staleTraditioReminder(studio: string, sella: string, now: Date): string | undefined {
  let files: string[];
  try {
    files = listMd(join(studio, "opera"));
  } catch {
    return undefined;
  }
  for (const p of files) {
    let data: Record<string, unknown>;
    try {
      ({ data } = readFront<Record<string, unknown>>(p));
    } catch {
      continue;
    }
    if (data["sella"] !== sella) continue;
    if (typeof data["state"] !== "string" || !ACTIVE_STATES.has(data["state"])) continue;
    const traditio = data["traditio"];
    if (!isDict(traditio) || typeof traditio["at"] !== "string") continue;
    const at = new Date(traditio["at"]);
    if (Number.isNaN(at.getTime())) continue;
    const ageMs = now.getTime() - at.getTime();
    if (ageMs <= TRADITIO_STALE_MS) continue;
    const id = typeof data["id"] === "string" ? data["id"] : p;
    const hours = (ageMs / 3_600_000).toFixed(1);
    return (
      `traditio reminder: ${id} handoff is ${hours}h old` +
      ` (next: ${String(traditio["next"] ?? "")}, blocked_on: ${String(traditio["blocked_on"] ?? "")})`
    );
  }
  return undefined;
}

function handleTool(studio: string, sella: string, payload: Record<string, unknown>, now: Date): HooksResult {
  const manifest = readManifestSafe(studio);
  if (!manifest) {
    console.error(`hook-event tool: ${studio} is not a studio`);
    return { exitCode: 0 };
  }
  const toolName = stringField(payload, "tool_name") ?? "";
  const toolInput = payload["tool_input"];
  const rawFilePath = isDict(toolInput) && typeof toolInput["file_path"] === "string" ? (toolInput["file_path"] as string) : undefined;

  const logPath = join(studio, EVENTS_LOG_REL);
  const seq = readLog(logPath).events.length;
  const attrs: Record<string, string | number | boolean> = {
    [WF.ACTOR_ROLE]: sella,
    "tool.name": toolName,
    [WF.SOURCE]: "hook",
    [WF.SOURCE_SEQ]: seq,
  };
  // A Write/Edit file_path is a path, not a secret — but a model can be
  // asked to write literally anything, including a line with a token/key/
  // secret/password embedded in it (e.g. a query-string-shaped path); mask
  // it the same way receipts.ts masks a run's argv before it lands on disk.
  if (rawFilePath !== undefined) attrs["tool.file_path"] = redact(rawFilePath);

  const event: GantryEvent = {
    id: `hook:${seq}`,
    name: "workflow.tool_used",
    ts: now.toISOString(),
    projectId: projectIdFor(manifest),
    attrs,
  };
  appendEvents(logPath, [event]);
  return { exitCode: 0 };
}

function handleCompact(studio: string, sella: string, payload: Record<string, unknown>, now: Date): HooksResult {
  const path = join(studio, "timeline", `${sella}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const trigger = stringField(payload, "trigger");
  // Redacted the same way talk.ts's timeline entries and tick.ts's daily
  // acta are (and hook-event tool's file_path above) — `trigger` comes
  // straight from the hook payload and a harness is free to hand back
  // anything, including a secret-shaped string, so it must not land on
  // disk in plaintext.
  const text = redact(`context compacted${trigger ? ` (${trigger})` : ""}`);
  const sessionId = redact(stringField(payload, "session_id") ?? "");
  const entry = {
    at: now.toISOString(),
    sella,
    direction: "out" as const,
    kind: "compact",
    text,
    sessionId,
  };
  appendFileSync(path, JSON.stringify(entry) + "\n");
  return { exitCode: 0 };
}
