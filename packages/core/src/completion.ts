/**
 * packages/core/src/completion.ts — W-153: the completion meter (D-038, moved
 * verbatim from scripts/status-page.mjs) and the estimated finish read from
 * the recent pace of points done. NO IMPORTS and erasable TypeScript only, so
 * plain node loads it from a script (scripts/status-page.mjs) as well as the
 * server. See studio/briefs/W-153.md.
 */

const CAP_WHILE_EXIT_OPEN = 95;

export interface Milestone {
  id: string;
  title: string;
  weight: number;
  exit?: { opus?: string; rule?: string; needs?: string } | undefined;
}
export interface MeterOpus {
  id?: unknown;
  state?: unknown;
  milestone?: unknown;
  value?: unknown;
  end?: unknown;
  probationes?: Record<string, { at?: unknown } | undefined> | undefined;
}
export interface MeterRow extends Milestone {
  done: number;
  planned: number;
  met: boolean;
  pct: number;
}
export interface Meter {
  rows: MeterRow[];
  overall: number;
}

export function computeMeter({ milestones, opera, findings }: { milestones: Milestone[]; opera: any[]; findings: { rule?: unknown }[] }): Meter {
  const rows = milestones.map((m) => {
    const mapped = opera.filter((o) => o.milestone === m.id && o.state !== "halted");
    const planned = mapped.reduce((n, o) => n + o.value, 0);
    const done = mapped.filter((o) => o.state === "done").reduce((n, o) => n + o.value, 0);
    const met =
      m.exit?.opus !== undefined
        ? opera.some((o) => o.id === m.exit?.opus && o.state === "done")
        : m.exit?.rule !== undefined && !findings.some((f) => f.rule === m.exit?.rule);
    const raw = planned === 0 ? 0 : (100 * done) / planned;
    return { ...m, done, planned, met, pct: met ? raw : Math.min(raw, CAP_WHILE_EXIT_OPEN) };
  });
  return { rows, overall: rows.reduce((n, r) => n + (r.weight * r.pct) / 100, 0) };
}

export interface Estimate {
  kind: "estimate" | "none";
  reason?: "nothing-left" | "too-little-history";
  remaining: number;
  weekly: [number, number, number];
  bulk: string[];
  days?: number;
  low?: number;
  high?: number;
  finish?: string;
  line: string;
}

// STUB (test-first commit): the behaviours are not implemented yet.
export function doneAt(_opus: { end?: unknown; probationes?: Record<string, { at?: unknown } | undefined> | undefined }): string | undefined {
  return undefined;
}

export function estimateFinish(_args: { meter: Meter; opera: MeterOpus[]; now: Date }): Estimate {
  return { kind: "none", remaining: 0, weekly: [0, 0, 0], bulk: [], line: "" };
}
