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

export interface AnswerResponse {
  ok: boolean;
  exitCode: number;
  output: string;
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

// `import.meta.env` only exists under Vite; the `?.` keeps this module
// loadable under plain node (apps/web/test/*.test.ts run via tsx, not vite).
const TOKEN: string = import.meta.env?.VITE_BISELLIUM_TOKEN ?? "";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) return Promise.reject(res.status);
  return (await res.json()) as T;
}

// ── W-024 fetchers ───────────────────────────────────────────────────

/** GET /api/inbox. Non-200 rejects with the numeric status. */
export function fetchInbox(): Promise<InboxResponse> {
  return getJSON("/api/inbox");
}

/** POST /api/answer. */
export async function submitAnswer(
  petitio: string,
  reply: string,
  opts?: { askBack?: boolean; charterGap?: boolean },
): Promise<AnswerResponse> {
  const body: Record<string, unknown> = { petitio, reply };
  if (opts?.askBack) body["askBack"] = true;
  if (opts?.charterGap) body["charterGap"] = true;
  const res = await fetch("/api/answer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bisellium-Token": TOKEN,
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as AnswerResponse;
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
