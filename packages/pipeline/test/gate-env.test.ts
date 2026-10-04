/**
 * W-110 behaviour 4: a gate command is told which opus and officina it runs
 * for, and only the gate that needs it is. node:test TAP; `--behaviour 4`
 * selects the one test. Every temp dir lives under os.tmpdir() and is removed
 * in after(). The pipeline runs two automated commands (`tests` and
 * `served-e2e`), each a node script that dumps its own process.env to a JSON
 * file named after its probatio id.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { after, test } from "node:test";
import { filterEnv } from "@bisellium/shim";
import { localPipeline } from "../src/index.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && only !== 4) {
  console.error("gate-env.test.ts: --behaviour must be 4");
  process.exit(2);
}

const dirs: string[] = [];
function scratch(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w110-${tag}-`)));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const DUMP = `const fs = require("node:fs");
fs.writeFileSync(process.argv[2], JSON.stringify(process.env));
process.exit(Number(process.argv[3] ?? 0));
`;
const TREE = "0123456789abcdef0123456789abcdef01234567";
const OPUS_ID = "W-GATE";

const SHELL_SET = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

type Env = Record<string, string | undefined>;

interface Run {
  studio: string;
  logDir: string;
  repo: string;
  results: Awaited<ReturnType<typeof localPipeline.run>>;
  env: (id: string) => Env | undefined;
  before: string;
  after: string;
}

/** One pipeline run in a fresh repo/studio, with `parentEnv` overlaid on process.env for its duration. */
async function runGates(tag: string, parentEnv: Env, extra: (studio: string) => Record<string, unknown>, servedExit = 0): Promise<Run> {
  const repo = scratch(`${tag}-repo`);
  const studio = join(repo, "studio");
  const logDir = join(studio, "ci");
  mkdirSync(logDir, { recursive: true });
  const script = join(repo, "dump-env.cjs");
  writeFileSync(script, DUMP);
  const out = (id: string): string => join(repo, `${id}.json`);
  const commands = {
    tests: `node ${JSON.stringify(script)} ${JSON.stringify(out("tests"))} 0`,
    "served-e2e": `node ${JSON.stringify(script)} ${JSON.stringify(out("served-e2e"))} ${servedExit}`,
  };

  const saved: Env = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const before = JSON.stringify(process.env);
  let results: Run["results"];
  let afterEnv: string;
  try {
    const runOpts = { opus: { id: OPUS_ID } as never, repo, commands, treeHash: TREE, logDir, now: new Date("2026-10-03T00:00:00Z"), studioDir: studio, ...extra(studio) };
    results = await localPipeline.run(runOpts);
    afterEnv = JSON.stringify(process.env);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const env = (id: string): Env | undefined => {
    try {
      return JSON.parse(readFileSync(out(id), "utf8")) as Env;
    } catch {
      return undefined;
    }
  };
  return { studio, logDir, repo, results, env, before, after: afterEnv };
}

if (only === undefined || only === 4) {
  test("W-110 behaviour 4: a gate command is told which opus and officina it runs for, and only the gate that needs it is", async () => {
    const CLEAN: Env = { BISELLIUM_OPUS: undefined, BISELLIUM_STUDIO_DIR: undefined };
    const GIT_FAMILY: Env = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "Sandbox" };
    const wanted = (studio: string) => ({ commandEnv: { "served-e2e": { BISELLIUM_OPUS: OPUS_ID, BISELLIUM_STUDIO_DIR: resolve(studio) } } });

    // Run 1: clean parent plus a credential and a git-config family; commandEnv names served-e2e only.
    const run1 = await runGates("one", { ...CLEAN, ...GIT_FAMILY, SOME_API_TOKEN: "hunter2" }, wanted);
    const tests1 = run1.env("tests");
    const served1 = run1.env("served-e2e");

    // (a) passes today
    assert.ok(tests1 && served1, "(a) both children ran and dumped their env");
    assert.ok((tests1["PATH"] ?? "").length > 0, "(a) PATH reaches the tests child");
    assert.ok((served1["PATH"] ?? "").length > 0, "(a) PATH reaches the served-e2e child");
    assert.equal(tests1["SOME_API_TOKEN"], undefined, "(a) a parent SOME_API_TOKEN does not reach tests");
    assert.equal(served1["SOME_API_TOKEN"], undefined, "(a) a parent SOME_API_TOKEN does not reach served-e2e");
    for (const [who, e] of [["tests", tests1], ["served-e2e", served1]] as const) {
      const leaked = Object.keys(e).filter((k) => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k));
      assert.deepEqual(leaked, [], `(a) the GIT_CONFIG_* family is filtered atomically for ${who}`);
    }

    // (b) Genuine red: the served-e2e child is told its opus and its (absolute) studio.
    assert.ok(served1, "(b) the served-e2e child's env was captured");
    assert.equal(served1["BISELLIUM_OPUS"], OPUS_ID, "(b) served-e2e sees BISELLIUM_OPUS equal to the opus id");
    assert.equal(served1["BISELLIUM_STUDIO_DIR"], resolve(run1.studio), "(b) served-e2e sees BISELLIUM_STUDIO_DIR equal to the resolved studio dir");
    assert.ok(isAbsolute(served1["BISELLIUM_STUDIO_DIR"] ?? ""), "(b) BISELLIUM_STUDIO_DIR is absolute");

    // (c) the tests child has neither name.
    assert.equal(tests1["BISELLIUM_OPUS"], undefined, "(c) tests does not see BISELLIUM_OPUS");
    assert.equal(tests1["BISELLIUM_STUDIO_DIR"], undefined, "(c) tests does not see BISELLIUM_STUDIO_DIR");

    // (d) a parent value never wins for served-e2e, and still reaches tests unchanged.
    const run2 = await runGates("two", { BISELLIUM_OPUS: "W-OTHER", BISELLIUM_STUDIO_DIR: "/tmp/elsewhere" }, wanted);
    const tests2 = run2.env("tests");
    const served2 = run2.env("served-e2e");
    assert.ok(tests2 && served2, "(d) both children ran in the poisoned-parent run");
    assert.equal(served2["BISELLIUM_OPUS"], OPUS_ID, "(d) the parent's BISELLIUM_OPUS does not win for served-e2e");
    assert.equal(served2["BISELLIUM_STUDIO_DIR"], resolve(run2.studio), "(d) the parent's BISELLIUM_STUDIO_DIR does not win for served-e2e");
    assert.equal(tests2["BISELLIUM_OPUS"], "W-OTHER", "(d) the parent's BISELLIUM_OPUS still reaches tests unchanged");
    assert.equal(tests2["BISELLIUM_STUDIO_DIR"], "/tmp/elsewhere", "(d) the parent's BISELLIUM_STUDIO_DIR still reaches tests unchanged");

    // (e) the parent's env is untouched, and no commandEnv means exactly today's env for both.
    assert.equal(run1.after, run1.before, "(e) process.env is unmodified after a run with commandEnv");
    assert.equal(run2.after, run2.before, "(e) process.env is unmodified after the poisoned-parent run");
    const run3 = await runGates("three", { ...CLEAN }, () => ({}));
    const tests3 = run3.env("tests");
    const served3 = run3.env("served-e2e");
    assert.ok(tests3 && served3, "(e) both children ran with no commandEnv");
    assert.equal(run3.after, run3.before, "(e) process.env is unmodified after a run without commandEnv");
    for (const [who, e] of [["tests", tests3], ["served-e2e", served3]] as const) {
      assert.equal(e["BISELLIUM_OPUS"], undefined, `(e) no commandEnv: ${who} sees no BISELLIUM_OPUS`);
      assert.equal(e["BISELLIUM_STUDIO_DIR"], undefined, `(e) no commandEnv: ${who} sees no BISELLIUM_STUDIO_DIR`);
      for (const [k, v] of Object.entries(filterEnv(process.env))) {
        if (SHELL_SET.has(k)) continue; // sh rewrites these itself
        assert.equal(e[k], v, `(e) no commandEnv: ${who} sees filterEnv(parent)[${k}] unchanged`);
      }
    }

    // (f) log names, headers, exit lines and the returned records are today's.
    const run4 = await runGates("four", { ...CLEAN }, wanted, 3);
    const tree8 = TREE.slice(0, 8);
    for (const [id, code, status] of [["tests", 0, "passed"], ["served-e2e", 3, "failed"]] as const) {
      const rel = `ci/${OPUS_ID}-${id}-${tree8}.log`;
      assert.deepEqual(run4.results[id], { status, evidence: rel, certifies: `tree:${TREE}` }, `(f) ${id}: returned { status, evidence, certifies }`);
      const log = readFileSync(join(run4.studio, rel), "utf8");
      const lines = log.split("\n");
      assert.equal(lines[0], `certifies: tree:${TREE}`, `(f) ${id}: certifies line`);
      assert.match(lines[1] ?? "", /^command: node /, `(f) ${id}: command line`);
      assert.equal(lines[2], `exit code: ${code}`, `(f) ${id}: exit code line`);
    }
  });
}
