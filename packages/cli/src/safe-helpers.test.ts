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
import { doneAt, EVENTS_LOG_REL } from "@bisellium/core";
import { ruledCases } from "@bisellium/commands/brief-admission.js";
import { createNextRecord, requireRealDirectory } from "@bisellium/commands/ids.js";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { readSequence, reconcileFindings } from "@bisellium/commands/verdict.js";
import * as schema from "@bisellium/schema";
import { fakeProfile, type HarnessProfile } from "@bisellium/shim";
import { ESLint } from "eslint";
import { checkStudio } from "./check.js";
import { draftRetro } from "./retro.js";
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

  // review round 1 fix: a cyclic chain of writes is unjudged (never a RangeError), whichever form it runs through
  const READ = "export const n = Number(m![1]);\n";
  const cyclic: [string, string][] = [
    ["a match", `let a: any = b;\nlet b: any = a;\nconst m = a.exec(s);\n${READ}`],
    ["a self-write", `let a: any = a;\nconst m = a.exec(s);\n${READ}`],
    ["a regex", `let r: any = q;\nlet q: any = r;\nconst m = r.exec(s);\n${READ}`],
    ["a pattern string", `let t: any = u;\nlet u: any = t;\nconst m = new RegExp(t).exec(s);\n${READ}`],
    ["a ?: side", `let a: any = id ? a : null;\nconst m = a;\n${READ}`],
    ["a list", `let l: any = k;\nlet k: any = l;\nconst m = l.at(0);\n${READ}`],
    ["a for-of list", `let l: any = k;\nlet k: any = l;\nfor (const m of l) console.log(Number(m[1]));\n`],
    ["a callback list", `let l: any = k;\nlet k: any = l;\nl.map((m: any) => Number(m[1]));\n`],
  ];
  for (const [name, code] of cyclic) assert.deepEqual(await lossy(DECL + code), [], `a cycle through ${name}: not judged, no throw`);

  // review round 1 fix: only a group's pattern is counted, never its name
  const named = (re: string, k = 1): string => `const m = ${re}.exec(s);\nexport const n = m ? Number(m[${k}]) : 0;\n`;
  assert.deepEqual(await lossy(DECL + named("/(?<group1234567890123456>a)/")), [], "a named group whose name holds 16 digits and whose pattern holds none: not reported");
  assert.deepEqual(await lossy(DECL + named("/(?<g1234567890123456>\\d{4})-(\\d{4})/")), [], "a 16-digit name over a 4-digit pattern: not reported");
  assert.deepEqual(await lossy(DECL + named("/(?<g1234567890123456>\\d{4})-(\\d{4})/", 2)), [], "the group after a long-named one is counted by its index");
  assert.match((await lossy(DECL + named("/(?<n>\\d{16})/")))[0] ?? "", /can hold 16 digits/, "a named group whose pattern holds 16 digits: reported");
  assert.match((await lossy(DECL + named("/(?<n>(?<inner1234>\\d)+)/")))[0] ?? "", /unboundedly many digits/, "a named group nesting a named group: the pattern is counted");
  assert.deepEqual(await lossy(DECL + `const m = new RegExp("((?<))").exec(s);\n${READ}`), [], "an unterminated group name is no hang and no verdict");

  // review round 1 fix: a reader that is not the global is not a numeric reader
  const shadowed: [string, string][] = [
    ["a local Number function", `function Number(x: string): string {\n  return x;\n}\n${DECL}const m = /^v(\\d+)$/.exec(s);\nexport const n = Number(m![1]!);\n`],
    ["an imported Number", `import { Number } from "./reader.js";\n${DECL}const m = /^v(\\d+)$/.exec(s);\nexport const n = Number(m![1]!);\n`],
    ["a Number parameter", `${DECL}export const f = (Number: (x: string) => string) => Number(/^v(\\d+)$/.exec(s)![1]!);\n`],
    ["a local parseInt", `import parseInt from "./reader.js";\n${DECL}const m = /^v(\\d+)$/.exec(s);\nexport const n = parseInt(m![1]!, 10);\n`],
    ["a local parseFloat", `const parseFloat = (x: string): string => x;\n${DECL}const m = /^v(\\d+)$/.exec(s);\nexport const n = parseFloat(m![1]!);\n`],
    ["a local Number's parseInt", `const Number = { parseInt: (x: string, r: number): string => x + r };\n${DECL}const m = /^v(\\d+)$/.exec(s);\nexport const n = Number.parseInt(m![1]!, 10);\n`],
    ["a local Number's parseFloat", `import * as Number from "./reader.js";\n${DECL}const m = /^v(\\d+)$/.exec(s);\nexport const n = Number.parseFloat(m![1]!);\n`],
  ];
  for (const [name, code] of shadowed) assert.deepEqual(await lossy(code), [], `${name}: a shadowed reader is not judged`);
  const sibling = `${DECL}export const f = (Number: string): string => Number;\nconst m = /^v(\\d+)$/.exec(s);\nexport const n = Number(m![1]!);\nexport const p = Number.parseInt(m![1]!, 10);\n`;
  assert.equal((await lossy(sibling)).length, 2, "a Number declared in a sibling scope leaves the global reported");

  // where it runs: source, not tests (they read their own fixtures), and not the Patron's scripts/ci-certify.mjs (a stated limit)
  const plain = "const s = process.argv[2] ?? '';\nconst m = /^v(\\d+)$/.exec(s);\nexport const n = m ? Number(m[1]) : 0;\n";
  assert.equal((await lossy(plain, "scripts/w334-probe.mjs")).length, 1, "a script is linted");
  assert.deepEqual(await lossy(DECL + reported[0]![1], "packages/cli/src/w334-probe.test.ts"), [], "a test file is not");
  assert.deepEqual(await lossy(plain, "scripts/ci-certify.mjs"), [], "scripts/ci-certify.mjs is not (the Patron's file)");
});

test("W-334-b2 behaviour 2: a bounded reader holds no round past 15 digits and reads one at the bound exactly; an exact reader names a longer number as written", async () => {
  // the verdict sequence (W-215), a bounded reader: two adjacent rounds past the safe integers are not rounds, never one
  const root = scratch("w334-b2");
  const ci = join(root, "ci");
  const put = (n: string, session: string): void => writeFileSync(join(ci, `W-900-spec-${n}.log`), `# opus: W-900\n# phase: spec\n# round: ${n}\n# sella: spec-reviewer\n# session: ${session}\n\n## Findings\nNo findings\n\n## Verdict\npassed\n`);
  mkdirSync(ci);
  put("9007199254740992", "s-992");
  put("9007199254740993", "s-993");
  assert.deepEqual(readSequence(root, "W-900", "spec", "spec-reviewer"), { last: undefined }, "rounds past 15 digits are not rounds of the sequence");
  rmSync(ci, { recursive: true });
  mkdirSync(ci);
  put("999999999999998", "s-998");
  put("999999999999999", "s-999");
  const at = readSequence(root, "W-900", "spec", "spec-reviewer");
  assert.ok(!("error" in at), `the bound is read: ${JSON.stringify(at)}`);
  assert.deepEqual([at.last?.round, at.last?.log, at.last?.session], [999999999999999, "ci/W-900-spec-999999999999999.log", "s-999"], "the newest round at the bound is read exactly");

  // the verdict writer holds the same grammar
  const w = officina("w334-b2-verdict");
  const verdict = (round: string): string => cli(w, "verdict", "W-1", "--round", round, "--sella", "qa-lead", "--outcome", "passed", "--studio", w).stderr;
  assert.match(verdict("1000000000000000"), /--round must be a positive integer of at most 15 digits/, "the writer refuses a 16-digit round");
  assert.doesNotMatch(verdict("999999999999999"), /--round must be/, "the writer takes a 15-digit round");

  // review, a paired reader: the evidence path's bounded round is trusted, and a supplied --round must be in domain and the same
  const review = (evidence: string, ...round: string[]): { status: number | null; stderr: string } => cli(w, "review", "W-1", "--pass", "--evidence", evidence, ...round, "--sella", "qa-lead", "--studio", w);
  const roundsEmitted = (): unknown[] => (existsSync(join(w, EVENTS_LOG_REL)) ? readFileSync(join(w, EVENTS_LOG_REL), "utf8").split("\n").filter((l) => l.includes("workflow.gate_evaluated")).map((l) => (JSON.parse(l) as { attrs: Record<string, unknown> }).attrs["workflow.review.round"]) : []);
  mkdirSync(join(w, "ci"), { recursive: true });
  for (const n of ["3", "1234567890123456"]) writeFileSync(join(w, "ci", `W-1-review-${n}.log`), "review notes\n");
  assert.match(review("ci/W-1-review-3.log", "--round", "2").stderr, /--round 2 differs from ci\/W-1-review-3\.log's round 3/, "review refuses a --round that differs from the evidence's round");
  assert.match(review("ci/W-1-review-3.log", "--round", "1000000000000000").stderr, /--round must be a positive integer of at most 15 digits/, "review refuses a --round past 15 digits");
  assert.match(review("ci/W-1-review-1234567890123456.log").stderr, /names a round past 15 digits/, "review refuses an evidence round past 15 digits");
  assert.deepEqual(roundsEmitted(), [], "no refused review emitted an event");
  const reviewed = review("ci/W-1-review-3.log");
  assert.equal(reviewed.status, 0, `review with the evidence's round alone: ${reviewed.stderr}`);
  assert.deepEqual(roundsEmitted(), [3], "review emits the evidence's own round");

  // the previous retro's total, a bounded reader: a 16-digit total is absent, never its 15-digit prefix
  const usage = { agents: [{ label: "b", role: "builder", model: "m", tokens: 10, minutes: 1 }], totalTokens: 10, byModel: { m: 10 }, byRole: { builder: 10 }, waste: { reruns: 0, refused: 0, fixRounds: 0 } };
  const retroWith = (total: string): string => {
    const r = scratch("w334-retro");
    mkdirSync(join(r, "acta"));
    writeFileSync(join(r, "acta", "2026-10-01-retro-1.md"), `# Retro 1\n\n## Usage\n\n- Total tokens: ${total}\n`);
    return draftRetro(r, 2, { verifierIssues: 0, reviewFindings: [], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0, usage }, NOW).markdown;
  };
  assert.match(retroWith("1234567890123456"), /no prior retro found for comparison/, "a 16-digit previous total is absent, not truncated");
  assert.match(retroWith("999999999999999"), /vs cascade 1 \(999999999999999 → 10\)/, "a 15-digit previous total is read exactly");

  // the replay classifier and the red header, exact readers of a digit run (the specifier is a variable, so no types are needed)
  const host = "../../../scripts/replay-accept.mjs";
  const { classifyReplay, readRedBehaviour } = (await import(host)) as {
    classifyReplay: (r: { status: number; output: string }) => { accepted: boolean; reason: string };
    readRedBehaviour: (text: string, name: string) => number | undefined;
  };
  const pw = (count: string): { accepted: boolean; reason: string } => classifyReplay({ status: 1, output: `AssertionError: x\n  ${count} failed\nError: expect(received).toBe(expected)\n` });
  assert.deepEqual(pw("1"), { accepted: true, reason: "assertion-level failure" }, "a playwright count of exactly 1 is accepted");
  for (const count of ["1000000000000001", "01", "2"])
    assert.equal(pw(count).accepted, false, `a playwright count of ${count} is refused`);
  assert.match(pw("1000000000000001").reason, /playwright reported 1000000000000001 failed tests/, "a 16-digit playwright count is named as written");
  assert.equal(readRedBehaviour("# behaviour: 2\n", "02.log"), 2, "a red's behaviour header that matches its file is read");
  for (const [text, name] of [["# behaviour: 0000000000000002\n", "02.log"], ["# behaviour: 3\n", "02.log"], ["# command: x\n", "02.log"], ["# behaviour: 2\n", "2.log"]])
    assert.equal(readRedBehaviour(text!, name!), undefined, `a red's behaviour header ${JSON.stringify(text)} in ${name} is refused`);

  // brief.behaviour_citation, an exact reader: two adjacent citations past the safe integers are named as written
  mkdirSync(join(w, "briefs"), { recursive: true });
  writeFileSync(join(w, "briefs", "W-1.md"), "# W-1\n\nIt cites Behaviour 9007199254740992, Behaviour 9007199254740993 and Behaviour 1.\n\n## Behaviours to test\n\n1. **One.**\n");
  const cited = checkStudio(w, NOW).findings.filter((f) => f.rule === "brief.behaviour_citation").map((f) => f.message);
  assert.deepEqual(cited.sort(), ["brief cites Behaviour 9007199254740992 but declares 1 behaviours", "brief cites Behaviour 9007199254740993 but declares 1 behaviours"], "each citation past the declared count is named exactly; Behaviour 1 is accepted");

  // ruledCases, an exact clamp: a cited line past 15 digits is past the brief's last line, as before
  const brief = ["# W-9", "", "## Interfaces", "", "### Input domain", "", "A rejection fails closed.", "", "| Record | Valid domain | Rejected by |", "|---|---|---|", "| 1. x | any text; it recognises brief:99999999999999999999 and brief:2-99999999999999999999; every other form is a limit | `f` |", "last"].join("\n");
  const lines = ruledCases(brief).cases.filter((c) => c.row === 11).map((c) => c.line);
  assert.deepEqual(lines, [11, 12, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], "the row, then its cited lines, each clamped to the last line");
});


test("W-334-b2 malformed tokens: a digit run followed by a word character is not a number, at every bounded reader (ci/W-334-spec-4.log #1)", async () => {
  // each case names itself when it fails, so one run shows every reader that reads a prefix of a malformed token
  const failed: string[] = [];
  const holds = (name: string, ok: boolean): void => {
    if (!ok) failed.push(name);
  };

  // the previous retro's total: `Total tokens: 12x` is absent, not 12; so is a line that is not the generated one
  const usage = { agents: [{ label: "b", role: "builder", model: "m", tokens: 10, minutes: 1 }], totalTokens: 10, byModel: { m: 10 }, byRole: { builder: 10 }, waste: { reruns: 0, refused: 0, fixRounds: 0 } };
  const trendAfter = (line: string): string => {
    const r = scratch("w334-malformed-retro");
    mkdirSync(join(r, "acta"));
    writeFileSync(join(r, "acta", "2026-10-01-retro-1.md"), `# Retro 1\n\n## Usage\n\n${line}\n`);
    return draftRetro(r, 2, { verifierIssues: 0, reviewFindings: [], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0, usage }, NOW).markdown;
  };
  holds("retro total '12x' is absent", /no prior retro found for comparison/.test(trendAfter("- Total tokens: 12x")));
  holds("retro total '12 (est)' is absent", /no prior retro found for comparison/.test(trendAfter("- Total tokens: 12 (est)")));
  holds("retro total without the generated '- ' is absent", /no prior retro found for comparison/.test(trendAfter("Total tokens: 12")));
  holds("retro total '- Total tokens: 12' is read", /vs cascade 1 \(12 → 10\)/.test(trendAfter("- Total tokens: 12")));

  // a blocker's brief citation: `brief:2x` is no line 2, so the blocker converts to advisory; `brief:2` and `brief:2.` hold
  const brief = { spec: "briefs/W-1.md", text: "one\ntwo\nthree\n" };
  const converted = (cite: string): number => reconcileFindings(`## Findings\n1. blocking — see ${cite} here\n`, "failed", brief).converted.length;
  holds("citation 'brief:2x' is no citation", converted("brief:2x") === 1);
  holds("citation 'brief:2_' is no citation", converted("brief:2_") === 1);
  holds("citation 'brief:2' is line 2", converted("brief:2") === 0);
  holds("citation 'brief:2.' is line 2", converted("brief:2.") === 0);

  // the verdict sequence: a spec log whose round is `12x` is no round
  const root = scratch("w334-malformed-seq");
  mkdirSync(join(root, "ci"));
  writeFileSync(join(root, "ci", "W-900-spec-12x.log"), "# opus: W-900\n# phase: spec\n# round: 12\n# sella: spec-reviewer\n# session: s-12\n\n## Findings\nNo findings\n\n## Verdict\npassed\n");
  holds("spec log 'W-900-spec-12x.log' is no round", JSON.stringify(readSequence(root, "W-900", "spec", "spec-reviewer")) === JSON.stringify({ last: undefined }));

  // the verdict writer's and review's --round, and a review log named `3x`
  const w = officina("w334-malformed-verdict");
  const ran = (...argv: string[]): { status: number | null; stderr: string } => cli(w, ...argv, "--studio", w);
  holds("writer refuses '--round 12x'", /--round must be a positive integer of at most 15 digits/.test(ran("verdict", "W-1", "--round", "12x", "--sella", "qa-lead", "--outcome", "passed").stderr));
  mkdirSync(join(w, "ci"), { recursive: true });
  writeFileSync(join(w, "ci", "W-1-review-3x.log"), "review notes\n");
  const sloppy = ran("review", "W-1", "--pass", "--evidence", "ci/W-1-review-3x.log", "--round", "2", "--sella", "qa-lead");
  holds(`review treats 'W-1-review-3x.log' as no round of its own: ${sloppy.stderr}`, sloppy.status === 0);

  // the red header
  const host = "../../../scripts/replay-accept.mjs";
  const { readRedBehaviour } = (await import(host)) as { readRedBehaviour?: (text: string, name: string) => number | undefined };
  holds("readRedBehaviour is exported", typeof readRedBehaviour === "function");
  if (typeof readRedBehaviour === "function") {
    holds("red header '# behaviour: 2x' is not 2", readRedBehaviour("# behaviour: 2x\n", "02.log") === undefined);
    holds("red header '# behaviour: 2' is read", readRedBehaviour("# behaviour: 2\n", "02.log") === 2);
  }

  assert.deepEqual(failed, [], "a malformed token is read as the number of its digit prefix");
});
