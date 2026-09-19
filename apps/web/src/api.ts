/**
 * apps/web/src/api.ts — co-owned with W-024, append-only (per both briefs:
 * neither builder removes the other's exports).
 *
 * W-024 owns `fetchInbox` and `submitAnswer` — not present in this
 * worktree yet (W-024's build hasn't landed here; cascade 7 runs the two
 * opera in separate worktrees per D-012). This file appends only W-025's
 * five fetch functions, exactly as declared in briefs/W-025.md, so the
 * merge with W-024's copy is a pure union of exports.
 */
import type { ActaEntry } from "./lib/fasti.js";
import type { AerariumEntry } from "./lib/posture.js";

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

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) return Promise.reject(res.status);
  return (await res.json()) as T;
}

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
