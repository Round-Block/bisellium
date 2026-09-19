/**
 * bisellium — CLI entry. Exit codes: 0 pass · 1 blocking findings/refusal ·
 * 2 usage error or not a studio. `check` is the validator; `init`, `new`,
 * `context` and `query` are the build commands landed so far; `providers`,
 * `run` and `verify` land the cascade-2 seams (provider status, worktree +
 * receipts, automated probationes) — more land per the dossier build order.
 */
import { resolve } from "node:path";
import { checkStudio, formatReport, type Level } from "./check.js";
import { initStudio } from "./init.js";
import { runNew } from "./new.js";
import { runInstructions } from "./instructions.js";
import { runRetro } from "./retro.js";
import { buildContext } from "./context.js";
import { answer } from "./query.js";
import { runProviders } from "./providers.js";
import { runCommand } from "./run.js";
import { runVerify } from "./verify.js";
import { runTalk } from "./talk.js";
import { runTick } from "./tick.js";
import { runPause, runResume } from "./pause.js";
import { runHandoff, runEmit, runAnswer, runGreenlight, runBudget } from "./writes.js";
import { runReady, runDone, runReview, runRed } from "./lifecycle.js";
import { runServe } from "./serve.js";
import { runHooks, runHookEvent } from "./hooks.js";
import { runDocs } from "./docs.js";
import { runBranch, runMerge } from "./branch.js";

// Each command accepts only its own flags — a flag valid for one command
// (e.g. context's --sella) must not silently no-op on another (check).
// `run`, `verify`, `talk`, `tick`, `pause`, `resume`, `handoff`, `emit`,
// `answer`, `greenlight`, `budget`, `new`, `instructions` and `retro` are
// NOT listed here: each parses its own argv (several have a trailing
// free-text argument — talk's message, answer's reply — the generic parser
// below would mangle, and a couple use a "--" separator it would choke on)
// — main.ts hands them the raw, unparsed rest of argv instead of going
// through this table.
const FLAGS_BY_COMMAND: Record<string, Set<string>> = {
  check: new Set(["--json", "--now", "--level", "--repo"]),
  init: new Set(["--now", "--timezone"]),
  context: new Set(["--sella", "--studio", "--now", "--max-tokens"]),
  query: new Set(["--now", "--from-index"]),
  providers: new Set(["--source", "--json", "--now"]),
};
const USAGE =
  "usage: bisellium check [dir] [--json] [--level block|advise] [--now <iso>] [--repo <dir>]\n" +
  "       bisellium init [dir] [--now <iso>] [--timezone <iana>]\n" +
  "       bisellium new --kind <kind> --collegium <collegium> --title <title> [--spec <path>] [--brief] [dir]\n" +
  "       bisellium instructions [--studio <dir>] [--repo <dir>] [--write] [--now <iso>]\n" +
  "       bisellium retro --cascade <N> [--from <json>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium context [--sella <sella>] [dir | --studio <dir>] [--now <iso>] [--max-tokens <n>]\n" +
  "       bisellium query <question> [dir] [--now <iso>] [--from-index]\n" +
  "       bisellium providers [dir] [--source auto|usage|quota-axi] [--json] [--now <iso>]\n" +
  "       bisellium run --sella <sella> [--studio <dir>] [--repo <dir>] [--no-worktree] [--base <ref>] [--opus <id>] [--keep] -- <cmd…>\n" +
  "       bisellium run --reclaim [--studio <dir>] [--repo <dir>]\n" +
  "       bisellium verify <opus-id> [--studio <dir>] [--repo <dir>] [--commit <ref>] [--now <iso>] [--allow-dirty]\n" +
  "       bisellium talk --sella <sella> [--studio <dir>] [--harness <id>] [--model-only] [--now <iso>] <message…>\n" +
  "       bisellium tick [--studio <dir>] [--now <iso>] [--dry-run] [--repo <dir>]\n" +
  "       bisellium pause [--studio <dir>] [--reason <text>]\n" +
  "       bisellium resume [--studio <dir>]\n" +
  "       bisellium handoff --opus <id> --sella <sella> [--stage <state>] --next <text> [--blocked-on <text>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium emit <json> [--studio <dir>] [--now <iso>]\n" +
  "       bisellium answer --petitio <id> <reply…> [--ask-back] [--charter-gap] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium greenlight <opus> [--decline <reason>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium budget <period> --collegium <id> --tokens <n> [--hours <n>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium ready <opus> [--spec <path>] [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium done <opus> [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium review <opus> --pass|--fail --evidence <path> [--round <n>] [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium red <opus> --behaviour <n> [--sella <id>] [--studio <dir>] [--repo <dir>] [--now <iso>] -- <cmd…>\n" +
  "       bisellium serve [--studio <dir>] [--port 4477] [--poll-ms 5000] [--now <iso>] [--once]\n" +
  "       bisellium hooks print --harness claude-code --sella <id> [--studio <dir>]\n" +
  "       bisellium hooks check --harness claude-code [--studio <dir>]\n" +
  "       bisellium hook-event <start|stop|tool|compact> --sella <id> [--studio <dir>]\n" +
  "       bisellium branch <opus-id> --studio <dir> [--repo <dir>]\n" +
  "       bisellium merge <opus-id> --studio <dir> --repo <dir>\n" +
  "       bisellium docs registry [--repo <dir>] [--now <iso>]";

/** `bisellium serve` never exits on its own — it's a long-running HTTP
 *  server (plus a poll timer, unless `--once`), so main()'s usual
 *  "compute an exit code and return it" shape doesn't fit. A usage error or
 *  failed start (bad --studio, port already in use, …) still exits
 *  immediately with runServe's own exit code. Otherwise this resolves only
 *  once the process gets SIGINT/SIGTERM (Ctrl-C, or `kill`, matching how an
 *  operator actually stops it — see docs/ADOPTION.md), calling the server's
 *  own close() first so every open SSE client and the HTTP socket itself
 *  shut down cleanly instead of process.exit() ripping them out from
 *  under connected clients. */
async function runServeUntilStopped(rest: string[]): Promise<number> {
  const started = await runServe(rest);
  if (started.exitCode !== 0) return started.exitCode;

  return new Promise<number>((resolveExit) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      started.close().then(
        () => resolveExit(0),
        () => resolveExit(0),
      );
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;

  // `run` and `verify` own their argv end to end (see the comment on
  // FLAGS_BY_COMMAND above) — dispatch before the generic flag parser ever
  // sees their args.
  if (cmd === "run") return (await runCommand(rest)).exitCode;
  if (cmd === "verify") return (await runVerify(rest)).exitCode;
  if (cmd === "talk") return (await runTalk(rest)).exitCode;
  if (cmd === "tick") return (await runTick(rest)).exitCode;
  if (cmd === "pause") return (await runPause(rest)).exitCode;
  if (cmd === "resume") return (await runResume(rest)).exitCode;
  if (cmd === "handoff") return runHandoff(rest).exitCode;
  if (cmd === "emit") return runEmit(rest).exitCode;
  if (cmd === "ready") return runReady(rest).exitCode;
  if (cmd === "done") return runDone(rest).exitCode;
  if (cmd === "review") return runReview(rest).exitCode;
  if (cmd === "red") return (await runRed(rest)).exitCode;
  if (cmd === "hooks") return runHooks(rest).exitCode;
  if (cmd === "hook-event") return (await runHookEvent(rest)).exitCode;
  if (cmd === "docs") return runDocs(rest).exitCode;
  if (cmd === "branch") return runBranch(rest).exitCode;
  if (cmd === "merge") return runMerge(rest).exitCode;
  if (cmd === "new") return runNew(rest).exitCode;
  if (cmd === "instructions") return runInstructions(rest).exitCode;
  if (cmd === "retro") return runRetro(rest).exitCode;
  if (cmd === "serve") return runServeUntilStopped(rest);
  // answer/greenlight/budget are Patron writes: BISELLIUM_ROLE=patron
  // before calling, so their timeline/patron.jsonl line records the
  // correct role (docs/ADOPTION.md: "the CLI runs them with
  // BISELLIUM_ROLE=patron"; the functions default to "patron" on their
  // own only so tests calling them directly don't need this wrapper).
  if (cmd === "answer" || cmd === "greenlight" || cmd === "budget") {
    process.env["BISELLIUM_ROLE"] = "patron";
    if (cmd === "answer") return runAnswer(rest).exitCode;
    if (cmd === "greenlight") return runGreenlight(rest).exitCode;
    return runBudget(rest).exitCode;
  }

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
    if (k === "--json" || k === "--from-index") {
      // Boolean flag: bare --json/--from-index or an explicit "=true"
      // enables it, "=false" disables it, anything else is a usage error
      // (never silently "true").
      if (inline === undefined || inline === "true") { opts.set(k, "1"); continue; }
      if (inline === "false") { opts.delete(k); continue; }
      console.error(`${k} must be true or false\n${USAGE}`);
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

    const repo = opts.get("--repo");
    const result = checkStudio(root, now, repo ? { repo: resolve(repo) } : {});
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

  if (cmd === "context") {
    // --sella is optional: a hook target (SessionStart/PreCompact call this
    // command as `bisellium context --studio studio`, deliberately with no
    // --sella baked in) falls back to $BISELLIUM_SELLA, and then "guest" —
    // same convention as hook-event (see hooks.ts).
    const sella = opts.get("--sella") ?? process.env["BISELLIUM_SELLA"] ?? "guest";

    let maxTokens: number | undefined;
    if (opts.has("--max-tokens")) {
      maxTokens = Number(opts.get("--max-tokens"));
      if (!Number.isFinite(maxTokens) || maxTokens <= 0) { console.error("--max-tokens must be a positive number"); return 2; }
    }

    const root = resolve(opts.get("--studio") ?? args[0] ?? ".");
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
    const result = answer(root, question, { now, fromIndex: opts.has("--from-index") });
    if (result.kind === "unknown" && result.suggestions?.[0]?.startsWith("not a studio:")) {
      console.error(result.suggestions[0]);
      return 2;
    }
    if (result.answer !== null) console.log(result.answer);
    else console.log(`no match; try: ${(result.suggestions ?? []).join(" · ")}`);
    return 0;
  }

  if (cmd === "providers") {
    const source = opts.get("--source");
    const result = await runProviders(args, { source, json: opts.has("--json"), now });
    if (result.stdout) (result.exitCode === 0 ? console.log : console.error)(result.stdout);
    return result.exitCode;
  }

  console.error(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  },
);
