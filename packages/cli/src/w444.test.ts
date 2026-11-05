/**
 * W-444 rows (studio/briefs/W-444.md, flipped by studio/briefs/W-508.md): the rule the guard `bisellium hook-event guard`
 * judges a main-thread final reply by at Stop, and its wiring. A reply is never sent back (W-508): what the rule finds is left
 * as a note for the session's next turn. node:test TAP, selected by `--test-name-pattern='^W-444-b<n>\s'`. Rows b1 and b2 feed
 * Stop inputs to `runHookEvent` with HOME set to a fixture home under the OS tmp dir; b3 checks a fixture repo's settings and
 * reads the real `.claude/settings.json`. Nothing reads or writes the real home or `studio/`.
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
/** The guard on one Stop input, HOME set to `h`: its exit code and stderr; what the hook prints on stdout is W-508-b2's and stays out of the TAP stream. */
async function stop(h: string, input: Record<string, unknown>): Promise<{ code: number; err: string }> {
  const err: string[] = [];
  const { log, error } = console;
  const saved = process.env["HOME"];
  console.log = () => undefined;
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  process.env["HOME"] = h;
  try {
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    return { code: r.exitCode, err: err.join("\n") };
  } finally {
    console.log = log;
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

/** The note the Stop left for session s1 (W-508), removed so the next case starts clean; undefined when none. */
function noted(h: string): string | undefined {
  const p = join(h, ".bisellium-evidence", "usage", "reply-notes", "s1");
  if (!existsSync(p)) return undefined;
  const text = readFileSync(p, "utf8");
  rmSync(p);
  return text;
}

test("W-444-b1 behaviour 1: a main-thread reply over 200 words is recorded and never sent back (W-508); a subagent's, a continuation and a Stop with no reply are not judged", async () => {
  const h = home([reading(60_000, LATEST)]);
  const over = await stop(h, main(`${words(189)}\n${LINE}`));
  assert.equal(over.code, 0, "a 201-word main-thread reply: not refused (W-508)");
  assert.match(noted(h) ?? "", /this reply is 201 words, over 200 \(W-444\)/, "the note names the count and the limit");
  assert.equal((await stop(h, main(`${words(188)}\n${LINE}`))).code, 0, "200 words: exits 0");
  assert.equal(noted(h), undefined, "200 words: no note");
  const block = `${words(120)}\n${LINE}\n\`\`\`\n${words(69)}\n\`\`\``;
  assert.equal((await stop(h, main(block))).code, 0, "a code block: exits 0");
  assert.match(noted(h) ?? "", /this reply is 201 words/, "code blocks count");
  assert.equal((await stop(h, main(`${words(188)}\n- | -- * > ---\n${LINE}`))).code, 0, "a bare - or |: exits 0");
  assert.equal(noted(h), undefined, "a bare - or | is not a word");
  await stop(h, main(`${words(189)}\n${LINE}`, { stop_hook_active: true }));
  assert.equal(noted(h), undefined, "a continuation is not judged");
  await stop(h, main(`${words(189)}\n${LINE}`, { agent_id: "a1", agent_type: "builder" }));
  assert.equal(noted(h), undefined, "a Stop with agent_id is not judged");
  const sub = { hook_event_name: "SubagentStop", session_id: "s1", agent_id: "a1", agent_type: "builder", agent_transcript_path: join(h, "none.jsonl"), stop_hook_active: false, background_tasks: [], last_assistant_message: words(400) };
  assert.equal((await stop(h, sub)).code, 0, "a subagent's final message: exits 0");
  assert.equal(noted(h), undefined, "a subagent's final message is not judged");
  assert.equal((await stop(h, main(undefined))).code, 0, "no reply text: exits 0");
  assert.equal(noted(h), undefined, "no reply text: not judged");
});

test("W-444-b2 behaviour 2: a main-thread reply is not judged for a usage reading: the hook shows the reading itself (W-508-b2)", async () => {
  const h = home([reading(20 * 60_000, { cw: 18, c5: 12, xw: 38, ctx: 150000 }), "", reading(60_000, LATEST)]);
  const replies: [string, string][] = [
    ["no usage reading", words(20)],
    ["the latest reading's line", `${words(20)}\n${LINE}`],
    ["an older reading's values", `${words(20)}\nClaude week 18%, 5h 12% | Codex week 38% | context 150k of 300k`],
    ["one value off", `${words(20)}\nClaude week 19%, 5h 16% | Codex week 39% | context 207k of 300k`],
    ["the four parts over two lines", `${words(20)}\nClaude week 19%, 5h 16%\nCodex week 39% | context 208k of 300k`],
  ];
  for (const [name, reply] of replies) {
    const r = await stop(h, main(reply));
    assert.equal(r.code, 0, `${name}: not refused`);
    assert.equal(noted(h), undefined, `${name}: no note`);
  }
  const old = home([reading(31 * 60_000, LATEST)]);
  assert.equal((await stop(old, main(words(20)))).code, 0, "a reading 31 minutes old: not refused");
  assert.equal((await stop(home(undefined), main(words(20)))).code, 0, "no readings file: not refused");
  const unreadable = tmp();
  mkdirSync(join(unreadable, ".bisellium-evidence", "usage", "readings.jsonl"), { recursive: true });
  assert.equal((await stop(unreadable, main(words(20)))).code, 0, "an unreadable readings file: not refused");
  const both = await stop(h, main(words(201)));
  assert.equal(both.code, 0, "over the limit and without the reading: not refused");
  assert.equal(noted(h)?.split("\n").length, 1, "the length note alone: one line");
  const guard = (await import("./guard.js")) as Record<string, unknown>;
  assert.ok(Array.isArray(guard["STOP_RULES"]) && (guard["STOP_RULES"] as unknown[]).length === 1, "STOP_RULES holds the one reply rule");
});

/** A studio and a repo whose .claude/settings.json is `settings`; the hook.guard findings. */
function hookGuard(settings: string): { message: string; level: string }[] {
  const t = tmp();
  const studio = join(t, "studio");
  const now = new Date("2026-10-30T12:00:00Z");
  assert.ok(initStudio(studio, { now }).root);
  mkdirSync(join(t, ".claude"));
  writeFileSync(join(t, ".claude", "settings.json"), settings);
  return checkStudio(studio, now, { repo: t }).findings.filter((f) => f.rule === "hook.guard");
}

test("W-444-b3 behaviour 3: the repo wires the guard at Stop, and check blocks hook.guard when it is not wired", () => {
  const text = readFileSync(join(REPO, ".claude", "settings.json"), "utf8");
  const settings = JSON.parse(text) as { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[]> };
  const unwired = structuredClone(settings);
  delete unwired.hooks["Stop"];
  const f = hookGuard(JSON.stringify(unwired));
  assert.equal(f.length, 1, "no Stop group: one block");
  assert.match(f[0]?.message ?? "", /the guard is not wired: Stop -> bisellium hook-event guard --studio studio \(type command, timeout 2\)/, "the block names the Stop group");
  assert.deepEqual(hookGuard(text), [], "the repo's own settings wire the guard at Stop");
  assert.deepEqual(settings.hooks["Stop"]?.flatMap((g) => g.hooks), [{ type: "command", command: "bisellium hook-event guard --studio studio", timeout: 2 }], "the Stop group runs the guard, timeout 2");
  const slow = structuredClone(settings);
  slow.hooks["Stop"]![0]!.hooks[0]!.timeout = 5;
  assert.equal(hookGuard(JSON.stringify(slow)).length, 1, "a Stop hook timeout other than 2 blocks");
});
