import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function servedRow(behaviour: number): void {
  const title = `W-503-b${behaviour}\\s`;
  const result = spawnSync("npx", [
    "playwright",
    "test",
    "--config=apps/web/playwright.serve.config.ts",
    "--grep",
    title,
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 280_000 });
  assert.equal(result.status, 0, `served Home behavior ${behaviour} holds:\n${result.stdout}${result.stderr}`);
}

test("W-503-b1 behaviour 1: Home is the default route and first shared navigation entry", { timeout: 300_000 }, () => {
  servedRow(1);
});
