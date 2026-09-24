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

export interface OfficinaResponse {
  studio: string;
  patron: string;
  collegia: { id: string; name: string; magister: string; fallback?: string; autonomy: string }[];
  sellae: { id: string; name: string; collegium: string }[];
  probationes: { id: string; kind: string }[];
  wip_limit?: number;
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
  probationes: Record<string, { status: string; evidence?: string }>;
  traditio: unknown;
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
