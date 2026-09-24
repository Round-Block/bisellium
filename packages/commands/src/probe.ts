/**
 * packages/commands/src/probe.ts — W-069: the model probe battery.
 * "Available" means the model can complete a turn — never "it appears in a
 * vendor listing" (the brief's Intent). `probeBattery` spends one minimal
 * `start` turn per due `(model, harness)` pair and writes the result as a
 * provenance-carrying entry in `<studio>/models.json`; `bisellium probe`
 * (`runProbe`) is the CLI verb the operator invokes it through.
 *
 * `readModelsRecord` and `gatherCandidates` are published seams (Sol's
 * closure-pass carve findings 1/2) — W-071 computes what is due from both
 * without reimplementing either.
 *
 * Skeleton stage: every export below has its final signature so every
 * behaviour's test module loads; bodies are stubs until each behaviour's
 * red is recorded and its own implementation lands (brief: "reds
 * skeleton-first... a module-load failure is one failure, not thirteen").
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  HARNESS_PROFILES,
  USAGE_LIMIT_EXIT_CODE,
  codexListModels as realCodexListModels,
  harnessVersions as realHarnessVersions,
  type HarnessProfile,
  type ListedModel,
  type Turn,
} from "@bisellium/shim";
import { readManifest, type Manifest } from "@bisellium/adapter-native";
import { vendorDiagnostic } from "./talk.js";
import { openStudio, parseFlags, resolveNow } from "./writes.js";

function readManifestSafe(studio: string): Manifest | undefined {
  try {
    return readManifest(studio);
  } catch {
    return undefined;
  }
}

/** Duplicated from packages/cli/src/tick.ts's `harnessForSella` rather than
 *  imported (see the build report): packages/commands cannot depend on
 *  packages/cli — cli already depends on commands, and the reverse would be
 *  a real package cycle; packages/commands/tsconfig.json's `rootDir: "src"`
 *  also makes a relative cross-package import a typecheck failure. One-line
 *  default, unlikely to drift from tick.ts's own copy. */
function defaultHarness(row: { harness?: string }): string {
  return row.harness ?? "claude-code";
}

/** The manifest's own seated candidates — the pairs the studio ASSERTS it
 *  runs (a `sellae` row), distinct from `gatherCandidates`' full union: the
 *  control rule (below) is defined only in terms of what is seated. */
function seatedCandidatesFor(manifest: Manifest): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const row of manifest.sellae ?? []) {
    if (!row.model) continue;
    const c: Candidate = { id: row.model, harness: defaultHarness(row) };
    const key = `${c.id}\u0000${c.harness}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** The control rule's guard 2: a claude Turn whose `raw` carries
 *  `api_error_status` in {401, 403} — envelope metadata, never prose,
 *  matching the distinction `talk.ts:238-242` already draws. */
function shortCircuitStatus(turn: Turn): number | undefined {
  if (typeof turn.raw !== "object" || turn.raw === null) return undefined;
  const status = (turn.raw as Record<string, unknown>)["api_error_status"];
  if (typeof status === "number") return status;
  if (typeof status === "string" && /^\d+$/.test(status)) return Number(status);
  return undefined;
}

/** The exact probe turn (Interfaces, "The probe turn, exactly"): `start`
 *  only, never `resume` — a probe is a single turn by definition, and
 *  W-066 makes resume unusable for it anyway. `systemPrompt: ""` is the
 *  signed narrowing (never talk's ~42k-token boot bundle): the claude
 *  profile appends an empty file, the codex profile sends the bare message. */
const PROBE_MESSAGE = "Reply OK and stop";
const PROBE_SELLA = "probe";

export type ModelState = "available" | "unavailable" | "unverified";

export interface HarnessProbe {
  harness: string;
  state: ModelState;
  at: string;
  exit?: number;
  reply?: boolean;
  vendorDiagnostic?: string;
  note?: string;
  harnessVersion?: string;
}

export interface ModelEntry {
  id: string;
  state: ModelState;
  harness?: string;
  vendorDiagnostic?: string;
  probes: HarnessProbe[];
}

export interface ModelsRecord {
  schema: 1;
  at: string;
  harnessVersions: { claude?: string; codex?: string };
  models: ModelEntry[];
}

export interface Candidate {
  id: string;
  harness: string;
}

export interface ProbeBatteryOptions {
  studio: string;
  now: Date;
  only?: Candidate[];
  dryRun?: boolean;
  harnesses?: Record<string, HarnessProfile>;
  listModels?: () => Promise<ListedModel[]>;
  versions?: () => Promise<{ claude?: string; codex?: string }>;
  /** Test seam for behaviour 6 (atomic-write interruption): injected in
   *  place of node:fs's writeFileSync/renameSync/existsSync. Absent means
   *  the real ones. Not in the brief's published Interfaces text — an
   *  addition, documented in the build report: every other external effect
   *  probeBattery has (a turn, a listing call, a version call) is already
   *  injectable the same way, and a test cannot monkey-patch node:fs's own
   *  named ESM exports (Node's CJS/ESM interop makes them read-only from
   *  outside the module), so this is the only way behaviour 6's
   *  write-interruption case is hermetically testable at all. */
  fs?: {
    writeFileSync: (path: string, data: string) => void;
    renameSync: (from: string, to: string) => void;
    existsSync: (path: string) => boolean;
  };
}

export interface ProbeBatteryResult {
  turns: number;
  skipped: Candidate[];
  record: ModelsRecord;
}

/** Verdict, from the Turn alone (Interfaces table) — never a second
 *  implementation of `talk.ts`'s vendor-diagnostic extraction. */
interface Verdict {
  state: ModelState;
  exit?: number;
  reply?: boolean;
  vendorDiagnostic?: string;
}

function verdictFromTurn(turn: Turn): Verdict {
  if (turn.exitCode === 0 && turn.reply.trim().length > 0) {
    return { state: "available", exit: 0, reply: true };
  }
  const diagnostic = vendorDiagnostic(turn.raw);
  const base: Verdict = { state: "unavailable", exit: turn.exitCode, reply: false };
  return diagnostic !== undefined ? { ...base, vendorDiagnostic: diagnostic } : base;
}

/** `ModelEntry.state`/`harness`/`vendorDiagnostic` is optimistic aggregate
 *  over `probes[]` — "The aggregation rule, stated once" in the Interfaces
 *  section. Recomputed after every probe upsert, never accumulated by hand. */
function recomputeAggregate(entry: ModelEntry): void {
  const available = entry.probes.find((p) => p.state === "available");
  if (available) {
    entry.state = "available";
    entry.harness = available.harness;
    delete entry.vendorDiagnostic;
    return;
  }
  const unavailable = entry.probes.filter((p) => p.state === "unavailable");
  if (unavailable.length > 0) {
    const last = unavailable[unavailable.length - 1]!; // probes[] sorted by harness id; "the last such one"
    entry.state = "unavailable";
    entry.harness = last.harness;
    if (last.vendorDiagnostic !== undefined) entry.vendorDiagnostic = last.vendorDiagnostic;
    else delete entry.vendorDiagnostic;
    return;
  }
  entry.state = "unverified";
  delete entry.harness;
  delete entry.vendorDiagnostic;
}

export async function probeBattery(opts: ProbeBatteryOptions): Promise<ProbeBatteryResult> {
  const harnesses = opts.harnesses ?? HARNESS_PROFILES;
  const nowIso = opts.now.toISOString();

  let listing: ListedModel[] | undefined;
  try {
    listing = await (opts.listModels ?? realCodexListModels)();
  } catch {
    listing = undefined; // a listing failure degrades; it never empties the record (behaviour 8)
  }
  const due = opts.only ?? gatherCandidates({ studio: opts.studio, listing });

  // --dry-run: report the candidate set and spend nothing — no turn, no
  // version/mark/atomic write. Every due pair is "not reached" by
  // definition, which is exactly what `skipped` already means.
  if (opts.dryRun) {
    let existing: ModelsRecord | undefined;
    try {
      existing = readModelsRecord(opts.studio);
    } catch {
      existing = undefined;
    }
    return { turns: 0, skipped: due, record: existing ?? { schema: 1, at: nowIso, harnessVersions: {}, models: [] } };
  }

  // Step 1 (Order of operations): live versions, gathered once, up front —
  // the authoritative per-pair evidence (`HarnessProbe.harnessVersion`,
  // stamped only by a real turn) and the human-readable top-level snapshot
  // both come from this one fetch. A failed vendor call yields `undefined`
  // for that key, which PRESERVES the prior recorded value rather than
  // overwriting it (Sol note 12; behaviour 9(iii)).
  let liveVersions: { claude?: string; codex?: string };
  try {
    liveVersions = await (opts.versions ?? realHarnessVersions)();
  } catch {
    liveVersions = {};
  }
  function versionKeyFor(harness: string): "claude" | "codex" | undefined {
    if (harness === "claude-code") return "claude";
    if (harness === "codex") return "codex";
    return undefined;
  }
  function liveVersionFor(harness: string): string | undefined {
    const key = versionKeyFor(harness);
    return key ? liveVersions[key] : undefined;
  }

  const manifest = readManifestSafe(opts.studio);
  const seatedByHarness = new Map<string, Candidate[]>();
  for (const c of manifest ? seatedCandidatesFor(manifest) : []) {
    const arr = seatedByHarness.get(c.harness) ?? [];
    arr.push(c);
    seatedByHarness.set(c.harness, arr);
  }
  function controlFor(harness: string): Candidate | undefined {
    const seated = seatedByHarness.get(harness);
    if (!seated || seated.length === 0) return undefined;
    return [...seated].sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  // Prior record: retained verbatim for anything this run doesn't touch
  // (an entry for a model no longer a candidate ages on its own), and the
  // source of prior `at`/`harnessVersion` for every pair. Defensive
  // try/catch here is belt-and-suspenders — readModelsRecord itself is
  // hardened against corruption in behaviour 10; this run must not depend
  // on that landing first.
  let priorRecord: ModelsRecord;
  try {
    priorRecord = readModelsRecord(opts.studio) ?? { schema: 1, at: "", harnessVersions: {}, models: [] };
  } catch {
    priorRecord = { schema: 1, at: "", harnessVersions: {}, models: [] };
  }
  const priorProbeByKey = new Map<string, HarnessProbe>();
  for (const entry of priorRecord.models) for (const p of entry.probes) priorProbeByKey.set(`${entry.id}\u0000${p.harness}`, p);

  const models = new Map<string, ModelEntry>();
  for (const entry of priorRecord.models) {
    models.set(entry.id, { id: entry.id, state: entry.state, harness: entry.harness, vendorDiagnostic: entry.vendorDiagnostic, probes: entry.probes.map((p) => ({ ...p })) });
  }
  function upsert(id: string, harness: string, probe: HarnessProbe): void {
    let entry = models.get(id);
    if (!entry) {
      entry = { id, state: "unverified", probes: [] };
      models.set(id, entry);
    }
    entry.probes = entry.probes.filter((p) => p.harness !== harness);
    entry.probes.push(probe);
    entry.probes.sort((a, b) => a.harness.localeCompare(b.harness));
    recomputeAggregate(entry);
  }

  // Oldest-evidence-first: never-probed pairs first, then ascending `at`,
  // then by (id, harness) — a rotation with no cursor, so a stopped run's
  // tail heads next run's queue on its own (Interfaces, "Order: oldest
  // evidence first"). A corrupt `at` is classified as never-probed too
  // (behaviour 10c) — never left to fall through as NaN.
  function priorAtMs(c: Candidate): number {
    const prior = priorProbeByKey.get(`${c.id}\u0000${c.harness}`);
    if (!prior) return -Infinity;
    const ms = new Date(prior.at).getTime();
    // An unparseable `at` is classified as never-probed, same as an absent
    // one (behaviour 10c) — NaN must never reach the comparator below: two
    // NaN operands compare as neither <, >, nor === under `-`, which sorts
    // a corrupt pair unpredictably instead of first.
    return Number.isNaN(ms) ? -Infinity : ms;
  }
  const orderedDue = [...due].sort((a, b) => {
    const ta = priorAtMs(a);
    const tb = priorAtMs(b);
    if (ta !== tb) return ta - tb;
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    return a.harness.localeCompare(b.harness);
  });

  const write = opts.fs?.writeFileSync ?? writeFileSync;
  const rename = opts.fs?.renameSync ?? renameSync;

  // Step 4's snapshot — a human-readable last-observed value, computed once
  // (gathered in step 1, alongside candidates and the listing) rather than
  // re-fetched per write. A failed/absent live value PRESERVES whatever was
  // already recorded; nothing here is ever a trigger input.
  const finalHarnessVersions: { claude?: string; codex?: string } = { ...priorRecord.harnessVersions };
  if (liveVersions.claude !== undefined) finalHarnessVersions.claude = liveVersions.claude;
  if (liveVersions.codex !== undefined) finalHarnessVersions.codex = liveVersions.codex;

  // Every write is atomic (Order of operations): serialize, writeFileSync
  // to models.json.tmp in the SAME directory, renameSync over models.json.
  // A rename within one filesystem is atomic, so no reader ever observes a
  // partial file and an interruption between the two steps corrupts
  // nothing — models.json is left exactly as it was (behaviour 6). A
  // pre-existing .tmp from an earlier crash is simply overwritten first.
  const persist = (): ModelsRecord => {
    const rec: ModelsRecord = {
      schema: 1,
      at: nowIso,
      harnessVersions: finalHarnessVersions,
      models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const path = join(resolve(opts.studio), "models.json");
    const tmpPath = `${path}.tmp`;
    write(tmpPath, JSON.stringify(rec, null, 2) + "\n");
    rename(tmpPath, path);
    return rec;
  };

  // Step 2 (Order of operations): every due pair set to `unverified`,
  // carrying `note: "probe due"` and keeping the superseded evidence's own
  // `at`, BEFORE any turn is spent — durable and atomic (behaviour 6). From
  // this instant on, an interruption, a rate limit, a failed control or a
  // crash can only leave a pair `unverified`, never falsely `available`.
  for (const c of due) {
    const prior = priorProbeByKey.get(`${c.id}\u0000${c.harness}`);
    upsert(c.id, c.harness, { harness: c.harness, state: "unverified", at: prior?.at ?? nowIso, note: "probe due" });
  }
  persist();

  let turns = 0;
  const turnedKeys = new Set<string>(); // (id,harness) that actually spent a start() call this run

  interface TurnOutcome {
    state: ModelState;
    stopHarness: boolean;
  }

  async function turnFor(c: Candidate): Promise<TurnOutcome> {
    const profile = harnesses[c.harness];
    if (!profile) {
      upsert(c.id, c.harness, { harness: c.harness, state: "unverified", at: nowIso, note: `unknown harness "${c.harness}"` });
      return { state: "unverified", stopHarness: false };
    }
    let available: boolean;
    try {
      available = await profile.available();
    } catch {
      available = false;
    }
    if (!available) {
      upsert(c.id, c.harness, { harness: c.harness, state: "unverified", at: nowIso, note: "harness unavailable" });
      return { state: "unverified", stopHarness: false };
    }

    turnedKeys.add(`${c.id}\u0000${c.harness}`);
    const turn = await profile.start({ cwd: opts.studio, sella: PROBE_SELLA, systemPrompt: "", message: PROBE_MESSAGE, env: process.env, model: c.id });
    turns++;
    // Written only by a real turn — a pair marked but never turned never
    // reaches here, so it never carries this field (behaviour 9(ii)).
    const harnessVersion = liveVersionFor(c.harness);

    // A usage limit says nothing about the model — never a verdict.
    if (turn.exitCode === USAGE_LIMIT_EXIT_CODE) {
      const probe: HarnessProbe = { harness: c.harness, state: "unverified", at: nowIso, note: "usage limit" };
      if (harnessVersion !== undefined) probe.harnessVersion = harnessVersion;
      upsert(c.id, c.harness, probe);
      persist(); // step 3: rewrite the whole record after each turn
      return { state: "unverified", stopHarness: true };
    }

    const status = shortCircuitStatus(turn);
    if (status === 401 || status === 403) {
      const probe: HarnessProbe = { harness: c.harness, state: "unverified", at: nowIso, note: `api error ${status}: ${c.harness}` };
      if (harnessVersion !== undefined) probe.harnessVersion = harnessVersion;
      upsert(c.id, c.harness, probe);
      persist();
      return { state: "unverified", stopHarness: true };
    }

    const verdict = verdictFromTurn(turn);
    const probe: HarnessProbe = { harness: c.harness, state: verdict.state, at: nowIso };
    if (verdict.exit !== undefined) probe.exit = verdict.exit;
    if (verdict.reply !== undefined) probe.reply = verdict.reply;
    if (verdict.vendorDiagnostic !== undefined) probe.vendorDiagnostic = verdict.vendorDiagnostic;
    if (harnessVersion !== undefined) probe.harnessVersion = harnessVersion;
    upsert(c.id, c.harness, probe);
    persist();
    return { state: verdict.state, stopHarness: false };
  }

  /** The control failed: nothing is condemned on its say-so alone. The
   *  control's OWN row is left exactly as `turnFor` already wrote it — its
   *  honest verdict, with its own diagnostic "carried on its row" (the
   *  Interfaces wording) — and every OTHER due pair on `harness` is marked
   *  `unverified` with `note: "control failed: <harness>"`, spending zero
   *  turns on them. */
  function condemnHarness(harness: string, control: Candidate): void {
    const note = `control failed: ${harness}`;
    for (const cc of due) {
      if (cc.harness !== harness || cc.id === control.id) continue;
      upsert(cc.id, cc.harness, { harness, state: "unverified", at: nowIso, note });
    }
    persist();
  }

  const controlDone = new Set<string>();
  const harnessBroken = new Set<string>();
  const harnessStopped = new Set<string>();

  for (const c of orderedDue) {
    if (harnessBroken.has(c.harness) || harnessStopped.has(c.harness)) continue;

    const control = controlFor(c.harness);
    if (!control) {
      if (!harnessBroken.has(c.harness)) {
        for (const cc of due) if (cc.harness === c.harness) upsert(cc.id, cc.harness, { harness: cc.harness, state: "unverified", at: nowIso, note: "no control" });
        harnessBroken.add(c.harness);
        persist();
      }
      continue;
    }

    const isControlPair = c.id === control.id && c.harness === control.harness;

    if (!controlDone.has(c.harness)) {
      controlDone.add(c.harness);
      const outcome = await turnFor(control);
      if (outcome.state !== "available") {
        condemnHarness(c.harness, control);
        harnessBroken.add(c.harness);
        continue;
      }
      if (isControlPair) continue;
    } else if (isControlPair) {
      continue; // the control already ran this battery; this due entry is redundant
    }

    const outcome = await turnFor(c);
    if (outcome.stopHarness) harnessStopped.add(c.harness);
  }

  // The signed consequence (Interfaces, "The aggregation rule, stated
  // once"): the shipped W-065 reader shows only the optimistic aggregate,
  // so a model whose probes disagree across harnesses can render available
  // on a seat whose OWN harness can't run it. This is the operator-facing
  // witness that replaces the live collision the manifest fix removed.
  for (const entry of models.values()) {
    const states = new Set(entry.probes.map((p) => p.state));
    if (states.size < 2) continue;
    const verdicts = entry.probes.map((p) => `${p.harness}: ${p.state}`).join(", ");
    console.log(`probe: ${entry.id} disagrees across harnesses — ${verdicts}`);
  }

  const skipped = due.filter((c) => !turnedKeys.has(`${c.id}\u0000${c.harness}`));
  const record = persist();

  return { turns, skipped, record };
}

const PROBE_USAGE = "usage: bisellium probe [--studio <dir>] [--model <id> --harness <id>] [--dry-run] [--now <iso>]";
export { PROBE_USAGE };

/** Test seam only — matches every other CLI verb's `runX(args, opts = {})`
 *  convention (`runTalk`/`RunTalkOptions`, `runTick`/`RunTickOptions`),
 *  which exists for exactly this reason: no unit test may spend a live
 *  vendor turn or depend on an installed vendor binary. Not in the brief's
 *  published `runProbe(args: string[])` signature — an addition, documented
 *  in the build report. `runProbe(args)` (one argument) behaves exactly as
 *  specified; this is a second, optional, defaulted parameter no caller is
 *  forced to know about. */
export interface RunProbeOptions {
  harnesses?: Record<string, HarnessProfile>;
  listModels?: () => Promise<ListedModel[]>;
  versions?: () => Promise<{ claude?: string; codex?: string }>;
}

export async function runProbe(args: string[], opts: RunProbeOptions = {}): Promise<{ exitCode: number }> {
  const parsed = parseFlags(args, { valued: ["--studio", "--model", "--harness", "--now"], boolean: ["--dry-run"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${PROBE_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, flags, positionals } = parsed;
  if (positionals.length > 0) {
    console.error(`unexpected argument "${positionals[0]}"\n${PROBE_USAGE}`);
    return { exitCode: 2 };
  }

  const now = resolveNow(values.get("--now"), undefined);
  if (!now) {
    console.error(`--now must be an ISO date\n${PROBE_USAGE}`);
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root } = opened;
  const dryRun = flags.has("--dry-run");

  const result = await probeBattery({ studio: root, now, dryRun, harnesses: opts.harnesses, listModels: opts.listModels, versions: opts.versions });

  if (dryRun) {
    console.log(`bisellium probe --dry-run: ${result.skipped.length} candidate pair(s), zero spent`);
    for (const c of result.skipped) console.log(`  ${c.id} / ${c.harness}`);
  } else {
    console.log(`bisellium probe: ${result.turns} turn(s) spent, ${result.skipped.length} skipped`);
  }
  return { exitCode: 0 };
}

function isModelState(v: unknown): v is ModelState {
  return v === "available" || v === "unavailable" || v === "unverified";
}

/** A malformed probe is skipped rather than trusted — same tolerance as a
 *  malformed model entry, one level down. */
function parseProbe(raw: unknown): HarnessProbe | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r["harness"] !== "string" || !isModelState(r["state"]) || typeof r["at"] !== "string") return undefined;
  const probe: HarnessProbe = { harness: r["harness"], state: r["state"], at: r["at"] };
  if (typeof r["exit"] === "number") probe.exit = r["exit"];
  if (typeof r["reply"] === "boolean") probe.reply = r["reply"];
  if (typeof r["vendorDiagnostic"] === "string") probe.vendorDiagnostic = r["vendorDiagnostic"];
  if (typeof r["note"] === "string") probe.note = r["note"];
  if (typeof r["harnessVersion"] === "string") probe.harnessVersion = r["harnessVersion"];
  return probe;
}

function parseModelEntry(raw: unknown): ModelEntry | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !isModelState(r["state"])) return undefined;
  const probes: HarnessProbe[] = [];
  if (Array.isArray(r["probes"])) for (const p of r["probes"]) { const parsed = parseProbe(p); if (parsed) probes.push(parsed); }
  const entry: ModelEntry = { id: r["id"], state: r["state"], probes };
  if (typeof r["harness"] === "string") entry.harness = r["harness"];
  if (typeof r["vendorDiagnostic"] === "string") entry.vendorDiagnostic = r["vendorDiagnostic"];
  return entry;
}

/** Advisory data, never instructions (standing rule): an absent,
 *  unparseable or wrong-shaped file yields `undefined` rather than
 *  throwing, and a malformed individual entry (or probe) is skipped rather
 *  than trusted, never failing the whole read (behaviour 10b). */
export function readModelsRecord(studio: string): ModelsRecord | undefined {
  const path = join(resolve(studio), "models.json");
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const p = parsed as Record<string, unknown>;
  if (!Array.isArray(p["models"])) return undefined;

  const models: ModelEntry[] = [];
  for (const raw of p["models"]) {
    const entry = parseModelEntry(raw);
    if (entry) models.push(entry);
  }
  const hv = typeof p["harnessVersions"] === "object" && p["harnessVersions"] !== null ? (p["harnessVersions"] as Record<string, unknown>) : {};
  const harnessVersions: { claude?: string; codex?: string } = {};
  if (typeof hv["claude"] === "string") harnessVersions.claude = hv["claude"];
  if (typeof hv["codex"] === "string") harnessVersions.codex = hv["codex"];
  return { schema: 1, at: typeof p["at"] === "string" ? p["at"] : "", harnessVersions, models };
}

/** The candidate union — two sources, and nothing else (Interfaces,
 *  "Candidates, and how a pair is formed"). `listing: undefined` means the
 *  listing call failed, which is NOT an empty listing: only the
 *  manifest-derived pairs are returned, and no codex pair is invented.
 *  `gen_ai.request.model` (the event log) is deliberately not a source
 *  (Survey: "the source contributes zero candidates"). */
export function gatherCandidates(opts: { studio: string; listing?: ListedModel[] }): Candidate[] {
  const manifest = readManifestSafe(opts.studio);
  const listingCandidates: Candidate[] = (opts.listing ?? []).map((m) => ({ id: m.id, harness: m.harness }));
  const seatedCandidates = manifest ? seatedCandidatesFor(manifest) : [];

  const knownHarnessesFor = new Map<string, Set<string>>();
  for (const c of [...listingCandidates, ...seatedCandidates]) {
    const set = knownHarnessesFor.get(c.id) ?? new Set<string>();
    set.add(c.harness);
    knownHarnessesFor.set(c.id, set);
  }

  // A tiers[].model carries no harness of its own — paired with one only
  // if some other source already resolves that id. Unresolvable: no entry,
  // no turn ("I do not know which vendor to ask" is an honest answer).
  const tierCandidates: Candidate[] = [];
  for (const t of manifest?.tiers ?? []) {
    if (!t.model) continue;
    const harnesses = knownHarnessesFor.get(t.model);
    if (!harnesses) continue;
    for (const h of harnesses) tierCandidates.push({ id: t.model, harness: h });
  }

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of [...listingCandidates, ...seatedCandidates, ...tierCandidates]) {
    const key = `${c.id}\u0000${c.harness}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  out.sort((a, b) => (a.id === b.id ? a.harness.localeCompare(b.harness) : a.id.localeCompare(b.id)));
  return out;
}
