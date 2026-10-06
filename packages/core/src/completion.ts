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
  probationes?: Record<string, { at?: unknown; status?: unknown } | undefined> | undefined;
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

/**
 * The ONE input boundary (W-153): every opus record and milestone weight is checked here, before any formula.
 * A non-halted opus mapped to a milestone needs a finite, non-negative `value`, and a milestone a finite `weight`.
 * `malformed` marks the whole estimate "No estimate"; the returned copies carry 0 for each invalid number, so no
 * formula downstream ever sees one.
 */
function vet<M extends { id: string; weight: number }>(milestones: M[], opera: any[]): { milestones: M[]; opera: any[]; malformed: boolean } {
  const ids = new Set(milestones.map((m) => m.id));
  const bad = (o: any): boolean => o.state !== "halted" && ids.has(o.milestone) && !(typeof o.value === "number" && Number.isFinite(o.value) && o.value >= 0);
  const badWeight = (m: M): boolean => !Number.isFinite(m.weight);
  return {
    milestones: milestones.map((m) => (badWeight(m) ? { ...m, weight: 0 } : m)),
    opera: opera.map((o) => (bad(o) ? { ...o, value: 0 } : o)),
    malformed: milestones.some(badWeight) || opera.some(bad),
  };
}

export function computeMeter({ milestones, opera, findings }: { milestones: Milestone[]; opera: any[]; findings: { rule?: unknown }[] }): Meter {
  const v = vet(milestones, opera);
  const rows = milestones.map((m, i) => {
    const mapped = v.opera.filter((o) => o.milestone === m.id && o.state !== "halted");
    const planned = mapped.reduce((n, o) => n + o.value, 0);
    const done = mapped.filter((o) => o.state === "done").reduce((n, o) => n + o.value, 0);
    const met =
      m.exit?.opus !== undefined
        ? v.opera.some((o) => o.id === m.exit?.opus && o.state === "done")
        : m.exit?.rule !== undefined && !findings.some((f) => f.rule === m.exit?.rule);
    const raw = planned === 0 ? 0 : (100 * done) / planned;
    return { ...m, done, planned, met, pct: met ? raw : Math.min(raw, CAP_WHILE_EXIT_OPEN), vetted: v.milestones[i]!.weight };
  });
  return {
    rows: rows.map(({ vetted: _vetted, ...r }) => r),
    overall: rows.reduce((n, r) => n + (r.vetted * r.pct) / 100, 0),
  };
}

export interface Estimate {
  kind: "estimate" | "none";
  reason?: "nothing-left" | "too-little-history" | "unreadable-records";
  remaining: number;
  weekly: [number, number, number];
  bulk: string[];
  days?: number;
  low?: number;
  high?: number;
  finish?: string;
  line: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const BULK_OVER = 3; // more than this many done opera in one UTC clock hour is a bulk closure

/** ISO instant of a value that is a string or Date and parses as a date, else undefined. */
function instant(v: unknown): string | undefined {
  if (!(typeof v === "string" || v instanceof Date)) return undefined;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/** When a done opus was done, from its own record: `end`, else its latest gate `at`; undefined when neither parses. */
export function doneAt(opus: { end?: unknown; probationes?: Record<string, { at?: unknown; status?: unknown } | undefined> | undefined }): string | undefined {
  const end = instant(opus.end);
  if (end !== undefined) return end;
  // only a PASSED gate dates the work: a failed, waived or status-less gate is not "done"
  const gates = Object.values(opus.probationes ?? {})
    .map((g) => (g?.status === "passed" ? instant(g.at) : undefined))
    .filter((at): at is string => at !== undefined)
    .sort();
  return gates[gates.length - 1];
}

/** The estimated finish: remaining points over the mean of the last three weeks' paced points (W-153). */
export function estimateFinish({ meter, opera, now, unreadable = 0 }: { meter: Meter; opera: MeterOpus[]; now: Date; unreadable?: number }): Estimate {
  const v = vet(meter.rows, opera);
  const unknown = unreadable > 0 || v.malformed;
  // fail closed: unknown work means unknown remaining points, so no estimate and never a false "nothing left"
  if (unknown) return { kind: "none", reason: "unreadable-records", remaining: 0, weekly: [0, 0, 0], bulk: [], line: "No estimate: an opus record is unreadable or carries no valid points." };
  const rows = new Set(meter.rows.map((r) => r.id));
  const remaining = meter.rows.reduce((n, r) => n + r.planned - r.done, 0);
  const nowMs = now.getTime();
  const events = v.opera
    .filter((o) => o.state === "done" && rows.has(o.milestone as string))
    .flatMap((o) => {
      const at = doneAt(o);
      // an undated or future event counts as done but is not paced
      return at !== undefined && Date.parse(at) <= nowMs ? [{ id: String(o.id), at, points: o.value as number }] : [];
    });
  const hours = new Map<string, typeof events>();
  for (const e of events) hours.set(e.at.slice(0, 13), [...(hours.get(e.at.slice(0, 13)) ?? []), e]);
  const bulkEvents = [...hours.values()].filter((g) => g.length > BULK_OVER).flat();
  const bulk = bulkEvents.map((e) => e.id).sort();
  const paced = events.filter((e) => !bulkEvents.includes(e));
  const weekly = [0, 1, 2].map((k) =>
    paced
      .filter((e) => {
        const t = Date.parse(e.at);
        return t > nowMs - 7 * (k + 1) * DAY_MS && t <= nowMs - 7 * k * DAY_MS;
      })
      .reduce((n, e) => n + e.points, 0),
  ) as [number, number, number];
  const none = (reason: "nothing-left" | "too-little-history", line: string): Estimate => ({ kind: "none", reason, remaining, weekly, bulk, line });
  if (remaining <= 0) return none("nothing-left", "Nothing left: every planned point is done.");
  if (weekly.some((w) => w <= 0)) return none("too-little-history", "No estimate yet: it needs points done in each of the last 3 weeks.");
  const over = (points: number): number => Math.ceil((7 * remaining) / points); // points is a weekly pace; 3 weeks' mean = sum / 3
  const days = Math.ceil((21 * remaining) / (weekly[0] + weekly[1] + weekly[2]));
  const low = over(Math.max(...weekly));
  const high = over(Math.min(...weekly));
  const when = new Date(nowMs + days * DAY_MS);
  const finish = when.toISOString().slice(0, 10);
  const date = `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]} ${when.getUTCFullYear()}`;
  const line = `Estimated finish: in about ${days} days (${low} to ${high} days), around ${date}, at the pace of the last 3 weeks.`;
  return { kind: "estimate", remaining, weekly, bulk, days, low, high, finish, line };
}
