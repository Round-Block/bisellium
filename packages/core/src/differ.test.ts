/**
 * Acceptance for W-003 (JSONL log and snapshot differ) against
 * examples/sample-studio. `ts` is pinned so nothing here depends on the
 * wall clock.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { snapshotDir } from "@bisellium/adapter-native";
import { WF, type GantryEvent, type Snapshot } from "@bisellium/schema";
import { diffSnapshots } from "./differ.js";
import { readEvents } from "./log.js";
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
    count(events, "workflow.item_appeared") === A.workItems.length,
    `${count(events, "workflow.item_appeared")} vs ${A.workItems.length}`,
  );
  check(
    "diff(null, A): one attention per thread",
    count(events, "workflow.attention") === (A.threads?.length ?? 0),
    `${count(events, "workflow.attention")} vs ${A.threads?.length ?? 0}`,
  );
  check(
    "diff(null, A): one digest per entry",
    count(events, "workflow.digest") === (A.digest?.length ?? 0),
    `${count(events, "workflow.digest")} vs ${A.digest?.length ?? 0}`,
  );
  check(
    "diff(null, A): one provider.status per provider",
    count(events, "provider.status") === (A.providers?.length ?? 0),
    `${count(events, "provider.status")} vs ${A.providers?.length ?? 0}`,
  );
  check(
    "diff(null, A): no state_changed/gate_evaluated on first appearance",
    count(events, "workflow.state_changed") === 0 && count(events, "workflow.gate_evaluated") === 0,
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
  const w2 = B.workItems.find((w) => w.id === "W-002");
  if (!w2) throw new Error("fixture missing W-002");
  w2.state = "verifying";

  const w3 = B.workItems.find((w) => w.id === "W-003");
  if (!w3) throw new Error("fixture missing W-003");
  const tests = w3.gateStatus["tests"];
  if (!tests) throw new Error("fixture W-003 missing tests gate");
  w3.gateStatus["tests"] = { ...tests, status: "passed", evidence: { href: tests.evidence?.href ?? "ci/812.log", certifies: "x" } };

  const a1 = (B.threads ?? []).find((t) => t.id === "A-1");
  if (!a1) throw new Error("fixture missing thread A-1");
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
}

process.exit(failed ? 1 : 0);
