import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { boardModel } from "../src/lib/board.js";

const read = (path: string): string => readFileSync(resolve("apps/web", path), "utf8");

const officina: Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit"> = {
  wip_limit: 4,
  probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
  lifecycle: { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Review", phase: "awaiting_review" },
    { id: "done", name: "Done", phase: "done" },
    { id: "halted", name: "Halted", phase: "halted" },
  ] },
};

const opus = (id: string, state: string, probationes: OpusEntry["probationes"] = {}): OpusEntry => ({
  id, title: `${id} title`, body: "", kind: "task", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined,
});

test("W-463-b1 behaviour 1: variant C replaces the membership column with one waiting strip model", () => {
  const opera = [
    opus("W-1", "backlog"),
    opus("W-2", "greenlit"),
    opus("W-3", "building", { patron: { status: "pending" } }),
    opus("W-4", "verifying"),
    opus("W-5", "review"),
    opus("W-6", "done"),
    opus("W-7", "halted"),
    opus("W-8", "unknown", { patron: { status: "pending" } }),
  ];
  const inbox: Pick<InboxResponse, "opera" | "petitiones"> = {
    opera: [{ id: "W-1", title: "W-1 title", collegium: "design", sella: "builder" }, { id: "W-3", title: "W-3 title", collegium: "design", sella: "builder" }],
    petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
      { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
      { id: "P-3", opus: "W-4", from: "producer", subject: "Verify", body: "Verify" },
      { id: "P-orphan", opus: "W-404", from: "producer", subject: "Orphan", body: "Orphan" },
    ],
  };
  const model = boardModel(officina, opera, inbox);

  assert.deepEqual(model.columns.map(({ id }) => id), ["planned", "in_progress", "verifying", "awaiting_review", "done", "halted"], "Needs-you is no longer a lifecycle column");
  assert.deepEqual(model.waiting.map(({ id }) => id), ["W-1", "W-3", "W-4", "W-8"], "zero, one and many asks count each waiting opus once in the strip");
  assert.deepEqual(model.waiting[0]?.asks, [{ kind: "greenlight", count: 1 }, { kind: "inbox", count: 2 }], "the strip retains Greenlight and counted Inbox decision words");
  assert.deepEqual(model.waiting[1]?.asks, [{ kind: "human_gate", count: 1 }], "the strip retains the Human gate word");
  assert.deepEqual(model.waiting[2]?.asks, [{ kind: "inbox", count: 1 }], "a lone Inbox decision remains a Board wait");

  const phaseCards = model.columns.flatMap(({ cards }) => cards.map(({ id }) => id));
  assert.deepEqual(phaseCards, ["W-2", "W-1", "W-3", "W-4", "W-5", "W-6", "W-7"], "every opus remains exactly once in its lifecycle phase");
  assert.equal(phaseCards.filter((id) => id === "W-1").length, 1, "a waiting opus has no duplicate card");
  assert.equal(model.waiting.some(({ id }) => id === "W-404"), false, "an ask with no Board entry creates no strip item");
  assert.deepEqual(model.unplaced, ["W-8"], "an unplaced waiting opus keeps its strip entry outside lifecycle columns");
  assert.equal(boardModel(officina, [opus("W-8", "done")], { opera: [], petitiones: [] }).waiting.length, 0, "an opus with no ask leaves the strip empty");
});
