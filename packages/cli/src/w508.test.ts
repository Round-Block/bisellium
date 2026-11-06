/**
 * W-508 rows (studio/briefs/W-508.md): a shown reply is never sent back. The guard `bisellium hook-event guard` at Stop exits 0
 * whatever the reply holds and shows the Patron the reading; at UserPromptSubmit it hands the model the same reading. No rule
 * judges a reply's length (the Patron 2026-11-06). node:test TAP, selected by `--test-name-pattern='^W-508-b<n>\s'`. Rows b1 to b3 and b5 feed hook
 * inputs to `runHookEvent` with HOME set to a fixture home under the OS tmp dir (its status-line file and Codex log); b4 checks a
 * fixture repo's settings and reads the real `.claude/settings.json` and `CLAUDE.md`. Nothing reads or writes the real home or `studio/`.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runHookEvent } from "./hooks.js";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w508-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Values {
  cw?: number;
  c5?: number;
  xw?: number;
  ctx?: number;
  seenAgoMs?: number;
}
const FULL: Values = { cw: 19, c5: 16, xw: 39, ctx: 208732 };
/** The reading of FULL as the hook shows it. */
const LINE = "Claude week 19%, 5h 16% | Codex week 39% | context 208k of 300k";
const USAGE = (h: string): string => join(h, ".bisellium-evidence", "usage");
/** A home whose status-line file and newest Codex log hold `v`, each only when it holds a value. */
function home(v: Values): string {
  const h = tmp();
  mkdirSync(USAGE(h), { recursive: true });
  const rl = { ...(v.c5 === undefined ? {} : { five_hour: { used_percentage: v.c5 } }), ...(v.cw === undefined ? {} : { seven_day: { used_percentage: v.cw } }) };
  const ctx = v.ctx === undefined ? {} : { ctx: { current_usage: { input_tokens: 2, cache_creation_input_tokens: 730, cache_read_input_tokens: v.ctx - 732 } } };
  if (Object.keys(rl).length > 0 || v.ctx !== undefined) writeFileSync(join(USAGE(h), "claude-latest.json"), JSON.stringify({ at: new Date(Date.now() - (v.seenAgoMs ?? 0)).toISOString(), rl, ...ctx }));
  if (v.xw !== undefined) {
    const logs = join(h, ".codex", "sessions", "2026", "11", "05");
    mkdirSync(logs, { recursive: true });
    const resets = Math.floor(Date.now() / 1000) + 86_400;
    writeFileSync(join(logs, "rollout-x.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), payload: { rate_limits: { primary: { used_percent: v.xw, window_minutes: 10_080, resets_at: resets } } } })}\n`);
  }
  return h;
}
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
/** The guard on one hook input, HOME set to `h`: its exit code, stdout and stderr. */
async function hook(h: string, input: Record<string, unknown>): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  const saved = process.env["HOME"];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  process.env["HOME"] = h;
  try {
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    return { code: r.exitCode, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
    if (saved === undefined) delete process.env["HOME"];
    else process.env["HOME"] = saved;
  }
}
const stop = (reply: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  hook_event_name: "Stop",
  session_id: "s1",
  stop_hook_active: false,
  ...(reply === undefined ? {} : { last_assistant_message: reply }),
  ...extra,
});
/** What a Stop's stdout shows the Patron, "" when it printed nothing. */
const shown = (r: { out: string }): string => (r.out === "" ? "" : ((JSON.parse(r.out) as { systemMessage?: string }).systemMessage ?? ""));

test("W-508-b1 behaviour 1: a Stop never sends a main-thread reply back", async () => {
  const h = home(FULL);
  const over = await hook(h, stop(words(201)));
  assert.equal(over.code, 0, "a 201-word reply: not refused");
  assert.equal(over.err, "", "nothing on stderr for Claude Code to feed back");
  assert.equal((await hook(h, stop(words(400)))).code, 0, "a 400-word reply: not refused");
  assert.equal((await hook(h, stop(words(200)))).code, 0, "200 words: exits 0");
});

test("W-508-b2 behaviour 2: a Stop shows the Patron the reading of the plans' own sources, through systemMessage alone, with no second reply", async () => {
  const h = home(FULL);
  const r = await hook(h, stop(words(20)));
  assert.equal(r.code, 0, "a reply with no reading: not refused");
  assert.equal(shown(r), LINE, "the hook shows the latest reading");
  assert.deepEqual(Object.keys(JSON.parse(r.out) as object), ["systemMessage"], "systemMessage alone: no decision, reason or continue that asks a second reply");
  assert.equal(shown(await hook(h, stop(`${words(20)}\nClaude week 18%, 5h 12% | Codex week 38% | context 150k of 300k`))), LINE, "the shown values are the sources', whatever the reply says");
  const moved = home({ ...FULL, cw: 20 });
  assert.equal(shown(await hook(moved, stop(words(20)))), LINE.replace("week 19%", "week 20%"), "a new value in the source: the new value is shown");
  const stale = home({ ...FULL, seenAgoMs: 31 * 60_000 });
  assert.match(shown(await hook(stale, stop(words(20)))), /^Claude week 19%.* \(Claude values seen \S+\)$/, "a status line 31 minutes old: shown, marked with when it was seen");
  const recent = home({ ...FULL, seenAgoMs: 29 * 60_000 });
  assert.equal(shown(await hook(recent, stop(words(20)))), LINE, "a status line 29 minutes old: no mark");
  const lacks = home({ cw: 19, xw: 39 });
  assert.equal(shown(await hook(lacks, stop(words(20)))), "Claude week 19%, 5h ?% | Codex week 39% | context ?k of 300k", "a value the source lacks is ?");
  const none = home({});
  const silent = await hook(none, stop(words(20)));
  assert.equal(silent.code, 0, "no source at all: exits 0");
  assert.equal(silent.out, "", "no source at all: nothing shown");
  const bad = home({ xw: 39 });
  mkdirSync(join(USAGE(bad), "claude-latest.json"));
  const unread = await hook(bad, stop(words(20)));
  assert.equal(unread.code, 0, "an unreadable status-line file: not refused");
  assert.equal(shown(unread), "Claude week ?%, 5h ?% | Codex week 39% | context ?k of 300k", "an unreadable status-line file: its values are ?");
  assert.equal((await hook(h, stop(words(20), { stop_hook_active: true }))).out, "", "a continuation shows nothing");
  assert.equal((await hook(h, stop(words(20), { agent_id: "a1" }))).out, "", "a subagent's Stop shows nothing");
  assert.equal((await hook(h, stop(undefined))).out, "", "a Stop with no reply text shows nothing");
  const sub = { hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "builder", agent_transcript_path: join(h, "none.jsonl"), stop_hook_active: false, background_tasks: [], last_assistant_message: words(400) };
  assert.equal((await hook(h, sub)).out, "", "a SubagentStop shows nothing");
  const malformed = home(FULL);
  const wrongAgent = await hook(malformed, stop(words(201), { agent_id: 7 }));
  assert.equal(wrongAgent.code, 0, "a wrong-typed agent_id: not refused");
  assert.equal(wrongAgent.out, "", "a wrong-typed agent_id shows nothing");
  assert.equal((await hook(malformed, stop(words(201), { agent_id: "" }))).out, "", "an empty agent_id shows nothing");
  assert.equal((await hook(malformed, stop(words(201), { agent_id: null }))).out, "", "a null agent_id shows nothing");
  const wrongActive = await hook(malformed, stop(words(201), { stop_hook_active: "false" }));
  assert.equal(wrongActive.code, 0, "a wrong-typed stop_hook_active: not refused");
  assert.equal(wrongActive.out, "", "a wrong-typed stop_hook_active shows nothing");
  const noActive = stop(words(201));
  delete noActive["stop_hook_active"];
  assert.equal((await hook(malformed, noActive)).out, "", "no stop_hook_active shows nothing");
});

const prompt = (session: unknown = "s1", extra: Record<string, unknown> = {}): Record<string, unknown> => ({ hook_event_name: "UserPromptSubmit", session_id: session, prompt: "next", ...extra });
/** What a UserPromptSubmit's stdout hands the model, "" when it printed nothing. */
const context = (r: { out: string }): string => {
  if (r.out === "") return "";
  const o = (JSON.parse(r.out) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } }).hookSpecificOutput;
  assert.equal(o?.hookEventName, "UserPromptSubmit", "the output names its event");
  return o?.additionalContext ?? "";
};

test("W-508-b3 behaviour 3: at the session's next prompt the model is handed the reading", async () => {
  const h = home(FULL);
  const next = await hook(h, prompt());
  assert.equal(next.code, 0, "a prompt is not blocked");
  assert.match(context(next), /context 208k of 300k/, "the model is named the count and the limit");
  assert.ok(context(next).includes(LINE), "the reading reaches the model before it writes");
  assert.match(context(next), /need not carry it/, "the model is told a reply need not carry the reading");
  assert.ok(context(await hook(h, prompt())).includes(LINE), "the reading reaches every prompt");
  assert.equal((await hook(home({}), prompt())).out, "", "no source: nothing is added");
  const sub = await hook(h, prompt("s1", { agent_id: "a1" }));
  assert.equal(sub.out, "", "an input with agent_id gets nothing");
  const malformed = home(FULL);
  const wrongAgent = await hook(malformed, prompt("s1", { agent_id: 7 }));
  assert.equal(wrongAgent.code, 0, "a wrong-typed agent_id at a prompt: not blocked");
  assert.equal(wrongAgent.out, "", "a wrong-typed agent_id at a prompt gets nothing");
  assert.equal((await hook(malformed, prompt("s1", { agent_id: "" }))).out, "", "an empty agent_id at a prompt gets nothing");
  const outside = await hook(malformed, prompt("../../x"));
  assert.equal(outside.code, 0, "an out-of-domain session_id: not blocked");
  assert.equal(outside.out, "", "an out-of-domain session_id gets nothing");
  assert.equal((await hook(malformed, prompt("x".repeat(129)))).out, "", "a 129-character session_id gets nothing");
  assert.equal((await hook(malformed, prompt(7))).out, "", "a wrong-typed session_id gets nothing");
  assert.equal((await hook(malformed, { hook_event_name: "UserPromptSubmit", prompt: "next" })).out, "", "no session_id gets nothing");
  assert.ok(context(await hook(malformed, prompt("x".repeat(128)))).includes(LINE), "a 128-character session_id gets the reading");
});

/** A studio and a repo whose .claude/settings.json is `settings`; the hook.guard findings. */
function hookGuard(settings: string): { message: string; level: string }[] {
  const t = tmp();
  const studio = join(t, "studio");
  const now = new Date("2026-11-05T12:00:00Z");
  assert.ok(initStudio(studio, { now }).root);
  mkdirSync(join(t, ".claude"));
  writeFileSync(join(t, ".claude", "settings.json"), settings);
  return checkStudio(studio, now, { repo: t }).findings.filter((f) => f.rule === "hook.guard");
}

test("W-508-b4 behaviour 4: the repo wires the guard at UserPromptSubmit, check blocks hook.guard when it is not wired, and CLAUDE.md says a reply is never sent back", () => {
  const text = readFileSync(join(REPO, ".claude", "settings.json"), "utf8");
  const settings = JSON.parse(text) as { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[]> };
  const unwired = structuredClone(settings);
  delete unwired.hooks["UserPromptSubmit"];
  const f = hookGuard(JSON.stringify(unwired));
  assert.equal(f.length, 1, "no UserPromptSubmit group: one block");
  assert.match(f[0]?.message ?? "", /the guard is not wired: UserPromptSubmit -> bisellium hook-event guard --studio studio \(type command, timeout 2\)/, "the block names the UserPromptSubmit group");
  assert.deepEqual(hookGuard(text), [], "the repo's own settings wire the guard at UserPromptSubmit");
  assert.deepEqual(settings.hooks["UserPromptSubmit"]?.flatMap((g) => g.hooks), [{ type: "command", command: "bisellium hook-event guard --studio studio", timeout: 2 }], "the UserPromptSubmit group runs the guard, timeout 2");
  const slow = structuredClone(settings);
  slow.hooks["UserPromptSubmit"]![0]!.hooks[0]!.timeout = 5;
  assert.equal(hookGuard(JSON.stringify(slow)).length, 1, "a UserPromptSubmit hook timeout other than 2 blocks");
  const claude = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
  assert.match(claude, /Stop never sends a reply back/, "CLAUDE.md says a reply is never sent back");
  assert.doesNotMatch(claude, /sends the main thread's reply back/, "CLAUDE.md no longer says it is");
});

test("W-508-b5 behaviour 5: the length rule is gone: a reply of any length shows the reading alone, leaves no record and names no count to the Patron or the model", async () => {
  const h = home(FULL);
  const long = await hook(h, stop(words(201)));
  assert.equal(shown(long), LINE, "a 201-word reply shows the reading alone");
  assert.equal(shown(await hook(h, stop(words(5000)))), LINE, "a 5000-word reply shows the reading alone");
  assert.equal(existsSync(join(USAGE(h), "reply-notes")), false, "a long reply leaves no record");
  assert.doesNotMatch(context(await hook(h, prompt())), /words|over 200|resend/, "the next prompt names no count of a reply");
  assert.equal((await hook(home({}), stop(words(201)))).out, "", "no source: a long reply shows nothing");
  const guard = (await import("./guard.js")) as Record<string, unknown>;
  assert.deepEqual(["STOP_RULES", "REPLY_WORDS", "replyWords"].filter((name) => name in guard), [], "the guard holds no reply rule table and no word count");
  const claude = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
  assert.doesNotMatch(claude, /over 200 words/, "CLAUDE.md names no word limit");
  assert.equal(existsSync(join(REPO, "packages", "cli", "src", "reply-note.ts")), false, "the note store is gone");
});
