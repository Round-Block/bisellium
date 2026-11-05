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
