/**
 * W-310 rows b1-b6 (studio/briefs/W-310.md): the guard `bisellium hook-event guard`, its wiring and
 * its probe. node:test TAP, selected by `--test-name-pattern='^W-310-b<n>\s'`. Rows b1-b4 feed hook
 * inputs to `runHookEvent`; b5 checks a fixture repo and reads the real `.claude/`; b6 runs
 * `hooks check --repo` with PATH pointing at a `bisellium` it chose. Fixtures live under the OS tmp dir.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runHookEvent, runHooks } from "./hooks.js";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-10-22T12:00:00Z");
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w310-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Runs `console.*` writes into arrays while `fn` runs. */
async function capture<T>(fn: () => Promise<T> | T): Promise<{ value: T; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    const value = await fn();
    return { value, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}
/** The guard on one hook input (a string is sent as is): its exit code and stderr. */
async function guard(input: unknown): Promise<{ code: number; err: string }> {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  const r = await capture(() => runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([text]), stdinTimeoutMs: 1000 }));
  return { code: r.value.exitCode, err: r.err };
}
const bash = (command: string, extra: Record<string, unknown> = {}, bg = false) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command, ...(bg ? { run_in_background: true } : {}) },
  cwd: "/tmp",
  ...extra,
});
const RUNNER = { agent_id: "a1b2c3", agent_type: "ladder-runner" };

test("W-310-b1 behaviour 1: the guard refuses the hand ladder record writes, the build review's included, from the main thread only, direct, through next's perform, or in a script the command runs", async () => {
  const refused = [
    "bisellium merge W-900 --studio studio --repo .",
    "npm run -s bisellium -- branch W-900 --studio studio --repo .",
    "cd /home/u/agents/bisellium && npm run --silent bisellium -- ready W-900 --studio studio",
    "node packages/cli/bin/bisellium.mjs done W-900 --studio studio",
    "node --import tsx packages/cli/src/main.ts merge W-900 --studio studio --repo .",
    "npx bisellium done W-900",
    "/home/u/.local/bin/bisellium branch W-900 --studio studio",
    "FOO=1 timeout 600 bisellium merge W-900 --studio studio --repo .",
    "bash -c 'npm run -s bisellium -- merge W-900 --studio studio --repo .'",
    "npm run -s bisellium -- verdict W-900 --round 1 --sella architect --outcome passed --phase spec --from /tmp/s.md --studio studio",
    "x=$(bisellium done W-900 --studio studio)",
    '"/home/u/my bin/bisellium" merge W-900',
    "'/home/u/it'\\''s/bisellium' merge W-900",
    "/home/ü/bin/bisellium ready W-900",
    "env -u NAME bisellium merge W-900",
    "nice -n 10 bisellium done W-900",
    "npx --package bisellium bisellium branch W-900",
    "npx -c 'bisellium merge W-900'",
    "echo W-900 | xargs -n 1 bisellium ready",
    "npm run -s bisellium -- next W-900 --perform --expect branch --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --expect=merge --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --expect done --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --expect ready --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --expect spec --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --studio studio --repo .",
    "npm run -s bisellium -- verdict W-900 --round 1 --sella censor --outcome passed --phase build --from /tmp/r.md --studio studio",
    "npm run -s bisellium -- verdict W-900 --round 1 --sella qa-lead --outcome passed --model gpt-5.6-sol --from /tmp/r.md --studio .worktrees/W-900/studio",
    "npm run -s bisellium -- verdict W-900 --round 2 --sella qa-lead --model gpt-5.6-sol --outcome failed --phase=spec --from /tmp/r.md --studio studio",
    "npm run -s bisellium -- review W-900 --pass --evidence ci/W-900-review-1.log --round 1 --sella qa-lead --model gpt-5.6-sol --studio .worktrees/W-900/studio",
    "npm run -s bisellium -- next W-900 --perform --expect review --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --chain --budget 400000 --studio studio --repo .",
    "npm run -s bisellium -- verdict W-900 --round 1 --sella qa-lead --outcome passed --phase handoff --phase build --from /tmp/r.md --studio studio",
  ];
  for (const c of refused) {
    const r = await guard(bash(c));
    assert.equal(r.code, 2, `main thread refused: ${c}`);
    assert.match(r.err, /ladder record write, run only by a dispatched ladder-runner/, c);
  }
  assert.match((await guard(bash("bisellium merge W-900"))).err, /`merge`/, "the refusal names the verb");
  assert.match((await guard(bash(refused[9]!))).err, /`verdict --phase spec`/, "the refusal names the spec verdict");
  assert.match((await guard(bash(refused[19]!))).err, /`next --perform --expect branch`/, "the refusal names the perform's step");
  assert.match((await guard(bash(refused[24]!))).err, /`next --perform without --expect`/, "a perform with no named step is refused");
  assert.match((await guard(bash(refused[25]!))).err, /`verdict --phase build`/, "the refusal names the build verdict");
  assert.match((await guard(bash(refused[26]!))).err, /`verdict --phase build`/, "a verdict with no --phase is a build verdict");
  assert.match((await guard(bash(refused[27]!))).err, /`verdict --phase spec`/, "a spec reviewer's verdict is a spec verdict");
  assert.match((await guard(bash(refused[28]!))).err, /`review`/, "the refusal names the review");
  assert.match((await guard(bash(refused[29]!))).err, /`next --perform --expect review`/, "the review perform is refused");
  assert.match((await guard(bash(refused[30]!))).err, /`next --perform --chain`/, "the chain is refused");
  assert.match((await guard(bash(refused[31]!))).err, /`verdict --phase build`/, "the last --phase counts");
  const allowed = [
    "npm run -s bisellium -- verdict W-900 --round 1 --sella producer --outcome passed --phase handoff --studio studio",
    "npm run -s bisellium -- next W-900 --budget 400000 --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --expect review --studio studio --repo .",
    "npm run -s bisellium -- red W-900 --behaviour 1 --sella builder --studio studio -- node --test x",
    'git commit -m "chore: bisellium merge W-900"',
    "echo bisellium done W-900",
    'grep -rn "npm run -s bisellium -- merge" docs',
    "git merge origin/master",
    "npm run -s bisellium -- next W-900 --perform --expect reds --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --expect cleanup --studio studio --repo .",
    "npm run -s bisellium -- next W-900 --perform --expect pr --title t --body-file /tmp/b.md --studio studio --repo .",
    "# bisellium merge W-900",
    "command -v bisellium",
  ];
  for (const c of allowed) assert.equal((await guard(bash(c))).code, 0, `main thread allowed: ${c}`);
  for (const c of refused) assert.equal((await guard(bash(c, RUNNER))).code, 0, `a subagent runs it: ${c}`);
  assert.equal((await guard(bash("bisellium merge W-900", { agent_id: "x9", agent_type: "architect" }))).code, 0, "any subagent: not the main thread");
  assert.equal((await guard(bash("bisellium merge W-900", { agent_type: "ladder-runner" }))).code, 2, "agent_type without agent_id is the main thread (--agent)");
  // scripts the command runs are judged by their text
  const t = join(tmp(), "scripts dir ü");
  mkdirSync(join(t, "scripts"), { recursive: true });
  const script = (name: string, text: string): string => {
    writeFileSync(join(t, "scripts", name), text);
    chmodSync(join(t, "scripts", name), 0o755);
    return join(t, "scripts", name);
  };
  script("opus-start.sh", "#!/usr/bin/env bash\nset -eu\nID=$1\nnpm run -s bisellium -- next $ID --perform --expect branch --studio studio --repo . | tail -3\n");
  script("record-review.sh", "#!/usr/bin/env bash\nnpm run -s bisellium -- verdict $1 --round $2 --sella qa-lead --outcome passed --from x --studio s\nnpm run -s bisellium -- review $1 --pass --evidence ci/x.log --studio s\n");
  script("outer.sh", "#!/bin/sh\n# calls the start script\nbash scripts/opus-start.sh W-900\n");
  script("big.sh", `${"# pad\n".repeat(50_000)}bisellium merge W-900\n`);
  writeFileSync(join(t, "scripts", "bin.sh"), "bisellium merge W-900\0\n");
  writeFileSync(join(t, "scripts", "it's.sh"), "bisellium done W-900\n");
  const inT = { cwd: t };
  for (const c of ["bash scripts/opus-start.sh W-900", "bash scripts/record-review.sh W-900 1", "sh -e scripts/opus-start.sh W-900", "./scripts/opus-start.sh W-900", "source scripts/opus-start.sh", ". scripts/opus-start.sh", "bash scripts/outer.sh", `cd /tmp && bash '${join(t, "scripts", "opus-start.sh")}'`, `cd '${t}' && bash scripts/opus-start.sh`, "bash \"scripts/it's.sh\""]) {
    const r = await guard(bash(c, inT));
    assert.equal(r.code, 2, `a script holding a ladder write is refused: ${c}`);
    assert.match(r.err, /\(in /, c);
  }
  for (const c of ["bash scripts/big.sh", "bash scripts/bin.sh", "bash scripts/missing.sh", 'bash "$EV/opus-start.sh"', "cd /tmp && bash scripts/opus-start.sh W-900"])
    assert.equal((await guard(bash(c, inT))).code, 0, `a script that is not judged or holds no ladder write runs: ${c}`);
  const symlinked = join(tmp(), "link");
  symlinkSync(join(t, "scripts"), symlinked);
  assert.equal((await guard(bash(`bash ${join(symlinked, "opus-start.sh")}`))).code, 2, "a script reached through a symlinked parent");
  const home = process.env["HOME"];
  process.env["HOME"] = t;
  try {
    assert.equal((await guard(bash("bash ~/scripts/opus-start.sh W-900"))).code, 2, "a script under ~ is read");
    assert.equal((await guard(bash("bash $HOME/scripts/opus-start.sh W-900"))).code, 2, "a script under $HOME is read");
    // the orchestrator's review recorder, its CLI lines as written in ~/.bisellium-evidence/record-review.sh
    mkdirSync(join(t, ".bisellium-evidence"));
    writeFileSync(
      join(t, ".bisellium-evidence", "record-review.sh"),
      "set -e\ncd ~/agents/bisellium\nnpm run -s bisellium -- next $ID --budget 400000 --studio ~/agents/bisellium/studio --repo ~/agents/bisellium | tail -1\nnpm run -s bisellium -- verdict $ID --round $N --sella qa-lead --outcome $OUT --model gpt-5.6-sol --from $TMPDIR/$ID-r$N.md ${4:+--session $4} --studio .worktrees/$ID/studio | tail -1\nnpm run -s bisellium -- review $ID $F --evidence ci/$ID-review-$N.log --round $N --sella qa-lead --model gpt-5.6-sol --studio .worktrees/$ID/studio | tail -1\n",
    );
    chmodSync(join(t, ".bisellium-evidence", "record-review.sh"), 0o755);
    for (const c of ["~/.bisellium-evidence/record-review.sh W-900 1 passed", "bash ~/.bisellium-evidence/record-review.sh W-900 1 passed s-1"]) {
      const r = await guard(bash(c));
      assert.equal(r.code, 2, `~/.bisellium-evidence/record-review.sh is refused: ${c}`);
      assert.match(r.err, /`verdict --phase build \(in ~\/\.bisellium-evidence\/record-review\.sh\)`/, c);
    }
  } finally {
    process.env["HOME"] = home;
  }
  assert.equal((await guard(bash("bash scripts/opus-start.sh W-900", { ...inT, ...RUNNER }))).code, 0, "a subagent runs the script");
  // the repo's own scripts/record-review.sh, read from this checkout
  const own = await guard(bash("bash scripts/record-review.sh W-900 1 passed", { cwd: REPO }));
  assert.equal(own.code, 2, "scripts/record-review.sh is refused");
  assert.match(own.err, /`verdict --phase build \(in scripts\/record-review\.sh\)`/, "scripts/record-review.sh names the build verdict");
  assert.equal((await guard(bash("bash scripts/record-review.sh W-900 1 passed", { cwd: REPO, ...RUNNER }))).code, 0, "a ladder-runner records the review");
  assert.equal((await guard("not json")).code, 0, "fail-open: an unreadable input");
  assert.equal((await guard({ hook_event_name: "PreToolUse", tool_name: "Bash" })).code, 0, "fail-open: no tool_input");
  assert.equal((await guard({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "bisellium merge W-900" } })).code, 0, "another event");
});

test("W-310-b2 behaviour 2: the guard refuses a background while/until loop with no hard bound", async () => {
  const refused = [
    "until test -s /tmp/x.exit; do sleep 20; done",
    "while true; do sleep 5; done",
    "bash -c 'until [ -f /tmp/x ]; do sleep 1; done'",
    "cd /tmp && while :; do sleep 1; done",
    "timeout 0 bash -c 'while true; do sleep 1; done'",
    "timeout 60 sleep 1; until test -f x; do sleep 1; done",
    'until grep -q done "/tmp/my dir/ü.log"; do sleep 3; done',
  ];
  for (const c of refused) {
    const r = await guard(bash(c, {}, true));
    assert.equal(r.code, 2, `refused: ${c}`);
    assert.match(r.err, /needs a hard bound/, c);
  }
  assert.equal((await guard(bash(refused[0]!, RUNNER, true))).code, 2, "a subagent's background loop is refused too");
  const allowed = [
    "timeout 600 bash -c 'until test -s /tmp/x.exit; do sleep 20; done'",
    "timeout -k 5 10m bash -c 'while true; do sleep 1; done'",
    "~/.bisellium-evidence/wait-until.sh 30 test -s ~/x.exit",
    "bash /home/u/.bisellium-evidence/wait-until.sh 30 'test -s /tmp/x'",
    "npm test",
    "for i in 1 2 3; do sleep 1; done",
    'echo "while true"',
  ];
  for (const c of allowed) assert.equal((await guard(bash(c, {}, true))).code, 0, `allowed: ${c}`);
  assert.equal((await guard(bash(refused[0]!))).code, 0, "a foreground loop is not judged");
});

/** A checkout (a `.git` directory) under tmp, with a linked worktree, a symlink into packages/ and a directory outside it. */
function checkout(): string {
  const t = tmp();
  const root = join(t, "repo");
  for (const d of [".git", "packages/cli/src", "studio/decisions", "studio/briefs", "docs", ".worktrees/W-1"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, ".git/HEAD"), "ref: refs/heads/master\n");
  writeFileSync(join(root, ".worktrees/W-1/.git"), "gitdir: ../../.git/worktrees/W-1\n");
  mkdirSync(join(root, "packages/.git"));
  symlinkSync(join(root, "packages"), join(root, "studio", "evil"));
  mkdirSync(join(t, "outside"));
  symlinkSync(join(root, "packages"), join(t, "outside", "link"));
  mkdirSync(join(t, "plain"));
  return root;
}
const write = (file_path: string, extra: Record<string, unknown> = {}, tool = "Write", cwd = "/tmp") => ({
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: tool === "NotebookEdit" ? { notebook_path: file_path } : { file_path, content: "x" },
  cwd,
  ...extra,
});
const CLERK = { agent_id: "c1", agent_type: "clerk" };
const BUILDER = { agent_id: "b1", agent_type: "builder" };

test("W-310-b3 behaviour 3: the guard refuses the main thread's source and test writes, and anyone but a clerk's decision and handoff writes", async () => {
  const root = checkout();
  const t = dirname(root);
  const source = [
    join(root, "packages/cli/src/x.ts"),
    join(root, "packages/cli/src/x.test.ts"),
    join(root, "scripts/a.sh"),
    join(root, "package.json"),
    join(root, "packages/my dir/x.ts"),
    join(root, "packages/it's.ts"),
    join(root, "packages/ünï/x.ts"),
    join(root, "studio/evil/x.ts"),
    join(t, "outside/link/x.ts"),
    `${root}/studio/../packages/x.ts`,
    join(root, ".worktrees/W-1/packages/x.ts"),
  ];
  for (const p of source) {
    const r = await guard(write(p));
    assert.equal(r.code, 2, `main thread refused: ${p}`);
    assert.match(r.err, /does not write source or tests/, p);
  }
  assert.equal((await guard(write(source[0]!, {}, "Edit"))).code, 2, "Edit");
  assert.equal((await guard(write(join(root, "apps/x.ipynb"), {}, "NotebookEdit"))).code, 2, "NotebookEdit");
  assert.equal((await guard(write("packages/x.ts", {}, "Write", root))).code, 2, "a relative path against the input's cwd");
  const clerkOnly = [join(root, "studio/decisions/D-999.md"), join(root, "docs/SESSION-HANDOFF.md"), join(root, ".worktrees/W-1/studio/decisions/D-1.md")];
  for (const p of clerkOnly) {
    for (const who of [{}, BUILDER, { agent_type: "clerk" }]) {
      const r = await guard(write(p, who));
      assert.equal(r.code, 2, `refused for ${JSON.stringify(who)}: ${p}`);
      assert.match(r.err, /written only by a dispatched clerk subagent/, p);
    }
    assert.equal((await guard(write(p, CLERK))).code, 0, `a clerk writes ${p}`);
  }
  for (const p of [join(root, "studio/briefs/W-1.md"), join(root, "docs/ADOPTION.md"), join(t, "plain/x.ts")])
    assert.equal((await guard(write(p))).code, 0, `main thread allowed: ${p}`);
  for (const p of source.slice(0, 3)) assert.equal((await guard(write(p, BUILDER))).code, 0, `a builder writes ${p}`);
});

const stop = (transcript: string, tasks: unknown[], extra: Record<string, unknown> = {}) => ({
  hook_event_name: "SubagentStop",
  agent_id: "b1",
  agent_type: "builder",
  agent_transcript_path: transcript,
  stop_hook_active: false,
  background_tasks: tasks,
  ...extra,
});

test("W-310-b4 behaviour 4: at SubagentStop the guard sends back an agent whose own background work still runs", async () => {
  const t = tmp();
  const transcript = join(t, "agent ü.jsonl");
  writeFileSync(transcript, '{"type":"tool_result","content":"Command running in background with ID: bash_ab12cd"}\n{"x":"mon_77ee"}\n');
  const shell = { id: "bash_ab12cd", type: "shell", status: "running", description: "wait", command: "sleep 600" };
  const r = await guard(stop(transcript, [shell]));
  assert.equal(r.code, 2, "its own shell still runs: sent back");
  assert.match(r.err, /bash_ab12cd/);
  assert.match(r.err, /TaskStop/);
  assert.equal((await guard(stop(transcript, [{ id: "mon_77ee", type: "monitor", status: "running", description: "m" }]))).code, 2, "its own monitor");
  assert.equal((await guard(stop(transcript, [{ id: "bash_zz99", type: "shell", status: "running", description: "x" }]))).code, 0, "another thread's shell");
  assert.equal((await guard(stop(transcript, [{ id: "bash_ab12cd", type: "subagent", status: "running", description: "x" }]))).code, 0, "a subagent task is not judged");
  assert.equal((await guard(stop(transcript, [shell], { stop_hook_active: true }))).code, 0, "sent back once only");
  assert.equal((await guard(stop(transcript, []))).code, 0, "nothing in flight");
  assert.equal((await guard(stop(join(t, "missing.jsonl"), [shell]))).code, 0, "fail-open: no transcript");
});
