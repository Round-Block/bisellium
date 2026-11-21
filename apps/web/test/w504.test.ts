import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as home from "../src/lib/home.js";

function servedRow(behaviour: number): void {
  const config = fileURLToPath(new URL("../playwright.serve.config.ts", import.meta.url));
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const result = spawnSync("npx", [
    "playwright",
    "test",
    `--config=${config}`,
    "--grep",
    `W-504-b${behaviour}\\s`,
  ], { cwd: repositoryRoot, encoding: "utf8", timeout: 280_000 });
  assert.equal(result.status, 0, `served Completion behavior ${behaviour} holds:\n${result.stdout}${result.stderr}`);
}

test("W-504-b1 behaviour 1: Completion renders one truthful unit for every planned milestone item", { timeout: 300_000 }, () => {
  servedRow(1);
  assert.equal(typeof home.homeCompletion, "function", "Home exposes one completion model for the served meter");
  const completion = home.homeCompletion!({ rows: [
    { id: "M1", title: "First milestone", weight: 10, done: 2, planned: 3, met: false, pct: 66.67 },
    { id: "M2", title: "Second milestone", weight: 20, done: 1, planned: 2, met: true, pct: 100 },
  ], overall: 60 });
  assert.deepEqual(completion, {
    overall: 60,
    rows: [
      { id: "M1", title: "First milestone", done: 2, planned: 3 },
      { id: "M2", title: "Second milestone", done: 1, planned: 2 },
    ],
  }, "the model retains exact milestone labels and done/planned units");
});

test("W-504-b2 behaviour 2: Completion is responsive and every read outcome stays honest", { timeout: 300_000 }, () => {
  servedRow(2);
});
