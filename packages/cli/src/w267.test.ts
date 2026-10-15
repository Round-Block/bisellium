/**
 * W-267 rows b1-b2: the ladder-runner agent, the retired Claude censor agent, and the producer
 * context's `## Runbook` (lex §9). Rows are `node:test`, named `W-267-b<n> behaviour <n>: …`; each
 * red is recorded with `--test-name-pattern='^W-267-b<n> '`. Tests run from the repo root.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkStudio } from "./check.js";
import { buildContext } from "./context.js";
import { renderInstructions } from "./instructions.js";

const NOW = new Date("2026-10-15T12:00:00Z");

test("W-267-b1 behaviour 1: the runner is defined and the Claude censor is gone", () => {
  assert.ok(existsSync(".claude/agents/ladder-runner.md"), "ladder-runner.md exists");
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
  assert.ok(claude.includes("{builder,architect,clerk,ladder-runner}"));
  for (const doc of [claude, agents]) assert.ok(!/censor/.test(doc));
  const stale = checkStudio("studio", NOW, { repo: "." }).findings.filter((f) => f.rule === "instructions.stale");
  assert.deepEqual(stale, []);
});

test("W-267-b2 behaviour 2: producer context serves all of lex section 9", () => {
  const lex = readFileSync("studio/leges/production.md", "utf8");
  const start = lex.indexOf("## 9. Opus ladder");
  const runbook = lex.slice(start, lex.indexOf("\n## 10. Models"));
  assert.ok(start >= 0 && runbook.includes("\n7. "));
  const block = `--- data: leges/production.md §9 ---\n${runbook}\n--- end ---`;
  const full = buildContext("studio", "producer", { now: NOW });
  assert.ok(full.text.includes(`## Runbook\n${block}`));
  const tiny = buildContext("studio", "producer", { now: NOW, maxTokens: 1 });
  assert.ok(tiny.text.includes(block));
  assert.ok(!tiny.truncated.includes("runbook"));

  const scratch = mkdtempSync(join(tmpdir(), "w267-"));
  try {
    cpSync("examples/sample-studio", scratch, { recursive: true });
    const sampleLex = join(scratch, "leges", "production.md");
    for (const sella of ["producer", "builder"]) assert.ok(!buildContext(scratch, sella, { now: NOW }).text.includes("## Runbook"));
    writeFileSync(sampleLex, `${readFileSync(sampleLex, "utf8")}\n## 9. Opus ladder\n\nfirst\n\n## 9. Opus ladder\n\nsecond\n`);
    const ambiguous = buildContext(scratch, "producer", { now: NOW });
    assert.deepEqual(ambiguous, { text: "", tokens: 0, truncated: ["runbook ambiguous"] });
    const cli = spawnSync(process.execPath, ["--import", "tsx", "packages/cli/src/main.ts", "context", "--sella", "producer", scratch], { encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.ok(cli.stderr.includes("runbook ambiguous: producer"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
