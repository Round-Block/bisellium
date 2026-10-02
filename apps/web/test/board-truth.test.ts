/**
 * W-129 behaviours 1-2: the board tells the whole truth about Planned. Backlog
 * opera are cards in Planned (1) and the view draws them, escapes their text and
 * says when branch records are degraded (2). Select exactly one numbered
 * behaviour with `--behaviour N` (1..2); omitting the selector runs both.
 * node:test TAP, one test() per behaviour, modelled on ladder-followon.test.ts.
 *
 * Run with apps/web as the working directory and the css stub preloaded (the
 * root tsconfig does not carry the web JSX settings):
 *   (cd apps/web && node --test-reporter=tap --import ./test/support/register-css-stub.mjs --import tsx test/board-truth.test.ts)
 *
 * `branchNote` does not exist before the fix, so board.js is a NAMESPACE import and
 * `board.branchNote` is only reached in a row after the behaviour's Genuine red
 * row. No timers, sleeps or polling.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OfficinaResponse, OpusEntry } from "../src/api.js";
import * as board from "../src/lib/board.js";
import { BoardView, type BoardViewProps } from "../src/screens/BoardView.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 1 || only! > 2)) {
  console.error("board-truth.test.ts: --behaviour must be an integer from 1 through 2");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

const LIFECYCLE: OfficinaResponse["lifecycle"] = {
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
const DECLARED: OfficinaResponse["probationes"] = [
  { id: "spec", kind: "agent" },
  { id: "review", kind: "agent" },
  { id: "approve", kind: "human" },
];
const HOSTILE = "<img src=x onerror=alert(1)>";
const HOSTILE_ESCAPED = "&lt;img src=x onerror=alert(1)&gt;";

function opus(id: string, state: string, overrides: Partial<OpusEntry> = {}): OpusEntry {
  return {
    id,
    title: `title of ${id}`,
    body: "",
    kind: "task",
    collegium: "engineering",
    sella: "builder",
    state,
    tokens: 0,
    probationes: {},
    traditio: undefined,
    ...overrides,
  };
}
/** W-1 greenlit, W-2 backlog, W-3 backlog, W-4 building, W-5 greenlit, in that arrival order. */
function standardOpera(overrides: Record<string, Partial<OpusEntry>> = {}): OpusEntry[] {
  const rows: [string, string][] = [
    ["W-1", "greenlit"],
    ["W-2", "backlog"],
    ["W-3", "backlog"],
    ["W-4", "building"],
    ["W-5", "greenlit"],
  ];
  return rows.map(([id, state]) => opus(id, state, overrides[id] ?? {}));
}
const standard = { lifecycle: LIFECYCLE, probationes: DECLARED };

const cardIds = (model: board.BoardModel, columnId: string): string[] =>
  (model.columns.find((c) => c.id === columnId)?.cards ?? []).map((c) => c.id);

if (runs(1)) {
  test("W-129 behaviour 1: backlog opera are cards in Planned, after the greenlit ones", () => {
    const opera = standardOpera({ "W-3": { probationes: { spec: { status: "passed" } } } });
    const model = board.boardModel(standard, opera);

    // (a) passes today
    assert.deepEqual(cardIds(model, "in_progress"), ["W-4"], "1(a): in_progress holds exactly W-4");
    assert.deepEqual(cardIds(model, "planned").slice(0, 2), ["W-1", "W-5"], "1(a): Planned's first two cards are W-1, W-5");

    // (b) Genuine red
    assert.deepEqual(cardIds(model, "planned"), ["W-1", "W-5", "W-2", "W-3"], "1(b): Planned holds the greenlit cards, then the backlog cards");

    // (c)
    assert.deepEqual(
      model.columns.map((c) => c.id),
      ["needs_you", "planned", "in_progress", "verifying", "awaiting_review", "done", "halted"],
      "1(c): the column ids are the seven phases plus needs_you, no backlog column",
    );
    const planned = model.columns.find((c) => c.id === "planned");
    assert.ok(planned, "1(c): a Planned column exists");
    for (const id of ["W-2", "W-3"]) {
      const card = planned.cards.find((c) => c.id === id);
      assert.ok(card, `1(c): ${id} is a card in Planned`);
      assert.equal(card.state, "backlog", `1(c): ${id} carries the native state backlog`);
      assert.deepEqual(card.gates, board.gateRow(DECLARED, opera.find((o) => o.id === id)!.probationes), `1(c): ${id} carries the full gate row`);
    }
    assert.deepEqual(model.unplaced, [], "1(c): unplaced is empty");

    // (d)
    for (const col of model.columns) {
      assert.ok(!("backlogCount" in col), `1(d): column ${col.id} has no backlogCount key`);
      assert.deepEqual(
        Object.keys(col).sort(),
        ["atCap", "cards", "id", "membership", "name", "pinned"],
        `1(d): column ${col.id} has exactly its base key set`,
      );
    }
    assert.ok(!("EXCLUDED_PHASES" in board), "1(d): EXCLUDED_PHASES is not an export of board.js");

    // (e)
    const noPlanned: OfficinaResponse["lifecycle"] = {
      id: "bare",
      states: [
        { id: "backlog", name: "Backlog", phase: "backlog" },
        { id: "building", name: "Building", phase: "in_progress" },
        { id: "done", name: "Done", phase: "done" },
      ],
    };
    const bare = board.boardModel(
      { lifecycle: noPlanned, probationes: DECLARED },
      [opus("W-2", "backlog"), opus("W-3", "backlog"), opus("W-4", "building")],
    );
    assert.deepEqual(bare.unplaced, ["W-2", "W-3"], "1(e): with no planned phase the backlog ids are unplaced");
    const gated = board.boardModel(standard, [opus("W-6", "backlog", { probationes: { approve: { status: "pending" } } })]);
    assert.deepEqual(cardIds(gated, "needs_you"), ["W-6"], "1(e): a backlog opus with a pending human gate is in needs_you");
    assert.deepEqual(cardIds(gated, "planned"), ["W-6"], "1(e): and in Planned");
  });
}

if (runs(2)) {
  test("W-129 behaviour 2: the board view draws the backlog cards, escapes their text, and says when branch records are degraded", () => {
    const opera = standardOpera({ "W-2": { title: HOSTILE } });
    const model = board.boardModel(standard, opera);
    const props = (extra: object = {}): BoardViewProps =>
      ({ studio: "fixture", model, focusedByColumn: {}, onSelectCard: () => undefined, ...extra }) as BoardViewProps;
    const html = renderToStaticMarkup(BoardView(props()));

    // (a) Genuine red
    const head = /<div class="board__column-head"[^>]*><span class="board__column-name">Planned<\/span><span class="board__column-count">(\d+)<\/span>/.exec(html);
    assert.equal(head?.[1], "4", "2(a): the Planned column head count is 4");

    // (b)
    const start = html.indexOf('<div class="board__column" data-column-id="planned">');
    assert.ok(start >= 0, "2(b): the Planned column is in the markup");
    const next = html.indexOf('<div class="board__column" data-column-id="', start + 10);
    const plannedHtml = html.slice(start, next === -1 ? undefined : next);
    for (const id of ["W-2", "W-3"]) {
      const at = plannedHtml.indexOf(`data-card-id="${id}"`);
      assert.ok(at >= 0, `2(b): ${id} is a card inside the Planned column`);
      const rest = plannedHtml.slice(at + 1);
      const end = rest.indexOf("data-card-id=");
      const cardHtml = rest.slice(0, end === -1 ? undefined : end);
      assert.ok(cardHtml.includes('board__card-state">backlog<'), `2(b): ${id} shows its native state backlog`);
    }

    // (c)
    assert.ok(!html.includes("backlogged"), "2(c): the markup does not say 'backlogged'");
    assert.ok(!html.includes("board__backlog-footer"), "2(c): the markup has no backlog footer");

    // (d)
    assert.ok(html.includes(HOSTILE_ESCAPED), "2(d): the hostile title appears escaped");
    const stripped = html.split(HOSTILE_ESCAPED).join("");
    assert.ok(!stripped.includes("<img"), "2(d): no raw <img outside the escaped title");
    assert.ok(!stripped.includes("onerror="), "2(d): no onerror= outside the escaped title");

    // (e) branchNote, reached through the namespace after row (a)
    const branchNote = (board as unknown as { branchNote?: (r: unknown) => string | undefined }).branchNote;
    assert.equal(typeof branchNote, "function", "2(e): board.js exports branchNote");
    assert.ok(!html.includes("board__branch-note"), "2(e): with no branchNote the markup has no branch-note line");
    const partial = branchNote!({ status: "partial", dropped: [{ id: "W-006", reason: "invalid-shape" }] });
    assert.equal(typeof partial, "string", "2(e): a partial status with a dropped record gives a sentence");
    const withNote = renderToStaticMarkup(BoardView(props({ branchNote: partial })));
    assert.equal(withNote.split("board__branch-note").length - 1, 1, "2(e): exactly one branch-note line is drawn");
    assert.ok(withNote.includes("W-006"), "2(e): the line names the dropped W-006");
    assert.ok(!withNote.includes("invalid-shape"), "2(e): the line never carries the reason code");
    const capped = branchNote!({ status: "partial", capped: 1, dropped: [] });
    assert.ok(typeof capped === "string" && /cap/i.test(capped) && capped.includes("1"), "2(e): a capped status names the cap");
    assert.equal(branchNote!({ status: "ok", dropped: [] }), undefined, "2(e): ok gives no line");
    assert.equal(branchNote!({ status: "off", dropped: [] }), undefined, "2(e): off gives no line");
    assert.equal(branchNote!(undefined), undefined, "2(e): an absent status gives no line");
    for (const status of ["stale", "unavailable"]) {
      const sentence = branchNote!({ status, dropped: [] });
      assert.ok(typeof sentence === "string" && sentence.length > 0, `2(e): ${status} gives a non-empty sentence`);
    }
  });
}
