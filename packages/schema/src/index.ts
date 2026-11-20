/**
 * @bisellium/schema — the contract every layer shares.
 *
 * Design authority: the Bisellium Dossier (see repo README). The wire format for
 * runtime activity is standard OpenTelemetry GenAI spans; the lifecycle layer
 * OTel lacks is carried in the `workflow.*` attribute namespace defined here.
 */

// W-558: the one fail-closed read every lock input goes through (inlined here, not a sibling module: plain-node
// importers such as core/completion.ts load this file with type stripping, which cannot resolve `./x.js` to `x.ts`).
// A read is `absent` only when the reader reports file-not-found (`ENOENT`); every other read failure, and every value
// the shape function rejects (it throws), is an `error`. Pure: the caller supplies the reader and the shape.
/** What a lock input reads as: absent (file-not-found only), valid, or an error naming the input and why. */
export type InputRead<T> = { kind: "absent" } | { kind: "valid"; value: T } | { kind: "error"; why: string };

/** One read: the bytes, or the reader's error and its errno code (`ENOENT` alone is absence). */
export type RawRead<B> = { bytes: B } | { error: string; code?: string };

/** W-558: read `label` through `read`, judge it with `shape` (which throws on a value outside the input's domain). */
export function readInput<B, T>(label: string, read: () => RawRead<B>, shape: (bytes: B) => T): InputRead<T> {
  let raw: RawRead<B>;
  try {
    raw = read();
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "error", why: `${label} cannot be read (${typeof code === "string" ? code : firstLine(e)})` };
  }
  if ("error" in raw) return raw.code === "ENOENT" ? { kind: "absent" } : { kind: "error", why: `${label} cannot be read (${raw.code ?? firstLine(raw.error)})` };
  try {
    return { kind: "valid", value: shape(raw.bytes) };
  } catch (e) {
    return { kind: "error", why: `${label} ${firstLine(e)}` };
  }
}

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";

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

/**
 * Work kinds accepted by the native officina.  This is deliberately
 * narrower than {@link Opus.kind}: adapters for external systems retain
 * their own vocabularies and narrow only at their native boundary.
 */
export const NATIVE_OPUS_KINDS = [
  "opus",
  "task",
  "subtask",
  "bug",
  "research",
  "feature",
  "hygiene",
  "art-batch",
  "ui",
  "arc",
] as const;
export type NativeOpusKind = (typeof NATIVE_OPUS_KINDS)[number];

/** Native-only front-matter fields added by W-096. */
export interface NativeOpusFields {
  kind: NativeOpusKind;
  arc?: string;
  parent?: string;
  start?: string;
  end?: string;
  ui_rulings?: string[];
  baseline_commit?: string;
  builder_runtime?: "isolated";
}

/** Structured references carried by UI verdict evidence. */
export interface UiEvidenceReferences {
  design_digest: `sha256:${string}`;
  dispatch_prompt?: string;
  ui_input?: string;
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
  /** Record opening instant when the native source supplies a valid string. */
  openedAt?: string;
  /** Inbox row label. Authoritative from the `subject:` front-matter key
   *  when present and valid (a non-blank string); otherwise a legacy
   *  derivation from `body`'s first paragraph (W-076: adapters/native's
   *  `deriveSubject`) — always present, never the raw markdown blob. */
  subject: string;
  /** The question, verbatim — `readFront`'s body, byte for byte. No
   *  truncation: a subject is a row label, the detail pane owns the rest. */
  body: string;
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
  | "workflow.item_amended"
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

// ---------------------------------------------------------------------------
// Record dates — the one strict parser (W-120, moved here by W-163 so core,
// server and commands can use it; none of them can import cli).
// ---------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A YAML date or a strict ISO date(-time) string as an instant; anything else,
 *  including an impossible date such as 2026-02-30, is undefined. No zone means UTC. */
export function instant(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  const m = typeof v === "string" ? ISO.exec(v) : null;
  if (!m) return undefined;
  const [y, mo, d, h, mi, sec] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number) as [number, number, number, number, number, number];
  const ms = Number((m[7] ?? "0").padEnd(3, "0").slice(0, 3));
  // Date.UTC maps years 0-99 to 1900-1999, so the date fields go in through setUTCFullYear, which does not
  const t = new Date(Date.UTC(2000, 0, 1, h, mi, sec, ms));
  t.setUTCFullYear(y, mo - 1, d);
  // round trip: the parsed fields must reproduce what was written (no JS normalisation)
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || t.getUTCHours() !== h || t.getUTCMinutes() !== mi || t.getUTCSeconds() !== sec) return undefined;
  const z = m[8];
  if (z && z !== "Z") {
    const [oh, om] = [Number(z.slice(1, 3)), Number(z.slice(-2))];
    if (oh > 23 || om > 59) return undefined;
    t.setTime(t.getTime() - (z[0] === "-" ? -1 : 1) * (oh * 60 + om) * 60000);
  }
  return t;
}

// ---------------------------------------------------------------------------
// W-702 (D-250): a waiting pull request's review snapshot. The credentialed `review-request` writes one file per PR,
// `<git common dir>/bisellium/review-requests/<number>.json`, by atomic replacement; the uncredentialed console server
// only reads them and projects GET /api/inbox's optional `reviewRequests` member. One shape, judged on both sides: a
// file is written only when `reviewRequestShape` holds it, and read only when it still does.
// ---------------------------------------------------------------------------

/** One item of `/api/inbox`'s optional `reviewRequests` member, word for word as W-667's brief pins it. */
export interface ReviewRequest {
  number: number;
  title: string;
  url: string;
  reason: string;
  protectedPaths: string[];
  checks: Array<{ name: string; status: "pending" | "passed" | "failed" }>;
  openedAt: string;
  observedAt: string;
  head: string;
  approvalHead?: string;
  forge: "github";
  state: "pending" | "stale" | "failed" | "approved";
}

/** The schema tag every snapshot file carries; a file of any other tag is stale at its source and is not read. */
export const REVIEW_REQUEST_SCHEMA = "bisellium.review-request/1";
/** The snapshot directory's levels below the Git common directory. */
export const REVIEW_REQUEST_LEVELS = ["bisellium", "review-requests"] as const;
/** A snapshot file's name: the PR number (as `review-request` takes it) and `.json`. */
export const REVIEW_REQUEST_FILE = /^([1-9][0-9]{0,8})\.json$/;
/** The largest snapshot file written or read, in bytes. */
export const REVIEW_REQUEST_MAX_BYTES = 65_536;
/** The most snapshot files one read takes; more is no projection. */
export const REVIEW_REQUEST_MAX_FILES = 256;

const RR_KEYS = ["number", "title", "url", "reason", "protectedPaths", "checks", "openedAt", "observedAt", "head", "approvalHead", "forge", "state"] as const;
const RR_OID = /^[0-9a-f]{40}$/;
const RR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RR_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/pull\/([1-9][0-9]{0,8})$/;
const RR_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const RR_CHECK_STATUS = new Set(["pending", "passed", "failed"]);

/** W-702: the headline state of a review snapshot: `approved` when the code owners' approval is on the head, else `stale`
 *  when one is on an earlier head, else `failed` when a required check failed, else `pending`. */
export function reviewRequestState(head: string, approvalHead: string | undefined, checks: readonly { status: string }[]): ReviewRequest["state"] {
  if (approvalHead === head) return "approved";
  if (approvalHead !== undefined) return "stale";
  return checks.some((c) => c.status === "failed") ? "failed" : "pending";
}

/** W-702: a snapshot file's parsed JSON as a `ReviewRequest`, its keys in the member's order and the schema tag dropped;
 *  throws naming the first fault: another schema tag, an absent, extra or wrong-typed key, a text with a control
 *  character, an empty or over-long text, a URL that is not this PR's github.com review page, an instant out of grammar,
 *  an object id that is not 40 lowercase hex, or a state its own facts do not give. Pure. */
export function reviewRequestShape(value: unknown): ReviewRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not an object");
  const v = value as Record<string, unknown>;
  if (v["schema"] !== REVIEW_REQUEST_SCHEMA) throw new Error(`schema is not ${REVIEW_REQUEST_SCHEMA}`);
  const extra = Object.keys(v).filter((k) => k !== "schema" && !(RR_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) throw new Error(`unknown key ${extra[0]}`);
  const text = (key: string, max: number, s: unknown = v[key]): string => {
    if (typeof s !== "string" || s.trim() === "" || s.length > max || RR_CONTROL.test(s)) throw new Error(`${key} is not a text of 1 to ${max} characters without control characters`);
    return s;
  };
  const num = v["number"];
  if (typeof num !== "number" || !Number.isInteger(num) || num < 1 || num > 999_999_999) throw new Error("number is not a PR number");
  const url = text("url", 300);
  if (RR_URL.exec(url)?.[1] !== String(num)) throw new Error("url is not this PR's github.com review page");
  const paths = v["protectedPaths"];
  if (!Array.isArray(paths) || paths.length === 0) throw new Error("protectedPaths is not a non-empty array");
  const protectedPaths = paths.map((p) => text("protectedPaths", 4096, p));
  if (new Set(protectedPaths).size !== protectedPaths.length) throw new Error("protectedPaths repeats a path");
  const rawChecks = v["checks"];
  if (!Array.isArray(rawChecks) || rawChecks.length > 100) throw new Error("checks is not an array of at most 100");
  const checks = rawChecks.map((c: unknown) => {
    if (typeof c !== "object" || c === null || Array.isArray(c) || Object.keys(c).length !== 2) throw new Error("a check is not { name, status }");
    const status = (c as Record<string, unknown>)["status"];
    if (typeof status !== "string" || !RR_CHECK_STATUS.has(status)) throw new Error("a check's status is not pending, passed or failed");
    return { name: text("checks", 1024, (c as Record<string, unknown>)["name"]), status: status as "pending" | "passed" | "failed" };
  });
  const when = (key: string): string => {
    const s = v[key];
    if (typeof s !== "string" || !RR_INSTANT.test(s) || instant(s) === undefined) throw new Error(`${key} is not an ISO instant in UTC`);
    return s;
  };
  const oid = (key: string): string => {
    const s = v[key];
    if (typeof s !== "string" || !RR_OID.test(s)) throw new Error(`${key} is not a 40-hex object id`);
    return s;
  };
  const head = oid("head");
  const approvalHead = v["approvalHead"] === undefined ? undefined : oid("approvalHead");
  if (v["forge"] !== "github") throw new Error("forge is not github");
  const state = reviewRequestState(head, approvalHead, checks);
  if (v["state"] !== state) throw new Error(`state is not ${state}, the state its own facts give`);
  return {
    number: num,
    title: text("title", 1024),
    url,
    reason: text("reason", 1024),
    protectedPaths,
    checks,
    openedAt: when("openedAt"),
    observedAt: when("observedAt"),
    head,
    ...(approvalHead === undefined ? {} : { approvalHead }),
    forge: "github",
    state,
  };
}

/** W-702: the text of a snapshot file: the schema tag, then the request's keys, one JSON line. */
export function reviewRequestFile(r: ReviewRequest): string {
  return `${JSON.stringify({ schema: REVIEW_REQUEST_SCHEMA, ...r })}\n`;
}
