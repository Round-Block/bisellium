/**
 * W-495: done computes its own checkpoint figures. Rows W-495-b1 to W-495-b4, one per behaviour of studio/briefs/W-495.md:
 * the plans' whole use over a span of readings (b1), the row's figures from the record timestamps and the readings (b2),
 * done writing them into the history row's slot (b3), and the rung's cost line read over the same span (b4). Each row
 * writes its own home and repositories under the OS tmp dir; nothing reads or writes studio/, examples/ or the real home.
 * A module the tree does not hold yet is an assertion failure of the row, never a module-load failure of the file.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { NOW_ISO, OPUS, T, branchExists, commit, expectHeld, expectStep, git, mergedList, next, outLines, put, ran, scenario, touchHandoff, world } from "./next-world.test.js";

const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
const scratchHome = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `w495-${tag}-`));
  made.push(d);
  return d;
};
const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

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
  claude_resets?: number | null;
}
interface Cost {
  claude: number | null;
  codex: number | null;
  hours: number;
  readings: number;
}
interface UsageMod {
  takeReading: (home: string, now: Date, label: string) => Reading;
  spanCost: (readings: Reading[], from: number, to: number) => Cost;
}
interface SpecLogs {
  read(rel: string): string | undefined;
  list(dir: string): string[];
}
type Figures = { sentence: string; cycle: number; lead: number; cost: Cost } | { missing: string[] };
interface CheckpointMod {
  FIGURES_SLOT: string;
  firstSpecSignature: (id: string, sources: (SpecLogs | undefined)[]) => Date | undefined;
  checkpointFigures: (i: { id: string; spec: Date | undefined; greenlit: Date | undefined; land: Date | undefined; readings: Reading[] | { error: string } }) => Figures;
  fillFigures: (page: string, id: string, sentence: string) => { page: string; filled: number };
}
const USAGE = "./usage-reading.js";
const CHECKPOINT = "./checkpoint.js";
const loadUsage = async (): Promise<Partial<UsageMod>> => (await import(USAGE).catch(() => ({}))) as Partial<UsageMod>;
const loadCheckpoint = async (): Promise<Partial<CheckpointMod>> => (await import(CHECKPOINT).catch(() => ({}))) as Partial<CheckpointMod>;
function fn<M, K extends keyof M>(m: Partial<M>, k: K, file: string): M[K] {
  assert.equal(typeof m[k], "function", `${file} exports ${String(k)}`);
  return m[k] as M[K];
}

/** A reading line; `opus` undefined is the script's (no opus, no step). */
const reading = (at: string, opus: string | undefined, claude: number | null, codex: number | null, o: { codexResets?: number | null; claudeResets?: number } = {}): Reading => ({
  at,
  label: opus === undefined ? "script" : `${opus} x`,
  ...(opus === undefined ? {} : { opus, step: "x" }),
  codex_week_used: codex,
  codex_resets: o.codexResets === undefined ? R1 : o.codexResets,
  codex_from: null,
  codex_seen: null,
  claude_5h_used: null,
  claude_week_used: claude,
  claude_seen: null,
  context_tokens: null,
  ...(o.claudeResets === undefined ? {} : { claude_resets: o.claudeResets }),
});
const R1 = 1793774557; // a Codex week reset (2026-11-08T...)
const R2 = R1 + 7 * 86_400;
const ms = (iso: string): number => Date.parse(iso);
const stamp = (d: Date): string => `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}Z`;
const TAIL = "(the plans' whole use in the cycle, every lane's, from the usage readings).";

/** The Patron's status-line file, its week at `week` resetting at `resets`. */
function claudeFile(home: string, at: string, week: number, resets: number): void {
  write(
    join(home, ".bisellium-evidence", "usage", "claude-latest.json"),
    JSON.stringify({ at, rl: { five_hour: { used_percentage: 20, resets_at: resets - 86_400 }, seven_day: { used_percentage: week, resets_at: resets } }, ctx: { current_usage: { input_tokens: 2, cache_creation_input_tokens: 242, cache_read_input_tokens: 171074 } } }),
  );
}
/** One Codex session log whose last line holds a week at `used`, resetting at `resets`. */
function codexLog(home: string, seen: string, used: number, resets: number): void {
  const p = join(home, ".codex", "sessions", "2026", "10", "02", "rollout-a.jsonl");
  write(p, JSON.stringify({ timestamp: seen, type: "event_msg", payload: { type: "token_count", rate_limits: { primary: null, secondary: { used_percent: used, window_minutes: 10080, resets_at: resets } } } }) + "\n");
  const t = new Date(ms(seen));
  utimesSync(p, t, t);
}
const readingsFile = (home: string): string => join(home, ".bisellium-evidence", "usage", "readings.jsonl");
const putReadings = (home: string, lines: Reading[]): void => write(readingsFile(home), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

test("W-495-b1 behaviour 1: the plans' whole use over a span is read from every reading in it, from the last one at or before its start; a stale source's fall counts nothing, a moved week reset counts the new week", async () => {
  const m = await loadUsage();
  const spanCost = fn(m, "spanCost", "usage-reading.ts");
  // W-494's shape (readings.jsonl, 2026-11-01): each rung reading comes seconds after a script reading, so the intervals its
  // rungs close read +0; the use sits in the intervals the script's readings close, and the span counts them
  const w494 = [
    reading("2026-11-01T12:56:48Z", undefined, 51, 78),
    reading("2026-11-01T13:35:27Z", undefined, 51, 79),
    reading("2026-11-01T13:35:45Z", "W-494", 51, 79),
    reading("2026-11-01T13:38:17Z", undefined, 52, 79),
    reading("2026-11-01T14:09:06Z", undefined, 52, 79),
    reading("2026-11-01T14:09:09Z", "W-494", 52, 79),
    reading("2026-11-01T15:00:46Z", undefined, 53, 79),
    reading("2026-11-01T15:09:49Z", undefined, 53, 80),
    reading("2026-11-01T15:28:10Z", undefined, 53, 80),
    reading("2026-11-01T15:32:44Z", "W-494", 53, 80),
    reading("2026-11-02T01:00:19Z", undefined, 54, 80),
  ];
  const span = spanCost(w494, ms("2026-11-01T12:57:17Z"), ms("2026-11-01T15:35:02Z"));
  assert.deepEqual(span, { claude: 2, codex: 2, hours: (ms("2026-11-01T15:35:02Z") - ms("2026-11-01T12:57:17Z")) / 3_600_000, readings: 9 }, "the script's readings are counted: the use between the opus's rung readings is in the span, from the last reading before it");
  // a stale Codex log (another session's older line, the same week) dips and comes back: no reset, no use
  const dip = [reading("2026-11-01T08:01:00Z", undefined, null, 73), reading("2026-11-01T08:02:00Z", undefined, null, 74), reading("2026-11-01T08:04:00Z", undefined, null, 73), reading("2026-11-01T08:06:00Z", undefined, null, 74)];
  assert.equal(spanCost(dip, ms("2026-11-01T08:00:00Z"), ms("2026-11-01T09:00:00Z")).codex, 1, "a fall with the same week reset is a stale source: 73 74 73 74 is +1, not +74");
  // the week reset moves later: the new week's value counts whole; a later line of the old week is passed over
  const reset = [reading("2026-11-01T08:00:00Z", undefined, null, 95), reading("2026-11-01T09:00:00Z", undefined, null, 3, { codexResets: R2 }), reading("2026-11-01T09:30:00Z", undefined, null, 96), reading("2026-11-01T10:00:00Z", undefined, null, 5, { codexResets: R2 })];
  assert.equal(spanCost(reset, ms("2026-11-01T07:00:00Z"), ms("2026-11-01T11:00:00Z")).codex, 5, "a fall with a later week reset is the new week (+3), an old week's line after it is passed over, then +2");
  // Claude's reset is read from claude_resets; the script's lines carry none, so their fall counts nothing until a reading does
  const claude = [
    reading("2026-10-29T05:00:00Z", undefined, 90, null),
    reading("2026-10-29T05:30:00Z", "W-1", 92, null, { claudeResets: 1793253600 }),
    reading("2026-10-29T06:20:00Z", undefined, 1, null),
    reading("2026-10-29T06:40:00Z", undefined, 3, null),
    reading("2026-10-29T07:00:00Z", "W-1", 4, null, { claudeResets: 1793858400 }),
  ];
  assert.equal(spanCost(claude, ms("2026-10-29T05:10:00Z"), ms("2026-10-29T08:00:00Z")).claude, 6, "Claude +2, then a reset read at the first reading whose claude_resets moved: +4");
  // the span's ends: earlier readings than the last one at or before the start, and readings after the end, count nothing
  const ends = [reading("2026-11-01T01:00:00Z", undefined, 10, 10), reading("2026-11-01T02:00:00Z", undefined, 40, 40), reading("2026-11-01T04:00:00Z", undefined, 41, 43), reading("2026-11-01T06:00:00Z", undefined, 70, 70)];
  assert.deepEqual(spanCost(ends, ms("2026-11-01T03:00:00Z"), ms("2026-11-01T05:00:00Z")), { claude: 1, codex: 3, hours: 2, readings: 1 }, "from the last reading at or before the start to the last at or before the end");
  assert.deepEqual(spanCost([reading("2026-11-01T04:00:00Z", undefined, 41, null)], ms("2026-11-01T03:00:00Z"), ms("2026-11-01T05:00:00Z")), { claude: null, codex: null, hours: 2, readings: 1 }, "one value of a plan is no use read: unread");
  // spec review round 2: a stale line of an older week before the start is passed over before it can be the level, and a
  // later reset counts the new week whole even when its first value is not below the old week's
  const staleBefore = [reading("2026-11-01T01:00:00Z", undefined, null, 5, { codexResets: R2 }), reading("2026-11-01T02:00:00Z", undefined, null, 95, { codexResets: R1 }), reading("2026-11-01T04:00:00Z", undefined, null, 6, { codexResets: R2 })];
  assert.equal(spanCost(staleBefore, ms("2026-11-01T03:00:00Z"), ms("2026-11-01T05:00:00Z")).codex, 1, "an older week's line before the start is passed over, not the level: 5, stale 95, 6 is +1");
  const rising = [reading("2026-11-01T01:00:00Z", undefined, null, 2), reading("2026-11-01T04:00:00Z", undefined, null, 3, { codexResets: R2 })];
  assert.equal(spanCost(rising, ms("2026-11-01T03:00:00Z"), ms("2026-11-01T05:00:00Z")).codex, 3, "a later reset whose first value rose (old week 2, new week 3) counts the new week whole: +3");
  const equal = [reading("2026-11-01T01:00:00Z", undefined, null, 3), reading("2026-11-01T04:00:00Z", undefined, null, 3, { codexResets: R2 })];
  assert.equal(spanCost(equal, ms("2026-11-01T03:00:00Z"), ms("2026-11-01T05:00:00Z")).codex, 3, "and one whose first value is equal: +3");
  // a reading carries Claude's week reset from the status line
  const takeReading = fn(m, "takeReading", "usage-reading.ts");
  const home = scratchHome("b1");
  claudeFile(home, "2026-11-01T08:00:00.000Z", 52, 1793858400);
  assert.equal(takeReading(home, new Date("2026-11-01T08:00:00.000Z"), "probe").claude_resets, 1793858400, "a reading carries claude_resets from rl.seven_day.resets_at");
});

test("W-495-b2 behaviour 2: the checkpoint figures are the cycle from the first spec signature to land, the lead from the greenlight to land and the plans' use in the cycle; what is missing is named, never filled in", async () => {
  const m = await loadCheckpoint();
  const checkpointFigures = fn(m, "checkpointFigures", "checkpoint.ts");
  const firstSpecSignature = fn(m, "firstSpecSignature", "checkpoint.ts");
  const fillFigures = fn(m, "fillFigures", "checkpoint.ts");
  const log = (at: string | string[]): string => `# opus: W-494\n# phase: spec\n${(Array.isArray(at) ? at : [at]).map((a) => `# at: ${a}\n`).join("")}\nbody\n`;
  const src = (files: Record<string, string>): SpecLogs => ({ read: (rel) => files[rel.slice(3)], list: () => Object.keys(files) });
  const logs = src({ "W-494-spec-1.log": log("2026-11-01T12:57:17.314Z"), "W-494-spec-2.log": log("2026-11-01T13:20:00.000Z"), "W-4940-spec-1.log": log("2026-11-01T01:00:00.000Z"), "W-494-spec-3.log": log(["2026-11-01T02:00:00.000Z", "2026-11-01T03:00:00.000Z"]), "W-494-review-1.log": log("2026-11-01T00:00:00.000Z") });
  const branch = src({ "W-494-spec-4.log": log("2026-11-01T14:00:00.000Z") });
  const spec = firstSpecSignature("W-494", [undefined, branch, logs]);
  assert.equal(spec?.toISOString(), "2026-11-01T12:57:17.314Z", "the earliest # at of the opus's spec logs, across the sources: not another opus's, not a review log, not a header with two");
  const greenlit = new Date("2026-11-01T11:39:59Z");
  const land = new Date("2026-11-01T15:35:02Z");
  const readings = [reading("2026-11-01T12:56:48Z", undefined, 51, 78), reading("2026-11-01T14:00:00Z", undefined, 52, 79), reading("2026-11-01T15:09:49Z", "W-494", 53, 80), reading("2026-11-01T16:00:00Z", undefined, 60, 90)];
  const fig = checkpointFigures({ id: "W-494", spec, greenlit, land, readings });
  assert.ok("sentence" in fig, `figures computed: ${JSON.stringify(fig)}`);
  assert.equal(fig.sentence, `Cycle 158 min from the first spec signature (11-01 12:57Z) to land (11-01 15:35Z); lead 235 min (0.2 days) from the greenlight (11-01 11:39Z); Claude week +2%, Codex week +2% over 2.6 h ${TAIL}`, "the row's figures: cycle, lead and the plans' use in the cycle");
  assert.deepEqual([fig.cycle, fig.lead], [158, 235], "the minutes, rounded");
  const none = checkpointFigures({ id: "W-494", spec, greenlit, land, readings: [] });
  assert.ok("sentence" in none && none.sentence.includes("Claude week unread, Codex week unread over 2.6 h"), "no reading in the cycle: the cost says unread, computed, not refused");
  const missing = checkpointFigures({ id: "W-494", spec: undefined, greenlit: undefined, land: undefined, readings: { error: "EACCES" } });
  assert.ok("missing" in missing, "nothing to compute from: missing");
  assert.equal(missing.missing.length, 4, `each missing input is named: ${JSON.stringify(missing)}`);
  assert.match(missing.missing.join(" | "), /first spec signature.*greenlight.*land.*usage readings cannot be read \(EACCES\)/, "the start, the greenlight, the land and the readings, in that order");
  assert.doesNotMatch(missing.missing.join(" | "), /\d+ min|\+\d+%|\d+\.\d h/, "and no value is suggested");
  const late = checkpointFigures({ id: "W-494", spec: new Date("2026-11-01T16:00:00Z"), greenlit, land, readings });
  assert.ok("missing" in late && /after the land/.test(late.missing[0] ?? ""), "a start after the land is named, not a negative cycle");
  const page = ["<tr><td>W-4940 shipped</td><td>{{figures}}</td></tr>", "<tr><td>W-494 shipped</td><td>{{figures}} Review passed.</td></tr>", "<tr><td>W-493</td><td>{{figures}}</td></tr>"].join("\n");
  const filled = fillFigures(page, "W-494", "FIG.");
  assert.deepEqual(filled, { page: ["<tr><td>W-4940 shipped</td><td>{{figures}}</td></tr>", "<tr><td>W-494 shipped</td><td>FIG. Review passed.</td></tr>", "<tr><td>W-493</td><td>{{figures}}</td></tr>"].join("\n"), filled: 1 }, "the slot is filled only on the line naming the opus");
});

test("W-495-b3 behaviour 3: done writes the checkpoint figures into the row naming the opus, at its {{figures}} slot; a row without the slot, or figures it cannot compute, hold done and name what is missing", { timeout: 1_800_000 }, () => {
  const chore = `chore/done-${OPUS}`;
  const ROW = "docs/design/dossier/progress-body.html";
  const w = world("w495-b3", "cleanup");
  put(w.repo, ROW, "<tr><td>W-899 shipped</td></tr>\n");
  commit(w.repo, "test: master keeps the history page");
  git(w.repo, ["push", "-q", "origin", "master"]);
  scenario(w, { list: mergedList(w) });
  touchHandoff(w);
  // the readings: the baseline before the first spec signature, a stale dip inside, and a reading after the land
  putReadings(w.home, [reading("2026-10-01T00:00:00.000Z", undefined, 1, 1), reading("2026-10-02T00:30:00.000Z", undefined, 10, 20), reading("2026-10-02T05:00:00.000Z", undefined, 12, 23), reading("2026-10-02T06:00:00.000Z", OPUS, 12, 22), reading("2026-10-02T07:00:00.000Z", undefined, 13, 25), reading("2099-01-01T00:00:00.000Z", undefined, 90, 90)]);
  const page = (): string => readFileSync(join(w.repo, ROW), "utf8");
  const held = (label: string, why: RegExp): void => {
    const was = page();
    const o = next(w, [OPUS, "--perform", "--expect", "done"]);
    expectHeld(o, label);
    const line = outLines(o).find((l) => l.startsWith("why: ")) ?? "";
    assert.match(line, why, ran(`${label}: the why names what is missing`, o));
    assert.doesNotMatch(line, /Claude week \+|Cycle \d+ min/, ran(`${label}: and suggests no value`, o));
    assert.equal(page(), was, `${label}: the page is unchanged`);
    assert.equal(branchExists(w, chore), false, `${label}: no chore/done-<id> is made`);
  };
  // a row with typed figures and no slot: held
  put(w.repo, ROW, `<tr><td>W-899 shipped</td></tr>\n<tr><td>${OPUS} shipped</td><td>Cycle about 240 min, Claude week +0%, Codex week +0% over 7.8 h.</td></tr>\n`);
  held("a row with typed figures and no slot", /has no \{\{figures\}\} slot/);
  // the slot, but the readings cannot be read: held, named
  put(w.repo, ROW, `<tr><td>W-899 shipped</td></tr>\n<tr><td>${OPUS} shipped</td><td>{{figures}} Review passed.</td></tr>\n`);
  rmSync(readingsFile(w.home));
  mkdirSync(readingsFile(w.home));
  held("unreadable readings", /the checkpoint figures cannot be computed: the usage readings cannot be read/);
  rmSync(readingsFile(w.home), { recursive: true });
  putReadings(w.home, [reading("2026-10-01T00:00:00.000Z", undefined, 1, 1), reading("2026-10-02T00:30:00.000Z", undefined, 10, 20), reading("2026-10-02T05:00:00.000Z", undefined, 12, 23), reading("2026-10-02T06:00:00.000Z", OPUS, 12, 22), reading("2026-10-02T07:00:00.000Z", undefined, 13, 25), reading("2099-01-01T00:00:00.000Z", undefined, 90, 90)]);
  // the slot: done fills it with the figures it computes and commits the row
  const o = next(w, [OPUS, "--perform", "--expect", "done"]);
  expectStep(o, "done", "performed", "the row with the slot admits done");
  const spec = new Date(T.spec);
  const greenlit = new Date(git(w.repo, ["log", "--reverse", "--format=%cI", "master"]).split("\n")[0]!);
  const land = new Date(git(w.repo, ["show", "-s", "--format=%cI", w.mergeOid!]));
  const cycle = Math.round((land.getTime() - spec.getTime()) / 60_000);
  const lead = Math.round((land.getTime() - greenlit.getTime()) / 60_000);
  const sentence = `Cycle ${cycle} min from the first spec signature (${stamp(spec)}) to land (${stamp(land)}); lead ${lead} min (${(lead / 1440).toFixed(1)} days) from the greenlight (${stamp(greenlit)}); Claude week +3%, Codex week +5% over ${((land.getTime() - spec.getTime()) / 3_600_000).toFixed(1)} h ${TAIL}`;
  const committed = git(w.repo, ["show", `refs/heads/${chore}:${ROW}`]);
  assert.equal(committed.split("\n")[1], `<tr><td>${OPUS} shipped</td><td>${sentence} Review passed.</td></tr>`, ran("the done commit's row carries the computed figures in the slot", o));
});

test("W-495-b4 behaviour 4: each rung's cost line is the plans' whole use from the opus's first spec signature to the rung's reading", { timeout: 600_000 }, () => {
  const w = world("w495-b4", "spec");
  const resets = Math.floor(ms("2026-10-05T00:00:00Z") / 1000);
  claudeFile(w.home, NOW_ISO, 85, 1793858400);
  codexLog(w.home, "2026-10-02T11:50:00.000Z", 61, resets);
  putReadings(w.home, [reading("2026-10-01T00:00:00.000Z", undefined, 50, 30, { codexResets: resets }), reading("2026-10-02T00:30:00.000Z", undefined, 80, 55, { codexResets: resets })]);
  const o = next(w, [OPUS, "--perform", "--expect", "branch"]);
  expectStep(o, "branch", "performed", "the branch rung is performed");
  const cost = o.out.split("\n").find((l) => l.startsWith("cost: "));
  assert.equal(cost, "cost: Claude week +5%, Codex week +6% over 11.0 h since the first spec signature", ran("the cost from the last reading before the first spec signature (01:00Z) to the rung's reading (12:00Z)", o));
});

test("W-495-b4 a first spec signature later than the rung's clock is no start: the cost line reads none, never negative hours", { timeout: 600_000 }, () => {
  const w = world("w495-b4-future", "spec");
  putReadings(w.home, [reading("2026-10-01T00:00:00.000Z", undefined, 50, 30), reading("2026-10-02T00:30:00.000Z", undefined, 80, 55)]);
  const o = next(w, [OPUS, "--perform", "--expect", "branch", "--now", "2026-10-02T00:20:00.000Z"]);
  expectStep(o, "branch", "performed", "the branch rung is performed with the clock before the spec signature (01:00Z)");
  const cost = o.out.split("\n").find((l) => l.startsWith("cost: "));
  assert.match(cost ?? "", /^cost: none \(/, ran("a start after the clock has no span: none, before any hours are printed", o));
  assert.doesNotMatch(cost ?? "", /-\d+\.\d h/, "no negative hours");
});

test("W-495-b4 duplicate rows are rejected before any write: the kept rows script wants exactly one row naming the opus", { timeout: 120_000 }, () => {
  const repo = scratchHome("rows");
  const row = (n: number): string => `<tr><td>1</td><td><strong>W-1 shipped (PR ${n})</strong></td><td>Cycle 10 min, Claude week +0%, Codex week +0% over 1.0 h. Review passed.</td></tr>`;
  const mast = "<p>cascade 1: W-1 shipped PR 5 and more; cycle 10 min</p>\n";
  const script = fileURLToPath(new URL("../../../scripts/checkpoint-rows.mts", import.meta.url));
  const run = (page: string): { status: number | null; stderr: string; page: string; mast: string } => {
    write(join(repo, "docs/design/dossier/progress-body.html"), page);
    write(join(repo, "docs/design/dossier/body.html"), mast);
    const r = spawnSync(process.execPath, ["--import", "tsx", script, repo, "W-1"], { encoding: "utf8" });
    return { status: r.status, stderr: r.stderr, page: readFileSync(join(repo, "docs/design/dossier/progress-body.html"), "utf8"), mast: readFileSync(join(repo, "docs/design/dossier/body.html"), "utf8") };
  };
  const twice = `${row(5)}\n${row(6)}\n`;
  const dup = run(twice);
  assert.notEqual(dup.status, 0, "two rows naming the opus stop the script");
  assert.match(dup.stderr, /W-1: 2 history rows name W-1 shipped; exactly one is expected/, "and the message names the count: a duplicate rewrites neither row");
  assert.equal(dup.page, twice, "the page is unchanged");
  assert.equal(dup.mast, mast, "the masthead is unchanged");
  const none = run("<tr><td>nothing</td></tr>\n");
  assert.notEqual(none.status, 0, "no row naming the opus stops the script");
  assert.match(none.stderr, /W-1: 0 history rows name W-1 shipped; exactly one is expected/, "and the message names the count: none");
});
