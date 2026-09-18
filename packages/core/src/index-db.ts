/**
 * packages/core/src/index-db.ts — W-013: the SQLite index every deterministic
 * query answer is read from, instead of replaying the whole log in memory on
 * every call. Every table here is derived: `rebuild()` drops and replays from
 * the log it's handed, `apply()` folds in just the new tail. Nothing is ever
 * written here except by replaying a `GantryEvent[]` — the index has no
 * opinion about studios, manifests or files, only about the wire format
 * (`@bisellium/schema`'s `WF` attributes).
 *
 * Node's `node:sqlite` (stable enough for this: `DatabaseSync` bundled since
 * Node 22) is used directly — no query builder, no ORM, one file per studio
 * under `<studio>/.bisellium/index/`.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { WF, type GantryEvent } from "@bisellium/schema";

export interface GateResult {
  status: string;
  certifies?: string;
}

export interface OpusRow {
  id: string;
  state: string;
  collegium?: string;
  sella?: string;
  probationes: Record<string, GateResult>;
  updatedAt: string;
}

/** Internal shape kept in `opera_state.probationes` — `kind` never leaves
 *  this module; `opera()`/`opus()` strip it back down to {status, certifies}. */
interface InternalGate extends GateResult {
  kind?: string;
}
interface InternalOpusRow extends Omit<OpusRow, "probationes"> {
  probationes: Record<string, InternalGate>;
}

export interface OperaFilter {
  state?: string;
  collegium?: string;
  sella?: string;
}

export interface NeedsYouProbatio {
  opus: string;
  probatio: string;
}
export interface NeedsYouPetitio {
  id: string;
  opus?: string;
  from?: string;
  opened?: string;
}
export interface NeedsYouResult {
  probationes: NeedsYouProbatio[];
  petitiones: NeedsYouPetitio[];
}

export interface TimelineEntry {
  seq: number;
  ts: string;
  name: string;
  attrs: Record<string, string | number | boolean>;
}

export interface IndexStats {
  events: number;
  opera: number;
  petitiones: number;
  providers: number;
  lastSeq: number;
}

interface PetitioState {
  id: string;
  opus?: string;
  from?: string;
  status: string; // "requested" | "resolved"
  opened?: string;
  updatedAt: string;
}

interface ProviderState {
  id: string;
  usagePct?: number;
  status?: string;
  resetAt?: string;
  updatedAt: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** ISO 8601 week (Monday start), UTC — duplicated from adapter-native's
 *  `isoWeek` on purpose: core has no runtime dependency on the native
 *  adapter (adapter-native is a devDependency here, tests only), and burn
 *  periods are a property of the event timestamp, not of any one adapter. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function emptyOpus(id: string, ts: string): InternalOpusRow {
  return { id, state: "", probationes: {}, updatedAt: ts };
}

export class Index {
  private readonly db: DatabaseSync;
  private nextSeq = 0;

  private insertEventStmt!: StatementSync;
  private putOpusStmt!: StatementSync;
  private deleteOpusStmt!: StatementSync;
  private getOpusStmt!: StatementSync;
  private putPetitioStmt!: StatementSync;
  private getPetitioStmt!: StatementSync;
  private putProviderStmt!: StatementSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = Index.openOrRecreate(dbPath);
    } else {
      this.db = new DatabaseSync(dbPath);
    }
    this.createSchema();
    this.prepareStatements();
    this.nextSeq = this.readNextSeq();
  }

  /** Opens `dbPath` (and sets WAL mode), recovering from a corrupt/non-
   *  SQLite file instead of throwing: every table in this file is derived
   *  (module header — "Every table here is derived") from the event log,
   *  so an unreadable index db is never authoritative data to lose sleep
   *  over. `new DatabaseSync()` alone doesn't surface a "file is not a
   *  database" error — sqlite only notices once a statement actually reads
   *  the file header, which the WAL pragma below does — so both calls have
   *  to be inside the same attempt. On failure, delete the db (and any WAL/
   *  SHM/journal siblings from a half-written previous run) and start
   *  fresh; the caller (a Store, or `bisellium query --from-index`) already
   *  treats a freshly-created, empty index as the normal cold-start case. */
  private static openOrRecreate(dbPath: string): DatabaseSync {
    const tryOpen = (): DatabaseSync => {
      const db = new DatabaseSync(dbPath);
      db.exec("PRAGMA journal_mode = WAL");
      return db;
    };
    try {
      return tryOpen();
    } catch {
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        try {
          rmSync(`${dbPath}${suffix}`);
        } catch {
          // nothing to remove, or already gone — either is fine
        }
      }
      return tryOpen();
    }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ts TEXT NOT NULL,
        seq INTEGER NOT NULL,
        source TEXT,
        project_id TEXT NOT NULL,
        attrs TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_seq ON events(seq);
      CREATE INDEX IF NOT EXISTS events_ts ON events(ts);

      CREATE TABLE IF NOT EXISTS opera_state (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        collegium TEXT,
        sella TEXT,
        probationes TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS petitiones_state (
        id TEXT PRIMARY KEY,
        opus TEXT,
        from_role TEXT,
        status TEXT NOT NULL,
        opened TEXT,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers_state (
        id TEXT PRIMARY KEY,
        usagePct REAL,
        status TEXT,
        resetAt TEXT,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  private prepareStatements(): void {
    this.insertEventStmt = this.db.prepare(
      "INSERT OR IGNORE INTO events (id, name, ts, seq, source, project_id, attrs) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.putOpusStmt = this.db.prepare(
      "INSERT INTO opera_state (id, state, collegium, sella, probationes, updatedAt) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET state=excluded.state, collegium=excluded.collegium, sella=excluded.sella, " +
        "probationes=excluded.probationes, updatedAt=excluded.updatedAt",
    );
    this.deleteOpusStmt = this.db.prepare("DELETE FROM opera_state WHERE id = ?");
    this.getOpusStmt = this.db.prepare("SELECT * FROM opera_state WHERE id = ?");
    this.putPetitioStmt = this.db.prepare(
      "INSERT INTO petitiones_state (id, opus, from_role, status, opened, updatedAt) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET opus=excluded.opus, from_role=excluded.from_role, status=excluded.status, " +
        "opened=excluded.opened, updatedAt=excluded.updatedAt",
    );
    this.getPetitioStmt = this.db.prepare("SELECT * FROM petitiones_state WHERE id = ?");
    this.putProviderStmt = this.db.prepare(
      "INSERT INTO providers_state (id, usagePct, status, resetAt, updatedAt) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET usagePct=excluded.usagePct, status=excluded.status, resetAt=excluded.resetAt, updatedAt=excluded.updatedAt",
    );
  }

  private readNextSeq(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), -1) AS m FROM events").get() as { m: number } | undefined;
    return (row?.m ?? -1) + 1;
  }

  /** Drops every derived table and replays `events` from scratch — the only
   *  path that's allowed to disagree with whatever apply() built over time,
   *  since it's definitionally correct (it IS the log). */
  rebuild(events: GantryEvent[]): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM events");
      this.db.exec("DELETE FROM opera_state");
      this.db.exec("DELETE FROM petitiones_state");
      this.db.exec("DELETE FROM providers_state");
      this.nextSeq = 0;
      for (const e of events) this.applyOne(e);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Folds new events into the existing derived state — the incremental path
   *  a Store calls after every ingest(), so a query never has to wait for a
   *  full rebuild. */
  apply(events: GantryEvent[]): void {
    if (events.length === 0) return;
    this.db.exec("BEGIN");
    try {
      for (const e of events) this.applyOne(e);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private getOpus(id: string): InternalOpusRow | undefined {
    const row = this.getOpusStmt.get(id) as
      | { id: string; state: string; collegium: string | null; sella: string | null; probationes: string; updatedAt: string }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      state: row.state,
      collegium: row.collegium ?? undefined,
      sella: row.sella ?? undefined,
      probationes: JSON.parse(row.probationes) as Record<string, InternalGate>,
      updatedAt: row.updatedAt,
    };
  }

  private putOpus(row: InternalOpusRow): void {
    this.putOpusStmt.run(row.id, row.state, row.collegium ?? null, row.sella ?? null, JSON.stringify(row.probationes), row.updatedAt);
  }

  private getPetitio(id: string): PetitioState | undefined {
    const row = this.getPetitioStmt.get(id) as
      | { id: string; opus: string | null; from_role: string | null; status: string; opened: string | null; updatedAt: string }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      opus: row.opus ?? undefined,
      from: row.from_role ?? undefined,
      status: row.status,
      opened: row.opened ?? undefined,
      updatedAt: row.updatedAt,
    };
  }

  private putPetitio(row: PetitioState): void {
    this.putPetitioStmt.run(row.id, row.opus ?? null, row.from ?? null, row.status, row.opened ?? null, row.updatedAt);
  }

  private putProvider(row: ProviderState): void {
    this.putProviderStmt.run(row.id, row.usagePct ?? null, row.status ?? null, row.resetAt ?? null, row.updatedAt);
  }

  private applyOne(e: GantryEvent): void {
    const seq = this.nextSeq;
    const source = str(e.attrs[WF.SOURCE]) ?? null;
    const inserted = this.insertEventStmt.run(e.id, e.name, e.ts, seq, source, e.projectId, JSON.stringify(e.attrs));
    if (Number(inserted.changes) === 0) {
      // `INSERT OR IGNORE` was a no-op: this event id is already in the
      // table (a duplicate apply — e.g. two sources' ingests racing, or the
      // same event replayed twice). Its derived-state effects were already
      // folded in the first time it was applied, so redoing them here would
      // just rewrite the same values — harmless, but consuming a fresh seq
      // for a row that was never added would drift `stats().lastSeq` off
      // `MAX(seq)` (confirmed empirically: re-applying the same event
      // bumped lastSeq with no corresponding events row). Skip both.
      return;
    }
    this.nextSeq++;

    const itemId = str(e.attrs[WF.ITEM_ID]);
    if (itemId !== undefined) {
      if (e.name === "workflow.item_removed") {
        this.deleteOpusStmt.run(itemId);
      } else if (e.name === "workflow.item_appeared" || e.name === "workflow.state_changed") {
        const row = this.getOpus(itemId) ?? emptyOpus(itemId, e.ts);
        const to = str(e.attrs[WF.STATE_TO]);
        if (to !== undefined) row.state = to;
        const dept = str(e.attrs[WF.DEPARTMENT]);
        if (dept !== undefined) row.collegium = dept;
        if (e.name === "workflow.item_appeared") {
          const role = str(e.attrs[WF.ACTOR_ROLE]);
          if (role !== undefined) row.sella = role;
        }
        row.updatedAt = e.ts;
        this.putOpus(row);
      } else if (e.name === "workflow.gate_evaluated") {
        const row = this.getOpus(itemId) ?? emptyOpus(itemId, e.ts);
        const dept = str(e.attrs[WF.DEPARTMENT]);
        if (dept !== undefined) row.collegium = dept;
        const gateId = str(e.attrs[WF.GATE_ID]);
        const status = str(e.attrs[WF.GATE_STATUS]);
        if (gateId !== undefined && status !== undefined) {
          const certifies = str(e.attrs[WF.GATE_CERTIFIES]);
          const kind = str(e.attrs[WF.GATE_KIND]);
          row.probationes[gateId] = {
            status,
            ...(certifies !== undefined ? { certifies } : {}),
            ...(kind !== undefined ? { kind } : {}),
          };
        }
        row.updatedAt = e.ts;
        this.putOpus(row);
      } else if (e.name === "workflow.actor_assigned") {
        const row = this.getOpus(itemId) ?? emptyOpus(itemId, e.ts);
        const role = str(e.attrs[WF.ACTOR_ROLE]);
        if (role !== undefined) row.sella = role;
        const dept = str(e.attrs[WF.DEPARTMENT]);
        if (dept !== undefined) row.collegium = dept;
        row.updatedAt = e.ts;
        this.putOpus(row);
      }
    }

    if (e.name === "workflow.attention") {
      const thread = str(e.attrs[WF.ATTENTION_THREAD]);
      if (thread !== undefined) {
        const prev = this.getPetitio(thread);
        const status = str(e.attrs[WF.ATTENTION_EVENT]) ?? prev?.status ?? "";
        const opus = str(e.attrs[WF.ITEM_ID]) ?? prev?.opus;
        const from = str(e.attrs[WF.ACTOR_ROLE]) ?? prev?.from;
        // "opened" tracks the ts of the most recent transition INTO
        // "requested" — the same observation-time honesty the rest of this
        // wire format uses (workflow.time.derived): it's when we first saw
        // the thread go live, not necessarily when the file itself says.
        const opened = status === "requested" ? e.ts : prev?.opened;
        this.putPetitio({ id: thread, opus, from, status, opened, updatedAt: e.ts });
      }
    }

    if (e.name === "provider.status") {
      const pid = str(e.attrs[WF.PROVIDER_ID]);
      if (pid !== undefined) {
        const usagePct = num(e.attrs[WF.PROVIDER_USAGE_PCT]);
        const status = str(e.attrs[WF.PROVIDER_STATUS]);
        const resetAt = str(e.attrs[WF.PROVIDER_RESET_AT]);
        this.putProvider({ id: pid, usagePct, status, resetAt, updatedAt: e.ts });
      }
    }
  }

  private static toPublicRow(row: InternalOpusRow): OpusRow {
    const probationes: Record<string, GateResult> = {};
    for (const [gid, g] of Object.entries(row.probationes)) {
      probationes[gid] = g.certifies !== undefined ? { status: g.status, certifies: g.certifies } : { status: g.status };
    }
    return { id: row.id, state: row.state, collegium: row.collegium, sella: row.sella, probationes, updatedAt: row.updatedAt };
  }

  opera(filter: OperaFilter = {}): OpusRow[] {
    const out: OpusRow[] = [];
    for (const row of this.operaInternal()) {
      if (filter.state !== undefined && row.state !== filter.state) continue;
      if (filter.collegium !== undefined && row.collegium !== filter.collegium) continue;
      if (filter.sella !== undefined && row.sella !== filter.sella) continue;
      out.push(Index.toPublicRow(row));
    }
    return out;
  }

  opus(id: string): OpusRow | undefined {
    const row = this.getOpus(id);
    return row ? Index.toPublicRow(row) : undefined;
  }

  /** ADOPTION.md: "a pending gate of kind human is what needs you means" —
   *  the probatio side comes from `workflow.gate_evaluated`'s GATE_KIND
   *  (stamped by the differ from the caller's `humanGates`, see differ.ts);
   *  the petitio side is every thread whose latest event is still
   *  "requested" (needs_you or awaiting_reply — see the differ's
   *  ATTENTION_MAP) and whose opener isn't "you" (the Patron), i.e. a sella
   *  is actually waiting on you, not the other way round. */
  needsYou(): NeedsYouResult {
    const probationes: NeedsYouProbatio[] = [];
    for (const row of this.operaInternal()) {
      for (const [gid, g] of Object.entries(row.probationes)) {
        if (g.kind === "human" && g.status === "pending") probationes.push({ opus: row.id, probatio: gid });
      }
    }
    probationes.sort((a, b) => (a.opus === b.opus ? a.probatio.localeCompare(b.probatio) : a.opus.localeCompare(b.opus)));

    const petitiones: NeedsYouPetitio[] = [];
    const rows = this.db.prepare("SELECT * FROM petitiones_state ORDER BY id").all() as {
      id: string;
      opus: string | null;
      from_role: string | null;
      status: string;
      opened: string | null;
    }[];
    for (const r of rows) {
      if (r.status !== "requested") continue;
      if (r.from_role === "you" || r.from_role === null) continue;
      petitiones.push({ id: r.id, opus: r.opus ?? undefined, from: r.from_role, opened: r.opened ?? undefined });
    }
    return { probationes, petitiones };
  }

  private operaInternal(): InternalOpusRow[] {
    const rows = this.db.prepare("SELECT * FROM opera_state ORDER BY id").all() as {
      id: string;
      state: string;
      collegium: string | null;
      sella: string | null;
      probationes: string;
      updatedAt: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      state: r.state,
      collegium: r.collegium ?? undefined,
      sella: r.sella ?? undefined,
      probationes: JSON.parse(r.probationes) as Record<string, InternalGate>,
      updatedAt: r.updatedAt,
    }));
  }

  /** Sum of `gen_ai.usage.total_tokens` (or `input_tokens` + `output_tokens`
   *  when the total wasn't reported) over every event whose timestamp falls
   *  in ISO week `period`, optionally restricted to one collegium
   *  (`WF.DEPARTMENT` on the usage event itself — the same attribute
   *  `workflow.*` lifecycle events use, so a usage span emitted alongside a
   *  gate/state event for the same opus rolls up the same way). */
  burn(period: string, collegium?: string): number {
    const rows = this.db.prepare("SELECT ts, attrs FROM events").all() as { ts: string; attrs: string }[];
    let total = 0;
    for (const r of rows) {
      const ts = new Date(r.ts);
      if (Number.isNaN(ts.getTime()) || isoWeek(ts) !== period) continue;
      const attrs = JSON.parse(r.attrs) as Record<string, string | number | boolean>;
      if (collegium !== undefined && attrs[WF.DEPARTMENT] !== collegium) continue;
      const total_tokens = attrs["gen_ai.usage.total_tokens"];
      if (typeof total_tokens === "number") {
        total += total_tokens;
        continue;
      }
      const input = attrs["gen_ai.usage.input_tokens"];
      const output = attrs["gen_ai.usage.output_tokens"];
      if (typeof input === "number" && typeof output === "number") total += input + output;
    }
    return total;
  }

  /** Every event whose WF.ACTOR_ROLE matches `sella`, oldest first, capped at
   *  `limit` most recent (mirrors `timeline/<sella>.jsonl`'s intent — a
   *  per-seat chronological feed — but derived from the index, not the file). */
  timeline(sella: string, limit = 100): TimelineEntry[] {
    const rows = this.db.prepare("SELECT seq, ts, name, attrs FROM events ORDER BY seq").all() as {
      seq: number;
      ts: string;
      name: string;
      attrs: string;
    }[];
    const out: TimelineEntry[] = [];
    for (const r of rows) {
      const attrs = JSON.parse(r.attrs) as Record<string, string | number | boolean>;
      if (attrs[WF.ACTOR_ROLE] !== sella) continue;
      out.push({ seq: r.seq, ts: r.ts, name: r.name, attrs });
    }
    return out.slice(Math.max(0, out.length - limit));
  }

  /** Raw events in log order, strictly after `since` (a seq number, or an
   *  ISO timestamp string — ISO 8601 strings sort lexicographically the same
   *  as chronologically, so a plain string compare is exact), capped at
   *  `limit`. Omitting `since` returns from the start of the log. `seq` on
   *  each row is this Index's own monotonic counter (`applyOne`'s
   *  `nextSeq`) — the single authoritative sequence across every source
   *  that ever ingested into this Index, never a re-derived `log.length`
   *  (W-016 behaviour 4: two sources appending interleaved must still yield
   *  strictly increasing, non-colliding `seq`). */
  events(since?: number | string, limit = 1000): (GantryEvent & { seq: number })[] {
    const rows = this.db.prepare("SELECT id, name, ts, seq, project_id, attrs FROM events ORDER BY seq").all() as {
      id: string;
      name: string;
      ts: string;
      seq: number;
      project_id: string;
      attrs: string;
    }[];
    const out: (GantryEvent & { seq: number })[] = [];
    for (const r of rows) {
      if (typeof since === "number" && r.seq <= since) continue;
      if (typeof since === "string" && !(r.ts > since)) continue;
      const attrs = JSON.parse(r.attrs) as Record<string, string | number | boolean>;
      out.push({ id: r.id, name: r.name, ts: r.ts, projectId: r.project_id, attrs, seq: r.seq });
      if (out.length >= limit) break;
    }
    return out;
  }

  stats(): IndexStats {
    const events = (this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
    const opera = (this.db.prepare("SELECT COUNT(*) AS n FROM opera_state").get() as { n: number }).n;
    const petitiones = (this.db.prepare("SELECT COUNT(*) AS n FROM petitiones_state").get() as { n: number }).n;
    const providers = (this.db.prepare("SELECT COUNT(*) AS n FROM providers_state").get() as { n: number }).n;
    return { events, opera, petitiones, providers, lastSeq: this.nextSeq - 1 };
  }

  close(): void {
    this.db.close();
  }
}
