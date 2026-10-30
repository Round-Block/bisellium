/**
 * W-444 rows (studio/briefs/W-444.md): the Stop rules the guard `bisellium hook-event guard` judges a main-thread final
 * reply by, and their wiring. node:test TAP, selected by `--test-name-pattern='^W-444-b<n>\s'`. Rows b1 and b2 feed Stop
 * inputs to `runHookEvent` with HOME set to a fixture home under the OS tmp dir (its usage readings file); b3 checks a
 * fixture repo's settings and reads the real `.claude/settings.json`. Nothing reads or writes the real home or `studio/`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runHookEvent } from "./hooks.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w444-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** One readings-file line in `usage-reading.sh`'s shape, taken `agoMs` before now. */
const reading = (agoMs: number, v: { cw: number | null; c5: number | null; xw: number | null; ctx?: number | null }): string =>
  JSON.stringify({
    at: new Date(Date.now() - agoMs).toISOString(),
    label: "lanes",
    codex_week_used: v.xw,
    codex_resets: 1793774557,
    codex_from: "rollout-x.jsonl",
    claude_5h_used: v.c5,
    claude_week_used: v.cw,
    claude_seen: new Date(Date.now() - agoMs).toISOString(),
    ...(v.ctx === undefined ? {} : { context_tokens: v.ctx }),
  });
/** A home whose readings file holds `lines` (no readings file when undefined). */
function home(lines: string[] | undefined): string {
  const h = tmp();
  if (lines !== undefined) {
    mkdirSync(join(h, ".bisellium-evidence", "usage"), { recursive: true });
    writeFileSync(join(h, ".bisellium-evidence", "usage", "readings.jsonl"), `${lines.join("\n")}\n`);
  }
  return h;
}
const LATEST = { cw: 19, c5: 16, xw: 39, ctx: 208732 };
/** The latest reading's four parts, as the reply carries them: 12 words. */
const LINE = "Claude week 19%, 5h 16% | Codex week 39% | context 208k of 300k";
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
/** The guard on one Stop input, HOME set to `h`: its exit code and stderr. */
async function stop(h: string, input: Record<string, unknown>): Promise<{ code: number; err: string }> {
  const err: string[] = [];
  const error = console.error;
  const saved = process.env["HOME"];
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  process.env["HOME"] = h;
  try {
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    return { code: r.exitCode, err: err.join("\n") };
  } finally {
    console.error = error;
    if (saved === undefined) delete process.env["HOME"];
    else process.env["HOME"] = saved;
  }
}
const main = (reply: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  hook_event_name: "Stop",
  session_id: "s1",
  stop_hook_active: false,
  ...(reply === undefined ? {} : { last_assistant_message: reply }),
  ...extra,
});

test("W-444-b1 behaviour 1: a main-thread reply over 200 words is sent back once; a subagent's, a continuation and a Stop with no reply are not judged", async () => {
  const h = home([reading(60_000, LATEST)]);
  const over = await stop(h, main(`${words(189)}\n${LINE}`));
  assert.equal(over.code, 2, "a 201-word main-thread reply: refused");
  assert.match(over.err, /this reply is 201 words, over 200 \(W-444\)/, "the refusal names the count and the limit");
  assert.equal((await stop(h, main(`${words(188)}\n${LINE}`))).code, 0, "200 words: passes");
  const block = `${words(120)}\n${LINE}\n\`\`\`\n${words(69)}\n\`\`\``;
  assert.equal((await stop(h, main(block))).code, 2, "code blocks count");
  assert.equal((await stop(h, main(`${words(188)}\n- | -- * > ---\n${LINE}`))).code, 0, "a bare - or | is not a word");
  assert.equal((await stop(h, main(`${words(189)}\n${LINE}`, { stop_hook_active: true }))).code, 0, "sent back once only: a continuation is not judged");
  assert.equal((await stop(h, main(`${words(189)}\n${LINE}`, { agent_id: "a1", agent_type: "builder" }))).code, 0, "a Stop with agent_id is not judged");
  const sub = { hook_event_name: "SubagentStop", agent_id: "a1", agent_type: "builder", agent_transcript_path: join(h, "none.jsonl"), stop_hook_active: false, background_tasks: [], last_assistant_message: words(400) };
  assert.equal((await stop(h, sub)).code, 0, "a subagent's final message is not judged");
  assert.equal((await stop(h, main(undefined))).code, 0, "no reply text: not judged");
});
