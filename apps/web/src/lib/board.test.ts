/**
 * apps/web/src/lib/board.test.ts — W-064 behaviours 1-4: the pure Board
 * resolvers. Repo path at argv[2] (unused — no filesystem access here, kept
 * for the house argv-slot convention), behaviour at argv[3].
 */
import {
  boardModel,
  boardNeedsRefetch,
  cardRow,
  drawerNeedsRefetch,
  EXCLUDED_PHASES,
  gateRow,
  humanGateIds,
  liveLabel,
  NEEDS_YOU_COLUMN,
  reconcileReason,
  reconcileTargets,
  type BoardModel,
} from "./board.js";
import type { OfficinaResponse, OpusEntry } from "../api.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
}

type LifecycleFixture = Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit">;

const STANDARD_LIFECYCLE: OfficinaResponse["lifecycle"] = {
  id: "bisellium",
  states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Review", phase: "awaiting_review" },
    { id: "done", name: "Done", phase: "done" },
    { id: "halted", name: "Halted", phase: "halted" },
  ],
};

function opus(overrides: Partial<OpusEntry> = {}): OpusEntry {
  return {
    id: "W-100",
    title: "a title",
    kind: "task",
    collegium: "engineering",
    sella: "builder-a",
    state: "building",
    tokens: 0,
    probationes: {},
    traditio: undefined,
    ...overrides,
  };
}

// ===========================================================================
// Behaviour 1 — columns, membership and heads, from the served lifecycle.
// ===========================================================================

// needs_you first, then one column per declared phase in lifecycle order,
// excluding backlog.
{
  const o: LifecycleFixture = { lifecycle: STANDARD_LIFECYCLE, probationes: [] };
  const model = boardModel(o, []);
  const ids = model.columns.map((c) => c.id);
  check(1, "boardModel: needs_you first", ids[0] === NEEDS_YOU_COLUMN, JSON.stringify(ids));
  check(
    1,
    "boardModel: one column per declared phase in lifecycle order, backlog excluded",
    JSON.stringify(ids) === JSON.stringify([NEEDS_YOU_COLUMN, "planned", "in_progress", "verifying", "awaiting_review", "done", "halted"]),
    JSON.stringify(ids),
  );
  check(1, "boardModel: EXCLUDED_PHASES names backlog", EXCLUDED_PHASES.includes("backlog"));
}

// A fixture lifecycle declaring an EXTRA phase yields an extra column
// (true-by-construction: the list cannot be a constant).
{
  const extra: OfficinaResponse["lifecycle"] = {
    id: "extended",
    states: [...STANDARD_LIFECYCLE.states, { id: "archived", name: "Archived", phase: "archived" }],
  };
  const model = boardModel({ lifecycle: extra, probationes: [] }, []);
  check(1, "boardModel: an extra declared phase yields an extra column", model.columns.some((c) => c.id === "archived"), JSON.stringify(model.columns.map((c) => c.id)));
}

// A fixture OMITTING a phase (verifying) yields no verifying column.
{
  const narrowed: OfficinaResponse["lifecycle"] = {
    id: "narrow",
    states: STANDARD_LIFECYCLE.states.filter((s) => s.phase !== "verifying"),
  };
  const model = boardModel({ lifecycle: narrowed, probationes: [] }, []);
  check(1, "boardModel: omitting a phase yields no column for it", !model.columns.some((c) => c.id === "verifying"), JSON.stringify(model.columns.map((c) => c.id)));
}

// Every column returned even when every one is empty.
{
  const model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [] }, []);
  check(1, "boardModel: returns every column when all are empty", model.columns.length === 7, String(model.columns.length));
  check(1, "boardModel: every column starts with zero cards", model.columns.every((c) => c.cards.length === 0));
}

// Each opus lands in the column matching its state's phase.
{
  const opera = [opus({ id: "W-1", state: "building" }), opus({ id: "W-2", state: "review" })];
  const model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [] }, opera);
  const inProgress = model.columns.find((c) => c.id === "in_progress");
  const awaitingReview = model.columns.find((c) => c.id === "awaiting_review");
  check(1, "boardModel: an opus lands in its state's phase column", inProgress?.cards.some((c) => c.id === "W-1") === true, JSON.stringify(inProgress));
  check(1, "boardModel: a different opus lands in a different phase column", awaitingReview?.cards.some((c) => c.id === "W-2") === true, JSON.stringify(awaitingReview));
}

// A backlog opus lands in NO column and is counted in Planned's backlogCount.
{
  const opera = [opus({ id: "W-1", state: "backlog" }), opus({ id: "W-2", state: "backlog" })];
  const model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [] }, opera);
  const inAnyColumn = model.columns.some((c) => c.cards.some((card) => card.id === "W-1" || card.id === "W-2"));
  const planned = model.columns.find((c) => c.id === "planned");
  check(1, "boardModel: a backlog opus lands in no column", !inAnyColumn);
  check(1, "boardModel: Planned's backlogCount counts the backlog opera", planned?.backlogCount === 2, JSON.stringify(planned));
  check(1, "boardModel: unplaced does not include backlog opera", !model.unplaced.includes("W-1") && !model.unplaced.includes("W-2"));
}

// An opus whose state maps to no declared phase lands in no column, is named
// in unplaced, no throw.
{
  const opera = [opus({ id: "W-9", state: "mystery-state" })];
  let model: BoardModel = { columns: [], unplaced: [] };
  let threw = false;
  try {
    model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [] }, opera);
  } catch {
    threw = true;
  }
  check(1, "boardModel: an unmapped state does not throw", !threw);
  check(1, "boardModel: an unmapped state is named in unplaced", model.unplaced.includes("W-9"), JSON.stringify(model.unplaced));
  check(1, "boardModel: an unmapped-state opus lands in no column", !model.columns.some((c) => c.cards.some((card) => card.id === "W-9")));
}

// An opus with a pending human gate appears in needs_you AND its phase
// column, needsYou:true on both.
{
  const probationes: OfficinaResponse["probationes"] = [{ id: "review-gate", kind: "human" }];
  const opera = [opus({ id: "W-5", state: "review", probationes: { "review-gate": { status: "pending" } } })];
  const model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes }, opera);
  const needsYou = model.columns.find((c) => c.id === NEEDS_YOU_COLUMN);
  const awaitingReview = model.columns.find((c) => c.id === "awaiting_review");
  const inNeedsYou = needsYou?.cards.find((c) => c.id === "W-5");
  const inPhase = awaitingReview?.cards.find((c) => c.id === "W-5");
  check(1, "boardModel: a needs-you opus appears in needs_you", inNeedsYou !== undefined, JSON.stringify(needsYou));
  check(1, "boardModel: a needs-you opus ALSO appears in its phase column", inPhase !== undefined, JSON.stringify(awaitingReview));
  check(1, "boardModel: needsYou is true on the needs_you copy", inNeedsYou?.needsYou === true);
  check(1, "boardModel: needsYou is true on the phase-column copy too", inPhase?.needsYou === true);
}

// needs_you carries membership:true; pinned only on needs_you.
{
  const model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [] }, []);
  const needsYou = model.columns.find((c) => c.id === NEEDS_YOU_COLUMN);
  check(1, "boardModel: needs_you carries membership:true", needsYou?.membership === true);
  check(1, "boardModel: pinned is true only on needs_you", model.columns.every((c) => (c.id === NEEDS_YOU_COLUMN ? c.pinned === true : c.pinned === false)));
}

// The model exposes NO total: exact key-set assertion.
{
  const model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [] }, [opus({ id: "W-1", state: "backlog" })]);
  check(1, "boardModel: Object.keys(model) is exactly [columns, unplaced]", JSON.stringify(Object.keys(model).sort()) === JSON.stringify(["columns", "unplaced"]), JSON.stringify(Object.keys(model)));
  const planned = model.columns.find((c) => c.id === "planned");
  check(1, "boardModel: Planned's own keys are exactly its declared set", planned !== undefined && JSON.stringify(Object.keys(planned).sort()) === JSON.stringify(["atCap", "backlogCount", "cards", "id", "membership", "name", "pinned"].sort()), JSON.stringify(planned));
  const done = model.columns.find((c) => c.id === "done");
  check(1, "boardModel: a plain phase column (no cap, no backlogCount) has exactly its base keys", done !== undefined && JSON.stringify(Object.keys(done).sort()) === JSON.stringify(["atCap", "cards", "id", "membership", "name", "pinned"].sort()), JSON.stringify(done));
}

// cap present on in_progress only, equal to wip_limit; atCap true at/over cap.
{
  const opera = [opus({ id: "W-1", state: "building" }), opus({ id: "W-2", state: "building" })];
  const model = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [], wip_limit: 2 }, opera);
  const inProgress = model.columns.find((c) => c.id === "in_progress");
  const planned = model.columns.find((c) => c.id === "planned");
  check(1, "boardModel: cap present on in_progress only, equal to wip_limit", inProgress?.cap === 2 && planned?.cap === undefined, JSON.stringify({ inProgress, planned }));
  check(1, "boardModel: atCap true at the cap", inProgress?.atCap === true);

  const overCap = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [], wip_limit: 1 }, opera).columns.find((c) => c.id === "in_progress");
  check(1, "boardModel: atCap true one past the cap", overCap?.atCap === true);

  const underCap = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [], wip_limit: 5 }, opera).columns.find((c) => c.id === "in_progress");
  check(1, "boardModel: atCap false below the cap", underCap?.atCap === false);
}

// wip_limit absent: cap absent, nothing throws.
{
  let threw = false;
  let inProgress: BoardModel["columns"][number] | undefined;
  try {
    inProgress = boardModel({ lifecycle: STANDARD_LIFECYCLE, probationes: [] }, []).columns.find((c) => c.id === "in_progress");
  } catch {
    threw = true;
  }
  check(1, "boardModel: wip_limit absent does not throw", !threw);
  check(1, "boardModel: wip_limit absent — cap absent", inProgress?.cap === undefined);
}

// ===========================================================================
// Behaviour 2 — cards and the gate ladder, from records.
// ===========================================================================

{
  const declared: OfficinaResponse["probationes"] = [
    { id: "spec", kind: "automated" },
    { id: "review", kind: "human" },
    { id: "ci", kind: "automated" },
  ];
  check(2, "humanGateIds: picks exactly the kind:human probationes", JSON.stringify([...humanGateIds({ probationes: declared })]) === JSON.stringify(["review"]));
}

// gateRow returns one Gate per DECLARED probatio in MANIFEST order — not the
// opus's own key order.
{
  const declared: OfficinaResponse["probationes"] = [
    { id: "spec", kind: "automated" },
    { id: "review", kind: "human" },
    { id: "ci", kind: "automated" },
  ];
  const results: OpusEntry["probationes"] = {
    ci: { status: "passed" },
    spec: { status: "passed" },
    review: { status: "passed" },
    ghost: { status: "failed" }, // undeclared — must be ignored
  };
  const gates = gateRow(declared, results);
  check(2, "gateRow: manifest order, not the opus's own key order", JSON.stringify(gates.map((g) => g.id)) === JSON.stringify(["spec", "review", "ci"]), JSON.stringify(gates));
  check(2, "gateRow: a result for an undeclared gate is ignored", !gates.some((g) => g.id === "ghost"));
  check(2, "gateRow: a passed human gate maps to human_passed (ok-filled)", gates.find((g) => g.id === "review")?.status === "human_passed", JSON.stringify(gates));
  check(2, "gateRow: a passed automated gate maps to passed (filled)", gates.find((g) => g.id === "spec")?.status === "passed");
}

// A declared gate with no result is pending; stale reuses the pending mark.
{
  const declared: OfficinaResponse["probationes"] = [
    { id: "spec", kind: "automated" },
    { id: "stale-one", kind: "automated" },
  ];
  const results: OpusEntry["probationes"] = { "stale-one": { status: "stale" } };
  const gates = gateRow(declared, results);
  check(2, "gateRow: a declared gate with no result is pending", gates.find((g) => g.id === "spec")?.status === "pending", JSON.stringify(gates));
  check(2, "gateRow: stale maps to the pending mark", gates.find((g) => g.id === "stale-one")?.status === "pending", JSON.stringify(gates));
}

// cardRow: id, title, sella, native state, blocked when any gate failed;
// blocked and needsYou are independent.
{
  const human = new Set(["review"]);
  const o = opus({ id: "W-1", title: "a train", sella: "builder-a", state: "building", probationes: { ci: { status: "failed" }, review: { status: "pending" } } });
  const card = cardRow(o, human);
  check(2, "cardRow: carries id/title/sella/native-state", card.id === "W-1" && card.title === "a train" && card.sella === "builder-a" && card.state === "building", JSON.stringify(card));
  check(2, "cardRow: blocked:true when any gate failed", card.blocked === true);
  check(2, "cardRow: needsYou:true when a human gate is pending", card.needsYou === true);

  const notBlockedButNeedsYou = cardRow(opus({ probationes: { review: { status: "pending" } } }), human);
  check(2, "cardRow: needsYou true, blocked false — independent", notBlockedButNeedsYou.needsYou === true && notBlockedButNeedsYou.blocked === false);

  const blockedButNotNeedsYou = cardRow(opus({ probationes: { ci: { status: "failed" } } }), human);
  check(2, "cardRow: blocked true, needsYou false — independent", blockedButNotNeedsYou.blocked === true && blockedButNotNeedsYou.needsYou === false);
}

// ===========================================================================
// Behaviour 3 — liveness and the reconciliation contract.
// ===========================================================================

{
  const now = new Date("2026-09-25T12:00:00.000Z");
  const connectedNoRefresh = liveLabel({ connected: true, now });
  check(3, "liveLabel: connected, no refresh — says connected", connectedNoRefresh.length > 0, connectedNoRefresh);
  check(3, "liveLabel: connected, no refresh — never says updated", !connectedNoRefresh.includes("updated"), connectedNoRefresh);

  const connectedWithRefresh = liveLabel({ connected: true, lastRefreshAt: "2026-09-25T11:58:00.000Z", now });
  check(3, "liveLabel: renders lastRefreshAt", connectedWithRefresh.includes("2026-09-25T11:58:00.000Z"), connectedWithRefresh);
  check(3, "liveLabel: never renders `now` instead", !connectedWithRefresh.includes("2026-09-25T12:00:00.000Z"), connectedWithRefresh);

  const disconnected = liveLabel({ connected: false, lastRefreshAt: "2026-09-25T11:58:00.000Z", now });
  check(3, "liveLabel: disconnected — says so", disconnected.length > 0, disconnected);
  check(3, "liveLabel: disconnected — never contains 'live'", !disconnected.toLowerCase().includes("live"), disconnected);

  const bad = liveLabel({ connected: true, lastRefreshAt: "not-a-date", now });
  check(3, "liveLabel: an unparseable lastRefreshAt degrades, never 'Invalid Date'", !bad.includes("Invalid Date"), bad);
}

{
  check(3, 'reconcileReason: "initial" on the first connect', reconcileReason({ connected: false, everFetched: false }, { connected: true }) === "initial");
  check(3, 'reconcileReason: "reconnect" on a connect after a disconnect', reconcileReason({ connected: false, everFetched: true }, { connected: true }) === "reconnect");
  check(3, "reconcileReason: undefined on a repeated connected:true (no periodic reconciliation)", reconcileReason({ connected: true, everFetched: true }, { connected: true }) === undefined);
  check(3, "reconcileReason: undefined on going disconnected", reconcileReason({ connected: true, everFetched: true }, { connected: false }) === undefined);
}

{
  check(3, "reconcileTargets: exactly the three base paths with no selection", JSON.stringify(reconcileTargets(undefined).slice().sort()) === JSON.stringify(["/api/inbox", "/api/officina", "/api/opera"].sort()), JSON.stringify(reconcileTargets(undefined)));
  const withSelection = reconcileTargets("W-002");
  check(3, "reconcileTargets: with a selection, those three PLUS the item's events", withSelection.includes("/api/officina") && withSelection.includes("/api/opera") && withSelection.includes("/api/inbox") && withSelection.some((t) => t.includes("/api/events") && t.includes("W-002")), JSON.stringify(withSelection));
  check(3, "reconcileTargets: with a selection, exactly four targets (dropping the fourth is a red)", withSelection.length === 4, JSON.stringify(withSelection));
}

// ===========================================================================
// Behaviour 4 — the refetch predicates.
// ===========================================================================

{
  const relevant = ["workflow.item_appeared", "workflow.state_changed", "workflow.gate_evaluated", "workflow.actor_assigned", "workflow.item_removed", "workflow.attention"];
  for (const name of relevant) check(4, `boardNeedsRefetch: true for ${name}`, boardNeedsRefetch({ name }) === true);
  const irrelevant = ["workflow.digest", "provider.status", "gen_ai.usage", "some.unknown.name"];
  for (const name of irrelevant) check(4, `boardNeedsRefetch: false for ${name}`, boardNeedsRefetch({ name }) === false);
}

{
  const relevantForItem = { name: "workflow.state_changed", attrs: { "workflow.item.id": "W-002" } };
  const relevantForOther = { name: "workflow.state_changed", attrs: { "workflow.item.id": "W-003" } };
  const irrelevant = { name: "workflow.digest", attrs: { "workflow.item.id": "W-002" } };
  check(4, "drawerNeedsRefetch: true for a relevant frame naming the selection", drawerNeedsRefetch(relevantForItem, "W-002") === true);
  check(4, "drawerNeedsRefetch: false for a relevant frame naming another item", drawerNeedsRefetch(relevantForOther, "W-002") === false);
  check(4, "drawerNeedsRefetch: false for an irrelevant frame naming the selection", drawerNeedsRefetch(irrelevant, "W-002") === false);
  check(4, "drawerNeedsRefetch: false with no selection", drawerNeedsRefetch(relevantForItem, undefined) === false);
}

process.exit(failed ? 1 : 0);
