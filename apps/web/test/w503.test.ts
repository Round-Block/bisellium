import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { HealthResponse, InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { attentionCollection } from "../src/lib/board.js";
import { homeNeeds, homeSummary } from "../src/lib/home.js";

function servedRow(behaviour: number): void {
  const title = `W-503-b${behaviour}\\s`;
  const config = fileURLToPath(new URL("../playwright.serve.config.ts", import.meta.url));
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const result = spawnSync("npx", [
    "playwright",
    "test",
    `--config=${config}`,
    "--grep",
    title,
  ], { cwd: repositoryRoot, encoding: "utf8", timeout: 280_000 });
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

test("W-503-b3 behaviour 3: Stuck, Health and one signed work summary use only recorded facts", { timeout: 300_000 }, () => {
  const lifecycle = { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "checking", name: "Checking", phase: "verifying" },
    { id: "review", name: "Review", phase: "awaiting_review" },
    { id: "halted", name: "Halted", phase: "halted" },
    { id: "done", name: "Done", phase: "done" },
  ] };
  const failed = opus("W-10", "checking");
  failed.probationes = { tests: { status: "failed" }, lint: { status: "failed" } };
  const halted = opus("W-12", "halted");
  halted.probationes = { tests: { status: "failed" } };
  const done = opus("W-13", "done");
  done.probationes = { tests: { status: "failed" } };
  const opera = [opus("W-7", "backlog"), opus("W-8", "greenlit"), opus("W-9", "building"), failed, opus("W-11", "review"), halted, done];
  const health: HealthResponse = { at: "", ok: false, blocks: 0, advisories: 2, findingsByRule: {}, autonomy: { paused: false }, lastTick: "", due: [] };
  const summary = homeSummary({ lifecycle }, opera, health);
  assert.deepEqual(summary, {
    stuck: { count: 1, cue: "blocking" },
    health: { count: 2, cue: "high", detail: "2 high findings" },
    wip: [
      { id: "in_progress", label: "In progress", count: 1 },
      { id: "verifying", label: "Verifying", count: 1 },
      { id: "awaiting_review", label: "Awaiting review", count: 1 },
    ],
  }, "active work with several failed gates counts once while done and halted failures do not contribute");
  assert.equal(homeSummary({ lifecycle }, opera, { ...health, blocks: 1 }).health.cue, "blocking", "a blocking finding uses the shared blocking cue");
  assert.equal(homeSummary({ lifecycle }, opera, { ...health, ok: true, advisories: 0 }).health.cue, "normal", "healthy uses the shared hollow-circle cue");
  assert.deepEqual(homeSummary({ lifecycle }, [], { ...health, ok: true, advisories: 0 }).wip, [], "zero in-flight work produces no empty lower summary");
  servedRow(3);
});
