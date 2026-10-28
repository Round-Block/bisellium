/**
 * W-241 rows b1-b2 (studio/briefs/W-241.md), W-258 row b1 (studio/briefs/W-258.md) and W-426 rows b1-b2
 * (studio/briefs/W-426.md): process.prompt_templates. node:test TAP, selected by
 * `--test-name-pattern='^W-<id>-b<n>\s'`. Every row builds its own officina under the OS tmp dir and reads no
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
const SELF_REVIEW = [
  "Self-review before handoff",
  "studio/prompts/build-review.md",
  "No Codex call",
  "nothing is recorded",
  "every reachable path and regression fixture",
  "the accepted and the rejected bound",
  "a negative fixture or a removal",
  "test titles true to a changed domain",
];
const REVIEW_SLOTS = ["<ID>", "<ROUND>", "<WORKTREE>", "<PACKET>", "<REVIEWED_HEAD>", "<FOCUS>", "<UI>", "<STUDIO>"];
const NEEDS: Record<string, string[]> = {
  "prompts/spec-draft.md": ["<ID>", "<OPUS>", "<MODEL_BRIEF>", "<MODEL_EVIDENCE>", DATA],
  "prompts/builder-brief.md": ["<ID>", "<WORKTREE>", "<BRIEF_STATE>", "<SPECIFICS>", DATA, ...SELF_REVIEW],
  "prompts/build-review.md": [...REVIEW_SLOTS, "fills the eight slots", DATA],
};
const PATHS = Object.keys(NEEDS);
// W-426: the UI judges' sense texts and templates, which the Ops lex clause does not name
const SENSE = ["for sense, not only conformance", "the Patron ruled it or an agent wrote it", "what the screen should do instead"];
const SPEC_REVIEW = "prompts/spec-review.md";
const UI_INPUT = "prompts/ui-input.md";
const UI_INPUT_NEEDS = ["<ID>", "<OPUS>", "<READ>", "<SHOTS>", "<QUESTIONS>", DATA, ...SENSE];
const UI_NEEDS: Record<string, readonly string[]> = { [SPEC_REVIEW]: SENSE, [UI_INPUT]: UI_INPUT_NEEDS };
const ALL: Record<string, readonly string[]> = { ...NEEDS, ...UI_NEEDS };
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
  for (const p of Object.keys(ALL)) writeFileSync(join(root, p), `# t\n\n---\n\n${ALL[p]!.filter((n) => !(skip && skip[0] === p && skip[1] === n)).join("\n")}\n`);
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
  assert.deepEqual(found(root), Object.keys(ALL).map((p) => `block ${p}`).sort(), "each absent template blocks once");
  templates(root);
  assert.deepEqual(found(root), [], "complete templates clear it");
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

test("W-241-b2 behaviour 2: the Ops lex names the templates in one checked clause", () => {
  const root = officina();
  declareOps(root);
  templates(root);
  assert.deepEqual(found(root), ["block leges/ops.md"], "an absent Ops lex blocks");
  mkdirSync(join(root, "leges", "ops.md"));
  assert.deepEqual(found(root), ["block leges/ops.md"], "a directory at leges/ops.md blocks");
  rmSync(join(root, "leges", "ops.md"), { recursive: true });
  lex(root, "- An unrelated clause (check: acta.daily)");
  assert.deepEqual(found(root), ["block leges/ops.md"], "no clause names the templates");
  for (const p of PATHS) {
    lex(root, CLAUSE.replace(`\`studio/${p}\``, "a template"));
    assert.deepEqual(found(root), ["block leges/ops.md"], `a clause without ${p} blocks`);
  }
  lex(root, CLAUSE.replace(MARKER, ""));
  assert.deepEqual(found(root), ["block leges/ops.md"], "a clause without the marker blocks");
  lex(root, CLAUSE.replace("- ", "1. "));
  assert.deepEqual(found(root), ["block leges/ops.md"], "a numbered item is not a clause");
  lex(root, CLAUSE.replace("- ", "-\n"));
  assert.deepEqual(found(root), ["block leges/ops.md"], "a bare bullet marker is not a clause");
  lex(root, `\`\`\`\n${CLAUSE}\n\`\`\``);
  assert.deepEqual(found(root), ["block leges/ops.md"], "a fence line joined to the clause blocks");
  lex(root, `\`\`\`\n${CLAUSE}\n\n\`\`\``);
  assert.deepEqual(found(root), [], "a fence is not recognised: a clause a blank line ends clears it");
  lex(root, CLAUSE);
  assert.deepEqual(found(root), [], "the complete clause clears it");
  lex(root, `${CLAUSE.replace(` ${MARKER}`, "")}\n  continued ${MARKER}`);
  assert.deepEqual(found(root), [], "a clause wrapped onto a continuation line clears it");
});

test("W-258-b1 behaviour 1: the builder brief template carries the builder's self-review against the build-review prompt", () => {
  const root = mkdtempSync(join(tmpdir(), "bisellium w258 'é-"));
  dirs.push(root);
  assert.ok(initStudio(root, { now: NOW }).root);
  declareOps(root);
  lex(root, CLAUSE);
  templates(root);
  const BUILDER = "prompts/builder-brief.md";
  const base = NEEDS[BUILDER]!.filter((n) => !SELF_REVIEW.includes(n));
  const write = (needs: string[]): void => writeFileSync(join(root, BUILDER), `# t\n\n---\n\n${needs.join("\n")}\n`);
  write(base);
  assert.deepEqual(found(root), [`block ${BUILDER}`], "a builder brief without the self-review blocks");
  const message = checkStudio(root, NOW).findings.find((f) => f.rule === "process.prompt_templates")?.message ?? "";
  for (const s of SELF_REVIEW) assert.ok(message.includes(s), `the finding names ${s}`);
  write([...base, ...SELF_REVIEW]);
  assert.deepEqual(found(root), [], "the self-review clears it");
  for (const s of SELF_REVIEW) {
    write([...base, ...SELF_REVIEW.filter((x) => x !== s)]);
    assert.deepEqual(found(root), [`block ${BUILDER}`], `a builder brief without ${s} blocks`);
  }
  write([...base, ...SELF_REVIEW.map((s) => s.toLowerCase())]);
  assert.deepEqual(found(root), [`block ${BUILDER}`], "a self-review in another case blocks");
});

const put = (root: string, path: string, needs: readonly string[]): void => writeFileSync(join(root, path), `# t\n\n---\n\n${needs.join("\n")}\n`);
const message = (root: string, where: string): string => checkStudio(root, NOW).findings.find((f) => f.rule === "process.prompt_templates" && f.where === where)?.message ?? "";

test("W-426-b1 behaviour 1: the spec review template asks a kind: ui reviewer whether each rule makes sense on the screen and who ruled it", () => {
  const root = mkdtempSync(join(tmpdir(), "bisellium w426 'é-"));
  dirs.push(root);
  assert.ok(initStudio(root, { now: NOW }).root);
  declareOps(root);
  lex(root, CLAUSE);
  templates(root);
  put(root, SPEC_REVIEW, ["# Spec review prompt (D-046)"]);
  assert.deepEqual(found(root), [`block ${SPEC_REVIEW}`], "a spec review without the sense texts blocks");
  for (const s of SENSE) assert.ok(message(root, SPEC_REVIEW).includes(s), `the finding names ${s}`);
  put(root, SPEC_REVIEW, SENSE);
  assert.deepEqual(found(root), [], "the sense texts clear it, with the Ops lex clause naming the three templates only");
  for (const s of SENSE) {
    put(root, SPEC_REVIEW, SENSE.filter((x) => x !== s));
    assert.deepEqual(found(root), [`block ${SPEC_REVIEW}`], `a spec review without ${s} blocks`);
  }
  put(root, SPEC_REVIEW, SENSE.map((s) => s.toUpperCase()));
  assert.deepEqual(found(root), [`block ${SPEC_REVIEW}`], "sense texts in another case block");
  rmSync(join(root, SPEC_REVIEW));
  assert.deepEqual(found(root), [`block ${SPEC_REVIEW}`], "an absent spec review blocks");
  mkdirSync(join(root, SPEC_REVIEW));
  assert.deepEqual(found(root), [`block ${SPEC_REVIEW}`], "a directory at the spec review path blocks");
  const plain = officina();
  assert.deepEqual(found(plain), [], "no ops collegium: the rule does not apply");
});

test("W-426-b2 behaviour 2: the ui-lead's input template carries its five slots, the data phrase and the sense texts", () => {
  const root = officina();
  declareOps(root);
  lex(root, CLAUSE);
  templates(root);
  rmSync(join(root, UI_INPUT), { force: true });
  assert.deepEqual(found(root), [`block ${UI_INPUT}`], "an absent ui-input template blocks");
  put(root, UI_INPUT, UI_INPUT_NEEDS.filter((n) => !SENSE.includes(n)));
  assert.deepEqual(found(root), [`block ${UI_INPUT}`], "a ui-input template without the sense texts blocks");
  for (const s of SENSE) assert.ok(message(root, UI_INPUT).includes(s), `the finding names ${s}`);
  put(root, UI_INPUT, UI_INPUT_NEEDS);
  assert.deepEqual(found(root), [], "a complete ui-input template clears it, with the Ops lex clause naming the three templates only");
  for (const n of UI_INPUT_NEEDS) {
    put(root, UI_INPUT, UI_INPUT_NEEDS.filter((x) => x !== n));
    assert.deepEqual(found(root), [`block ${UI_INPUT}`], `a ui-input template without ${n} blocks`);
  }
  put(root, UI_INPUT, UI_INPUT_NEEDS.map((n) => (SENSE.includes(n) ? n.toUpperCase() : n)));
  assert.deepEqual(found(root), [`block ${UI_INPUT}`], "sense texts in another case block");
  rmSync(join(root, UI_INPUT));
  mkdirSync(join(root, UI_INPUT));
  assert.deepEqual(found(root), [`block ${UI_INPUT}`], "a directory at the ui-input path blocks");
});
