/**
 * W-142 behaviour 1: the gate timeout is one exported constant with headroom
 * over the slowest measured suite run. node:test TAP; selected by
 * `--test-name-pattern=W-142-b1`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as pipeline from "../src/index.js";

// The slowest measured suite run: 11 min 09 s locally at master d8bf1fb
// (CI's slowest `npm test` step was 551 s, W-141's PR).
const SLOWEST_SUITE_MS = 669_000;

test("W-142-b1 behaviour 1: the gate timeout has 2x headroom over the slowest suite and stays within an hour", () => {
  const ms = pipeline.GATE_TIMEOUT_MS;
  assert.equal(typeof ms, "number");
  assert.ok(ms >= 2 * SLOWEST_SUITE_MS, `${ms} < ${2 * SLOWEST_SUITE_MS}`);
  assert.ok(ms <= 60 * 60_000, `${ms} > ${60 * 60_000}`);
});
