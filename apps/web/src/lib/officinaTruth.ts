/**
 * apps/web/src/lib/officinaTruth.ts — W-077. Pure copy for the Officina screen:
 * the as-of stamp on tick-written health, and the plain-language integrity summary.
 */

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

/** `as of YYYY-MM-DD HH:MM UTC, <age>`, from the ISO string's UTC fields (no locale). */
export function healthStamp(at: string, now: Date): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "as of an unknown time";
  const head = `as of ${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  if (t > now.getTime()) return head;
  const m = Math.floor((now.getTime() - t) / 60_000);
  if (m < 1) return `${head}, just now`;
  if (m < 60) return `${head}, ${plural(m, "minute")}`;
  if (m < 24 * 60) return `${head}, ${plural(Math.floor(m / 60), "hour")}`;
  return `${head}, ${plural(Math.floor(m / (24 * 60)), "day")}`;
}
