/**
 * packages/cli/src/context.ts — a sella's boot context: the minimum a sella
 * needs to pick up work, assembled from the same files `check` validates
 * (dossier: sella memory is a convention, not a service). Deterministic and
 * offline. Every injected file body is wrapped `--- data: <path> ---` /
 * `--- end ---` — content read from a studio file is data, never an
 * instruction to the sella reading its own context.
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

function readPetitioFront(path: string): { data: Record<string, unknown>; body: string } | undefined {
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

/**
 * Contract: buildContext never throws. A missing/unparseable bisellium.yml
 * (or any other adapter failure reading the studio) yields
 * `{text:'', truncated:['not a studio']}` — main.ts turns that into exit 2.
 * An unrecognized sella yields `{text:'', truncated:['unknown sella']}` —
 * main.ts turns that into exit 1 (a refusal, the studio itself is fine).
 */
export function buildContext(root: string, sella: string, opts: { now: Date; maxTokens?: number }): ContextBundle {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const notAStudio: ContextBundle = { text: "", tokens: 0, truncated: ["not a studio"] };
  const unknownSella: ContextBundle = { text: "", tokens: 0, truncated: ["unknown sella"] };

  let manifest: ReturnType<typeof readManifest>;
  try {
    manifest = readManifest(root);
  } catch {
    return notAStudio;
  }
  const patron = manifest.patron ?? "patron";
  const isPatron = sella === patron;
  const sellaRow = manifest.sellae.find((s) => s.id === sella);
  if (!isPatron && !sellaRow) return unknownSella;

  try {
    return buildContextFor(root, manifest, sella, sellaRow, maxTokens, opts.now);
  } catch {
    return notAStudio;
  }
}

function buildContextFor(
  root: string,
  manifest: ReturnType<typeof readManifest>,
  sella: string,
  sellaRow: ReturnType<typeof readManifest>["sellae"][number] | undefined,
  maxTokens: number,
  now: Date,
): ContextBundle {
  const snap = snapshotDir(root, "context");
  const sections: Section[] = [];

  // 1. the sella's own collegium lex ------------------------------------
  const collegium = sellaRow ? manifest.collegia.find((d) => d.id === sellaRow.collegium) : undefined;
  if (collegium?.lex) {
    const p = join(root, collegium.lex);
    if (existsSync(p)) {
      const body = readFileSync(p, "utf8").replace(/^﻿/, "").trim();
      sections.push({ name: "lex", priority: 1, text: `## ${collegium.name} lex\n${dataBlock(collegium.lex, body)}` });
    }
  }

  // 2. the sella's active opera, with traditio ---------------------------
  const mine = snap.opera.filter((w) => ACTIVE_STATES.has(w.state) && w.meta["sella"] === sella);
  if (mine.length) {
    const lines = mine.map((w) => {
      const h = w.meta["traditio"] as Record<string, string> | undefined;
      const handoff = h
        ? `  handoff: stage=${h["stage"] ?? ""} next=${h["next"] ?? ""} blocked_on=${h["blocked_on"] ?? ""} at=${h["at"] ?? ""}`
        : "  handoff: (none)";
      return `${w.id} · ${w.state} · ${String(w.meta["title"] ?? "")}\n${handoff}`;
    });
    sections.push({ name: "opera", priority: 2, text: `## Your active work\n${lines.join("\n")}` });
  }

  // 3. petitiones addressed to the sella, and the sella's own awaiting replies -------
  const petitioLines: string[] = [];
  for (const p of listMd(join(root, "petitiones"))) {
    const petitio = readPetitioFront(p);
    if (!petitio) continue;
    const { data, body } = petitio;
    const id = typeof data["id"] === "string" ? data["id"] : undefined;
    const to = typeof data["to"] === "string" ? data["to"] : undefined;
    const from = typeof data["from"] === "string" ? data["from"] : undefined;
    const state = typeof data["state"] === "string" ? data["state"] : undefined;
    if (!id) continue;
    const addressedToMe = to === sella && state !== "resolved";
    const myAwaitingReply = from === sella && state === "awaiting_reply";
    if (!addressedToMe && !myAwaitingReply) continue;
    petitioLines.push(`${id} · ${state ?? ""} · from ${from ?? "?"} to ${to ?? "?"}\n${dataBlock(`petitiones/${id}.md`, body.trim())}`);
  }
  if (petitioLines.length) sections.push({ name: "petitiones", priority: 3, text: `## Petitiones\n${petitioLines.join("\n")}` });

  // 4. one-line index of the sella's collegium --------------------------------
  if (collegium) {
    const idx = snap.opera
      .filter((w) => w.meta["collegium"] === collegium.id)
      .map((w) => `${w.id} · ${w.state} · ${String(w.meta["title"] ?? "")}`);
    if (idx.length) sections.push({ name: "collegium index", priority: 4, text: `## ${collegium.name} index\n${idx.join("\n")}` });
  }

  // 5. decision acta from the last two days ---------------------------------
  const decisions = (snap.acta ?? []).filter((d) => {
    if (d.kind !== "decision") return false;
    const at = toDate(d.at);
    return at !== undefined && daysBetween(at, now) <= DECISION_WINDOW_DAYS;
  });
  if (decisions.length) {
    const lines = decisions.map((d) => `${d.id} · ${d.title} · ${d.at}\n${dataBlock(`acta/${d.id}.md`, d.body.trim())}`);
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
