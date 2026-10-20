/**
 * W-279: `ci --opus` hands a step to `verify` only when `verify` will run it, a
 * failing `verify` gate prints its log tail, and lint/format ignore foreign
 * worktree roots. W-335-b2: in a checkout whose package.json declares `test:record`, ci runs
 * `npm test` as scripts/test-reads.mjs. Rows are named `W-279-b<n> behaviour <n>: …` and selected with
 * `--test-name-pattern='^W-279-b<n> '`. node:test TAP. The fixtures are scratch
 * git repos and studios under os.tmpdir(); no timers, sleeps or polling.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { ESLint } from "eslint";
import * as prettier from "prettier";
import { parse } from "yaml";
import { initStudio } from "./init.js";
import { newItem } from "./new.js";
import { runCi } from "./ci.js";
import { runVerify } from "./verify.js";

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function commitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "master"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "fixture"]);
}

const MARKER_PROBATIONES = "probationes:\n  - { id: patron, name: Patron call, kind: human }\n";

/** A studio outside `repo`, whose one opus carries the given automated probationes (a YAML flow list body). */
function writeStudio(automated: string[], title: string): { studio: string; id: string } {
  const studio = tmp("w279-studio-");
  const init = initStudio(studio, { now: new Date("2026-09-19T00:00:00Z") });
  if (!init.ok) throw new Error(`initStudio failed: ${init.message}`);
  const manifestPath = join(studio, "bisellium.yml");
  const manifest = readFileSync(manifestPath, "utf8");
  if (!manifest.includes(MARKER_PROBATIONES)) throw new Error(`initStudio's manifest template changed:\n${manifest}`);
  const rows = automated.map((a) => `  - ${a}\n`).join("");
  writeFileSync(manifestPath, manifest.replace(MARKER_PROBATIONES, `${MARKER_PROBATIONES}${rows}`));
  const created = newItem(studio, { kind: "task", collegium: "production", title });
  if (!created.ok || !created.id) throw new Error(`newItem failed: ${created.message}`);
  return { studio, id: created.id };
}

const ORDER_MARKER = `import { appendFileSync } from "node:fs";
const label = process.argv[2] === "check" ? \`check:\${process.argv[3]}\` : process.argv[2];
appendFileSync("order.log", \`\${label}\\n\`);
`;

function orderRepo(): string {
  const dir = tmp("w279-repo-");
  writeFileSync(join(dir, "ci-marker.mjs"), ORDER_MARKER);
  writeFileSync(join(dir, ".gitignore"), "order.log\n");
  const scripts = Object.fromEntries(
    ["audit", "typecheck", "lint", "format:check", "test", "check"].map((s) => [s, `node ci-marker.mjs ${s}`]),
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "w279-fixture", private: true, scripts }, null, 2));
  commitRepo(dir);
  return dir;
}

const THREE_GATES = [
  '{ id: tests, name: Tests, kind: automated, command: "npm test -s" }',
  '{ id: lint, name: Lint, kind: automated, command: "npm run -s lint" }',
  '{ id: types, name: Typecheck, kind: automated, command: "npm run -s typecheck" }',
];

function orderLog(repo: string): string[] {
  return readFileSync(join(repo, "order.log"), "utf8").trim().split("\n").filter(Boolean);
}

function gateRecord(studio: string, id: string, gate: string): Record<string, unknown> {
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(studio, "opera", `${id}.md`), "utf8"));
  const record = parse(front?.[1] ?? "") as { probationes?: Record<string, Record<string, unknown>> };
  return record.probationes?.[gate] ?? {};
}

const LOOP_ONLY = ["audit", "format:check", "check:studio", "check:examples/sample-studio"];

test("W-279-b1 behaviour 1: ci --opus drops no applicable CI_STEPS command and runs each once when the Promise's stability and uniqueness conditions hold", async () => {
  // (a) every moved step runs once, as a verify gate
  {
    const repo = orderRepo();
    const { studio, id } = writeStudio(THREE_GATES, "w279 a");
    const result = await runCi(["--repo", repo, "--studio", studio, "--opus", id]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(orderLog(repo), [...LOOP_ONLY, "test", "lint", "typecheck"]);
    for (const gate of ["tests", "lint", "types"]) {
      const record = gateRecord(studio, id, gate);
      assert.equal(record["status"], "passed", gate);
      assert.match(String(record["certifies"]), /^tree:/, gate);
    }
  }
  // (b) a waived tests gate keeps its step in the loop
  {
    const repo = orderRepo();
    const { studio, id } = writeStudio(THREE_GATES, "w279 b");
    const opusPath = join(studio, "opera", `${id}.md`);
    const text = readFileSync(opusPath, "utf8");
    assert.ok(text.includes("probationes: {}"), text);
    writeFileSync(opusPath, text.replace("probationes: {}", "probationes:\n  tests:\n    status: waived"));
    const result = await runCi(["--repo", repo, "--studio", studio, "--opus", id]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(orderLog(repo), ["audit", "format:check", "test", "check:studio", "check:examples/sample-studio", "lint", "typecheck"]);
    assert.equal(gateRecord(studio, id, "tests")["status"], "waived");
  }
  // (c) a second gate with the same normalised command runs on its own; the loop adds no third
  {
    const repo = orderRepo();
    const gates = [...THREE_GATES, '{ id: tests-again, name: Tests again, kind: automated, command: "npm test" }'];
    const { studio, id } = writeStudio(gates, "w279 c");
    const result = await runCi(["--repo", repo, "--studio", studio, "--opus", id]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(orderLog(repo), [...LOOP_ONLY, "test", "lint", "typecheck", "test"]);
  }
});

test("W-279-b2 behaviour 2: lint and format ignore .worktrees and .kilo", async () => {
  const eslint = new ESLint();
  const foreign = [".worktrees/W-900/source.ts", ".kilo/worktrees/foreign/source.ts"];
  const options = { ignorePath: ".prettierignore" };
  for (const path of foreign) {
    assert.equal(await eslint.isPathIgnored(path), true, `eslint ${path}`);
    assert.equal((await prettier.getFileInfo(path, options)).ignored, true, `prettier ${path}`);
  }
  assert.equal(await eslint.isPathIgnored("packages/commands/src/ci.ts"), false);
  assert.equal((await prettier.getFileInfo("scripts/run-builder-host.mjs", options)).ignored, false);
});

test("W-279-b3 behaviour 3: a failing verify gate prints its log tail to stderr", async () => {
  const repo = tmp("w279-tail-");
  writeFileSync(join(repo, "noisy-fail.mjs"), 'for (let i = 1; i <= 300; i++) console.log("L" + String(i).padStart(4, "0"));\nprocess.exit(1);\n');
  writeFileSync(join(repo, "short-fail.mjs"), 'console.log("S-ONLY");\nprocess.exit(1);\n');
  commitRepo(repo);
  const { studio, id } = writeStudio(
    [
      '{ id: tests, name: Tests, kind: automated, command: "node noisy-fail.mjs" }',
      '{ id: lint, name: Lint, kind: automated, command: "true" }',
      '{ id: types, name: Typecheck, kind: automated, command: "node short-fail.mjs" }',
    ],
    "w279 tail",
  );
  const out: { stream: "out" | "err"; text: string }[] = [];
  const { log, error } = console;
  console.log = (...a: unknown[]) => void out.push({ stream: "out", text: a.join(" ") });
  console.error = (...a: unknown[]) => void out.push({ stream: "err", text: a.join(" ") });
  let exitCode: number;
  try {
    exitCode = (await runVerify([id, "--repo", repo, "--studio", studio])).exitCode;
  } finally {
    console.log = log;
    console.error = error;
  }
  assert.equal(exitCode, 1);
  const after = (gate: string): string[] => {
    const at = out.findIndex((e) => e.stream === "out" && e.text.startsWith(`${gate}: failed  ci/`));
    assert.ok(at !== -1, `no "${gate}: failed" line in ${JSON.stringify(out)}`);
    const header = out[at + 1];
    assert.ok(header?.stream === "err" && /^--- ci\/.*: log tail, at most 200 lines ---$/.test(header.text), `header after ${gate}: ${JSON.stringify(header)}`);
    const block = out[at + 2];
    assert.ok(block?.stream === "err", `block after ${gate}: ${JSON.stringify(block)}`);
    return block.text.split("\n");
  };
  const long = after("tests");
  assert.ok(long.length <= 200, `long tail is ${long.length} lines`);
  assert.ok(long.includes("L0300"));
  assert.ok(!long.includes("L0001"));
  const short = after("types").join("\n");
  assert.match(short, /certifies: tree:/);
  assert.match(short, /command: node short-fail\.mjs/);
  assert.match(short, /exit code: 1/);
  assert.match(short, /S-ONLY/);
  const stderr = out.filter((e) => e.stream === "err").map((e) => e.text).join("\n");
  assert.ok(!stderr.includes("exit code: 0"), "lint's log reached stderr");
});

test("W-313-b2 behaviour 2: ci --opus prints each step's and each gate's start and end with the time, a step's output between them", async () => {
  const repo = tmp("w313-repo-");
  writeFileSync(join(repo, "ci-marker.mjs"), 'console.log(`marker ${process.argv[2] === "check" ? `check:${process.argv[3]}` : process.argv[2]}`);\n');
  const scripts = Object.fromEntries(["audit", "typecheck", "lint", "format:check", "test", "check"].map((s) => [s, `node ci-marker.mjs ${s}`]));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "w313-fixture", private: true, scripts }, null, 2));
  commitRepo(repo);
  const { studio, id } = writeStudio(THREE_GATES, "w313 b2");
  const seen: { stream: "out" | "err"; text: string }[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  // record what ci writes, and pass it on
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: never[]) => (seen.push({ stream: "out", text: String(chunk) }), out(chunk, ...rest))) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: never[]) => (seen.push({ stream: "err", text: String(chunk) }), err(chunk, ...rest))) as typeof process.stderr.write;
  let exitCode: number;
  try {
    exitCode = (await runCi(["--repo", repo, "--studio", studio, "--opus", id])).exitCode;
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  assert.equal(exitCode, 0);
  const ISO = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z`;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = (what: string, stream: "out" | "err", re: RegExp, from = 0): number => {
    const i = seen.findIndex((e, n) => n >= from && e.stream === stream && re.test(e.text));
    assert.ok(i !== -1, `${what}: no ${stream} line matching ${re} after entry ${from} in ${JSON.stringify(seen)}`);
    return i;
  };
  let from = 0;
  for (const [step, label] of [["npm run -s audit", "audit"], ["npm run -s format:check", "format:check"], ["npm run -s check -- studio --repo .", "check:studio"], ["npm run -s check -- examples/sample-studio --repo .", "check:examples/sample-studio"]]) {
    const start = at("a step prints its start", "err", new RegExp(`^bisellium ci: step ${esc(step!)}: start ${ISO}\n$`), from);
    const output = at("a step's output passes through between its start and end", "out", new RegExp(`^marker ${esc(label!)}\n$`), start);
    from = at("a step prints its end", "err", new RegExp(`^bisellium ci: step ${esc(step!)}: end ${ISO} after \\d+m\\d\\ds, exited 0\n$`), output);
  }
  for (const gate of ["tests", "lint", "types"]) {
    const start = at("a gate prints its start", "err", new RegExp(`^bisellium verify: gate ${gate}: start ${ISO}\n$`), from);
    from = at("a gate prints its end", "err", new RegExp(`^bisellium verify: gate ${gate}: end ${ISO} after \\d+m\\d\\ds, exited 0\n$`), start);
  }
  assert.ok(!seen.some((e) => e.stream === "out" && /^marker (test|lint|typecheck)\n$/.test(e.text)), "a gate's output goes to its log, not the terminal");
});

const TEST_READS = "node scripts/test-reads.mjs";
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");

/** W-335: orderRepo's checkout, plus scripts/test-reads.mjs and the two scripts it runs, `studio/x.md`, two tests that
 *  read it and a `test:record` naming `record`; `test` runs the marker and both tests. */
function readsRepo(record: string): string {
  const dir = tmp("w335-repo-");
  writeFileSync(join(dir, "ci-marker.mjs"), ORDER_MARKER);
  writeFileSync(join(dir, ".gitignore"), "order.log\n");
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "studio"));
  for (const name of ["test-reads.mjs", "record-reads.mjs", "ci-scope.mjs"]) copyFileSync(join(SCRIPTS, name), join(dir, "scripts", name));
  writeFileSync(join(dir, "studio", "x.md"), "x\n");
  for (const name of ["a", "b"]) writeFileSync(join(dir, `${name}.test.mjs`), 'import { readFileSync } from "node:fs";\nreadFileSync(new URL("./studio/x.md", import.meta.url));\n');
  const scripts: Record<string, string> = Object.fromEntries(["audit", "typecheck", "lint", "format:check", "check"].map((s) => [s, `node ci-marker.mjs ${s}`]));
  scripts["test"] = "node ci-marker.mjs test && node a.test.mjs && node b.test.mjs";
  scripts["test:record"] = record;
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "w335-fixture", private: true, scripts }, null, 2));
  commitRepo(dir);
  return dir;
}

async function quietly<T>(run: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const { error } = console;
  let stderr = "";
  console.error = (...a: unknown[]) => void (stderr += `${a.join(" ")}\n`);
  try {
    return { result: await run(), stderr };
  } finally {
    console.error = error;
  }
}

test("W-335-b2 behaviour 2: where package.json declares test:record, ci runs npm test as scripts/test-reads.mjs, in its loop and as the tests gate of ci --opus", async () => {
  assert.equal(existsSync(join(SCRIPTS, "test-reads.mjs")), true, "scripts/test-reads.mjs exists");
  const exact = "node a.test.mjs && node b.test.mjs";
  // (a) ci --opus: the tests gate runs the wrapper once, and its log names the check and its verdict
  {
    const repo = readsRepo(exact);
    const { studio, id } = writeStudio(THREE_GATES, "w335 a");
    const result = await runCi(["--repo", repo, "--studio", studio, "--opus", id]);
    assert.equal(result.exitCode, 0, "an exact test:record passes ci --opus");
    assert.deepEqual(orderLog(repo), [...LOOP_ONLY, "test", "lint", "typecheck"], "npm test runs once, as the gate");
    const tests = gateRecord(studio, id, "tests");
    assert.equal(tests["status"], "passed");
    const log = readFileSync(join(studio, String(tests["evidence"])), "utf8");
    assert.match(log, /^command: node scripts\/test-reads\.mjs$/m, "the tests gate ran the wrapper");
    assert.match(log, /--check-reads/, "its log names the check");
    assert.match(log, /^record_reads=ok$/m, "and the check's verdict");
  }
  // (b) ci --opus: a test missing from test:record fails the tests gate, and ci
  {
    const repo = readsRepo("node b.test.mjs");
    const { studio, id } = writeStudio(THREE_GATES, "w335 b");
    const { result } = await quietly(() => runCi(["--repo", repo, "--studio", studio, "--opus", id]));
    assert.equal(result.exitCode, 1, "an unlisted reader fails ci --opus");
    const tests = gateRecord(studio, id, "tests");
    assert.equal(tests["status"], "failed", "the tests gate fails");
    assert.match(readFileSync(join(studio, String(tests["evidence"])), "utf8"), /^unlisted: a\.test\.mjs \(read studio\/x\.md\)$/m, "its log names the unlisted test");
  }
  // (c) plain ci: the loop's npm test step runs the wrapper, and a failure names it
  {
    const repo = readsRepo("node b.test.mjs");
    const { result, stderr } = await quietly(() => runCi(["--repo", repo]));
    assert.equal(result.exitCode, 1, "an unlisted reader fails plain ci");
    assert.deepEqual(orderLog(repo), ["audit", "typecheck", "lint", "format:check", "test"], "at the test step");
    assert.match(stderr, /step failed \(exit 1\): node scripts\/test-reads\.mjs/, "naming the wrapper");
  }
  // (d) a checkout whose package.json declares no test:record runs npm test as before
  {
    const repo = orderRepo();
    const result = await runCi(["--repo", repo]);
    assert.equal(result.exitCode, 0, "no test:record: plain ci passes without the wrapper");
    assert.deepEqual(orderLog(repo), ["audit", "typecheck", "lint", "format:check", "test", "check:studio", "check:examples/sample-studio"], "running npm test");
  }
  // (e) validateCommandOverride: a key that is not a planned gate, or an empty command, is refused before anything runs
  {
    const repo = readsRepo("node a.test.mjs && node b.test.mjs");
    const { studio, id } = writeStudio(THREE_GATES, "w335 e");
    const args = [id, "--repo", repo, "--studio", studio];
    const ok = await runVerify(args, { plan: true, commandOverride: { tests: TEST_READS } });
    assert.equal(ok.commands?.["tests"], TEST_READS, "a planned gate takes its override");
    const bad: Record<string, string>[] = [{ nope: TEST_READS }, { tests: "" }];
    for (const commandOverride of bad) {
      const { result, stderr } = await quietly(() => runVerify(args, { plan: true, commandOverride }));
      assert.equal(result.exitCode, 2, `${JSON.stringify(commandOverride)} is refused`);
      assert.match(stderr, /commandOverride/, "naming the option");
    }
  }
});
