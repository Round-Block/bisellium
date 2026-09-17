/**
 * Acceptance for W-003 (JSONL log and snapshot differ) against
 * examples/sample-studio. `ts` is pinned so nothing here depends on the
 * wall clock.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { snapshotDir } from "@bisellium/adapter-native";
import { WF, type GantryEvent, type Snapshot } from "@bisellium/schema";
import { diffSnapshots } from "./differ.js";
import { appendEvents, readEvents, readLog } from "./log.js";
import { Store } from "./store.js";

const repo = resolve(process.argv[2] ?? ".");
const root = resolve(repo, "examples/sample-studio");
const TS = "2026-09-17T13:00:00Z";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail}`);
  if (!ok) failed++;
};
const ctx = (source: string, seq: number) => ({ source, seq, ts: TS, projectId: "sample-studio" });
const count = (events: GantryEvent[], name: string) => events.filter((e) => e.name === name).length;

const A: Snapshot = snapshotDir(root, "sample-studio");

// ---- diff(null, A): everything appears ---------------------------------------

{
  const { events } = diffSnapshots(null, A, ctx("sample-studio", 0));
  check(
    "diff(null, A): one item_appeared per work item",
    count(events, "workflow.item_appeared") === A.opera.length,
    `${count(events, "workflow.item_appeared")} vs ${A.opera.length}`,
  );
  check(
    "diff(null, A): one attention per petitio",
    count(events, "workflow.attention") === (A.petitiones?.length ?? 0),
    `${count(events, "workflow.attention")} vs ${A.petitiones?.length ?? 0}`,
  );
  check(
    "diff(null, A): one digest per entry",
    count(events, "workflow.digest") === (A.acta?.length ?? 0),
    `${count(events, "workflow.digest")} vs ${A.acta?.length ?? 0}`,
  );
  check(
    "diff(null, A): one provider.status per provider",
    count(events, "provider.status") === (A.providers?.length ?? 0),
    `${count(events, "provider.status")} vs ${A.providers?.length ?? 0}`,
  );
  check("diff(null, A): no state_changed on first appearance", count(events, "workflow.state_changed") === 0);

  // Cold appearance still replays gates: a gate already recorded on an item
  // at ingest time must not silently un-happen.
  const totalGates = A.opera.reduce((n, w) => n + Object.keys(w.probationes).length, 0);
  check(
    "diff(null, A): one gate_evaluated per recorded gate on appearance",
    count(events, "workflow.gate_evaluated") === totalGates,
    `${count(events, "workflow.gate_evaluated")} vs ${totalGates}`,
  );

  const artActum = events.find((e) => e.name === "workflow.digest" && e.attrs[WF.DIGEST_ID] === "2026-09-17-art-daily");
  check(
    "diff(null, A): digest by art-lead carries DEPARTMENT art",
    artActum?.attrs[WF.DEPARTMENT] === "art",
    String(artActum?.attrs[WF.DEPARTMENT]),
  );
}

// ---- diff(A, A): identical snapshots yield nothing ---------------------------

{
  const { events } = diffSnapshots(A, A, ctx("sample-studio", 0));
  check("diff(A, A): zero events", events.length === 0, `${events.length} events`);
}

// ---- diff(A, B): a handful of real changes -----------------------------------

const B: Snapshot = structuredClone(A);
{
  const w2 = B.opera.find((w) => w.id === "W-002");
  if (!w2) throw new Error("fixture missing W-002");
  w2.state = "verifying";

  const w3 = B.opera.find((w) => w.id === "W-003");
  if (!w3) throw new Error("fixture missing W-003");
  const tests = w3.probationes["tests"];
  if (!tests) throw new Error("fixture W-003 missing tests gate");
  w3.probationes["tests"] = { ...tests, status: "passed", evidence: { href: tests.evidence?.href ?? "ci/812.log", certifies: "x" } };

  const a1 = (B.petitiones ?? []).find((t) => t.id === "A-1");
  if (!a1) throw new Error("fixture missing petitio A-1");
  a1.state = "resolved";

  const claude = (B.providers ?? []).find((p) => p.id === "claude");
  if (!claude) throw new Error("fixture missing provider claude");
  claude.usagePct = 90;
}

{
  const { events } = diffSnapshots(A, B, ctx("sample-studio", 7));
  check("diff(A, B): exactly one state_changed", count(events, "workflow.state_changed") === 1, `${count(events, "workflow.state_changed")}`);
  check("diff(A, B): exactly one gate_evaluated", count(events, "workflow.gate_evaluated") === 1, `${count(events, "workflow.gate_evaluated")}`);
  check("diff(A, B): exactly one attention", count(events, "workflow.attention") === 1, `${count(events, "workflow.attention")}`);
  check("diff(A, B): exactly one provider.status", count(events, "provider.status") === 1, `${count(events, "provider.status")}`);

  const stateChanged = events.find((e) => e.name === "workflow.state_changed");
  check(
    "diff(A, B): state_changed is W-002 building -> verifying",
    stateChanged?.attrs[WF.ITEM_ID] === "W-002" &&
      stateChanged.attrs[WF.STATE_FROM] === "building" &&
      stateChanged.attrs[WF.STATE_TO] === "verifying",
  );
  const gateEvaluated = events.find((e) => e.name === "workflow.gate_evaluated");
  check(
    "diff(A, B): gate_evaluated is W-003 tests -> passed",
    gateEvaluated?.attrs[WF.ITEM_ID] === "W-003" &&
      gateEvaluated.attrs[WF.GATE_ID] === "tests" &&
      gateEvaluated.attrs[WF.GATE_STATUS] === "passed",
  );

  check(
    "diff(A, B): every event has TIME_DERIVED true",
    events.every((e) => e.attrs[WF.TIME_DERIVED] === true),
  );
  const seqs = events.map((e) => e.attrs[WF.SOURCE_SEQ]);
  check(
    "diff(A, B): SOURCE_SEQ strictly increases",
    seqs.every((s, i) => i === 0 || (typeof s === "number" && typeof seqs[i - 1] === "number" && s > (seqs[i - 1] as number))),
    seqs.join(","),
  );
}

// ---- diff(A, C): an evidence href-only change is not a re-evaluation ---------

{
  const C: Snapshot = structuredClone(A);
  const w1 = C.opera.find((w) => w.id === "W-001");
  if (!w1) throw new Error("fixture missing W-001");
  const review = w1.probationes["review"];
  if (!review) throw new Error("fixture W-001 missing review gate");
  // Same status, same certifies — only the link moved.
  w1.probationes["review"] = { ...review, evidence: { href: "reviews/W-001-mirror.md", certifies: review.evidence?.certifies } };

  const { events } = diffSnapshots(A, C, ctx("sample-studio", 0));
  check("diff(A, C): evidence href-only change emits nothing", events.length === 0, `${events.length} events`);
}

// ---- Store round-trip ----------------------------------------------------------

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-core-"));
  const logPath = join(dir, "events.jsonl");
  const store = new Store(logPath);
  const ev1 = store.ingest(A, { source: "sample-studio", ts: TS, projectId: "sample-studio" });
  const ev2 = store.ingest(B, { source: "sample-studio", ts: TS, projectId: "sample-studio" });

  const onDisk = readEvents(logPath);
  check(
    "Store: readEvents length equals sum of ingested events",
    onDisk.length === ev1.length + ev2.length,
    `${onDisk.length} vs ${ev1.length + ev2.length}`,
  );
  check("Store: events() matches readEvents length", store.events().length === onDisk.length);

  const replay = store.replay();
  check("Store: replay() shows W-002 verifying", replay.items.get("W-002")?.state === "verifying", replay.items.get("W-002")?.state);
  check("Store: fresh Store has zero corrupt lines", store.corruptLines === 0, `${store.corruptLines}`);
}

// ---- replay() on a cold ingest is truthful about gates -----------------------

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-core-"));
  const logPath = join(dir, "events.jsonl");
  const store = new Store(logPath);
  store.ingest(A, { source: "sample-studio", ts: TS, projectId: "sample-studio" });

  const replay = store.replay();
  const w1 = replay.items.get("W-001");
  check(
    "cold ingest: replay() shows W-001 gates tests/qa/review passed",
    w1?.gates["tests"] === "passed" && w1?.gates["qa"] === "passed" && w1?.gates["review"] === "passed",
    JSON.stringify(w1?.gates),
  );
  check("cold ingest: replay() exposes W-001 sella", w1?.sella === "builder-2", w1?.sella);
  check("cold ingest: replay() exposes W-001 collegium", w1?.collegium === "engineering", w1?.collegium);
}

// ---- a corrupt middle line is skipped and counted, not fatal -----------------

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-core-"));
  const logPath = join(dir, "events.jsonl");
  const good1: GantryEvent = { id: "x:0", name: "workflow.digest", ts: TS, projectId: "p", attrs: { [WF.DIGEST_ID]: "d1" } };
  const good2: GantryEvent = { id: "x:1", name: "workflow.digest", ts: TS, projectId: "p", attrs: { [WF.DIGEST_ID]: "d2" } };
  writeFileSync(logPath, `${JSON.stringify(good1)}\nnot json at all\n${JSON.stringify(good2)}\n`, "utf8");

  const { events, skipped } = readLog(logPath);
  check("readLog: corrupt middle line is skipped, not thrown", events.length === 2, `${events.length} events`);
  check("readLog: corrupt middle line is counted", skipped === 1, `${skipped} skipped`);

  const store = new Store(logPath);
  check("Store: constructor does not throw on a corrupt log", store.events().length === 2, `${store.events().length}`);
  check("Store: corruptLines records the skipped count", store.corruptLines === 1, `${store.corruptLines}`);
}

// ---- ingesting into an existing log resumes SOURCE_SEQ ------------------------

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-core-"));
  const logPath = join(dir, "events.jsonl");

  const store1 = new Store(logPath);
  const firstBatch = store1.ingest(A, { source: "sample-studio", ts: TS, projectId: "sample-studio" });
  const lastSeq = Math.max(...firstBatch.map((e) => Number(e.attrs[WF.SOURCE_SEQ])));

  // A fresh Store re-opening the same log (as a restarted process would).
  const store2 = new Store(logPath);
  const secondBatch = store2.ingest(B, { source: "sample-studio", ts: TS, projectId: "sample-studio" });
  const firstResumedSeq = Math.min(...secondBatch.map((e) => Number(e.attrs[WF.SOURCE_SEQ])));

  check(
    "resumed Store: SOURCE_SEQ continues after the last seq on disk",
    firstResumedSeq === lastSeq + 1,
    `${firstResumedSeq} vs ${lastSeq + 1}`,
  );
}

// ---- readLog: newline guard — appending twice onto a file missing a trailing newline ----

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-core-"));
  const logPath = join(dir, "events.jsonl");
  const e1: GantryEvent = { id: "y:0", name: "workflow.digest", ts: TS, projectId: "p", attrs: { [WF.DIGEST_ID]: "d1" } };
  const e2: GantryEvent = { id: "y:1", name: "workflow.digest", ts: TS, projectId: "p", attrs: { [WF.DIGEST_ID]: "d2" } };
  writeFileSync(logPath, JSON.stringify(e1)); // hand-written, no trailing newline
  appendEvents(logPath, [e2]);

  const { events, skipped } = readLog(logPath);
  check(
    "readLog: newline guard — both lines parse after appending onto a file without a trailing newline",
    events.length === 2 && skipped === 0,
    `${events.length} events, ${skipped} skipped`,
  );
}

// ---- readLog / Store: a non-ENOENT fs error must throw, not read as "no log" ----

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-core-"));
  // dir is a directory, not a file: readFileSync fails with EISDIR, not ENOENT.
  let threw = false;
  try {
    readLog(dir);
  } catch {
    threw = true;
  }
  check("readLog: non-ENOENT fs error (EISDIR on a directory) propagates", threw);

  let storeThrew = false;
  try {
    new Store(dir);
  } catch {
    storeThrew = true;
  }
  check("Store: constructor lets a non-ENOENT readLog error propagate", storeThrew);
}

process.exit(failed ? 1 : 0);
