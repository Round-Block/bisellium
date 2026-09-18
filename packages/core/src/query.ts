/**
 * packages/core/src/query.ts — W-013: the same three deterministic questions
 * `packages/cli/src/query.ts` answers from files (needs-you, status W-<id>,
 * burn), answered here from the Index instead. Shapes mirror the CLI's
 * output where the Index actually has the data; where it doesn't (an opus's
 * title, an aerarium allowance — neither is a `workflow.*` attribute, so
 * neither survives into the event log) the line is honestly narrower rather
 * than guessed. `bisellium query --from-index` (packages/cli/src/query.ts)
 * is the intended caller.
 */
import { isoWeek, type Index } from "./index-db.js";

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

function hoursSince(ts: string | undefined, now: Date): string {
  if (!ts) return "unknown age";
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return "unknown age";
  return `${(Math.abs(now.getTime() - at.getTime()) / 3_600_000).toFixed(1)}h`;
}

export function needsYouAnswer(index: Index, now: Date): QueryAnswer {
  const { probationes, petitiones } = index.needsYou();
  const lines: string[] = [];

  if (probationes.length) {
    lines.push("items waiting on a human gate:");
    for (const p of probationes) {
      const opus = index.opus(p.opus);
      lines.push(`  ${p.opus} · ${p.probatio} · ${hoursSince(opus?.updatedAt, now)} old`);
    }
  }

  if (petitiones.length) {
    lines.push("petitiones needing a reply:");
    for (const p of petitiones) lines.push(`  ${p.id} · from ${p.from ?? "?"} · ${hoursSince(p.opened, now)} old`);
  }

  if (!lines.length) return { answer: "nothing is blocked on you", kind: "needs_you" };
  return { answer: lines.join("\n"), kind: "needs_you" };
}

export function statusAnswer(index: Index, id: string): QueryAnswer {
  const item = index.opus(id);
  if (!item) return { answer: `${id}: not found`, kind: "status" };

  const lines = [`${item.id}`, `  state: ${item.state}`, `  collegium: ${item.collegium ?? ""}`, `  sella: ${item.sella ?? ""}`];
  const gateEntries = Object.entries(item.probationes);
  if (gateEntries.length) {
    lines.push("  gates:");
    for (const [gid, g] of gateEntries) lines.push(`    ${gid}: ${g.status}${g.certifies ? ` · ${g.certifies}` : ""}`);
  }
  return { answer: lines.join("\n"), kind: "status" };
}

/** `period` defaults to the ISO week `now` falls in (matches adapter-native's
 *  convention: burn is only ever meaningful for the current period). Omitting
 *  `collegium` reports every collegium the index has ever seen on an opus. */
export function burnAnswer(index: Index, now: Date, period?: string, collegium?: string): QueryAnswer {
  const p = period ?? isoWeek(now);
  if (collegium !== undefined) return { answer: `${p} · ${collegium} · ${index.burn(p, collegium)} tokens`, kind: "burn" };

  const collegia = new Set<string>();
  for (const row of index.opera()) if (row.collegium !== undefined) collegia.add(row.collegium);
  if (collegia.size === 0) return { answer: `${p} · no collegia observed yet`, kind: "burn" };
  const lines = [...collegia].sort().map((c) => `${p} · ${c} · ${index.burn(p, c)} tokens`);
  return { answer: lines.join("\n"), kind: "burn" };
}

/**
 * Contract: mirrors packages/cli/src/query.ts's `answer()` — same three
 * question shapes, same "no match" suggestions — but reads the Index instead
 * of the studio's files. Never throws: an Index query failure (a locked or
 * corrupt db file) is reported as "unknown" with no suggestions rather than
 * propagating a stack trace.
 */
export function answer(index: Index, question: string, opts: { now: Date; period?: string; collegium?: string }): QueryAnswer {
  // An invalid `now` (e.g. a bad --now the caller failed to validate) must
  // report as an unanswerable question, not silently propagate into
  // isoWeek() as NaN — `burnAnswer`'s period would otherwise read as the
  // literal string "NaN-WNaN" instead of anyone noticing the clock was bad.
  if (Number.isNaN(opts.now.getTime())) return { answer: null, kind: "unknown", suggestions: SUGGESTIONS };
  try {
    const status = STATUS.exec(question);
    if (status) return statusAnswer(index, status[1]!.toUpperCase());

    if (NEEDS_YOU.test(question)) return needsYouAnswer(index, opts.now);

    if (BURN.test(question)) return burnAnswer(index, opts.now, opts.period, opts.collegium);

    return { answer: null, kind: "unknown", suggestions: SUGGESTIONS };
  } catch {
    return { answer: null, kind: "unknown", suggestions: SUGGESTIONS };
  }
}
