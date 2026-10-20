/**
 * packages/cli/src/safe-helpers.test.ts — W-163 rows b1-b5: one strict date
 * parser exported from @bisellium/schema, record dates and `--now` failing
 * closed, and officina writes refusing a symlinked parent. (b6, the census,
 * lives in containment.test.ts.) Every officina here is built under the OS
 * tmp dir with initStudio; nothing writes in studio/ or examples/.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { doneAt } from "@bisellium/core";
import { createNextRecord, requireRealDirectory } from "@bisellium/commands/ids.js";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import * as schema from "@bisellium/schema";
import { fakeProfile, type HarnessProfile } from "@bisellium/shim";
import { ESLint } from "eslint";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";
import { pruneCiLogs } from "./prune.js";
import { runTalk } from "./talk.js";

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
  // PATH is an empty directory: tick's provider probe can find no vendor CLI to spawn (the no-vendor sentinel's rule)
  const emptyBin = mkdtempSync(join(tmpdir(), "w163-nobin-"));
  roots.push(emptyBin);
  const r = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), MAIN, ...args], { cwd, encoding: "utf8", env: { ...process.env, PATH: emptyBin } });
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

test("W-163-b1 round 2: instant reads years 0000 to 0099 as the year they say", () => {
  const at = (v: string): string | undefined => schema.instant(v)?.toISOString();
  assert.equal(at("0000-01-01"), "0000-01-01T00:00:00.000Z");
  assert.equal(at("0099-12-31"), "0099-12-31T00:00:00.000Z");
  assert.equal(at("0004-02-29"), "0004-02-29T00:00:00.000Z");
  assert.equal(at("0000-02-29T12:30:00+01:00"), "0000-02-29T11:30:00.000Z");
  assert.equal(at("0001-02-29"), undefined, "year 1 is not a leap year");
  assert.equal(at("0100-02-29"), undefined, "year 100 is not a leap year");
  assert.equal(at("0099-02-30"), undefined);
});

test("W-163-b5 round 2: readContainedRegularFile reads a file directly under the officina root and refuses a symlinked, nested or escaping one", () => {
  const root = officina("b5r2");
  const outside = scratch("b5r2-out");
  writeFileSync(join(outside, "secret"), "outside");
  writeFileSync(join(root, "milestones.yml"), "a: 1\n");
  const ok = readContainedRegularFile(root, "milestones.yml", "");
  if ("error" in ok) assert.fail(`a root-level regular file reads: ${ok.error}`);
  assert.equal(ok.bytes.toString("utf8"), "a: 1\n");
  symlinkSync(join(outside, "secret"), join(root, "PAUSED"));
  assert.ok("error" in readContainedRegularFile(root, "PAUSED", ""), "a symlinked root-level file is refused");
  assert.ok("error" in readContainedRegularFile(root, "acta/x.md", ""), "a nested path is not a root-level file");
  assert.ok("error" in readContainedRegularFile(root, "../secret", ""), "an escaping path is refused");
  assert.ok("error" in readContainedRegularFile(root, "nothing-here", ""), "a missing file is an error, not a throw");
});

test("W-163-b5 round 2: prune keeps a gate log cited from a file at the officina root", () => {
  const root = officina("b5prune");
  writeFileSync(join(root, "opera", "W-9.md"), ["---", 'id: "W-9"', 'title: "Old"', "kind: feature", "collegium: production", "state: done", "---", "Body.", ""].join("\n"));
  mkdirSync(join(root, "ci"), { recursive: true });
  for (const name of ["W-9-review-aaaaaaaa.log", "W-9-spec-bbbbbbbb.log"]) writeFileSync(join(root, "ci", name), "log\n");
  writeFileSync(join(root, "milestones.yml"), "evidence: ci/W-9-review-aaaaaaaa.log\n");
  assert.deepEqual(pruneCiLogs(root).removed, ["ci/W-9-spec-bbbbbbbb.log"]);
  assert.ok(existsSync(join(root, "ci", "W-9-review-aaaaaaaa.log")), "the cited log stays");
});

/** One `talk` turn against a copy of the sample officina with a counting fake harness; returns the exit code and the harness calls. */
async function talkOnce(studio: string): Promise<{ exitCode: number; calls: { start: number; resume: number } }> {
  const calls = { start: 0, resume: 0 };
  const profile: HarnessProfile = {
    id: "fake",
    tier: fakeProfile.tier,
    available: () => fakeProfile.available(),
    start: async (o) => (calls.start++, fakeProfile.start(o)),
    resume: async (o) => (calls.resume++, fakeProfile.resume(o)),
  };
  const [log, err] = [console.log, console.error];
  console.log = (): void => undefined;
  console.error = (): void => undefined;
  try {
    const result = await runTalk(["--sella", "eng-lead", "--model-only", "--studio", studio, "--harness", "fake", "hello"], { harnesses: { fake: profile } });
    return { exitCode: result.exitCode, calls };
  } finally {
    console.log = log;
    console.error = err;
  }
}
const sampleCopy = (tag: string): string => {
  const dir = join(scratch(tag), "studio");
  cpSync(join(here, "../../../examples/sample-studio"), dir, { recursive: true });
  return dir;
};

test("W-163-b5 round 2: talk resumes no session through a symlinked sessions file and writes nothing outside", async () => {
  const studio = sampleCopy("b5talk-file");
  const outside = scratch("b5talk-file-out");
  const record = JSON.stringify({ harness: "fake", sessionId: "OUTSIDE-SESSION", startedAt: "2026-10-01T00:00:00Z", lastAt: "2026-10-01T00:00:00Z", turns: 1 }) + "\n";
  writeFileSync(join(outside, "session.json"), record);
  mkdirSync(join(studio, "sessions"), { recursive: true });
  symlinkSync(join(outside, "session.json"), join(studio, "sessions", "eng-lead.json"));
  const r = await talkOnce(studio);
  assert.notEqual(r.exitCode, 0, "talk refuses a symlinked session file");
  assert.deepEqual(r.calls, { start: 0, resume: 0 }, "no harness turn is spent");
  assert.equal(readFileSync(join(outside, "session.json"), "utf8"), record, "the outside file is untouched");
});

test("W-163-b5 round 2: talk refuses a symlinked sessions directory and writes nothing outside", async () => {
  const studio = sampleCopy("b5talk-dir");
  const outside = scratch("b5talk-dir-out");
  symlinkSync(outside, join(studio, "sessions"));
  const r = await talkOnce(studio);
  assert.notEqual(r.exitCode, 0, "talk refuses a symlinked sessions/");
  assert.deepEqual(r.calls, { start: 0, resume: 0 }, "no harness turn is spent");
  assert.deepEqual(listing(outside), [], "the outside dir stays empty");
});

// W-334: the lint rule `local/exact-digits` through the repo's own ESLint config, and the census readers on both sides of
// the 15-digit bound. Rows are `node:test`, named `W-334-b<n> behaviour <n>: …`; select one with
// --test-name-pattern='^W-334-b<n>\s'.
const REPO = join(here, "..", "..", "..");
const ESL = new ESLint({ cwd: REPO });
/** The messages `local/exact-digits` reports on `code`, linted as the repo file `file` by the repo's config. */
async function lossy(code: string, file = "packages/cli/src/w334-probe.ts"): Promise<string[]> {
  const [r] = await ESL.lintText(code, { filePath: join(REPO, file) });
  return (r?.messages ?? []).filter((m) => m.ruleId === "local/exact-digits").map((m) => m.message);
}
const DECL = "declare const s: string;\ndeclare const id: string;\n";

test("W-334-b1 behaviour 1: the lint refuses a regex capture of more than 15 digits read through a double, and passes a bounded or exact one", async () => {
  // the two S1 reads of 2026-10-20: a spec log's round (W-317 round 1) and a squash subject's PR number (W-330 round 1)
  const w317 = await lossy(`${DECL}const m = new RegExp(\`^\${id}-spec-([1-9][0-9]*)\\\\.log$\`).exec(s);\nexport const n = m === null ? 0 : Number(m[1]);\n`);
  assert.equal(w317.length, 1, `a spec log's round read through Number is reported: ${JSON.stringify(w317)}`);
  assert.match(w317[0]!, /^capture 1 of \/\^-spec-\(\[1-9\]\[0-9\]\*\)\\\.log\$\/ can hold unboundedly many digits, and a double is exact only to 15: bound the grammar to at most 15 digits or compare the capture exactly/);
  const w330 = await lossy(`${DECL}const n = s !== "" ? /\\(#([1-9][0-9]*)\\)$/.exec(s) : null;\nexport const pr = n === null ? 0 : Number(n[1]);\n`);
  assert.equal(w330.length, 1, `a subject's PR number read through Number is reported: ${JSON.stringify(w330)}`);

  const reported: [string, string][] = [
    ["parseInt", "const m = /^v(\\d+)$/.exec(s);\nexport const n = parseInt(m![1]!, 10);\n"],
    ["Number.parseInt", "const m = /^v(\\d+)$/.exec(s);\nexport const n = Number.parseInt(m?.[1] ?? '0', 10);\n"],
    ["parseFloat", "const m = /^v(\\d+)$/.exec(s);\nexport const n = parseFloat(m![1]!);\n"],
    ["Number.parseFloat", "const m = /^v(\\d+)$/.exec(s);\nexport const n = Number.parseFloat(m![1]!);\n"],
    ["a unary +", "export const n = +(/^v(\\d+)$/.exec(s) ?? [])[1]!;\n"],
    ["{1,}", "const m = /^v(\\d{1,})$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["16 digits", "const m = /^v([1-9]\\d{0,15})$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["a regex constant", "const RE = /^v([0-9]+)$/;\nconst m = RE.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["a non-global match", "const m = s.match(/^v(\\d+)$/);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["a matchAll callback", "export const ns = [...s.matchAll(/v(\\d+)/g)].map((m) => Number(m[1]));\n"],
    ["a for-of over matchAll", "for (const m of s.matchAll(/v(\\d+)/g)) console.log(Number(m[1]));\n"],
    ["a destructured capture", "const m = /^v(\\d+)$/.exec(s);\nif (m) {\n  const [, v] = m;\n  console.log(Number(v));\n}\n"],
    ["String.raw and a constant", "const END = String.raw`(?!\\d)`;\nconst RE = new RegExp(String.raw`v([1-9]\\d*)` + END, \"g\");\nexport const ns = [...s.matchAll(RE)].map((m) => Number(m[1]));\n"],
    ["the last of a list", "const last = [...s.matchAll(/(\\d+) failed/g)].at(-1);\nexport const n = last === undefined ? 0 : Number(last[1]);\n"],
    ["a group counted after a named one", "const m = /(?<y>\\d{4})-(\\d+)/.exec(s);\nexport const n = m ? Number(m[2]) : 0;\n"],
  ];
  for (const [name, code] of reported) assert.equal((await lossy(DECL + code)).length, 1, `${name}: reported`);
  assert.match((await lossy(DECL + reported[6]![1]))[0] ?? "", /can hold 16 digits/, "16 digits: the count is named");

  const passed: [string, string][] = [
    ["a round bounded to 15 digits", "const m = new RegExp(`^${id}-spec-([1-9][0-9]{0,14})\\\\.log$`).exec(s);\nexport const n = m === null ? 0 : Number(m[1]);\n"],
    ["four digits", "const m = /^(\\d{4})$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["fifteen digits", "const m = /^(\\d{1,15})$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["BigInt", "const m = /^v(\\d+)$/.exec(s);\nexport const n = m ? BigInt(m[1]!) : 0n;\n"],
    ["a string compare", "const m = /^v(\\d+)$/.exec(s);\nexport const same = m !== null && m[1] === '3';\n"],
    ["a group with no digit", "const m = /^(a+)-(\\d+)$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["a non-capturing group", "const m = /^(?:\\d+)-(\\d{2})$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["escaped parentheses", "const m = /^\\((\\d{2})\\)\\d+$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
    ["a named group", "const m = /(?<y>\\d{4})-(\\d+)/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n"],
  ];
  for (const [name, code] of passed) assert.deepEqual(await lossy(DECL + code), [], `${name}: not reported`);

  // where it runs: source, not tests (they read their own fixtures), and not the Patron's scripts/ci-certify.mjs (a stated limit)
  const plain = "const s = process.argv[2] ?? '';\nconst m = /^v(\\d+)$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n";
  assert.equal((await lossy(plain, "scripts/w334-probe.mjs")).length, 1, "a script is linted");
  assert.deepEqual(await lossy(DECL + reported[0]![1], "packages/cli/src/w334-probe.test.ts"), [], "a test file is not");
  assert.deepEqual(await lossy(plain, "scripts/ci-certify.mjs"), [], "scripts/ci-certify.mjs is not (the Patron's file)");
});
