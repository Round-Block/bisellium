/**
 * @bisellium/shim/hooks — the 'claude-code' harness-hooks profile (W-015):
 * turns Claude Code's own hooks contract (`claude --help` /
 * docs.anthropic.com/en/docs/claude-code/hooks) into bisellium's
 * event-native adapter. SessionStart runs TWO commands: `bisellium context`
 * (re-injects the sella's boot bundle — its stdout is read by Claude Code
 * as additional context) AND `bisellium hook-event start` (opens the
 * session's receipt) — without the second one, nothing in this profile
 * ever writes a start receipt, so `bisellium hooks check`/`hook.dead` can
 * never report a sella alive and a Stop-only receipt is missing
 * sella/startedAt (check.ts's `receipt.shape` rule). PreCompact re-runs
 * just `bisellium context` (a fresh boot bundle after compaction, not a
 * new session). Stop runs `bisellium hook-event stop` (closes the
 * receipt, reminds about a stale handoff); PostToolUse (Write|Edit only)
 * runs `bisellium hook-event tool` (one workflow.tool_used event per file
 * touch). SubagentStart is deliberately left unwired: a subagent has no
 * sella of its own to hand a receipt or a boot bundle to, so there is
 * nothing honest to wire it to yet — documented here rather than silently
 * absent from the printed block.
 *
 * The template file (claude-code.json) is genuinely static JSON, with
 * `__SELLA__`/`__STUDIO__` placeholders sitting directly in each command's
 * argv (e.g. `bisellium context --sella __SELLA__ --studio __STUDIO__`).
 * `claudeCodeHooksBlock` substitutes each placeholder, in the template's
 * raw JSON *text* before parsing (never by walking the parsed object, so
 * this file needs no change if the template grows another hook), with the
 * sella/studio value wrapped in POSIX single quotes (`shellQuote`) so it
 * lands in argv as one literal shell word no matter what it contains.
 *
 * This is deliberately NOT a same-line `NAME="value" cmd --flag "$NAME"`
 * env-var prefix: in POSIX sh/bash, a variable-assignment prefix is applied
 * to the command's *environment* only after that command line has already
 * been word-expanded, so `--flag "$NAME"` expands `$NAME` from the outer
 * shell's (unset) value, not the assignment on the same line — every
 * command printed that way resolved `--sella`/`--studio` to empty strings
 * (confirmed: `bash -c 'FOO="x" printf "%s" "$FOO"'` -> empty). Substituting
 * the shell-quoted literal directly into argv sidesteps that expansion
 * order entirely — there is no variable to expand.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The hook names this profile actually wires — SubagentStart is
 *  intentionally absent (see module doc). `bisellium hooks print`'s output
 *  has exactly these four top-level keys under `hooks`. */
export const CLAUDE_CODE_HOOK_NAMES = ["SessionStart", "PreCompact", "Stop", "PostToolUse"] as const;

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "claude-code.json");

/** POSIX-correct single-quoting: wraps `s` in single quotes so the shell
 *  sees it as exactly one literal word, whatever it contains — spaces,
 *  `$vars`, backticks, `;`, double quotes, all inert inside single quotes.
 *  An embedded single quote is the one character single quotes can't
 *  represent directly, so it's closed, escaped, and reopened (`'\''`),
 *  the standard POSIX idiom. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Same escaping `JSON.stringify` already does for a string body — used to
 *  drop a shell-quoted literal into the template's raw JSON *text* so the
 *  backslashes `shellQuote` may have introduced (or any quote/backslash in
 *  the original value) can't corrupt the surrounding JSON once parsed. */
function jsonEscape(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

export interface ClaudeCodeHooksOpts {
  /** Omitted entirely strips `--sella` (and its placeholder) from every
   *  printed command rather than substituting an empty string — a hook
   *  target with no `--sella` baked in falls back to `$BISELLIUM_SELLA`,
   *  then `"guest"` (hook-event's own resolution order; see
   *  packages/cli/src/hooks.ts). */
  sella?: string;
  /** Studio directory every wired command is given via `--studio`. Defaults to ".". */
  studio?: string;
}

export interface ClaudeCodeHooksBlock {
  hooks: Record<string, unknown>;
}

/** The `.claude/settings.json` `hooks` block to paste for one sella. Reads
 *  the template fresh off disk on every call (no in-memory caching) — an
 *  edit to claude-code.json is picked up without a process restart, same
 *  spirit as the rest of this CLI reading a studio's own files fresh every
 *  run rather than caching them. */
export function claudeCodeHooksBlock(opts: ClaudeCodeHooksOpts): ClaudeCodeHooksBlock {
  const raw = readFileSync(TEMPLATE_PATH, "utf8");
  const studio = jsonEscape(shellQuote(opts.studio ?? "."));
  let filled = raw.replace(/__STUDIO__/g, studio);
  if (opts.sella !== undefined) {
    const sella = jsonEscape(shellQuote(opts.sella));
    filled = filled.replace(/__SELLA__/g, sella);
  } else {
    // Strip the flag AND its placeholder from the template text — never
    // substitute an empty string (`--sella ''` is a real, if useless,
    // argument; hook-event's own fallback chain only kicks in when the
    // flag is absent entirely).
    filled = filled.replace(/ --sella __SELLA__/g, "");
  }
  return JSON.parse(filled) as ClaudeCodeHooksBlock;
}
