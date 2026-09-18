/**
 * @bisellium/schema — the contract every layer shares.
 *
 * Design authority: the Bisellium Dossier (see repo README). The wire format for
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

export interface Sella {
  /** Unique per instantiation, e.g. "sol-review-2026-09-10T14:02". */
  id: string;
  /** Stable sella/role, e.g. "final-reviewer" — swimlane rows key on this. */
  roleId: string;
  projectId: string;
  kind: ActorKind;
  /** Bisellium collegium this sella belongs to; cost and acta rollups key on it. */
  collegiumId?: string;
  /** Model, version, prompt hash… deliberately unstandardized. */
  meta: Record<string, unknown>;
}

/**
 * Probatio result states. "stale": the certificate was valid for a specific
 * commit and a newer substantive change voided it (epoch0 WORKFLOW §7.4).
 * Never silently mapped back to "pending" — passed-then-voided is information.
 */
export const PROBATIO_STATUSES = ["pending", "passed", "failed", "waived", "stale"] as const;
export type ProbatioStatus = (typeof PROBATIO_STATUSES)[number];

/**
 * Who holds the verdict.
 *  - automated: a script/CI decides (evidence link mandatory)
 *  - agent:     a judgment verdict held by an agent sella (sol review, astra
 *               acceptance, Controller V1) — blocking, but never enters the
 *               patron's inbox
 *  - human:     the patron decides — pending ⇒ the item needs your input
 */
export const PROBATIO_KINDS = ["automated", "agent", "human"] as const;
export type ProbatioKind = (typeof PROBATIO_KINDS)[number];

export interface Probatio {
  id: string;
  name: string;
  kind: ProbatioKind;
  /** Lifecycle state this probatio must pass before the item may leave. */
  requiredForState?: string;
  /** Shell command that decides this probatio when it's automated — the
   *  seam `bisellium verify` runs (packages/pipeline). Absent for gates a
   *  human or agent still decides by hand. */
  command?: string;
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
  /** actors: role ids permitted to perform the transition (Production may
   *  halt, the merge script may flip done, the Patron greenlights). */
  transitions: { from: string; to: string; actors?: string[] }[];
  gates: Probatio[];
  /** Per-lane WIP cap, rendered as "2/2" on board columns. */
  wipLimit?: number;
}

export interface ProbatioResult {
  status: ProbatioStatus;
  /** Evidence link with identity: URL/path plus the artifact hash or commit
   *  SHA this result certifies. Identity is what makes `stale` computable. */
  evidence?: { href: string; certifies?: string };
  /** Observation time of the latest evaluation. */
  at?: string;
}

export interface Opus {
  id: string;
  projectId: string;
  /** "train", "task", "run", "wave" (post-merge batch QA), "art-batch"… */
  kind: string;
  lifecycleId: string;
  /** Must be a member of the lifecycle's states. */
  state: string;
  parentOpusId?: string;
  probationes: Record<string, ProbatioResult>;
  /** Priority (P0–P3), source, PR number… adapter-defined. */
  meta: Record<string, unknown>;
}

/**
 * Provider limit pressure — routing state, not a metrics zoo.
 * Postures follow epoch0 ART_WORKFLOW §10; "unknown" is honest (missing or
 * stale telemetry) and is never guessed as "ok".
 */
export const PROVIDER_STATUSES = ["ok", "conserve", "closeout", "limited", "unknown"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export interface Provider {
  id: string; // "claude", "codex", "spark"
  usagePct: number;
  resetAt?: string;
  status: ProviderStatus;
  /** e.g. "surge lane active — builds overflow to terra" */
  note?: string;
}

// ---------------------------------------------------------------------------
// Bisellium studio model (conventions, not a runtime). A collegium is
// lex + aerarium + acta; the Patron touches only greenlight, budget
// allocation, taste calls, and lex changes.
// ---------------------------------------------------------------------------

/**
 * Autonomy level (dossier §10), declared per collegium and driven by one
 * scheduler (`bisellium tick`). Defaults to "L1" when a collegium doesn't
 * declare one — scheduled cadence work, never dispatching or self-assigning.
 */
export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface Collegium {
  id: string;
  projectId: string;
  name: string;
  magisterRoleId: string;
  /** Acting magister for routing when the magister is stale. */
  fallbackRoleId?: string;
  /** The lex document (LEX_TEMPLATE.md instance). */
  lexHref?: string;
  /** L0 manual .. L3 continuous (dossier §10). Defaults to "L1". */
  autonomy?: AutonomyLevel;
}

export interface Stipendium {
  collegiumId: string;
  /** e.g. "2026-W38". Unspent does not roll over. */
  period: string;
  allowance: { tokens?: number; hours?: number };
  /** Always derived (usage events / item tokens), never read from a file. */
  burn: { tokens: number; hours?: number };
  /** Derived from burn vs allowance and provider telemetry — never
   *  self-declared "ok" without data. */
  posture: ProviderStatus;
}

/** The inbox unit. Strict admission: only questions addressed to the patron
 *  and replies in threads the patron opened. Acta are a separate feed. */
export const PETITIO_STATES = ["needs_you", "awaiting_reply", "resolved"] as const;
export type PetitioState = (typeof PETITIO_STATES)[number];

export interface Petitio {
  id: string;
  /** Absent for petitiones not about one item (scope, aerarium, lex, routing). */
  opusId?: string;
  openedBy: string; // actor roleId, or "you"
  counterparty: string;
  state: PetitioState;
  /** First line of the question, for inbox rows. */
  subject?: string;
}

export const ACTUM_KINDS = ["consultation", "decision", "daily"] as const;
export type ActumKind = (typeof ACTUM_KINDS)[number];

/** Acta: inform-and-proceed. Never require a reply; silence binds
 *  nothing (epoch0 ART_WORKFLOW §8 consultation model). */
export interface Actum {
  id: string;
  projectId: string;
  authorRoleId: string;
  at: string;
  kind: ActumKind;
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
  /** The commit/artifact identity a gate result certifies — separate from
   *  GATE_EVIDENCE (the href) so a link rot doesn't read as a re-evaluation. */
  GATE_CERTIFIES: "workflow.gate.certifies",
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
  DEPARTMENT: "workflow.department",
  GREENLIGHT: "workflow.greenlight", // "requested" | "granted" | "declined"
  DIGEST_ID: "workflow.digest.id",
  DIGEST_KIND: "workflow.digest.kind",
  PROVIDER_ID: "provider.id",
  PROVIDER_USAGE_PCT: "provider.usage_pct",
  PROVIDER_STATUS: "provider.status",
  PROVIDER_RESET_AT: "provider.reset_at",
} as const;

export type WorkflowEventName =
  | "workflow.state_changed"
  | "workflow.gate_evaluated"
  | "workflow.item_appeared"
  | "workflow.item_removed"
  | "workflow.actor_assigned"
  | "workflow.attention"
  | "workflow.digest"
  | "workflow.greenlight"
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
  sellae: Sella[];
  opera: Opus[];
  providers?: Provider[];
  acta?: Actum[];
  collegia?: Collegium[];
  stipendia?: Stipendium[];
  petitiones?: Petitio[];
}

export interface AdapterBase {
  projectId: string;
  describeLifecycles(): Lifecycle[];
  /** Optional command channel. Delivery is at the agent's next turn
   *  boundary; snapshot-only sources may degrade to an inbox file. */
  send?(target: { sellaId?: string; opusId?: string; petitioId?: string }, message: string): Promise<{ delivered: boolean; note?: string }>;
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
