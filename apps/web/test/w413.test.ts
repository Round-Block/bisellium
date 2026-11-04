import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OfficinaResponse, OpusEntry } from "../src/api.js";
import { boardModel } from "../src/lib/board.js";
import { BoardView } from "../src/screens/BoardView.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const NOW = new Date("2026-11-02T12:00:00Z").getTime();
const css = readFileSync("apps/web/src/components/w025.css", "utf8");
const tokens = readFileSync("apps/web/src/tokens.css", "utf8");
const tokenExpression = (name: string): string => {
  const value = tokens.match(new RegExp(`--${name}\\s*:\\s*([^;]+)`))?.[1]?.trim();
  assert.ok(value, `tokens.css declares --${name}`);
  return value;
};
const tokenValue = (name: string): string => {
  const value = tokenExpression(name);
  const alias = value.match(/^var\(--([a-z0-9-]+)\)$/i)?.[1];
  return alias === undefined ? value : tokenValue(alias);
};
const channels = (hex: string): number[] => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
const mixedChannels = (first: string, second: string, firstWeight: number): number[] => channels(first).map((value, index) => value * firstWeight + channels(second)[index]! * (1 - firstWeight));
const luminance = (hex: string): number => {
  const linear = channels(hex).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
};
const channelLuminance = (values: number[]): number => {
  const linear = values.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
};
const contrast = (foreground: string, background: string): number => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
};
const mixedContrast = (foreground: number[], background: string): number => {
  const [lighter, darker] = [channelLuminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
};
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
const opus = (id: string, state: string, opts: { blocked?: boolean; startHours?: number; endHours?: number; start?: unknown; end?: unknown } = {}): OpusEntry => ({
  id,
  title: `${id} title`,
  body: "",
  kind: "ui",
  collegium: "design",
  sella: "builder",
  state,
  ...(opts.startHours === undefined && opts.start === undefined ? {} : { start: opts.start ?? new Date(NOW - opts.startHours! * 3_600_000).toISOString() }),
  ...(opts.endHours === undefined && opts.end === undefined ? {} : { end: opts.end ?? new Date(NOW - opts.endHours! * 3_600_000).toISOString() }),
  tokens: 0,
  probationes: opts.blocked ? { tests: { status: "failed" } } : {},
  traditio: undefined,
});
const column = (model: ReturnType<typeof boardModel>, id: string) => model.columns.find((entry) => entry.id === id)!;

test("W-413-b1 behaviour 1: every column has separate total and blocked rows", () => {
  const model = boardModel(officina(2), [
    opus("W-planned", "greenlit"),
    opus("W-build-1", "building"),
    opus("W-build-2", "building", { blocked: true }),
    opus("W-build-3", "building"),
    opus("W-verify", "verifying", { blocked: true }),
    opus("W-done-1", "done"),
    opus("W-done-2", "done"),
  ]);
  assert.deepEqual(
    model.columns.map(({ id, totalCount, blockedCount }) => [id, totalCount, blockedCount]),
    [["planned", 1, 0], ["in_progress", 3, 1], ["verifying", 1, 1], ["awaiting_review", 0, 0], ["done", 2, 0], ["halted", 0, 0]],
    "each lifecycle column keeps its own total and blocked count",
  );
  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(html, /data-column-id="in_progress"[\s\S]*?board__column-count">3 tasks<[\s\S]*?board__column-blocked board__column-blocked--active">1 blocked</, "a column renders its total and blocked count as exactly two separate rows");
  assert.match(html, /data-column-id="planned"[\s\S]*?board__column-count">1 task<[\s\S]*?board__column-blocked">None blocked</, "singular and zero-blocked copy stay plain");
  assert.doesNotMatch(html, /board__wip|in-progress limit|limit is|Building and Verifying together/, "the Board renders no limit or combined in-progress total");
  const blockedRule = /\.board__card--bad\s*{([^}]*)}/.exec(css)?.[1] ?? "";
  const blockedBorder = /border-left-color:\s*([^;]+);/.exec(blockedRule)?.[1]?.trim();
  assert.equal(blockedBorder, "var(--severity-blocking)", "a blocked card uses the shared blocking-severity token for its marker line");
  assert.match(css, /\.board__column-count,\s*\.board__column-blocked\s*{[^}]*color:\s*var\(--ink-3\)/, "the total and zero-blocked header rows keep the quieter neutral token");
  const activeBlockedRule = /\.board__column-blocked--active\s*{([^}]*)}/.exec(css)?.[1] ?? "";
  const activeBlockedColour = /color:\s*([^;]+);/.exec(activeBlockedRule)?.[1]?.trim();
  assert.equal(activeBlockedColour, "var(--severity-blocking-text)", "a positive blocked header count uses the scheme's text-safe blocking treatment");
  assert.equal(tokenExpression("severity-blocking-text"), "color-mix(in srgb, var(--severity-blocking) 75%, var(--ink))", "the text-safe blocking token derives from the shared severity red and theme ink");
  const blocking = tokenValue("severity-blocking");
  const darkBlockingText = mixedChannels(blocking, tokenValue("ink"), 0.75);
  const lightBlockingText = mixedChannels("#c14738", "#16211e", 0.75);
  assert.ok(contrast(blocking, tokenValue("surface")) >= 3, "the blocking marker clears 3 to 1 on the dark surface");
  assert.ok(contrast(blocking, "#ffffff") >= 3, "the blocking marker clears 3 to 1 on a light canvas");
  assert.ok(mixedContrast(darkBlockingText, tokenValue("surface")) >= 4.5 && mixedContrast(darkBlockingText, tokenValue("wash")) >= 4.5, "the red positive blocked count clears 4.5 to 1 on both dark surfaces");
  assert.ok(mixedContrast(lightBlockingText, "#ffffff") >= 4.5 && mixedContrast(lightBlockingText, "#f4f7f6") >= 4.5, "the red positive blocked count clears 4.5 to 1 on both approved light surfaces");
  assert.ok(contrast("#677270", "#ffffff") >= 4.5 && contrast("#677270", "#f4f7f6") >= 4.5, "the existing light-scheme ink-3 token keeps None blocked readable on both surfaces");
});

test("W-413-b2 behaviour 2: cards show recorded elapsed, actual completion and an honest estimate", () => {
  const opera = [
    opus("W-open", "building", { startHours: 2 }),
    opus("W-2", "building", { startHours: 9 }),
    opus("W-8", "halted", { startHours: 4 }),
    opus("W-done-6", "done", { startHours: 10, endHours: 4 }),
    opus("W-done-8", "done", { startHours: 12, endHours: 4 }),
    opus("W-done-10", "done", { startHours: 14, endHours: 4 }),
    opus("W-bad-open", "verifying", { start: "not-an-instant" }),
    opus("W-bad-done", "done", { startHours: 1, endHours: 2 }),
    opus("W-feb-open", "review", { start: "2026-02-31T08:00:00Z" }),
    opus("W-feb-start", "done", { start: "2026-02-31T08:00:00Z", endHours: 4 }),
    opus("W-feb-end", "done", { startHours: 12, end: "2026-02-30T08:00:00Z" }),
  ];
  const model = boardModel(officina(4), opera, undefined, { now: NOW });
  const open = column(model, "in_progress").cards.find((card) => card.id === "W-open");
  assert.deepEqual(
    [open?.elapsedMs, open?.estimatedRemainingMs],
    [2 * 3_600_000, 6 * 3_600_000],
    "an open card uses recorded start for elapsed and the completed-cycle median for estimated time left",
  );
  const overdue = column(model, "in_progress").cards.find((card) => card.id === "W-2");
  assert.deepEqual([overdue?.elapsedMs, overdue?.estimatedRemainingMs], [9 * 3_600_000, -1 * 3_600_000], "an overdue open card retains elapsed time and a non-positive estimate");
  const halted = column(model, "halted").cards.find((card) => card.id === "W-8");
  assert.deepEqual([halted?.elapsedMs, halted?.estimatedRemainingMs], [undefined, undefined], "a Halted card receives neither elapsed time nor a completion estimate");
  assert.equal(column(model, "done").cards.find((card) => card.id === "W-done-8")?.actualCompletionMs, 8 * 3_600_000, "a done card uses its recorded start-to-end span as actual completion time");
  assert.equal(column(model, "verifying").cards[0]?.elapsedMs, undefined, "a malformed start shows no elapsed time");
  assert.equal(column(model, "done").cards.find((card) => card.id === "W-bad-done")?.actualCompletionMs, undefined, "an end before start shows no actual completion time");

  assert.equal(column(model, "awaiting_review").cards.find((card) => card.id === "W-feb-open")?.elapsedMs, undefined, "an impossible calendar start (February 31) shows no elapsed time instead of a normalized date");
  assert.equal(column(model, "done").cards.find((card) => card.id === "W-feb-start")?.actualCompletionMs, undefined, "an impossible calendar start shows no actual completion time");
  assert.equal(column(model, "done").cards.find((card) => card.id === "W-feb-end")?.actualCompletionMs, undefined, "an impossible calendar end shows no actual completion time");

  const tooFew = boardModel(officina(4), [opus("W-open", "building", { startHours: 2 }), ...opera.slice(1, 3)], undefined, { now: NOW });
  assert.equal(column(tooFew, "in_progress").cards[0]?.estimatedRemainingMs, undefined, "fewer than three valid completed opera produce no estimate");

  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(html, />Started 2 hours ago\. About 6 hours left \(estimate\)\.</, "an open card states elapsed and estimated remaining time without abbreviations");
  assert.match(html, />Started 9 hours ago\. Taking longer than usual \(estimate\)</, "an overdue open card says it is taking longer than usual instead of promising another hour");
  assert.match(html, />Stopped; no completion estimate</, "a Halted card states that it has no completion estimate");
  assert.match(html, />Took 8 hours</, "a done card states its recorded completion time plainly");
  const noEstimateHtml = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model: tooFew, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(noEstimateHtml, />Started 2 hours ago\. No time estimate yet\.</, "an insufficient sample says there is no estimate instead of guessing");
  assert.doesNotMatch(html, /board__column-dwell|median dwell/, "column headers no longer show a median dwell metric");
  assert.match(readFileSync("apps/server/src/store.ts", "utf8"), /state: w\.state,[\s\S]*start: w\.meta\["start"\],[\s\S]*end: w\.meta\["end"\]/, "the existing start and end record fields are served on each /api/opera row");
});

test("W-413-b3 behaviour 3: every lifecycle column names its entry and exit rule", () => {
  const model = boardModel(officina(4), []);
  assert.deepEqual(
    model.columns.map(({ id, entryRule, exitRule }) => [id, entryRule, exitRule]),
    [
      ["planned", "Waiting to start.", "Moves on when approved and ready to build."],
      ["in_progress", "Being built.", "Moves on when the build is complete."],
      ["verifying", "Being checked.", "Moves on when checks pass."],
      ["awaiting_review", "Waiting for review.", "Finished when approved."],
      ["done", "Complete.", "No next step."],
      ["halted", "Stopped.", "Resumes when the blocking condition is resolved."],
    ],
    "every standard phase explains its present condition and next step without lifecycle jargon",
  );
  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(html, />Waiting to start\. Moves on when approved and ready to build\.</, "Planned explains what the stage means and when work moves on");
  assert.match(html, />Being checked\. Moves on when checks pass\.</, "Verifying explains its checks condition in plain language");
  assert.match(html, />Complete\. No next step\.</, "Done plainly says there is no next step");
  assert.match(html, />Stopped\. Resumes when the blocking condition is resolved\.</, "Halted plainly states the resume condition");
  const customLifecycle: OfficinaResponse["lifecycle"] = { id: "opus", states: [...lifecycle.states, { id: "archived", name: "Stored records", phase: "archived" }] };
  const custom = boardModel({ ...officina(), lifecycle: customLifecycle }, []);
  assert.deepEqual([column(custom, "archived").entryRule, column(custom, "archived").exitRule], ["In this stage.", "Moves on when its recorded condition is met."], "a custom phase gets a plain fallback without exposing its configured state name");
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
  assert.match(html, /aria-label="Choose which tasks to show"[^>]*><option value="all">All tasks<\/option><option value="blocked" selected="">Blocked tasks<\/option>/, "the selected task filter is visible and reversible in plain words");
  assert.match(html, />Showing 1 of 2 tasks</, "filtered columns state the visible and total task counts");
  assert.match(html, /data-column-id="in_progress"[\s\S]*?>Showing 1 of 2 tasks<[\s\S]*?>1 blocked</, "filtering keeps the column's own total and blocked rows");
});

test("W-413-b5 behaviour 5: card check progress says what happened and what comes next in plain words", () => {
  const checks = [
    { id: "tests", name: "Tests", kind: "automated" as const },
    { id: "review", name: "Review", kind: "agent" as const },
    { id: "approval", name: "Approval", kind: "human" as const },
  ];
  const withChecks = { ...officina(4), probationes: checks };
  const entry = (id: string, state: string, probationes: OpusEntry["probationes"]): OpusEntry => ({ ...opus(id, state), probationes });
  const model = boardModel(withChecks, [
    entry("W-failed", "building", { tests: { status: "failed" } }),
    entry("W-none", "verifying", {}),
    entry("W-some", "review", { tests: { status: "passed" }, review: { status: "waived" } }),
    entry("W-all", "done", { tests: { status: "passed" }, review: { status: "waived" }, approval: { status: "passed" } }),
  ]);
  const html = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(html, />A check failed: Tests</, "a failed check is named in plain words before any progress count");
  assert.match(html, />No checks complete yet — Tests next</, "zero completed checks name the next check without a ratio");
  assert.match(html, />2 of 3 checks complete — Approval next</, "partial progress gives the completed and total counts in words");
  assert.match(html, />All checks are complete</, "completed checks need no invented next step");
  const noChecks = boardModel({ ...officina(4), probationes: [] }, [opus("W-no-checks", "building")]);
  const noChecksHtml = renderToStaticMarkup(createElement(BoardView, { studio: "studio", model: noChecks, focusedByColumn: {}, onSelectCard: () => undefined }));
  assert.match(noChecksHtml, />No checks are required</, "an empty declared check set is stated honestly");
  assert.doesNotMatch(`${html}${noChecksHtml}`, /(?<![\p{L}\p{M}\p{N}])\d+\/\d+(?![\p{L}\p{M}\p{N}])|next:/u, "card and column policy text contains no progress ratio or shorthand next label");
});
