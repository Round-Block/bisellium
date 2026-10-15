/**
 * W-267 rows b1-b2: the ladder-runner agent, the retired Claude censor agent, and the producer
 * context's `## Runbook` (lex §9). Rows are `node:test`, named `W-267-b<n> behaviour <n>: …`; each
 * red is recorded with `--test-name-pattern='^W-267-b<n> '`. Tests run from the repo root.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { checkStudio } from "./check.js";
import { renderInstructions } from "./instructions.js";

const NOW = new Date("2026-10-15T12:00:00Z");

test("W-267-b1 behaviour 1: the runner is defined and the Claude censor is gone", () => {
  const text = readFileSync(".claude/agents/ladder-runner.md", "utf8");
  const [, front = "", body = ""] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  const key = (k: string): string | undefined => front.match(new RegExp(`^${k}: *(.+)$`, "m"))?.[1]?.trim();
  assert.equal(key("name"), "ladder-runner");
  assert.ok(key("description"));
  assert.equal(key("tools"), "Read, Bash, Glob, Grep");
  assert.ok(!/Write|Edit/.test(key("tools") ?? ""));
  assert.equal(key("model"), "sonnet");
  assert.ok(body.includes("@studio/leges/production.md"));
  assert.ok(body.includes("run: npm run -s bisellium -- context --sella producer studio"));
  assert.ok(/one opus/.test(body));
  assert.ok(body.includes("npm run -s bisellium --"));
  assert.ok(body.includes("scripts/"));
  assert.ok(/never edit/i.test(body));
  assert.ok(/refusal/.test(body));
  assert.equal(existsSync(".claude/agents/censor.md"), false);
  const { claude, agents } = renderInstructions("studio", { now: NOW });
  for (const doc of [claude, agents]) {
    assert.ok(doc.includes("{builder,architect,clerk,ladder-runner}"));
    assert.ok(!/censor/.test(doc));
  }
  const stale = checkStudio("studio", NOW, { repo: "." }).findings.filter((f) => f.rule === "instructions.stale");
  assert.deepEqual(stale, []);
});
