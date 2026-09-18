/**
 * `bisellium init` — scaffold the smallest studio that passes check
 * (examples/fixtures/good-minimal, plus a lex and an aerarium entry so it
 * starts clean). Contract: initStudio never throws.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { checkStudio, formatReport } from "./check.js";
import { renderInstructions } from "./instructions.js";

export interface InitOptions {
  now?: Date;
  /** IANA zone the ISO week is computed in. Defaults to UTC (documented in the init output). */
  timezone?: string;
}

export interface InitResult {
  ok: boolean;
  message: string;
  root?: string;
}

const DEFAULT_TIMEZONE = "UTC";

/** `now`'s calendar date (YYYY-MM-DD) as observed in `timeZone`. Exported —
 *  the one place other modules (tick.ts's aerarium-due computation) get a
 *  timezone-aware calendar date from, rather than each re-deriving it. */
export function isoDateInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * ISO 8601 week (Monday start, week containing the year's first Thursday),
 * computed from `now` as observed in `timeZone` — a studio in Tokyo and one
 * in Los Angeles can be in different ISO weeks at the same instant. Exported
 * — the one tz-aware isoWeek every caller shares (distinct from
 * @bisellium/adapter-native's isoWeek, which is UTC-only and used only for
 * matching an aerarium file's period to "now" for burn computation).
 */
export function isoWeek(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const [year, month, day] = isoDateInZone(now, timeZone).split("-").map(Number) as [number, number, number];
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const LEX = `# Production Lex

Magister: \`producer\`

## Decides alone

Sequence within the slate; halt an item on collision.

## Digests

Daily: slate movement, blocked items.

## Asks

Greenlight requests (backlog → slate); budget reallocation.
`;

export function initStudio(dir: string, opts: InitOptions = {}): InitResult {
  try {
    const root = resolve(dir);
    const manifestPath = join(root, "bisellium.yml");
    if (existsSync(manifestPath)) {
      return { ok: false, message: `${manifestPath} already exists — refusing to overwrite`, root };
    }

    const now = opts.now ?? new Date();
    const timezone = opts.timezone ?? DEFAULT_TIMEZONE;
    const studio = basename(root);
    const period = isoWeek(now, timezone);

    mkdirSync(join(root, "leges"), { recursive: true });
    for (const d of ["opera", "petitiones", "acta", "aerarium"]) mkdirSync(join(root, d), { recursive: true });

    const manifest = `bisellium: 1
studio: ${JSON.stringify(studio)}
patron: patron
timezone: ${JSON.stringify(timezone)}
collegia:
  - { id: production, name: Production, magister: producer, lex: leges/production.md }
sellae:
  - { id: producer, collegium: production, kind: agent }
probationes:
  - { id: patron, name: Patron call, kind: human }
wip_limit: 1
`;
    writeFileSync(manifestPath, manifest);
    writeFileSync(join(root, "leges", "production.md"), LEX);
    writeFileSync(
      join(root, "aerarium", `${period}.yml`),
      `period: ${JSON.stringify(period)}\ncollegia:\n  production: { stipendium_tokens: 500000 }\n`,
    );
    // A same-day daily acta so the freshly minted magister doesn't start life
    // owing one (acta.daily would otherwise advise on an untouched studio).
    writeFileSync(
      join(root, "acta", `${isoDateInZone(now, timezone)}-init.md`),
      `---\nauthor: producer\nkind: daily\ntitle: Studio initialized\nat: ${JSON.stringify(now.toISOString())}\n---\nScaffolded via \`bisellium init\`.\n`,
    );

    // The ROM tier (W-017): a freshly scaffolded studio is its own repo
    // root, so CLAUDE.md/AGENTS.md land right here alongside bisellium.yml.
    const rendered = renderInstructions(root, { now });
    writeFileSync(join(root, "CLAUDE.md"), rendered.claude);
    writeFileSync(join(root, "AGENTS.md"), rendered.agents);

    const result = checkStudio(root, now);
    const tzNote = opts.timezone === undefined ? `timezone: ${timezone} (default — set bisellium.yml#timezone to change)` : `timezone: ${timezone}`;
    return { ok: result.ok, message: `${tzNote}\n${formatReport(result)}`, root };
  } catch (e) {
    return { ok: false, message: `init failed: ${(e as Error).message}` };
  }
}
