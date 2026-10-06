/**
 * W-120 rows b1-b3 (studio/briefs/W-120.md): a fired kill clause is never
 * invoked afterwards. node:test TAP, selected by `--test-name-pattern=W-120-b<n>`.
 * Every row builds its own officina under the OS tmp dir; nothing in studio/
 * or examples/.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkStudio, type Finding } from "../check.js";
import { initStudio } from "../init.js";

const NOW = new Date("2026-10-06T12:00:00Z");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function officina(): string {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w120-"));
  dirs.push(root);
  assert.ok(initStudio(root, { now: NOW }).root);
  const manifest = join(root, "bisellium.yml");
  const text = readFileSync(manifest, "utf8");
  writeFileSync(manifest, text.replace("kind: human }\n", "kind: human }\n  - { id: signoff, name: Signoff, kind: human }\n"));
  mkdirSync(join(root, "decisions"), { recursive: true });
  writeFileSync(join(root, "petitiones", "P-001.md"), "---\nid: P-001\n---\nthe record that saw the kill fire\n");
  return root;
}

function decision(root: string, n: number, extra: string[] = []): void {
  const lines = ["---", `id: D-${n}`, "title: fixture", "at: 2026-09-20T00:00:00Z", "provenance: stated", "by: patron", "kill_when: when it fires", ...extra, "---", "body", ""];
  writeFileSync(join(root, "decisions", `D-${n}.md`), lines.join("\n"));
}

const KILL = ["killed_at: 2026-09-25T00:00:00Z", "killed_by: petitiones/P-001.md"];

function opus(root: string, id: string, state: string, extra: string[]): void {
  const lines = ["---", `id: ${id}`, `title: ${id} fixture`, "collegium: production", `state: ${state}`, ...extra, "---", "body", ""];
  writeFileSync(join(root, "opera", `${id}.md`), lines.join("\n"));
}

const halt = (root: string, id: string, by: string, at?: string): void =>
  opus(root, id, "halted", [`halted_by: ${by}`, ...(at ? [`halted_at: ${at}`] : [])]);

const waiver = (root: string, id: string, state: string, at?: string): void =>
  opus(root, id, state, [
    "probationes:",
    "  signoff:",
    "    status: waived",
    "    reason: r",
    "    waived_by: D-1",
    "    sella: patron",
    ...(at ? [`    at: ${at}`] : []),
  ]);

const found = (root: string, rule: string): Finding[] =>
  checkStudio(root, NOW).findings.filter((f) => f.rule === rule);
const shape = (root: string, where: string): Finding[] => found(root, "decision.shape").filter((f) => f.where === where);
const invoked = (root: string, where: string): Finding[] => found(root, "decision.invoked_after_kill").filter((f) => f.where === where);

test("W-120-b1 behaviour 1: decision.shape judges the kill record", () => {
  const root = officina();
  decision(root, 1, KILL);
  decision(root, 2, ["killed_at: 2026-09-25T00:00:00Z"]);
  decision(root, 3, ["killed_by: petitiones/P-001.md"]);
  decision(root, 4, ['killed_at: "soon"', "killed_by: petitiones/P-001.md"]);
  decision(root, 5, ["killed_at: 2026-09-19T00:00:00Z", "killed_by: petitiones/P-001.md"]);
  decision(root, 6, ["killed_at: 2026-09-25T00:00:00Z", "killed_by: ../outside.md"]);
  decision(root, 7, ["killed_at: 2026-09-25T00:00:00Z", "killed_by: petitiones/P-404.md"]);
  decision(root, 8, ["killed_at: 2026-09-25T00:00:00Z", "killed_by: briefs/W-1.md"]);
  decision(root, 9);
  assert.deepEqual(shape(root, "decisions/D-1.md"), [], "a valid kill record yields nothing");
  const cases: [number, string][] = [
    [2, "killed_at without killed_by"],
    [3, "killed_by without killed_at"],
    [4, "killed_at: soon"],
    [5, "killed_at a day before the decision's at"],
    [6, "killed_by: ../outside.md"],
    [7, "killed_by: petitiones/P-404.md"],
    [8, "killed_by: briefs/W-1.md"],
  ];
  for (const [n, what] of cases) {
    const got = shape(root, `decisions/D-${n}.md`);
    assert.equal(got.length, 1, `${what} yields decision.shape`);
    assert.equal(got[0]?.level, "block", `${what} blocks`);
  }
  assert.deepEqual(shape(root, "decisions/D-9.md"), [], "neither key yields none");
});

test("W-120-b2 behaviour 2: a halt that invokes a decision after its kill is a blocking finding", () => {
  const root = officina();
  decision(root, 1, KILL);
  decision(root, 2);
  halt(root, "W-1", "D-1", "2026-09-26T00:00:00Z");
  halt(root, "W-2", "D-1", "2026-09-25T00:00:00.000Z");
  halt(root, "W-3", "D-1", "2026-09-24T00:00:00Z");
  halt(root, "W-4", "D-1");
  halt(root, "W-5", "D-2", "2026-09-26T00:00:00Z");
  const w1 = invoked(root, "opera/W-1.md");
  assert.equal(w1.length, 1, "W-1: one decision.invoked_after_kill");
  assert.equal(w1[0]?.level, "block");
  assert.match(w1[0]?.message ?? "", /D-1/);
  assert.match(w1[0]?.message ?? "", /2026-09-26T00:00:00(\.000)?Z/);
  assert.match(w1[0]?.message ?? "", /2026-09-25T00:00:00(\.000)?Z/);
  assert.match(w1[0]?.message ?? "", /petitiones\/P-001\.md/);
  assert.equal(invoked(root, "opera/W-2.md").length, 1, "W-2 at exactly the kill instant counts as after");
  assert.deepEqual(invoked(root, "opera/W-3.md"), [], "W-3 before the kill is history");
  assert.equal(invoked(root, "opera/W-4.md").length, 1, "W-4 with no time fails closed");
  assert.deepEqual(invoked(root, "opera/W-5.md"), [], "W-5 cites a decision with no kill record");
  decision(root, 1, ["killed_at: 2026-09-27T00:00:00Z", "killed_by: petitiones/P-001.md"]);
  assert.deepEqual(invoked(root, "opera/W-1.md"), [], "moving the kill later clears W-1");
  assert.deepEqual(invoked(root, "opera/W-2.md"), [], "moving the kill later clears W-2");
});

test("W-120-b3 behaviour 3: a gate waiver that invokes a decision after its kill is a blocking finding", () => {
  const root = officina();
  decision(root, 1, KILL);
  waiver(root, "W-1", "review", "2026-09-26T00:00:00Z");
  waiver(root, "W-2", "review", "2026-09-24T00:00:00Z");
  waiver(root, "W-3", "review");
  waiver(root, "W-4", "done", "2026-09-26T00:00:00Z");
  const w1 = invoked(root, "opera/W-1.md");
  assert.equal(w1.length, 1, "W-1: one decision.invoked_after_kill for the waiver");
  assert.equal(w1[0]?.level, "block");
  assert.match(w1[0]?.message ?? "", /signoff/);
  assert.match(w1[0]?.message ?? "", /D-1/);
  assert.deepEqual(invoked(root, "opera/W-2.md"), [], "W-2 before the kill is history");
  assert.equal(invoked(root, "opera/W-3.md").length, 1, "W-3 with no at fails closed");
  assert.equal(invoked(root, "opera/W-4.md").length, 1, "a done opus is judged too");
});
