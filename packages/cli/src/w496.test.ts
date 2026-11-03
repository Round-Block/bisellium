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

test("W-496-b2 behaviour 2: quoted text, heredoc bodies and comments never match, and the code after them is still judged", async () => {
  await passes("a heredoc holding an HTML entity runs", "cat > f.html <<'EOF'\n<p>a &middot; b &mdash; c</p>\nEOF");
  await passes("an unquoted heredoc's body runs", "cat > f.txt <<EOF\nx & y\nnohup z\nEOF");
  await passes("a double-quoted delimiter's body runs", 'cat > f.txt << "END"\nsleep 600 &\nEND\necho done');
  await passes("two heredocs on one line run", "cat <<A - <<B\n&a\nA\n&b\nB\necho done");
  await passes("a body line that only opens with the delimiter keeps the body open", "cat <<EOF > f\nEOF & more\nEOF");
  await passes("a heredoc in a command substitution runs", "x=$(cat <<'EOF'\na &amp; b\nEOF\n)");
  await refused("code after a heredoc's terminator is judged", "cat > f.html <<'EOF'\n&middot;\nEOF\nsleep 600 &", "&");
  await refused("nohup after a heredoc is judged", "cat > f <<EOF\nx\nEOF\nnohup sleep 600", "nohup");
  await refused("code after a <<- heredoc's tab-indented terminator is judged", "cat <<-EOF > f\n\ta & b\n\tEOF\nsleep 600 &", "&");
  await refused("an & on the heredoc's own line is judged", "cat <<'EOF' > f &\nbody\nEOF", "&");
  await refused("an & after a here-string is judged", "cat <<< EOF\nsleep 600 &\nEOF", "&");
  await refused("a << inside quotes opens no heredoc", 'echo "<<EOF"\nsleep 600 &\nEOF', "&");
  await passes("a single-quoted & runs", "echo 'a & b'");
  await passes("a double-quoted & runs", 'git commit -m "fix: a & b"');
  await passes("an escaped double quote keeps the string open", 'echo "say \\"a & b\\" twice"');
  await passes("an ANSI-C quoted & runs", "printf $'it\\'s a & b\\n'");
  await passes("a backslash-escaped & runs", "echo a \\& b");
  await passes("a comment's & runs", "npm test # a & b\n# sleep 600 &");
  await passes("an & inside a parameter expansion runs", "echo ${x//&/and}");
  await passes("an & inside an arithmetic expansion runs", "echo $(( 6 & 3 ))");
  await passes("a quoted nohup runs", "echo 'nohup sleep 600' \"setsid x\"");
  await refused("an & after a quoted one is judged", "echo 'a & b' &", "&");
  await refused("an & after a # inside a word is judged", "echo a#b &", "&");
  await refused("a # after an escaped blank is no comment", "echo \\ #not-a-comment &", "&");
  await refused("a # after an arithmetic expansion is no comment", "echo $((1))#not-a-comment &", "&");
  await refused("a # after a parameter expansion is no comment", "echo ${x}#not-a-comment &", "&");
  await refused("a # after a quoted word is no comment", "echo 'a'#not-a-comment &", "&");
  await refused("a # after an escaped character is no comment", "echo a\\;#not-a-comment &", "&");
  await passes("a # after a ; opens a comment", "echo a;#comment &");
  await passes("a # after a blank opens a comment", "echo a #comment &");
  await passes("a # after ( opens a comment", "(#comment &\n)");
  await passes("a # after a line end opens a comment", "echo a\n#comment &");
  await passes("a quoted nohup as a command word runs", "'nohup' sleep 600");
  await passes("a double-quoted setsid as a command word runs", '"setsid" node serve.js');
  await passes("a nohup inside an arithmetic expansion runs", "echo $((6 & nohup))");
  await passes("a nohup inside a parameter expansion runs", "echo ${x:-nohup} ${y//&/ & }");
  await passes("an ANSI-C quoted nohup runs", "echo $'setsid x & y'");
  await passes("quoted and escaped text keeps one word", "echo 'a & b' \"c & d\" e\\&f");
  await passes("a detacher after a ; inside a parameter expansion runs", "echo ${x:-ok; nohup sleep 600}");
  await refused("an & after a quoted nohup is judged", "'nohup' sleep 600 &", "&");
  await refused("a real nohup after an arithmetic expansion is judged", "echo $((6 & nohup)) && nohup sleep 600", "nohup");
  await refused("a real & after an arithmetic expansion is judged", "echo $((6 & nohup)) &", "&");
});

test("W-496-b3 behaviour 3: the repo's Bash calls meet only the bisellium guard at PreToolUse, and CLAUDE.md says what it refuses", () => {
  const settings = JSON.parse(readFileSync(join(REPO, ".claude", "settings.json"), "utf8")) as { hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> };
  const covers = (m: string | undefined, tool: string): boolean => m === undefined || m === "*" || m.split("|").includes(tool);
  const onBash = (settings.hooks["PreToolUse"] ?? []).filter((g) => covers(g.matcher, "Bash")).flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(onBash, [GUARD_COMMAND], "the guard is the one PreToolUse hook a Bash call meets");
  const all = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
  assert.ok(all.every((c) => !/(^|[\s;&|])jq\s/.test(c)), "no hook command runs jq");
  const claude = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes("a foreground Bash call's trailing or separating `&` and `nohup`, `setsid` or `disown` as a command, outside quotes, heredoc bodies and comments"), "CLAUDE.md names the background forms the guard refuses");
});
