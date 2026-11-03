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
