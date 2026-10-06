#!/usr/bin/env node
/**
 * scripts/milestones-seed.mjs — W-152: the initial milestone data, read from
 * the acta's two tables and written through the verbs, never typed. Kept so
 * the run is repeatable and reviewable (studio/briefs/W-152.md).
 *
 *  1. writes <studio>/milestones.yml from the "## Milestones" table, only if
 *     absent; refuses (exit 1) if it exists and differs — once the file is
 *     there the acta is no longer the source;
 *  2. runs `bisellium amend <opus> --milestone <id> --value <n>` for every row
 *     of "## Mapping" that is not `outside`, not `unfiled:` and not halted,
 *     skipping a record that already carries the pair (a second run changes
 *     nothing);
 *  3. exits 1 listing every amend that failed.
 *
 * Usage: node scripts/milestones-seed.mjs [--acta <path>] [--studio <dir>] [--sella <id>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify } from "yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const values = { studio: join(REPO_ROOT, "studio"), acta: undefined, sella: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--studio") values.studio = resolve(argv[++i]);
    else if (a === "--acta") values.acta = resolve(argv[++i]);
    else if (a === "--sella") values.sella = argv[++i];
    else throw new Error(`milestones-seed: unknown flag "${a}"`);
  }
  values.acta ??= join(values.studio, "acta/2026-10-06-milestones.md");
  return values;
}

/** The data rows of the first table under `heading`, each a list of trimmed cells. */
export function tableRows(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`milestones-seed: no section "${heading}"`);
  const rows = [];
  for (const line of text
    .slice(start + 1)
    .split("\n")
    .slice(1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim().replace(/`/g, "")),
    );
  }
  return rows.slice(1); // the header row
}

/** "opus W-125" | "rule lesson.recurrent" | "needs: <text>" -> the exit record. */
export function parseExit(cell) {
  let m;
  if ((m = /^opus\s+(\S+)$/.exec(cell))) return { opus: m[1] };
  if ((m = /^rule\s+(\S+)$/.exec(cell))) return { rule: m[1] };
  if ((m = /^needs:\s*(.+)$/.exec(cell))) return { needs: m[1] };
  throw new Error(`milestones-seed: unreadable exit "${cell}"`);
}

const stateOf = (studio, id) => {
  const path = join(studio, "opera", `${id}.md`);
  if (!existsSync(path)) return undefined;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8"));
  const data = fm ? parseYaml(fm[1]) : undefined;
  return data ? { state: data.state, milestone: data.milestone, value: data.value } : undefined;
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = readFileSync(args.acta, "utf8");

  const milestones = tableRows(text, "## Milestones").map(([id, title, weight, exit]) => ({
    id,
    title,
    weight: Number(weight),
    exit: parseExit(exit),
  }));
  const yml = stringify({ milestones }, { lineWidth: 0 });
  const target = join(args.studio, "milestones.yml");
  if (!existsSync(target)) writeFileSync(target, yml);
  else if (readFileSync(target, "utf8") !== yml) {
    console.error(
      `milestones-seed: ${target} exists and differs from the acta's table — the acta is no longer the source; refusing`,
    );
    process.exit(1);
  }

  const main = join(REPO_ROOT, "packages/cli/src/main.ts");
  const failures = [];
  let amended = 0;
  let skipped = 0;
  for (const [id, milestone, value] of tableRows(text, "## Mapping")) {
    if (milestone === "outside" || id.startsWith("unfiled:")) continue;
    const rec = stateOf(args.studio, id);
    if (!rec) {
      failures.push(`${id}: no record under ${args.studio}/opera`);
      continue;
    }
    if (rec.state === "halted") continue;
    if (rec.milestone === milestone && rec.value === Number(value)) {
      skipped++;
      continue;
    }
    const argv = [
      "--import",
      "tsx",
      main,
      "amend",
      id,
      "--milestone",
      milestone,
      "--value",
      value,
      "--reason",
      "seeded from acta 2026-10-06-milestones (D-038)",
      "--studio",
      args.studio,
    ];
    if (args.sella) argv.push("--sella", args.sella);
    try {
      execFileSync(process.execPath, argv, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      amended++;
    } catch (e) {
      failures.push(
        `${id} -> ${milestone}/${value}: ${
          String(e.stderr || e.message)
            .trim()
            .split("\n")[0]
        }`,
      );
    }
  }
  console.log(`milestones-seed: ${amended} amended, ${skipped} already carried the pair, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
