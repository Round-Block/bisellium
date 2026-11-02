import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OfficinaResponse, OpusEntry } from "../src/api.js";
import { boardModel } from "../src/lib/board.js";
import { BoardView } from "../src/screens/BoardView.js";
import { checkStudio } from "../../../packages/cli/src/check.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const NOW = new Date("2026-11-02T12:00:00Z").getTime();
const lifecycle: OfficinaResponse["lifecycle"] = { id: "opus", states: [
  { id: "backlog", name: "Backlog", phase: "backlog" },
  { id: "greenlit", name: "Greenlit", phase: "planned" },
  { id: "building", name: "Building", phase: "in_progress" },
  { id: "verifying", name: "Verifying", phase: "verifying" },
  { id: "review", name: "Awaiting review", phase: "awaiting_review" },
  { id: "done", name: "Done", phase: "done" },
  { id: "halted", name: "Halted", phase: "halted" },
] };
const officina = (cap?: number): Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit"> => ({
  lifecycle,
  probationes: [{ id: "tests", name: "Tests", kind: "automated" }],
  ...(cap === undefined ? {} : { wip_limit: cap }),
});
const opus = (id: string, state: string, opts: { blocked?: boolean; hours?: number; stage?: string } = {}): OpusEntry => ({
  id,
  title: `${id} title`,
  body: "",
  kind: "ui",
  collegium: "design",
  sella: "builder",
  state,
  tokens: 0,
  probationes: opts.blocked ? { tests: { status: "failed" } } : {},
  traditio: opts.hours === undefined ? undefined : {
    sella: "builder",
    stage: opts.stage ?? state,
    blocked_on: "none",
    at: new Date(NOW - opts.hours * 3_600_000).toISOString(),
  },
});
const column = (model: ReturnType<typeof boardModel>, id: string) => model.columns.find((entry) => entry.id === id)!;

test("W-413-b1 behaviour 1: Board and check share the WIP numerator, cap and blocked contribution", () => {
  const empty = column(boardModel(officina(2), []), "in_progress");
  const one = column(boardModel(officina(2), [opus("W-1", "building")]), "in_progress");
  const at = column(boardModel(officina(2), [opus("W-1", "building"), opus("W-2", "verifying", { blocked: true })]), "in_progress");
  const overOpera = [opus("W-1", "building"), opus("W-2", "building", { blocked: true }), opus("W-3", "verifying"), opus("W-4", "done")];
  const overModel = boardModel(officina(2), overOpera);
  const over = column(overModel, "in_progress");
  assert.deepEqual(
    [empty.wipCount, one.wipCount, at.wipCount, over.wipCount],
    [0, 1, 2, 3],
    "zero, one, at-cap and over-cap use check's building plus verifying states",
  );
  assert.deepEqual([empty.atCap, one.atCap, at.atCap, over.atCap], [false, false, true, true], "at and over cap are explicit without amber");
  assert.equal(at.wipBlockedCount, 1, "a blocked card is included in the WIP count");
  assert.deepEqual([column(overModel, "in_progress").wipCount, column(overModel, "verifying").wipCount], [3, 3], "both WIP columns repeat the one policy numerator");
  assert.equal(column(overModel, "done").cap, undefined, "a non-WIP column is not described as capped or uncapped WIP");

  const fixture = mkdtempSync(join(tmpdir(), "w413-check-"));
  try {
    cpSync("examples/fixtures/bad-wip-cap", fixture, { recursive: true });
    writeFileSync(join(fixture, "opera/W-003.md"), "---\nid: W-003\ntitle: Verifying also consumes WIP\nkind: feature\ncollegium: engineering\nsella: eng-lead\nstate: verifying\nprobationes: {}\ntraditio: { sella: eng-lead, stage: verifying, next: review, blocked_on: none, at: 2026-09-17T10:00:00Z }\n---\n");
    const finding = checkStudio(fixture).findings.find((entry) => entry.rule === "wip.cap");
    const checkNumerator = Number(finding?.message.match(/^(\d+) items in progress/)?.[1]);
    assert.equal(over.wipCount, checkNumerator, "the Board numerator equals check's wip.cap numerator for the same states");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model: overModel, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(html, />1 item · 0 blocked</, "a singular non-WIP column reports one item, not invented WIP policy");
  assert.match(
    html,
    /data-column-id="in_progress"[\s\S]*?>2 shown<[\s\S]*?>Shared WIP 3 \/ 2 · 1 blocked</,
    "the local shown count and shared WIP count stay distinct without contradiction",
  );
  assert.match(html, />Shared WIP = Building \+ Verifying; blocked work included</, "the visible key names the shared population and blocked-work rule");
});

test("W-413-b2 behaviour 2: median dwell uses recorded current-state handoffs only", () => {
  const none = column(boardModel(officina(4), [], undefined, { now: NOW }), "in_progress");
  const one = column(boardModel(officina(4), [opus("W-1", "building", { hours: 2 })], undefined, { now: NOW }), "in_progress");
  const many = column(boardModel(officina(4), [
    opus("W-1", "building", { hours: 9 }),
    opus("W-2", "building", { hours: 1 }),
    opus("W-3", "building", { hours: 3 }),
    opus("W-4", "building", { hours: 99, stage: "greenlit" }),
  ], undefined, { now: NOW }), "in_progress");
  assert.deepEqual([none.medianDwellMs, one.medianDwellMs, many.medianDwellMs], [undefined, 7_200_000, 10_800_000], "no, one and many items have honest median dwell");
  assert.equal(many.dwellSampleCount, 3, "a stale-stage handoff is excluded rather than guessed");
  const terminal = boardModel(officina(4), [opus("W-5", "done", { hours: 2 }), opus("W-6", "halted", { hours: 3 })], undefined, { now: NOW });
  assert.deepEqual([column(terminal, "done").medianDwellMs, column(terminal, "halted").medianDwellMs], [undefined, undefined], "Done and Halted omit a median whose last stage is not current work");
  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model: terminal, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.doesNotMatch(html.match(/data-column-id="done"[\s\S]*?<div class="board__column-cards"/)?.[0] ?? "", /board__column-dwell/, "Done renders no median");
});

test("W-413-b3 behaviour 3: every lifecycle column names its entry and exit rule", () => {
  const model = boardModel(officina(4), []);
  assert.deepEqual(
    model.columns.map(({ id, entryRule, exitRule }) => [id, entryRule, exitRule]),
    [
      ["planned", "Backlog + Greenlit", "approval + readiness before building"],
      ["in_progress", "Building", "build complete before verification"],
      ["verifying", "Verifying", "passing checks before review"],
      ["awaiting_review", "Awaiting review", "approval completes work"],
      ["done", "Complete", "no forward exit"],
      ["halted", "Stopped", "resume when condition is met"],
    ],
    "membership uses served state names while exit copy stays fixed by standard phase id",
  );
  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(html, />Backlog \+ Greenlit; approval \+ readiness before building</, "Planned states its membership and condition before building");
  assert.match(html, />Verifying; passing checks before review</, "Verifying states the checks condition before review");
  assert.match(html, />Complete; no forward exit</, "Done does not imply another destination");
  assert.match(html, />Stopped; resume when condition is met</, "Halted states the recorded resume condition");
  const customLifecycle: OfficinaResponse["lifecycle"] = { id: "opus", states: [...lifecycle.states, { id: "archived", name: "Stored records", phase: "archived" }] };
  const custom = boardModel({ ...officina(), lifecycle: customLifecycle }, []);
  assert.deepEqual([column(custom, "archived").entryRule, column(custom, "archived").exitRule], ["Stored records", "recorded condition is met"], "a custom phase uses its served state name and the fixed fallback condition");
});

test("W-413-b4 behaviour 4: a Board filter reports visible cards against the unchanged total", () => {
  const model = boardModel(officina(3), [
    opus("W-1", "greenlit"),
    opus("W-2", "building"),
    opus("W-3", "building", { blocked: true }),
    opus("W-4", "halted", { blocked: true }),
  ], undefined, { filter: "blocked", now: NOW });
  assert.deepEqual(
    [column(model, "planned"), column(model, "in_progress"), column(model, "halted")].map((entry) => [entry.cards.length, entry.totalCount, entry.blockedCount]),
    [[0, 1, 0], [1, 2, 1], [1, 1, 1]],
    "the filter hides all, some and none while total and blocked counts stay fixed",
  );
  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model, focusedByColumn: {}, onSelectCard: () => undefined, filter: "blocked" }));
  assert.match(html, /aria-label="Filter Board work"[^>]*><option value="all">All work<\/option><option value="blocked" selected="">Blocked only<\/option>/, "the selected filter is visible and reversible");
  assert.match(html, />1 of 2 shown</, "filtered columns state visible against total");
  assert.match(html, />Shared WIP 2 \/ 3 · 1 blocked</, "filtering never changes the named shared numerator or blocked contribution");
});
