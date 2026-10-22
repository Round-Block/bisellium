import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

test("W-360-b1 behaviour 1: every served-browser capture uses one frozen server and browser clock", () => {
  const capture = read("apps/web/tests-serve/capture-state.ts");
  const walk = read("apps/web/tests-serve/walk.spec.ts");
  const baselines = read("apps/web/tests-serve/screenshots.spec.ts");
  const reviewPacket = read("scripts/review-packet.test.mjs");
  const pkg = JSON.parse(read("apps/web/package.json")) as { scripts?: Record<string, string> };

  assert.match(capture, /CAPTURE_NOW = "2026-09-25T09:35:43\.947Z"/, "the verify capture instant is exact");
  assert.match(capture, /CAPTURE_VIEWPORTS = \[1280, 390\] as const/, "the verify walk keeps the ruled desktop and phone widths");
  assert.match(capture, /clock\.setFixedTime\(new Date\(CAPTURE_NOW\)\)/, "the verify browser clock is fixed without stopping timers");
  assert.doesNotMatch(capture, /clock\.install/, "the harness does not install an advancing fake clock");
  assert.match(walk, /startServed\("walk-3", \{ now: CAPTURE_NOW \}\)/, "the verify server receives the same instant");
  assert.match(walk, /for \(const width of CAPTURE_VIEWPORTS\)/, "the verify walk consumes the shared ruled widths");
  assert.ok(
    reviewPacket.includes("/export const CAPTURE_VIEWPORTS = \\[1280, 390\\] as const;/"),
    "W-340-b1 pins the shared viewport list",
  );
  assert.ok(
    reviewPacket.includes("/for \\(const width of CAPTURE_VIEWPORTS\\)/"),
    "W-340-b1 pins the walk's use of the shared viewport list",
  );
  assert.match(walk, /await freezeCaptureClock\(page\)/, "the verify browser receives the same instant");
  assert.ok(walk.indexOf("await freezeCaptureClock(page)") < walk.indexOf("await signIn(page, s, \"inbox\")"), "the verify clock is fixed before the first screen load");
  assert.match(walk, /const now = new Date\(CAPTURE_NOW\)/, "the seeded review actum uses the fixed instant");
  assert.match(baselines, /const FIXED_NOW = "2026-09-25T09:35:43\.947Z"/, "the baseline matrix uses the same exact instant");
  assert.match(baselines, /clock\.setFixedTime\(new Date\(FIXED_NOW\)\)/, "the baseline browser clock remains fixed");
  assert.match(baselines, /startServed\("screenshots", \{ now: FIXED_NOW, prepareStudio \}\)/, "the baseline server clock remains fixed");
  assert.match(pkg.scripts?.["test:policy"] ?? "", /test\/w360\.test\.ts/, "the runner's focused policy step includes W-360");
});

test("W-360-b2 behaviour 2: every route proves its own settled data and has no loading copy before capture", () => {
  const capture = read("apps/web/tests-serve/capture-state.ts");
  const walk = read("apps/web/tests-serve/walk.spec.ts");
  const baselines = read("apps/web/tests-serve/screenshots.spec.ts");
  const seats = read("apps/web/src/screens/Seats.tsx");

  for (const evidence of [".inbox__row", "[data-card-id]", ".gate-ladder", 'select[aria-label^="model for seat "]', ".officina__panel-heading", ".officina__loading"]) {
    assert.ok(capture.includes(evidence), `${evidence} is named as route-owned loaded evidence`);
  }
  assert.ok(capture.includes('data-state="ready"'), "non-live screens wait for their settled shell status");
  assert.ok(capture.includes('data-state="live"'), "Board waits for the completed live reconciliation");
  assert.ok(capture.includes('seats: its roster and model reads have settled'), "Seats waits for both independent reads");
  assert.match(seats, /modelsSettled[\s\S]*?finally\(\(\) => setModelsSettled\(true\)\)/, "the models read records its settled state");
  assert.match(seats, /loaded: loaded && modelsSettled/, "Seats reports ready only after officina and models settle");
  assert.match(capture, /Object\.hasOwn\(SCREEN_ROOT, route\)/, "an unknown route fails before it can use Officina evidence");
  assert.ok(capture.includes("/Loading[^\\r\\n]*(?:\\u2026|\\.{3})/u"), "the verify gate recognises both loading terminators after the full sentence");
  assert.match(capture, /page\.locator\("body"\)[\s\S]*?not\.toContainText\(LOADING_COPY\)/, "the verify gate rejects loading copy anywhere in the page");
  assert.match(walk, /await expectCapturedScreenSettled\(page, entry\.route\)/, "the verify walk applies the route gate");
  assert.ok(walk.indexOf("await expectCapturedScreenSettled(page, entry.route)") < walk.indexOf("await page.screenshot"), "the verify gate precedes capture");
  assert.match(baselines, /async function expectLoadedState/, "the baseline matrix retains its fixture-specific route gate");
  assert.match(baselines, /board: its complete reconciliation is live/, "the baseline Board gate requires the completed live shell");
  assert.match(baselines, /seats: its roster and model reads have settled/, "the baseline Seats gate requires both independent reads");
  assert.ok(baselines.includes("/Loading[^\\r\\n]*(?:\\u2026|\\.{3})/u"), "the baseline gate recognises both loading terminators after the full sentence");
  assert.match(baselines, /no loading copy remains/, "the baseline route gate explicitly rejects placeholders");
  const baselineGateAt = baselines.indexOf("await expectLoadedState(page, entry.route, width)");
  const baselineCaptureAt = baselines.indexOf("toHaveScreenshot");
  assert.notEqual(baselineGateAt, -1, "the baseline loop calls its loaded-state gate");
  assert.notEqual(baselineCaptureAt, -1, "the baseline loop contains its screenshot assertion");
  assert.ok(baselineGateAt < baselineCaptureAt, "the baseline gate precedes comparison or refresh");
});
