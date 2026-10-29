import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { boardModel } from "../src/lib/board.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(HERE, "..", path), "utf8");

const lifecycle: OfficinaResponse["lifecycle"] = {
  id: "opus",
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

function opus(id: string, state: string, probationes: OpusEntry["probationes"] = {}, title = id): OpusEntry {
  return { id, title, body: "", kind: "task", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined };
}

const officina = {
  lifecycle,
  probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
  wip_limit: 4,
};

test("W-409-b1 behaviour 1: every Patron ask adds membership without replacing the opus lifecycle phase", () => {
  const opera = [
    opus("W-1", "backlog"),
    opus("W-2", "greenlit"),
    opus("W-3", "building"),
    opus("W-4", "verifying", { patron: { status: "pending" } }),
    opus("W-5", "review"),
    opus("W-6", "done"),
    opus("W-7", "halted"),
  ];
  const inbox: InboxResponse = {
    opera: [{ id: "W-1", title: "W-1", collegium: "design", sella: "builder", traditio: undefined }, { id: "W-4", title: "W-4", collegium: "design", sella: "builder", traditio: undefined }],
    petitiones: [
      { id: "P-1", opus: "W-3", from: "producer", subject: "Choose", body: "Choose" },
      { id: "P-orphan", opus: "W-404", from: "producer", subject: "Orphan", body: "Orphan" },
    ],
  };
  const model = boardModel(officina, opera, inbox);
  const ids = (column: string): string[] => model.columns.find((entry) => entry.id === column)?.cards.map((card) => card.id) ?? [];

  assert.deepEqual(ids("needs_you"), ["W-1", "W-3", "W-4"], "greenlight, linked Inbox and human-gate asks each create one Needs-you membership");
  assert.deepEqual(ids("planned"), ["W-2", "W-1"], "the greenlight request remains in its ruled Planned lifecycle column");
  assert.deepEqual(ids("in_progress"), ["W-3"], "the Inbox decision remains in its in-progress lifecycle column");
  assert.deepEqual(ids("verifying"), ["W-4"], "the human-gate wait remains in its verifying lifecycle column");
  assert.deepEqual(ids("awaiting_review"), ["W-5"], "an opus without an ask remains in awaiting review");
  assert.deepEqual(ids("done"), ["W-6"], "done stays represented by its lifecycle phase");
  assert.deepEqual(ids("halted"), ["W-7"], "halted stays represented by its lifecycle phase");
  assert.ok(!model.columns.some((column) => column.cards.some((card) => card.id === "W-404")), "an ask without a Board opus creates no ghost card");

  const store = read("../server/src/store.ts");
  const board = read("src/screens/Board.tsx");
  const served = read("tests-serve/w409.spec.ts");
  assert.match(store, /phase === "backlog"/, "the existing Inbox route recognises lifecycle backlog as a greenlight ask");
  assert.match(board, /boardModel\(officina, opera, inbox\)/, "the Board joins the existing Inbox response instead of adding a data source");
  assert.match(served, /W-409-b1 Patron asks retain lifecycle membership at 1280, 640 and 390/, "the served row pins every ruled viewport");
});
