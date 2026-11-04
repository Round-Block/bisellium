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
  petitiones: { id: string; opus?: string; from: string; opened?: number; subject: string; body: string }[];
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
  // W-501: reads need the token too, so one pasted this page is held in memory as well, never persisted: a browser that
  // denies sessionStorage still reads with it.
  if (pastedToken !== "") return pastedToken;
  try {
    return typeof sessionStorage === "undefined" ? "" : (sessionStorage.getItem(TOKEN_KEY) ?? "");
  } catch {
    return "";
  }
}

let pastedToken = "";

export function hasToken(): boolean {
  return getToken() !== "";
}

export function setToken(token: string): void {
  pastedToken = token;
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
  /** W-129: how well serve read the opus-branch records (absent from an older server). */
  branchRecords?: BranchRecordsStatus;
}

/** `GET /api/officina`'s `branchRecords` (apps/server/src/branchRecords.ts). Reason codes are fixed words, never text. */
export interface BranchRecordsStatus {
  status: "ok" | "partial" | "stale" | "unavailable" | "off";
  failures?: number;
  reason?: string;
  capped?: number;
  liveRejected?: number;
  dropped: { id: string; reason: string }[];
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
  /** Complete record body from the officina source. */
  body: string;
  kind: string;
  collegium: string;
  sella: string;
  state: string;
  /** Existing opus record instants. The Board validates them at runtime;
   * malformed source values remain unknown rather than being coerced. */
  start?: unknown;
  end?: unknown;
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

/** W-501: the screens owe a re-read once a token is saved when they never got their data (no token held, or a read
 *  refused before any read succeeded in the current routed-screen mount) or the live stream was refused. A read refused
 *  after that mount loaded leaves it, and a drafted answer, in place. Taken once by `rereadAfterTokenSaved`. */
let rereadOwed = false;
/** W-501: whether a read has succeeded in the current routed-screen mount; reset by `beginReadMount`. */
let mountLoaded = false;

/** W-501: the shell calls this when it mounts its routed screen (a route or a read epoch), before the screen's reads: the
 *  new mount has no successful read yet, so a stale token refused there owes the re-read even after an earlier screen
 *  loaded. */
export function beginReadMount(): void {
  mountLoaded = false;
}

function refuseRead(owed: boolean): void {
  if (owed) rereadOwed = true;
  unauthorizedListener?.();
}

/** Every read sends the session token (W-501: the server refuses a GET under /api/ without it). With none held, the read
 *  is refused here, with no request; a refusal raises the one token prompt, as a write's does, and rejects with 401. */
async function getJSON<T>(path: string): Promise<T> {
  const token = getToken();
  if (token === "") {
    refuseRead(true);
    return Promise.reject(401);
  }
  const res = await fetch(path, { headers: { "X-Bisellium-Token": token } });
  if (res.status === 401) refuseRead(!mountLoaded);
  if (!res.ok) return Promise.reject(res.status);
  mountLoaded = true;
  return (await res.json()) as T;
}

/** W-501: the token prompt's save asks this whether the screens must re-mount and read again (see `rereadOwed`); true at
 *  most once per refusal, and false after only a refused write or a read refused once they had loaded. */
export function rereadAfterTokenSaved(): boolean {
  if (!rereadOwed) return false;
  rereadOwed = false;
  return true;
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

/** GET /api/inbox. Non-200 rejects with the numeric status.
 *  Every call issues a fresh GET, so a refresh after a write, an answer or a
 *  live frame never reuses a stale response. The request is remembered as the
 *  mount read: only the shell's mount reads (`{ shared: true }`) join it while
 *  it is in flight and for a bounded 50ms after it settles. */
let inboxInFlight: { promise: Promise<InboxResponse>; settledAt?: number } | undefined;
const INBOX_SHARE_WINDOW_MS = 50;

export function fetchInbox(opts?: { shared?: boolean }): Promise<InboxResponse> {
  if (opts?.shared === true && inboxInFlight !== undefined) {
    const { settledAt } = inboxInFlight;
    if (settledAt === undefined || Date.now() - settledAt <= INBOX_SHARE_WINDOW_MS) return inboxInFlight.promise;
  }
  const promise = getJSON<InboxResponse>("/api/inbox");
  const entry: { promise: Promise<InboxResponse>; settledAt?: number } = { promise };
  inboxInFlight = entry;
  const settle = (): void => {
    entry.settledAt = Date.now();
  };
  void promise.then(settle, settle);
  return promise;
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

/** The Officina's one manual brake uses the same authenticated write path as every other console write. */
export function submitPause(): Promise<WriteResult> {
  return postWrite("/api/pause", {});
}

export function submitResume(): Promise<WriteResult> {
  return postWrite("/api/resume", {});
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
  // W-501: EventSource sends no header, so the session token rides in the query (the server takes it there on /api/live
  // only); with none held, no stream opens and the read counts as refused.
  const token = getToken();
  if (token === "") {
    refuseRead(true);
    return () => undefined;
  }
  const source = new EventSource(`/api/live?token=${encodeURIComponent(token)}`);
  // W-501: a stream the server closed (a refusal, not a reconnect) gives no status, so one read tells a refused token
  // apart: its 401 raises the prompt and owes the re-read that opens a new stream. 2 is EventSource.CLOSED, as a number
  // so a test double needs no static.
  source.addEventListener("error", () => {
    if (source.readyState === 2)
      void fetchOfficina().then(
        () => undefined,
        (status: unknown) => {
          if (status === 401) rereadOwed = true;
        },
      );
  });
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

// ── W-153 fetchers ───────────────────────────────────────────────────

export interface CompletionRow {
  id: string;
  title: string;
  weight: number;
  done: number;
  planned: number;
  met: boolean;
  pct: number;
}

/** GET /api/completion: both fields are null when the studio has no milestone records. */
export interface CompletionResponse {
  meter: { rows: CompletionRow[]; overall: number } | null;
  estimate: { kind: "estimate" | "none"; line: string } | null;
}

export function fetchCompletion(): Promise<CompletionResponse> {
  return getJSON("/api/completion");
}
