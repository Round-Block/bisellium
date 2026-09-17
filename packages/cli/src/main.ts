/**
 * bisellium — CLI entry. Exit codes: 0 pass · 1 blocking findings/refusal ·
 * 2 usage error or not a studio. `check` is the validator; `init`, `new`,
 * `context` and `query` are the build commands landed so far; more land per
 * the dossier build order.
 */
import { resolve } from "node:path";
import { checkStudio, formatReport, type Level } from "./check.js";
import { initStudio } from "./init.js";
import { newItem } from "./new.js";
import { buildContext } from "./context.js";
import { answer } from "./query.js";

const KNOWN_FLAGS = new Set([
  "--json",
  "--now",
  "--level",
  "--kind",
  "--dept",
  "--title",
  "--seat",
  "--max-tokens",
]);
const USAGE =
  "usage: bisellium check [dir] [--json] [--level block|advise] [--now <iso>]\n" +
  "       bisellium init [dir] [--now <iso>]\n" +
  "       bisellium new --kind <kind> --dept <dept> --title <title> [dir]\n" +
  "       bisellium context --seat <seat> [dir] [--now <iso>] [--max-tokens <n>]\n" +
  "       bisellium query <question> [dir] [--now <iso>]";

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

  const now = opts.has("--now") ? new Date(opts.get("--now")!) : new Date();
  if (Number.isNaN(now.getTime())) { console.error("--now must be an ISO date"); return 2; }

  if (cmd === "check") {
    const root = resolve(args[0] ?? ".");
    const level = opts.get("--level") as Level | undefined;
    if (level && level !== "block" && level !== "advise") { console.error("--level must be block or advise"); return 2; }

    const result = checkStudio(root, now);
    if (opts.has("--json")) console.log(JSON.stringify(level ? { ...result, findings: result.findings.filter((f) => f.level === level) } : result, null, 2));
    else console.log(formatReport(result, level));
    return result.notAStudio ? 2 : result.ok ? 0 : 1;
  }

  if (cmd === "init") {
    const root = resolve(args[0] ?? ".");
    const result = initStudio(root, { now });
    console.log(result.message);
    return result.ok ? 0 : 1;
  }

  if (cmd === "new") {
    const kind = opts.get("--kind");
    const dept = opts.get("--dept");
    const title = opts.get("--title");
    if (!kind || !dept || !title) { console.error(USAGE); return 2; }

    const root = resolve(args[0] ?? ".");
    const result = newItem(root, { kind, dept, title });
    if (result.ok) console.log(result.message);
    else console.error(result.message);
    return result.ok ? 0 : 1;
  }

  if (cmd === "context") {
    const seat = opts.get("--seat");
    if (!seat) { console.error(USAGE); return 2; }

    let maxTokens: number | undefined;
    if (opts.has("--max-tokens")) {
      maxTokens = Number(opts.get("--max-tokens"));
      if (!Number.isFinite(maxTokens) || maxTokens <= 0) { console.error("--max-tokens must be a positive number"); return 2; }
    }

    const root = resolve(args[0] ?? ".");
    const bundle = buildContext(root, seat, { now, maxTokens });
    console.log(bundle.text);
    console.log(`tokens: ${bundle.tokens}`);
    return 0;
  }

  if (cmd === "query") {
    const question = args[0];
    if (!question) { console.error(USAGE); return 2; }

    const root = resolve(args[1] ?? ".");
    const result = answer(root, question, { now });
    if (result.answer !== null) console.log(result.answer);
    else console.log(`no match; try: ${(result.suggestions ?? []).join(" · ")}`);
    return 0;
  }

  console.error(USAGE);
  return 2;
}

process.exit(main(process.argv.slice(2)));
