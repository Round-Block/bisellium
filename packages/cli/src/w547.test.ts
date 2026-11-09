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
test("W-547-b2 behaviour 2: the locks are read from live state: a perform writing main, a stash under a live perform, the heavy-job slots and the spec ahead", async () => {
  const w = world("w547-b2-writer", "greenlight");
  marker(w.repo, "W-800", "merge", 10);
  const o = next(w, [OPUS, ...BUDGET]);
  assert.match(o.kv.get("meanwhile-locks") ?? "", /^writer W-800 merge · /, ran("a live merge marker of another opus is the writer lock", o));
  assert.match(o.kv.get("meanwhile") ?? "", /not now: records \(W-800 merge writes main\)/, ran("the writer lock passes over the records step", o));
  marker(w.repo, "W-800", "merge", 600);
  const dead = next(w, [OPUS, ...BUDGET]);
  assert.match(dead.kv.get("meanwhile-locks") ?? "", /^writer none · /, ran("a marker whose output is older than its budget is no writer", dead));
  marker(w.repo, "W-800", "review", 10);
  const review = next(w, [OPUS, ...BUDGET]);
  assert.match(review.kv.get("meanwhile-locks") ?? "", /^writer none · /, ran("a live review marker writes no main", review));

  const m = await load();
  assert.ok(m.readLocks, "meanwhile.ts exports readLocks");
  const now = Date.now();
  const s = world("w547-b2-stash", "backlog");
  marker(s.repo, "W-800", "review", 5, now);
  assert.equal((m.readLocks(s.repo, "studio", now) as { stash?: string }).stash, undefined, "no stash entry is no stash lock");
  put(s.repo, "README.md", "edited\n");
  spawnSync("git", ["stash", "push", "-q", "-m", "w547", "--", "README.md"], { cwd: s.repo, env: SETUP_ENV });
  assert.match((m.readLocks(s.repo, "studio", now) as { stash?: string }).stash ?? "", /^stash@\{0\} under W-800 review$/, "a stash pushed after a live perform took its step is the stash lock");
  marker(s.repo, "W-800", "review", 600, now);
  assert.equal((m.readLocks(s.repo, "studio", now) as { stash?: string }).stash, undefined, "a stash under no live perform is no lock");

  const h = world("w547-b2-heavy", "backlog");
  receipt(join(h.repo, "studio"), "a", CI, { atMs: now });
  receipt(join(h.repo, ".worktrees", "W-800", "studio"), "b", CI, { atMs: now });
  receipt(join(h.repo, "studio"), "c", ["npm", "run", "-s", "bisellium", "--", "verify", "W-800"], { atMs: now });
  receipt(join(h.repo, "studio"), "d", CI, { ended: true, atMs: now });
  receipt(join(h.repo, "studio"), "e", CI, { ageS: 7200, atMs: now });
  receipt(join(h.repo, "studio"), "f", ["npm", "run", "-s", "bisellium", "--", "check"], { atMs: now });
  receipt(join(h.repo, ".worktrees", "W-800-spec", "studio"), "g", CI, { atMs: now });
  assert.equal((m.readLocks(h.repo, "studio", now) as { heavy?: number }).heavy, 3, "open ci --opus and verify receipts in main's studio and an opus worktree's fill the heavy slots; an ended, an old, a light one and a scratch worktree's are not counted");
  const full = m.meanwhileSteps!("suite", { heavy: 3 }, { studioRel: "studio", ahead: { opus: "W-901", spec: "draft" } });
  assert.match(full.find((x) => x.step === "spec-draft")?.text ?? "", /with no test run: 3 of 3 heavy-job slots in use/, "with every heavy slot in use the spec draft runs no test");

  // every lock input tells a valid absence from a read or shape error (Input domain)
  const e = world("w547-b2-errors", "backlog");
  assert.deepEqual(m.readLocks(e.repo, "studio", now), { heavy: 0 }, "an absent steps directory, stash, receipts and .worktrees are no lock and no error");
  const loose = scratch("w547-b2-norepo");
  assert.match((m.readLocks(loose, "studio", now) as { error?: string }).error ?? "", /^the main checkout cannot be found from /, "a failed main-checkout discovery is an error, never the directory itself");
  assert.match((m.mainWriter!(loose, now) as { error?: string }).error ?? "", /^the main checkout cannot be found/, "and mainWriter returns it");
  const markerErrors: [string, () => void, RegExp][] = [
    ["a marker that is not JSON", () => rawMarker(e.repo, "W-801.json", "{"), /W-801\.json is not JSON/],
    ["a marker that is not a regular file", () => rawMarker(e.repo, "W-801.json", "dir"), /W-801\.json cannot be read/],
    ["a marker naming another opus", () => rawMarker(e.repo, "W-801.json", JSON.stringify({ opus: "W-802", step: "merge", output: "steps/W-801.log", budget_seconds: 120 })), /names another opus/],
    ["a marker with a string budget", () => rawMarker(e.repo, "W-801.json", JSON.stringify({ opus: "W-801", step: "merge", output: "steps/W-801.log", budget_seconds: "120" })), /invalid budget_seconds/],
    ["a marker with an output of another form", () => rawMarker(e.repo, "W-801.json", JSON.stringify({ opus: "W-801", step: "merge", output: "../W-801.log", budget_seconds: 120 })), /invalid output/],
    ["a marker whose output was deleted", () => (marker(e.repo, "W-801", "review", 10, now), rmSync(join(e.repo, ".bisellium", "steps", "W-801.log"))), /W-801\.log of .*cannot be read \(ENOENT\)/],
    ["a marker whose output is ahead of the clock", () => marker(e.repo, "W-801", "review", -60, now), /ahead of the clock/],
  ];
  for (const [what, plant, why] of markerErrors) {
    clear(e.repo, "W-801");
    plant();
    assert.match((m.readLocks(e.repo, "studio", now) as { error?: string }).error ?? "", why, `${what} is a lock read error, never no lock`);
    assert.match((m.mainWriter!(e.repo, now) as { error?: string }).error ?? "", why, `${what} is a writer read error`);
  }
  clear(e.repo, "W-801");
  rawMarker(w.repo, "W-801.json", "{");
  const heldLine = next(w, [OPUS, ...BUDGET]);
  assert.match(heldLine.kv.get("meanwhile") ?? "", /^agent wait on a dispatched session[^:]*: held: the step marker \.bisellium\/steps\/W-801\.json is not JSON; no step is named until it reads; /, ran("a marker the locks cannot read holds the meanwhile line, naming no step", heldLine));
  assert.equal(heldLine.kv.get("meanwhile-locks"), "unreadable: the step marker .bisellium/steps/W-801.json is not JSON", ran("and the locks line names the read error", heldLine));
  clear(w.repo, "W-801");
  receipt(join(e.repo, "studio"), "x", CI, { atMs: now });
  writeFileSync(join(e.repo, "studio", "receipts", "producer", "y.json"), "{");
  const torn = m.readLocks(e.repo, "studio", now) as { heavy: number; heavyError?: string; error?: string };
  assert.equal(torn.error, undefined, "a receipt error is no writer or stash error");
  assert.match(torn.heavyError ?? "", /y\.json is not JSON/, "a malformed recent receipt marks heavy capacity unavailable");
  assert.match(m.meanwhileSteps!("suite", torn, { studioRel: "studio", ahead: { opus: "W-901", spec: "draft" } }).find((x) => x.step === "spec-draft")?.text ?? "", /with no test run: heavy-job slots unavailable/, "with heavy capacity unavailable the spec draft runs no test");
  writeFileSync(join(e.repo, "studio", "receipts", "producer", "y.json"), JSON.stringify({ cmd: "ci --opus W-1" }));
  assert.match((m.readLocks(e.repo, "studio", now) as { heavyError?: string }).heavyError ?? "", /y\.json has no cmd list of strings/, "a receipt whose cmd is not a list of strings marks heavy capacity unavailable");
  rmSync(join(e.repo, "studio", "receipts"), { recursive: true, force: true });
  put(join(e.repo, "studio"), "receipts/producer", "a file where a sella's directory belongs\n");
  assert.match((m.readLocks(e.repo, "studio", now) as { heavyError?: string }).heavyError ?? "", /receipts\/producer cannot be listed \(ENOTDIR\)/, "an unreadable receipts collection marks heavy capacity unavailable");
  rmSync(join(e.repo, "studio", "receipts"), { recursive: true, force: true });
  const okQueue = { kind: "ok" as const, file: { queues: [{ id: "e", lanes: [["E1", "W-1"]] as [string, string | undefined][], next: ["W-1", "W-2"].map((opus) => ({ opus, says: "", folded: [], nextTs: false })) }], halted: [], cut: [], deferred: [] } };
  const spec = (): never => ({ step: "spec", status: "named", actor: "architect", why: "", extra: [], order: order("architect") }) as never;
  assert.deepEqual(m.aheadIn!({ kind: "absent" }, "W-1", () => "greenlit", spec), {}, "an absent queue is no entry ahead");
  assert.match(m.aheadIn!({ kind: "held", why: "queue.yml is malformed: x", problems: ["x"] }, "W-1", () => "greenlit", spec).aheadError ?? "", /queue\.yml is malformed/, "a malformed queue is an error, never no entry");
  assert.match(m.aheadIn!(okQueue, "W-1", () => { throw new Error("the queued record opera/W-2.md cannot be read (EACCES)"); }, spec).aheadError ?? "", /opera\/W-2\.md cannot be read/, "an unreadable queued record is an error, never skipped");
  assert.match(m.aheadIn!(okQueue, "W-1", () => "greenlit", () => { throw new Error("gather failed"); }).aheadError ?? "", /the spec ahead cannot be read: gather failed/, "a derivation that throws is an error, never nothing owed");
  assert.deepEqual(m.aheadIn!(okQueue, "W-1", () => "greenlit", spec), { ahead: { opus: "W-2", spec: "draft" } }, "a readable queue names its next entry");

  const q = world("w547-b2-ahead", "greenlight");
  put(q.studio, "opera/W-901.md", "---\nid: \"W-901\"\ntitle: \"the next entry\"\nkind: \"feature\"\ncollegium: \"engineering\"\nstate: greenlit\nprobationes: {}\n---\nnext\n");
  put(q.studio, "opera/W-902.md", "---\nid: \"W-902\"\ntitle: \"two ahead\"\nkind: \"feature\"\ncollegium: \"engineering\"\nstate: greenlit\nprobationes: {}\n---\nlater\n");
  put(q.studio, "queue.yml", `queues:\n  engineering:\n    lanes: { E1: ${OPUS} }\n    next:\n      - { opus: ${OPUS}, says: "in flight" }\n      - { opus: W-901, says: "next" }\n      - { opus: W-902, says: "after" }\nhalted: []\ncut: []\ndeferred: []\n`);
  commit(q.repo, "studio: W-547 queue");
  const ahead = next(q, [OPUS, ...BUDGET]);
  assert.match(ahead.kv.get("meanwhile-locks") ?? "", / · ahead W-901 draft$/, ran("the queue's next entry with no spec is ahead to draft", ahead));
  assert.match(ahead.kv.get("meanwhile") ?? "", /: spec-draft: draft W-901's spec in its own scratch worktree/, ran("the next entry's draft is named, never the entry after it", ahead));
  const file = { queues: [{ id: "e", lanes: [["E1", "W-1"], ["E2", "W-5"]] as [string, string | undefined][], next: ["W-1", "W-2", "W-5", "W-3", "W-4"].map((opus) => ({ opus, says: "", folded: [], nextTs: false })) }], halted: [], cut: [], deferred: [] };
  put(q.studio, "opera/W-903.md", "---\nid: \"W-903\"\ntitle: \"no state\"\nkind: \"feature\"\ncollegium: \"engineering\"\nprobationes: {}\n---\nno state\n");
  put(q.studio, "queue.yml", `queues:\n  engineering:\n    lanes: { E1: ${OPUS} }\n    next:\n      - { opus: ${OPUS}, says: "in flight" }\n      - { opus: W-903, says: "no state" }\nhalted: []\ncut: []\ndeferred: []\n`);
  const norec = next(q, [OPUS, ...BUDGET]);
  assert.match(norec.kv.get("meanwhile") ?? "", /: held: the spec ahead cannot be read: the queued record opera\/W-903\.md has no state; no step is named/, ran("a queued record with no state holds the meanwhile line, never skipped", norec));
  put(q.studio, "queue.yml", "queues: [not, a, mapping]\n");
  const badq = next(q, [OPUS, ...BUDGET]);
  assert.match(badq.kv.get("meanwhile") ?? "", /: held: queue\.yml is malformed: /, ran("a malformed queue.yml holds the meanwhile line instead of naming a step", badq));
  assert.equal(badq.kv.get("role"), "architect", ran("and the step next names is unchanged", badq));
  assert.equal(m.nextEntry!(file, "W-1", (x) => (x === "W-2" ? "done" : "greenlit")), "W-3", "the next entry skips the opus itself, a done entry and another lane's opus");
  assert.equal(m.specAhead!({ step: "spec", status: "named", actor: "spec-reviewer", why: "", extra: [], order: order("spec-reviewer") } as never), "review", "a signed spec not yet reviewed is still ahead");
});
test("W-547-b3 behaviour 3: land refuses while a perform writes main", () => {
  const w = world("w547-b3", "backlog");
  marker(w.repo, "W-800", "merge", 10);
  put(w.studio, "notes.md", "a record to land\n");
  const args = ["land", "studio/notes.md", "--title", "chore(studio): notes", "--sella", "producer", "--studio", w.studio, "--repo", w.repo, "--now", NOW_ISO, "--poll-ms", "1", "--max-polls", "1"];
  const r = cli(w, args);
  assert.match(r.out, /^land: refused\nwhy: refusing: W-800 merge is running and writes main when its PR lands/, `land refuses while a merge perform writes main\n${r.out}${r.err}`);
  assert.equal(r.status, 1, "the refusal exits 1");
  marker(w.repo, "W-800", "done", 10);
  assert.match(cli(w, args).out, /W-800 done is running/, "land refuses while a done perform lands through the queue");
  marker(w.repo, "W-800", "merge", 600);
  const ok = cli(w, args);
  assert.doesNotMatch(ok.out, /is running and writes main|writer lock cannot be read/, `a merge marker past its budget does not refuse the land\n${ok.out}`);
  rawMarker(w.repo, "W-801.json", "{");
  const torn = cli(w, args);
  assert.match(torn.out, /^land: refused\nwhy: refusing: the main checkout's writer lock cannot be read: the step marker \.bisellium\/steps\/W-801\.json is not JSON/, `land refuses beside a malformed marker\n${torn.out}${torn.err}`);
  assert.equal(torn.status, 1, "the malformed-marker refusal exits 1");
});
test("W-547-b4 behaviour 4: retro --daily refuses while a perform writes main", () => {
  const w = world("w547-b4", "backlog");
  marker(w.repo, "W-800", "merge", 10);
  const args = ["retro", "--daily", "--studio", w.studio, "--now", NOW_ISO];
  const r = cli(w, args);
  assert.match(r.err, /^retro --daily: refused: W-800 merge is running and writes main when its PR lands/, `retro --daily refuses while a merge perform writes main\n${r.out}${r.err}`);
  assert.equal(r.status, 1, "the refusal exits 1");
  marker(w.repo, "W-800", "merge", 600);
  const ok = cli(w, args);
  assert.doesNotMatch(ok.err, /is running and writes main|writer lock cannot be read/, `a merge marker past its budget does not refuse the retro\n${ok.err}`);
  marker(w.repo, "W-801", "merge", 10);
  rmSync(join(w.repo, ".bisellium", "steps", "W-801.log"));
  const gone = cli(w, args);
  assert.match(gone.err, /^retro --daily: refused: the main checkout's writer lock cannot be read: the output \.bisellium\/steps\/W-801\.log of \.bisellium\/steps\/W-801\.json cannot be read \(ENOENT\)/, `retro --daily refuses beside a marker whose output was deleted\n${gone.out}${gone.err}`);
  assert.equal(gone.status, 1, "the unreadable-marker refusal exits 1");
  clear(w.repo, "W-801");
  const nogit = cli(w, args, { PATH: join(w.root, "no-git-here") });
  assert.match(nogit.err, /^retro --daily: refused: the main checkout's writer lock cannot be read: the main checkout cannot be found from /, `retro --daily refuses when the main checkout cannot be found (no git on PATH)\n${nogit.out}${nogit.err}`);
  assert.equal(nogit.status, 1, "the failed-discovery refusal exits 1");
});
