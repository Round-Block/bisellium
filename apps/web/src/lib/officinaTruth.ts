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

/** One plain label per rule family in `RULE_IDS`; a drift guard in officina-truth.test.ts keeps the key sets equal. */
export const RULE_FAMILY_LABELS: Readonly<Record<string, string>> = {
  acta: "Daily records",
  aerarium: "Budget files",
  backlog: "Backlog size",
  brief: "Specs",
  cap: "Size limits",
  collegium: "Team setup",
  decision: "Decisions",
  design: "Design rules",
  doc: "Docs",
  docs: "Dossier pages",
  halted: "Halted work",
  hook: "Agent hooks",
  instructions: "Agent instruction files",
  integration: "Pull request reviews",
  lesson: "Lessons",
  lex: "Team charters",
  link: "Broken links",
  manifest: "Officina settings",
  milestones: "Milestone records",
  munus: "Duties",
  opus: "Work items",
  path: "File paths",
  petitio: "Questions for you",
  probatio: "Gate evidence",
  process: "Process steps",
  receipt: "Session receipts",
  retro: "Retros owed after done",
  sella: "Seats",
  state: "Work item states",
  stray: "Stray files",
  test: "Tests",
  traditio: "Handoff notes",
  usage: "Token usage",
  wip: "Work-in-progress limits",
};

export interface IntegrityRow { family: string; label: string; rules: string[]; count: number }
export interface IntegritySummary { stops: string; warns: string; rows: IntegrityRow[] }

const n = (x: number): string => x.toLocaleString();

export function integritySummary(h: { blocks: number; advisories: number; findingsByRule: Record<string, number> }): IntegritySummary {
  const stops = h.blocks === 0 ? "This check found no blocking problems." : `This check found ${n(h.blocks)} blocking problem${h.blocks === 1 ? "" : "s"}.`;
  const warns = h.advisories === 0 ? "No warnings." : h.advisories === 1 ? "1 warning; it does not stop work." : `${n(h.advisories)} warnings; they do not stop work.`;
  const byFamily = new Map<string, IntegrityRow>();
  for (const [rule, count] of Object.entries(h.findingsByRule)) {
    const family = rule.split(".")[0]!;
    const row = byFamily.get(family) ?? { family, label: RULE_FAMILY_LABELS[family] ?? family, rules: [], count: 0 };
    row.rules.push(rule);
    row.count += count;
    byFamily.set(family, row);
  }
  const rows = [...byFamily.values()].map((r) => ({ ...r, rules: r.rules.sort() }));
  rows.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { stops, warns, rows };
}
