/**
 * apps/web/test/w300.test.ts — W-300: row b3 as node:test TAP, so its red and its kills read as the other rows' do. The row
 * itself is tests-serve/w300.spec.ts, on the served suite's chain; this runs it and fails at its first failed expectation.
 * W300_CAPTURE_DIR passes through to the row.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("W-300-b3 behaviour 3: the drawer shows the step on one line under the title, amber only when the actor is the Patron", { timeout: 400_000 }, () => {
  const r = spawnSync("npx", ["playwright", "test", "--config=apps/web/playwright.serve.config.ts", "--grep", "W-300-b3\\s"], { cwd: process.cwd(), encoding: "utf8", timeout: 380_000 });
  if (r.status === 0) return;
  const first = /^\s*Error: (.*)$/m.exec(`${r.stdout}${r.stderr}`);
  assert.fail(first?.[1] ?? `the served row exited ${r.status}`);
});
