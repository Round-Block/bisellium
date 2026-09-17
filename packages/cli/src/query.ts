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

interface AskRow {
  id: string;
  from?: string;
  to?: string;
  state?: string;
  opened?: unknown;
}

function readAsks(root: string): AskRow[] {
  const out: AskRow[] = [];
  for (const p of listMd(join(root, "asks"))) {
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
      /* unreadable ask: skip, same as check.ts's safeList degradation */
    }
  }
  return out;
}

function statusAnswer(root: string, id: string): QueryAnswer {
  const snap = snapshotDir(root, "query");
  const item = snap.workItems.find((w) => w.id === id);
  if (!item) return { answer: `${id}: not found`, kind: "status" };

  const lines = [
    `${item.id}: ${String(item.meta["title"] ?? "")}`,
    `  state: ${item.state}`,
    `  department: ${String(item.meta["department"] ?? "")}`,
    `  owner: ${String(item.meta["owner"] ?? "")}`,
  ];
  const gateEntries = Object.entries(item.gateStatus);
  if (gateEntries.length) {
    lines.push("  gates:");
    for (const [gid, g] of gateEntries) {
      const ev = g.evidence ? ` (${g.evidence.href}${g.evidence.certifies ? ` · ${g.evidence.certifies}` : ""})` : "";
      lines.push(`    ${gid}: ${g.status}${ev}`);
    }
  }
  const h = item.meta["handoff"] as Record<string, string> | undefined;
  if (h) lines.push(`  handoff: next=${h["next"] ?? ""} blocked_on=${h["blocked_on"] ?? ""} at=${h["at"] ?? ""}`);

  return { answer: lines.join("\n"), kind: "status" };
}

function needsYouAnswer(root: string, now: Date): QueryAnswer {
  const manifest = readManifest(root);
  const humanGates = new Set(manifest.gates.filter((g) => g.kind === "human").map((g) => g.id));
  const snap = snapshotDir(root, "query");
  const lines: string[] = [];

  const gated = snap.workItems.filter((w) =>
    Object.entries(w.gateStatus).some(([gid, g]) => humanGates.has(gid) && g.status === "pending"),
  );
  if (gated.length) {
    lines.push("items waiting on a human gate:");
    for (const w of gated) {
      const h = w.meta["handoff"] as Record<string, string> | undefined;
      lines.push(`  ${w.id} · ${String(w.meta["title"] ?? "")} · ${hoursSince(toDate(h?.["at"]), now)} old`);
    }
  }

  const asks = readAsks(root).filter((a) => a.state === "needs_you");
  if (asks.length) {
    lines.push("asks needing a reply:");
    for (const a of asks) lines.push(`  ${a.id} · from ${a.from ?? "?"} · ${hoursSince(toDate(a.opened), now)} old`);
  }

  if (!lines.length) return { answer: "nothing is blocked on you", kind: "needs_you" };
  return { answer: lines.join("\n"), kind: "needs_you" };
}

function burnAnswer(root: string): QueryAnswer {
  const snap = snapshotDir(root, "query");
  const budgets = snap.budgets ?? [];
  if (!budgets.length) return { answer: "no budgets declared", kind: "burn" };
  const lines = budgets.map((b) => {
    const allowance = b.allowance.tokens;
    const burn = b.burn.tokens;
    const pct = allowance ? ((burn / allowance) * 100).toFixed(1) : "?";
    return `${b.departmentId} · ${burn}/${allowance ?? "?"} tokens · ${pct}% · ${b.posture}`;
  });
  return { answer: lines.join("\n"), kind: "burn" };
}

export function answer(root: string, question: string, opts: { now: Date }): QueryAnswer {
  const status = STATUS.exec(question);
  if (status) return statusAnswer(root, status[1]!.toUpperCase());

  if (NEEDS_YOU.test(question)) return needsYouAnswer(root, opts.now);

  if (BURN.test(question)) return burnAnswer(root);

  return { answer: null, kind: "unknown", suggestions: SUGGESTIONS };
}
