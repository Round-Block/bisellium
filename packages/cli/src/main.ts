/**
 * bisellium — CLI entry. Exit codes: 0 pass · 1 blocking findings · 2 usage
 * error or not a studio. `check` is the validator; more commands land per
 * the dossier build order.
 */
import { resolve } from "node:path";
import { checkStudio, formatReport, type Level } from "./check.js";

const KNOWN_FLAGS = new Set(["--json", "--now", "--level"]);
const USAGE = "usage: bisellium check [dir] [--json] [--level block|advise] [--now <iso>]";

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const opts = new Map<string, string>();
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) { args.push(a); continue; }
    const [k, inline] = a.split("=", 2);
    if (!KNOWN_FLAGS.has(k!)) { console.error(`unknown flag ${k}\n${USAGE}`); return 2; }
    if (k === "--json") { opts.set(k, "1"); continue; }
    const v = inline ?? rest[++i];
    if (v === undefined) { console.error(`${k} needs a value\n${USAGE}`); return 2; }
    opts.set(k!, v);
  }

  if (cmd !== "check") { console.error(USAGE); return 2; }
  const root = resolve(args[0] ?? ".");
  const now = opts.has("--now") ? new Date(opts.get("--now")!) : new Date();
  if (Number.isNaN(now.getTime())) { console.error("--now must be an ISO date"); return 2; }
  const level = opts.get("--level") as Level | undefined;
  if (level && level !== "block" && level !== "advise") { console.error("--level must be block or advise"); return 2; }

  const result = checkStudio(root, now);
  if (opts.has("--json")) console.log(JSON.stringify(level ? { ...result, findings: result.findings.filter((f) => f.level === level) } : result, null, 2));
  else console.log(formatReport(result, level));
  return result.notAStudio ? 2 : result.ok ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
