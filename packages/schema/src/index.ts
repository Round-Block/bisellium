/**
 * @gantry/schema — the contract every layer shares.
 *
 * Design authority: the Gantry Dossier (see repo README). The wire format for
 * runtime activity is standard OpenTelemetry GenAI spans; the lifecycle layer
 * OTel lacks is carried in the `workflow.*` attribute namespace defined here.
 */

// ---------------------------------------------------------------------------
// Phases — the fixed normalization that lets one board span projects with
// incompatible lifecycles. Deliberately NOT extensible (principle 2).
// ---------------------------------------------------------------------------

export const PHASES = [
  "backlog",
  "planned",
  "in_progress",
  "verifying",
  "awaiting_review",
  "done",
  "halted",
] as const;
export type Phase = (typeof PHASES)[number];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export type ActorKind = "orchestrator" | "agent" | "tool" | "human" | "service";

export interface Actor {
  /** Unique per instantiation, e.g. "sol-review-2026-09-10T14:02". */
  id: string;
  /** Stable seat/role, e.g. "final-reviewer" — swimlane rows key on this. */
  roleId: string;
  projectId: string;
  kind: ActorKind;
  /** Model, version, prompt hash… deliberately unstandardized. */
  meta: Record<string, unknown>;
}

/**
 * Gate result states. "stale": the certificate was valid for a specific
 * commit and a newer substantive change voided it (epoch0 WORKFLOW §7.4).
 * Never silently mapped back to "pending" — passed-then-voided is information.
 */
export type GateStatus = "pending" | "passed" | "failed" | "waived" | "stale";

/**
 * Who holds the verdict.
 *  - automated: a script/CI decides (evidence link mandatory)
 *  - agent:     a judgment verdict held by an agent seat (sol review, astra
 *               acceptance, Controller V1) — blocking, but never enters the
 *               owner's inbox
 *  - human:     the owner decides — pending ⇒ the item needs your input
 */
export type GateKind = "automated" | "agent" | "human";

export interface Gate {
  id: string;
  name: string;
  kind: GateKind;
  /** Lifecycle state this gate must pass before the item may leave. */
  requiredForState?: string;
}

export interface LifecycleState {
  id: string;
  name: string;
  phase: Phase;
}

export interface Lifecycle {
  id: string;
  /** Ordered — single-project boards use these as columns. */
  states: LifecycleState[];
  transitions: { from: string; to: string }[];
  gates: Gate[];
  /** Per-lane WIP cap, rendered as "2/2" on board columns. */
  wipLimit?: number;
}

export interface GateResult {
  status: GateStatus;
  /** Evidence link with identity: URL/path plus the artifact hash or commit
   *  SHA this result certifies. Identity is what makes `stale` computable. */
  evidence?: { href: string; certifies?: string };
  /** Observation time of the latest evaluation. */
  at?: string;
}

export interface WorkItem {
  id: string;
  projectId: string;
  /** "train", "task", "run", "wave" (post-merge batch QA), "art-batch"… */
  kind: string;
  lifecycleId: string;
  /** Must be a member of the lifecycle's states. */
  state: string;
  parentWorkItemId?: string;
  gateStatus: Record<string, GateResult>;
  /** Priority (P0–P3), source, PR number… adapter-defined. */
  meta: Record<string, unknown>;
}

/**
 * Provider limit pressure — routing state, not a metrics zoo.
 * Postures follow epoch0 ART_WORKFLOW §10; "unknown" is honest (missing or
 * stale telemetry) and is never guessed as "ok".
 */
export type ProviderStatus = "ok" | "conserve" | "closeout" | "limited" | "unknown";

export interface Provider {
  id: string; // "claude", "codex", "spark"
  usagePct: number;
  resetAt?: string;
  status: ProviderStatus;
  /** e.g. "surge lane active — builds overflow to terra" */
  note?: string;
}

/** The inbox unit. Strict admission: only questions addressed to the owner
 *  and replies in threads the owner opened. Digests are a separate feed. */
export type ThreadState = "needs_you" | "awaiting_reply" | "resolved";

export interface Thread {
  id: string;
  workItemId: string;
  openedBy: string; // actor roleId, or "you"
  counterparty: string;
  state: ThreadState;
}

/** Digest entries: inform-and-proceed. Never require a reply; silence binds
 *  nothing (epoch0 ART_WORKFLOW §8 consultation model). */
export interface DigestEntry {
  id: string;
  projectId: string;
  authorRoleId: string;
  at: string;
  kind: "consultation" | "decision" | "daily";
  title: string;
  body: string;
  evidence: { label: string; href: string }[];
}

// ---------------------------------------------------------------------------
// Events — OTel-compatible. Runtime spans use standard gen_ai.* attributes;
// lifecycle events use the workflow.* namespace below. Cost attribution:
// sum gen_ai.usage.* over spans sharing workflow.item.id (and actor.role
// for per-seat splits).
// ---------------------------------------------------------------------------

export const WF = {
  ITEM_ID: "workflow.item.id",
  ITEM_KIND: "workflow.item.kind",
  STATE_FROM: "workflow.state.from",
  STATE_TO: "workflow.state.to",
  GATE_ID: "workflow.gate.id",
  GATE_STATUS: "workflow.gate.status",
  GATE_KIND: "workflow.gate.kind",
  GATE_EVIDENCE: "workflow.gate.evidence",
  ACTOR_ROLE: "workflow.actor.role",
  DELEGATION: "workflow.delegation", // "delegation" | "coordination"
  RETRY_ATTEMPT: "workflow.retry.attempt",
  RETRY_MAX: "workflow.retry.max",
  REVIEW_ROUND: "workflow.review.round",
  ATTENTION_THREAD: "workflow.attention.thread",
  ATTENTION_EVENT: "workflow.attention.event", // "requested"|"answered"|"resolved"
  /** true ⇒ timestamp is observation time from a snapshot diff, not
   *  occurrence time. The honesty flag. */
  TIME_DERIVED: "workflow.time.derived",
  SOURCE: "workflow.source",
  SOURCE_SEQ: "workflow.source.seq",
} as const;

export type WorkflowEventName =
  | "workflow.state_changed"
  | "workflow.gate_evaluated"
  | "workflow.item_appeared"
  | "workflow.item_removed"
  | "workflow.actor_assigned"
  | "workflow.attention"
  | "workflow.digest"
  | "provider.status";

export interface GantryEvent {
  id: string;
  name: WorkflowEventName | string;
  /** Occurrence time, or observation time when TIME_DERIVED is true. */
  ts: string;
  projectId: string;
  attrs: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Adapter contract — the only per-project code. Two styles, both first-class.
// Snapshot diffing lives in the CORE, not in adapters.
// ---------------------------------------------------------------------------

export interface Snapshot {
  actors: Actor[];
  workItems: WorkItem[];
  providers?: Provider[];
  digest?: DigestEntry[];
}

export interface AdapterBase {
  projectId: string;
  describeLifecycles(): Lifecycle[];
  /** Optional command channel. Delivery is at the agent's next turn
   *  boundary; snapshot-only sources may degrade to an inbox file. */
  send?(target: { actorId?: string; workItemId?: string; threadId?: string }, message: string): Promise<{ delivered: boolean; note?: string }>;
  /** Optional limit telemetry (observed, never guessed). */
  providerStatus?(): Promise<Provider[]>;
}

export interface SnapshotAdapter extends AdapterBase {
  style: "snapshot";
  snapshot(): Promise<Snapshot>;
  /** Suggested poll interval. */
  intervalMs: number;
}

export interface EventAdapter extends AdapterBase {
  style: "events";
  pollEvents(since: string | null): Promise<GantryEvent[]>;
}

export type Adapter = SnapshotAdapter | EventAdapter;
