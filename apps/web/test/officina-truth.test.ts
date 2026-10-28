/** W-077's truth rows, migrated by W-408 to the current Officina detail ledger. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AerariumEntry, HealthResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { OfficinaView } from "../src/screens/Officina.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && ![1, 2, 4, 5].includes(only as number)) {
  console.error("officina-truth.test.ts: --behaviour must be one of 1, 2, 4, 5");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

const HEALTH: HealthResponse = {
  at: "2026-09-25T09:35:43.947Z", ok: false, blocks: 1, advisories: 3,
  findingsByRule: { "traditio.stale": 2, "traditio.stage": 1 }, autonomy: { paused: false },
  lastTick: "2026-09-25T09:35:43.947Z", due: [{ kind: "daily", id: "producer" }],
};
const ENTRY: AerariumEntry = { collegium: "engineering", period: "2026-W40", allowance: { tokens: 3_000_000 }, burn: { tokens: 1_000_000 }, posture: "ok" };
const OFFICINA: OfficinaResponse = { studio: "studio", patron: "patron", collegia: [], sellae: [], probationes: [], wip_limit: 4, lifecycle: { id: "opus", states: [] } };
const OPERA: OpusEntry[] = [];

function render(over: Partial<Parameters<typeof OfficinaView>[0]> = {}): string {
  return renderToStaticMarkup(createElement(OfficinaView, {
    aerarium: [ENTRY], health: HEALTH, officina: OFFICINA, opera: OPERA, ...over,
  }));
}
const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const panelOf = (html: string, heading: string): string => {
  const panel = html.split("<section").slice(1).find((part) => part.includes(`>${heading}</h2>`));
  assert.ok(panel, `a panel headed ${heading} exists`);
  return panel;
};

if (runs(1)) test("W-077 behaviour 1: current health has no as-of or generated-at stamp", () => {
  const html = render();
  assert.doesNotMatch(text(html), /\bas of\b|generated at|ago\b/i);
  assert.equal((html.match(/class="officina__health-row /g) ?? []).length, 2, "the current health still has two one-line rows");
});

if (runs(2)) test("W-077 behaviour 2: engine jargon is gone and the Officina-detail order is explicit", () => {
  const html = render({ health: { ...HEALTH, due: [] } });
  assert.deepEqual(
    [...html.matchAll(/officina__panel-heading[^>]*>([^<]+)/g)].map((match) => match[1]),
    ["Work in flight", "Budget", "Health"],
  );
  for (const gone of ["Engine state", "Process engine", "System status", "Decreta pending"]) assert.ok(!text(html).includes(gone));
  assert.ok(text(panelOf(html, "Health")).includes("Nothing pending."), "the disclosed process detail names an empty due list");
});

if (runs(4)) test("W-077 behaviour 4: aerarium absence and failure are never dressed as data", () => {
  const empty = panelOf(render({ aerarium: [] }), "Budget");
  assert.ok(text(empty).includes("No budget allocation is recorded for this week. Spend and posture are unavailable."));
  assert.doesNotMatch(empty, /officina__budget-row/);
  assert.ok(text(panelOf(render({ aerarium: undefined }), "Budget")).includes("Loading budget allocations…"));
  assert.ok(text(panelOf(render({ aerarium: "failed" }), "Budget")).includes("Could not load budget allocations."));
});

if (runs(5)) test("W-077 behaviour 5: health speaks plain language behind two collapsed disclosures", () => {
  const health = panelOf(render(), "Health");
  const details = [...health.matchAll(/<details\b([^>]*)>[\s\S]*?<\/details>/g)];
  assert.equal(details.length, 2);
  for (const row of details) assert.doesNotMatch(row[1] ?? "", /\bopen\b/);
  const plain = text(health);
  assert.ok(plain.includes("Lex status") && plain.includes("Process health"));
  assert.ok(plain.includes("This check found 1 blocking problem.") && plain.includes("3 warnings; they do not stop work."));
  assert.ok(plain.includes("Severity is available only in aggregate."));
  assert.equal((health.match(/officina__rule-family/g) ?? []).length, 1, "rule ids collapse to one unclassified family row");
  assert.doesNotMatch(health.match(/officina__rule-family[^]*?<\/p>/)?.[0] ?? "", /severity-cue/, "an unclassified rule family has no severity symbol");
});
