/**
 * W-496 rows b1-b3 (studio/briefs/W-496.md): the guard's background check, which replaces the jq PreToolUse hook.
 * node:test TAP, selected by `--test-name-pattern='^W-496-b<n>\s'`. Rows b1 and b2 feed foreground Bash hook inputs to
 * `runHookEvent` (the main thread's, a subagent's, and a run_in_background one); b3 reads the repo's `.claude/settings.json`
 * and `CLAUDE.md`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runHookEvent } from "./hooks.js";
import { GUARD_COMMAND } from "./guard.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The guard on one Bash hook input: its exit code and stderr. `agent` makes it a subagent's call. */
async function guard(command: string, opts: { bg?: boolean; agent?: boolean } = {}): Promise<{ code: number; err: string }> {
  const input = {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, ...(opts.bg ? { run_in_background: true } : {}) },
    ...(opts.agent ? { agent_id: "a1b2c3", agent_type: "builder" } : {}),
  };
  const err: string[] = [];
  const error = console.error;
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    return { code: r.exitCode, err: err.join("\n") };
  } finally {
    console.error = error;
  }
}
/** The guard's refusal of a call holding `form`. */
const refusal = (form: string): string =>
  `refused: \`${form}\` puts work in the background, where it dies when this Bash call returns (W-496): run the long command as its own Bash call with the run_in_background parameter set to true instead`;
/** Asserts the call is refused for `form` (exit 2, the refusal naming it), the assertion's message being `what`. */
async function refused(what: string, command: string, form: string, opts: { bg?: boolean; agent?: boolean } = {}): Promise<void> {
  const r = await guard(command, opts);
  assert.equal(r.code, 2, what);
  assert.equal(r.err, refusal(form), `${what}: the refusal`);
}
/** Asserts the call runs (exit 0, nothing on stderr), the assertion's message being `what`. */
async function passes(what: string, command: string, opts: { bg?: boolean; agent?: boolean } = {}): Promise<void> {
  const r = await guard(command, opts);
  assert.equal(r.code, 0, what);
  assert.equal(r.err, "", `${what}: nothing on stderr`);
}

test("W-496-b1 behaviour 1: a foreground Bash call holding real background syntax is refused; the and, redirect and pipe forms of & run", async () => {
  await refused("a trailing & is refused", "sleep 600 &", "&");
  await passes("&& runs", "npm test && echo ok");
  await passes(">&2 runs", "echo oops >&2");
  await passes("2>&1 runs", "npm test > test.log 2>&1");
  await passes("&> runs", "npm test &> test.log");
  await passes("&>> runs", "npm test &>> test.log");
  await passes("|& runs", "npm test |& tee test.log");
  await passes("<& runs", "cat <&3");
  await refused("a separating & is refused", "sleep 600 & echo started", "&");
  await refused("an & with no blanks is refused", "sleep 600&echo started", "&");
  await refused("an & after a redirect is refused", "node serve.js > serve.log 2>&1 &", "&");
  await refused("an & in a subshell is refused", "(sleep 600 &)", "&");
  await refused("an & in a command substitution is refused", "x=$(sleep 600 &)", "&");
  await refused("an & in a brace group is refused", "{ sleep 600 & }", "&");
  await refused("an & on a later line is refused", "cd /tmp\nsleep 600 &", "&");
  await refused("a subagent's trailing & is refused", "sleep 600 &", "&", { agent: true });
  await refused("nohup as a command is refused", "nohup node serve.js > serve.log 2>&1", "nohup");
  await refused("setsid as a command is refused", "setsid node serve.js", "setsid");
  await refused("disown as a command is refused", "disown -h %1", "disown");
  await refused("nohup after a separator is refused", "cd /tmp && nohup sleep 600", "nohup");
  await refused("nohup by its path is refused", "/usr/bin/nohup sleep 600", "nohup");
  await refused("nohup after prefixes is refused", "FOO=1 timeout 5 env BAR=2 nohup sleep 600", "nohup");
  await passes("nohup as an argument runs", "git grep -n -e nohup -e setsid -e disown");
  await passes("a script named after nohup runs", "./scripts/nohup-free.sh");
  await passes("a subagent's && runs", "npm test && echo ok", { agent: true });
  await passes("a run_in_background call's & runs", "sleep 600 &", { bg: true });
  await passes("a run_in_background call's nohup runs", "nohup sleep 600", { bg: true });
});
