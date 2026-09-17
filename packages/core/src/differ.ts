/**
 * Snapshot differ: turns two consecutive adapter snapshots into
 * `workflow.*`/`provider.status` events. `prev === null` means the source
 * has no history yet, so everything currently in `next` "appears".
 * Every event carries workflow.time.derived = true — the timestamp is
 * observation time (ctx.ts), not occurrence time.
 */
import { WF, type GantryEvent, type GateResult, type Snapshot, type ThreadState } from "@bisellium/schema";

export interface DiffContext {
  source: string;
  seq: number;
  ts: string;
  projectId: string;
}

export interface DiffResult {
  events: GantryEvent[];
  seq: number;
}

type Attrs = Record<string, string | number | boolean>;

const ATTENTION_MAP: Record<ThreadState, "requested" | "resolved"> = {
  needs_you: "requested",
  awaiting_reply: "requested",
  resolved: "resolved",
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function gateEvidence(gr: GateResult | undefined): string | undefined {
  return gr?.evidence?.certifies ?? gr?.evidence?.href;
}

function gateChanged(prev: GateResult | undefined, next: GateResult): boolean {
  return prev?.status !== next.status || gateEvidence(prev) !== gateEvidence(next);
}

export function diffSnapshots(prev: Snapshot | null, next: Snapshot, ctx: DiffContext): DiffResult {
  const events: GantryEvent[] = [];
  let seq = ctx.seq;

  const emit = (name: string, attrs: Attrs): void => {
    events.push({
      id: `${ctx.source}:${seq}`,
      name,
      ts: ctx.ts,
      projectId: ctx.projectId,
      attrs: {
        ...attrs,
        [WF.SOURCE]: ctx.source,
        [WF.SOURCE_SEQ]: seq,
        [WF.TIME_DERIVED]: true,
      },
    });
    seq++;
  };

  // ---- work items -----------------------------------------------------
  const prevItems = new Map((prev?.workItems ?? []).map((w) => [w.id, w] as const));
  const nextItemIds = new Set(next.workItems.map((w) => w.id));

  for (const item of next.workItems) {
    const department = str(item.meta["department"]);
    const base: Attrs = { [WF.ITEM_ID]: item.id };
    if (department !== undefined) base[WF.DEPARTMENT] = department;

    const prevItem = prevItems.get(item.id);
    if (!prevItem) {
      const attrs: Attrs = { ...base, [WF.STATE_TO]: item.state };
      const owner = str(item.meta["owner"]);
      if (owner !== undefined) attrs[WF.ACTOR_ROLE] = owner;
      emit("workflow.item_appeared", attrs);
      continue;
    }

    if (prevItem.state !== item.state) {
      emit("workflow.state_changed", { ...base, [WF.STATE_FROM]: prevItem.state, [WF.STATE_TO]: item.state });
    }

    for (const [gateId, gateResult] of Object.entries(item.gateStatus)) {
      if (!gateChanged(prevItem.gateStatus[gateId], gateResult)) continue;
      const attrs: Attrs = { ...base, [WF.GATE_ID]: gateId, [WF.GATE_STATUS]: gateResult.status };
      const evidence = gateEvidence(gateResult);
      if (evidence !== undefined) attrs[WF.GATE_EVIDENCE] = evidence;
      emit("workflow.gate_evaluated", attrs);
    }

    const prevOwner = str(prevItem.meta["owner"]);
    const nextOwner = str(item.meta["owner"]);
    if (nextOwner !== undefined && nextOwner !== prevOwner) {
      emit("workflow.actor_assigned", { ...base, [WF.ACTOR_ROLE]: nextOwner });
    }
  }

  for (const item of prev?.workItems ?? []) {
    if (nextItemIds.has(item.id)) continue;
    const department = str(item.meta["department"]);
    const attrs: Attrs = { [WF.ITEM_ID]: item.id };
    if (department !== undefined) attrs[WF.DEPARTMENT] = department;
    emit("workflow.item_removed", attrs);
  }

  // ---- threads (attention) ---------------------------------------------
  const prevThreads = new Map((prev?.threads ?? []).map((t) => [t.id, t] as const));
  for (const thread of next.threads ?? []) {
    const prevThread = prevThreads.get(thread.id);
    if (prevThread && prevThread.state === thread.state) continue;
    const attrs: Attrs = {
      [WF.ATTENTION_THREAD]: thread.id,
      [WF.ATTENTION_EVENT]: ATTENTION_MAP[thread.state],
    };
    if (thread.workItemId !== undefined) attrs[WF.ITEM_ID] = thread.workItemId;
    emit("workflow.attention", attrs);
  }

  // ---- digest: append-only, only new entries fire -----------------------
  const prevDigestIds = new Set((prev?.digest ?? []).map((d) => d.id));
  for (const entry of next.digest ?? []) {
    if (prevDigestIds.has(entry.id)) continue;
    emit("workflow.digest", { "workflow.digest.id": entry.id });
  }

  // ---- providers ---------------------------------------------------------
  const prevProviders = new Map((prev?.providers ?? []).map((p) => [p.id, p] as const));
  for (const provider of next.providers ?? []) {
    const prevProvider = prevProviders.get(provider.id);
    if (prevProvider && prevProvider.usagePct === provider.usagePct && prevProvider.status === provider.status) continue;
    emit("provider.status", {
      "provider.id": provider.id,
      "provider.usage_pct": provider.usagePct,
      "provider.status": provider.status,
    });
  }

  return { events, seq };
}
