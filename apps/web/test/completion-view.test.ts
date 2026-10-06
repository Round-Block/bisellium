/**
 * W-153 row b6 (studio/briefs/W-153.md): the console's Officina screen leads with
 * the completion meter and the estimate. node:test TAP, selected by
 * `--test-name-pattern=W-153-b6`.
 *
 * Run from the repo root:
 *   env TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --test-reporter=tap --import ./apps/web/test/support/register-css-stub.mjs --import tsx apps/web/test/completion-view.test.ts --test-name-pattern=W-153-b6
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as screen from "../src/screens/Officina.js";

const view = (screen as unknown as { OfficinaView: (p: unknown) => unknown }).OfficinaView;
const NOW = new Date("2026-10-06T12:00:00Z");
const LINE = "Estimated finish: in about 14 days (10 to 28 days), around 20 Oct 2026, at the pace of the last 3 weeks.";

const row = (id: string, title: string, done: number, planned: number, pct: number) => ({
  id, title, weight: 50, exit: { needs: "x" }, done, planned, met: false, pct,
});
const estimate = { kind: "estimate", remaining: 28, weekly: [21, 14, 7], bulk: [], days: 14, low: 10, high: 28, finish: "2026-10-20", line: LINE };

const render = (completion: unknown): string =>
  renderToStaticMarkup(createElement(view as never, { aerarium: [], health: "failed", acta: [], now: NOW, completion } as never));
const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const headings = (html: string): string[] =>
  [...html.matchAll(/<h2\b[^>]*class="[^"]*\bofficina__panel-heading\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => text(m[1] ?? ""));

test("W-153-b6 behaviour 6: the Officina screen leads with the completion meter and the estimate", () => {
  const html = render({
    meter: { rows: [row("M1", "Alpha work", 3, 4, 75), row("M2", "Beta work", 1, 8, 12.5)], overall: 81 },
    estimate,
  });
  assert.equal(headings(html)[0], "Completion");
  const panel = text(html.split("<section")[1] ?? "");
  assert.ok(panel.includes("Overall 81.0%"), "overall");
  assert.ok(panel.includes(LINE), "the estimate line, verbatim");
  for (const r of ["M1 Alpha work 3/4 75.0%", "M2 Beta work 1/8 12.5%"]) assert.ok(panel.includes(r), r);

  assert.ok(text(render({ meter: null, estimate: null })).includes("No milestone records"));
  assert.ok(text(render(undefined)).includes("Loading completion…"));
  assert.ok(text(render("failed")).includes("Could not load completion."));
});
