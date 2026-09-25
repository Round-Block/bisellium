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
import { listMd, readFront, readManifest, resolveSeat, type Manifest } from "@bisellium/adapter-native";
import { DEFAULT_HARNESS, codexListModels, harnessVersions, makeSessionId, receiptPath, redact, type ListedModel } from "@bisellium/shim";
import {
  gatherCandidates,
  probeBattery,
  readModelsRecord,
  type Candidate,
  type HarnessProbe,
  type ModelsRecord,
} from "@bisellium/commands/probe.js";
import { checkStudio, type CheckOptions, type CheckResult } from "./check.js";
import { isoWeek } from "./init.js";
import { readPauseState, type PauseState } from "./pause.js";

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
export interface DueProbe { kind: "probe"; models: Candidate[] }
export type DueItem = DueDaily | DueAerarium | DueTraditio | DueProbe;

const DEFAULT_TRADITIO_STALE_DAYS = 3;
const DEFAULT_PROBE_STALE_DAYS = 7;

/** The ceiling on turns one automatic `tick` run may spend on the probe
 *  battery. `tick` always passes it; `runProbe` (an explicit operator act)
 *  passes none (W-071 Interfaces). */
export const MAX_PROBE_TURNS_PER_RUN = 12;

/** Gathered by `runTick` (async), consumed by `computeDue` (pure, sync).
 *  Absent means "not gathered" — `computeDue` then emits NO probe item, so
 *  every existing caller and test is unaffected and no test ever depends on
 *  an installed vendor binary (Sol finding 5, W-071). */
export interface ProbeInputs {
  /** undefined = the listing call failed (not an empty listing). */
  listing?: ListedModel[];
  versions: { claude?: string; codex?: string };
  /** undefined = models.json absent or unparseable. */
  record?: ModelsRecord;
}

/** `probes[].harness` -> the key `ProbeInputs.versions` carries it under.
 *  Duplicated from probe.ts's own private `versionKeyFor` rather than
 *  imported (not a published seam, and this codebase's per-file
 *  small-helper style — see `localDateStr` above). */
function versionKeyForHarness(harness: string): "claude" | "codex" | undefined {
  if (harness === "claude-code") return "claude";
  if (harness === "codex") return "codex";
  return undefined;
}

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
export function computeDue(studioRoot: string, manifest: Manifest, now: Date, probe?: ProbeInputs): DueItem[] {
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

  // ---- probe: age or per-pair version trigger (W-071) --------------------
  // Pure and synchronous: `probe` is gathered by `runTick`, never fetched
  // here. Absent `probe` (every existing caller/test) emits no probe item.
  if (probe) {
    const staleDays =
      typeof manifest.defaults?.["model_probe_stale_days"] === "number"
        ? manifest.defaults["model_probe_stale_days"]
        : DEFAULT_PROBE_STALE_DAYS;

    // Per-pair evidence, keyed off the RECORD'S OWN probes[] — never the
    // top-level harnessVersions snapshot, which is a last-observed value,
    // not the trigger's input (behaviour 2(f)).
    const probeByKey = new Map<string, HarnessProbe>();
    if (probe.record) for (const entry of probe.record.models) for (const p of entry.probes) probeByKey.set(`${entry.id}\u0000${p.harness}`, p);

    const candidates = gatherCandidates({ studio: studioRoot, listing: probe.listing });
    const dueModels: Candidate[] = [];
    for (const c of candidates) {
      const prior = probeByKey.get(`${c.id}\u0000${c.harness}`);

      // Age: no probe, an unparseable `at`, or `at` older than the threshold.
      let ageDue: boolean;
      if (!prior) ageDue = true;
      else {
        const atMs = new Date(prior.at).getTime();
        ageDue = Number.isNaN(atMs) ? true : (now.getTime() - atMs) / 86_400_000 > staleDays;
      }

      // Version: per-pair, defined-vs-defined only (Sol note 12) — a pair
      // with no recorded harnessVersion never fires this trigger (it is
      // already age-due, which is what draws it in).
      let versionDue = false;
      if (!ageDue && prior?.harnessVersion !== undefined) {
        const key = versionKeyForHarness(c.harness);
        const live = key ? probe.versions[key] : undefined;
        if (live !== undefined && live !== prior.harnessVersion) versionDue = true;
      }

      if (ageDue || versionDue) dueModels.push(c);
    }
    if (dueModels.length > 0) due.push({ kind: "probe", models: dueModels });
  }

  return due;
}

function formatDue(item: DueItem): string {
  if (item.kind === "daily") return `due: daily — ${item.sella}`;
  if (item.kind === "aerarium") return `due: aerarium — ${item.period}`;
  if (item.kind === "traditio") return `due: traditio — ${item.opus}`;
  return `due: probe — ${item.models.length} pair(s)`;
}

// ---------------------------------------------------------------------------
// health.json — written on every path, paused or not (F2, censor round 1):
// factored so the paused branch and the normal branch build and write the
// exact same shape from whatever `due` each was able to compute, rather than
// the two branches drifting into two different object literals.
// ---------------------------------------------------------------------------

function writeHealthFile(
  studioRoot: string,
  now: Date,
  result: CheckResult,
  findingsByRule: Record<string, number>,
  pause: PauseState,
  due: DueItem[],
): void {
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
  /** Injected probe battery (W-071) — tests use this so no run ever spends
   *  a real vendor turn or depends on an installed vendor binary. Absent
   *  means W-069's real `probeBattery`. */
  probe?: (opts: { studio: string; now: Date; only: Candidate[]; maxTurns: number }) => Promise<unknown>;
  /** Injected codex listing call — absent means the real `codexListModels`. */
  listModels?: () => Promise<ListedModel[]>;
  /** Injected vendor-version call — absent means the real `harnessVersions`. */
  versions?: () => Promise<{ claude?: string; codex?: string }>;
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

  // ---- (a) check, unconditionally -----------------------------------------
  const checkOpts: CheckOptions = parsed.repo ? { repo: resolve(parsed.repo) } : {};
  const result = checkStudio(studioRoot, now, checkOpts);

  const findingsByRule: Record<string, number> = {};
  for (const f of result.findings) findingsByRule[f.rule] = (findingsByRule[f.rule] ?? 0) + 1;

  const pause = readPauseState(studioRoot);

  // ---- paused: only (a) above; no cadence work, no receipt, NO GATHER ----
  // (F2, censor round 1) The probe cadence's gather — a vendor listing call
  // plus two vendor --version calls — used to sit above this check, so a
  // paused tick spawned `codex debug models`, `claude --version` and
  // `codex --version` on every run, falsifying this file's own header
  // ("only (a) runs" above) and the brief's "the paused path returns before
  // any cadence work". Absent `ProbeInputs` is already the correct paused
  // semantics (Interfaces: "Absent means not gathered — computeDue then
  // emits NO probe item"), so health.json is written from the 3-arg
  // `computeDue` and no subprocess is ever spawned.
  if (pause.paused) {
    const due = computeDue(studioRoot, manifest, now);
    writeHealthFile(studioRoot, now, result, findingsByRule, pause, due);
    console.log(`paused since ${pause.at ?? "unknown"}: ${pause.reason ?? ""}`);
    return { exitCode: result.ok ? 0 : 1 };
  }

  // ---- not paused: gather, but only if some collegium could have cadence
  // work at all — the same no-spend-without-autonomy posture as the paused
  // gate above, at the one site that can spend a subprocess before
  // computeDue's own L0 gate ever runs. When every collegium is L0,
  // `computeDue` returns `[]` regardless of `ProbeInputs`, so skipping the
  // gather changes nothing it computes and removes three spawns it can
  // never use. `--dry-run` still needs the real gather (it prints the due
  // line), so this check is autonomy-only, never dry-run-only.
  const anyActiveCollegium = manifest.collegia.some((c) => (c.autonomy ?? "L1") !== "L0");
  let probeInputs: ProbeInputs | undefined;
  if (anyActiveCollegium) {
    // Gathered here (async), consumed by `computeDue` (pure, sync) — Sol
    // finding 5's fix. A rejected listing degrades to `undefined` (not an
    // empty listing); a rejected version call degrades to `{}` (unknown on
    // both keys, so the version trigger never fires on it).
    let listing: ListedModel[] | undefined;
    try {
      listing = await (opts.listModels ?? codexListModels)();
    } catch {
      listing = undefined;
    }
    let versions: { claude?: string; codex?: string };
    try {
      versions = await (opts.versions ?? harnessVersions)();
    } catch {
      versions = {};
    }
    probeInputs = { listing, versions, record: readModelsRecord(studioRoot) };
  }
  const due = computeDue(studioRoot, manifest, now, probeInputs);
  writeHealthFile(studioRoot, now, result, findingsByRule, pause, due);

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
      // W-089 behaviour 3: resolves through resolveSeat (S1) before
      // harnessForSella reads it — an unresolvable magister id is refused
      // with the existing per-item error posture (no daily/harness turn),
      // rather than silently defaulting to claude-code.
      const resolved = resolveSeat(manifest, item.sella);
      if (!resolved) {
        console.error(`tick: daily for "${item.sella}" failed: unknown sella — not declared in bisellium.yml`);
        continue;
      }
      const harness = harnessForSella(resolved.seat);
      const w = await writeDailyActum(studioRoot, item.sella, now, today, talk, harness);
      if (w.ok) console.log(`wrote ${w.path}`);
      else console.error(`tick: daily for "${item.sella}" failed: ${w.error}`);
    }
  }
  for (const item of due) if (item.kind !== "daily") console.log(formatDue(item));

  // Probe: every turn it spends is W-069's `probeBattery`'s, under its own
  // control rule and record — tick never writes models.json itself. A
  // failing battery is reported on stderr and never fails the tick, the
  // same posture a failing daily takes (Interfaces, "Autonomy, pause and
  // dry-run").
  const probeItem = due.find((d): d is DueProbe => d.kind === "probe");
  if (probeItem) {
    const runBattery = opts.probe ?? probeBattery;
    try {
      await runBattery({ studio: studioRoot, now, only: probeItem.models, maxTurns: MAX_PROBE_TURNS_PER_RUN });
    } catch (e) {
      console.error(`tick: probe battery failed: ${(e as Error).message}`);
    }
  }

  // ---- (d) receipt ---------------------------------------------------------
  writeTickReceipt(studioRoot, now);

  return { exitCode: result.ok ? 0 : 1 };
}
