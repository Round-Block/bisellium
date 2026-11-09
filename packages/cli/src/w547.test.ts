/**
 * W-547 rows b1-b5 (studio/briefs/W-547.md): `next` names a `meanwhile:` step beside every wait, from one ranked table
 * keyed by the kind of wait and filtered by locks read from live state; `land` and `retro --daily` refuse while a perform
 * writes main, and a spec review order is held while one does or while main is stashed under one. node:test TAP,
 * selected by `--test-name-pattern='^W-547-b<n>\s'`. Every fixture is a next-world fixture (a repository under the OS tmp
 * dir, a stub gh); `meanwhile.ts` is read when a row runs (it is new in this opus), so a red is an assertion.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { BUDGET, MAIN, NOW_ISO, NOW_MS, OPUS, PROC_ENV, SETUP_ENV, TSX, type World, commit, envFor, fakeProc, next, put, putBrief, ran, scratch, sign, srWorld, world } from "./next-world.test.js";

type M = typeof import("./meanwhile.js");
/** The module, read when a row runs; absent, a row fails at its first assertion. */
const load = async (): Promise<Partial<M>> => import("./meanwhile.js").catch(() => ({}));

/** A step marker of `opus` at `step` in the fixture's main checkout, its output written `ageS` seconds before `atMs`. */
function marker(repo: string, opus: string, step: string, ageS: number, atMs = NOW_MS): void {
  const at = join(repo, ".bisellium", "steps");
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, `${opus}.json`), JSON.stringify({ schema: 1, opus, step, pid: 999999, start_ticks: 1, started: NOW_ISO, output: `steps/${opus}.log`, budget_seconds: 120, writer: "perform" }));
  writeFileSync(join(at, `${opus}.log`), "poll\n");
  utimesSync(join(at, `${opus}.json`), (atMs - 600_000) / 1000, (atMs - 600_000) / 1000);
  utimesSync(join(at, `${opus}.log`), (atMs - ageS * 1000) / 1000, (atMs - ageS * 1000) / 1000);
}
/** A run receipt under `studio`, open (no endedAt) unless `ended`, written `ageS` seconds before `atMs`. */
function receipt(studio: string, name: string, cmd: string[], o: { ended?: boolean; ageS?: number; atMs?: number } = {}): void {
  const path = join(studio, "receipts", "producer", `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ sella: "producer", sessionId: name, startedAt: NOW_ISO, cwd: studio, cmd, harness: "run", ...(o.ended ? { endedAt: NOW_ISO, exitCode: 0 } : {}) }));
  const t = ((o.atMs ?? NOW_MS) - (o.ageS ?? 60) * 1000) / 1000;
  utimesSync(path, t, t);
}
const CI = ["npm", "run", "-s", "bisellium", "--", "ci", "--opus", "W-800", "--studio", "studio", "--repo", "."];
function cli(w: World, args: string[], env: Record<string, string> = {}): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd: w.repo, env: { ...envFor(w, {}), ...env }, encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
/** A step marker file under the fixture's main checkout written as `text` (a malformed marker), or a directory in its place. */
function rawMarker(repo: string, name: string, text: string | "dir"): void {
  const at = join(repo, ".bisellium", "steps");
  mkdirSync(at, { recursive: true });
  rmSync(join(at, name), { recursive: true, force: true });
  if (text === "dir") mkdirSync(join(at, name));
  else writeFileSync(join(at, name), text);
}
const clear = (repo: string, opus: string): void => {
  for (const x of [`${opus}.json`, `${opus}.log`]) rmSync(join(repo, ".bisellium", "steps", x), { recursive: true, force: true });
};
const d = (o: Record<string, unknown>): Record<string, unknown> => ({ status: "named", actor: "producer", why: "", extra: [], ...o });
const order = (role: string): Record<string, unknown> => ({ role, sella: role, boot: "", phase: "2", inputs: [], command: "", resume: false, extra: [] });

test("W-547-b1 behaviour 1: next names a meanwhile step beside every wait it names, from one table with a row per wait kind", async () => {
  const backlog = world("w547-b1-backlog", "backlog");
  const o = next(backlog, [OPUS]);
  assert.match(o.kv.get("meanwhile") ?? "", /^approval wait on the Patron: /, ran("a backlog opus's wait on the Patron names a meanwhile step", o));
  assert.match(o.kv.get("meanwhile") ?? "", /no push to the PR branch/, ran("the approval row names what no step may do", o));
  assert.match(o.kv.get("meanwhile-locks") ?? "", /^writer none · stash none · heavy 0 of 3 · ahead none$/, ran("the locks are printed beside the step", o));

  const draft = world("w547-b1-draft", "greenlight");
  const a = next(draft, [OPUS, ...BUDGET]);
  assert.match(a.kv.get("meanwhile") ?? "", /^agent wait on a dispatched session/, ran("a spec dispatched to the architect is an agent wait", a));
  assert.match(a.kv.get("meanwhile") ?? "", /: records: file and land records from main/, ran("with no retro owed and no next entry, the records step is named", a));

  // every health branch of report mode prints the lines beside a wait: absent (above), running, dead, invalid, unknown,
  // anomaly, finished and stale (a marker the locks cannot read prints the held form of the line, row b2)
  const hw = world("w547-b1-health", "greenlight");
  const branches: [string, RegExp, () => void, Record<string, string>?][] = [
    ["running", /^running /, () => marker(hw.repo, OPUS, "spec", 10)],
    ["dead", /^dead \(stalled/, () => marker(hw.repo, OPUS, "spec", 600)],
    ["invalid", /^dead \(invalid marker/, () => rawMarker(hw.repo, `${OPUS}.json`, "not json")],
    ["unknown", /^unknown /, () => marker(hw.repo, OPUS, "spec", 10), PROC_ENV(fakeProc(hw, { "999999": "dir" }))],
    ["anomaly", /^clock anomaly/, () => marker(hw.repo, OPUS, "spec", -60)],
    ["finished", /^finished greenlight/, () => marker(hw.repo, OPUS, "greenlight", 10)],
    ["stale", /^stale marker/, () => marker(hw.repo, OPUS, "branch", 10)],
  ];
  for (const [kind, health, plant, env] of branches) {
    clear(hw.repo, OPUS);
    plant();
    const h = next(hw, [OPUS, ...BUDGET], env === undefined ? {} : { env });
    assert.match(h.kv.get("health") ?? "", health, ran(`the ${kind} health branch is read`, h));
    assert.match(h.kv.get("meanwhile") ?? "", /^agent wait on a dispatched session/, ran(`the ${kind} health branch prints the meanwhile line beside a wait`, h));
    assert.match(h.kv.get("meanwhile-locks") ?? "", /./, ran(`the ${kind} health branch prints the locks line beside a wait`, h));
  }

  const branch = world("w547-b1-branch", "spec");
  const b = next(branch, [OPUS]);
  assert.equal(b.kv.get("meanwhile"), undefined, ran("a rung the caller performs next names no meanwhile step", b));

  const m = await load();
  assert.ok(m.WAIT_KINDS && m.MEANWHILE && m.waitOf && m.meanwhileSteps, "meanwhile.ts exports the table and the classifier");
  assert.deepEqual(Object.keys(m.MEANWHILE).sort(), [...m.WAIT_KINDS].sort(), "every wait kind has a table row, and no row is for another kind");
  const kinds: [string, Record<string, unknown>, string | undefined][] = [
    ["the merge rung", d({ step: "merge" }), "merge-queue"],
    ["the done land through the queue", d({ step: "done", act: "land" }), "merge-queue"],
    ["the ladder-runner's ci --opus", d({ step: "build", command: "from .worktrees/W-1: a ladder-runner runs bisellium run --sella producer --no-worktree --studio studio -- npm run -s bisellium -- ci --opus W-1 --studio studio --repo ." }), "suite"],
    ["the prototype replay", d({ step: "reds", act: "replay" }), "suite"],
    ["a rewrite's rebuild", d({ step: "pr", act: "rewrite" }), "suite"],
    ["the build review", d({ step: "review", actor: "censor", order: order("censor") }), "codex-review"],
    ["the fix check", d({ step: "review", act: "fix-check" }), "codex-review"],
    ["the spec review", d({ step: "spec", actor: "spec-reviewer", order: order("spec-reviewer") }), "codex-review"],
    ["a petitio to the Patron", d({ step: "build", status: "held", actor: "patron" }), "approval"],
    ["a ui opus's screens ruling", d({ step: "merge", status: "held", uncut: true }), "approval"],
    ["a builder's fix round", d({ step: "build", actor: "builder", order: order("builder") }), "agent"],
    ["the architect's spec", d({ step: "spec", actor: "architect", order: order("architect") }), "agent"],
    ["the ui-lead's input", d({ step: "spec", actor: "ui-lead", order: order("ui-lead") }), "agent"],
    ["the branch rung", d({ step: "branch" }), undefined],
    ["a hold that asks a fix", d({ step: "build", status: "held", uncut: true }), undefined],
    ["a dispatch held for its budget", d({ step: "review", status: "held", actor: "censor" }), undefined],
  ];
  for (const [what, derived, kind] of kinds) assert.equal(m.waitOf(derived as never), kind, `${what} reads as ${kind ?? "no wait"}`);
  const mq = m.meanwhileSteps("merge-queue", { heavy: 0 }, { studioRel: "studio", retro: "2026-10-01", ahead: { opus: "W-901", spec: "review" } });
  assert.deepEqual(mq.filter((s) => s.not === undefined).map((s) => s.step), ["drafts"], "in the merge-queue wait only the drafts are free when the retro is owed and a signed spec is ahead");
  assert.match(mq.find((s) => s.step === "retro")?.not ?? "", /fast-forwards main/, "the merge-queue row forbids the retro: the landing fast-forwards main");
  assert.match(mq.find((s) => s.step === "records")?.not ?? "", /moves master under the queue/, "the merge-queue row forbids a land");
  assert.match(mq.find((s) => s.step === "spec-review")?.not ?? "", /moving base/, "the merge-queue row forbids a spec review");
  const suite = m.meanwhileSteps("suite", { heavy: 0 }, { studioRel: "studio", retro: "2026-10-01" });
  assert.equal(suite.find((s) => s.not === undefined)?.step, "retro", "in the suite wait an owed retro is named first");
});
