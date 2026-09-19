/**
 * apps/web/src/lib/fasti.ts — pure day-column math behind FastiStrip
 * (DIRECTION.md §4.2). Kept apart from the component so the date/tick
 * logic is testable without a DOM or a built app (W-024's Vite/React
 * scaffold isn't merged into this worktree yet).
 */
export interface ActaEntry {
  id: string;
  author: string;
  kind: string;
  title: string;
  at: string;
  evidence: unknown;
}

export type Tick = "filled" | "hollow";

export interface FastiColumn {
  /** yyyy-mm-dd, UTC */
  date: string;
  weekdayInitial: string;
  tick: Tick;
  isToday: boolean;
}

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"]; // Sun..Sat

/** A "cascade landing" per the brief: kind containing "retro" or "cascade"
 *  (the API is frozen and doesn't name a narrower field). */
const LANDING_KIND = /retro|cascade/i;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 14 columns, `today - 13` through `today`.
 *
 * ponytail: the frozen API (`/api/acta`) carries no per-day "closed"
 * signal — no daily posture-history endpoint — so a day is either
 * "filled" (a landing happened) or "hollow" (nothing landed); the design's
 * third state (no tick at all, closed day) has no data source yet. Add it
 * once an endpoint exposes daily posture/open-closed history.
 */
export function buildFastiColumns(acta: ActaEntry[], today: Date): FastiColumn[] {
  const landedDays = new Set(acta.filter((a) => LANDING_KIND.test(a.kind)).map((a) => a.at.slice(0, 10)));
  const todayKey = ymd(today);
  const columns: FastiColumn[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = ymd(d);
    columns.push({
      date: key,
      weekdayInitial: WEEKDAY_INITIALS[d.getUTCDay()]!,
      tick: landedDays.has(key) ? "filled" : "hollow",
      isToday: key === todayKey,
    });
  }
  return columns;
}
