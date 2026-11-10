/**
 * W-568: a manifest harness string that is not a known harness id refuses a sessioned verdict. W-571's `codexModels` read any
 * harness string other than exactly `codex` as "not the codex harness", so a Codex model seated only on a row whose harness
 * was blank, `Codex`, padded or misspelled was never judged, and a blind session's verdict was recorded (W-562 spec review
 * round 4, ~/.bisellium-evidence/W-562-specreview/r4b/verdict.md). Each row runs `runVerdict` in process over a scratch
 * officina, with HOME a scratch home of its own holding an empty `.codex/sessions` and CODEX_HOME unset: hermetic, never the
 * host's home or ~/.codex.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runVerdict } from "./verdict.js";

const NOW = new Date("2026-11-10T15:00:00.000Z");
const MODEL = "gpt-5.6-sol";
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const temp = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `bisellium-w568-${tag}-`));
  roots.push(d);
  return d;
};

/** `verdict` in process over an officina whose `sellae` block is `sellae` (raw YAML lines, the key included), with CODEX_HOME
 *  unset and HOME a scratch home holding an empty `.codex/sessions`: a Codex-judged verdict finds no rollout. */
function verdict(sellae: string[], extra: string[], turnRan?: unknown): { exitCode: number; stderr: string; ci: string[] } {
  const dir = temp("studio");
  writeFileSync(
    join(dir, "bisellium.yml"),
    ["bisellium: 1", "studio: W-568 harness", "patron: patron", "collegia:", "  - { id: engineering, name: Engineering, magister: eng-lead }", ...sellae, "probationes:", "  - { id: review, name: Review, kind: agent }", "wip_limit: 10", ""].join("\n"),
  );
  mkdirSync(join(dir, "opera"));
  writeFileSync(join(dir, "opera", "W-300.md"), "---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: engineering\nstate: building\nprobationes: {}\n---\n");
  const input = join(dir, "input.md");
  writeFileSync(input, "## Findings\nNo findings\n");
  const home = temp("home");
  mkdirSync(join(home, ".codex", "sessions"), { recursive: true });
  let stderr = "";
  const keep = { error: console.error, log: console.log, codex: process.env["CODEX_HOME"], home: process.env["HOME"] };
  console.error = (...args: unknown[]) => {
    stderr += `${args.map(String).join(" ")}\n`;
  };
  console.log = () => {};
  delete process.env["CODEX_HOME"];
  process.env["HOME"] = home;
  try {
    const opts = turnRan === undefined ? { now: NOW } : ({ now: NOW, turnRan } as Parameters<typeof runVerdict>[1]);
    const r = runVerdict(["W-300", "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--phase", "handoff", "--from", input, "--studio", dir, ...extra], opts);
    return { exitCode: r.exitCode, stderr, ci: existsSync(join(dir, "ci")) ? readdirSync(join(dir, "ci")).sort() : [] };
  } finally {
    console.error = keep.error;
    console.log = keep.log;
    if (keep.codex === undefined) delete process.env["CODEX_HOME"];
    else process.env["CODEX_HOME"] = keep.codex;
    if (keep.home === undefined) delete process.env["HOME"];
    else process.env["HOME"] = keep.home;
  }
}

const QA = "  - { id: qa-lead, collegium: engineering, kind: agent }";
/** The Codex model seated only on a row whose harness is `harness` (a YAML scalar, written as given). */
const seated = (harness: string): string[] => ["sellae:", QA, `  - { id: spec-reviewer, collegium: engineering, kind: agent, model: ${MODEL}, harness: ${harness} }`];
const CODEX = ["--model", MODEL, "--session", "s-568"];
const KNOWN = "claude-code, codex, fake, git-only";

test("W-568-b1 behaviour 1: a harness string that is not a known harness id refuses a sessioned verdict and writes nothing", () => {
  const wrongCase = verdict(seated("Codex"), CODEX);
  assert.equal(wrongCase.exitCode, 2, "a wrong-case harness is refused");
  assert.equal(
    wrongCase.stderr,
    `W-300: refusing: a sessioned verdict cannot be classified Codex or not: bisellium.yml#sellae[1].harness "Codex" is not a known harness id (${KNOWN})\n`,
    "the refusal names the row, the string and the known ids",
  );
  assert.deepEqual(wrongCase.ci, [], "and writes nothing");
  for (const [harness, why] of [
    ['""', "a blank harness is refused"],
    ['" codex "', "a padded harness is refused"],
    ['"codex "', "a trailing-space harness is refused"],
    ["codx", "a misspelled harness is refused"],
    ["claude_code", "a near-miss of another id is refused"],
    ["constructor", "an inherited property name is not a harness id"],
    ["__proto__", "the prototype key is not a harness id"],
  ] as const) {
    const r = verdict(seated(harness), CODEX);
    assert.equal(r.exitCode, 2, why);
    assert.deepEqual(r.ci, [], `${why}: nothing is written`);
  }
  const elsewhere = verdict(["sellae:", QA, `  - { id: spec-reviewer, collegium: engineering, kind: agent, model: ${MODEL}, harness: codex }`, "  - { id: other, collegium: engineering, kind: agent, model: claude-opus-5-5, harness: Claude-Code }"], CODEX, { ran: true, commands: 1 });
  assert.equal(elsewhere.exitCode, 2, "a malformed harness on another seat refuses too: the manifest cannot classify");
  assert.match(elsewhere.stderr, /bisellium\.yml#sellae\[2\]\.harness "Claude-Code" is not a known harness id/);
});

test("W-568-b1 behaviour 1: an absent harness or a known id classifies as before, and the other malformed forms stay refused", () => {
  const absent = verdict(["sellae:", QA, `  - { id: spec-reviewer, collegium: engineering, kind: agent, model: ${MODEL} }`], CODEX);
  assert.equal(absent.exitCode, 0, `an absent harness is claude-code, so the model is not judged: ${absent.stderr}`);
  assert.deepEqual(absent.ci, ["W-300-handoff-1.log"]);
  for (const id of ["claude-code", "git-only", "fake"]) {
    const r = verdict(seated(id), CODEX);
    assert.equal(r.exitCode, 0, `harness ${id} is a known id, not codex, so the model is not judged: ${r.stderr}`);
  }
  const codex = verdict(seated("codex"), CODEX);
  assert.equal(codex.exitCode, 2, "harness codex is judged: no rollout is refused");
  assert.match(codex.stderr, /failed to run: no rollout file\(s\) for session s-568 under /);
  const ran = verdict(seated("codex"), CODEX, { ran: true, commands: 1 });
  assert.equal(ran.exitCode, 0, `harness codex with a turn that ran is recorded: ${ran.stderr}`);
  assert.equal(verdict(["sellae:", QA, "  - { id: spec-reviewer, collegium: engineering, kind: agent, model: '', harness: codex }"], CODEX).exitCode, 2, "a codex row with a blank model is refused");
  assert.equal(verdict(["sellae:", QA, "  - { id: spec-reviewer, collegium: engineering, kind: agent, harness: codex }"], CODEX).exitCode, 2, "a codex row with no model is refused");
  assert.equal(verdict(["sellae:", QA, `  - { id: spec-reviewer, collegium: engineering, kind: agent, model: ${MODEL}, harness: }`], CODEX).exitCode, 2, "a null harness is refused");
  assert.equal(verdict(["sellae: 5"], CODEX).exitCode, 2, "a sellae that is not a list is refused");
  assert.equal(verdict(["sellae:", "  - just-a-name"], CODEX).exitCode, 2, "a sellae row that is not a mapping is refused");
  const unsessioned = verdict(seated("Codex"), ["--model", MODEL]);
  assert.equal(unsessioned.exitCode, 0, `a verdict without --session is not judged (W-569, a stated limit): ${unsessioned.stderr}`);
});
