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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BUDGET, MAIN, NOW_ISO, NOW_MS, OPUS, TSX, type World, commit, envFor, git, next, put, ran, world } from "./next-world.test.js";
import { HOST_RUN_TIMEOUT_MS } from "@bisellium/commands/builder-run.js";

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
    assert.match((i.loadOpusRecord?.(root, "opera/W-3.md") as { why?: string })?.why ?? "", /^opera\/W-3\.md has state "greenlti", not one of backlog, greenlit, building, verifying, review, done, halted$/, "an opus record whose state is outside the lifecycle is an error");
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
  assert.match((m.readLocks!(w.repo, "studio", NOW_MS) as { error?: string }).error ?? "", /^the step marker \.bisellium\/steps\/W-800\.json names an unknown step "merg" \(not one of greenlight, spec, branch, ready, reds, build, review, pr, merge, cleanup, done, retro, checkpoint\)$/, "an unknown marker step is a lock read error, never no writer");
  assert.match((m.mainWriter!(w.repo, NOW_MS) as { error?: string }).error ?? "", /names an unknown step "merg"/, "the writer read refuses an unknown marker step");
  put(w.studio, "notes.md", "a record to land\n");
  const land = cli(w, ["land", "studio/notes.md", "--title", "chore(studio): notes", "--sella", "producer", "--studio", w.studio, "--repo", w.repo, "--now", NOW_ISO, "--poll-ms", "1", "--max-polls", "1"]);
  assert.match(land.out, /^land: refused\nwhy: refusing: the main checkout's writer lock cannot be read: the step marker \.bisellium\/steps\/W-800\.json names an unknown step "merg" \(not one of greenlight, spec, branch, ready, reds, build, review, pr, merge, cleanup, done, retro, checkpoint\); a land now could move master under a merge queue \(W-547\); nothing committed or pushed\nway past: repair or remove what the line names, then land again\n$/, `land refuses beside an unknown marker step\n${land.out}${land.err}`);
  const retro = cli(w, ["retro", "--daily", "--studio", w.studio, "--now", NOW_ISO]);
  assert.match(retro.err, /^retro --daily: refused: the main checkout's writer lock cannot be read: the step marker \.bisellium\/steps\/W-800\.json names an unknown step "merg" \(not one of greenlight, spec, branch, ready, reds, build, review, pr, merge, cleanup, done, retro, checkpoint\); the retro waits until it reads \(W-547\)\n$/, `retro --daily refuses beside an unknown marker step\n${retro.err}`);
  assert.equal(retro.status, 1, "the retro refusal exits 1");
  rmSync(join(w.repo, ".bisellium", "steps"), { recursive: true, force: true });
  marker(w.repo, "W-800", "merge", 10, "steps/status.json");
  assert.deepEqual(m.readLocks!(w.repo, "studio", NOW_MS), { writer: "W-800 merge", heavy: 0 }, "a live marker whose output is a .json file is the writer lock, its output no marker");
  rmSync(join(w.repo, ".bisellium", "steps"), { recursive: true, force: true });
  writeFileSync(join(w.repo, ".bisellium", "steps"), "a file where the steps directory goes\n");
  const n = await nextMod();
  assert.match(n.readMarker!(w.repo, OPUS)?.invalid ?? "absent", /^\.bisellium\/steps is not a directory$/, "next's own marker read is invalid, never absent, when the steps path cannot be read");
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

test("W-558-b5 behaviour 5: a census warns on every raw read of a lock input outside the loaders", async (t) => {
  const i = await inputs();
  const raw = 'const f = readContainedRegularFile(root, `opera/${id}.md`, "opera");\nconst r = loadOpusRecord(root, id);\nconst m = readFileSync(markerPath(repo, id), "utf8");\n';
  assert.deepEqual(i.inputCensus?.("x.ts", raw), ["x.ts:1: an opus record read outside the loaders", "x.ts:3: a lock input read outside the loaders"], "the census flags a raw read and passes a loader call");
  for (const f of ["cli/src/next.ts", "cli/src/meanwhile.ts", "cli/src/land.ts", "cli/src/retro.ts", "shim/src/receipts.ts"]) for (const line of i.inputCensus!(`packages/${f}`, readFileSync(join(import.meta.dirname, "..", "..", f), "utf8"))) t.diagnostic(`warning: ${line}`);
  assert.deepEqual(i.inputCensus!("packages/cli/src/meanwhile.ts", readFileSync(join(import.meta.dirname, "meanwhile.ts"), "utf8")), [], "the W-547 lock reader reads every lock input through the loaders");
});

/** W-558-f1: the `.bisellium/steps` collection is valid only as a real directory reached without a symlink. */
type Shape = "symlink to a directory with a marker" | "dangling symlink" | "symlink to an empty directory" | "regular file";
function collection(repo: string, shape: Shape): void {
  const at = join(repo, ".bisellium", "steps");
  mkdirSync(join(repo, ".bisellium"), { recursive: true });
  if (shape === "regular file") return writeFileSync(at, "a file where the steps directory goes\n");
  if (shape === "dangling symlink") return symlinkSync(join(repo, "nowhere"), at);
  const target = join(repo, "elsewhere");
  mkdirSync(target, { recursive: true });
  if (shape === "symlink to a directory with a marker") {
    writeFileSync(join(target, "W-800.json"), JSON.stringify({ schema: 1, opus: "W-800", step: "merge", pid: 999999, start_ticks: 1, started: NOW_ISO, output: "steps/W-800.log", budget_seconds: 120, writer: "perform" }));
    writeFileSync(join(target, "W-800.log"), "{}\n");
    utimesSync(join(target, "W-800.json"), (NOW_MS - 600_000) / 1000, (NOW_MS - 600_000) / 1000);
  }
  symlinkSync(target, at);
}
for (const shape of ["symlink to a directory with a marker", "dangling symlink", "symlink to an empty directory", "regular file"] as const) {
  test(`W-558-f1 a ${shape} in place of .bisellium/steps is an error that land, retro --daily and next refuse on`, async () => {
    const w = world(`w558-f1-${shape.replace(/\W+/g, "-")}`, "backlog");
    collection(w.repo, shape);
    const m = await meanwhile();
    assert.match((m.readLocks!(w.repo, "studio", NOW_MS) as { error?: string }).error ?? "", /\.bisellium\/steps/, "the lock read is an error, never no writer");
    assert.match((m.mainWriter!(w.repo, NOW_MS) as { error?: string }).error ?? "", /\.bisellium\/steps/, "the writer read is an error");
    put(w.studio, "notes.md", "a record to land\n");
    const land = cli(w, ["land", "studio/notes.md", "--title", "chore(studio): notes", "--sella", "producer", "--studio", w.studio, "--repo", w.repo, "--now", NOW_ISO, "--poll-ms", "1", "--max-polls", "1"]);
    assert.match(land.out, /^land: refused\nwhy: refusing: the main checkout's writer lock cannot be read: \.bisellium\/steps is (?:a symlink, not a real directory|not a directory); a land now could move master under a merge queue \(W-547\); nothing committed or pushed\nway past: repair or remove what the line names, then land again\n$/, `land refuses\n${land.out}${land.err}`);
    const retro = cli(w, ["retro", "--daily", "--studio", w.studio, "--now", NOW_ISO]);
    assert.match(retro.err, /^retro --daily: refused: the main checkout's writer lock cannot be read: \.bisellium\/steps is (?:a symlink, not a real directory|not a directory); the retro waits until it reads \(W-547\)\n$/, `retro --daily refuses\n${retro.err}`);
    assert.equal(retro.status, 1, "the retro refusal exits 1");
    const n = await nextMod();
    assert.notEqual(n.readMarker!(w.repo, OPUS)?.invalid, undefined, "next's own marker read is invalid, never absent");
    const o = next(w, [OPUS, ...BUDGET]);
    assert.match(o.kv.get("meanwhile-locks") ?? "", /^unreadable: \.bisellium\/steps is (?:a symlink, not a real directory|not a directory)$/, ran("next holds on the unreadable collection", o));
  });
}

test("W-558-f1 a genuinely absent .bisellium/steps is absence, no writer and no error", async () => {
  const w = world("w558-f1-absent", "backlog");
  const m = await meanwhile();
  assert.deepEqual(m.readLocks!(w.repo, "studio", NOW_MS), { heavy: 0 }, "an absent collection is no lock");
  const n = await nextMod();
  assert.equal(n.readMarker!(w.repo, OPUS), undefined, "next's own marker read is absent");
});

/** W-558-r1 (build review round 1 #1): every component of every loader path below the main checkout is a real directory (the final file a regular file); one walk, not a per-path patch. */
type Dot = "symlink to a tree with a marker" | "dangling symlink" | "symlink to a tree with an empty steps directory";
function dotBisellium(repo: string, shape: Dot): void {
  const at = join(repo, ".bisellium");
  if (shape === "dangling symlink") return symlinkSync(join(repo, "nowhere"), at);
  const target = join(repo, "elsewhere");
  mkdirSync(join(target, "steps"), { recursive: true });
  if (shape === "symlink to a tree with a marker") {
    writeFileSync(join(target, "steps", "W-800.json"), JSON.stringify({ schema: 1, opus: "W-800", step: "merge", pid: 999999, start_ticks: 1, started: NOW_ISO, output: "steps/W-800.log", budget_seconds: 120, writer: "perform" }));
    writeFileSync(join(target, "steps", "W-800.log"), "{}\n");
    utimesSync(join(target, "steps", "W-800.json"), (NOW_MS - 600_000) / 1000, (NOW_MS - 600_000) / 1000);
  }
  symlinkSync(target, at);
}
for (const shape of ["symlink to a tree with a marker", "dangling symlink", "symlink to a tree with an empty steps directory"] as const) {
  test(`W-558-r1 a ${shape} in place of .bisellium is an error that land, retro --daily and next refuse on`, async () => {
    const w = world(`w558-r1-${shape.replace(/\W+/g, "-")}`, "backlog");
    dotBisellium(w.repo, shape);
    const why = /\.bisellium is a symlink, not a real directory/;
    const m = await meanwhile();
    assert.match((m.readLocks!(w.repo, "studio", NOW_MS) as { error?: string }).error ?? "", why, "the lock read is an error, never no writer");
    assert.match((m.mainWriter!(w.repo, NOW_MS) as { error?: string }).error ?? "", why, "the writer read is an error");
    put(w.studio, "notes.md", "a record to land\n");
    const land = cli(w, ["land", "studio/notes.md", "--title", "chore(studio): notes", "--sella", "producer", "--studio", w.studio, "--repo", w.repo, "--now", NOW_ISO, "--poll-ms", "1", "--max-polls", "1"]);
    assert.match(land.out, /^land: refused\nwhy: refusing: the main checkout's writer lock cannot be read: \.bisellium is a symlink, not a real directory; a land now could move master under a merge queue \(W-547\); nothing committed or pushed\nway past: repair or remove what the line names, then land again\n$/, `land refuses\n${land.out}${land.err}`);
    const retro = cli(w, ["retro", "--daily", "--studio", w.studio, "--now", NOW_ISO]);
    assert.match(retro.err, /^retro --daily: refused: the main checkout's writer lock cannot be read: \.bisellium is a symlink, not a real directory; the retro waits until it reads \(W-547\)\n$/, `retro --daily refuses\n${retro.err}`);
    assert.equal(retro.status, 1, "the retro refusal exits 1");
    const n = await nextMod();
    assert.match(n.readMarker!(w.repo, OPUS)?.invalid ?? "absent", why, "next's own marker read is invalid, never absent");
    const o = next(w, [OPUS, ...BUDGET]);
    assert.match(o.kv.get("meanwhile-locks") ?? "", /^unreadable: \.bisellium is a symlink, not a real directory$/, ran("next holds on the unreadable .bisellium", o));
  });
}

test("W-558-r1 a genuinely absent .bisellium is absence, no writer and no error", async () => {
  const w = world("w558-r1-absent", "backlog");
  const m = await meanwhile();
  assert.deepEqual(m.readLocks!(w.repo, "studio", NOW_MS), { heavy: 0 }, "an absent .bisellium is no lock");
  assert.deepEqual(m.mainWriter!(w.repo, NOW_MS), {}, "and no writer");
  const n = await nextMod();
  assert.equal(n.readMarker!(w.repo, OPUS), undefined, "next's own marker read is absent");
  const i = await inputs();
  assert.deepEqual(i.loadMarkers!(w.repo), { kind: "absent" }, "the markers of an absent .bisellium are absence");
});

for (const shape of ["symlink", "dangling symlink"] as const) {
  test(`W-558-r1 a ${shape} in place of .worktrees or of the studio directory is an error the lock read and the loaders refuse on`, async () => {
    const w = world(`w558-r1-wt-${shape.replace(/\W+/g, "-")}`, "backlog");
    const i = await inputs();
    const m = await meanwhile();
    const { readQueue } = await import("./queue.js");
    const target = join(w.root, "elsewhere");
    cpSync(w.studio, target, { recursive: true });
    const link = (at: string): void => symlinkSync(shape === "symlink" ? target : join(w.root, "nowhere"), at);
    // .worktrees
    link(join(w.repo, ".worktrees"));
    assert.match((m.readLocks!(w.repo, "studio", NOW_MS) as { heavyError?: string }).heavyError ?? "", /\.worktrees is a symlink, not a real directory/, "a symlinked .worktrees is a heavy-capacity error, never none");
    rmSync(join(w.repo, ".worktrees"), { recursive: true, force: true });
    // the studio directory, below its main checkout
    rmSync(w.studio, { recursive: true, force: true });
    link(w.studio);
    assert.match((m.readLocks!(w.repo, "studio", NOW_MS) as { heavyError?: string }).heavyError ?? "", /studio is a symlink, not a real directory/, "a symlinked studio directory is a heavy-capacity error");
    assert.match((i.loadOpusRecord!(w.studio, `opera/${OPUS}.md`, w.repo) as { why?: string }).why ?? "", /studio is a symlink, not a real directory/, "an opus record under a symlinked studio is an error");
    assert.match((i.loadReceipt!(w.studio, "producer", "r.json", w.repo) as { why?: string }).why ?? "", /studio is a symlink, not a real directory/, "a receipt under a symlinked studio is an error");
    const q = readQueue(w.studio, w.repo);
    assert.equal(q.kind, "held", "a queue.yml under a symlinked studio is held, never absent");
    assert.match((q as { why?: string }).why ?? "", /studio is a symlink, not a real directory/);
  });
}

test("W-558-r1 a genuinely absent studio directory or receipts collection is absence", async () => {
  const w = world("w558-r1-studio-absent", "backlog");
  const i = await inputs();
  const { readQueue } = await import("./queue.js");
  rmSync(join(w.studio, "receipts"), { recursive: true, force: true });
  assert.deepEqual(i.loadReceipt!(w.studio, "producer", "r.json", w.repo), { kind: "absent" }, "an absent receipts collection is absence");
  assert.deepEqual(readQueue(w.studio, w.repo), { kind: "absent" }, "an absent queue.yml is absence");
  assert.deepEqual(i.loadOpusRecord!(join(w.repo, "nostudio"), "opera/W-1.md", w.repo), { kind: "absent" }, "an absent studio directory is absence");
});

for (const shape of ["symlink", "dangling symlink"] as const) {
  test(`W-558-r1 the base-less forms of the loaders walk a ${shape} studio root: an error, never the target or absence`, async () => {
    const w = world(`w558-r1-nobase-${shape.replace(/\W+/g, "-")}`, "backlog");
    const i = await inputs();
    const { readQueue } = await import("./queue.js");
    const target = join(w.root, "elsewhere");
    cpSync(w.studio, target, { recursive: true });
    rmSync(w.studio, { recursive: true, force: true });
    symlinkSync(shape === "symlink" ? target : join(w.root, "nowhere"), w.studio);
    const gone = /studio is a symlink, not a real directory/;
    assert.match((i.loadOpusRecord!(w.studio, `opera/${OPUS}.md`) as { why?: string }).why ?? "", gone, "the two-argument loadOpusRecord refuses");
    assert.match((i.loadReceipt!(w.studio, "producer", "r.json") as { why?: string }).why ?? "", gone, "the three-argument loadReceipt refuses");
    const q = readQueue(w.studio);
    assert.equal(q.kind, "held", "the one-argument readQueue holds");
    assert.match((q as { why?: string }).why ?? "", gone);
  });
}

/** W-558-r2 (class census, D-085): `openHeavy` walks `receipts` and each `receipts/<sella>` before it lists them, and ages a receipt by `lstat`. */
type Where = "main" | "worktree";
const R2_SHAPES = ["symlink to a real copy", "symlink to an empty directory", "dangling symlink"] as const;
const heavyReceipt = (studio: string): void => {
  const path = join(studio, "receipts", "producer", "r.json");
  mkdirSync(join(studio, "receipts", "producer"), { recursive: true });
  writeFileSync(path, JSON.stringify({ sella: "producer", sessionId: "r", startedAt: NOW_ISO, cwd: studio, cmd: ["npm", "run", "-s", "bisellium", "--", "ci", "--opus", "W-800"], harness: "run" }));
  utimesSync(path, (NOW_MS - 60_000) / 1000, (NOW_MS - 60_000) / 1000);
};
/** The studio a row reads: main's, or the opus worktree's (a studio of `.worktrees/<id>`). */
const r2Studio = (w: World, where: Where): string => (where === "main" ? w.studio : w.wtStudio);
/** Put `shape` at `at`, a symlink to a copy of `real`, to an empty directory, or to nothing. */
function r2Link(w: World, at: string, real: string, shape: (typeof R2_SHAPES)[number], tag: string): void {
  const target = join(w.root, `r2-${tag}`);
  if (shape === "symlink to a real copy") cpSync(real, target, { recursive: true });
  else if (shape === "symlink to an empty directory") mkdirSync(target, { recursive: true });
  rmSync(at, { recursive: true, force: true });
  symlinkSync(shape === "dangling symlink" ? join(w.root, "r2-nowhere") : target, at);
}
for (const where of ["main", "worktree"] as const) {
  for (const shape of R2_SHAPES) {
    test(`W-558-r2 a ${shape} in place of receipts/ makes heavy capacity unavailable, never zero runs (${where})`, async () => {
      const w = world(`w558-r2-rc-${where}-${shape.replace(/\W+/g, "-")}`, "backlog");
      const m = await meanwhile();
      const studio = r2Studio(w, where);
      heavyReceipt(studio);
      r2Link(w, join(studio, "receipts"), join(studio, "receipts"), shape, `rc-${where}`);
      const locks = m.readLocks!(w.repo, "studio", NOW_MS) as { heavy?: number; heavyError?: string };
      assert.match(locks.heavyError ?? "", /receipts is a symlink, not a real directory/, `a ${shape} receipts/ is a heavy-capacity error, got ${JSON.stringify(locks)}`);
    });
    test(`W-558-r2 a ${shape} in place of receipts/<sella>/ makes heavy capacity unavailable (${where})`, async () => {
      const w = world(`w558-r2-sella-${where}-${shape.replace(/\W+/g, "-")}`, "backlog");
      const m = await meanwhile();
      const studio = r2Studio(w, where);
      heavyReceipt(studio);
      r2Link(w, join(studio, "receipts", "producer"), join(studio, "receipts", "producer"), shape, `sella-${where}`);
      const locks = m.readLocks!(w.repo, "studio", NOW_MS) as { heavy?: number; heavyError?: string };
      assert.match(locks.heavyError ?? "", /receipts\/producer is a symlink, not a real directory/, `a ${shape} receipts/<sella>/ is a heavy-capacity error, got ${JSON.stringify(locks)}`);
    });
  }
  test(`W-558-r2 a symlinked receipt older than the host run timeout is an error, never skipped by its age (${where})`, async () => {
    const w = world(`w558-r2-age-${where}`, "backlog");
    const m = await meanwhile();
    const studio = r2Studio(w, where);
    heavyReceipt(studio);
    const real = join(studio, "receipts", "producer", "r.json");
    const target = join(w.root, `r2-old-${where}.json`);
    cpSync(real, target);
    const old = (NOW_MS - HOST_RUN_TIMEOUT_MS - 3_600_000) / 1000;
    utimesSync(target, old, old);
    rmSync(real);
    symlinkSync(target, real);
    const locks = m.readLocks!(w.repo, "studio", NOW_MS) as { heavy?: number; heavyError?: string };
    assert.match(locks.heavyError ?? "", /r\.json/, `a symlinked receipt is an error whatever its target's age, got ${JSON.stringify(locks)}`);
  });
  test(`W-558-r2 a genuinely absent receipts/ is zero heavy runs and no error (${where})`, async () => {
    const w = world(`w558-r2-absent-${where}`, "backlog");
    const m = await meanwhile();
    const studio = r2Studio(w, where);
    rmSync(join(studio, "receipts"), { recursive: true, force: true });
    assert.deepEqual(m.readLocks!(w.repo, "studio", NOW_MS), { heavy: 0 }, "an absent receipts/ is zero runs and no error");
  });
}
