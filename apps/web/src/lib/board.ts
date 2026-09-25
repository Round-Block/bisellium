/**
 * apps/web/src/lib/board.ts — W-064: the Board's pure resolvers. No DOM, no
 * fetch — records in, records out, so behaviours 1-4 are testable under
 * plain node. `Board.tsx` is the only caller that touches `fetch`/SSE.
 */
import type { EventRow, InboxResponse, OfficinaResponse, OpusEntry } from "../api.js";
import type { Gate, GateStatus } from "./gateLadder.js";

export const NEEDS_YOU_COLUMN = "needs_you";
/** Board policy, not the lifecycle's: backlog is a count, not a column
 *  (Main.dc.html's own Planned footer). Everything else about the column set
 *  comes from the served lifecycle. */
export const EXCLUDED_PHASES: readonly string[] = ["backlog"];

/** Only the phases this brief actually names get a friendlier head; anything
 *  else (a fixture's own extra phase) is humanized from its id rather than
 *  hardcoded — the column set must never be a constant (behaviour 1). */
const PHASE_NAMES: Record<string, string> = {
  planned: "Planned",
  in_progress: "In progress",
  verifying: "Verifying",
  awaiting_review: "Awaiting review",
  done: "Done",
  halted: "Halted",
};

function humanizePhase(phase: string): string {
  return PHASE_NAMES[phase] ?? phase.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export interface CardRow {
  id: string;
  title: string;
  sella?: string;
  /** The NATIVE state, rendered inline beside the sella on line three
   *  (ui-lead ruling 8). */
  state: string;
  gates: Gate[];
  needsYou: boolean;
  blocked: boolean;
}

export interface BoardColumn {
  id: string;
  name: string;
  /** Pinned only on the needs-you column, and only at >=900px. */
  pinned: boolean;
  cards: CardRow[];
  /** Present on the in-progress column only. */
  cap?: number;
  atCap: boolean;
  /** Planned only: the canvas's "N backlogged" footer. */
  backlogCount?: number;
  /** True on needs_you: its count is an ATTENTION MEMBERSHIP, never summed
   *  into an officina total (ruling 16). */
  membership: boolean;
}

export interface BoardModel {
  columns: BoardColumn[];
  /** Opera whose state maps to no declared phase: counted and named, never
   *  dropped into the first column and never thrown on. */
  unplaced: string[];
}

export function humanGateIds(o: Pick<OfficinaResponse, "probationes">): Set<string> {
  return new Set(o.probationes.filter((p) => p.kind === "human").map((p) => p.id));
}

/** One `Gate` per DECLARED probatio, in manifest order — never the opus's
 *  own key order. A result for an undeclared gate is ignored; a declared
 *  gate with no result is `pending`. `stale` reuses the `pending` mark
 *  (ruling 17 — the literal word still carries in the drawer's own text). */
export function gateRow(declared: OfficinaResponse["probationes"], results: OpusEntry["probationes"]): Gate[] {
  return declared.map((g): Gate => {
    const status = results[g.id]?.status ?? "pending";
    let mapped: GateStatus;
    if (status === "stale") mapped = "pending";
    else if (g.kind === "human" && status === "passed") mapped = "human_passed";
    else mapped = status as GateStatus;
    return { id: g.id, status: mapped };
  });
}

/** `gates` starts empty — `boardModel` is what has the declared manifest
 *  order to fill it in (see its own body); a caller of `cardRow` alone gets
 *  blocked/needsYou/id/title/sella/state, computed from `opus.probationes`
 *  values directly (order-independent booleans, so no declared list is
 *  needed here). */
export function cardRow(opus: OpusEntry, human: Set<string>): CardRow {
  const results = Object.entries(opus.probationes);
  const blocked = results.some(([, r]) => r.status === "failed");
  const needsYou = results.some(([id, r]) => human.has(id) && r.status === "pending");
  return {
    id: opus.id,
    title: opus.title,
    sella: opus.sella || undefined,
    state: opus.state,
    gates: [],
    needsYou,
    blocked,
  };
}

export function boardModel(o: Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit">, opera: OpusEntry[]): BoardModel {
  const human = humanGateIds(o);

  // Unique phases, in the lifecycle's own declared order, backlog excluded.
  const phases: string[] = [];
  for (const s of o.lifecycle.states) {
    if (EXCLUDED_PHASES.includes(s.phase) || phases.includes(s.phase)) continue;
    phases.push(s.phase);
  }
  const stateToPhase = new Map(o.lifecycle.states.map((s) => [s.id, s.phase] as const));

  const columns = new Map<string, BoardColumn>();
  columns.set(NEEDS_YOU_COLUMN, { id: NEEDS_YOU_COLUMN, name: "Needs you", pinned: true, cards: [], atCap: false, membership: true });
  for (const phase of phases) {
    const col: BoardColumn = { id: phase, name: humanizePhase(phase), pinned: false, cards: [], atCap: false, membership: false };
    if (phase === "in_progress" && o.wip_limit !== undefined) col.cap = o.wip_limit;
    if (phase === "planned") col.backlogCount = 0;
    columns.set(phase, col);
  }

  const unplaced: string[] = [];
  for (const opus of opera) {
    const phase = stateToPhase.get(opus.state);
    const card = cardRow(opus, human);
    card.gates = gateRow(o.probationes, opus.probationes);

    if (card.needsYou) {
      const needsYouColumn = columns.get(NEEDS_YOU_COLUMN);
      if (needsYouColumn) needsYouColumn.cards.push({ ...card });
    }

    if (phase !== undefined && EXCLUDED_PHASES.includes(phase)) {
      const planned = columns.get("planned");
      if (planned) planned.backlogCount = (planned.backlogCount ?? 0) + 1;
      continue;
    }

    const column = phase !== undefined ? columns.get(phase) : undefined;
    if (!column) {
      unplaced.push(opus.id);
      continue;
    }
    column.cards.push(card);
  }

  for (const col of columns.values()) {
    if (col.cap !== undefined) col.atCap = col.cards.length >= col.cap;
  }

  return { columns: [...columns.values()], unplaced };
}

const REFETCH_NAMES = new Set([
  "workflow.item_appeared",
  "workflow.state_changed",
  "workflow.gate_evaluated",
  "workflow.actor_assigned",
  "workflow.item_removed",
  "workflow.attention",
]);

/** True for a frame name that can change what the Board shows. The seam
 *  that makes SSE a nudge rather than a feed. */
export function boardNeedsRefetch(event: { name: string }): boolean {
  return REFETCH_NAMES.has(event.name);
}

/** True when an open drawer on `selected` must refetch that item's events: a
 *  relevant frame naming the selected item. */
export function drawerNeedsRefetch(event: { name: string; attrs: Record<string, unknown> }, selected: string | undefined): boolean {
  if (selected === undefined || !boardNeedsRefetch(event)) return false;
  return event.attrs["workflow.item.id"] === selected;
}

export type ReconcileReason = "initial" | "reconnect";

/** The enumeration IS the contract in *Liveness*: there is no periodic
 *  reason, by design. */
export function reconcileReason(prev: { connected: boolean; everFetched: boolean }, next: { connected: boolean }): ReconcileReason | undefined {
  if (!next.connected) return undefined;
  if (!prev.everFetched) return "initial";
  if (!prev.connected) return "reconnect";
  return undefined;
}

/** WHAT a reconciliation fetches — a function of the selection, not a
 *  constant. With a drawer open it includes that item's events, because a
 *  drawer open across a disconnect is otherwise never repaired (ui-lead
 *  closure, finding 2). */
export function reconcileTargets(selected: string | undefined): string[] {
  const base = ["/api/officina", "/api/opera", "/api/inbox"];
  return selected === undefined ? base : [...base, `/api/events?item=${encodeURIComponent(selected)}`];
}

/** Connection state and last successful refresh are reported SEPARATELY
 *  (ruling 10) — a connected stream that has not refreshed is not "updated".
 *  `now` is accepted for interface symmetry with a future relative-time
 *  upgrade; the literal ISO string is rendered rather than reformatted so
 *  the claim ("renders lastRefreshAt, never now") holds by construction. */
export function liveLabel(input: { connected: boolean; lastRefreshAt?: string; now: Date }): string {
  if (!input.connected) return "disconnected";
  if (input.lastRefreshAt === undefined) return "connected";
  if (Number.isNaN(new Date(input.lastRefreshAt).getTime())) return "connected";
  return `live · updated ${input.lastRefreshAt}`;
}

export interface DrawerDetail {
  id: string;
  title: string;
  state: string;
  sella?: string;
  collegium?: string;
  /** One row per DECLARED probatio, manifest order. `status` is the literal
   *  status WORD and is always rendered as text — never hover-only
   *  (ruling 17). */
  gates: { id: string; name: string; status: string; human: boolean; evidence?: string; certifies?: string }[];
  /** Set only when a human gate is pending. `petitio` is joined from
   *  /api/inbox on `opus`; absent when no petitio names this opus. */
  waitingOn?: { gate: string; name: string; petitio?: { id: string; from: string; subject: string } };
  record: { label: string; value: string }[];
  /** Event-derived and possibly incomplete — rendered beside the front
   *  matter's own `tokens` total, with both sources named (ruling 14). */
  tokensBySella: { sella: string; tokens: number }[];
  tokensDeclared?: number;
  /** Newest first: the reversal of the route's ascending order. */
  events: { at: string; name: string; summary: string }[];
}

function summarizeEvent(e: EventRow): string {
  const a = e.attrs;
  switch (e.name) {
    case "workflow.item_appeared":
      return "appeared";
    case "workflow.state_changed":
      return `state ${String(a["workflow.state.from"] ?? "?")} → ${String(a["workflow.state.to"] ?? "?")}`;
    case "workflow.gate_evaluated":
      return `gate ${String(a["workflow.gate.id"] ?? "?")} ${String(a["workflow.gate.status"] ?? "?")}`;
    case "workflow.actor_assigned":
      return `assigned ${String(a["workflow.actor.role"] ?? "?")}`;
    case "workflow.item_removed":
      return "removed";
    case "workflow.attention":
      return `attention ${String(a["workflow.attention.event"] ?? "")}`.trim();
    case "gen_ai.usage":
      return `usage by ${String(a["workflow.actor.role"] ?? "?")}`;
    default:
      return e.name;
  }
}

function eventTokens(e: EventRow): number | undefined {
  const total = e.attrs["gen_ai.usage.total_tokens"];
  if (typeof total === "number") return total;
  const input = e.attrs["gen_ai.usage.input_tokens"];
  const output = e.attrs["gen_ai.usage.output_tokens"];
  if (typeof input === "number" && typeof output === "number") return input + output;
  return undefined;
}

export function drawerDetail(
  opus: OpusEntry,
  o: Pick<OfficinaResponse, "probationes">,
  inbox: Pick<InboxResponse, "petitiones">,
  events: EventRow[],
): DrawerDetail {
  const human = humanGateIds(o);
  const gates = o.probationes.map((g) => {
    const result = opus.probationes[g.id];
    const status = result?.status ?? "pending";
    return {
      id: g.id,
      name: g.name ?? g.id,
      status,
      human: human.has(g.id),
      evidence: result?.evidence?.href,
      certifies: result?.evidence?.certifies,
    };
  });

  const pendingHuman = gates.find((g) => g.human && g.status === "pending");
  let waitingOn: DrawerDetail["waitingOn"];
  if (pendingHuman) {
    const petitio = inbox.petitiones.find((p) => p.opus === opus.id);
    waitingOn = {
      gate: pendingHuman.id,
      name: pendingHuman.name,
      petitio: petitio ? { id: petitio.id, from: petitio.from, subject: petitio.subject } : undefined,
    };
  }

  const record: { label: string; value: string }[] = [];
  const traditio = opus.traditio;
  if (typeof traditio === "object" && traditio !== null) {
    for (const [key, value] of Object.entries(traditio as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) record.push({ label: key, value });
    }
  }

  const bySella = new Map<string, number>();
  for (const e of events) {
    if (e.name !== "gen_ai.usage") continue;
    const sella = e.attrs["workflow.actor.role"];
    const tokens = eventTokens(e);
    if (typeof sella === "string" && tokens !== undefined) bySella.set(sella, (bySella.get(sella) ?? 0) + tokens);
  }

  return {
    id: opus.id,
    title: opus.title,
    state: opus.state,
    sella: opus.sella || undefined,
    collegium: opus.collegium || undefined,
    gates,
    waitingOn,
    record,
    tokensBySella: [...bySella.entries()].map(([sella, tokens]) => ({ sella, tokens })),
    tokensDeclared: opus.tokens,
    events: [...events].reverse().map((e) => ({ at: e.ts, name: e.name, summary: summarizeEvent(e) })),
  };
}
