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
import { listMd, readFront, readManifest, resolveSeat, snapshotDir } from "@bisellium/adapter-native";

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
/** Signed elapsed days from `a` to `b`, clamped at 0 — mirrors check.ts's
 *  `days()`: a future `a` reads as fresh, never stale via an absolute value. */
const daysBetween = (a: Date, b: Date): number => Math.max(0, (b.getTime() - a.getTime()) / 86_400_000);

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
  // W-089 behaviour 3: a template or one of its instance ids resolves the
  // same row (S1).
  const resolved = resolveSeat(manifest, sella);
  if (!isPatron && !resolved) return unknownSella;
  // W-089 behaviour 6: `context` is the command every agent boots through
  // (see the CLI usage pointer section below) — booting AS a retired letter
  // is a live-dispatch attempt, not a historical read, so it gets the same
  // refusal posture as an unresolved id (brief: "context, talk, and
  // delegate also refuse a retired live target"). A historical reader that
  // truly needs a tombstone's collegium can still call `resolveSeat`
  // directly; this CLI-facing boot path cannot.
  if (!isPatron && resolved?.seat.retired) return unknownSella;
  const sellaRow = resolved?.seat;

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
  const snap = snapshotDir(root, "context", now);
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

  // 2. CLI usage pointer — priority 0, the single most protected section:
  // the truncation loop below drops the highest priority *number* first, so
  // 0 outranks even the lex (priority 1) and is dropped last of all. That
  // matters in the real officina, not just the fixture: the engineering lex
  // alone runs ~1100 tokens, so at a 600-token budget every section down to
  // and including the lex must go before the loop stops — a priority of 2
  // (below opera/petitiones/etc. but above the lex) still gets dropped well
  // before the lex is gone, since the lex is only exempted from the count
  // once it is *also* dropped. Priority 0 is what actually leaves the
  // pointer standing alone once everything else, lex included, is gone.
  // The one thing every sella needs before its first CLI call: `context` is
  // the command every agent definition tells its agent to run first (see
  // .claude/agents/*.md), so this is the one output no brief-writer can
  // miss. A pointer, not the ~700-token banner inlined (see USAGE in
  // ./usage.js, the single source main.ts's own usage errors read from
  // too): most boots never issue a CLI call that needs the exact flag
  // shapes, so paying that cost on every boot would starve the
  // budget-limited sections below (opera, petitiones, decisions) of
  // room that changes every tick, for a reference that doesn't. The
  // round-trip this costs instead (`bisellium` with no args) is cheap
  // and exactly what CLAUDE.md already tells every session to run before
  // any CLI call.
  sections.push({
    name: "cli usage",
    priority: 0,
    text: "## CLI usage\nRun `bisellium` with no arguments for the exact flag shapes before any CLI call, and before writing one into a subagent brief. The allowlists are strict; a recalled invocation is usually wrong, and a wrong one can write real bookkeeping before it fails.",
  });

  // 3. standing process rules (cross-cutting, all sellae) ----------------
  if (manifest.standing_rules?.length) {
    const lines = manifest.standing_rules.map((r) => `- ${r}`);
    sections.push({ name: "standing rules", priority: 3, text: `## Standing rules\n${lines.join("\n")}` });
  }

  // 4. the sella's active opera, with traditio ---------------------------
  const mine = snap.opera.filter((w) => ACTIVE_STATES.has(w.state) && w.meta["sella"] === sella);
  if (mine.length) {
    const lines = mine.map((w) => {
      const h = w.meta["traditio"] as Record<string, string> | undefined;
      const handoff = h
        ? `  handoff: stage=${h["stage"] ?? ""} next=${h["next"] ?? ""} blocked_on=${h["blocked_on"] ?? ""} at=${h["at"] ?? ""}`
        : "  handoff: (none)";
      return `${w.id} · ${w.state} · ${String(w.meta["title"] ?? "")}\n${handoff}`;
    });
    sections.push({ name: "opera", priority: 4, text: `## Your active work\n${lines.join("\n")}` });
  }

  // 5. petitiones addressed to the sella, and the sella's own awaiting replies -------
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
    const relPath = p.startsWith(root) ? p.slice(root.length + 1).replace(/\\/g, "/") : p;
    petitioLines.push(`${id} · ${state ?? ""} · from ${from ?? "?"} to ${to ?? "?"}\n${dataBlock(relPath, body.trim())}`);
  }
  if (petitioLines.length) sections.push({ name: "petitiones", priority: 5, text: `## Petitiones\n${petitioLines.join("\n")}` });

  // 6. one-line index of the sella's collegium --------------------------------
  if (collegium) {
    const idx = snap.opera
      .filter((w) => w.meta["collegium"] === collegium.id)
      .map((w) => `${w.id} · ${w.state} · ${String(w.meta["title"] ?? "")}`);
    if (idx.length) sections.push({ name: "collegium index", priority: 6, text: `## ${collegium.name} index\n${idx.join("\n")}` });
  }

  // 7. decision acta from the last two days ---------------------------------
  const decisions = (snap.acta ?? []).filter((d) => {
    if (d.kind !== "decision") return false;
    const at = toDate(d.at);
    return at !== undefined && daysBetween(at, now) <= DECISION_WINDOW_DAYS;
  });
  if (decisions.length) {
    const lines = decisions.map((d) => `${d.id} · ${d.title} · ${d.at}\n${dataBlock(`acta/${d.id}.md`, d.body.trim())}`);
    sections.push({ name: "decisions", priority: 7, text: `## Recent decisions\n${lines.join("\n")}` });
  }

  // 8. provider postures --------------------------------------------------------
  if (snap.providers?.length) {
    const lines = snap.providers.map((p) => `${p.id} · ${p.usagePct}% · ${p.status}${p.resetAt ? ` · resets ${p.resetAt}` : ""}`);
    sections.push({ name: "providers", priority: 8, text: `## Provider posture\n${lines.join("\n")}` });
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
