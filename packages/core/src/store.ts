/**
 * The event store: appends diffed events to the JSONL log, keeps the last
 * snapshot per source so a restart doesn't replay the world as a fresh
 * appearance, and feeds every new event into the SQLite Index (W-013) so
 * queries never have to replay the log by hand. One store owns one studio
 * directory — every path it touches is derived from `studioDir`, all of it
 * under `.bisellium/` (gitignored, docs/ADOPTION.md).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WF, type GantryEvent, type Snapshot } from "@bisellium/schema";
import { diffSnapshots } from "./differ.js";
import { Index } from "./index-db.js";
import { appendEvents, readLog } from "./log.js";

/**
 * `<studio>/.bisellium/events.jsonl` — the CLI's `emit`/Patron-write commands
 * (packages/cli/src/writes.ts) append here too, so the log a Store replays
 * and the log the CLI writes are the same file (coordinated via this
 * constant rather than each side hard-coding the path).
 */
export const EVENTS_LOG_REL = ".bisellium/events.jsonl";
/** `<studio>/.bisellium/snapshots/<source>.json` — the last snapshot ingested
 *  per source, persisted so a restarted Store has a baseline to diff
 *  against instead of treating everything as newly appeared. */
export const SNAPSHOTS_DIR_REL = ".bisellium/snapshots";
/** `<studio>/.bisellium/index/index.db` — the SQLite index (see index-db.ts). */
export const INDEX_DB_REL = ".bisellium/index/index.db";

export interface StoreOptions {
  studioDir: string;
}

export interface IngestContext {
  source: string;
  ts: string;
  projectId: string;
  /** Probatio ids that are `kind: human` — see DiffContext.humanGates. */
  humanGates?: Iterable<string>;
  /**
   * Default true. False for a read-only reconciliation ingest (W-016:
   * `bisellium query --from-index`, packages/cli/src/query.ts) that must
   * never write to the shared `events.jsonl` other tools (the CLI's writes,
   * hooks, apps/server) trust as ground truth — a query answer is not
   * allowed to have that side effect. The diffed events still fold into
   * `this.query` (the Index), and `seq`/the last-seen snapshot for this
   * source are still persisted (see `persistSnapshot`'s `seq` field) so a
   * later ingest — from this same Store or a brand-new one constructed
   * against the same studio dir, e.g. the next CLI invocation — diffs
   * against the right baseline and assigns fresh, non-colliding ids rather
   * than replaying a cold start from `seq` 0 every time.
   */
  appendToLog?: boolean;
}

/** `.bisellium/snapshots/<source>.json`'s on-disk shape. `seq` lets a
 *  source's next id be recovered without replaying `events.jsonl` — the
 *  only way to recover it at all for a source whose ingests never append to
 *  that log (`appendToLog: false` above). A file written before this field
 *  existed has no `seq`; it's read back as `{ seq: undefined, snapshot }`
 *  and `seqBySourceFrom(log)` is what recovers that source's seq, same as
 *  before this change. */
interface PersistedSnapshot {
  seq?: number;
  snapshot: Snapshot;
}

function isPersistedSnapshot(v: unknown): v is PersistedSnapshot {
  return typeof v === "object" && v !== null && "snapshot" in v;
}

export interface ReplayItem {
  state: string;
  gates: Record<string, string>;
  sella?: string;
  collegium?: string;
}

export interface ReplayResult {
  items: Map<string, ReplayItem>;
}

function seqBySourceFrom(log: GantryEvent[]): Map<string, number> {
  const seqBySource = new Map<string, number>();
  for (const e of log) {
    const source = e.attrs[WF.SOURCE];
    const seq = e.attrs[WF.SOURCE_SEQ];
    if (typeof source !== "string" || typeof seq !== "number") continue;
    const next = seq + 1;
    if (next > (seqBySource.get(source) ?? 0)) seqBySource.set(source, next);
  }
  return seqBySource;
}

/** True for a value that JSON.parse'd but isn't actually GantryEvent-shaped
 *  (e.g. `{"id":"x"}`, `null`, `42`, `"a string"`) — readLog only rejects a
 *  line that fails to *parse*, not one that parses into the wrong shape.
 *  Every reader of `this.log` below (`seqBySourceFrom`, `replay`, `burn`)
 *  indexes straight into `.attrs[...]`, so a wrong-shaped-but-valid-JSON
 *  line must never reach `this.log` at all. */
function isGantryEvent(e: unknown): e is GantryEvent {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as Record<string, unknown>)["id"] === "string" &&
    typeof (e as Record<string, unknown>)["name"] === "string" &&
    typeof (e as Record<string, unknown>)["attrs"] === "object" &&
    (e as Record<string, unknown>)["attrs"] !== null
  );
}

/** Drops any line that parsed as JSON but isn't event-shaped, folding it
 *  into the same "corrupt" count readLog's own unparseable lines use — "a
 *  corrupt log is never fatal" (this file's own docs) covers both kinds of
 *  bad line, not just the JSON.parse failures. */
function sanitizeLog(events: GantryEvent[]): { events: GantryEvent[]; corrupt: number } {
  const out: GantryEvent[] = [];
  let corrupt = 0;
  for (const e of events) {
    if (isGantryEvent(e)) out.push(e);
    else corrupt++;
  }
  return { events: out, corrupt };
}

export class Store {
  readonly studioDir: string;
  private readonly logPath: string;
  private readonly snapshotsDir: string;
  private readonly log: GantryEvent[];
  private readonly lastSnapshot = new Map<string, Snapshot>();
  /** Per-source seq recovered from a persisted snapshot file (new shape
   *  only) — see `IngestContext.appendToLog` and `PersistedSnapshot`. */
  private readonly persistedSeq = new Map<string, number>();
  private seqBySource: Map<string, number>;
  /** The SQLite index this store keeps fed. Query it directly — that's the
   *  point (docs on Index, index-db.ts). */
  readonly query: Index;
  /** Lines in the on-disk log that failed to parse, as of the last time this
   *  Store read the log from disk (construction, or `rebuildIndex()`). A
   *  corrupt log is never fatal — this just says how much history was
   *  dropped. */
  corruptLines: number;

  constructor(opts: StoreOptions) {
    this.studioDir = opts.studioDir;
    this.logPath = join(this.studioDir, EVENTS_LOG_REL);
    this.snapshotsDir = join(this.studioDir, SNAPSHOTS_DIR_REL);

    const { events, skipped } = readLog(this.logPath);
    const sanitized = sanitizeLog(events);
    this.log = sanitized.events;
    this.corruptLines = skipped + sanitized.corrupt;
    this.seqBySource = seqBySourceFrom(this.log);

    this.loadPersistedSnapshots();
    // A source whose ingests skip the log (appendToLog: false) can only
    // recover its next seq from the persisted snapshot file, never from
    // `this.log` (seqBySourceFrom above) — take whichever is higher, so a
    // source that mixes both kinds of ingest never regresses its counter.
    for (const [source, seq] of this.persistedSeq) {
      if (seq > (this.seqBySource.get(source) ?? -1)) this.seqBySource.set(source, seq);
    }
    this.query = new Index(join(this.studioDir, INDEX_DB_REL));
  }

  private loadPersistedSnapshots(): void {
    if (!existsSync(this.snapshotsDir)) return;
    let files: string[] = [];
    try {
      files = readdirSync(this.snapshotsDir).filter((f) => f.endsWith(".json"));
    } catch {
      return; // unreadable snapshots dir: every source starts as cold, same as a fresh studio
    }
    for (const f of files) {
      const source = decodeURIComponent(f.slice(0, -".json".length));
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(this.snapshotsDir, f), "utf8"));
        if (isPersistedSnapshot(parsed)) {
          this.lastSnapshot.set(source, parsed.snapshot);
          if (typeof parsed.seq === "number" && parsed.seq > (this.persistedSeq.get(source) ?? -1)) {
            this.persistedSeq.set(source, parsed.seq);
          }
        } else {
          // Pre-W-016 shape: the file *is* the Snapshot, with no seq — that
          // source's seq is recovered from the log the same way it always
          // was (seqBySourceFrom below), not from this file.
          this.lastSnapshot.set(source, parsed as Snapshot);
        }
      } catch {
        // A corrupt snapshot file just means this source re-appears in full
        // on its next ingest — noisy, never fatal (same spirit as
        // readLog's corrupt-line handling).
      }
    }
  }

  private persistSnapshot(source: string, snapshot: Snapshot, seq: number): void {
    mkdirSync(this.snapshotsDir, { recursive: true });
    const path = join(this.snapshotsDir, `${encodeURIComponent(source)}.json`);
    const persisted: PersistedSnapshot = { seq, snapshot };
    writeFileSync(path, JSON.stringify(persisted), "utf8");
  }

  ingest(snapshot: Snapshot, ctx: IngestContext): GantryEvent[] {
    const appendToLog = ctx.appendToLog ?? true;
    const prev = this.lastSnapshot.get(ctx.source) ?? null;
    const seq = this.seqBySource.get(ctx.source) ?? 0;
    const { events, seq: nextSeq } = diffSnapshots(prev, snapshot, {
      source: ctx.source,
      seq,
      ts: ctx.ts,
      projectId: ctx.projectId,
      humanGates: ctx.humanGates,
    });
    if (events.length > 0) {
      if (appendToLog) {
        appendEvents(this.logPath, events);
        this.log.push(...events);
      }
      this.query.apply(events);
    }
    this.seqBySource.set(ctx.source, nextSeq);
    this.lastSnapshot.set(ctx.source, snapshot);
    this.persistSnapshot(ctx.source, snapshot, nextSeq);
    return events;
  }

  events(): GantryEvent[] {
    return [...this.log];
  }

  /** Re-reads the log from disk (picking up anything appended outside this
   *  Store, e.g. the CLI's `emit`/write commands) and rebuilds the Index
   *  from scratch against it — the reconciliation path for when apply()'s
   *  incremental trail can't be trusted to already be complete. */
  rebuildIndex(): void {
    const { events, skipped } = readLog(this.logPath);
    const sanitized = sanitizeLog(events);
    this.log.length = 0;
    this.log.push(...sanitized.events);
    this.corruptLines = skipped + sanitized.corrupt;
    this.seqBySource = seqBySourceFrom(this.log);
    this.query.rebuild(this.log);
  }

  /** Releases the SQLite handle this Store's Index owns. Every caller that
   *  constructs a Store should call this when done with it — the Store is
   *  what created the handle, so it's what should own closing it, rather
   *  than every caller reaching through to `store.query.close()` itself. */
  close(): void {
    this.query.close();
  }

  replay(): ReplayResult {
    const items = new Map<string, ReplayItem>();
    const itemOf = (id: string): ReplayItem => {
      let entry = items.get(id);
      if (!entry) {
        entry = { state: "", gates: {} };
        items.set(id, entry);
      }
      return entry;
    };

    for (const e of this.log) {
      const itemId = e.attrs[WF.ITEM_ID];
      if (typeof itemId !== "string") continue;

      if (e.name === "workflow.item_removed") {
        items.delete(itemId);
        continue;
      }

      const entry = itemOf(itemId);
      const collegium = e.attrs[WF.DEPARTMENT];
      if (typeof collegium === "string") entry.collegium = collegium;

      if (e.name === "workflow.item_appeared" || e.name === "workflow.state_changed") {
        const to = e.attrs[WF.STATE_TO];
        if (typeof to === "string") entry.state = to;
      }
      if (e.name === "workflow.gate_evaluated") {
        const gateId = e.attrs[WF.GATE_ID];
        const status = e.attrs[WF.GATE_STATUS];
        if (typeof gateId === "string" && typeof status === "string") entry.gates[gateId] = status;
      }
      if (e.name === "workflow.item_appeared" || e.name === "workflow.actor_assigned") {
        const role = e.attrs[WF.ACTOR_ROLE];
        if (typeof role === "string") entry.sella = role;
      }
    }

    return { items };
  }

  burn(collegiumId: string): number {
    let total = 0;
    for (const e of this.log) {
      if (e.attrs[WF.DEPARTMENT] !== collegiumId) continue;
      const tokens = e.attrs["gen_ai.usage.total_tokens"];
      if (typeof tokens === "number") total += tokens;
    }
    return total;
  }
}
