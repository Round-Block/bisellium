/**
 * W-364 rows b1-b4 (studio/briefs/W-364.md): the main thread's heavy runs and record writes refused. node:test TAP,
 * selected by `--test-name-pattern='^W-364-b<n>\s'`. Row b1 spawns the CLI (`main.ts`) with and without a
 * `bisellium run` session; rows b2-b4 feed hook inputs to `runHookEvent(["guard", …])` and read its exit code and
 * stderr. Fixtures live under the OS tmp dir.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runHookEvent } from "./hooks.js";
import { initStudio } from "./init.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAIN = join(REPO, "packages/cli/src/main.ts");
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w364-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The guard on one hook input: its exit code and stderr. */
async function guard(input: unknown): Promise<{ code: number; err: string }> {
  const err: string[] = [];
  const keep = console.error;
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    return { code: r.exitCode, err: err.join("\n") };
  } finally {
    console.error = keep;
  }
}
const bash = (command: string, cwd: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
  cwd,
  ...extra,
});
const RUNNER = { agent_id: "a1b2c3", agent_type: "ladder-runner" };
const BUILDER = { agent_id: "b4d5e6", agent_type: "builder" };

/** The CLI run as a subprocess from the repository root with `env` (BISELLIUM_SESSION removed unless `env` sets it): exit code and stderr. */
function cli(args: string[], env: Record<string, string> = {}): { code: number; err: string } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base["BISELLIUM_SESSION"];
  const r = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...args], { cwd: REPO, env: { ...base, ...env }, encoding: "utf8", timeout: 120_000 });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, err: r.stderr };
}
const SESSION_REFUSAL = /runs only inside a bisellium run session \(W-364\)/;

test("W-364-b1 behaviour 1: verify and ci --opus refuse outside a bisellium run session, from any caller", () => {
  const dir = tmp();
  const studio = join(dir, "studio");
  initStudio(studio);
  const verify = cli(["verify", "W-999", "--studio", studio, "--repo", dir]);
  assert.equal(verify.code, 2, "outside a session: verify refused");
  assert.match(verify.err, SESSION_REFUSAL, "verify: the refusal names the session");
  assert.match(verify.err, /bisellium run --sella <seat> --no-worktree --studio studio -- npm run -s bisellium -- verify/, "verify: the refusal names the route");
  const ci = cli(["ci", "--opus", "W-999", "--studio", studio, "--repo", dir]);
  assert.equal(ci.code, 2, "outside a session: ci --opus refused");
  assert.match(ci.err, /`bisellium ci --opus` runs only inside a bisellium run session \(W-364\)/, "ci --opus: the refusal names it");
  assert.match(cli(["verify", "W-999", "--studio", studio], { BISELLIUM_SESSION: "" }).err, SESSION_REFUSAL, "an empty BISELLIUM_SESSION is no session");
  const usage = cli(["verify"]);
  assert.equal(usage.code, 2, "verify with no argument: its usage, exit 2");
  assert.doesNotMatch(usage.err, SESSION_REFUSAL, "verify with no argument keeps its usage line");
  const plain = cli(["ci", "--ref"]);
  assert.doesNotMatch(plain.err, SESSION_REFUSAL, "ci without --opus is not refused");
  const inSession = cli(["verify", "W-999", "--studio", studio, "--repo", dir], { BISELLIUM_SESSION: "s-1" });
  assert.doesNotMatch(inSession.err, SESSION_REFUSAL, "inside a session: verify runs");
  assert.match(inSession.err, /unknown opus: W-999/, "inside a session: verify runs and fails on the unknown opus");
  const ciInSession = cli(["ci", "--opus", "W-999", "--studio", studio, "--repo", dir, "--offline"], { BISELLIUM_SESSION: "s-1" });
  assert.doesNotMatch(ciInSession.err, SESSION_REFUSAL, "inside a session: ci --opus runs");
  assert.match(ciInSession.err, /unknown opus: W-999/, "inside a session: ci --opus runs and fails on the unknown opus");
  const throughRun = cli(["run", "--sella", "producer", "--no-worktree", "--studio", studio, "--", process.execPath, "--import", import.meta.resolve("tsx"), MAIN, "verify", "W-999", "--studio", studio, "--repo", dir]);
  assert.doesNotMatch(throughRun.err, SESSION_REFUSAL, "through bisellium run: verify runs in its session");
  assert.match(throughRun.err, /unknown opus: W-999/, "through bisellium run: verify runs and fails on the unknown opus");
  const runner = readFileSync(join(REPO, "scripts/run-builder-host.mjs"), "utf8");
  assert.match(
    runner,
    /const gateCell = producerCell\([\s\S]*?\);\n\s*\/\/ W-364[^\n]*\n\s*Object\.assign\(gateCell\.env, \{ BISELLIUM_SESSION: request\.sessionId \}\);\n\s*const gate = await launch\(/,
    "the host runner's gates run ci --opus inside its session",
  );
});
