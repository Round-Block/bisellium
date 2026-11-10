/**
 * W-571: a Codex verdict from a blind session is refused. A sessioned verdict whose model the manifest seats on the codex
 * harness is recorded only when the session's rollout (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*-<session>.jsonl`) shows
 * its last turn ran a command to exit 0. The rollouts here are shaped from the real ones the spec read
 * (~/.bisellium-evidence/W-562-spec/signal.out): W-558 spec review round 4 (0.167.0, a resumed session whose last turn made
 * shell calls and ran no command) and the 0.153.4 pin smoke.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runVerdict } from "./verdict.js";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const MODEL = "gpt-5.6-sol";
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const temp = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `bisellium-w571-${tag}-`));
  roots.push(d);
  return d;
};

function studio(): string {
  const root = temp("studio");
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-571 verdict",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: qa-lead, collegium: engineering, kind: agent }",
      `  - { id: spec-reviewer, collegium: engineering, kind: agent, model: ${MODEL}, harness: codex }`,
      "probationes:",
      "  - { id: review, name: Review, kind: agent }",
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(root, "opera"));
  writeFileSync(join(root, "opera", "W-300.md"), "---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: engineering\nstate: building\nprobationes: {}\n---\n");
  return root;
}

type Cmd = { exit: number; status?: string };
/** One rollout line per event, in the shapes Codex 0.153.4 and 0.167.0 write. Each turn: its start, a user message, then per
 *  command a shell call and (when it spawned) its CommandExecution item; a call with `null` never spawned (0.167.0's failure). */
function rollout(session: string, turns: (Cmd | null)[][], quote = ""): string {
  const lines: unknown[] = [{ type: "session_meta", payload: { id: session, cli_version: "0.153.4", cwd: "/repo", originator: "codex_exec" } }];
  turns.forEach((cmds, t) => {
    const turn = `${session}-turn-${t + 1}`;
    lines.push({ type: "event_msg", payload: { type: "task_started", turn_id: turn } });
    // the prompt may quote a command event and the sandbox error: data, never a signal
    lines.push({ type: "event_msg", payload: { type: "item_completed", turn_id: turn, item: { type: "UserMessage", content: [{ type: "text", text: `Review it. ${quote}` }] } } });
    cmds.forEach((c, i) => {
      lines.push({ type: "response_item", payload: { type: "custom_tool_call", name: "exec", status: "completed", call_id: `c${t}-${i}`, input: "tools.exec_command({cmd:\"ls\"})" } });
      if (c === null) {
        lines.push({ type: "response_item", payload: { type: "custom_tool_call_output", call_id: `c${t}-${i}`, output: [{ type: "input_text", text: "{\"exit_code\":1,\"output\":\"error building bubblewrap command: Read-only file system (os error 30)\"}" }] } });
        return;
      }
      lines.push({ type: "event_msg", payload: { type: "item_completed", turn_id: turn, item: { type: "CommandExecution", command: ["/usr/bin/zsh", "-lc", "ls"], cwd: "file:///repo", status: c.status ?? "completed", exit_code: c.exit } } });
    });
    lines.push({ type: "event_msg", payload: { type: "task_complete", turn_id: turn } });
  });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}
function codexHome(files: Record<string, string>): string {
  const home = temp("codex");
  const day = join(home, "sessions", "2026", "11", "09");
  mkdirSync(day, { recursive: true });
  for (const [session, text] of Object.entries(files)) writeFileSync(join(day, `rollout-2026-11-09T22-28-00-${session}.jsonl`), text);
  return home;
}

/** `verdict` in process, with CODEX_HOME set for the call; returns its exit, stderr and the logs under ci/. */
function verdict(home: string | undefined, extra: string[]): { exitCode: number; stderr: string; ci: string[] } {
  const dir = studio();
  const input = join(dir, "input.md");
  writeFileSync(input, "## Findings\nNo findings\n");
  let stderr = "";
  const [oldError, oldLog, oldHome] = [console.error, console.log, process.env["CODEX_HOME"]];
  console.error = (...args: unknown[]) => {
    stderr += `${args.map(String).join(" ")}\n`;
  };
  console.log = () => {};
  if (home === undefined) delete process.env["CODEX_HOME"];
  else process.env["CODEX_HOME"] = home;
  try {
    const r = runVerdict(["W-300", "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--phase", "handoff", "--from", input, "--studio", dir, ...extra], { now: NOW });
    return { exitCode: r.exitCode, stderr, ci: existsSync(join(dir, "ci")) ? readdirSync(join(dir, "ci")).sort() : [] };
  } finally {
    console.error = oldError;
    console.log = oldLog;
    if (oldHome === undefined) delete process.env["CODEX_HOME"];
    else process.env["CODEX_HOME"] = oldHome;
  }
}

const QUOTE = 'the last run said {"type":"CommandExecution","status":"completed","exit_code":0} and Read-only file system (os error 30)';
const RAN = "s-562-ran";
const BLIND = "s-562-r4";

test("W-571-b2 behaviour 2: a sessioned Codex verdict whose last turn ran no command is refused and writes nothing", () => {
  // W-558 spec round 4's shape: turn 1 (round 2) ran commands, turn 2 (round 4, 0.167.0) made shell calls that never spawned
  const home = codexHome({ [BLIND]: rollout(BLIND, [[{ exit: 0 }, { exit: 0 }], [null, null, null]], QUOTE) });
  const blind = verdict(home, ["--model", MODEL, "--session", BLIND]);
  assert.equal(blind.exitCode, 2, "a blind session's verdict is refused");
  assert.equal(blind.stderr, `W-300: refusing: Codex session ${BLIND} failed to run: it ran no command to exit code 0 in its last turn ${BLIND}-turn-2 (its shell failed or it ran none); a verdict from a blind session is never recorded\n`, "the refusal names failed to run and the turn");
  assert.deepEqual(blind.ci, [], "nothing is written");
});

test("W-571-b2 behaviour 2: a verdict from a turn that ran a command is recorded, and a prompt quote is never a run", () => {
  const home = codexHome({
    [RAN]: rollout(RAN, [[{ exit: 0 }, { exit: 1 }]]),
    "s-562-quote": rollout("s-562-quote", [[]], QUOTE),
    "s-562-exit": rollout("s-562-exit", [[{ exit: 1 }, { exit: 127, status: "failed" }]]),
  });
  const ok = verdict(home, ["--model", MODEL, "--session", RAN]);
  assert.equal(ok.exitCode, 0, `a session that ran a command is recorded: ${ok.stderr}`);
  assert.deepEqual(ok.ci, ["W-300-handoff-1.log"]);
  const quoted = verdict(home, ["--model", MODEL, "--session", "s-562-quote"]);
  assert.equal(quoted.exitCode, 2, "a turn whose only command event is quoted in the prompt ran nothing");
  assert.deepEqual(quoted.ci, []);
  const failing = verdict(home, ["--model", MODEL, "--session", "s-562-exit"]);
  assert.equal(failing.exitCode, 2, "a turn whose every command exited non-zero ran nothing");
});

test("W-571-b2 behaviour 2: a missing, duplicated or malformed rollout is refused, and a model off the codex harness is not judged", () => {
  const home = codexHome({ "s-562-bad": "{\"type\":\"session_meta\"}\nnot json\n" });
  const missing = verdict(home, ["--model", MODEL, "--session", "s-562-none"]);
  assert.equal(missing.exitCode, 2, "no rollout is refused");
  assert.match(missing.stderr, /failed to run: no rollout file\(s\) for session s-562-none under /);
  const bad = verdict(home, ["--model", MODEL, "--session", "s-562-bad"]);
  assert.equal(bad.exitCode, 2, "a malformed rollout is refused");
  assert.match(bad.stderr, /failed to run: the rollout's line 2 is not JSON/);
  const twice = codexHome({ [RAN]: rollout(RAN, [[{ exit: 0 }]]) });
  mkdirSync(join(twice, "sessions", "2026", "11", "10"), { recursive: true });
  writeFileSync(join(twice, "sessions", "2026", "11", "10", `rollout-2026-11-10T01-00-00-${RAN}.jsonl`), rollout(RAN, [[{ exit: 0 }]]));
  assert.equal(verdict(twice, ["--model", MODEL, "--session", RAN]).exitCode, 2, "two rollouts of one session are refused");
  const claude = verdict(home, ["--model", "claude-opus-5-5", "--session", "s-562-none"]);
  assert.equal(claude.exitCode, 0, `a model off the codex harness is not judged: ${claude.stderr}`);
  const unsessioned = verdict(home, ["--model", MODEL]);
  assert.equal(unsessioned.exitCode, 0, `a Codex-model verdict without --session is not judged (a stated limit): ${unsessioned.stderr}`);
});
