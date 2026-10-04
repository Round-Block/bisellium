/**
 * W-077 behaviours 1, 2, 4 and 5: the Officina tells the truth and only what the
 * Patron needs. Select exactly one behaviour with `--behaviour N` (1, 2, 4 or 5);
 * omitting the selector runs all four. node:test TAP, one test() per behaviour.
 *
 * Run from the repo root (W-129's recorded shape):
 *   env TSX_TSCONFIG_PATH=apps/web/tsconfig.json node --test-reporter=tap --import ./apps/web/test/support/register-css-stub.mjs --import tsx apps/web/test/officina-truth.test.ts --behaviour 1
 *
 * `OfficinaView` and the officinaTruth helpers do not exist before the fix, so both
 * modules are NAMESPACE imports and every use is through a guard that fails an
 * assertion, never module load. No timers, sleeps or wall-clock waits: the age is
 * computed from an injected `now`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RULE_IDS } from "../../../packages/cli/src/rules/ids.js";
import type { AerariumEntry, HealthResponse } from "../src/api.js";
import * as truth from "../src/lib/officinaTruth.js";
import * as screen from "../src/screens/Officina.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && ![1, 2, 4, 5].includes(only as number)) {
  console.error("officina-truth.test.ts: --behaviour must be one of 1, 2, 4, 5");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

interface Row { family: string; label: string; rules: string[]; count: number }
interface Summary { stops: string; warns: string; rows: Row[] }
interface Helpers {
  healthStamp?: (at: string, now: Date) => string;
  integritySummary?: (h: Pick<HealthResponse, "blocks" | "advisories" | "findingsByRule">) => Summary;
  RULE_FAMILY_LABELS?: Readonly<Record<string, string>>;
}
const helpers = truth as unknown as Helpers;

interface ViewProps {
  aerarium: AerariumEntry[] | "failed" | undefined;
  health: HealthResponse | "failed" | undefined;
  acta: never[];
  now: Date;
}
const viewFn = (screen as unknown as { OfficinaView?: (p: ViewProps) => unknown }).OfficinaView;

const AT = "2026-09-25T09:35:43.947Z";
const NOW = new Date("2026-10-04T22:05:54Z");

function health(over: Partial<HealthResponse> = {}): HealthResponse {
  return {
    at: AT,
    ok: false,
    blocks: 1,
    advisories: 3,
    findingsByRule: { "traditio.stale": 2, "traditio.stage": 1, "state.done.probationes": 1 },
    autonomy: { paused: false },
    lastTick: AT,
    due: [
      { kind: "daily", id: "producer" },
      { kind: "traditio", id: "W-002" },
    ],
    ...over,
  };
}
const ENTRY: AerariumEntry = { collegium: "engineering", period: "2026-W40", allowance: { tokens: 3_000_000 }, burn: { tokens: 1_000_000 }, posture: "ok" };

function render(over: Partial<ViewProps> = {}): string {
  assert.equal(typeof viewFn, "function", "Officina.tsx exports OfficinaView");
  return renderToStaticMarkup(createElement(viewFn as never, { aerarium: [ENTRY], health: health(), acta: [], now: NOW, ...over } as never));
}

const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (s: string): string => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
/** inner HTML of every non-nested element of the tag whose class attribute holds the class. */
function byClass(html: string, cls: string, el = "[a-z0-9]+"): string[] {
  const re = new RegExp(`<(${el})\\b[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, "g");
  return [...html.matchAll(re)].map((m) => m[2] ?? "");
}
/** the markup of one panel: from its `<section` to the next. */
const panels = (html: string): string[] => html.split("<section").slice(1);
const panelOf = (html: string, heading: string): string => {
  const p = panels(html).find((s) => s.includes(`>${heading}</h2>`));
  assert.ok(p, `a panel headed ${heading} exists`);
  return p;
};

if (runs(1)) {
  test("W-077 behaviour 1: health carries its as-of stamp", () => {
    const stamp = helpers.healthStamp;
    assert.equal(typeof stamp, "function", "officinaTruth exports healthStamp");
    const at = new Date(AT).getTime();
    const ago = (ms: number): string => stamp!(AT, new Date(at + ms));
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const head = "as of 2026-09-25 09:35 UTC";
    assert.equal(ago(10_000), `${head}, just now`);
    assert.equal(ago(MIN), `${head}, 1 minute ago`);
    assert.equal(ago(5 * MIN), `${head}, 5 minutes ago`);
    assert.equal(ago(HOUR), `${head}, 1 hour ago`);
    assert.equal(ago(23 * HOUR), `${head}, 23 hours ago`);
    assert.equal(ago(24 * HOUR), `${head}, 1 day ago`);
    assert.equal(stamp!(AT, NOW), `${head}, 9 days ago`);
    assert.equal(ago(-HOUR), head, "a future at drops the age");
    assert.equal(stamp!("garbage", NOW), "as of an unknown time");

    const loaded = render();
    const stamps = byClass(loaded, "officina__as-of");
    assert.equal(stamps.length, 2, "a loaded health renders one stamp in each health panel");
    for (const s of stamps) assert.equal(text(s), `${head}, 9 days ago`);

    const loading = render({ health: undefined });
    assert.equal(byClass(loading, "officina__as-of").length, 0, "no stamp while loading");
    assert.equal(text(loading).split("Loading health…").length - 1, 2, "Loading health… appears twice");

    const failed = render({ health: "failed" });
    assert.equal(byClass(failed, "officina__as-of").length, 0, "no stamp on a failed health");
    assert.equal(text(failed).split("Could not load health.").length - 1, 2, "Could not load health. appears twice");
  });
}
