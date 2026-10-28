/**
 * W-430 rows (studio/briefs/W-430.md): usage in the records. A usage reading reads both plans from their own sources (b1);
 * `next --perform` appends one at every rung it performs and prints it (b2); the opus's cost from the readings is printed
 * and its checkpoint row must carry it (b3); past the context wind-down a dispatch order waits (b4); `tick` and
 * `next --all` print the Codex burn the rest of the week needs (b5). node:test TAP, selected by
 * `--test-name-pattern='^W-430-b<k>\s'`. Each row writes its own home (the status-line file, the Codex session logs, the
 * readings file) and, where it runs the verb, its own fixture officina (next-world.test.ts's `world`) under the OS tmp
 * dir; nothing here reads or writes `studio/`, `examples/` (b5 copies examples/sample-studio first) or the real home.
 */
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { BRIEF_REL, NOW_ISO, OPUS, briefText, git, next, put, ran, world } from "./next-world.test.js";

const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const scratchHome = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `w430-${tag}-`));
  made.push(d);
  return d;
};
const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

type Dict = Record<string, unknown>;
interface Reading {
  at: string;
  label: string;
  opus?: string;
  step?: string;
  codex_week_used: number | null;
  codex_resets: number | null;
  codex_from: string | null;
  codex_seen: string | null;
  claude_5h_used: number | null;
  claude_week_used: number | null;
  claude_seen: string | null;
  context_tokens: number | null;
}
interface Cost {
  claude: number | null;
  codex: number | null;
  hours: number;
  readings: number;
}
interface Mod {
  takeReading: (home: string, now: Date, label: string, rung?: { opus: string; step: string }) => Reading;
  readingLine: (r: Reading) => string;
  opusCost: (readings: Reading[], id: string) => Cost | undefined;
  costPhrase: (c: Cost) => string;
  codexBurnLine: (r: Reading, now: Date) => string;
}
// a module the tree does not hold yet is an assertion failure of the row, never a module-load failure of the file
const SPEC = "./usage-reading.js";
const load = async (): Promise<Partial<Mod>> => (await import(SPEC).catch(() => ({}))) as Partial<Mod>;
const fn = <K extends keyof Mod>(m: Partial<Mod>, k: K): Mod[K] => {
  assert.equal(typeof m[k], "function", `usage-reading.ts exports ${k}`);
  return m[k] as Mod[K];
};

const RESETS = 1793599153; // 2026-11-02T05:59:13Z
const RESETS_ISO = "2026-11-02T05:59:13Z";
/** The Patron's status-line file, as it writes it. */
function claudeFile(home: string, at: string, o: { five?: number; week?: number; ctx?: [number, number, number] } = {}): void {
  const [input, creation, read] = o.ctx ?? [2, 242, 171074];
  write(
    join(home, ".bisellium-evidence", "usage", "claude-latest.json"),
    JSON.stringify({
      at,
      rl: { five_hour: { used_percentage: o.five ?? 20, resets_at: 1793159400 }, seven_day: { used_percentage: o.week ?? 85, resets_at: 1793253600 } },
      ctx: { total_input_tokens: input + creation + read, total_output_tokens: 312, context_window_size: 1000000, current_usage: { input_tokens: input, output_tokens: 312, cache_creation_input_tokens: creation, cache_read_input_tokens: read }, used_percentage: 17 },
    }),
  );
}
/** A Codex token_count line, as a session log holds it. */
const tokenCount = (timestamp: string, primary: Dict | null, secondary: Dict | null = null): string =>
  JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count", info: null, rate_limits: { limit_id: "codex", primary, secondary, credits: { has_credits: false }, plan_type: "prolite" } } });
const week = (used: number, resets = RESETS): Dict => ({ used_percent: used, window_minutes: 10080, resets_at: resets });
/** A session log under `<home>/.codex/sessions/<day>/`, its mtime `ageMs` before `now`. */
function codexLog(home: string, day: string, name: string, lines: string[], now: Date, ageMs: number): void {
  const p = join(home, ".codex", "sessions", day, name);
  write(p, lines.join("\n") + "\n");
  const t = new Date(now.getTime() - ageMs);
  utimesSync(p, t, t);
}
/** The usual Codex logs: the newest holds no rate_limits, the next its week at 61% (an earlier 58% line before it, a
 *  later line with no week after it), and an older one 50%. */
function codexLogs(home: string, now: Date): void {
  codexLog(home, "2026/10/27", "rollout-old.jsonl", [tokenCount("2026-10-27T20:00:00.000Z", week(50))], now, 7_200_000);
  codexLog(home, "2026/10/28", "rollout-mid.jsonl", [tokenCount("2026-10-28T01:00:00.000Z", week(58)), tokenCount("2026-10-28T01:30:00.000Z", week(61)), tokenCount("2026-10-28T01:31:00.000Z", null), '{"timestamp":"torn'], now, 3_600_000);
  codexLog(home, "2026/10/28", "rollout-new.jsonl", [JSON.stringify({ timestamp: "2026-10-28T01:50:00.000Z", type: "response_item", payload: { type: "message" } })], now, 600_000);
}
const readingsOf = (home: string): Dict[] => {
  const p = join(home, ".bisellium-evidence", "usage", "readings.jsonl");
  return existsSync(p) ? readFileSync(p, "utf8").trimEnd().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Dict) : [];
};
const lineOf = (out: string, prefix: string): string | undefined => out.split("\n").find((l) => l.startsWith(prefix));

test("W-430-b1 behaviour 1: a usage reading reads Claude's 5h, week and context from the status-line file and Codex's week from the newest session log that holds one, null where a source cannot be read", async () => {
  const m = await load();
  const takeReading = fn(m, "takeReading");
  const readingLine = fn(m, "readingLine");
  const now = new Date("2026-10-28T02:00:00.000Z");
  const home = scratchHome("b1");
  claudeFile(home, "2026-10-28T01:59:00.000Z");
  codexLogs(home, now);
  const r = takeReading(home, now, "probe");
  assert.deepEqual(r, {
    at: "2026-10-28T02:00:00.000Z",
    label: "probe",
    codex_week_used: 61,
    codex_resets: RESETS,
    codex_from: "rollout-mid.jsonl",
    codex_seen: "2026-10-28T01:30:00.000Z",
    claude_5h_used: 20,
    claude_week_used: 85,
    claude_seen: "2026-10-28T01:59:00.000Z",
    context_tokens: 171318,
  }, "both plans read: the newest log with a week rate_limits, its last such line; the context is the current input, cache-creation and cache-read tokens");
  assert.equal(readingLine(r), `usage: Claude 5h 20%, week 85%, context 171318 tokens; Codex week 61%, resets ${RESETS_ISO}`, "the reading as one line");
  assert.deepEqual(takeReading(home, now, "rung", { opus: "W-1", step: "branch" }), { ...r, label: "rung", opus: "W-1", step: "branch" }, "a rung reading names its opus and step");

  // the week window is whichever of primary and secondary is a week
  const second = scratchHome("b1-secondary");
  codexLog(second, "2026/10/28", "rollout-s.jsonl", [tokenCount("2026-10-28T01:00:00.000Z", { used_percent: 9, window_minutes: 300, resets_at: 1 }, week(40))], now, 60_000);
  assert.equal(takeReading(second, now, "s").codex_week_used, 40, "a five-hour primary beside a week secondary: the secondary");
  assert.equal(takeReading(second, now, "s").claude_seen, null, "no status-line file: Claude unread");

  // nothing to read: every value null, said so
  const empty = scratchHome("b1-empty");
  const e = takeReading(empty, now, "none");
  assert.deepEqual([e.codex_week_used, e.codex_resets, e.codex_from, e.codex_seen, e.claude_5h_used, e.claude_week_used, e.claude_seen, e.context_tokens], [null, null, null, null, null, null, null, null], "no sources: nulls, no throw");
  assert.equal(readingLine(e), "usage: Claude unread (no status-line file); Codex unread (no session log holds a week rate_limits)", "an unread source is said so");

  // a stale status line is kept and marked; a malformed one reads as unread
  const stale = scratchHome("b1-stale");
  claudeFile(stale, "2026-10-28T01:29:00.000Z");
  assert.equal(readingLine(takeReading(stale, now, "stale")), "usage: Claude 5h 20%, week 85%, context 171318 tokens (stale: seen 2026-10-28T01:29:00.000Z); Codex unread (no session log holds a week rate_limits)", "seen 31 minutes before the reading: stale");
  write(join(stale, ".bisellium-evidence", "usage", "claude-latest.json"), "{ not json");
  assert.equal(takeReading(stale, now, "bad").claude_seen, null, "a malformed status-line file: unread");
});
