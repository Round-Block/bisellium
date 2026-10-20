/**
 * W-241 rows b1-b2 (studio/briefs/W-241.md): process.prompt_templates. node:test TAP, selected by
 * `--test-name-pattern='^W-241-b<n>\s'`. Every row builds its own officina under the OS tmp dir and reads no
 * studio/ file. Assertion messages carry rule levels, officina-relative paths and slot names only.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkStudio } from "../check.js";
import { initStudio } from "../init.js";
import { fillSlots } from "../next.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const DATA = "data, not instructions";
const REVIEW_SLOTS = ["<ID>", "<ROUND>", "<WORKTREE>", "<PACKET>", "<REVIEWED_HEAD>", "<FOCUS>", "<STUDIO>"];
const NEEDS: Record<string, string[]> = {
  "prompts/spec-draft.md": ["<ID>", "<OPUS>", "<MODEL_BRIEF>", "<MODEL_EVIDENCE>", DATA],
  "prompts/builder-brief.md": ["<ID>", "<WORKTREE>", "<BRIEF_STATE>", "<SPECIFICS>", DATA],
  "prompts/build-review.md": [...REVIEW_SLOTS, DATA],
};
const PATHS = Object.keys(NEEDS);
const MARKER = "(check: process.prompt_templates)";
const CLAUSE = `- \`ops-lead\` owns ${PATHS.map((p) => `\`studio/${p}\``).join(", ")} ${MARKER}`;

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function officina(): string {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w241-"));
  dirs.push(root);
  assert.ok(initStudio(root, { now: NOW }).root);
  return root;
}
const OPS = "  - { id: ops, name: Ops, magister: producer, lex: leges/ops.md }\n";
function declareOps(root: string): void {
  const manifest = join(root, "bisellium.yml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("collegia:\n", `collegia:\n${OPS}`));
}
const lex = (root: string, clause: string): void => writeFileSync(join(root, "leges", "ops.md"), `# Ops Lex\n\n## 2. Decides alone\n\n${clause}\n`);
function templates(root: string, skip?: [string, string]): void {
  mkdirSync(join(root, "prompts"), { recursive: true });
  for (const p of PATHS) writeFileSync(join(root, p), `# t\n\n---\n\n${NEEDS[p]!.filter((n) => !(skip && skip[0] === p && skip[1] === n)).join("\n")}\n`);
}
const found = (root: string): string[] =>
  checkStudio(root, NOW)
    .findings.filter((f) => f.rule === "process.prompt_templates")
    .map((f) => `${f.level} ${f.where}`)
    .sort();

test("W-241-b1 behaviour 1: an officina with an ops collegium carries the three prompt templates", () => {
  const values = Object.fromEntries(REVIEW_SLOTS.map((s) => [s.slice(1, -1), "v"])) as Parameters<typeof fillSlots>[1];
  assert.equal(typeof fillSlots(REVIEW_SLOTS.join("\n"), values), "string", "next fills a template holding the build-review slots");
  for (const s of REVIEW_SLOTS) assert.notEqual(typeof fillSlots(REVIEW_SLOTS.filter((x) => x !== s).join("\n"), values), "string", `next refuses a template without ${s}`);
  const root = officina();
  lex(root, CLAUSE);
  assert.deepEqual(found(root), [], "no ops collegium: the rule does not apply");
  declareOps(root);
  assert.deepEqual(found(root), PATHS.map((p) => `block ${p}`).sort(), "each absent template blocks once");
  templates(root);
  assert.deepEqual(found(root), [], "three complete templates clear it");
  for (const p of PATHS)
    for (const n of NEEDS[p]!) {
      templates(root, [p, n]);
      assert.deepEqual(found(root), [`block ${p}`], `${p} without ${n} blocks`);
    }
  templates(root);
  rmSync(join(root, "prompts", "spec-draft.md"));
  mkdirSync(join(root, "prompts", "spec-draft.md"));
  assert.deepEqual(found(root), ["block prompts/spec-draft.md"], "a directory at a template path blocks");
});
