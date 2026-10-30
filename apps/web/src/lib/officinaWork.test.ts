import assert from "node:assert/strict";
import { test } from "node:test";
import { officinaWorkGroups } from "./officinaWork.js";
import type { BoardModel, CardRow } from "./board.js";

const card = (id: string, over: Partial<CardRow> = {}): CardRow => ({ id, title: id, sella: "builder", state: "building", gates: [], needsYou: false, blocked: false, ...over });

test("W-408 Officina groups each in-flight opus once by its operational next mover", () => {
  const gated = card("W-1", { needsYou: true, gates: [{ id: "patron", status: "pending" }] });
  const model: BoardModel = { columns: [
    { id: "needs_you", name: "Needs you", pinned: true, cards: [gated], atCap: false, membership: true },
    { id: "in_progress", name: "In progress", pinned: false, cards: [gated, card("W-2", { blocked: true })], atCap: false, membership: false },
    { id: "awaiting_review", name: "Review", pinned: false, cards: [card("W-3")], atCap: false, membership: false },
    { id: "halted", name: "Halted", pinned: false, cards: [card("W-4", { blocked: true })], atCap: false, membership: false },
    { id: "done", name: "Done", pinned: false, cards: [card("W-5")], atCap: false, membership: false },
  ], unplaced: [] };
  const groups = officinaWorkGroups(model);
  assert.deepEqual(groups.map((group) => [group.id, group.rows.map((row) => row.id)]), [
    ["review", ["W-3"]], ["building", ["W-1", "W-2"]], ["blocked", ["W-4"]],
  ]);
  assert.equal(groups[1]?.rows[0]?.note, "patron pending");
  assert.equal(groups[1]?.rows[1]?.note, "builder next");
  assert.equal(groups[2]?.rows[0]?.note, "builder next");
});
