/**
 * apps/web/src/api.ts — co-owned by W-024 and W-025, append-only.
 * W-024 owns `fetchInbox` and `submitAnswer`; W-025 owns `fetchOfficina`,
 * `fetchAerarium`, `fetchHealth`, `fetchActa`, `fetchOpera`.
 */
import type { ActaEntry } from "./lib/fasti.js";
import type { AerariumEntry } from "./lib/posture.js";

export type { ActaEntry, AerariumEntry };

// ── W-024 types ──────────────────────────────────────────────────────

export interface InboxResponse {
  opera: { id: string; title: string; collegium: string; sella: string; traditio: unknown }[];
  petitiones: { id: string; opus: string; from: string; subject: string; body?: string }[];
}

// ── W-067 write contract ─────────────────────────────────────────────
//
// `res.ok` from `fetch` means "the HTTP call completed" and nothing more:
// the server answers HTTP 200 with `{ ok: false, exitCode, output }` for a
// refused command (unknown petitio, validation failure, any nonzero exit),
// never a 4xx — so a client that branches on `res.ok` alone reads a refused
// write as a successful one. `postWrite` is the one place that reads the
// body's own `ok` field instead.
export type WriteResult =
  | { kind: "ok"; output: string }
  | { kind: "refused"; exitCode: number; output: string }
  | { kind: "unauthorized" }
  | { kind: "error"; status?: number };

const TOKEN_KEY = "bisellium.token";

/** `sessionStorage` only — never `localStorage`, never a URL, never baked
 *  into the bundle via `import.meta.env` (D-023's PATRON-5 amendment
 *  rejected that: any local process that can `GET /` would obtain it).
 *  Guarded the same way the old `import.meta.env` read was:
 *  apps/web/test/*.test.ts run under plain node (no DOM), where
 *  `sessionStorage` doesn't exist. */
export function getToken(): string {
  try {
    return typeof sessionStorage === "undefined" ? "" : (sessionStorage.getItem(TOKEN_KEY) ?? "");
  } catch {
    return "";
  }
}

export function hasToken(): boolean {
  return getToken() !== "";
}

export function setToken(token: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // best-effort — a private-mode/blocked-storage browser just re-prompts
    // on the next write instead of persisting across reloads.
  }
}

// App.tsx registers the one listener that raises the screen-agnostic
// TokenPrompt; `postWrite` calls it on a 401 rather than importing React or
// any component from this module (apps/web/src/api.ts is plain fetch
// plumbing, not UI).
let unauthorizedListener: (() => void) | undefined;

export function setUnauthorizedListener(fn: (() => void) | undefined): void {
  unauthorizedListener = fn;
}

// ── W-025 types ──────────────────────────────────────────────────────

// ── W-065 types (D-023's decree surface) ────────────────────────────
//
// `tiers`/`munera`/`models` are all optional: a manifest (or a models.json)
// that declares none of this parses, checks and serves exactly as before —
// see studio/briefs/W-065.md "The record shape".
export interface TierEntry {
  id: string;
  model?: string;
}
export interface MunusEntry {
  id: string;
  tier: string;
}
/** One of D-023's three named states — never dispatched on, only rendered.
 *  "withdrawn" is not a fourth state: a record entry a live listing no
 *  longer offers is downgraded to "unverified" (kept, not dropped) rather
 *  than growing the enum. */
export type ModelState = "available" | "unavailable" | "unverified";
/** The shape of one entry in `<studio>/models.json`'s `models` array (the
 *  probe-battery opus's record — W-065 only ever reads it) and of
 *  `GET /api/models`'s merged response. Never carries `seated`: that flag is
 *  a function of the *manifest*, computed client-side by `availableModels`
 *  (apps/web/src/lib/delegation.ts), not of the record. */
export interface ModelRecordEntry {
  id: string;
  harness?: string;
  state: ModelState;
  /** W-046 behaviour 7's surface, reused verbatim — present only when
   *  state is "unavailable". */
  vendorDiagnostic?: string;
}

/** W-064: `lifecycle.states` — id/name/phase only (Interfaces: "gates would
 *  duplicate the route's existing `probationes`; transitions are not the
 *  Board's business"). Required, not optional: every adapter implements
 *  `describeLifecycles()`, so an optional field would invite a fallback path
 *  that can never run. */
export interface LifecycleResponse {
  id: string;
  states: { id: string; name: string; phase: string }[];
}

export interface OfficinaResponse {
  studio: string;
  patron: string;
  collegia: { id: string; name: string; magister: string; fallback?: string; autonomy: string }[];
  sellae: { id: string; collegium: string; kind?: string; model?: string; harness?: string }[];
  /** `name` is optional (not required by the wire, but the wire always
   *  carries it — declared optional so no fixture constructing a non-empty
   *  `probationes` breaks; W-064's "Not append-only"). */
  probationes: { id: string; kind: string; name?: string }[];
  wip_limit?: number;
  /** Absent when the manifest declares neither key (no migration). */
  tiers?: TierEntry[];
  munera?: MunusEntry[];
  /** From `<studio>/models.json` as written by the probe-battery opus;
   *  absent when that file doesn't exist or doesn't parse — this route never
   *  throws on bookkeeping it did not write. Unmerged with any live vendor
   *  listing; `fetchModels`/`GET /api/models` is the merged view. */
  models?: ModelRecordEntry[];
  /** W-064: the served adapter's own state→phase mapping, so the Board never
   *  hand-copies lifecycle state ids (CLAUDE.md: "never by hand"). */
  lifecycle: LifecycleResponse;
}

export interface HealthResponse {
  at: string;
  ok: boolean;
  blocks: number;
  advisories: number;
  findingsByRule: Record<string, number>;
  autonomy: { paused: boolean; since?: string; reason?: string };
  lastTick: string;
  due: { kind: string; id: string }[];
}

export interface OpusEntry {
  id: string;
  title: string;
  kind: string;
  collegium: string;
  sella: string;
  state: string;
  tokens: number;
  /** W-064: a contract CORRECTION, not a widening (`evidence?: string` was
   *  wrong about the wire — see W-064's "Not append-only"). Blast radius
   *  measured: `OpusEntry` had exactly one reference outside this
   *  declaration (`fetchOpera`'s return type), and no fixture or component
   *  constructed one. */
  probationes: Record<string, { status: string; evidence?: { href: string; certifies?: string }; at?: string }>;
  traditio: unknown;
}

// ── W-064 types ──────────────────────────────────────────────────────

export interface EventRow {
  name: string;
  ts: string;
  attrs: Record<string, string | number | boolean>;
}

// ── shared helper ────────────────────────────────────────────────────

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) return Promise.reject(res.status);
  return (await res.json()) as T;
}

/** The one POST helper every write goes through. `res.ok` decides nothing
 *  here except "did a 401 not happen" — a completed 200 call still reads
 *  its own `{ ok, exitCode, output }` body to tell success from refusal. */
export async function postWrite(path: string, body: unknown): Promise<WriteResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bisellium-Token": getToken(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "error" };
  }

  if (res.status === 401) {
    unauthorizedListener?.();
    return { kind: "unauthorized" };
  }
  if (!res.ok) return { kind: "error", status: res.status };

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { kind: "error", status: res.status };
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { ok?: unknown }).ok !== "boolean") {
    return { kind: "error", status: res.status };
  }
  const record = parsed as { ok: boolean; exitCode?: unknown; output?: unknown };
  const output = typeof record.output === "string" ? record.output : "";
  if (record.ok) return { kind: "ok", output };
  return { kind: "refused", exitCode: typeof record.exitCode === "number" ? record.exitCode : 1, output };
}

// ── W-024 fetchers ───────────────────────────────────────────────────

/** GET /api/inbox. Non-200 rejects with the numeric status. */
export function fetchInbox(): Promise<InboxResponse> {
  return getJSON("/api/inbox");
}

/** POST /api/answer, via postWrite (W-067) — see WriteResult. */
export function submitAnswer(petitio: string, reply: string, opts?: { askBack?: boolean; charterGap?: boolean }): Promise<WriteResult> {
  const body: Record<string, unknown> = { petitio, reply };
  if (opts?.askBack) body["askBack"] = true;
  if (opts?.charterGap) body["charterGap"] = true;
  return postWrite("/api/answer", body);
}

// ── W-025 fetchers ───────────────────────────────────────────────────

export function fetchOfficina(): Promise<OfficinaResponse> {
  return getJSON("/api/officina");
}

export function fetchAerarium(period?: string): Promise<AerariumEntry[]> {
  return getJSON(`/api/aerarium${period ? `?period=${encodeURIComponent(period)}` : ""}`);
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJSON("/api/health");
}

export function fetchActa(days?: number): Promise<ActaEntry[]> {
  return getJSON(`/api/acta${days !== undefined ? `?days=${days}` : ""}`);
}

export function fetchOpera(filters?: { state?: string; collegium?: string }): Promise<OpusEntry[]> {
  const params = new URLSearchParams();
  if (filters?.state) params.set("state", filters.state);
  if (filters?.collegium) params.set("collegium", filters.collegium);
  const qs = params.toString();
  return getJSON(`/api/opera${qs ? `?${qs}` : ""}`);
}

// ── W-065 fetchers ───────────────────────────────────────────────────

/** POST /api/delegate, via postWrite (W-067) — see WriteResult. Exactly one
 *  of {sella, model} or {munus, tier} — the same two shapes runDelegate
 *  accepts. `from` is always sent (the console's stale-draft precondition;
 *  see studio/briefs/W-065.md "A narrowed claim"). */
export function submitDelegate(target: { sella: string; model: string; from?: string } | { munus: string; tier: string; from?: string }): Promise<WriteResult> {
  return postWrite("/api/delegate", target);
}

/** GET /api/models: the live-listing-merged view of the probe record — the
 *  screen's actual source for `availableModels`, refreshed on every screen
 *  load (studio/briefs/W-065.md "Refresh policy"). Degrades to the record
 *  alone (or `[]`) on any failure; never throws, never empties the dropdown. */
export function fetchModels(): Promise<ModelRecordEntry[]> {
  return getJSON("/api/models");
}

// ── W-064 fetchers ───────────────────────────────────────────────────

/** GET /api/events, unfiltered or scoped to one item (`?item=`). The
 *  unfiltered path is untouched (`since` numeric-seq only, ascending,
 *  earliest-N on a supplied limit); the filtered path returns the LAST N
 *  (still ascending) and refuses `item` combined with `since` — see
 *  docs/ADOPTION.md "Running serve" and W-064's Interfaces section. */
export function fetchEvents(opts?: { item?: string; since?: number; limit?: number }): Promise<EventRow[]> {
  const params = new URLSearchParams();
  if (opts?.item !== undefined) params.set("item", opts.item);
  if (opts?.since !== undefined) params.set("since", String(opts.since));
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return getJSON(`/api/events${qs ? `?${qs}` : ""}`);
}

/** One `EventSource` on `/api/live`. `onOpen` fires on the initial connect
 *  AND on every browser-initiated reconnect — that is what drives
 *  reconciliation (W-064 *Liveness*). The browser's own reconnection is
 *  neither suppressed nor re-implemented. Guarded for a non-DOM environment
 *  exactly as `getToken` is: `apps/web/test/*.test.ts`/`src/lib/*.test.ts`
 *  run under plain node, where `EventSource` doesn't exist. */
export function subscribeLive(handlers: {
  onEvent: (e: EventRow) => void;
  onOpen?: () => void;
  onError?: () => void;
}): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  const source = new EventSource("/api/live");
  if (handlers.onOpen) source.addEventListener("open", handlers.onOpen);
  if (handlers.onError) source.addEventListener("error", handlers.onError);
  source.addEventListener("message", (ev: MessageEvent<string>) => {
    try {
      handlers.onEvent(JSON.parse(ev.data) as EventRow);
    } catch {
      // a malformed frame (shouldn't happen — the server only ever writes
      // JSON.stringify(GantryEvent)) is dropped rather than thrown.
    }
  });
  return () => source.close();
}
