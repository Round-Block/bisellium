/**
 * packages/cli/src/rules/handoff-traps.test.ts — W-490: the session handoff's Known traps item (Boot step 4).
 * Each line opens `- Standing: ` or `- Until W-<n>: `, naming the one opus that retires the trap; a line whose opus
 * is done is refused; the item holds at most 12 lines. Pure: sessionHandoffFindings over a text and an opera map,
 * and one checkStudio run over a scratch <repo>/studio for the wiring.
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkStudio } from "../check.js";
import { type HandoffOpus, sessionHandoffFindings } from "./process.js";

const HANDOFF = "docs/SESSION-HANDOFF.md";
/** W-1 is done, W-2 halted, W-3 and W-5 greenlit, W-4 backlog. */
const base = (): Map<string, HandoffOpus> =>
  new Map([
    ["W-1", { state: "done" }],
    ["W-2", { state: "halted" }],
    ["W-3", { state: "greenlit" }],
    ["W-4", { state: "backlog" }],
    ["W-5", { state: "greenlit" }],
  ]);
/** A handoff whose Boot list holds a Known traps item with `traps`, then a numbered item 5 with an unmarked line, then the Queue. */
const handoff = (traps: string[], heading = "4. Known traps (each line opens `Standing:` or `Until W-<n>:`; at most 12):"): string =>
  ["# Session handoff", "", "## Boot", "", "3. Roles.", heading, ...traps, "5. Standing until their opus lands:", "- an unmarked line outside the item.", "", "## Queue", "", "1. W-3 - one.", "2. W-5 - two."].join("\n");
/** The process.handoff.* findings as [rule, where]. */
const found = (text: string, opera = base()): string[][] =>
  sessionHandoffFindings(text, opera)
    .filter((f) => f.rule.startsWith("process.handoff."))
    .map((f) => [f.rule, f.where]);
/** The `where` of the first line of `text` that equals `line`. */
const at = (text: string, line: string): string => {
  const n = text.split("\n").indexOf(line);
  assert.notEqual(n, -1, `the fixture holds ${line}`);
  return `${HANDOFF}:${n + 1}`;
};
const SAMPLE_MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "examples", "sample-studio", "bisellium.yml");

test("W-490-b1 behaviour 1: each Known traps line opens `- Standing: ` or `- Until W-<n>: `, naming an opus with a record", () => {
  let text = handoff(["- Standing: a trap that stays.", "- Until W-3: a trap W-3 retires."]);
  assert.deepEqual(found(text), [], "a Standing line and an Until line naming an open opus pass");
  for (const [line, message] of [
    ["- a trap with no marker.", "an unmarked line is refused"],
    ["- Until filed: a trap with no opus.", "an Until filed line is refused"],
    ["- Standing: a trap that waits until W-3.", "an until after the marker is refused"],
    ["- until W-3: a lower-case marker.", "a lower-case marker is refused"],
  ] as const) {
    text = handoff(["- Standing: a trap that stays.", line]);
    assert.deepEqual(found(text), [["process.handoff.trap", at(text, line)]], message);
  }
  for (const line of [
    "- Until W-3 a marker with no colon.",
    "- Until W-3, W-5: two opera.",
    "- Standing (W-323 pattern): a marker with a note.",
    "- Standing:",
    "- Standing: a trap that waits (until filed).",
    "  a wrapped continuation line.",
  ]) {
    text = handoff(["- Standing: a trap that stays.", line]);
    assert.deepEqual(found(text), [["process.handoff.trap", at(text, line)]], `an unmarked line is refused: ${line}`);
  }
  text = handoff(["- Until W-77: a trap no record retires."]);
  assert.deepEqual(found(text), [["process.handoff.input", at(text, "- Until W-77: a trap no record retires.")]], "an Until naming no record is input");
  text = handoff(["- Standing: a.", "", "- Standing: b after a blank line.", "- after a blank line, unmarked."]);
  assert.deepEqual(found(text), [["process.handoff.trap", at(text, "- after a blank line, unmarked.")]], "a blank line does not end the item");
  text = handoff(["- Standing: a."]).replace("5. Standing until", "4. Known traps again:\n- unmarked.\n5. Standing until");
  assert.deepEqual(found(text), [["process.handoff.input", at(text, "4. Known traps again:")]], "a second Known traps item is input");
  assert.deepEqual(found(handoff([], "4. Other traps:")), [], "a handoff with no Known traps item is outside the rule");
  const finding = sessionHandoffFindings(handoff(["- no marker."]), base()).find((f) => f.rule === "process.handoff.trap");
  assert.equal(finding?.message, "a Known traps line opens `- Standing: ` or `- Until W-<n>: `, naming the one opus that retires it, and holds no other `until`", "the refusal names both markers");

  // wiring: check blocks it in the repository's own studio
  const repo = mkdtempSync(join(tmpdir(), "bisellium-w490-"));
  try {
    mkdirSync(join(repo, "studio", "opera"), { recursive: true });
    mkdirSync(join(repo, "docs"));
    copyFileSync(SAMPLE_MANIFEST, join(repo, "studio", "bisellium.yml"));
    for (const [id, o] of base()) writeFileSync(join(repo, "studio", "opera", `${id}.md`), `---\nid: "${id}"\ntitle: "x"\nkind: "feature"\ncollegium: "engineering"\nstate: ${o.state}\n---\n`);
    text = handoff(["- Standing: a.", "- no marker."]);
    writeFileSync(join(repo, HANDOFF), text);
    const blocked = checkStudio(join(repo, "studio"), new Date("2026-11-03T00:00:00Z"), { repo }).findings.filter((f) => f.rule === "process.handoff.trap");
    assert.deepEqual(blocked.map((f) => [f.rule, f.level, f.where]), [["process.handoff.trap", "block", at(text, "- no marker.")]], "check blocks an unmarked line in the repository's own studio");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("W-490-b2 behaviour 2: a Known traps line whose named opus is done is refused", () => {
  let text = handoff(["- Standing: a.", "- Until W-1: a trap W-1 retired."]);
  assert.deepEqual(found(text), [["process.handoff.trap", at(text, "- Until W-1: a trap W-1 retired.")]], "an Until line naming a done opus is refused");
  const finding = sessionHandoffFindings(text, base()).find((f) => f.rule === "process.handoff.trap");
  assert.equal(finding?.message, "W-1 is done: remove the trap it retired, or re-mark what still stands", "the refusal names the done opus");
  for (const id of ["W-2", "W-3", "W-4"]) assert.deepEqual(found(handoff([`- Until ${id}: a trap.`])), [], `a line naming a ${base().get(id)!.state} opus stands`);
  // next's done step reads the handoff with the opus it finishes marked done (handoffHold): the line it names is then refused
  text = handoff(["- Until W-3: a trap W-3 retires."]);
  const finishing = base().set("W-3", { state: "done", end: "2026-11-03T00:00:00Z" });
  assert.deepEqual(found(text, finishing), [["process.handoff.trap", at(text, "- Until W-3: a trap W-3 retires.")]], "finishing the named opus refuses its line");
  assert.deepEqual(found(handoff(["- Standing: the W-1 pattern, which W-1 set."])), [], "an id in a Standing line's text is not a marker");
});

test("W-490-b3 behaviour 3: the Known traps item holds at most 12 lines", () => {
  const lines = (n: number): string[] => Array.from({ length: n }, (_, i) => `- Standing: trap ${i + 1}.`);
  const heading = "4. Known traps (each line opens `Standing:` or `Until W-<n>:`; at most 12):";
  assert.deepEqual(found(handoff(lines(12))), [], "12 lines pass");
  let text = handoff(lines(13));
  assert.deepEqual(found(text), [["process.handoff.traps", at(text, heading)]], "13 lines are refused at the item");
  const finding = sessionHandoffFindings(text, base()).find((f) => f.rule === "process.handoff.traps");
  assert.equal(finding?.message, "the Known traps item holds 13 lines; the cap is 12", "the refusal names the count and the cap");
  assert.deepEqual(found(handoff([...lines(6), "", "", ...lines(6).map((l) => l.replace("trap", "more"))])), [], "blank lines are not counted");
  text = handoff([...lines(12), "- unmarked."]);
  assert.deepEqual(found(text), [["process.handoff.trap", at(text, "- unmarked.")], ["process.handoff.traps", at(text, heading)]], "an unmarked line counts toward the cap");
  assert.deepEqual(found(handoff(lines(12)).replace("- an unmarked line outside the item.", lines(3).join("\n"))), [], "lines after the next numbered item are not counted");
});
