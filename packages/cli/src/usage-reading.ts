/**
 * packages/cli/src/usage-reading.ts — W-430: usage in the records. One usage reading is the two plans' use as their own
 * sources state it: Claude's 5-hour and week percentages and the session's context tokens from the status-line file the
 * Patron's statusLine command writes (`~/.bisellium-evidence/usage/claude-latest.json`), and Codex's week percentage and
 * reset from the newest Codex session log's last `rate_limits` (`~/.codex/sessions/**.jsonl`). A source that cannot be
 * read gives nulls, never a throw. `next --perform` appends a reading at every rung it performs to
 * `~/.bisellium-evidence/usage/readings.jsonl` (the file `usage-reading.sh` appends to, the same line shape) and prints
 * it with the opus's cost so far; `done` asks the checkpoint row to carry that cost; a dispatch order is held past
 * CONTEXT_WIND_DOWN context tokens; `tick` and `next --all` print the Codex burn the rest of the week needs. See
 * studio/briefs/W-430.md.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { instant } from "@bisellium/schema";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The evidence folder under a home, and the usage folder in it. */
const EVIDENCE = ".bisellium-evidence";
const USAGE = "usage";
const CLAUDE_FILE = "claude-latest.json";
/** A status-line reading older than this is stale: its values are kept, but no hold reads them. */
export const STALE_MS = 30 * 60_000;
/** Codex's week window, in minutes, as its `rate_limits` name it. */
const WEEK_MINUTES = 10_080;
/** The newest session logs read for a `rate_limits`, newest first, and the bytes each may hold. */
const CODEX_FILES = 3;
const CODEX_MAX = 256 * 1024 * 1024;
const CLAUDE_MAX = 64 * 1024;

/** One reading. The field names are `usage-reading.sh`'s, so its lines and next's read alike; `opus` and `step` name
 *  the rung a `next --perform` reading was taken at. */
export interface Reading {
  at: string;
  label: string;
  opus?: string;
  step?: string;
  codex_week_used: number | null;
  /** Epoch seconds. */
  codex_resets: number | null;
  codex_from: string | null;
  codex_seen: string | null;
  claude_5h_used: number | null;
  claude_week_used: number | null;
  claude_seen: string | null;
  context_tokens: number | null;
}

/** The status-line file's Claude values: its `rl` percentages, its `ctx.current_usage` input, cache-creation and
 *  cache-read tokens summed (the context the next turn sends), and its `at`. Each is null when absent or malformed. */
function claudeReading(home: string): Pick<Reading, "claude_5h_used" | "claude_week_used" | "claude_seen" | "context_tokens"> {
  const none = { claude_5h_used: null, claude_week_used: null, claude_seen: null, context_tokens: null };
  const file = readContainedRegularFile(join(home, EVIDENCE), `${USAGE}/${CLAUDE_FILE}`, USAGE, CLAUDE_MAX);
  if ("error" in file) return none;
  let doc: unknown;
  try {
    doc = JSON.parse(file.bytes.toString("utf8"));
  } catch {
    return none;
  }
  if (!isDict(doc)) return none;
  const rl = isDict(doc["rl"]) ? doc["rl"] : {};
  const pct = (k: string): number | null => (isDict(rl[k]) ? num((rl[k] as Dict)["used_percentage"]) : null);
  const ctx = isDict(doc["ctx"]) && isDict(doc["ctx"]["current_usage"]) ? doc["ctx"]["current_usage"] : undefined;
  const parts = ctx === undefined ? [] : ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].map((k) => num(ctx[k]));
  const seen = instant(doc["at"]);
  return {
    claude_5h_used: pct("five_hour"),
    claude_week_used: pct("seven_day"),
    claude_seen: seen ? seen.toISOString() : null,
    context_tokens: parts.length === 3 && parts.every((p) => p !== null) ? parts.reduce<number>((a, b) => a + (b ?? 0), 0) : null,
  };
}

/** The week window of one `rate_limits` (its primary or secondary whose window is a week), or undefined. */
function weekWindow(rl: unknown): { used: number; resets: number } | undefined {
  if (!isDict(rl)) return undefined;
  for (const k of ["primary", "secondary"]) {
    const w = rl[k];
    if (!isDict(w) || w["window_minutes"] !== WEEK_MINUTES) continue;
    const used = num(w["used_percent"]);
    const resets = num(w["resets_at"]);
    if (used !== null && resets !== null) return { used, resets };
  }
  return undefined;
}

/** Codex's week from the newest session logs under `<home>/.codex/sessions` (by mtime, up to CODEX_FILES): the last line
 *  of the first that holds a week `rate_limits`. Nulls when none does or the folder cannot be read. */
function codexReading(home: string): Pick<Reading, "codex_week_used" | "codex_resets" | "codex_from" | "codex_seen"> {
  const none = { codex_week_used: null, codex_resets: null, codex_from: null, codex_seen: null };
  const root = join(home, ".codex");
  let files: { rel: string; mtimeMs: number }[];
  try {
    files = readdirSync(join(root, "sessions"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => {
        const rel = join(e.parentPath, e.name).slice(root.length + 1);
        return { rel, mtimeMs: statSync(join(root, rel)).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.rel.localeCompare(a.rel));
  } catch {
    return none;
  }
  for (const f of files.slice(0, CODEX_FILES)) {
    const file = readContainedRegularFile(root, f.rel, "sessions", CODEX_MAX);
    if ("error" in file) continue;
    const text = file.bytes.toString("utf8");
    for (let end = text.length; end > 0; ) {
      const at = text.lastIndexOf('"rate_limits"', end);
      if (at < 0) break;
      const start = text.lastIndexOf("\n", at) + 1;
      const stop = text.indexOf("\n", at);
      end = start - 1;
      let line: unknown;
      try {
        line = JSON.parse(text.slice(start, stop < 0 ? text.length : stop));
      } catch {
        continue;
      }
      const payload = isDict(line) && isDict(line["payload"]) ? line["payload"] : undefined;
      const week = weekWindow(payload?.["rate_limits"]);
      if (week === undefined) continue;
      const seen = instant(isDict(line) ? line["timestamp"] : undefined);
      return { codex_week_used: week.used, codex_resets: week.resets, codex_from: f.rel.split("/").pop() ?? f.rel, codex_seen: seen ? seen.toISOString() : null };
    }
  }
  return none;
}

/** A reading of both plans at `now`, labelled; reads only. */
export function takeReading(home: string, now: Date, label: string, rung?: { opus: string; step: string }): Reading {
  return { at: now.toISOString(), label, ...(rung ?? {}), ...codexReading(home), ...claudeReading(home) };
}

/** True when the status-line values were seen within STALE_MS of the reading. */
export function claudeFresh(r: Reading): boolean {
  const seen = instant(r.claude_seen);
  const at = instant(r.at);
  return seen !== undefined && at !== undefined && at.getTime() - seen.getTime() <= STALE_MS && seen.getTime() - at.getTime() <= STALE_MS;
}

const pctText = (v: number | null): string => (v === null ? "unread" : `${v}%`);
const isoSec = (epochSeconds: number): string => new Date(epochSeconds * 1000).toISOString().replace(/\.000Z$/, "Z");

/** The reading as one line: `usage: Claude 5h 20%, week 85%, context 171318 tokens; Codex week 61%, resets <iso>`, a
 *  stale status line marked with when it was seen, an unread value as `unread`. */
export function readingLine(r: Reading): string {
  const claude =
    r.claude_seen === null
      ? "Claude unread (no status-line file)"
      : `Claude 5h ${pctText(r.claude_5h_used)}, week ${pctText(r.claude_week_used)}, context ${r.context_tokens === null ? "unread" : `${r.context_tokens} tokens`}${claudeFresh(r) ? "" : ` (stale: seen ${r.claude_seen})`}`;
  const codex = r.codex_week_used === null ? "Codex unread (no session log holds a week rate_limits)" : `Codex week ${pctText(r.codex_week_used)}, resets ${r.codex_resets === null ? "unread" : isoSec(r.codex_resets)}`;
  return `usage: ${claude}; ${codex}`;
}
