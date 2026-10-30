import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { boardModel, needsYouTotal } from "../src/lib/board.js";

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

  assert.deepEqual(model.waiting.map(({ id }) => id), ["W-1", "W-3", "W-4"], "greenlight, linked Inbox and human-gate asks each create one waiting-strip membership");
  assert.deepEqual(ids("planned"), ["W-2", "W-1"], "the greenlight request remains in its ruled Planned lifecycle column");
  assert.deepEqual(ids("in_progress"), ["W-3"], "the Inbox decision remains in its in-progress lifecycle column");
  assert.deepEqual(ids("verifying"), ["W-4"], "the human-gate wait remains in its verifying lifecycle column");
  assert.deepEqual(ids("awaiting_review"), ["W-5"], "an opus without an ask remains in awaiting review");
  assert.deepEqual(ids("done"), ["W-6"], "done stays represented by its lifecycle phase");
  assert.deepEqual(ids("halted"), ["W-7"], "halted stays represented by its lifecycle phase");
  assert.ok(!model.columns.some((column) => column.cards.some((card) => card.id === "W-404")) && !model.waiting.some((card) => card.id === "W-404"), "an ask without a Board opus creates no ghost entry");

  const store = read("../server/src/store.ts");
  const board = read("src/screens/Board.tsx");
  const served = read("tests-serve/w409.spec.ts");
  assert.match(store, /phase === "backlog"/, "the existing Inbox route recognises lifecycle backlog as a greenlight ask");
  assert.match(board, /boardModel\(officina, opera, inbox\)/, "the Board joins the existing Inbox response instead of adding a data source");
  assert.match(served, /W-409-b1 Patron asks retain lifecycle membership at 1280, 640 and 390/, "the served row pins every ruled viewport");
});

test("W-409-b2 behaviour 2: Inbox question totals stay distinct from Board membership", () => {
  const linked = [
    { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
    { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
  ];
  const unlinked = [
    { id: "P-3", from: "reviewer", subject: "Third", body: "Third" },
    { id: "P-4", from: "qa-lead", subject: "Fourth", body: "Fourth" },
  ];
  const inbox: InboxResponse = {
    opera: [
      { id: "W-1", title: "Greenlight", collegium: "design", sella: "producer", traditio: undefined },
      { id: "W-2", title: "Human gate", collegium: "design", sella: "builder", traditio: undefined },
    ],
    petitiones: [...linked, ...unlinked],
  };
  assert.equal(needsYouTotal({ opera: [], petitiones: unlinked }), 2, "two unlinked open petitiones count two");
  assert.equal(needsYouTotal({ opera: [], petitiones: [] }), 0, "no open Inbox questions count zero");
  assert.equal(needsYouTotal({ opera: inbox.opera, petitiones: [] }), 0, "Board-only greenlight and human-gate asks add nothing to the Inbox badge");
  assert.equal(needsYouTotal({ opera: [], petitiones: linked }), 1, "two linked open questions on one opus count one");
  assert.equal(needsYouTotal({ opera: [], petitiones: [{ id: "P-orphan", opus: "W-404", from: "producer", subject: "Orphan", body: "Orphan" }] }), 1, "a linked open question without a Board entry still counts in the Inbox badge");
  assert.equal(needsYouTotal(inbox), 3, "one linked opus plus two unlinked questions count three");

  const opera = [opus("W-1", "backlog"), opus("W-2", "building", { patron: { status: "pending" } }), opus("W-3", "done")];
  const model = boardModel(officina, opera, inbox);
  assert.equal(model.waiting.length, 2, "the waiting-strip total is unique opus membership");
  assert.equal(model.columns.find((column) => column.id === "planned")?.cards.length, 1, "the Planned total is not inflated by attention membership");
  assert.equal(model.columns.find((column) => column.id === "in_progress")?.cards.length, 1, "the human-gate opus stays in progress without entering the Inbox badge");
  assert.equal(model.columns.find((column) => column.id === "done")?.cards.length, 1, "an opus with no ask counts only in Done");

  const app = read("src/App.tsx");
  const inboxScreen = read("src/screens/Inbox.tsx");
  const served = read("tests-serve/w409.spec.ts");
  assert.match(app, /setNeedsYouCount\(needsYouTotal\(inbox\)\)/, "the shell count uses the shared Inbox-question total");
  assert.match(inboxScreen, /onNeedsYouCountRef\.current\?\.\(needsYouTotal\(d\)\)/, "Inbox refreshes the same Inbox-question total");
  assert.match(served, /W-409-b2 Inbox question totals stay distinct from Board membership at 1280, 640 and 390/, "the served row pins every ruled viewport");
});

test("W-409-b3 behaviour 3: cards distinguish greenlight, Inbox decisions and an unlinked human gate", () => {
  const inbox: InboxResponse = {
    opera: [
      { id: "W-1", title: "Long", collegium: "design", sella: "producer", traditio: undefined },
      { id: "W-2", title: "Gate and decision", collegium: "design", sella: "builder", traditio: undefined },
      { id: "W-3", title: "Greenlight and gate", collegium: "design", sella: "builder", traditio: undefined },
      { id: "W-4", title: "Every ask", collegium: "design", sella: "builder", traditio: undefined },
    ],
    petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
      { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
      { id: "P-3", opus: "W-2", from: "producer", subject: "Gate decision", body: "Gate decision" },
      { id: "P-4", opus: "W-4", from: "producer", subject: "Every decision", body: "Every decision" },
    ],
  };
  const title = `A long title ${"kept ".repeat(40)}`;
  const model = boardModel(officina, [
    opus("W-1", "backlog", {}, title),
    opus("W-2", "building", { patron: { status: "pending" } }),
    opus("W-3", "backlog", { patron: { status: "pending" } }),
    opus("W-4", "backlog", { patron: { status: "pending" } }),
    opus("W-5", "done"),
  ], inbox);
  const cards = model.columns.flatMap((column) => column.cards.map((card) => ({ column: column.id, card })));
  const combinations = [
    { id: "W-1", asks: [{ kind: "greenlight" as const, count: 1 }, { kind: "inbox" as const, count: 2 }], label: "greenlight and Inbox decisions" },
    { id: "W-2", asks: [{ kind: "inbox" as const, count: 1 }, { kind: "human_gate" as const, count: 1 }], label: "a pending human gate and Inbox decision" },
    { id: "W-3", asks: [{ kind: "greenlight" as const, count: 1 }, { kind: "human_gate" as const, count: 1 }], label: "greenlight and a pending human gate" },
    { id: "W-4", asks: [{ kind: "greenlight" as const, count: 1 }, { kind: "inbox" as const, count: 1 }, { kind: "human_gate" as const, count: 1 }], label: "greenlight, Inbox decision and a pending human gate" },
  ];
  for (const { id, asks, label } of combinations) {
    const copies = cards.filter(({ card }) => card.id === id);
    const waiting = model.waiting.find((card) => card.id === id);
    assert.equal(copies.length, 1, `${label} keep exactly one lifecycle card`);
    assert.deepEqual([waiting?.asks, copies[0]?.card.asks], [asks, asks], `${label} remain distinct in the strip data and lifecycle card`);
  }
  assert.deepEqual(cards.find(({ card }) => card.id === "W-5")?.card.asks, [], "an opus with no ask carries no Needs-you mark data");

  const css = read("src/components/w025.css");
  const view = read("src/screens/BoardView.tsx");
  const served = read("tests-serve/w409.spec.ts");
  assert.match(view, /function Card[\s\S]*board__card-id[\s\S]*board__card-title[\s\S]*<AskKinds card=\{card\}/, "lifecycle cards alone show the three compact ask words below task ID and title");
  assert.doesNotMatch(view, /board__waiting-title[^]*<AskKinds card=\{card\}/, "strip entries do not render ask words");
  assert.match(view, /title=\{card\.title\}/, "the complete long title stays in its native title affordance");
  assert.match(css, /\.board__card-asks\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/s, "ask-kind marks stay on one contained card line");
  assert.match(css, /\.board__card-title\s*\{[^}]*-webkit-line-clamp:\s*2;/s, "lifecycle card titles stop at two lines");
  assert.match(served, /W-409-b3 ask kinds and long titles stay legible at 1280, 640 and 390/, "the served row pins every ruled viewport");
});
