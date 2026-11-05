import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { attentionCollection } from "../src/lib/board.js";
import { homeNeeds } from "../src/lib/home.js";

function servedRow(behaviour: number): void {
  const title = `W-503-b${behaviour}\\s`;
  const result = spawnSync("npx", [
    "playwright",
    "test",
    "--config=apps/web/playwright.serve.config.ts",
    "--grep",
    title,
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 280_000 });
  assert.equal(result.status, 0, `served Home behavior ${behaviour} holds:\n${result.stdout}${result.stderr}`);
}

test("W-503-b1 behaviour 1: Home is the default route and first shared navigation entry", { timeout: 300_000 }, () => {
  servedRow(1);
});

const officina: Pick<OfficinaResponse, "lifecycle" | "probationes"> = {
  probationes: [{ id: "patron", kind: "human", name: "Patron call" }],
  lifecycle: { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "building", name: "Building", phase: "in_progress" },
  ] },
};

function opus(id: string, state: string, human = false): OpusEntry {
  return { id, title: `${id} title`, body: "", kind: "ui", collegium: "design", sella: "builder", state, tokens: 0,
    probationes: human ? { patron: { status: "pending" } } : {}, traditio: undefined };
}

test("W-503-b2 behaviour 2: Needs you reuses D-151 groups and counts each attention item once", { timeout: 300_000 }, () => {
  const opera = [opus("W-1", "backlog", true), opus("W-2", "building", true), opus("W-3", "building")];
  const inbox: InboxResponse = {
    opera: [],
    petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "Combined ask", body: "" },
      { id: "P-2", opus: "W-3", from: "producer", subject: "Inbox decision", body: "" },
      { id: "P-3", opus: "W-404", from: "producer", subject: "Missing work question", body: "" },
      { id: "P-4", from: "producer", subject: "Standalone question", body: "" },
    ],
  };
  const attention = attentionCollection(officina, opera, inbox);
  const groups = homeNeeds(attention);
  assert.equal(attention.length, 5, "the shared attention collection has five unique rows");
  assert.deepEqual(groups.map((group) => [group.id, group.items.map((item) => item.attentionKey)]), [
    ["greenlights", ["opus:W-1"]],
    ["human_gates", ["opus:W-2"]],
    ["inbox_decisions", ["opus:W-3"]],
    ["questions", ["opus:W-404", "petitio:P-4"]],
  ], "Greenlight, Human gate, Inbox decision and questions group without duplicating a combined opus");
  servedRow(2);
});
