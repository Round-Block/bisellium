/**
 * The event store: appends diffed events to the JSONL log and rebuilds
 * whatever an index needs to answer purely from that log. One store owns
 * one log file and may ingest snapshots from several sources, each keeping
 * its own last-seen snapshot and seq counter.
 */
import { WF, type GantryEvent, type Snapshot } from "@bisellium/schema";
import { diffSnapshots } from "./differ.js";
import { appendEvents, readLog } from "./log.js";

export interface IngestContext {
  source: string;
  ts: string;
  projectId: string;
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

// TODO(sqlite): index in a real database; for now everything below is
// rebuilt in memory from the log on every read.
export class Store {
  private readonly logPath: string;
  private readonly log: GantryEvent[];
  private readonly lastSnapshot = new Map<string, Snapshot>();
  private readonly seqBySource = new Map<string, number>();
  /** Lines in the on-disk log that failed to parse when this Store was
   *  constructed. A corrupt log is never fatal — this just says how much
   *  history was dropped. */
  readonly corruptLines: number;

  constructor(logPath: string) {
    this.logPath = logPath;
    const { events, skipped } = readLog(logPath);
    this.log = events;
    this.corruptLines = skipped;
    for (const e of this.log) {
      const source = e.attrs[WF.SOURCE];
      const seq = e.attrs[WF.SOURCE_SEQ];
      if (typeof source !== "string" || typeof seq !== "number") continue;
      const next = seq + 1;
      if (next > (this.seqBySource.get(source) ?? 0)) this.seqBySource.set(source, next);
    }
  }

  ingest(snapshot: Snapshot, ctx: IngestContext): GantryEvent[] {
    const prev = this.lastSnapshot.get(ctx.source) ?? null;
    const seq = this.seqBySource.get(ctx.source) ?? 0;
    const { events, seq: nextSeq } = diffSnapshots(prev, snapshot, { source: ctx.source, seq, ts: ctx.ts, projectId: ctx.projectId });
    if (events.length > 0) {
      appendEvents(this.logPath, events);
      this.log.push(...events);
    }
    this.seqBySource.set(ctx.source, nextSeq);
    this.lastSnapshot.set(ctx.source, snapshot);
    return events;
  }

  events(): GantryEvent[] {
    return [...this.log];
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
