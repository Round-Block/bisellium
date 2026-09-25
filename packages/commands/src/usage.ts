/**
 * packages/commands/src/usage.ts — the one CLI usage banner, exact flag
 * shapes for every command. Single-sourced here (not in cli/src/main.ts,
 * which only *consumes* it via the cli/src/usage.ts re-export shim, same
 * pattern as verify.ts/talk.ts/context.ts — W-016) so `context` can point at
 * it without either copying its text or creating a commands -> cli import
 * cycle (commands has no dependency on cli; cli depends on commands).
 */
export const USAGE =
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
  "       bisellium ci [--ref <ref>] [--opus <id>] [--studio <dir>] [--repo <dir>] [--allow-dirty]\n" +
  "       bisellium talk --sella <sella> [--studio <dir>] [--harness <id>] [--model-only] [--now <iso>] <message…>\n" +
  "       bisellium tick [--studio <dir>] [--now <iso>] [--dry-run] [--repo <dir>]\n" +
  "       bisellium pause [--studio <dir>] [--reason <text>]\n" +
  "       bisellium resume [--studio <dir>]\n" +
  "       bisellium handoff --opus <id> --sella <sella> [--stage <state>] --next <text> [--blocked-on <text>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium emit <json> [--studio <dir>] [--now <iso>]\n" +
  "       bisellium emit --usage <tokens> --opus <id> --sella <sella> --model <model> [--studio <dir>] [--now <iso>]\n" +
  "       bisellium answer --petitio <id> <reply…> [--opus <id>] [--ask-back] [--charter-gap] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium greenlight <opus> [--decline <reason>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium budget <period> --collegium <id> --tokens <n> [--hours <n>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium delegate --sella <id> --model <model> [--from <current>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium delegate --munus <id> --tier <tier>   [--from <current>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium probe [--studio <dir>] [--model <id> --harness <id>] [--dry-run] [--now <iso>]\n" +
  "       bisellium ready <opus> [--spec <path>] [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium halt <opus> --reason <text> --resume-when <text> --decision <id> [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium waive <opus> --gate <id> --reason <text> --decision <id> [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium amend <opus> [--title <text>] [--spec <path>] --reason <text> [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium done <opus> [--sella <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium review <opus> --pass|--fail --evidence <path> [--round <n>] [--sella <id>] [--model <id>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium verdict <opus> --round <n> --sella <id> --outcome <text> [--phase spec|build] [--model <id>] [--from <path>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium red <opus> --behaviour <n> [--sella <id>] [--studio <dir>] [--repo <dir>] [--cwd <dir>] [--now <iso>] -- <cmd…>\n" +
  "       bisellium serve [--studio <dir>] [--port 4477] [--poll-ms 5000] [--now <iso>] [--once]\n" +
  "       bisellium hooks print --harness claude-code --sella <id> [--studio <dir>]\n" +
  "       bisellium hooks check --harness claude-code [--studio <dir>]\n" +
  "       bisellium hook-event <start|stop|tool|compact|context> --sella <id> [--studio <dir>]\n" +
  "       bisellium branch <opus-id> --studio <dir> [--repo <dir>]\n" +
  "       bisellium merge <opus-id> --studio <dir> --repo <dir>\n" +
  "       bisellium close <opus-id> --studio <dir> [--repo <dir>]\n" +
  "       bisellium prune --studio <dir> [--repo <dir>]\n" +
  "       bisellium docs registry [--repo <dir>] [--now <iso>]";
