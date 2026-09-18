/**
 * apps/server/src/store.ts — the read model `bisellium serve` (W-014) hands
 * the HTTP layer.
 *
 * @bisellium/core's own `Store` class (the higher-level `ingest(snapshot,
 * ctx)` / `.query` wrapper other builders are landing in parallel, W-013) is
 * still being actively reshaped on disk as this was built — its constructor
 * signature and exports changed underfoot more than once in this same
 * session. Per the W-014 spec's own contingency ("if builder A's new Store
 * signature is not on disk yet, code against {studioDir} and a Store.query
 * object … — the integrator reconciles"), this module depends only on
 * @bisellium/core's lowest-level, stable-across-every-observed-revision
 * primitives — `appendEvents`/`readLog` (log.ts) and `diffSnapshots`
 * (differ.ts) — and does its own tiny per-source ingest bookkeeping here,
 * rather than importing whichever `Store` class happens to be on disk. The
 * `.query` object below (`officina()`, `opera()`, `opus()`, `needsYou()`,
 * `acta()`, `aerarium()`, `providers()`, `health()`, `timeline()`,
 * `events()`, `receipts()`) is this file's own facade, built against
 * `{studioDir}` by re-reading the studio's files on demand through
 * @bisellium/adapter-native — the same reader `check`/`context`/`query`
 * already use. Nothing here is cached across calls; the studio's files (and
 * this module's own `events.jsonl`) are the only state, so a concurrent CLI
 * write is visible on the next request without any invalidation logic. A
 * later `@bisellium/core` `Store.query` seam is the integrator's to
 * reconcile against this file, not the other way around.
 *
 * The one thing this class owns as real in-memory state is an EventEmitter,
 * so the HTTP layer's SSE route can push each newly-ingested event to
 * connected clients without polling the log itself.
 */
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { GantryEvent, Snapshot, SnapshotAdapter } from "@bisellium/schema";
import { WF } from "@bisellium/schema";
import { appendEvents, diffSnapshots, readLog, EVENTS_LOG_REL, SNAPSHOTS_DIR_REL } from "@bisellium/core";
import {
  createBiselliumAdapter,
  isoWeek,
  readFront,
  readManifest,
  snapshotDir,
  type Manifest,
} from "@bisellium/adapter-native";
import { checkStudio } from "@bisellium/cli/src/check.js";
import { computeDue } from "@bisellium/cli/src/tick.js";
import { readPauseState } from "@bisellium/cli/src/pause.js";

/** This server's own ingestion source id, stamped as `workflow.source` on
 *  every event it appends — distinct from "cli" (packages/cli/src/writes.ts's
 *  emit/Patron writes) so the two never fight over the same seq counter. */
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

/** Same containment discipline as packages/cli/src/writes.ts's
 *  safeItemPath: an id must never carry a path separator or a bare `.`/`..`
 *  segment before it's joined into a path. */
function safeId(id: string): boolean {
  return id.length > 0 && !/[\\/]/.test(id) && id !== "." && id !== "..";
}

export class Store extends EventEmitter {
  readonly studioDir: string;
  readonly projectId: string;
  private readonly live: boolean;
  private readonly fixedNow?: Date;
  private readonly adapter: SnapshotAdapter;
  private readonly logPath: string;
  private readonly snapshotsDir: string;
  private log: GantryEvent[];
  private lastSnapshot: Snapshot | null;
  private seq: number;

  constructor(opts: StoreOptions) {
    super();
    this.studioDir = resolve(opts.studioDir);
    this.live = opts.live ?? false;
    this.fixedNow = opts.now;
    this.adapter = createBiselliumAdapter(this.studioDir, undefined, { live: this.live });
    this.projectId = this.adapter.projectId;
    // Same file @bisellium/core's own Store, packages/cli/src/writes.ts and
    // packages/cli/src/hooks.ts all read/append (docs/ADOPTION.md) — a
    // private "events.jsonl" at the studio root would be a second, disjoint
    // log that neither this server's own greenlight/answer/budget writes
    // (which append there via emitEvent) nor a CLI/hook run anywhere else
    // would ever show up in.
    this.logPath = join(this.studioDir, EVENTS_LOG_REL);
    this.snapshotsDir = join(this.studioDir, SNAPSHOTS_DIR_REL);
    this.log = readLog(this.logPath).events;
    this.lastSnapshot = this.loadPersistedSnapshot();
    // Resume this source's own seq counter from whatever it last wrote —
    // same recovery @bisellium/core's Store does per-source, just scoped to
    // the one source (INGEST_SOURCE) this class ever ingests as.
    let nextSeq = 0;
    for (const e of this.log) {
      if (e.attrs[WF.SOURCE] !== INGEST_SOURCE) continue;
      const s = e.attrs[WF.SOURCE_SEQ];
      if (typeof s === "number" && s + 1 > nextSeq) nextSeq = s + 1;
    }
    this.seq = nextSeq;
  }

  private now(): Date {
    return this.fixedNow ?? new Date();
  }

  private manifest(): Manifest {
    return readManifest(this.studioDir);
  }

  /** Sella id, or the manifest's patron id — the set of ids the timeline/
   *  receipts routes accept before answering 404 for anything else. */
  private knownParty(id: string): boolean {
    const m = this.manifest();
    return id === (m.patron ?? "patron") || m.sellae.some((s) => s.id === id);
  }

  sellaExists(id: string): boolean {
    return this.knownParty(id);
  }

  /** `.bisellium/snapshots/<source>.json` (SNAPSHOTS_DIR_REL) — same
   *  filename convention as @bisellium/core's own Store, scoped to this
   *  class's one source (INGEST_SOURCE), so a restarted server diffs
   *  against what it actually last saw instead of `null`. Without this, a
   *  fresh Store re-diffs the whole studio as newly appeared on every
   *  restart, flooding the log (and every connected SSE client) with false
   *  `item_appeared`/`gate_evaluated`/`actor_assigned` history. */
  private loadPersistedSnapshot(): Snapshot | null {
    const path = join(this.snapshotsDir, `${encodeURIComponent(INGEST_SOURCE)}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
    } catch {
      // A corrupt snapshot file just means this source re-appears in full
      // on its next ingest — noisy, never fatal (readLog's corrupt-line
      // handling is the same spirit).
      return null;
    }
  }

  private persistSnapshot(snapshot: Snapshot): void {
    mkdirSync(this.snapshotsDir, { recursive: true });
    const path = join(this.snapshotsDir, `${encodeURIComponent(INGEST_SOURCE)}.json`);
    writeFileSync(path, JSON.stringify(snapshot), "utf8");
  }

  /** Ingests one snapshot and appends any newly-diffed events to the log,
   *  emitting `"event"` for each one (the SSE route's only feed). Returns
   *  the events just appended (empty when nothing changed). */
  async ingest(): Promise<GantryEvent[]> {
    const now = this.now();
    const snapshot = await this.adapter.snapshot();
    const { events, seq } = diffSnapshots(this.lastSnapshot, snapshot, {
      source: INGEST_SOURCE,
      seq: this.seq,
      ts: now.toISOString(),
      projectId: this.projectId,
    });
    if (events.length > 0) {
      appendEvents(this.logPath, events);
      this.log.push(...events);
    }
    this.seq = seq;
    this.lastSnapshot = snapshot;
    this.persistSnapshot(snapshot);
    for (const e of events) this.emit("event", e);
    return events;
  }

  readonly query = {
    officina: (): {
      studio: string;
      patron: string;
      collegia: { id: string; name: string; magister: string; fallback?: string; autonomy: string }[];
      sellae: Manifest["sellae"];
      probationes: Manifest["probationes"];
      wip_limit?: number;
    } => {
      const m = this.manifest();
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

    /** ADOPTION.md: "a pending gate of kind human is what needs you means".
     *  Reads the studio's current files (snapshotDir), same data source
     *  `bisellium query`'s own needs-you answer uses — the store's own
     *  ingested-event log doesn't yet carry gate *kind*, only gate results,
     *  so it can't tell a pending human gate apart from any other pending
     *  gate on its own. */
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
        .map((p) => ({ id: p.id, opus: p.opusId, from: p.openedBy, subject: p.subject }));
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
     *  mirrored). Defaults to the current (UTC) ISO week, the same period
     *  @bisellium/adapter-native's own snapshotDir treats as "current" for
     *  burn purposes. */
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
     *  else a fresh `checkStudio` summary in the exact same shape (tick.ts's
     *  health object) computed on the spot — never a stale/absent 404. */
    health: (): unknown => {
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
      for (const f of result.findings) findingsByRule[f.rule] = (findingsByRule[f.rule] ?? 0) + 1;
      const pause = readPauseState(this.studioDir);
      const due = computeDue(this.studioDir, manifest, now);
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
     *  `timeline/patron.jsonl` (Patron write log) — whichever file exists
     *  for `sella`. `[]` for a declared party with no timeline yet; the
     *  404-for-unknown-party decision belongs to the HTTP layer
     *  (`sellaExists`), not this reader. */
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

    /** Every event in the log with a stable `seq` (its position in the
     *  log), optionally only those after `since` and capped at `limit`. The
     *  SSE route's `"event"` emissions use the same underlying log, so a
     *  client that reconnects can pass the last `seq` it saw here. */
    events: (opts: { since?: number; limit?: number } = {}): (GantryEvent & { seq: number })[] => {
      const all = this.log.map((e, seq) => ({ ...e, seq }));
      const filtered = opts.since !== undefined ? all.filter((e) => e.seq > opts.since!) : all;
      return opts.limit !== undefined ? filtered.slice(0, opts.limit) : filtered;
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
