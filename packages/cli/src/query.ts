/**
 * packages/cli/src/query.ts — deterministic Q&A over a studio's current
 * state (dossier: an agent should never have to open five files to answer
 * "what's blocked"). No model; questions are matched against three fixed
 * shapes. Output is compact indented text, not JSON — cheap for an agent to
 * read.
 */
import { join } from "node:path";
import { listMd, readFront, readManifest, snapshotDir } from "@bisellium/adapter-native";

export type QueryKind = "needs_you" | "status" | "burn" | "unknown";
export interface QueryAnswer {
  answer: string | null;
  kind: QueryKind;
  suggestions?: string[];
}

const SUGGESTIONS = ["what is blocked on me", "status W-<id>", "burn"];

const NEEDS_YOU = /blocked on me|needs?\s+(me|you)|waiting on me/i;
const STATUS = /status\s+(W-\d+)/i;
const BURN = /burn|budget|allowance/i;

function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}
const hoursSince = (at: Date | undefined, now: Date): string =>
  at ? `${(Math.abs(now.getTime() - at.getTime()) / 3_600_000).toFixed(1)}h` : "unknown age";

interface PetitioRow {
  id: string;
  from?: string;
  to?: string;
  state?: string;
  opened?: unknown;
}

function readPetitiones(root: string): PetitioRow[] {
  const out: PetitioRow[] = [];
  for (const p of listMd(join(root, "petitiones"))) {
    try {
      const fm = readFront<Record<string, unknown>>(p);
      const d = fm.data;
      if (typeof d !== "object" || d === null || Array.isArray(d)) continue;
      const id = typeof d["id"] === "string" ? d["id"] : undefined;
      if (!id) continue;
      out.push({
        id,
        from: typeof d["from"] === "string" ? d["from"] : undefined,
        to: typeof d["to"] === "string" ? d["to"] : undefined,
        state: typeof d["state"] === "string" ? d["state"] : undefined,
        opened: d["opened"],
      });
    } catch {
      /* unreadable petitio: skip, same as check.ts's safeList degradation */
    }
  }
  return out;
}

function statusAnswer(root: string, id: string, now: Date): QueryAnswer {
  const snap = snapshotDir(root, "query", now);
  const item = snap.opera.find((w) => w.id === id);
  if (!item) return { answer: `${id}: not found`, kind: "status" };

  const lines = [
    `${item.id}: ${String(item.meta["title"] ?? "")}`,
    `  state: ${item.state}`,
    `  collegium: ${String(item.meta["collegium"] ?? "")}`,
    `  sella: ${String(item.meta["sella"] ?? "")}`,
  ];
  const gateEntries = Object.entries(item.probationes);
  if (gateEntries.length) {
    lines.push("  gates:");
    for (const [gid, g] of gateEntries) {
      const ev = g.evidence ? ` (${g.evidence.href}${g.evidence.certifies ? ` · ${g.evidence.certifies}` : ""})` : "";
      lines.push(`    ${gid}: ${g.status}${ev}`);
    }
  }
  const h = item.meta["traditio"] as Record<string, string> | undefined;
  if (h) lines.push(`  handoff: next=${h["next"] ?? ""} blocked_on=${h["blocked_on"] ?? ""} at=${h["at"] ?? ""}`);

  return { answer: lines.join("\n"), kind: "status" };
}

function needsYouAnswer(root: string, now: Date): QueryAnswer {
  const manifest = readManifest(root);
  const humanGates = new Set(manifest.probationes.filter((g) => g.kind === "human").map((g) => g.id));
  const snap = snapshotDir(root, "query", now);
  const lines: string[] = [];

  const gated = snap.opera.filter((w) =>
    Object.entries(w.probationes).some(([gid, g]) => humanGates.has(gid) && g.status === "pending"),
  );
  if (gated.length) {
    lines.push("items waiting on a human gate:");
    for (const w of gated) {
      const h = w.meta["traditio"] as Record<string, string> | undefined;
      lines.push(`  ${w.id} · ${String(w.meta["title"] ?? "")} · ${hoursSince(toDate(h?.["at"]), now)} old`);
    }
  }

  const petitiones = readPetitiones(root).filter((a) => a.state === "needs_you");
  if (petitiones.length) {
    lines.push("petitiones needing a reply:");
    for (const a of petitiones) lines.push(`  ${a.id} · from ${a.from ?? "?"} · ${hoursSince(toDate(a.opened), now)} old`);
  }

  if (!lines.length) return { answer: "nothing is blocked on you", kind: "needs_you" };
  return { answer: lines.join("\n"), kind: "needs_you" };
}

function burnAnswer(root: string, now: Date): QueryAnswer {
  const snap = snapshotDir(root, "query", now);
  const stipendia = snap.stipendia ?? [];
  if (!stipendia.length) return { answer: "no aerarium declared", kind: "burn" };
  const lines = stipendia.map((b) => {
    const allowance = b.allowance.tokens;
    const burn = b.burn.tokens;
    const pct = b.posture !== "unknown" && allowance ? ((burn / allowance) * 100).toFixed(1) : "?";
    return `${b.period} · ${b.collegiumId} · ${burn}/${allowance ?? "?"} tokens · ${pct}% · ${b.posture}`;
  });
  return { answer: lines.join("\n"), kind: "burn" };
}

/**
 * Contract: answer never throws. Any adapter/fs failure while resolving a
 * question against `root` (missing or unparseable bisellium.yml, or any
 * other read error under it) is reported as "not a studio" rather than a
 * stack trace — main.ts turns that into exit 2.
 */
export function answer(root: string, question: string, opts: { now: Date }): QueryAnswer {
  const notAStudio: QueryAnswer = { answer: null, kind: "unknown", suggestions: [`not a studio: ${root}`] };
  try {
    readManifest(root); // cheap existence/parse check, independent of which question shape matches
  } catch {
    return notAStudio;
  }

  try {
    const status = STATUS.exec(question);
    if (status) return statusAnswer(root, status[1]!.toUpperCase(), opts.now);

    if (NEEDS_YOU.test(question)) return needsYouAnswer(root, opts.now);

    if (BURN.test(question)) return burnAnswer(root, opts.now);

    return { answer: null, kind: "unknown", suggestions: SUGGESTIONS };
  } catch {
    return notAStudio;
  }
}
