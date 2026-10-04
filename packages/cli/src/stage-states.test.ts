/**
 * W-129 behaviours 10-15: the verbs record the verifying and review stages as
 * those stages run. `verify` writes `verifying` before its pipeline runs and
 * `review` or `building` when it ends (10-11), `review --fail` reopens a
 * `verifying` opus and says so (12), `check` accepts what the verbs write
 * (13-14), and one opus walks the whole cycle on its branch through the real
 * CLI and the real checker (15). Select exactly one numbered behaviour with
 * `--behaviour N` (10..15); omitting the selector runs all six. node:test TAP,
 * one test() per behaviour, modelled on ladder-followon.test.ts.
 *
 * `runVerify` runs with a stub `MergePipeline` and `runReview` in process, in a
 * tmp git repo whose checkout is on `opus/W-120` (the shape of
 * lifecycle.test.ts's `tmpGitStudioRepo`). A row that reads the events log
 * before anything has written it treats a missing file as an empty log.
 * No timers, sleeps or polling: every spawn is synchronous.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { readFront, readManifest } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL, readLog } from "@bisellium/core";
import type { GateRunResult, MergePipeline, PipelineRunOpts } from "@bisellium/pipeline";
import { WF } from "@bisellium/schema";
import { sourceTreeHash } from "@bisellium/shim";
import { checkStudio } from "./check.js";
import { runReview } from "./lifecycle.js";
import { runVerify, type RunVerifyOptions } from "./verify.js";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && (!Number.isInteger(only) || only! < 10 || only! > 15)) {
  console.error("stage-states.test.ts: --behaviour must be an integer from 10 through 15");
  process.exit(2);
}
const runs = (behaviour: number): boolean => only === undefined || only === behaviour;

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "main.ts");
const REPO = join(HERE, "..", "..", "..");
const SAMPLE = join(REPO, "examples", "sample-studio");
const NOW = new Date("2026-09-19T13:00:00Z");
const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const T0 = "0".repeat(40);

Object.assign(process.env, {
  TZ: "UTC",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "W-129 Test",
  GIT_AUTHOR_EMAIL: "w129@example.invalid",
  GIT_COMMITTER_NAME: "W-129 Test",
  GIT_COMMITTER_EMAIL: "w129@example.invalid",
});
delete process.env["BISELLIUM_SELLA"];
delete process.env["BISELLIUM_ROLE"];

// ---------------------------------------------------------------------------
// scratch, git, the capture of console output
// ---------------------------------------------------------------------------
const dirs: string[] = [];
function scratch(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w129-${tag}-`)));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 }).trim();
}
async function quiet<T>(fn: () => T | Promise<T>): Promise<{ result: T; out: string }> {
  const log = console.log;
  const err = console.error;
  let out = "";
  console.log = (...parts: unknown[]) => {
    out += `${parts.map(String).join(" ")}\n`;
  };
  console.error = (...parts: unknown[]) => {
    out += `${parts.map(String).join(" ")}\n`;
  };
  try {
    return { result: await fn(), out };
  } finally {
    console.log = log;
    console.error = err;
  }
}

// ---------------------------------------------------------------------------
// the officina fixture: opus W-120 on opus/W-120, checkout clean
// ---------------------------------------------------------------------------
const SPEC_GATE = "{ sella: architect, status: passed, evidence: briefs/W-120.md, at: 2026-09-19T11:00:00Z }";

interface RecOpts {
  state?: string;
  kind?: string;
  stage?: string;
  /** Raw flow-YAML per gate id; `null` drops a gate (the default spec pass included). */
  gates?: Record<string, string | null>;
  /** The raw `traditio:` value (flow YAML); `null` omits the key. */
  traditio?: string | null;
  extra?: string[];
}
function recordText(o: RecOpts = {}): string {
  const gates: Record<string, string | null> = { spec: SPEC_GATE, ...(o.gates ?? {}) };
  const gateLines = Object.entries(gates)
    .filter((e): e is [string, string] => e[1] !== null)
    .map(([id, v]) => `  ${id}: ${v}`);
  const traditio = o.traditio === undefined ? `{ sella: builder, stage: ${o.stage ?? "building"}, next: go, blocked_on: none, at: 2026-09-19T12:00:00Z }` : o.traditio;
  return [
    "---",
    "id: W-120",
    "title: stage states",
    `kind: ${o.kind ?? "feature"}`,
    "collegium: engineering",
    "sella: builder",
    `state: ${o.state ?? "building"}`,
    "spec: briefs/W-120.md",
    "probationes:",
    ...gateLines,
    ...(traditio === null ? [] : [`traditio: ${traditio}`]),
    ...(o.extra ?? []),
    "---",
    "Body.",
    "",
  ].join("\n");
}

interface Fx {
  dir: string;
  studio: string;
  record: string;
}
interface FxOpts {
  rec?: RecOpts;
  manifest?: (doc: ReturnType<typeof parseDocument>) => void;
  /** Stay on master instead of checking out opus/W-120. */
  trunk?: boolean;
}
const TESTS_LINT_SPEC_REVIEW = [
  { id: "tests", name: "Tests", kind: "automated", command: "true" },
  { id: "lint", name: "Lint", kind: "automated", command: "true" },
  { id: "spec", name: "Spec", kind: "agent" },
  { id: "review", name: "Review", kind: "agent" },
];
function fixture(tag: string, o: FxOpts = {}): Fx {
  const dir = scratch(tag);
  git(dir, ["init", "-q", "-b", "master"]);
  const studio = join(dir, "studio");
  cpSync(SAMPLE, studio, { recursive: true });
  for (const d of ["opera", "petitiones", "acta", "qa", "ci", "art"]) rmSync(join(studio, d), { recursive: true, force: true });
  mkdirSync(join(studio, "opera"));
  mkdirSync(join(studio, "ci"));
  mkdirSync(join(studio, "briefs"));
  const manifestPath = join(studio, "bisellium.yml");
  const doc = parseDocument(readFileSync(manifestPath, "utf8"));
  doc.setIn(["probationes"], TESTS_LINT_SPEC_REVIEW);
  o.manifest?.(doc);
  writeFileSync(manifestPath, doc.toString({ lineWidth: 0 }));
  writeFileSync(join(studio, "briefs", "W-120.md"), "brief\n");
  const record = join(studio, "opera", "W-120.md");
  writeFileSync(record, recordText(o.rec));
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "file.txt"), "sub\n");
  writeFileSync(join(dir, "src.txt"), "x\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  writeFileSync(join(dir, "src.txt"), "x\ny\n");
  git(dir, ["commit", "-q", "-am", "second source commit"]);
  git(dir, ["branch", "opus/W-120"]);
  if (!o.trunk) git(dir, ["checkout", "-q", "opus/W-120"]);
  return { dir, studio, record };
}
const setRecord = (fx: Fx, o: RecOpts): void => writeFileSync(fx.record, recordText(o));
const stateOf = (fx: Fx): string => String(readFront<{ state: unknown }>(fx.record).data.state);
const gatesOf = (fx: Fx): Record<string, Record<string, unknown>> =>
  (readFront<{ probationes?: Record<string, Record<string, unknown>> }>(fx.record).data.probationes ?? {}) as Record<string, Record<string, unknown>>;
/** The tree hash `verify` computes for this checkout (the same exclusions, the same ref). */
function treeOf(fx: Fx): string {
  return sourceTreeHash(fx.dir, ["studio", ".bisellium", ...(readManifest(fx.studio).source_excludes ?? [])], "HEAD");
}

function verdictLog(fx: Fx, name: string, header: { opus?: string | null; tree?: string[] | null; phase?: string } = {}): string {
  const lines = [
    ...(header.opus === null ? [] : [`# opus: ${header.opus ?? "W-120"}`]),
    `# phase: ${header.phase ?? "build"}`,
    "# round: 1",
    "# sella: qa-lead",
    "# outcome: failed",
    "# at: 2026-09-19T12:30:00Z",
    ...(header.tree === null ? [] : (header.tree ?? [`tree:${H1}`]).map((t) => `# tree: ${t}`)),
    "",
    "findings",
    "",
  ];
  writeFileSync(join(fx.studio, "ci", name), lines.join("\n"));
  return `ci/${name}`;
}
function evidenceLog(fx: Fx, name: string): string {
  writeFileSync(join(fx.studio, "ci", name), `# tree: tree:${H2}\nlog\n`);
  return `ci/${name}`;
}
/** A passed gate certifying `tree:<hash>`, with a real log under ci/. */
const passedGate = (fx: Fx, id: string, hash: string): string => `{ status: passed, evidence: ${evidenceLog(fx, `W-120-${id}-x.log`)}, certifies: "tree:${hash}" }`;

function readEvents(fx: Fx): { name: string; attrs: Record<string, unknown> }[] {
  const path = join(fx.studio, EVENTS_LOG_REL);
  return existsSync(path) ? readLog(path).events : [];
}
const changes = (fx: Fx): string[] =>
  readEvents(fx)
    .filter((e) => e.name === "workflow.state_changed" && e.attrs[WF.ITEM_ID] === "W-120")
    .map((e) => `${String(e.attrs[WF.STATE_FROM])}->${String(e.attrs[WF.STATE_TO])}`);

// ---------------------------------------------------------------------------
// stub pipelines and the verify runner
// ---------------------------------------------------------------------------
/** A result with a real log under ci/, certifying this run's tree unless told otherwise. */
function result(o: PipelineRunOpts, id: string, status: "passed" | "failed" = "passed", certifies?: string): GateRunResult {
  const file = `W-120-${id}-stub.log`;
  mkdirSync(o.logDir, { recursive: true });
  writeFileSync(join(o.logDir, file), `# tree: ${o.treeHash}\nstub ${id} ${status}\n`);
  return { status, evidence: `ci/${file}`, certifies: certifies ?? `${o.dirty ? "dirty" : "tree"}:${o.treeHash}` };
}
const stub = (fn: (o: PipelineRunOpts) => Record<string, GateRunResult>): MergePipeline => ({ id: "stub", run: async (o) => fn(o) });
const bothPassed = (o: PipelineRunOpts): Record<string, GateRunResult> => ({ tests: result(o, "tests"), lint: result(o, "lint") });

async function verify(fx: Fx, pipeline: MergePipeline, extra: string[] = [], opts: Partial<RunVerifyOptions> = {}): Promise<number> {
  const { result: r } = await quiet(() => runVerify(["W-120", "--studio", fx.studio, "--repo", fx.dir, ...extra], { ...opts, pipeline } as RunVerifyOptions));
  return r.exitCode;
}
/** `verify` with `fn`'s results; the state seen inside `run` is returned alongside the exit code. */
async function verifyObserved(
  fx: Fx,
  fn: (o: PipelineRunOpts) => Record<string, GateRunResult>,
  extra: string[] = [],
  opts: Partial<RunVerifyOptions> = {},
): Promise<{ exit: number; inside: string[]; insideChanges: string[][] }> {
  const inside: string[] = [];
  const insideChanges: string[][] = [];
  const exit = await verify(
    fx,
    stub((o) => {
      inside.push(stateOf(fx));
      insideChanges.push(changes(fx));
      return fn(o);
    }),
    extra,
    opts,
  );
  return { exit, inside, insideChanges };
}
const nothing = (): Record<string, GateRunResult> => ({});

const stateRuleFindings = (fx: Fx): string[] =>
  checkStudio(fx.studio, NOW, { repo: fx.dir })
    .findings.filter((f) => /^state\.(review|verifying)\./.test(f.rule))
    .map((f) => `${f.level} ${f.rule}`);

/** Every flavour of "the run is aimed at some other tree". */
function otherTreeRuns(fx: Fx): { label: string; extra: string[]; repo?: string; opts?: Partial<RunVerifyOptions> }[] {
  const clone = join(scratch("clone"), "clone");
  git(fx.dir, ["clone", "-q", fx.dir, clone]);
  return [
    { label: "--commit an older commit", extra: ["--commit", git(fx.dir, ["rev-parse", "HEAD~1"])] },
    { label: "studioRepoRelative (ci --ref)", extra: [], opts: { studioRepoRelative: "studio" } },
    { label: "--repo a second clone", extra: [], repo: clone },
    { label: "--repo a subdirectory of the same checkout", extra: [], repo: join(fx.dir, "sub") },
  ];
}
async function verifyOtherTree(fx: Fx, run: { extra: string[]; repo?: string; opts?: Partial<RunVerifyOptions> }, pipeline: MergePipeline): Promise<number> {
  const { result: r } = await quiet(() =>
    runVerify(["W-120", "--studio", fx.studio, "--repo", run.repo ?? fx.dir, ...run.extra], { ...(run.opts ?? {}), pipeline } as RunVerifyOptions),
  );
  return r.exitCode;
}

// ---------------------------------------------------------------------------
if (runs(10)) {
  test("W-129 behaviour 10: verify writes verifying before the pipeline runs, and only for the checkout's own tree", async () => {
    // (a) a non-active record never moves state (passes today)
    for (const state of ["greenlit", "backlog", "halted", "done"]) {
      const fx = fixture(`b10a-${state}`, { rec: { state } });
      const seen = await verifyObserved(fx, bothPassed);
      assert.deepEqual(seen.inside, [state], `10(a): a ${state} record reads ${state} inside run`);
      assert.equal(stateOf(fx), state, `10(a): and ${state} after verify`);
    }

    // (b) refusals leave the record byte-identical and call no stub (passes today)
    {
      const dirty = fixture("b10b-dirty");
      writeFileSync(join(dirty.dir, "src.txt"), "uncommitted\n");
      const trunk = fixture("b10b-trunk", { trunk: true });
      const unknown = fixture("b10b-unknown");
      const refusals: [string, Fx, string[]][] = [
        ["a dirty tree", dirty, ["W-120"]],
        ["the trunk checkout", trunk, ["W-120"]],
        ["an unknown opus", unknown, ["W-999"]],
      ];
      for (const [label, fx, ids] of refusals) {
        const before = readFileSync(fx.record, "utf8");
        let called = 0;
        const { result: r } = await quiet(() =>
          runVerify([...ids, "--studio", fx.studio, "--repo", fx.dir], {
            pipeline: stub(() => {
              called++;
              return {};
            }),
          }),
        );
        assert.equal(r.exitCode, 2, `10(b): verify refused for ${label}`);
        assert.equal(called, 0, `10(b): no stub is called for ${label}`);
        assert.equal(readFileSync(fx.record, "utf8"), before, `10(b): the record is byte-identical after ${label}`);
      }
    }

    // (c) a verifying record stays verifying and nothing is written at start (passes today)
    {
      const fx = fixture("b10c", { rec: { state: "verifying" } });
      const seen = await verifyObserved(fx, nothing);
      assert.deepEqual(seen.inside, ["verifying"], "10(c): a verifying record reads verifying inside run");
      assert.deepEqual(seen.insideChanges, [[]], "10(c): and no state_changed is written at start");
    }

    // (d) a run aimed at another tree never writes state (passes today)
    {
      const fx = fixture("b10d");
      for (const run of otherTreeRuns(fx)) {
        const inside: string[] = [];
        const exit = await verifyOtherTree(
          fx,
          run,
          stub((o) => {
            inside.push(stateOf(fx));
            return bothPassed(o);
          }),
        );
        assert.equal(exit, 0, `10(d): verify with ${run.label} completes`);
        assert.deepEqual(inside, ["building"], `10(d): ${run.label} leaves a building record building inside run`);
        assert.equal(stateOf(fx), "building", `10(d): and building after (${run.label})`);
        assert.equal(gatesOf(fx)["tests"]?.["status"], "passed", `10(d): the gates are written as today for ${run.label}`);
      }
    }

    // (e) Genuine red
    {
      const fx = fixture("b10e");
      const seen = await verifyObserved(fx, nothing);
      assert.deepEqual(seen.inside, ["verifying"], "10(e): a building record reads verifying inside run");
    }

    // (f)
    {
      const fx = fixture("b10f", { rec: { state: "review" } });
      const seen = await verifyObserved(fx, nothing);
      assert.deepEqual(seen.inside, ["verifying"], "10(f): a review record reads verifying inside run");
    }

    // (g)
    {
      const fx = fixture("b10g");
      const seen = await verifyObserved(fx, nothing);
      assert.deepEqual(seen.insideChanges, [["building->verifying"]], "10(g): exactly one building -> verifying event is written before run returns");
    }

    // (h) compare-and-set at start
    {
      const fx = fixture("b10h");
      let hookCalls = 0;
      const seen = await verifyObserved(fx, nothing, [], {
        afterRead: () => {
          hookCalls++;
          writeFileSync(fx.record, readFileSync(fx.record, "utf8").replace("state: building", "state: halted"));
        },
      } as Partial<RunVerifyOptions>);
      assert.equal(hookCalls, 1, "10(h): the afterRead hook was called exactly once");
      assert.deepEqual(seen.inside, ["halted"], "10(h): the state read inside run is the halted the hook wrote");
      assert.equal(stateOf(fx), "halted", "10(h): and halted after verify");
      assert.deepEqual(changes(fx), [], "10(h): no state_changed was written");
      for (const file of ["main.ts", "ci.ts"]) {
        assert.ok(!/\bafterRead\b/.test(readFileSync(join(HERE, file), "utf8")), `10(h): ${file} never mentions the afterRead seam`);
      }
    }
  });
}

if (runs(11)) {
  test("W-129 behaviour 11: verify ends in review, building or verifying, by this run's evidence", async () => {
    // (a)
    {
      const fx = fixture("b11a");
      const exit = await verify(fx, stub((o) => ({ tests: result(o, "tests", "failed"), lint: result(o, "lint", "failed") })));
      assert.equal(stateOf(fx), "building", "11(a): both gates failed leaves building");
      assert.equal(exit, 1, "11(a): and exits 1");
      assert.deepEqual(changes(fx), ["building->verifying", "verifying->building"], "11(a): the events are building -> verifying then verifying -> building");
      assert.deepEqual(stateRuleFindings(fx), [], "11(k): check finds no state.review.* or state.verifying.* on the failed run");
    }

    // (b)
    {
      const fx = fixture("b11b");
      await verify(fx, stub((o) => ({ tests: result(o, "tests", "failed"), lint: result(o, "lint") })));
      assert.equal(stateOf(fx), "building", "11(b): one failed and one passed leaves building");
    }

    // (c)
    {
      const fx = fixture("b11c");
      const returned: Record<string, GateRunResult> = {};
      const exit = await verify(
        fx,
        stub((o) => {
          Object.assign(returned, bothPassed(o));
          return returned;
        }),
      );
      assert.equal(stateOf(fx), "review", "11(c): both gates passed ends in review");
      assert.equal(exit, 0, "11(c): and exits 0");
      assert.equal(changes(fx).filter((c) => c === "verifying->review").length, 1, "11(c): with exactly one verifying -> review event");
      for (const [id, r] of Object.entries(returned)) {
        const written = gatesOf(fx)[id];
        assert.deepEqual(
          { status: written?.["status"], evidence: written?.["evidence"], certifies: written?.["certifies"] },
          { status: r.status, evidence: r.evidence, certifies: r.certifies },
          `11(c): the written ${id} gate is what the pipeline returned`,
        );
      }
      assert.deepEqual(stateRuleFindings(fx), [], "11(k): check finds no state.review.* on the review run");
    }

    // (d) spec not passed
    {
      const fx = fixture("b11d", { rec: { gates: { spec: "{ sella: architect, status: pending }" } } });
      await verify(fx, stub(bothPassed));
      assert.equal(stateOf(fx), "verifying", "11(d): both passed but spec not passed stays verifying");
    }

    // (e) a gate whose command was removed keeps an old pass but is not in this run's results
    {
      const fx = fixture("b11e", {
        manifest: (doc) =>
          doc.setIn(["probationes"], [
            { id: "tests", name: "Tests", kind: "automated", command: "true" },
            { id: "lint", name: "Lint", kind: "automated" },
            { id: "spec", name: "Spec", kind: "agent" },
            { id: "review", name: "Review", kind: "agent" },
          ]),
      });
      setRecord(fx, { gates: { lint: passedGate(fx, "lint", T0) } });
      await verify(fx, stub((o) => ({ tests: result(o, "tests") })));
      assert.equal(stateOf(fx), "verifying", "11(e): a gate with no command and an old pass is not in this run, so stays verifying");
    }

    // (f) a UI opus never auto-enters review
    {
      const fx = fixture("b11f", { rec: { kind: "ui" } });
      await verify(fx, stub((o) => ({ ...bothPassed(o), "served-e2e": result(o, "served-e2e") })));
      assert.equal(stateOf(fx), "verifying", "11(f): a kind ui opus stays verifying after a green verify");
    }

    // (g) dirty certificates and a foreign tree hash
    {
      const fx = fixture("b11g-dirty");
      writeFileSync(join(fx.dir, "src.txt"), "uncommitted\n");
      const exit = await verify(fx, stub(bothPassed), ["--allow-dirty"]);
      assert.equal(exit, 0, "11(g): an --allow-dirty run completes");
      assert.equal(stateOf(fx), "review", "11(g): an --allow-dirty run certifying dirty:<hash> reaches review");
      assert.deepEqual(stateRuleFindings(fx), [], "11(k): check finds no state.review.* after the dirty run");
      const foreign = fixture("b11g-foreign");
      await verify(foreign, stub((o) => ({ tests: result(o, "tests", "passed", `tree:${T0}`), lint: result(o, "lint", "passed", `tree:${T0}`) })));
      assert.equal(stateOf(foreign), "verifying", "11(g): certificates for a tree other than the one this run computed stay verifying");
    }

    // (h) the failed review gate
    {
      const reviewFailed = (evidence: string): RecOpts => ({
        gates: { review: `{ sella: qa-lead, status: failed, evidence: ${evidence}, at: 2026-09-19T12:30:00Z }` },
      });
      const same = fixture("b11h-same");
      setRecord(same, reviewFailed(verdictLog(same, "W-120-review-1.log", { tree: [`tree:${treeOf(same)}`] })));
      await verify(same, stub(bothPassed));
      assert.equal(stateOf(same), "verifying", "11(h): a failed review naming the tree this run certifies stays verifying");
      assert.deepEqual(stateRuleFindings(same), [], "11(k): check finds no state.* block with the failed review current");

      const older = fixture("b11h-older");
      setRecord(older, reviewFailed(verdictLog(older, "W-120-review-1.log", { tree: [`tree:${H1}`] })));
      await verify(older, stub(bothPassed));
      assert.equal(stateOf(older), "review", "11(h): a failed review of an older tree reaches review");
      assert.deepEqual(stateRuleFindings(older), [], "11(k): check finds no state.review.* for the older failed review");

      const failClosed: [string, (fx: Fx) => string, ((o: PipelineRunOpts) => Record<string, GateRunResult>)?][] = [
        ["the log missing", () => "ci/W-120-review-9.log"],
        ["no tree header", (fx) => verdictLog(fx, "W-120-review-1.log", { tree: null })],
        ["a tree header that is not 40-hex", (fx) => verdictLog(fx, "W-120-review-1.log", { tree: ["tree:abc"] })],
        ["a duplicated tree header", (fx) => verdictLog(fx, "W-120-review-1.log", { tree: [`tree:${H1}`, `tree:${H2}`] })],
        ["an opus header naming another opus", (fx) => verdictLog(fx, "W-120-review-1.log", { opus: "W-999", tree: [`tree:${H1}`] })],
        [
          "an automated gate lacking certifies",
          (fx) => verdictLog(fx, "W-120-review-1.log", { tree: [`tree:${H1}`] }),
          (o) => ({ tests: result(o, "tests"), lint: result(o, "lint", "passed", "") }),
        ],
      ];
      for (const [label, make, fn] of failClosed) {
        const fx = fixture("b11h-closed");
        setRecord(fx, reviewFailed(make(fx)));
        await verify(fx, stub(fn ?? bothPassed));
        assert.equal(stateOf(fx), "verifying", `11(h): ${label} fails closed and stays verifying`);
      }
    }

    // (i) compare-and-set at the end
    for (const moved of ["halted", "done"]) {
      const fx = fixture(`b11i-${moved}`);
      await verify(
        fx,
        stub((o) => {
          writeFileSync(fx.record, readFileSync(fx.record, "utf8").replace("state: verifying", `state: ${moved}`));
          return bothPassed(o);
        }),
      );
      assert.equal(stateOf(fx), moved, `11(i): a record moved to ${moved} while the stub ran stays ${moved}`);
      assert.equal(gatesOf(fx)["tests"]?.["status"], "passed", `11(i): and the gate results are still written (${moved})`);
      assert.deepEqual(changes(fx), ["building->verifying"], `11(i): and no end state_changed exists (${moved})`);
    }

    // (j) a run aimed at another tree writes gates, never state
    {
      const fx = fixture("b11j");
      for (const run of otherTreeRuns(fx)) {
        const exit = await verifyOtherTree(fx, run, stub(bothPassed));
        assert.equal(exit, 0, `11(j): verify with ${run.label} completes`);
        assert.equal(gatesOf(fx)["tests"]?.["status"], "passed", `11(j): ${run.label} writes the gates`);
        assert.equal(stateOf(fx), "building", `11(j): ${run.label} leaves the state untouched`);
        assert.deepEqual(changes(fx), [], `11(j): ${run.label} writes no events`);
      }
    }

    // (l), (m) the end rule reads the merged post-write record
    for (const [label, logTree, want] of [
      ["l", "T1", "verifying"],
      ["m", "T0", "review"],
    ] as const) {
      const fx = fixture(`b11${label}`);
      const t1 = treeOf(fx);
      const named = logTree === "T1" ? t1 : T0;
      setRecord(fx, {
        gates: {
          tests: passedGate(fx, "tests", T0),
          lint: passedGate(fx, "lint", T0),
          review: `{ sella: qa-lead, status: failed, evidence: ${verdictLog(fx, "W-120-review-1.log", { tree: [`tree:${named}`] })}, at: 2026-09-19T12:30:00Z }`,
        },
      });
      await verify(fx, stub(bothPassed));
      assert.equal(stateOf(fx), want, `11(${label}): the log names ${logTree} and the stub certifies T1: ${want}`);
      assert.deepEqual(stateRuleFindings(fx), [], `11(${label}): check finds no state.review.* block on the final record`);
    }
  });
}

if (runs(12)) {
  test("W-129 behaviour 12: review --fail reopens a verifying opus and says so; --pass moves nothing", async () => {
    const review = async (fx: Fx, flag: "--pass" | "--fail", evidence: string): Promise<number> =>
      (await quiet(() => runReview(["W-120", flag, "--evidence", evidence, "--sella", "qa-lead", "--studio", fx.studio], { now: NOW }))).result.exitCode;
    const reviewed = (state: string, extra: string[] = []): { fx: Fx; evidence: string } => {
      const fx = fixture(`b12-${state}`, { rec: { state, extra } });
      return { fx, evidence: verdictLog(fx, "W-120-review-1.log") };
    };

    // (a) passes today
    for (const state of ["review", "done"]) {
      const { fx, evidence } = reviewed(state, state === "done" ? ["end: 2026-09-19T12:45:00Z"] : []);
      assert.equal(await review(fx, "--fail", evidence), 0, `12(a): review --fail on ${state} succeeds`);
      assert.equal(stateOf(fx), "building", `12(a): ${state} + --fail reopens to building`);
      assert.ok(!("end" in readFront<Record<string, unknown>>(fx.record).data), `12(a): end is absent after reopening from ${state}`);
    }

    // (b) passes today
    {
      const { fx, evidence } = reviewed("building");
      await review(fx, "--fail", evidence);
      assert.equal(stateOf(fx), "building", "12(b): building + --fail stays building");
      assert.deepEqual(changes(fx), [], "12(b): and emits no state_changed");
    }

    // (c) passes today
    for (const state of ["building", "verifying", "review"]) {
      const { fx, evidence } = reviewed(state);
      assert.equal(await review(fx, "--pass", evidence), 0, `12(c): review --pass on ${state} succeeds`);
      assert.equal(stateOf(fx), state, `12(c): --pass leaves ${state} unchanged`);
      assert.equal(gatesOf(fx)["review"]?.["status"], "passed", `12(c): --pass on ${state} records passed`);
      assert.deepEqual(changes(fx), [], `12(c): --pass on ${state} emits no state_changed`);
    }

    // (d) passes today
    {
      const { fx } = reviewed("review");
      const before = readFileSync(fx.record, "utf8");
      assert.equal(await review(fx, "--fail", "../../../etc/hostname"), 2, "12(d): an unsafe evidence path is refused");
      assert.equal(readFileSync(fx.record, "utf8"), before, "12(d): the refused --fail leaves the record unchanged");
      assert.deepEqual(readEvents(fx), [], "12(d): and emits nothing");
    }

    // (e) Genuine red
    {
      const { fx, evidence } = reviewed("verifying");
      assert.equal(await review(fx, "--fail", evidence), 0, "12(e): review --fail on a verifying opus succeeds");
      assert.equal(stateOf(fx), "building", "12(e): verifying + --fail -> building");
      assert.equal(gatesOf(fx)["review"]?.["status"], "failed", "12(e): the review gate is failed");
      assert.equal(gatesOf(fx)["review"]?.["evidence"], evidence, "12(e): and the evidence is recorded");
    }

    // (f)
    for (const from of ["verifying", "review", "done"]) {
      const { fx, evidence } = reviewed(from, from === "done" ? ["end: 2026-09-19T12:45:00Z"] : []);
      await review(fx, "--fail", evidence);
      const moved = readEvents(fx).filter((e) => e.name === "workflow.state_changed");
      assert.equal(moved.length, 1, `12(f): ${from} -> building emits exactly one state_changed`);
      assert.equal(moved[0]?.attrs[WF.STATE_FROM], from, `12(f): from is ${from}`);
      assert.equal(moved[0]?.attrs[WF.STATE_TO], "building", `12(f): to is building (${from})`);
      assert.equal(moved[0]?.attrs[WF.ACTOR_ROLE], "qa-lead", `12(f): the actor is the review sella (${from})`);
      assert.equal(readEvents(fx).filter((e) => e.name === "workflow.gate_evaluated").length, 1, `12(f): beside its gate_evaluated (${from})`);
    }
  });
}

if (runs(13)) {
  test("W-129 behaviour 13: a failed review blocks review only while it is provably of the certified tree", () => {
    const FAILED = (evidence: string): string => `{ sella: qa-lead, status: failed, evidence: ${evidence}, at: 2026-09-19T12:30:00Z }`;
    const blocks = (fx: Fx): number => checkStudio(fx.studio, NOW, { repo: fx.dir }).findings.filter((f) => f.rule === "state.review.failed" && f.level === "block").length;
    /** A review-state record whose automated gates certify tree:H2 and whose review gate is failed on `evidence`. */
    const reviewRecord = (fx: Fx, evidence: string, id = "review"): void =>
      setRecord(fx, {
        state: "review",
        gates: { tests: passedGate(fx, "tests", H2), lint: passedGate(fx, "lint", H2), [id]: FAILED(evidence) },
      });
    const fx = fixture("b13");

    // (a)-(l) pass today: the block stays wherever the failure is not provably of an older tree
    reviewRecord(fx, verdictLog(fx, "W-120-review-1.log", { tree: [`tree:${H2}`] }));
    assert.equal(blocks(fx), 1, "13(a): a failed review naming H2 blocks");
    reviewRecord(fx, "ci/W-120-review-9.log");
    assert.equal(blocks(fx), 1, "13(b): a failed review with its evidence file missing blocks");
    setRecord(fx, {
      state: "review",
      gates: { tests: `{ status: passed, evidence: ${evidenceLog(fx, "W-120-tests-x.log")} }`, lint: passedGate(fx, "lint", H2), review: FAILED(verdictLog(fx, "W-120-review-1.log", { tree: [`tree:${H1}`] })) },
    });
    assert.equal(blocks(fx), 1, "13(c): the log naming H1 with an automated gate lacking certifies blocks");
    setRecord(fx, {
      state: "review",
      gates: { tests: passedGate(fx, "tests", H2).replace("tree:", "dirty:"), lint: passedGate(fx, "lint", H2).replace("tree:", "dirty:"), review: FAILED(verdictLog(fx, "W-120-review-1.log", { tree: [`tree:${H1}`] })) },
    });
    assert.equal(blocks(fx), 1, "13(d): the log naming H1 with dirty certificates blocks");
    reviewRecord(fx, verdictLog(fx, "W-120-review-1.log", { tree: null }));
    assert.equal(blocks(fx), 1, "13(e): a log with no tree header blocks");
    writeFileSync(join(fx.studio, "ci", "W-120-unrelated.log"), `# tree: tree:${H1}\nan unrelated log\n`);
    reviewRecord(fx, "ci/W-120-unrelated.log");
    assert.equal(blocks(fx), 1, "13(e): a failed review pointing at an unrelated readable log blocks");
    setRecord(fx, {
      state: "review",
      gates: { tests: passedGate(fx, "tests", H2), lint: passedGate(fx, "lint", H2), review: "{ sella: qa-lead, status: passed, evidence: ci/W-120-review-1.log, at: 2026-09-19T12:30:00Z }" },
    });
    assert.equal(blocks(fx), 0, "13(f): a passed review gate gives no state.review.failed finding");

    // (g)
    setRecord(fx, { state: "review", gates: { tests: passedGate(fx, "tests", H2), lint: "{ status: pending }", spec: "{ status: pending }" } });
    const g = checkStudio(fx.studio, NOW, { repo: fx.dir }).findings.map((f) => `${f.level} ${f.rule}`);
    assert.ok(g.includes("block state.review.automated"), "13(g): an unpassed automated gate still blocks state.review.automated");
    assert.ok(g.includes("block state.review.agent"), "13(g): an unpassed agent gate still blocks state.review.agent");

    // (h) the predicate keys on the manifest's review gate
    {
      const censor = fixture("b13h", {
        manifest: (doc) => {
          doc.setIn(["review_probatio"], "censor");
          doc.setIn(["probationes"], [...TESTS_LINT_SPEC_REVIEW, { id: "censor", name: "Censor", kind: "agent" }]);
        },
      });
      reviewRecord(censor, verdictLog(censor, "W-120-review-1.log", { tree: [`tree:${H2}`] }), "censor");
      assert.equal(blocks(censor), 1, "13(h): a failed censor gate naming H2 blocks when review_probatio is censor");
    }

    // (i) no automated gate for the kind: an empty automatedIds proves nothing
    {
      const bare = fixture("b13i", {
        manifest: (doc) =>
          doc.setIn(["probationes"], [
            { id: "spec", name: "Spec", kind: "agent" },
            { id: "review", name: "Review", kind: "agent" },
          ]),
      });
      setRecord(bare, { state: "review", gates: { review: FAILED(verdictLog(bare, "W-120-review-1.log", { tree: [`tree:${H1}`] })) } });
      assert.equal(blocks(bare), 1, "13(i): with no automated gate the older-tree proof is unavailable and the block stands");
    }

    // (j) a tree header that proves nothing
    for (const bad of ["tree:", "tree:x", `tree:${"A".repeat(40)}`, `tree:${"1".repeat(64)}`]) {
      reviewRecord(fx, verdictLog(fx, "W-120-review-1.log", { tree: [bad] }));
      assert.equal(blocks(fx), 1, `13(j): a tree header of "${bad.slice(0, 12)}" blocks`);
    }

    // (k) two tree lines
    for (const pair of [
      [`tree:${H1}`, `tree:${H2}`],
      [`tree:${H2}`, `tree:${H1}`],
    ]) {
      reviewRecord(fx, verdictLog(fx, "W-120-review-1.log", { tree: pair }));
      assert.equal(blocks(fx), 1, `13(k): a log with two tree lines (${pair.map((p) => p.slice(5, 7)).join(", ")}) blocks`);
    }

    // (l)
    reviewRecord(fx, verdictLog(fx, "W-120-review-1.log", { opus: "W-999", tree: [`tree:${H1}`] }));
    assert.equal(blocks(fx), 1, "13(l): a log naming H1 whose opus header names another opus blocks");
    reviewRecord(fx, verdictLog(fx, "W-120-review-1.log", { opus: null, tree: [`tree:${H1}`] }));
    assert.equal(blocks(fx), 1, "13(l): a log naming H1 with no opus line blocks");

    // (m) Genuine red
    reviewRecord(fx, verdictLog(fx, "W-120-review-1.log", { tree: [`tree:${H1}`] }));
    assert.equal(blocks(fx), 0, "13(m): a failed review of an older tree gives no state.review.failed block");
    {
      const censor = fixture("b13m", {
        manifest: (doc) => {
          doc.setIn(["review_probatio"], "censor");
          doc.setIn(["probationes"], [...TESTS_LINT_SPEC_REVIEW, { id: "censor", name: "Censor", kind: "agent" }]);
        },
      });
      reviewRecord(censor, verdictLog(censor, "W-120-review-1.log", { tree: [`tree:${H1}`] }), "censor");
      assert.equal(blocks(censor), 0, "13(m): the same holds with censor as the review gate");
    }

    // (n) the ladder's loose parser would read past a line the strict header stopped at: not a proof of an older tree
    {
      const loose = fixture("b13n");
      writeFileSync(
        join(loose.studio, "ci", "W-120-review-1.log"),
        ["# opus: W-120", "# phase: build", "# round: 1", `# tree: tree:${H1}`, "#  x: y", `# tree: tree:${H2}`, "", "findings", ""].join("\n"),
      );
      reviewRecord(loose, "ci/W-120-review-1.log");
      assert.equal(blocks(loose), 1, "13(n): an older-tree header followed by a loose header line and a later tree line blocks");
    }

    // (o) a record with no string id and a log with no opus header must not count as a proven older tree
    {
      const anon = fixture("b13o");
      writeFileSync(join(anon.studio, "ci", "W-120-review-1.log"), ["# phase: build", "# round: 1", `# tree: tree:${H1}`, "", "findings", ""].join("\n"));
      reviewRecord(anon, "ci/W-120-review-1.log");
      writeFileSync(anon.record, readFileSync(anon.record, "utf8").replace("id: W-120\n", ""));
      assert.equal(blocks(anon), 1, "13(o): a record with no id and a log with no opus line blocks");
    }
  });
}

if (runs(14)) {
  test("W-129 behaviour 14: the handoff's stage may trail the state, never lead it", () => {
    const fx = fixture("b14");
    const finding = (rule: string): { level: string }[] => checkStudio(fx.studio, NOW, { repo: fx.dir }).findings.filter((f) => f.rule === rule);
    const stageAdvisory = (state: string, stage: string): boolean => {
      setRecord(fx, { state, stage });
      return finding("traditio.stage").length > 0;
    };

    // (a)-(e) pass today
    assert.ok(stageAdvisory("done", "building"), "14(a): done with stage building advises");
    assert.ok(stageAdvisory("building", "done"), "14(b): building with stage done advises");
    assert.ok(stageAdvisory("building", "bogus"), "14(b): building with stage bogus advises");
    assert.ok(!stageAdvisory("building", "building"), "14(c): building with stage building does not advise");
    assert.ok(stageAdvisory("building", "review"), "14(d): building with stage review advises");
    assert.ok(stageAdvisory("building", "verifying"), "14(d): building with stage verifying advises");
    assert.ok(stageAdvisory("verifying", "review"), "14(e): verifying with stage review advises");

    // (f) the other traditio rules, unchanged for the three active states
    for (const state of ["building", "verifying", "review"]) {
      setRecord(fx, { state, traditio: "{ sella: builder, stage: building, blocked_on: none, at: 2026-09-19T12:00:00Z }" });
      assert.ok(finding("traditio.keys").some((f) => f.level === "block"), `14(f): a handoff missing next blocks traditio.keys in ${state}`);
      setRecord(fx, { state, traditio: "{ sella: ghost, stage: building, next: go, blocked_on: none, at: 2026-09-19T12:00:00Z }" });
      assert.ok(finding("traditio.sella").some((f) => f.level === "block"), `14(f): an undeclared handoff sella blocks traditio.sella in ${state}`);
      setRecord(fx, { state, traditio: null });
      assert.ok(finding("traditio.present").some((f) => f.level === "block"), `14(f): no handoff blocks traditio.present in ${state}`);
      setRecord(fx, { state, traditio: "{ sella: builder, stage: building, next: go, blocked_on: none, at: 2026-09-01T00:00:00Z }" });
      assert.ok(finding("traditio.stale").some((f) => f.level === "advise"), `14(f): an old handoff advises traditio.stale in ${state}`);
    }

    // (g) Genuine red
    assert.ok(!stageAdvisory("verifying", "building"), "14(g): verifying with stage building does not advise");
    assert.ok(!stageAdvisory("review", "building"), "14(g): review with stage building does not advise");
    assert.ok(!stageAdvisory("review", "verifying"), "14(g): review with stage verifying does not advise");
  });
}

if (runs(15)) {
  test("W-129 behaviour 15: the whole cycle on one branch, with check clean at every step", () => {
    const ENV: NodeJS.ProcessEnv = { ...process.env, TZ: "UTC" };
    delete ENV["BISELLIUM_SELLA"];
    delete ENV["BISELLIUM_ROLE"];
    // The transcript lives outside the repo's working tree: a file inside it makes the tree dirty and every
    // verdict and verify certificate would read dirty:, not tree:.
    const outside = scratch("b15-transcript");
    const cli = (fx: Fx, args: string[]): number => {
      const r = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...args, "--studio", fx.studio], { cwd: REPO, encoding: "utf8", timeout: 180_000, env: ENV });
      if (r.error) throw r.error;
      appendFileSync(join(outside, "transcript.log"), `$ ${args.join(" ")}\n${r.stdout}${r.stderr}\n`);
      return r.status ?? -1;
    };
    const verify15 = (fx: Fx): number => cli(fx, ["verify", "W-120", "--repo", fx.dir]);
    const verdict = (fx: Fx, round: number, outcome: string): string => {
      const findings = join(outside, `findings-${round}.md`);
      writeFileSync(findings, `## Findings\nNo findings\nRound ${round}.\n`);
      assert.equal(cli(fx, ["verdict", "W-120", "--round", String(round), "--sella", "qa-lead", "--outcome", outcome, "--from", findings]), 0, `15: verdict round ${round} writes the evidence log`);
      return `ci/W-120-review-${round}.log`;
    };
    const check = (fx: Fx, label: string, stageFinding: boolean): void => {
      const found = checkStudio(fx.studio, NOW, { repo: fx.dir }).findings;
      assert.deepEqual(
        found.filter((f) => f.level === "block").map((f) => f.rule),
        [],
        `15: check has no block after ${label}`,
      );
      if (!stageFinding) assert.deepEqual(found.filter((f) => f.rule === "traditio.stage"), [], `15: and no traditio.stage finding after ${label}`);
    };
    const headFixture = (tag: string, lintCommand: string): Fx =>
      fixture(tag, {
        manifest: (doc) =>
          doc.setIn(["probationes"], [
            { id: "tests", name: "Tests", kind: "automated", command: "true" },
            { id: "lint", name: "Lint", kind: "automated", command: lintCommand },
            { id: "spec", name: "Spec", kind: "agent" },
            { id: "review", name: "Review", kind: "agent" },
          ]),
      });

    const fx = headFixture("b15", "true");
    // (a) Genuine red
    assert.equal(verify15(fx), 0, "15(a): verify exits 0");
    assert.equal(stateOf(fx), "review", "15(a): verify leaves the opus in review");
    check(fx, "verify (a)", false);

    // (b)
    const failedLog = verdict(fx, 1, "failed");
    const t1 = readFileSync(join(fx.studio, failedLog), "utf8").match(/^# tree: (.*)$/m)?.[1];
    assert.match(t1 ?? "", /^tree:[0-9a-f]{40}$/, "15: the review evidence log carries a tree: identity, not dirty:");
    assert.equal(cli(fx, ["review", "W-120", "--fail", "--evidence", failedLog, "--sella", "qa-lead"]), 0, "15(b): review --fail exits 0");
    assert.equal(stateOf(fx), "building", "15(b): review --fail returns the opus to building");
    check(fx, "review --fail (b)", false);

    // (c) a source commit that changes the tree, then verify
    writeFileSync(join(fx.dir, "src.txt"), "x\ny\nz\n");
    git(fx.dir, ["add", "-A"]);
    git(fx.dir, ["commit", "-q", "-m", "change the source"]);
    assert.equal(verify15(fx), 0, "15(c): the second verify exits 0");
    assert.equal(stateOf(fx), "review", "15(c): the second verify reaches review");
    assert.equal(gatesOf(fx)["review"]?.["status"], "failed", "15(c): with the failed review gate still recorded");
    assert.equal(readFileSync(join(fx.studio, String(gatesOf(fx)["review"]?.["evidence"])), "utf8").match(/^# tree: (.*)$/m)?.[1], t1, "15(c): its evidence log names the tree verified in (a)");
    assert.notEqual(gatesOf(fx)["tests"]?.["certifies"], t1, "15(c): and the automated gates now certify a different tree");
    check(fx, "the second verify (c)", false);

    // (d)
    const passedLog = verdict(fx, 2, "passed");
    assert.equal(cli(fx, ["review", "W-120", "--pass", "--evidence", passedLog, "--sella", "qa-lead"]), 0, "15(d): review --pass exits 0");
    assert.equal(stateOf(fx), "review", "15(d): review --pass leaves the state review");
    assert.equal(gatesOf(fx)["review"]?.["status"], "passed", "15(d): and records the gate passed");
    check(fx, "review --pass (d)", false);

    // (e)
    assert.equal(cli(fx, ["done", "W-120"]), 0, "15(e): done exits 0");
    assert.equal(stateOf(fx), "done", "15(e): done closes the opus");
    check(fx, "done (e)", true);
    const traditio = checkStudio(fx.studio, NOW, { repo: fx.dir }).findings.filter((f) => f.rule.startsWith("traditio."));
    assert.deepEqual(traditio.map((f) => f.rule), ["traditio.stage"], "15(e): traditio.stage is the only traditio.* finding for the done record");

    // (f)
    assert.deepEqual(
      changes(fx),
      ["building->verifying", "verifying->review", "review->building", "building->verifying", "verifying->review", "review->done"],
      "15(f): the events log holds the six transitions, in order, each exactly once",
    );

    // (g) the same cycle with the first verify made to fail
    const failing = headFixture("b15g", "false");
    assert.equal(verify15(failing), 1, "15(g): the first verify fails");
    assert.equal(stateOf(failing), "building", "15(g): a failed verify ends building");
    const manifestPath = join(failing.studio, "bisellium.yml");
    const manifestDoc = parseDocument(readFileSync(manifestPath, "utf8"));
    manifestDoc.setIn(["probationes", 1, "command"], "true");
    writeFileSync(manifestPath, manifestDoc.toString({ lineWidth: 0 }));
    assert.equal(verify15(failing), 0, "15(g): a second, passing verify exits 0");
    assert.equal(stateOf(failing), "review", "15(g): the passing verify reaches review");
  });
}
