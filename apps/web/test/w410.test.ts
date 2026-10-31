import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import * as board from "../src/lib/board.js";

const read = (path: string): string => readFileSync(resolve("apps/web", path), "utf8");
const at = (value: string): number => new Date(value).getTime();

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

function opus(
  id: string,
  state: string,
  options: { probationes?: OpusEntry["probationes"]; traditio?: unknown; sella?: string; body?: string } = {},
): OpusEntry {
  return {
    id,
    title: `${id} title`,
    body: options.body ?? "",
    kind: "ui",
    collegium: "design",
    sella: options.sella ?? "builder",
    state,
    tokens: 0,
    probationes: options.probationes ?? {},
    traditio: options.traditio,
  };
}

test("W-410-b1 behaviour 1: one waiting model carries the handoff facts without changing membership", () => {
  const opera = [
    opus("W-1", "backlog", { sella: "producer", traditio: { blocked_on: "patron", at: "2026-10-31T00:00:00Z" } }),
    opus("W-2", "greenlit", { sella: "architect", traditio: { blocked_on: "patron", at: "2026-10-31T01:00:00Z" } }),
    opus("W-3", "building", { probationes: { patron: { status: "pending", at: "2026-10-31T02:00:00Z" } }, traditio: { blocked_on: "patron", at: "2026-10-31T03:00:00Z" } }),
    opus("W-4", "verifying", { sella: "qa-lead", traditio: { blocked_on: "patron", at: "2026-10-31T04:00:00Z" } }),
    opus("W-5", "review", { probationes: { patron: { status: "pending" } }, traditio: { blocked_on: "none", at: "not-a-time" } }),
    opus("W-6", "done"),
    opus("W-7", "halted"),
  ];
  const inbox: Pick<InboxResponse, "opera" | "petitiones"> = {
    opera: [],
    petitiones: [
      { id: "P-1", opus: "W-4", from: "producer", opened: at("2026-10-31T00:30:00Z"), subject: "Decide", body: "Choose" },
      { id: "P-2", opus: "W-1", from: "architect", opened: at("2026-10-30T23:00:00Z"), subject: "Combined", body: "Choose" },
      { id: "P-orphan", opus: "W-404", from: "producer", opened: at("2026-10-30T22:00:00Z"), subject: "Orphan", body: "No Board row" },
    ],
  };

  const model = board.boardModel(officina, opera, inbox);
  assert.deepEqual(model.waiting.map(({ id }) => id), ["W-1", "W-3", "W-4", "W-5"], "the existing once-per-opus waiting membership is unchanged");
  const rows = Object.fromEntries(model.waiting.map((card) => [card.id, card]));
  assert.equal(rows["W-1"]?.sella, "producer", "the existing sella remains the owning agent");
  assert.equal(rows["W-1"]?.nextActor, "patron", "a recorded blocker is the next actor");
  assert.equal(rows["W-5"]?.nextActor, "Unassigned", "none or a missing blocker is shown plainly as unassigned");
  assert.equal(rows["W-1"]?.waitingSince, at("2026-10-30T23:00:00Z"), "combined asks use the oldest parseable active-ask instant");
  assert.equal(rows["W-3"]?.waitingSince, at("2026-10-31T02:00:00Z"), "a human gate uses its own pending instant before the handoff instant");
  assert.equal(rows["W-4"]?.waitingSince, at("2026-10-31T00:30:00Z"), "an Inbox decision uses its opened instant");
  assert.equal(rows["W-5"]?.waitingSince, undefined, "an unknown age stays unknown instead of being invented");
  assert.deepEqual(rows["W-1"]?.asks, [{ kind: "greenlight", count: 1 }, { kind: "inbox", count: 1 }], "the action asked reuses W-409 ask kinds");
  assert.equal(model.waiting.some(({ id }) => id === "W-404"), false, "an ask with no Board entry still creates no ghost card");
  assert.deepEqual(model.columns.flatMap(({ cards }) => cards.map(({ id }) => id)), ["W-2", "W-1", "W-3", "W-4", "W-5", "W-6", "W-7"], "every lifecycle phase keeps exactly one placed card");
});

