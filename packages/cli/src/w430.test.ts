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

test("W-430-b2 behaviour 2: next --perform appends one usage reading at the rung it performs, labelled with the opus and step, and prints it; a report run appends none", { timeout: 600_000 }, () => {
  const w = world("w430-b2", "spec");
  const now = new Date(NOW_ISO);
  claudeFile(w.home, NOW_ISO);
  codexLogs(w.home, now);
  const report = next(w, [OPUS]);
  assert.equal(report.first, `next: ${OPUS} branch named`, ran("control: branch is the next rung", report));
  assert.deepEqual(readingsOf(w.home), [], ran("a report run appends no reading", report));
  const o = next(w, [OPUS, "--perform", "--expect", "branch"]);
  assert.equal(o.first, `next: ${OPUS} branch performed`, ran("the rung is performed", o));
  const all = readingsOf(w.home);
  assert.equal(all.length, 1, ran("one reading appended", o));
  assert.deepEqual(all[0], {
    at: NOW_ISO,
    label: `${OPUS} branch`,
    opus: OPUS,
    step: "branch",
    codex_week_used: 61,
    codex_resets: RESETS,
    codex_from: "rollout-mid.jsonl",
    codex_seen: "2026-10-28T01:30:00.000Z",
    claude_5h_used: 20,
    claude_week_used: 85,
    claude_seen: NOW_ISO,
    context_tokens: 171318,
  }, ran("the reading: at the verb's clock, both plans, the rung named", o));
  assert.equal(lineOf(o.out, "usage: "), `usage: Claude 5h 20%, week 85%, context 171318 tokens; Codex week 61%, resets ${RESETS_ISO}`, ran("printed as its line", o));

  // a reading that cannot be recorded is said so, and the rung is still performed
  const s = world("w430-b2-symlink", "spec");
  const elsewhere = scratchHome("b2-elsewhere");
  mkdirSync(join(s.home, ".bisellium-evidence"), { recursive: true });
  symlinkSync(elsewhere, join(s.home, ".bisellium-evidence", "usage"));
  const held = next(s, [OPUS, "--perform", "--expect", "branch"]);
  assert.equal(held.first, `next: ${OPUS} branch performed`, ran("a symlinked usage folder: the rung is still performed", held));
  assert.match(lineOf(held.out, "usage-error: ") ?? "", /^usage-error: the reading was not recorded: \S/, ran("and the reading's failure is printed", held));
  assert.equal(existsSync(join(elsewhere, "readings.jsonl")), false, "nothing written through the symlink");
});

test("W-430-b3 behaviour 3: an opus's cost is the plan use of the reading intervals its rungs close; next --perform prints it and done asks its checkpoint row to carry it", { timeout: 600_000 }, async () => {
  // the perform prints the cost so far, the reading it just took included
  const w = world("w430-b3", "spec");
  claudeFile(w.home, NOW_ISO, { week: 85 });
  codexLogs(w.home, new Date(NOW_ISO));
  write(join(w.home, ".bisellium-evidence", "usage", "readings.jsonl"), JSON.stringify({ at: "2026-10-02T10:00:00.000Z", label: "before", codex_week_used: 55, claude_week_used: 80 }) + "\n");
  const o = next(w, [OPUS, "--perform", "--expect", "branch"]);
  assert.equal(o.first, `next: ${OPUS} branch performed`, ran("the rung is performed", o));
  assert.equal(lineOf(o.out, "cost: "), "cost: Claude week +5%, Codex week +6% over 0.0 h", ran("its cost: the interval its reading closes", o));

  const m = await load();
  const opusCost = fn(m, "opusCost");
  const costPhrase = fn(m, "costPhrase");
  const at = (h: number): string => new Date(Date.UTC(2026, 9, 28, h)).toISOString();
  const r = (h: number, opus: string | undefined, claude: number | null, codex: number | null): Reading =>
    ({ at: at(h), label: opus ?? "script", ...(opus === undefined ? {} : { opus, step: "x" }), codex_week_used: codex, codex_resets: null, codex_from: null, codex_seen: null, claude_5h_used: null, claude_week_used: claude, claude_seen: null, context_tokens: null }) as Reading;
  const lines = [r(0, "W-1", 10, 20), r(1, "W-2", 12, 25), r(2, "W-1", 15, 27), r(3, undefined, 16, 30), r(4, "W-1", 3, 31), r(5, "W-2", null, 33)];
  assert.deepEqual(opusCost(lines, "W-1"), { claude: 6, codex: 3, hours: 4, readings: 3 }, "W-1 closes 1->2 (+3, +2) and 3->4 (a reset: +3, then +1); its first reading closes none");
  assert.deepEqual(opusCost(lines, "W-2"), { claude: 2, codex: 7, hours: 4, readings: 2 }, "W-2 closes 0->1 (+2, +5) and 4->5 (Claude unread: no rise; +2)");
  assert.equal(opusCost(lines, "W-3"), undefined, "no reading names it: no cost");
  assert.equal(costPhrase({ claude: 6, codex: 3, hours: 4, readings: 3 }), "Claude week +6%, Codex week +3% over 4.0 h");
  assert.equal(costPhrase({ claude: null, codex: 2.25, hours: 0.25, readings: 1 }), "Claude week unread, Codex week +2.3% over 0.3 h");

  // done's history-row check: the row naming the opus carries its cost, when the readings name it
  const { historyRowRefusal } = (await import("./next.js")) as { historyRowRefusal: (repo: string, id: string, home?: string) => string | undefined };
  const repo = scratchHome("b3-repo");
  const HISTORY = "docs/design/dossier/progress-body.html";
  git(repo, ["init", "-q", "-b", "master"]);
  write(join(repo, HISTORY), "<table>\n</table>\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "history"]);
  const home = scratchHome("b3-home");
  write(join(home, ".bisellium-evidence", "usage", "readings.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const row = (text: string): void => write(join(repo, HISTORY), `<table>\n${text}\n</table>\n`);
  row("<tr><td>W-1 shipped</td><td>Cycle about 240 min</td></tr>");
  assert.equal(historyRowRefusal(repo, "W-1", home), `the checkpoint row naming W-1 carries no cost: add "Claude week +6%, Codex week +3% over 4.0 h" beside its hours (W-430: its plan cost from the usage readings), then re-run`, "a row without the cost: refused, naming the phrase");
  row("<tr><td>W-1 shipped</td><td>Cycle about 240 min; Claude week +6%, Codex week +3% over 4.0 h</td></tr>");
  assert.equal(historyRowRefusal(repo, "W-1", home), undefined, "the row carries it: done may commit");
  // a done held and run again: its own done readings leave the phrase as it was; a cost that read neither plan asks none
  writeFileSync(join(home, ".bisellium-evidence", "usage", "readings.jsonl"), [...lines, { ...r(6, "W-1", 40, 50), step: "done" }, r(7, "W-4", null, null), r(8, "W-4", null, null)].map((l) => JSON.stringify(l)).join("\n") + "\n");
  row("<tr><td>W-1 shipped</td><td>Cycle about 240 min</td></tr>");
  assert.match(historyRowRefusal(repo, "W-1", home) ?? "", /add "Claude week \+6%, Codex week \+3% over 4\.0 h" beside its hours/, "a held done's own reading leaves the phrase as it was");
  row("<tr><td>W-4 shipped</td><td>Cycle about 30 min</td></tr>");
  assert.equal(historyRowRefusal(repo, "W-4", home), undefined, "a cost that read neither plan asks none");
  row("<tr><td>W-3 shipped</td><td>Cycle about 30 min</td></tr>");
  assert.equal(historyRowRefusal(repo, "W-3", home), undefined, "no reading names W-3: no cost is asked");
  row("<tr><td>W-2 shipped</td></tr>");
  assert.match(historyRowRefusal(repo, "W-1", home) ?? "", /adds no history row naming W-1; add it, then re-run$/, "no row names it: W-214's refusal, unchanged");
});

test("W-430-b4 behaviour 4: past 300000 context tokens on a fresh status line a dispatch order waits, telling the session to let running work finish and refresh the handoff; a rung the verb performs still runs", { timeout: 600_000 }, () => {
  const w = world("w430-b4", "greenlight");
  put(w.repo, BRIEF_REL, briefText(w.behaviours));
  const order = (): ReturnType<typeof next> => next(w, [OPUS, "--budget", "100000"]);
  const named = order();
  assert.equal(named.first, `next: ${OPUS} spec named`, ran("control: no status-line file, the spec order is named", named));
  assert.equal(named.kv.get("role"), "architect", ran("control: an architect order", named));
  claudeFile(w.home, NOW_ISO, { ctx: [0, 0, 299_999] });
  assert.equal(order().first, `next: ${OPUS} spec named`, "299999 tokens: named");
  claudeFile(w.home, NOW_ISO, { ctx: [1, 0, 299_999] });
  const held = order();
  assert.equal(held.first, `next: ${OPUS} spec held`, ran("300000 tokens: held", held));
  assert.equal(held.status, 1, ran("held exits 1", held));
  assert.equal(held.kv.get("why"), "context 300000 tokens is past 300000: let running tasks finish, refresh the session handoff, and start no new work (W-430)", ran("the wind-down why", held));
  assert.equal(held.kv.has("command"), false, ran("no dispatch command is named", held));
  claudeFile(w.home, "2026-10-02T11:29:00.000Z", { ctx: [1, 0, 399_999] });
  assert.equal(order().first, `next: ${OPUS} spec named`, "a status line 31 minutes old holds nothing");

  // a rung the verb performs is running work: it still runs
  const p = world("w430-b4-perform", "spec");
  claudeFile(p.home, NOW_ISO, { ctx: [0, 0, 400_000] });
  const performed = next(p, [OPUS, "--perform", "--expect", "branch"]);
  assert.equal(performed.first, `next: ${OPUS} branch performed`, ran("past the wind-down, the branch rung is still performed", performed));
});

test("W-430-b5 behaviour 5: tick and next --all print the Codex burn the rest of the week needs against the time left to its reset", { timeout: 600_000 }, async () => {
  const { runTick } = (await import("./tick.js")) as { runTick: (args: string[], opts: Dict) => Promise<{ exitCode: number }> };
  const studio = scratchHome("b5-studio");
  cpSync(join(dirname(new URL(import.meta.url).pathname), "..", "..", "..", "examples", "sample-studio"), studio, { recursive: true });
  const now = new Date("2026-10-28T02:00:00.000Z");
  const home = scratchHome("b5-home");
  codexLogs(home, now);
  const capture = async (args: string[], h: string): Promise<string[]> => {
    const logs: string[] = [];
    const real = console.log;
    console.log = (...a: unknown[]): void => void logs.push(a.map(String).join(" "));
    try {
      await runTick(args, { now, home: h, listModels: async () => [], versions: async () => ({}) });
    } finally {
      console.log = real;
    }
    return logs;
  };
  const LINE = `codex: week 61% used, resets ${RESETS_ISO} (124.0 h left): 0.31%/h (7.5%/day) uses the rest`;
  const dry = await capture(["--studio", studio, "--dry-run"], home);
  assert.equal(dry.filter((l) => l.startsWith("codex: ")).length, 1, `tick --dry-run: one codex line: ${dry.join(" | ")}`);
  assert.equal(dry.find((l) => l.startsWith("codex: ")), LINE, "39% left over 124.0 h");
  write(join(studio, "bisellium.yml"), readFileSync(join(studio, "bisellium.yml"), "utf8").replace(/\{ id: ([a-z-]+), name: /g, "{ id: $1, autonomy: L0, name: "));
  const acted = await capture(["--studio", studio], home);
  assert.equal(acted.find((l) => l.startsWith("codex: ")), LINE, `tick: the same line: ${acted.join(" | ")}`);
  assert.equal((await capture(["--studio", studio, "--dry-run"], scratchHome("b5-none"))).find((l) => l.startsWith("codex: ")), "codex: unread (no session log holds a week rate_limits)", "no session log: unread");
  const past = scratchHome("b5-past");
  codexLog(past, "2026/10/28", "rollout-p.jsonl", [tokenCount("2026-10-20T01:00:00.000Z", week(97, 1790000000))], now, 60_000);
  assert.equal((await capture(["--studio", studio, "--dry-run"], past)).find((l) => l.startsWith("codex: ")), "codex: the week read at 2026-10-20T01:00:00.000Z reset at 2026-09-21T14:13:20Z; no reading since", "the week has reset since the last reading");

  // next --all, on the real clock: the same line before the open count
  const w = world("w430-b5", "greenlight");
  const resets = Math.floor(Date.now() / 1000) + 100 * 3600;
  codexLog(w.home, "2026/10/28", "rollout-a.jsonl", [tokenCount("2026-10-28T01:00:00.000Z", week(61, resets))], new Date(), 60_000);
  const all = next(w, ["--all"], { clock: false });
  const lines = all.out.trimEnd().split("\n");
  assert.equal(all.status, 0, ran("next --all exits 0", all));
  assert.match(lines.at(-2) ?? "", /^codex: week 61% used, resets \S+Z \((99\.9|100\.0) h left\): 0\.39%\/h \(9\.4%\/day\) uses the rest$/, ran("the codex line, before the open count", all));
  assert.equal(lines.at(-1), "open: 1", ran("then the open count", all));
});
