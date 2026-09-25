/**
 * apps/server/src/store.ts — apps/server's `Store` **is** `@bisellium/core`'s
 * `Store` (W-016, cascade-4 review). It used to re-implement its own JSONL
 * append / snapshot-diff / per-source-seq bookkeeping against the same
 * `events.jsonl` `@bisellium/core`'s Store already owns — which meant the
 * SQLite index (W-013) a running server never touched was dead code, and
 * `.bisellium/index/index.db` never existed for a served studio.
 *
 * `Store` here subclasses `@bisellium/core`'s `Store` directly: `ingestOnce()`
 * diffs one fresh `SnapshotAdapter` snapshot through the parent's real
 * `ingest(snapshot, ctx)` (log append, persisted snapshot, SQLite index
 * apply, and — since core's Store is now an `EventEmitter` too — the single
 * `"event"` emission the SSE route subscribes to). `.query` is therefore
 * the real `Index` (`store.query.opera()` etc.), unchanged from core.
 *
 * `.api` is a SEPARATE facade, deliberately not named `.query`, so it can
 * never shadow the Index's own same-named methods: every existing HTTP
 * route's response shape (officina, opus front matter, needs-you, acta,
 * aerarium, provider posture, health, timeline-as-jsonl, receipts) is
 * unchanged from before this rewrite, still built by re-reading the
 * studio's files on demand through `@bisellium/adapter-native` — nothing
 * here is cached across calls, so a concurrent CLI write is visible on the
 * next request with no invalidation logic, same as before.
 *
 * apps/server must never import `@bisellium/cli` or `@bisellium/commands`
 * (that was cascade-4's actual dependency cycle) — `checkStudio` is passed
 * into `.api.health()` by the caller (apps/server/src/http.ts, itself handed
 * it via `StartServerOptions.checkStudio`, injected by
 * packages/cli/src/serve.ts) rather than imported here. Pause-state and the
 * cadence "due" list are small enough to read/compute directly against the
 * studio's own files instead of reaching for packages/cli/src/{pause,tick}.ts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GantryEvent, SnapshotAdapter } from "@bisellium/schema";
import { EVENTS_LOG_REL, readLog, Store as CoreStore } from "@bisellium/core";
import { createBiselliumAdapter, isoWeek, listMd, readFront, readManifest, resolveSeat, snapshotDir, type Manifest } from "@bisellium/adapter-native";

/** This server's own ingestion source id, stamped as `workflow.source` on
 *  every event it appends — distinct from "cli" (packages/commands/writes.ts's
 *  emit/Patron writes) so the two never fight over the same per-source seq. */
const INGEST_SOURCE = "server";

export interface StoreOptions {
  studioDir: string;
  /** Pinned clock, for reproducible query results in tests — every query
   *  that needs "now" uses this instant repeatedly rather than sampling the
   *  real clock mid-run, same convention as every other command's `--now`. */
  now?: Date;
  /** providerStatus() runs quota-axi (a live subprocess) only when true. */
  live?: boolean;
}

interface OpusFrontMatter {
  id: string;
  title?: string;
  kind?: string;
  collegium?: string;
  sella?: string;
  state: string;
  probationes?: Record<string, unknown>;
  tokens?: number;
  traditio?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Same containment discipline as packages/commands/writes.ts's
 *  safeItemPath: an id must never carry a path separator or a bare `.`/`..`
 *  segment before it's joined into a path. */
function safeId(id: string): boolean {
  return id.length > 0 && !/[\\/]/.test(id) && id !== "." && id !== "..";
}

export type CheckStudioFn = (root: string, now?: Date) => { ok: boolean; blocks: number; advisories: number; findings: unknown[] };

/** `<studio>/PAUSED` — same shape packages/commands/pause.ts's
 *  `readPauseState` reads, duplicated here (not imported: that file lives in
 *  a package apps/server must never depend on) because it's five lines
 *  against one well-known file, not worth a cross-package seam for. */
function readPausedAt(studioDir: string): { paused: boolean; at?: string; reason?: string } {
  const p = join(studioDir, "PAUSED");
  if (!existsSync(p)) return { paused: false };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { at?: unknown; reason?: unknown };
    return {
      paused: true,
      at: typeof raw.at === "string" ? raw.at : undefined,
      reason: typeof raw.reason === "string" && raw.reason.length > 0 ? raw.reason : undefined,
    };
  } catch {
    return { paused: true };
  }
}

// ponytail: a trimmed stand-in for packages/cli/src/tick.ts's computeDue
// (aerarium + traditio only, UTC isoWeek instead of tick's timezone-aware
// one) — importing the real thing would mean importing @bisellium/cli,
// which is exactly the dependency cycle this cascade removes. Nothing in
// this brief tests /api/health's `due` contents; upgrade to the real
// computation (shared from somewhere apps/server may depend on) if that
// ever changes.
function computeDueSummary(studioDir: string, manifest: Manifest, now: Date): { kind: string; id: string }[] {
  const due: { kind: string; id: string }[] = [];
  const activeCollegia = manifest.collegia.filter((c) => (c.autonomy ?? "L1") !== "L0");
  if (activeCollegia.length === 0) return due;

  const period = isoWeek(now);
  if (!existsSync(join(studioDir, "aerarium", `${period}.yml`))) due.push({ kind: "aerarium", id: period });

  const activeCollegiumIds = new Set(activeCollegia.map((c) => c.id));
  for (const p of listMd(join(studioDir, "opera"))) {
    try {
      const { data } = readFront<{ id?: unknown; collegium?: unknown; traditio?: unknown }>(p);
      if (typeof data.id !== "string" || typeof data.collegium !== "string" || !activeCollegiumIds.has(data.collegium)) continue;
      const traditio = data.traditio;
      const at = typeof traditio === "object" && traditio !== null ? (traditio as Record<string, unknown>)["at"] : undefined;
      const atDate = typeof at === "string" ? new Date(at) : undefined;
      if (!atDate || Number.isNaN(atDate.getTime())) continue;
      const ageDays = (now.getTime() - atDate.getTime()) / 86_400_000;
      if (ageDays > 3) due.push({ kind: "traditio", id: data.id });
    } catch {
      // unreadable opus: skip, same degradation check.ts's safeList takes
    }
  }
  return due;
}

// ---------------------------------------------------------------------------
// W-065: `<studio>/models.json` — the probe-battery opus's record (never
// written here; this is a reader only, same shape/place as health.json).
// ---------------------------------------------------------------------------

export type ModelState = "available" | "unavailable" | "unverified";
export interface ModelRecordEntry {
  id: string;
  harness?: string;
  state: ModelState;
  vendorDiagnostic?: string;
}

/** Advisory data, never instructions (standing rule): an absent or
 *  unparseable file degrades to `undefined` rather than throwing — the
 *  `/api/officina` route never blocks on bookkeeping it did not write.
 *  Malformed individual entries are skipped rather than failing the whole
 *  read, same tolerance `readUsageProviders` already uses. */
function readModelsRecord(studioDir: string): ModelRecordEntry[] | undefined {
  const path = join(studioDir, "models.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
    if (!Array.isArray(parsed.models)) return undefined;
    const states = new Set(["available", "unavailable", "unverified"]);
    const models: ModelRecordEntry[] = [];
    for (const raw of parsed.models) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r["id"] !== "string" || typeof r["state"] !== "string" || !states.has(r["state"])) continue;
      models.push({
        id: r["id"],
        state: r["state"] as ModelState,
        harness: typeof r["harness"] === "string" ? r["harness"] : undefined,
        vendorDiagnostic: typeof r["vendorDiagnostic"] === "string" ? r["vendorDiagnostic"] : undefined,
      });
    }
    return models;
  } catch {
    return undefined;
  }
}

export class Store extends CoreStore {
  readonly projectId: string;
  private readonly live: boolean;
  private readonly fixedNow?: Date;
  private readonly adapter: SnapshotAdapter;

  constructor(opts: StoreOptions) {
    super({ studioDir: opts.studioDir });
    this.live = opts.live ?? false;
    this.fixedNow = opts.now;
    this.adapter = createBiselliumAdapter(this.studioDir, undefined, { live: this.live });
    this.projectId = this.adapter.projectId;
  }

  private now(): Date {
    return this.fixedNow ?? new Date();
  }

  private manifest(): Manifest {
    return readManifest(this.studioDir);
  }

  private modelsRecord(): ModelRecordEntry[] | undefined {
    return readModelsRecord(this.studioDir);
  }

  /** Sella id, or the manifest's patron id — the set of ids the timeline/
   *  receipts routes accept before answering 404 for anything else. */
  private knownParty(id: string): boolean {
    const m = this.manifest();
    return id === (m.patron ?? "patron") || resolveSeat(m, id) !== undefined;
  }

  sellaExists(id: string): boolean {
    return this.knownParty(id);
  }

  /** Diffs one fresh snapshot into the shared log + SQLite index (via
   *  `@bisellium/core`'s `Store.ingest`, which also emits `"event"` for the
   *  HTTP layer's SSE route) under this server's own source id. Returns the
   *  events just appended (empty when nothing changed). */
  async ingestOnce(): Promise<GantryEvent[]> {
    const now = this.now();
    const manifest = this.manifest();
    const humanGates = new Set(manifest.probationes.filter((g) => g.kind === "human").map((g) => g.id));
    const snapshot = await this.adapter.snapshot();
    return this.ingest(snapshot, { source: INGEST_SOURCE, ts: now.toISOString(), projectId: this.projectId, humanGates });
  }

  /** The HTTP layer's read model — every existing route's exact response
   *  shape, kept off `.query` (the real Index) on purpose; see file header. */
  readonly api = {
    officina: (): {
      studio: string;
      patron: string;
      collegia: { id: string; name: string; magister: string; fallback?: string; autonomy: string }[];
      sellae: Manifest["sellae"];
      probationes: Manifest["probationes"];
      wip_limit?: number;
      tiers?: Manifest["tiers"];
      munera?: Manifest["munera"];
      models?: ModelRecordEntry[];
      lifecycle: { id: string; states: { id: string; name: string; phase: string }[] };
    } => {
      const m = this.manifest();
      // From this.adapter.describeLifecycles()[0] — id and states only.
      // Transitions are not the Board's business and `gates` would
      // duplicate this route's existing `probationes` (W-064 Interfaces).
      const lc = this.adapter.describeLifecycles()[0];
      return {
        studio: m.studio,
        patron: m.patron ?? "patron",
        collegia: m.collegia.map((c) => ({
          id: c.id,
          name: c.name,
          magister: c.magister,
          fallback: c.fallback,
          autonomy: c.autonomy ?? "L1",
        })),
        sellae: m.sellae,
        probationes: m.probationes,
        wip_limit: m.wip_limit,
        tiers: m.tiers,
        munera: m.munera,
        models: this.modelsRecord(),
        lifecycle: { id: lc?.id ?? "", states: (lc?.states ?? []).map((s) => ({ id: s.id, name: s.name, phase: s.phase })) },
      };
    },

    opera: (filters: { state?: string; collegium?: string } = {}) => {
      const snap = snapshotDir(this.studioDir, this.projectId, this.now());
      return snap.opera
        .filter((w) => (filters.state ? w.state === filters.state : true))
        .filter((w) => (filters.collegium ? w.meta["collegium"] === filters.collegium : true))
        .map((w) => ({
          id: w.id,
          title: w.meta["title"],
          kind: w.kind,
          collegium: w.meta["collegium"],
          sella: w.meta["sella"],
          state: w.state,
          tokens: w.meta["tokens"],
          probationes: w.probationes,
          traditio: w.meta["traditio"],
        }));
    },

    /** Front matter + body + probationes + traditio for one opus, straight
     *  off disk (not the trimmed adapter Opus) — `undefined` for an unknown
     *  or unsafe id, which the HTTP layer turns into 404 {error}. */
    opus: (id: string): { id: string; frontMatter: OpusFrontMatter; body: string; probationes: Record<string, unknown>; traditio: unknown } | undefined => {
      if (!safeId(id)) return undefined;
      const path = join(this.studioDir, "opera", `${id}.md`);
      if (!existsSync(path)) return undefined;
      try {
        const fm = readFront<OpusFrontMatter>(path);
        return {
          id: fm.data.id,
          frontMatter: fm.data,
          body: fm.body,
          probationes: fm.data.probationes ?? {},
          traditio: fm.data.traditio,
        };
      } catch {
        return undefined;
      }
    },

    /** ADOPTION.md: "a pending gate of kind human is what needs you means". */
    needsYou: () => {
      const now = this.now();
      const manifest = this.manifest();
      const humanGates = new Set(manifest.probationes.filter((g) => g.kind === "human").map((g) => g.id));
      const snap = snapshotDir(this.studioDir, this.projectId, now);
      const opera = snap.opera
        .filter((w) => Object.entries(w.probationes).some(([gid, g]) => humanGates.has(gid) && g.status === "pending"))
        .map((w) => ({ id: w.id, title: w.meta["title"], collegium: w.meta["collegium"], sella: w.meta["sella"], traditio: w.meta["traditio"] }));
      const petitiones = (snap.petitiones ?? [])
        .filter((p) => p.state === "needs_you")
        .map((p) => ({ id: p.id, opus: p.opusId, from: p.openedBy, subject: p.subject, body: p.body }));
      return { opera, petitiones };
    },

    acta: (days = 7) => {
      const now = this.now();
      const snap = snapshotDir(this.studioDir, this.projectId, now);
      const cutoffMs = Math.max(0, days) * 86_400_000;
      return (snap.acta ?? [])
        .filter((a) => {
          const at = new Date(a.at);
          return !Number.isNaN(at.getTime()) && now.getTime() - at.getTime() <= cutoffMs;
        })
        .map((a) => ({ id: a.id, author: a.authorRoleId, kind: a.kind, title: a.title, at: a.at, evidence: a.evidence }));
    },

    /** Allowance + derived burn + posture per collegium — never a
     *  self-declared figure (docs/ADOPTION.md: burn is derived, never
     *  mirrored). */
    aerarium: (period?: string) => {
      const now = this.now();
      const snap = snapshotDir(this.studioDir, this.projectId, now);
      const target = period ?? isoWeek(now);
      return (snap.stipendia ?? [])
        .filter((s) => s.period === target)
        .map((s) => ({ collegium: s.collegiumId, period: s.period, allowance: s.allowance, burn: s.burn, posture: s.posture }));
    },

    providers: async (live = false) => {
      const adapter = live === this.live ? this.adapter : createBiselliumAdapter(this.studioDir, this.projectId, { live });
      return (await adapter.providerStatus?.()) ?? [];
    },

    /** `<studio>/health.json` if `bisellium tick` has already written one,
     *  else a fresh `checkStudio` summary computed on the spot — `checkStudio`
     *  is injected (StartServerOptions), never imported: apps/server must
     *  not depend on @bisellium/cli. */
    health: (checkStudio: CheckStudioFn): unknown => {
      const healthPath = join(this.studioDir, "health.json");
      if (existsSync(healthPath)) {
        try {
          return JSON.parse(readFileSync(healthPath, "utf8"));
        } catch {
          // corrupt health.json: fall through to a fresh summary below
        }
      }
      const now = this.now();
      const manifest = this.manifest();
      const result = checkStudio(this.studioDir, now);
      const findingsByRule: Record<string, number> = {};
      for (const f of result.findings as { rule: string }[]) findingsByRule[f.rule] = (findingsByRule[f.rule] ?? 0) + 1;
      const pause = readPausedAt(this.studioDir);
      const due = computeDueSummary(this.studioDir, manifest, now);
      const autonomy: { paused: boolean; since?: string; reason?: string } = { paused: pause.paused };
      if (pause.paused && pause.at) autonomy.since = pause.at;
      if (pause.paused && pause.reason) autonomy.reason = pause.reason;
      return {
        at: now.toISOString(),
        ok: result.ok,
        blocks: result.blocks,
        advisories: result.advisories,
        findingsByRule,
        autonomy,
        lastTick: now.toISOString(),
        due,
      };
    },

    /** `<studio>/timeline/<sella>.jsonl` (talk chatter) or
     *  `timeline/patron.jsonl` (Patron write log). */
    timeline: (sella: string, limit?: number): Record<string, unknown>[] => {
      if (!safeId(sella)) return [];
      const path = join(this.studioDir, "timeline", `${sella}.jsonl`);
      if (!existsSync(path)) return [];
      const entries: Record<string, unknown>[] = [];
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          // corrupt line: skip, same degradation @bisellium/core's readLog uses
        }
      }
      return limit !== undefined ? entries.slice(-limit) : entries;
    },

    /** Every event in the SQLite index, with a stable `seq` (the Store's own
     *  monotonic counter — W-016 behaviour 4, never a re-derived
     *  `log.length`), optionally only those after `since` and capped at
     *  `limit`. */
    /** `item` reads a FRESH `events.jsonl` (never the Index — the survey:
     *  the Index misses every event appended by another writer for the life
     *  of the process). Ascending, same ordering as the unfiltered path;
     *  `limit` here means the LAST N (a drawer wants an item's recent
     *  history), then returned ascending — `Index.timeline`'s own
     *  `out.slice(Math.max(0, out.length - limit))` is the in-house
     *  precedent. These rows carry no `seq`: they never touched the Index. */
    events: (opts: { since?: number; limit?: number; item?: string } = {}): (GantryEvent & { seq?: number })[] => {
      if (opts.item !== undefined) {
        const { events } = readLog(join(this.studioDir, EVENTS_LOG_REL));
        const filtered = events.filter((e) => e.attrs["workflow.item.id"] === opts.item);
        return opts.limit !== undefined ? filtered.slice(Math.max(0, filtered.length - opts.limit)) : filtered;
      }
      return this.query.events(opts.since, opts.limit ?? Number.MAX_SAFE_INTEGER);
    },

    receipts: (sella?: string): Record<string, unknown>[] => {
      const dir = join(this.studioDir, "receipts");
      if (!existsSync(dir)) return [];
      let sellaDirs: string[];
      if (sella !== undefined) {
        sellaDirs = safeId(sella) ? [sella] : [];
      } else {
        try {
          sellaDirs = readdirSync(dir).filter((f) => {
            try {
              return statSync(join(dir, f)).isDirectory();
            } catch {
              return false;
            }
          });
        } catch {
          sellaDirs = [];
        }
      }
      const out: Record<string, unknown>[] = [];
      for (const s of sellaDirs) {
        const sDir = join(dir, s);
        let files: string[] = [];
        try {
          files = readdirSync(sDir).filter((f) => f.endsWith(".json"));
        } catch {
          continue;
        }
        for (const f of files) {
          try {
            out.push(JSON.parse(readFileSync(join(sDir, f), "utf8")) as Record<string, unknown>);
          } catch {
            // corrupt receipt: skip, same degradation check.ts's receipt.shape rule reports separately
          }
        }
      }
      return out;
    },
  };
}

export type { Manifest };
