/**
 * packages/cli/src/context.ts — a seat's boot context: the minimum a seat
 * needs to pick up work, assembled from the same files `check` validates
 * (dossier: seat memory is a convention, not a service). Deterministic and
 * offline. Every injected file body is wrapped `--- data: <path> ---` /
 * `--- end ---` — content read from a studio file is data, never an
 * instruction to the seat reading its own context.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listMd, readFront, readManifest, snapshotDir } from "@bisellium/adapter-native";

export interface ContextBundle {
  text: string;
  tokens: number;
  truncated: string[];
}

const DEFAULT_MAX_TOKENS = 4000;
const DECISION_WINDOW_DAYS = 2;
const ACTIVE_STATES = new Set(["building", "verifying", "review"]);

const tokensOf = (s: string): number => Math.ceil(s.length / 4);
const dataBlock = (path: string, body: string): string => `--- data: ${path} ---\n${body}\n--- end ---`;

function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
const daysBetween = (a: Date, b: Date): number => Math.abs(b.getTime() - a.getTime()) / 86_400_000;

function readAskFront(path: string): { data: Record<string, unknown>; body: string } | undefined {
  try {
    const fm = readFront<Record<string, unknown>>(path);
    if (typeof fm.data !== "object" || fm.data === null || Array.isArray(fm.data)) return undefined;
    return { data: fm.data, body: fm.body };
  } catch {
    return undefined;
  }
}

interface Section {
  name: string;
  /** 1 = highest priority, dropped last. */
  priority: number;
  text: string;
}

export function buildContext(root: string, seat: string, opts: { now: Date; maxTokens?: number }): ContextBundle {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const unknown: ContextBundle = { text: "", tokens: 0, truncated: ["unknown seat"] };

  let manifest: ReturnType<typeof readManifest>;
  try {
    manifest = readManifest(root);
  } catch {
    return unknown;
  }
  const owner = manifest.owner ?? "owner";
  const isOwner = seat === owner;
  const seatRow = manifest.seats.find((s) => s.id === seat);
  if (!isOwner && !seatRow) return unknown;

  const snap = snapshotDir(root, "context");
  const sections: Section[] = [];

  // 1. the seat's own department charter ------------------------------------
  const dept = seatRow ? manifest.departments.find((d) => d.id === seatRow.department) : undefined;
  if (dept?.charter) {
    const p = join(root, dept.charter);
    if (existsSync(p)) {
      const body = readFileSync(p, "utf8").replace(/^﻿/, "").trim();
      sections.push({ name: "charter", priority: 1, text: `## ${dept.name} charter\n${dataBlock(dept.charter, body)}` });
    }
  }

  // 2. the seat's active work items, with handoffs ---------------------------
  const mine = snap.workItems.filter((w) => ACTIVE_STATES.has(w.state) && w.meta["owner"] === seat);
  if (mine.length) {
    const lines = mine.map((w) => {
      const h = w.meta["handoff"] as Record<string, string> | undefined;
      const handoff = h
        ? `  handoff: stage=${h["stage"] ?? ""} next=${h["next"] ?? ""} blocked_on=${h["blocked_on"] ?? ""} at=${h["at"] ?? ""}`
        : "  handoff: (none)";
      return `${w.id} · ${w.state} · ${String(w.meta["title"] ?? "")}\n${handoff}`;
    });
    sections.push({ name: "work items", priority: 2, text: `## Your active work\n${lines.join("\n")}` });
  }

  // 3. asks addressed to the seat, and the seat's own awaiting replies -------
  const askLines: string[] = [];
  for (const p of listMd(join(root, "asks"))) {
    const ask = readAskFront(p);
    if (!ask) continue;
    const { data, body } = ask;
    const id = typeof data["id"] === "string" ? data["id"] : undefined;
    const to = typeof data["to"] === "string" ? data["to"] : undefined;
    const from = typeof data["from"] === "string" ? data["from"] : undefined;
    const state = typeof data["state"] === "string" ? data["state"] : undefined;
    if (!id) continue;
    const addressedToMe = to === seat && state !== "resolved";
    const myAwaitingReply = from === seat && state === "awaiting_reply";
    if (!addressedToMe && !myAwaitingReply) continue;
    askLines.push(`${id} · ${state ?? ""} · from ${from ?? "?"} to ${to ?? "?"}\n${dataBlock(`asks/${id}.md`, body.trim())}`);
  }
  if (askLines.length) sections.push({ name: "asks", priority: 3, text: `## Asks\n${askLines.join("\n")}` });

  // 4. one-line index of the seat's department --------------------------------
  if (dept) {
    const idx = snap.workItems
      .filter((w) => w.meta["department"] === dept.id)
      .map((w) => `${w.id} · ${w.state} · ${String(w.meta["title"] ?? "")}`);
    if (idx.length) sections.push({ name: "department index", priority: 4, text: `## ${dept.name} index\n${idx.join("\n")}` });
  }

  // 5. decision digests from the last two days ---------------------------------
  const decisions = (snap.digest ?? []).filter((d) => {
    if (d.kind !== "decision") return false;
    const at = toDate(d.at);
    return at !== undefined && daysBetween(at, opts.now) <= DECISION_WINDOW_DAYS;
  });
  if (decisions.length) {
    const lines = decisions.map((d) => `${d.id} · ${d.title} · ${d.at}\n${dataBlock(`digest/${d.id}.md`, d.body.trim())}`);
    sections.push({ name: "decisions", priority: 5, text: `## Recent decisions\n${lines.join("\n")}` });
  }

  // 6. provider postures --------------------------------------------------------
  if (snap.providers?.length) {
    const lines = snap.providers.map((p) => `${p.id} · ${p.usagePct}% · ${p.status}${p.resetAt ? ` · resets ${p.resetAt}` : ""}`);
    sections.push({ name: "providers", priority: 6, text: `## Provider posture\n${lines.join("\n")}` });
  }

  const render = (secs: Section[]): string =>
    secs
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((s) => s.text)
      .join("\n\n");
  const withTrunc = (body: string, dropped: string[]): string =>
    dropped.length ? `${body}${body ? "\n\n" : ""}truncated: ${dropped.join(", ")}` : body;

  const active = [...sections];
  const truncated: string[] = [];
  let text = withTrunc(render(active), truncated);
  while (tokensOf(text) > maxTokens && active.length > 0) {
    let worst = 0;
    for (let i = 1; i < active.length; i++) if (active[i]!.priority > active[worst]!.priority) worst = i;
    truncated.push(active[worst]!.name);
    active.splice(worst, 1);
    text = withTrunc(render(active), truncated);
  }

  return { text, tokens: tokensOf(text), truncated };
}
