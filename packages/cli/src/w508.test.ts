/**
 * W-508 rows (studio/briefs/W-508.md): a shown reply is never sent back. The guard `bisellium hook-event guard` at Stop exits 0
 * whatever the reply holds, shows the Patron the reading and records what a reply rule finds; at UserPromptSubmit it names that
 * to the model, with the reading. node:test TAP, selected by `--test-name-pattern='^W-508-b<n>\s'`. Rows b1 to b3 feed hook
 * inputs to `runHookEvent` with HOME set to a fixture home under the OS tmp dir (its status-line file and Codex log); b4 checks a
 * fixture repo's settings and reads the real `.claude/settings.json` and `CLAUDE.md`. Nothing reads or writes the real home or `studio/`.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runHookEvent } from "./hooks.js";

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
const notePath = (h: string, session = "s1"): string => join(USAGE(h), "reply-notes", session);

test("W-508-b1 behaviour 1: a Stop never sends a main-thread reply back; a reply over 200 words is recorded for the session's next turn and the Patron is told", async () => {
  const h = home(FULL);
  const over = await hook(h, stop(words(201)));
  assert.equal(over.code, 0, "a 201-word reply: not refused");
  assert.equal(over.err, "", "nothing on stderr for Claude Code to feed back");
  assert.match(readFileSync(notePath(h), "utf8"), /this reply is 201 words, over 200 \(W-444\)/, "the note names the count and the limit");
  assert.match(shown(over), /this reply is 201 words, over 200 \(W-444\).*named to the model on its next turn/, "the Patron is told, in the hook's own line");
  assert.equal((await hook(h, stop(words(400)))).code, 0, "a 400-word reply: not refused");
  assert.match(readFileSync(notePath(h), "utf8"), /this reply is 400 words/, "a later over-long reply replaces the note");
  assert.equal((await hook(h, stop(words(200)))).code, 0, "200 words: exits 0");
  assert.match(readFileSync(notePath(h), "utf8"), /this reply is 400 words/, "a reply in bounds leaves the note");
  const fresh = home(FULL);
  await hook(fresh, stop(words(200)));
  assert.equal(existsSync(notePath(fresh)), false, "200 words: no note");
  const escaped = home(FULL);
  const bad = await hook(escaped, stop(words(201), { session_id: "../../../x" }));
  assert.equal(bad.code, 0, "a session id the store does not take: not refused");
  assert.match(shown(bad), /not recorded/, "a session id the store does not take: the Patron is told");
  assert.deepEqual(readdirSync(escaped).sort(), [".bisellium-evidence", ".codex"], "a session id the store does not take: no file escapes");
  const planted = home(FULL);
  mkdirSync(join(USAGE(planted), "reply-notes"));
  const victim = join(planted, "victim");
  writeFileSync(victim, "untouched");
  symlinkSync(victim, join(USAGE(planted), "reply-notes", `.s1.${process.pid}`));
  const trap = await hook(planted, stop(words(201)));
  assert.equal(readFileSync(victim, "utf8"), "untouched", "a symlink at the temp path is not followed");
  assert.equal(trap.code, 0, "a symlink at the temp path: not refused");
  assert.match(shown(trap), /not recorded/, "a symlink at the temp path: the Patron is told");
  const replaced = home(FULL);
  mkdirSync(join(USAGE(replaced), "reply-notes"));
  const kept = join(replaced, "kept");
  writeFileSync(kept, "untouched");
  symlinkSync(kept, notePath(replaced));
  await hook(replaced, stop(words(201)));
  assert.equal(readFileSync(kept, "utf8"), "untouched", "a symlink at the note's path is replaced, not followed");
  const blocked = home(FULL);
  writeFileSync(join(USAGE(blocked), "reply-notes"), "a file in the way");
  const stuck = await hook(blocked, stop(words(201)));
  assert.equal(stuck.code, 0, "a note that cannot be written: not refused");
  assert.match(shown(stuck), /not recorded/, "a note that cannot be written: the Patron is told");
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
  const both = shown(await hook(h, stop(words(201))));
  assert.equal(both.split("\n")[0], LINE, "over the limit: the reading first");
  assert.match(both.split("\n")[1] ?? "", /this reply is 201 words/, "over the limit: the note's line second");
  assert.equal((await hook(h, stop(words(20), { stop_hook_active: true }))).out, "", "a continuation shows nothing");
  assert.equal((await hook(h, stop(words(20), { agent_id: "a1" }))).out, "", "a subagent's Stop shows nothing");
  assert.equal((await hook(h, stop(undefined))).out, "", "a Stop with no reply text shows nothing");
  const sub = { hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "builder", agent_transcript_path: join(h, "none.jsonl"), stop_hook_active: false, background_tasks: [], last_assistant_message: words(400) };
  assert.equal((await hook(h, sub)).out, "", "a SubagentStop shows nothing");
  const malformed = home(FULL);
  const wrongAgent = await hook(malformed, stop(words(201), { agent_id: 7 }));
  assert.equal(wrongAgent.code, 0, "a wrong-typed agent_id: not refused");
  assert.equal(wrongAgent.out, "", "a wrong-typed agent_id shows nothing");
  assert.equal(existsSync(notePath(malformed)), false, "a wrong-typed agent_id records nothing");
  assert.equal((await hook(malformed, stop(words(201), { agent_id: "" }))).out, "", "an empty agent_id shows nothing");
  assert.equal((await hook(malformed, stop(words(201), { agent_id: null }))).out, "", "a null agent_id shows nothing");
  const wrongActive = await hook(malformed, stop(words(201), { stop_hook_active: "false" }));
  assert.equal(wrongActive.code, 0, "a wrong-typed stop_hook_active: not refused");
  assert.equal(wrongActive.out, "", "a wrong-typed stop_hook_active shows nothing");
  const noActive = stop(words(201));
  delete noActive["stop_hook_active"];
  assert.equal((await hook(malformed, noActive)).out, "", "no stop_hook_active shows nothing");
  assert.equal(existsSync(notePath(malformed)), false, "a malformed discriminator records nothing");
});
