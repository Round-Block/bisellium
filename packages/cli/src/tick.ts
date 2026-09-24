/**
 * `bisellium tick` — L1 "scheduled" autonomy (dossier §10): runs the
 * studio's cadence work (dailies, aerarium/traditio staleness reporting)
 * and a health snapshot. Kept out of main.ts on purpose (W-011 spec) —
 * wired in by the integrator alongside the other builders' commands.
 *
 * Steps, per the spec:
 *  (a) run `checkStudio` and write `<studio>/health.json` — always, even
 *      while paused, even when check has blocking findings.
 *  (b) compute the DUE cadence list for collegia at autonomy L1+.
 *  (c) act on it: `--dry-run` only prints it; otherwise the 'daily' items
 *      get a real acta written (via `runTalk`), other kinds are reported
 *      only — an aerarium/traditio write is a Patron/sella act, not tick's.
 *  (d) write a tick receipt.
 * While paused (`bisellium pause`, see pause.ts) only (a) runs.
 */
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { listMd, readFront, readManifest, type Manifest } from "@bisellium/adapter-native";
import { DEFAULT_HARNESS, makeSessionId, receiptPath, redact } from "@bisellium/shim";
import { checkStudio, type CheckOptions } from "./check.js";
import { isoWeek } from "./init.js";
import { readPauseState } from "./pause.js";

// ---------------------------------------------------------------------------
// The talk seam. Builder A owns packages/cli/src/talk.ts; this module never
// statically imports it (the file doesn't exist at the time this was
// written, and a static import would fail typecheck/tests until A lands
// it). Instead: a small local interface tests can satisfy with a fake via
// `opts.talk`, and a *dynamic* import (through a non-literal specifier, so
// tsc never tries to resolve it at compile time) loaded lazily only when a
// real tick actually needs it.
//
// The seam is talk.ts's `talkOnce({studio, sella, message, harness, now})
// => Promise<{reply}>` — a programmatic API distinct from `runTalk`
// (argv-shaped, `Promise<{exitCode}>`, prints to the console; that's the
// CLI entry point, not something a caller wanting a reply back can drive).
// ---------------------------------------------------------------------------

export interface TalkCallOptions {
  studio: string;
  sella: string;
  message: string;
  /** Which vendor CLI to run the sella through — derived from its model. */
  harness: string;
  now?: Date;
}
export interface TalkCallResult {
  reply: string;
}
export type TalkFn = (opts: TalkCallOptions) => Promise<TalkCallResult>;

async function loadRealTalkOnce(): Promise<TalkFn> {
  const specifier = "./talk.js";
  let mod: { talkOnce?: unknown };
  try {
    mod = (await import(specifier)) as { talkOnce?: unknown };
  } catch (e) {
    throw new Error(`tick: daily acta due but ./talk.js is unavailable: ${(e as Error).message}`);
  }
  if (typeof mod.talkOnce !== "function") throw new Error("tick: ./talk.js has no talkOnce export");
  return mod.talkOnce as TalkFn;
}

/** A sella's harness profile id (@bisellium/shim's HARNESS_PROFILES) —
 *  the manifest's own default (adapter-native: Manifest#sellae.harness).
 *  The default itself is `@bisellium/shim`'s `DEFAULT_HARNESS` (W-069
 *  round 2 drift guard) — `packages/commands/src/probe.ts`'s own
 *  seat-resolution reads the same constant, so the two can never silently
 *  diverge on which harness an unqualified seat runs on. */
export function harnessForSella(sellaRow: { harness?: string } | undefined): string {
  return sellaRow?.harness ?? DEFAULT_HARNESS;
}

const DAILY_MESSAGE = "Write today's acta diurna for your collegium in three lines";

// ---------------------------------------------------------------------------
// Due cadence work
// ---------------------------------------------------------------------------

export interface DueDaily { kind: "daily"; sella: string }
export interface DueAerarium { kind: "aerarium"; period: string }
export interface DueTraditio { kind: "traditio"; opus: string }
export type DueItem = DueDaily | DueAerarium | DueTraditio;

const DEFAULT_TRADITIO_STALE_DAYS = 3;

/** `now`'s calendar date (YYYY-MM-DD) as observed in `timeZone` — mirrors
 *  init.ts's isoDateInZone; duplicated rather than shared, matching this
 *  codebase's existing per-file small-helper style (check.ts does the same
 *  for its own date helpers). */
function localDateStr(now: Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    now,
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/**
 * DUE cadence work for collegia at autonomy L1+ (L0 is manual — `tick`
 * never touches it). Never throws: an unreadable opus/acta file is skipped,
 * the same posture check.ts's `safeList`/`safeFront` take.
 */
export function computeDue(studioRoot: string, manifest: Manifest, now: Date): DueItem[] {
  const activeCollegia = manifest.collegia.filter((c) => (c.autonomy ?? "L1") !== "L0");
  if (activeCollegia.length === 0) return [];

  const due: DueItem[] = [];
  const today = localDateStr(now, manifest.timezone);

  // ---- daily: one per active collegium's magister, deduped -------------
  const activeMagisters = [...new Set(activeCollegia.map((c) => c.magister))];
  const latestDailyBySella = new Map<string, string>();
  // Idempotence before spend: `<date>-<sella>-daily.md` existing for today
  // counts as "already filed" even when the front matter's own `at` is
  // corrupt/unparseable (readFront still succeeds; only `toDate` fails) —
  // writeDailyActum below names the file this exact way, so a match here is
  // proof a talk call already happened, and skipping it is what keeps a
  // corrupt-`at` daily from spending a harness turn a second time.
  const DAILY_FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(.+)-daily\.md$/;
  const filenameDailyToday = new Set<string>();
  for (const p of listMd(join(studioRoot, "acta"))) {
    const m = DAILY_FILENAME_RE.exec(basename(p));
    if (m && m[1] === today) filenameDailyToday.add(m[2]!);
    try {
      const { data } = readFront<{ author?: unknown; kind?: unknown; at?: unknown }>(p);
      if (data.kind !== "daily" || typeof data.author !== "string") continue;
      const at = toDate(data.at);
      if (!at) continue;
      const ds = localDateStr(at, manifest.timezone);
      const prev = latestDailyBySella.get(data.author);
      if (!prev || ds > prev) latestDailyBySella.set(data.author, ds);
    } catch {
      // unreadable acta: skip, same degradation as check.ts's safeFront
    }
  }
  for (const sella of activeMagisters) {
    const alreadyFiledToday = latestDailyBySella.get(sella) === today || filenameDailyToday.has(sella);
    if (!alreadyFiledToday) due.push({ kind: "daily", sella });
  }

  // ---- aerarium: current ISO week's allowance file present? -------------
  // Timezone-aware (init.ts's isoWeek, the one tz-aware isoWeek every caller
  // shares) — a studio's week boundary is wherever Monday 00:00 falls in
  // manifest.timezone, not in UTC.
  const period = isoWeek(now, manifest.timezone);
  if (!existsSync(join(studioRoot, "aerarium", `${period}.yml`))) due.push({ kind: "aerarium", period });

  // ---- traditio: stale handoffs on opera under an active collegium ------
  const staleDays =
    typeof manifest.defaults?.["handoff_stale_days"] === "number" ? manifest.defaults["handoff_stale_days"] : DEFAULT_TRADITIO_STALE_DAYS;
  const activeCollegiumIds = new Set(activeCollegia.map((c) => c.id));
  for (const p of listMd(join(studioRoot, "opera"))) {
    try {
      const { data } = readFront<{ id?: unknown; collegium?: unknown; traditio?: unknown }>(p);
      if (typeof data.id !== "string" || typeof data.collegium !== "string" || !activeCollegiumIds.has(data.collegium)) continue;
      const traditio = data.traditio;
      const at = typeof traditio === "object" && traditio !== null ? toDate((traditio as Record<string, unknown>)["at"]) : undefined;
      if (!at) continue;
      const ageDays = (now.getTime() - at.getTime()) / 86_400_000;
      if (ageDays > staleDays) due.push({ kind: "traditio", opus: data.id });
    } catch {
      // unreadable opus: skip, same degradation as check.ts's safeFront
    }
  }

  return due;
}

function formatDue(item: DueItem): string {
  if (item.kind === "daily") return `due: daily — ${item.sella}`;
  if (item.kind === "aerarium") return `due: aerarium — ${item.period}`;
  return `due: traditio — ${item.opus}`;
}

// ---------------------------------------------------------------------------
// Receipt (sella: "tick", harness: "tick" — never "run": @bisellium/shim's
// writeReceiptStart hardcodes harness "run", so tick writes its own receipt
// file directly, in the same shape/location writeReceiptStart would use.)
// ---------------------------------------------------------------------------

function writeTickReceipt(studioRoot: string, now: Date): void {
  try {
    const sessionId = makeSessionId(now);
    const path = receiptPath(studioRoot, "tick", sessionId);
    mkdirSync(dirname(path), { recursive: true });
    const receipt = {
      sella: "tick",
      sessionId,
      startedAt: now.toISOString(),
      cwd: studioRoot,
      cmd: ["bisellium", "tick"],
      harness: "tick",
      endedAt: now.toISOString(),
      exitCode: 0,
    };
    writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n");
  } catch {
    // Best effort: a receipt write failure must not fail the tick itself.
  }
}

// ---------------------------------------------------------------------------
// Daily acta write
// ---------------------------------------------------------------------------

async function writeDailyActum(
  studioRoot: string,
  sella: string,
  now: Date,
  today: string,
  talk: TalkFn,
  harness: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  // `sella` ultimately traces back to a collegium's manifest `magister` —
  // check.ts's manifest.id.format rule blocks anything unsafe at `check`
  // time, but tick must not trust that every studio it's pointed at has
  // been checked first (defense in depth: a path separator or a ".."
  // segment here must never escape `acta/`, and must not even spend a
  // harness turn before being refused).
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sella) || sella.includes("..")) {
    return { ok: false, error: `unsafe sella id "${sella}" — refusing to write a daily acta for it` };
  }

  let reply: string;
  try {
    const result = await talk({ studio: studioRoot, sella, message: DAILY_MESSAGE, harness, now });
    // Redacted the same way talk.ts's own timeline entries are — the daily
    // title and body land in a tracked, committed acta file (unlike
    // timeline/, which is gitignored), so a credential the model happened
    // to include must not become plaintext evidence in the repo.
    reply = redact((result?.reply ?? "").trim());
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!reply) return { ok: false, error: "empty reply" };

  const firstLine = reply.split("\n")[0]?.trim() ?? "";
  const title = firstLine.length > 0 ? firstLine.slice(0, 120) : "Daily acta diurna";
  const path = join(studioRoot, "acta", `${today}-${sella}-daily.md`);
  // health.json is generated and gitignored (see .gitignore) — a fresh
  // clone would never see it, so evidence points at bisellium.yml instead,
  // a link that's never dead.
  const front =
    `---\n` +
    `author: ${JSON.stringify(sella)}\n` +
    `kind: daily\n` +
    `title: ${JSON.stringify(title)}\n` +
    `at: ${JSON.stringify(now.toISOString())}\n` +
    `evidence:\n  - { label: health, href: bisellium.yml }\n` +
    `---\n${reply}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, front);
  return { ok: true, path };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface RunTickOptions {
  /** Pinned clock override, used when `--now` isn't in `args` (tests). */
  now?: Date;
  /** Injected talk implementation — tests use this so they never depend on
   *  builder A's ./talk.js, which the real (non-dry, non-paused, daily-due)
   *  path loads lazily via a dynamic import. */
  talk?: TalkFn;
}
export interface RunTickResult {
  exitCode: number;
}

const USAGE = "usage: bisellium tick [--studio <dir>] [--now <iso>] [--dry-run] [--repo <dir>]";

interface ParsedTickArgs {
  studio: string;
  repo?: string;
  dryRun: boolean;
  now: Date;
}

function parseArgs(args: string[], defaultNow: Date): ParsedTickArgs | { error: string } {
  let studio = ".";
  let repo: string | undefined;
  let dryRun = false;
  let now = defaultNow;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") { dryRun = true; continue; }
    if (a === "--studio" || a === "--repo" || a === "--now") {
      const v = args[++i];
      if (v === undefined) return { error: `${a} needs a value\n${USAGE}` };
      if (a === "--studio") studio = v;
      else if (a === "--repo") repo = v;
      else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return { error: `--now must be an ISO date\n${USAGE}` };
        now = d;
      }
      continue;
    }
    return { error: `flag ${a} not allowed for "tick"\n${USAGE}` };
  }
  return { studio, repo, dryRun, now };
}

export async function runTick(args: string[], opts: RunTickOptions = {}): Promise<RunTickResult> {
  const parsed = parseArgs(args, opts.now ?? new Date());
  if ("error" in parsed) {
    console.error(parsed.error);
    return { exitCode: 2 };
  }
  const { dryRun, now } = parsed;
  const studioRoot = resolve(parsed.studio);

  const manifestPath = join(studioRoot, "bisellium.yml");
  if (!existsSync(manifestPath)) {
    console.error(`not a studio: ${studioRoot}`);
    return { exitCode: 2 };
  }
  let manifest: Manifest;
  try {
    manifest = readManifest(studioRoot);
  } catch (e) {
    console.error(`${manifestPath} unparseable — not a studio: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  // ---- (a) check + health.json, unconditionally --------------------------
  const checkOpts: CheckOptions = parsed.repo ? { repo: resolve(parsed.repo) } : {};
  const result = checkStudio(studioRoot, now, checkOpts);

  const findingsByRule: Record<string, number> = {};
  for (const f of result.findings) findingsByRule[f.rule] = (findingsByRule[f.rule] ?? 0) + 1;

  const pause = readPauseState(studioRoot);
  const due = computeDue(studioRoot, manifest, now);

  const autonomy: { paused: boolean; since?: string; reason?: string } = { paused: pause.paused };
  if (pause.paused && pause.at) autonomy.since = pause.at;
  if (pause.paused && pause.reason) autonomy.reason = pause.reason;

  const health = {
    at: now.toISOString(),
    ok: result.ok,
    blocks: result.blocks,
    advisories: result.advisories,
    findingsByRule,
    autonomy,
    lastTick: now.toISOString(),
    due,
  };
  writeFileSync(join(studioRoot, "health.json"), JSON.stringify(health, null, 2) + "\n");

  // ---- paused: only (a) above; no cadence work, no receipt ---------------
  if (pause.paused) {
    console.log(`paused since ${pause.at ?? "unknown"}: ${pause.reason ?? ""}`);
    return { exitCode: result.ok ? 0 : 1 };
  }

  // ---- (c) dry-run: report only, exit 0 -----------------------------------
  if (dryRun) {
    if (due.length === 0) console.log("nothing due");
    else for (const item of due) console.log(formatDue(item));
    return { exitCode: 0 };
  }

  // ---- (c) act: dailies get a real acta; other kinds are reported only ---
  const dailyItems = due.filter((d): d is DueDaily => d.kind === "daily");
  if (dailyItems.length > 0) {
    const talk = opts.talk ?? (await loadRealTalkOnce());
    const today = localDateStr(now, manifest.timezone);
    for (const item of dailyItems) {
      const sellaRow = manifest.sellae.find((s) => s.id === item.sella);
      const harness = harnessForSella(sellaRow);
      const w = await writeDailyActum(studioRoot, item.sella, now, today, talk, harness);
      if (w.ok) console.log(`wrote ${w.path}`);
      else console.error(`tick: daily for "${item.sella}" failed: ${w.error}`);
    }
  }
  for (const item of due) if (item.kind !== "daily") console.log(formatDue(item));

  // ---- (d) receipt ---------------------------------------------------------
  writeTickReceipt(studioRoot, now);

  return { exitCode: result.ok ? 0 : 1 };
}
