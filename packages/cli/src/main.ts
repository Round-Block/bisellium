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

// Each command accepts only its own flags — a flag valid for one command
// (e.g. context's --sella) must not silently no-op on another (check).
const FLAGS_BY_COMMAND: Record<string, Set<string>> = {
  check: new Set(["--json", "--now", "--level"]),
  init: new Set(["--now", "--timezone"]),
  new: new Set(["--kind", "--collegium", "--title"]),
  context: new Set(["--sella", "--now", "--max-tokens"]),
  query: new Set(["--now"]),
};
const USAGE =
  "usage: bisellium check [dir] [--json] [--level block|advise] [--now <iso>]\n" +
  "       bisellium init [dir] [--now <iso>] [--timezone <iana>]\n" +
  "       bisellium new --kind <kind> --collegium <collegium> --title <title> [dir]\n" +
  "       bisellium context --sella <sella> [dir] [--now <iso>] [--max-tokens <n>]\n" +
  "       bisellium query <question> [dir] [--now <iso>]";

function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const allowed = (cmd !== undefined ? FLAGS_BY_COMMAND[cmd] : undefined) ?? new Set<string>();
  const opts = new Map<string, string>();
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) { args.push(a); continue; }
    // Split on the FIRST '=' only — a value may itself contain '=' (e.g.
    // --title='a=b: ship it'), and String#split("=", 2) would silently
    // drop everything after the second '=' instead of preserving it.
    const eq = a.indexOf("=");
    const k = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    if (!allowed.has(k)) { console.error(`flag ${k} not allowed for "${cmd ?? ""}"\n${USAGE}`); return 2; }
    if (k === "--json") {
      // Boolean flag: bare --json or --json=true enables it, --json=false
      // disables it, anything else is a usage error (never silently "true").
      if (inline === undefined || inline === "true") { opts.set(k, "1"); continue; }
      if (inline === "false") { opts.delete(k); continue; }
      console.error(`--json must be true or false\n${USAGE}`);
      return 2;
    }
    const v = inline ?? rest[++i];
    if (v === undefined) { console.error(`${k} needs a value\n${USAGE}`); return 2; }
    opts.set(k, v);
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
    const timezone = opts.get("--timezone");
    const result = initStudio(root, { now, timezone });
    console.log(result.message);
    return result.ok ? 0 : 1;
  }

  if (cmd === "new") {
    const kind = opts.get("--kind");
    const collegium = opts.get("--collegium");
    const title = opts.get("--title");
    if (!kind || !collegium || !title) { console.error(USAGE); return 2; }

    const root = resolve(args[0] ?? ".");
    const result = newItem(root, { kind, collegium, title });
    if (result.ok) console.log(result.message);
    else console.error(result.message);
    return result.ok ? 0 : result.notAStudio ? 2 : 1;
  }

  if (cmd === "context") {
    const sella = opts.get("--sella");
    if (!sella) { console.error(USAGE); return 2; }

    let maxTokens: number | undefined;
    if (opts.has("--max-tokens")) {
      maxTokens = Number(opts.get("--max-tokens"));
      if (!Number.isFinite(maxTokens) || maxTokens <= 0) { console.error("--max-tokens must be a positive number"); return 2; }
    }

    const root = resolve(args[0] ?? ".");
    const bundle = buildContext(root, sella, { now, maxTokens });
    if (bundle.text === "" && bundle.truncated[0] === "not a studio") { console.error(`not a studio: ${root}`); return 2; }
    if (bundle.text === "" && bundle.truncated[0] === "unknown sella") { console.error(`unknown sella: ${sella}`); return 1; }
    if (bundle.text === "" && bundle.truncated.length === 0) console.log(`nothing for sella ${sella} right now`);
    else console.log(bundle.text);
    console.log(`tokens: ${bundle.tokens}`);
    return 0;
  }

  if (cmd === "query") {
    const question = args[0];
    if (!question) { console.error(USAGE); return 2; }

    const root = resolve(args[1] ?? ".");
    const result = answer(root, question, { now });
    if (result.kind === "unknown" && result.suggestions?.[0]?.startsWith("not a studio:")) {
      console.error(result.suggestions[0]);
      return 2;
    }
    if (result.answer !== null) console.log(result.answer);
    else console.log(`no match; try: ${(result.suggestions ?? []).join(" · ")}`);
    return 0;
  }

  console.error(USAGE);
  return 2;
}

process.exit(main(process.argv.slice(2)));
