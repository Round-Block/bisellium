/**
 * W-558 rows b1-b5 (studio/briefs/W-558.md): one fail-closed read in @bisellium/schema (absent is file-not-found only),
 * the lock-input loaders on it (opus records, step markers, run receipts, queue.yml), and W-559's four cases: an unknown
 * marker step refuses, a `.json` marker output is an output, an unknown queued state is an error, a held derivation
 * input error of the next entry is an error; and a census warning on a raw read outside the loaders. node:test TAP,
 * selected by `--test-name-pattern='^W-558-b<n>\s'`. Modules new in this opus are read when a row runs, so a red is an
 * assertion. Fixtures are next-world fixtures under the OS tmp dir; no row reads `studio/`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUDGET, MAIN, NOW_ISO, NOW_MS, OPUS, TSX, type World, commit, envFor, git, next, put, ran, world } from "./next-world.test.js";

type S = typeof import("@bisellium/schema");
type I = typeof import("./inputs.js");
type M = typeof import("./meanwhile.js");
type N = typeof import("./next.js");
const schema = async (): Promise<Partial<S>> => import("@bisellium/schema");
const inputs = async (): Promise<Partial<I>> => import("./inputs.js").catch(() => ({}));
const meanwhile = async (): Promise<Partial<M>> => import("./meanwhile.js");
const nextMod = async (): Promise<Partial<N>> => import("./next.js");

/** A full step marker of `opus` at `step`, its output `output` written `ageS` seconds before now. */
function marker(repo: string, opus: string, step: string, ageS: number, output = `steps/${opus}.log`): void {
  const at = join(repo, ".bisellium", "steps");
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, `${opus}.json`), JSON.stringify({ schema: 1, opus, step, pid: 999999, start_ticks: 1, started: NOW_ISO, output, budget_seconds: 120, writer: "perform" }));
  writeFileSync(join(repo, ".bisellium", output), '{"poll": 1}\n');
  utimesSync(join(at, `${opus}.json`), (NOW_MS - 600_000) / 1000, (NOW_MS - 600_000) / 1000);
  utimesSync(join(repo, ".bisellium", output), (NOW_MS - ageS * 1000) / 1000, (NOW_MS - ageS * 1000) / 1000);
}
function cli(w: World, args: string[]): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd: w.repo, env: envFor(w, {}), encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const record = (id: string, state: string | undefined): string => `---\nid: "${id}"\ntitle: "a queued opus"\nkind: "feature"\ncollegium: "engineering"\n${state === undefined ? "" : `state: ${state}\n`}probationes: {}\n---\nqueued\n`;
const queue = (ids: string[]): string => `queues:\n  engineering:\n    lanes: { E1: ${OPUS} }\n    next:\n      - { opus: ${OPUS}, says: "in flight" }\n${ids.map((id) => `      - { opus: ${id}, says: "queued" }\n`).join("")}halted: []\ncut: []\ndeferred: []\n`;

test("W-558-b1 behaviour 1: one shared read returns absent, valid or error, and the loaders read on it", async () => {
  const s = await schema();
  const missing = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  const id = <T,>(b: T): T => b;
  assert.deepEqual(s.readInput?.("x.json", () => ({ error: missing.message, code: "ENOENT" }), id), { kind: "absent" }, "a missing file is absent");
  assert.deepEqual(s.readInput?.("x.json", () => { throw missing; }, id), { kind: "absent" }, "a thrown file-not-found is absent");
  assert.deepEqual(s.readInput?.("x.json", () => ({ error: denied.message, code: "EACCES" }), id), { kind: "error", why: "x.json cannot be read (EACCES)" }, "an unreadable file is an error, not absent");
  assert.deepEqual(s.readInput?.("x.json", () => { throw denied; }, id), { kind: "error", why: "x.json cannot be read (EACCES)" }, "a thrown read failure is an error, not absent");
  assert.deepEqual(s.readInput?.("x.json", () => ({ error: "target is not a regular file" }), id), { kind: "error", why: "x.json cannot be read (target is not a regular file)" }, "a read error with no code is an error, not absent");
  assert.deepEqual(s.readInput?.("x.json", () => ({ bytes: "{" }), () => { throw new Error("is not JSON"); }), { kind: "error", why: "x.json is not JSON" }, "a value the shape rejects is an error");
  assert.deepEqual(s.readInput?.("x.json", () => ({ bytes: "1" }), (b: string) => Number(b)), { kind: "valid", value: 1 }, "a value the shape accepts is valid");

  const i = await inputs();
  const root = mkdtempSync(join(tmpdir(), "w558-b1-"));
  try {
    assert.deepEqual(i.loadOpusRecord?.(root, "opera/W-1.md"), { kind: "absent" }, "a missing opus record is absent");
    mkdirSync(join(root, "opera", "W-2.md"), { recursive: true });
    assert.equal(i.loadOpusRecord?.(root, "opera/W-2.md")?.kind, "error", "an opus record that is a directory is an error, not absent");
    put(root, "opera/W-3.md", record("W-3", "greenlti"));
    assert.match((i.loadOpusRecord?.(root, "opera/W-3.md") as { why?: string })?.why ?? "", /^opera\/W-3\.md has state "greenlti", not one of backlog, greenlit, /, "an opus record whose state is outside the lifecycle is an error");
    put(root, "opera/W-4.md", record("W-4", "building"));
    assert.equal((i.loadOpusRecord?.(root, "opera/W-4.md") as { value?: Record<string, unknown> })?.value?.["state"], "building", "an opus record in a lifecycle state is valid");
    put(root, "receipts/producer/r.json", "{");
    assert.deepEqual(i.loadReceipt?.(root, "producer", "r.json"), { kind: "error", why: `${join(root, "receipts/producer/r.json")} is not JSON` }, "a malformed receipt is an error");
    assert.deepEqual(i.loadReceipt?.(root, "producer", "none.json"), { kind: "absent" }, "a missing receipt is absent");
    assert.deepEqual(i.loadMarker?.(join(root, ".bisellium"), "W-1.json"), { kind: "absent" }, "a missing marker is absent");
    put(join(root, ".bisellium"), "steps/W-1.json", "[]");
    assert.equal(i.loadMarker?.(join(root, ".bisellium"), "W-1.json")?.kind, "error", "a malformed marker is an error");
    const { readQueue } = await import("./queue.js");
    mkdirSync(join(root, "queue.yml"));
    assert.deepEqual(readQueue(root), { kind: "held", why: "queue.yml cannot be read (target is not a regular file)", problems: ["queue.yml cannot be read (target is not a regular file)"] }, "an unreadable queue.yml is an error, not absent");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("W-558-b2 behaviour 2: an unknown marker step is an error that land and retro refuse on, and a .json marker output is an output", async () => {
  const w = world("w558-b2", "backlog");
  marker(w.repo, "W-800", "merg", 10);
  const m = await meanwhile();
  assert.match((m.readLocks!(w.repo, "studio", NOW_MS) as { error?: string }).error ?? "", /^the step marker \.bisellium\/steps\/W-800\.json names an unknown step "merg"/, "an unknown marker step is a lock read error, never no writer");
  assert.match((m.mainWriter!(w.repo, NOW_MS) as { error?: string }).error ?? "", /names an unknown step "merg"/, "the writer read refuses an unknown marker step");
  put(w.studio, "notes.md", "a record to land\n");
  const land = cli(w, ["land", "studio/notes.md", "--title", "chore(studio): notes", "--sella", "producer", "--studio", w.studio, "--repo", w.repo, "--now", NOW_ISO, "--poll-ms", "1", "--max-polls", "1"]);
  // one-sided: the rest of the output is the marker reader's closed set
  assert.match(land.out, /^land: refused\nwhy: refusing: the main checkout's writer lock cannot be read: the step marker \.bisellium\/steps\/W-800\.json names an unknown step "merg"/, `land refuses beside an unknown marker step\n${land.out}${land.err}`);
  const retro = cli(w, ["retro", "--daily", "--studio", w.studio, "--now", NOW_ISO]);
  assert.match(retro.err, /^retro --daily: refused: the main checkout's writer lock cannot be read: the step marker \.bisellium\/steps\/W-800\.json names an unknown step "merg"/, `retro --daily refuses beside an unknown marker step\n${retro.err}`);
  assert.equal(retro.status, 1, "the retro refusal exits 1");
  rmSync(join(w.repo, ".bisellium", "steps"), { recursive: true, force: true });
  marker(w.repo, "W-800", "merge", 10, "steps/status.json");
  assert.deepEqual(m.readLocks!(w.repo, "studio", NOW_MS), { writer: "W-800 merge", heavy: 0 }, "a live marker whose output is a .json file is the writer lock, its output no marker");
  rmSync(join(w.repo, ".bisellium", "steps"), { recursive: true, force: true });
  writeFileSync(join(w.repo, ".bisellium", "steps"), "a file where the steps directory goes\n");
  const n = await nextMod();
  assert.match(n.readMarker!(w.repo, OPUS)?.invalid ?? "absent", /^the marker cannot be read \(ENOTDIR\)$/, "next's own marker read is invalid, never absent, when the steps path cannot be read");
});

test("W-558-b3 behaviour 3: a queued record whose state is outside the lifecycle is an error, never skipped", () => {
  const q = world("w558-b3", "greenlight");
  put(q.studio, "opera/W-904.md", record("W-904", "greenlti"));
  put(q.studio, "opera/W-905.md", record("W-905", "greenlit"));
  put(q.studio, "queue.yml", queue(["W-904", "W-905"]));
  commit(q.repo, "studio: W-558 queue");
  const o = next(q, [OPUS, ...BUDGET]);
  assert.match(o.kv.get("meanwhile") ?? "", /: held: the spec ahead cannot be read: the queued record opera\/W-904\.md has state "greenlti", not one of backlog, /, ran("an unknown queued state holds the meanwhile line, never skips to a lower entry", o));
  assert.doesNotMatch(o.kv.get("meanwhile-locks") ?? "", /ahead W-905/, ran("the entry below the typo is never named ahead", o));
  assert.equal(o.kv.get("role"), "architect", ran("and the step next names is unchanged", o));
});

test("W-558-b4 behaviour 4: a held derivation input error of the next entry is an error, never nothing owed", () => {
  const q = world("w558-b4", "greenlight");
  put(q.studio, "opera/W-906.md", record("W-906", "greenlit"));
  put(q.studio, "queue.yml", queue(["W-906"]));
  commit(q.repo, "studio: W-558 queue");
  git(q.repo, ["branch", "opus/W-906"]);
  const wt = join(q.repo, "..", "w558-b4-branch");
  git(q.repo, ["worktree", "add", "-q", wt, "opus/W-906"]);
  put(join(wt, "studio"), "opera/W-906.md", "---\nid: [unclosed\n---\n");
  commit(wt, "studio: W-906 malformed on its branch");
  git(q.repo, ["worktree", "remove", "--force", wt]);
  const o = next(q, [OPUS, ...BUDGET]);
  assert.match(o.kv.get("meanwhile") ?? "", /: held: the spec ahead cannot be read: the next entry W-906's derivation input cannot be read: /, ran("a next entry whose branch record is malformed holds the meanwhile line", o));
  assert.equal(o.kv.get("role"), "architect", ran("and the step next names is unchanged", o));
});
