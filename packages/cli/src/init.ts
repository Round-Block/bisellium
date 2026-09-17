/**
 * `bisellium init` — scaffold the smallest studio that passes check
 * (examples/fixtures/good-minimal, plus a charter and a budget so it starts
 * clean). Contract: initStudio never throws.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { checkStudio, formatReport } from "./check.js";

export interface InitOptions {
  now?: Date;
}

export interface InitResult {
  ok: boolean;
  message: string;
  root?: string;
}

/** ISO 8601 week (Monday start, week containing the year's first Thursday). */
function isoWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const CHARTER = `# Production Charter

Lead: \`producer\`

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
    const studio = basename(root);
    const period = isoWeek(now);

    mkdirSync(join(root, "charters"), { recursive: true });
    for (const d of ["work", "asks", "digest", "budgets"]) {
      mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, d, ".gitkeep"), "");
    }

    const manifest = `bisellium: 1
studio: ${JSON.stringify(studio)}
owner: owner
departments:
  - { id: production, name: Production, lead: producer, charter: charters/production.md }
seats:
  - { id: producer, department: production, kind: agent }
gates:
  - { id: owner, name: Owner call, kind: human }
wip_limit: 1
`;
    writeFileSync(manifestPath, manifest);
    writeFileSync(join(root, "charters", "production.md"), CHARTER);
    writeFileSync(
      join(root, "budgets", `${period}.yml`),
      `period: ${JSON.stringify(period)}\ndepartments:\n  production: { allowance_tokens: 500000 }\n`,
    );

    const result = checkStudio(root, now);
    return { ok: result.ok, message: formatReport(result), root };
  } catch (e) {
    return { ok: false, message: `init failed: ${(e as Error).message}` };
  }
}
