/**
 * packages/cli/src/safe-helpers.test.ts — W-163 rows b1-b5: one strict date
 * parser exported from @bisellium/schema, record dates and `--now` failing
 * closed, and officina writes refusing a symlinked parent. (b6, the census,
 * lives in containment.test.ts.) Every officina here is built under the OS
 * tmp dir with initStudio; nothing writes in studio/ or examples/.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { doneAt } from "@bisellium/core";
import { createNextRecord, requireRealDirectory } from "@bisellium/commands/ids.js";
import * as schema from "@bisellium/schema";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";

const here = import.meta.dirname;
const MAIN = join(here, "main.ts");
const NOW = new Date("2026-10-06T12:00:00Z");
const roots: string[] = [];
process.on("exit", () => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function scratch(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `w163-${tag}-`));
  roots.push(dir);
  return realpathSync(dir);
}

/** A fresh officina with a qa-lead sella, one building opus W-1 and one open petitio P-1. */
function officina(tag: string): string {
  const root = join(scratch(tag), "officina");
  initStudio(root, { now: NOW });
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      'studio: "fixture"',
      "patron: patron",
      'timezone: "UTC"',
      "collegia:",
      "  - { id: production, name: Production, magister: producer, lex: leges/production.md }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: producer, collegium: production, kind: agent }",
      "  - { id: qa-lead, collegium: qa, kind: agent }",
      "probationes:",
      "  - { id: patron, name: Patron call, kind: human }",
      "  - { id: spec, name: Spec, kind: agent }",
      "  - { id: review, name: Review, kind: agent }",
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(root, "opera"), { recursive: true });
  writeFileSync(
    join(root, "opera", "W-1.md"),
    ["---", 'id: "W-1"', 'title: "Fixture"', "kind: feature", "collegium: production", "state: building", "probationes:", "  spec: { status: passed, evidence: briefs/spec.md }", "  review: { status: pending }", "---", "Body.", ""].join("\n"),
  );
  mkdirSync(join(root, "petitiones"), { recursive: true });
  writeFileSync(
    join(root, "petitiones", "P-1.md"),
    ["---", 'id: "P-1"', "from: producer", "to: patron", "at: 2026-10-06T12:00:00Z", "status: open", "needs_you: true", 'question: "Ok?"', "---", "Please decide.", ""].join("\n"),
  );
  return root;
}

function cli(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), MAIN, ...args], { cwd, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const listing = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort();

test("W-163-b1 behaviour 1: one strict parser, exported from @bisellium/schema", () => {
  const instant = (schema as unknown as { instant?: (v: unknown) => Date | undefined }).instant;
  assert.equal(typeof instant, "function", "@bisellium/schema exports instant");
  const at = (v: unknown): string | undefined => instant!(v)?.toISOString();
  assert.equal(at("2026-10-06T12:00:00Z"), "2026-10-06T12:00:00.000Z");
  assert.equal(at("2026-10-06T12:00:00.123456789Z"), "2026-10-06T12:00:00.123Z");
  assert.equal(at("2026-10-06T14:00:00+02:00"), "2026-10-06T12:00:00.000Z");
  assert.equal(at("2026-10-06"), "2026-10-06T00:00:00.000Z");
  assert.equal(at(new Date("2026-10-06T12:00:00Z")), "2026-10-06T12:00:00.000Z");
  for (const bad of ["2026-02-30T00:00:00Z", "2026-10-06T24:00:00Z", "2026-10-06T12:00:00+24:00", "2026-10-06Tgarbage", "soon", 1759752000000, new Date(NaN), null])
    assert.equal(instant!(bad), undefined, `not an instant: ${String(bad)}`);
  for (const file of ["rules/process.ts", "../../core/src/completion.ts"]) {
    const text = readFileSync(join(here, file), "utf8");
    assert.ok(!/function\s+instant\b|(?:const|let)\s+instant\b/.test(text), `${file} declares no instant`);
  }
});

test("W-163-b2 behaviour 2: record dates fail closed where they are read", () => {
  assert.equal(doneAt({ end: "2026-02-30T00:00:00Z", probationes: {} }), undefined);
  assert.equal(doneAt({ end: "2026-02-30T00:00:00Z", probationes: { review: { status: "passed", at: "2026-10-01T00:00:00Z" } } }), "2026-10-01T00:00:00.000Z");
  const acta = (at: string): string[] => {
    const root = officina("b2");
    writeFileSync(join(root, "acta", "2026-10-06-x.md"), `---\nauthor: producer\nkind: decision\ntitle: "X"\nat: "${at}"\n---\nBody.\n`);
    return checkStudio(root, NOW).findings.filter((f) => f.rule === "acta.at").map((f) => f.message);
  };
  const soon = acta("soon");
  assert.equal(soon.length, 1, "a non-date at is blocked");
  assert.deepEqual(acta("2026-02-30T00:00:00Z"), soon);
});

test("W-163-b3 behaviour 3: --now is read by the same parser in every verb", () => {
  const root = scratch("b3");
  initStudio(join(root, "officina"), { now: NOW });
  const dir = join(root, "officina");
  const bad = "2026-02-30T00:00:00Z";
  const good = "2026-10-06T12:00:00Z";
  const c1 = cli(root, "check", dir, "--now", bad);
  assert.equal(c1.status, 2, `check exits 2: ${c1.stdout}${c1.stderr}`);
  assert.ok(c1.stderr.includes("--now"), c1.stderr);
  const t1 = cli(root, "tick", "--studio", dir, "--dry-run", "--now", bad);
  assert.equal(t1.status, 2, `tick exits 2: ${t1.stdout}${t1.stderr}`);
  assert.ok(t1.stderr.includes("--now"), t1.stderr);
  assert.equal(cli(root, "check", dir, "--now", good).status, 0, "check accepts a real instant");
  assert.equal(cli(root, "tick", "--studio", dir, "--dry-run", "--now", good).status, 0, "tick accepts a real instant");
});

test("W-163-b4 behaviour 4: the real-parent write check refuses a symlink in any component", () => {
  const make = (): { real: string; outside: string } => {
    const root = join(scratch("b4s"), "officina");
    mkdirSync(root, { recursive: true });
    return { real: realpathSync(root), outside: scratch("b4out") };
  };
  {
    const o = make();
    mkdirSync(join(o.real, "ci", "reds", "W-1"), { recursive: true });
    mkdirSync(join(o.real, "acta"));
    assert.doesNotThrow(() => requireRealDirectory(join(o.real, "ci", "reds", "W-1")));
    assert.doesNotThrow(() => requireRealDirectory(join(o.real, "acta")));
  }
  {
    const o = make();
    mkdirSync(join(o.outside, "reds", "W-1"), { recursive: true });
    symlinkSync(o.outside, join(o.real, "ci"));
    assert.throws(() => requireRealDirectory(join(o.real, "ci", "reds", "W-1")), "a symlinked ci/ above reds/W-1 throws");
  }
  {
    const o = make();
    symlinkSync(o.outside, join(o.real, "acta"));
    assert.throws(() => requireRealDirectory(join(o.real, "acta")), "acta itself a symlink throws");
  }
  {
    const parent = scratch("b4p");
    mkdirSync(join(parent, "target", "officina", "acta"), { recursive: true });
    symlinkSync(join(parent, "target"), join(parent, "alias"));
    assert.throws(() => requireRealDirectory(join(parent, "alias", "officina", "acta")), "an officina reached through a symlinked parent throws");
  }
  {
    const o = make();
    symlinkSync(o.outside, join(o.real, "opera"));
    assert.throws(() => createNextRecord(o.real, "opera", "W", (id) => `id: ${id}\n`));
    assert.deepEqual(listing(o.outside), [], "createNextRecord wrote nothing outside");
  }
});

test("W-163-b5 behaviour 5: officina writes refuse a symlinked parent and write nothing outside", () => {
  const findings = join(scratch("b5f"), "findings.md");
  writeFileSync(findings, "## Findings\n\nNo findings\n");
  const verdict = (root: string) => cli(root, "verdict", "W-1", "--round", "1", "--sella", "qa-lead", "--outcome", "passed", "--from", findings, "--studio", root, "--now", "2026-10-06T12:00:00Z");
  const red = (root: string) => cli(root, "red", "W-1", "--behaviour", "1", "--sella", "qa-lead", "--studio", root, "--now", "2026-10-06T12:00:00Z", "--", process.execPath, "-e", "process.exit(1)");
  const answer = (root: string) => cli(root, "answer", "--petitio", "P-1", "--charter-gap", "--studio", root, "--now", "2026-10-06T12:00:00Z", "Yes go");

  // real directories: each verb exits 0
  const v0 = verdict(officina("b5v0"));
  assert.equal(v0.status, 0, `verdict with real directories: ${v0.stdout}${v0.stderr}`);
  const r0 = red(officina("b5r0"));
  assert.equal(r0.status, 0, `red with real directories: ${r0.stdout}${r0.stderr}`);
  const a0 = answer(officina("b5a0"));
  assert.equal(a0.status, 0, `answer with real directories: ${a0.stdout}${a0.stderr}`);

  // ci/ a symlink to an outside dir: verdict and red refuse, the outside dir stays empty
  for (const [name, verb] of [["verdict", verdict], ["red", red]] as const) {
    const root = officina(`b5-${name}`);
    const outside = scratch(`b5-${name}-out`);
    symlinkSync(outside, join(root, "ci"));
    const r = verb(root);
    assert.notEqual(r.status, 0, `${name} exits non-zero through a symlinked ci/`);
    assert.deepEqual(listing(outside), [], `${name}: the outside dir stays empty`);
  }

  // acta/ a symlink: answer refuses, the outside dir stays empty, the petitio is untouched
  const root = officina("b5-answer");
  const outside = scratch("b5-answer-out");
  rmSync(join(root, "acta"), { recursive: true });
  symlinkSync(outside, join(root, "acta"));
  const before = readFileSync(join(root, "petitiones", "P-1.md"));
  const a = answer(root);
  assert.notEqual(a.status, 0, "answer exits non-zero through a symlinked acta/");
  assert.deepEqual(listing(outside), [], "answer: the outside dir stays empty");
  assert.ok(readFileSync(join(root, "petitiones", "P-1.md")).equals(before), "petitiones/P-1.md is byte-identical");
});
