/** W-153-b6's Officina placement is superseded by W-408; the endpoint remains available to later ledger work. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as api from "../src/api.js";
import * as screen from "../src/screens/Officina.js";

const view = (screen as unknown as { OfficinaView: (props: unknown) => unknown }).OfficinaView;
const NOW = new Date("2026-10-06T12:00:00Z");
const HEALTH = { at: NOW.toISOString(), ok: true, blocks: 0, advisories: 0, findingsByRule: {}, autonomy: { paused: false }, lastTick: NOW.toISOString(), due: [] };
const render = (completion: unknown): string => renderToStaticMarkup(createElement(view as never, {
  aerarium: [],
  health: HEALTH,
  officina: "failed",
  opera: [],
  completion,
} as never));
const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

test("W-153-b6 behaviour 6: the completion reader remains while W-408 installs the Officina detail ledger", () => {
  assert.equal(typeof api.fetchCompletion, "function", "the existing completion endpoint client remains available");
  const html = render({ meter: { rows: [], overall: 81 }, estimate: { line: "Estimated finish" } });
  assert.ok(!text(html).includes("Completion"), "completion no longer creates a fifth Officina panel");
  assert.deepEqual(
    [...html.matchAll(/<h2(?=[^\p{L}\p{M}\p{N}_]|$)[^>]*class="[^"]*(?<![\p{L}\p{M}\p{N}_])officina__panel-heading(?=[^\p{L}\p{M}\p{N}_]|$)[^"]*"[^>]*>([\s\S]*?)<\/h2>/gu)].map((match) => text(match[1] ?? "")),
    ["Work in flight", "Budget", "Health"],
  );
});

test("W-153-b6 behaviour 6: malformed completion data cannot alter or crash the Officina", () => {
  for (const completion of [undefined, "failed", { meter: null, estimate: null }, { meter: { overall: Number.NaN } }]) {
    let html = "";
    assert.doesNotThrow(() => { html = render(completion); });
    assert.ok(text(html).includes("Health"));
    assert.ok(!text(html).includes("No estimate"));
  }
});
