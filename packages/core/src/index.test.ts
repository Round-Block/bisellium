/**
 * Acceptance for W-013 (SQLite index + query API + snapshot cache) against
 * examples/sample-studio. `TS` is pinned so nothing here depends on the wall
 * clock — matches the studio's pinned `2026-09-18T17:00:00Z` clock (which
 * falls in aerarium period 2026-W38, examples/sample-studio/aerarium).
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readManifest, snapshotDir } from "@bisellium/adapter-native";
import { WF, type GantryEvent, type Snapshot } from "@bisellium/schema";
import { Store, EVENTS_LOG_REL } from "./store.js";
import { Index } from "./index-db.js";

const repo = resolve(process.argv[2] ?? ".");
const root = resolve(repo, "examples/sample-studio");
const TS = "2026-09-17T13:00:00Z";
const PERIOD = "2026-W38";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};
const ctx = (humanGates: Set<string>) => ({ source: "sample-studio", ts: TS, projectId: "sample-studio", humanGates });

const manifest = readManifest(root);
const humanGates = new Set(manifest.probationes.filter((p) => p.kind === "human").map((p) => p.id));
const A: Snapshot = snapshotDir(root, "sample-studio");

function freshStore(): { dir: string; store: Store } {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-index-"));
  return { dir, store: new Store({ studioDir: dir }) };
}

function withVerifying(): Snapshot {
  const B: Snapshot = structuredClone(A);
  const w2 = B.opera.find((w) => w.id === "W-002");
  if (!w2) throw new Error("fixture missing W-002");
  w2.state = "verifying";
  return B;
}

// ---- 1. rebuild from a log produced by ingesting sample-studio twice: -------
// an identical second ingest yields no new events and no new index rows, and
// an explicit rebuild() from that log matches the incrementally-built index.

{
  const { store } = freshStore();
  store.ingest(A, ctx(humanGates));
  const statsAfterFirst = store.query.stats();

  const secondBatch = store.ingest(A, ctx(humanGates));
  check("re-ingesting an identical snapshot yields no new events", secondBatch.length === 0, `${secondBatch.length} events`);

  const statsAfterSecond = store.query.stats();
  check(
    "... and the index gains no new rows",
    JSON.stringify(statsAfterSecond) === JSON.stringify(statsAfterFirst),
    `${JSON.stringify(statsAfterFirst)} vs ${JSON.stringify(statsAfterSecond)}`,
  );

  store.rebuildIndex();
  const statsAfterRebuild = store.query.stats();
  check(
    "rebuild() from that log matches the incrementally-built index",
    JSON.stringify(statsAfterRebuild) === JSON.stringify(statsAfterFirst),
    `${JSON.stringify(statsAfterFirst)} vs ${JSON.stringify(statsAfterRebuild)}`,
  );
}

// ---- 2. needsYou lists W-004's owner probatio and A-1 ------------------------

{
  const { store } = freshStore();
  store.ingest(A, ctx(humanGates));
  const needsYou = store.query.needsYou();

  check(
    "needsYou: exactly one pending human probatio",
    needsYou.probationes.length === 1,
    JSON.stringify(needsYou.probationes),
  );
  check(
    "needsYou: it is W-004's patron gate",
    needsYou.probationes[0]?.opus === "W-004" && needsYou.probationes[0]?.probatio === "patron",
    JSON.stringify(needsYou.probationes[0]),
  );
  // W-003's pending "qa" (agent) and W-005's pending "review" (agent) must
  // NOT show up — only kind:human pending gates count (docs/ADOPTION.md).
  check(
    "needsYou: agent-kind pending gates (W-003 qa, W-005 review) are excluded",
    !needsYou.probationes.some((p) => p.opus === "W-003" || p.opus === "W-005"),
    JSON.stringify(needsYou.probationes),
  );

  check("needsYou: exactly one petitio needing you", needsYou.petitiones.length === 1, JSON.stringify(needsYou.petitiones));
  const a1 = needsYou.petitiones[0];
  check(
    "needsYou: it is A-1, from eng-lead, about W-004",
    a1?.id === "A-1" && a1?.from === "eng-lead" && a1?.opus === "W-004",
    JSON.stringify(a1),
  );
  // A-2 is awaiting_reply (the Patron asked producer) — opened by "you", not
  // something needing the Patron's attention.
  check("needsYou: A-2 (awaiting_reply, opened by the Patron) is excluded", !needsYou.petitiones.some((p) => p.id === "A-2"));
}

// ---- 3. a mutated second snapshot (W-002 -> verifying) --------------------------

{
  const { store } = freshStore();
  store.ingest(A, ctx(humanGates));
  const B = withVerifying();

  const events = store.ingest(B, ctx(humanGates));
  const stateChanged = events.filter((e) => e.name === "workflow.state_changed");
  check("exactly one state_changed is appended", stateChanged.length === 1, `${stateChanged.length}`);
  check(
    "it is W-002 building -> verifying",
    stateChanged[0]?.attrs[WF.ITEM_ID] === "W-002" &&
      stateChanged[0]?.attrs[WF.STATE_FROM] === "building" &&
      stateChanged[0]?.attrs[WF.STATE_TO] === "verifying",
    JSON.stringify(stateChanged[0]),
  );

  const opus = store.query.opus("W-002");
  check("opera_state reflects the new state", opus?.state === "verifying", opus?.state);
  check("opera_state keeps W-002's collegium", opus?.collegium === "engineering", opus?.collegium);
}

// ---- 4. burn sums a synthetic usage event per collegium ------------------------

{
  const { store } = freshStore();
  store.ingest(A, ctx(humanGates));

  const usageEng: GantryEvent = {
    id: "usage:eng:1",
    name: "gen_ai.usage",
    ts: "2026-09-17T13:00:00Z",
    projectId: "sample-studio",
    attrs: { [WF.DEPARTMENT]: "engineering", "gen_ai.usage.total_tokens": 1234 },
  };
  const usageArt: GantryEvent = {
    id: "usage:art:1",
    name: "gen_ai.usage",
    ts: "2026-09-17T14:00:00Z",
    projectId: "sample-studio",
    attrs: { [WF.DEPARTMENT]: "art", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 50 },
  };
  // Outside the pinned period — must not be summed into PERIOD's total.
  const usageEngOtherWeek: GantryEvent = {
    id: "usage:eng:2",
    name: "gen_ai.usage",
    ts: "2026-08-01T00:00:00Z",
    projectId: "sample-studio",
    attrs: { [WF.DEPARTMENT]: "engineering", "gen_ai.usage.total_tokens": 999_999 },
  };
  store.query.apply([usageEng, usageArt, usageEngOtherWeek]);

  check("burn sums total_tokens for engineering", store.query.burn(PERIOD, "engineering") === 1234, `${store.query.burn(PERIOD, "engineering")}`);
  check("burn sums input+output for art", store.query.burn(PERIOD, "art") === 150, `${store.query.burn(PERIOD, "art")}`);
  check("burn ignores a usage event from a different period", store.query.burn(PERIOD, "engineering") !== 1234 + 999_999);
}

// ---- 5. restart (new Store on the same studio dir) --------------------------

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-index-"));
  const store1 = new Store({ studioDir: dir });
  const firstBatch = store1.ingest(A, ctx(humanGates));
  check("first ingest on a fresh studio dir produces events", firstBatch.length > 0, `${firstBatch.length}`);

  const store2 = new Store({ studioDir: dir }); // simulates a process restart
  const secondBatch = store2.ingest(A, ctx(humanGates)); // same snapshot, unchanged
  check(
    "restart: re-ingesting an unchanged snapshot emits zero events",
    secondBatch.length === 0,
    `${secondBatch.length} events`,
  );
}

// ---- 6. rebuildIndex equals the incremental index (compare stats()) -----------

{
  const { store } = freshStore();
  store.ingest(A, ctx(humanGates));
  store.ingest(withVerifying(), ctx(humanGates));
  const incremental = store.query.stats();

  store.rebuildIndex();
  const rebuilt = store.query.stats();

  check(
    "rebuildIndex() stats match the incrementally-built index",
    JSON.stringify(rebuilt) === JSON.stringify(incremental),
    `${JSON.stringify(incremental)} vs ${JSON.stringify(rebuilt)}`,
  );
  check("sanity: the incremental index actually recorded more than zero opera", incremental.opera > 0, `${incremental.opera}`);
}

// ---- 7. a shape-corrupt (but JSON-valid) log line never throws out of the
// Store constructor — only a JSON.parse failure is "corrupt" to readLog();
// a line like `{"id":"x"}` or `null` parses fine but isn't a real event. ----

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-index-corrupt-log-"));
  mkdirSync(join(dir, ".bisellium"), { recursive: true });
  writeFileSync(
    join(dir, EVENTS_LOG_REL),
    ['{not json', '', '{"id":"x"}', "null", '"a string"', "42"].join("\n") + "\n",
  );

  let store: Store | undefined;
  let threw: unknown;
  try {
    store = new Store({ studioDir: dir });
  } catch (e) {
    threw = e;
  }
  check("shape-corrupt log: Store construction does not throw", threw === undefined, String(threw));
  check(
    "shape-corrupt log: every bad line (1 unparseable + 4 wrong-shaped) counted as corrupt",
    store?.corruptLines === 5,
    `${store?.corruptLines}`,
  );
  check("shape-corrupt log: replay() over the sanitized log does not throw", (() => {
    try {
      store?.replay();
      return true;
    } catch {
      return false;
    }
  })(), "");
  check("shape-corrupt log: burn() over the sanitized log does not throw", (() => {
    try {
      store?.burn("engineering");
      return true;
    } catch {
      return false;
    }
  })(), "");
  store?.close();
}

// ---- 8. a corrupt SQLite index db file is rebuilt, never fatal -------------

{
  const dir = mkdtempSync(join(tmpdir(), "bisellium-index-corrupt-db-"));
  const dbDir = join(dir, ".bisellium", "index");
  mkdirSync(dbDir, { recursive: true });
  writeFileSync(join(dbDir, "index.db"), "not a sqlite file at all");

  let threw: unknown;
  let index: Index | undefined;
  try {
    index = new Index(join(dbDir, "index.db"));
  } catch (e) {
    threw = e;
  }
  check("corrupt index db: Index construction does not throw", threw === undefined, String(threw));
  check("corrupt index db: stats() reads back a fresh, empty index", index?.stats().events === 0, JSON.stringify(index?.stats()));
  index?.close();

  // And through the Store's own constructor, the same recovery applies.
  const dir2 = mkdtempSync(join(tmpdir(), "bisellium-index-corrupt-db-store-"));
  mkdirSync(join(dir2, ".bisellium", "index"), { recursive: true });
  writeFileSync(join(dir2, ".bisellium", "index", "index.db"), "also not a sqlite file");
  let threw2: unknown;
  try {
    const s = new Store({ studioDir: dir2 });
    s.close();
  } catch (e) {
    threw2 = e;
  }
  check("corrupt index db: Store construction does not throw either", threw2 === undefined, String(threw2));
}

// ---- 9. duplicate apply() never drifts stats().lastSeq off MAX(seq) -------

{
  const index = new Index(":memory:");
  const event: GantryEvent = {
    id: "dup:1",
    name: "workflow.item_appeared",
    ts: "2026-09-17T13:00:00Z",
    projectId: "sample-studio",
    attrs: { [WF.ITEM_ID]: "W-999", [WF.STATE_TO]: "backlog" },
  };
  index.apply([event]);
  const once = index.stats();
  index.apply([event]); // same id again: INSERT OR IGNORE is a no-op
  const twice = index.stats();
  check(
    "duplicate apply: events count unchanged",
    twice.events === once.events,
    `${JSON.stringify(once)} vs ${JSON.stringify(twice)}`,
  );
  check(
    "duplicate apply: lastSeq does not drift ahead of the actual row count",
    twice.lastSeq === once.lastSeq,
    `${JSON.stringify(once)} vs ${JSON.stringify(twice)}`,
  );
  index.close();
}

// ---- 10. W-016: ingest({ appendToLog: false }) never touches events.jsonl,
// and a second such ingest from a *fresh* Store instance (a separate CLI
// process, in reality) still reconciles a real change instead of colliding
// on id with the first ingest's synthetic cold-start events (both instances'
// seqBySource would otherwise reset to 0, since nothing was ever appended to
// the shared log for this source to recover it from). ------------------------

{
  const { dir, store: store1 } = freshStore();
  const logPath = join(dir, EVENTS_LOG_REL);

  const snapV1 = structuredClone(A);
  store1.ingest(snapV1, { source: "query", ts: TS, projectId: "sample-studio", humanGates, appendToLog: false });
  check("appendToLog:false: events.jsonl is never created", !existsSync(logPath));
  const opusBefore = store1.query.opus("W-002");
  check(
    "appendToLog:false: index reflects the cold ingest",
    opusBefore?.state === snapV1.opera.find((w) => w.id === "W-002")?.state,
    JSON.stringify(opusBefore),
  );
  store1.close();

  const snapV2 = withVerifying();
  const store2 = new Store({ studioDir: dir }); // a separate process, same studio dir
  store2.ingest(snapV2, { source: "query", ts: TS, projectId: "sample-studio", humanGates, appendToLog: false });
  check("appendToLog:false across fresh instances: events.jsonl still never created", !existsSync(logPath));
  const opusAfter = store2.query.opus("W-002");
  check(
    "appendToLog:false across fresh instances: a real change (building -> verifying) is not lost to an id collision",
    opusAfter?.state === "verifying",
    JSON.stringify(opusAfter),
  );
  store2.close();
}

process.exit(failed ? 1 : 0);
