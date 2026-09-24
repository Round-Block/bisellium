/**
 * packages/commands/src/probe.test.ts — W-069 behaviours 1-13: the model
 * probe battery. Repo path at argv[2], behaviour at argv[3] (the
 * delegate.test.ts convention).
 *
 * No live vendor turn, and no dependence on an installed vendor binary, in
 * any behaviour except 8(b) — which drives the real `codexListModels`
 * against a STUB binary written to a temp PATH, never the real `codex`.
 * Every other behaviour drives a stub profile registry through `harnesses`,
 * and stub listing/version functions through `listModels`/`versions`, in
 * the harness-env.test.ts manner: the stub records its own arguments and
 * returns a canned Turn.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HarnessProfile, HarnessResumeOpts, HarnessStartOpts, Turn } from "@bisellium/shim";
import { codexListModels } from "@bisellium/shim";
import { Store } from "@bisellium/server";
import { vendorDiagnostic } from "./talk.js";
import { runDelegate } from "./delegate.js";
import { gatherCandidates, probeBattery, readModelsRecord, runProbe, type Candidate, type ModelsRecord } from "./probe.js";

const repo = resolve(process.argv[2] ?? ".");
const fixturesDir = resolve(repo, "packages", "commands", "test", "fixtures");
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;

let failed = 0;
function check(behaviour: number, name: string, ok: boolean, detail = ""): void {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  b${behaviour} ${name.padEnd(90)} ${detail}`);
  if (!ok) failed++;
}
/** Gates a whole behaviour's setup code (not just its `check()` calls) on
 *  `--behaviour N` selection — some later behaviour's setup can throw (8(b)
 *  drives a real, still-unimplemented function against a stub binary), and
 *  an uncaught throw there must never abort an earlier behaviour's own
 *  single-behaviour red. */
function runs(behaviour: number): boolean {
  return only === undefined || only === behaviour;
}

const dirs: string[] = [];
function freshDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `w069-probe-${tag}-`));
  dirs.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

/** A minimal parseable manifest — `readManifest`'s only real requirement is
 *  shape, not a full studio (probe never touches opera/petitiones/). */
function writeManifest(dir: string, body: string): void {
  writeFileSync(
    join(dir, "bisellium.yml"),
    `bisellium: 1\nstudio: Probe Fixture\npatron: patron\ncollegia: [ { id: engineering, name: Engineering, magister: eng-lead } ]\n${body}\n`,
  );
}

function readRaw(dir: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Stub harness registry — records every start/resume/available call; the
// turn returned for a `start` call is computed from a per-model-id map the
// test controls, so different candidates on the same harness can behave
// differently.
// ---------------------------------------------------------------------------
interface Calls {
  start: HarnessStartOpts[];
  resume: HarnessResumeOpts[];
  available: number;
}

function makeStub(
  id: string,
  opts: {
    turnFor?: (model: string | undefined) => Turn | Promise<Turn>;
    availableFn?: () => boolean | Promise<boolean>;
  } = {},
): { profile: HarnessProfile; calls: Calls } {
  const calls: Calls = { start: [], resume: [], available: 0 };
  const profile: HarnessProfile = {
    id,
    tier: 1,
    async available() {
      calls.available++;
      return opts.availableFn ? await opts.availableFn() : true;
    },
    async start(startOpts) {
      calls.start.push(startOpts);
      return opts.turnFor ? await opts.turnFor(startOpts.model) : { sessionId: "s", reply: "OK", exitCode: 0 };
    },
    async resume(resumeOpts) {
      calls.resume.push(resumeOpts);
      throw new Error("probe must never call resume");
    },
  };
  return { profile, calls };
}

const okTurn = (reply = "OK"): Turn => ({ sessionId: "s", reply, exitCode: 0 });
const emptyTurn = (): Turn => ({ sessionId: "s", reply: "  ", exitCode: 0 });
const failTurn = (exit: number, raw?: unknown): Turn => ({ sessionId: "s", reply: "", exitCode: exit, raw });
const limitTurn = (): Turn => ({ sessionId: "", reply: "", exitCode: 3 });
const shortCircuitTurn = (status: number): Turn => ({ sessionId: "", reply: "", exitCode: 1, raw: { is_error: true, api_error_status: status, stderr: `blocked ${status}` } });

const NOW = new Date("2026-09-25T12:00:00Z");
const later = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

// ===========================================================================
// Behaviour 1: one minimal `start` turn per pair; never `resume`; never the
// bundle.
// ===========================================================================
if (runs(1)) {
  const dir = freshDir("b1");
  writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: solo-model } ]\nprobationes: []");
  const { profile, calls } = makeStub("claude-code", { turnFor: () => okTurn("OK") });

  const result = await probeBattery({
    studio: dir,
    now: NOW,
    only: [{ id: "solo-model", harness: "claude-code" }],
    harnesses: { "claude-code": profile },
    listModels: async () => [], versions: async () => ({}),
  });

  check(1, "exactly one start call", calls.start.length === 1, String(calls.start.length));
  check(1, "zero resume calls", calls.resume.length === 0, String(calls.resume.length));
  const call = calls.start[0];
  check(1, "systemPrompt is exactly \"\"", call?.systemPrompt === "", JSON.stringify(call?.systemPrompt));
  check(1, "message is the probe message (positive control)", call?.message === "Reply OK and stop", JSON.stringify(call?.message));
  check(1, "model equals the pair's id", call?.model === "solo-model", String(call?.model));
  check(1, "one turn spent", result.turns === 1, String(result.turns));
}

// ===========================================================================
// Behaviour 2: the verdict comes from the Turn alone.
// ===========================================================================
if (runs(2)) {
  const dir = freshDir("b2");
  writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: m-avail } ]\nprobationes: []");

  // exit 0, non-empty reply -> available
  {
    const { profile } = makeStub("claude-code", { turnFor: () => okTurn("Hi") });
    const r = await probeBattery({ studio: dir, now: NOW, only: [{ id: "m-avail", harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
    const entry = r.record.models.find((m) => m.id === "m-avail");
    check(2, "exit0+nonempty -> available", entry?.state === "available", JSON.stringify(entry));
    check(2, "exit0+nonempty: probe.exit === 0", entry?.probes[0]?.exit === 0, JSON.stringify(entry));
    check(2, "exit0+nonempty: probe.reply === true", entry?.probes[0]?.reply === true, JSON.stringify(entry));
  }
  // exit 0, empty/whitespace reply -> unavailable, reply:false
  {
    const dir2 = freshDir("b2-empty");
    writeManifest(dir2, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: m-empty } ]\nprobationes: []");
    const { profile } = makeStub("claude-code", { turnFor: () => emptyTurn() });
    const r = await probeBattery({ studio: dir2, now: NOW, only: [{ id: "m-empty", harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
    const entry = r.record.models.find((m) => m.id === "m-empty");
    check(2, "exit0+empty -> unavailable", entry?.state === "unavailable", JSON.stringify(entry));
    check(2, "exit0+empty: reply === false", entry?.probes[0]?.reply === false, JSON.stringify(entry));
  }
  // non-zero exit -> unavailable, exit equal to vendor code, vendorDiagnostic
  // equal to talk.ts's own extractor's output (over its four raw shapes).
  {
    const rawShapes: unknown[] = [
      { stdout: "", stderr: "boom" },
      { is_error: true, result: "bad model" },
      { error: "spawn failed" },
      { error: { message: "spawn object failed" } },
    ];
    for (const [i, raw] of rawShapes.entries()) {
      const dir2 = freshDir(`b2-fail-${i}`);
      const id = `m-fail-${i}`;
      writeManifest(dir2, `sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: ${id} } ]\nprobationes: []`);
      const { profile } = makeStub("claude-code", { turnFor: () => failTurn(7, raw) });
      const r = await probeBattery({ studio: dir2, now: NOW, only: [{ id, harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
      const entry = r.record.models.find((m) => m.id === id);
      check(2, `raw shape ${i}: nonzero exit -> unavailable`, entry?.state === "unavailable", JSON.stringify(entry));
      check(2, `raw shape ${i}: exit equals vendor's own code`, entry?.probes[0]?.exit === 7, String(entry?.probes[0]?.exit));
      check(2, `raw shape ${i}: vendorDiagnostic equals talk.ts's own extractor`, entry?.probes[0]?.vendorDiagnostic === vendorDiagnostic(raw), JSON.stringify({ got: entry?.probes[0]?.vendorDiagnostic, want: vendorDiagnostic(raw) }));
    }
  }
  // harness available() false -> unverified, note "harness unavailable", no turn
  {
    const dir2 = freshDir("b2-unavail");
    writeManifest(dir2, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: m-unavail } ]\nprobationes: []");
    const { profile, calls } = makeStub("claude-code", { availableFn: () => false });
    const r = await probeBattery({ studio: dir2, now: NOW, only: [{ id: "m-unavail", harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
    const entry = r.record.models.find((m) => m.id === "m-unavail");
    check(2, "harness unavailable -> unverified", entry?.state === "unverified", JSON.stringify(entry));
    check(2, "harness unavailable -> note", entry?.probes[0]?.note === "harness unavailable", JSON.stringify(entry));
    check(2, "harness unavailable -> zero start calls", calls.start.length === 0, String(calls.start.length));
  }
}

// ===========================================================================
// Behaviour 3: a harness cannot condemn without a passing control.
// ===========================================================================
if (runs(3)) {
  // (a) control fails -> every candidate on that harness unverified, note
  //     naming the control, zero further start calls, control's own
  //     diagnostic retained.
  {
    const dir = freshDir("b3a");
    writeManifest(
      dir,
      "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl } ]\nprobationes: []",
    );
    const { profile, calls } = makeStub("claude-code", {
      turnFor: (model) => (model === "aaa-ctrl" ? failTurn(1, { stdout: "", stderr: "control is broken" }) : okTurn("should never run")),
    });
    const r = await probeBattery({
      studio: dir,
      now: NOW,
      only: [{ id: "aaa-ctrl", harness: "claude-code" }, { id: "zzz-other", harness: "claude-code" }],
      harnesses: { "claude-code": profile },
      listModels: async () => [], versions: async () => ({}),
    });
    check(3, "(a) exactly one start call (the control)", calls.start.length === 1, String(calls.start.length));
    const ctrl = r.record.models.find((m) => m.id === "aaa-ctrl");
    const other = r.record.models.find((m) => m.id === "zzz-other");
    check(3, "(a) the control's own row keeps its own honest (unavailable) verdict — only OTHER candidates are condemned", ctrl?.state === "unavailable", JSON.stringify(ctrl));
    check(3, "(a) control's own diagnostic retained", ctrl?.probes[0]?.vendorDiagnostic === "control is broken", JSON.stringify(ctrl));
    check(3, "(a) other candidate unverified, zero turns", other?.state === "unverified" && other?.probes[0]?.exit === undefined, JSON.stringify(other));
    check(3, "(a) note names the control/harness", (other?.probes[0]?.note ?? "").includes("claude-code"), JSON.stringify(other));
  }
  // (b) control passes, a later model fails -> that model alone unavailable
  {
    const dir = freshDir("b3b");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl } ]\nprobationes: []");
    const { profile } = makeStub("claude-code", {
      turnFor: (model) => (model === "aaa-ctrl" ? okTurn("OK") : failTurn(9, { stdout: "", stderr: "later model broke" })),
    });
    const r = await probeBattery({
      studio: dir,
      now: NOW,
      only: [{ id: "aaa-ctrl", harness: "claude-code" }, { id: "zzz-later", harness: "claude-code" }],
      harnesses: { "claude-code": profile },
      listModels: async () => [], versions: async () => ({}),
    });
    const ctrl = r.record.models.find((m) => m.id === "aaa-ctrl");
    const later0 = r.record.models.find((m) => m.id === "zzz-later");
    check(3, "(b) control passes -> available", ctrl?.state === "available", JSON.stringify(ctrl));
    check(3, "(b) later model alone unavailable", later0?.state === "unavailable" && later0?.probes[0]?.exit === 9, JSON.stringify(later0));
  }
  // (c) harness with no seated candidate -> every row unverified, note "no
  //     control", zero turns.
  {
    const dir = freshDir("b3c");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: something-else } ]\nprobationes: []");
    const { profile, calls } = makeStub("codex", { turnFor: () => okTurn("should never run") });
    const r = await probeBattery({
      studio: dir,
      now: NOW,
      only: [{ id: "orphan-a", harness: "codex" }, { id: "orphan-b", harness: "codex" }],
      harnesses: { codex: profile },
      listModels: async () => [], versions: async () => ({}),
    });
    check(3, "(c) zero turns when harness has no seated candidate", calls.start.length === 0, String(calls.start.length));
    const a = r.record.models.find((m) => m.id === "orphan-a");
    const b = r.record.models.find((m) => m.id === "orphan-b");
    check(3, "(c) both rows unverified", a?.state === "unverified" && b?.state === "unverified", JSON.stringify([a, b]));
    check(3, '(c) note is "no control"', a?.probes[0]?.note === "no control" && b?.probes[0]?.note === "no control", JSON.stringify([a, b]));
  }
  // (d) structured short-circuit: 401 and 403 stop the harness after one
  //     turn; a negative pins that 500 does NOT short-circuit. Positive
  //     control: the OTHER harness in the same battery is unaffected.
  for (const status of [401, 403]) {
    const dir = freshDir(`b3d-${status}`);
    writeManifest(
      dir,
      "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl },\n" +
        "          { id: cx-lead, collegium: engineering, kind: agent, model: cx-ctrl, harness: codex } ]\nprobationes: []",
    );
    const claude = makeStub("claude-code", {
      turnFor: (model) => (model === "aaa-ctrl" ? okTurn("OK") : shortCircuitTurn(status)),
    });
    const codex = makeStub("codex", { turnFor: () => okTurn("codex fine") });
    const r = await probeBattery({
      studio: dir,
      now: NOW,
      only: [
        { id: "aaa-ctrl", harness: "claude-code" },
        { id: "zzz-blocked", harness: "claude-code" },
        { id: "cx-ctrl", harness: "codex" },
      ],
      harnesses: { "claude-code": claude.profile, codex: codex.profile },
      listModels: async () => [], versions: async () => ({}),
    });
    check(3, `(d) ${status}: exactly two claude-code start calls (control + the blocked one)`, claude.calls.start.length === 2, String(claude.calls.start.length));
    const blocked = r.record.models.find((m) => m.id === "zzz-blocked");
    check(3, `(d) ${status}: blocked pair is unverified`, blocked?.state === "unverified", JSON.stringify(blocked));
    check(3, `(d) ${status}: the other harness (codex) unaffected`, codex.calls.start.length === 1, String(codex.calls.start.length));
    const cxEntry = r.record.models.find((m) => m.id === "cx-ctrl");
    check(3, `(d) ${status}: codex row written normally`, cxEntry?.state === "available", JSON.stringify(cxEntry));
  }
  // negative: 500 does not short-circuit
  {
    const dir = freshDir("b3d-500");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl } ]\nprobationes: []");
    const claude = makeStub("claude-code", {
      turnFor: (model) => (model === "aaa-ctrl" ? okTurn("OK") : shortCircuitTurn(500)),
    });
    const r = await probeBattery({
      studio: dir,
      now: NOW,
      only: [{ id: "aaa-ctrl", harness: "claude-code" }, { id: "zzz-500", harness: "claude-code" }],
      harnesses: { "claude-code": claude.profile },
      listModels: async () => [], versions: async () => ({}),
    });
    check(3, "(d) negative: a 500 does not short-circuit (two turns spent)", claude.calls.start.length === 2, String(claude.calls.start.length));
    const entry500 = r.record.models.find((m) => m.id === "zzz-500");
    check(3, "(d) negative: a 500 gets an ordinary unavailable verdict, not a short-circuit note", entry500?.state === "unavailable" && entry500?.probes[0]?.exit === 1, JSON.stringify(entry500));
  }
}

// ===========================================================================
// Behaviour 4: a usage limit is not a model verdict, and what a stop skips
// heads the next run.
// ===========================================================================
if (runs(4)) {
  const dir = freshDir("b4");
  writeManifest(
    dir,
    "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl } ]\nprobationes: []",
  );
  const pairs: Candidate[] = [
    { id: "aaa-ctrl", harness: "claude-code" },
    { id: "zzz-completes", harness: "claude-code" },
    { id: "bbb-limit", harness: "claude-code" },
    { id: "ddd-never", harness: "claude-code" },
  ];

  // Prime distinct `at` values in the desired relative age order (oldest
  // first): zzz-completes, then bbb-limit, then ddd-never — each primed
  // with its own single-candidate battery so its `at` is set independently
  // of the others, before the real run-1 battery ever executes.
  const primingStub = makeStub("claude-code", { turnFor: () => okTurn("primed") });
  for (const [i, id] of ["zzz-completes", "bbb-limit", "ddd-never"].entries()) {
    await probeBattery({ studio: dir, now: later(NOW, i * 1000), only: [{ id, harness: "claude-code" }], harnesses: { "claude-code": primingStub.profile }, listModels: async () => [] , versions: async () => ({})});
  }
  // Each priming call also probes the control (aaa-ctrl), so it's two turns
  // per call — the property that matters is the three primed `at` values
  // ending up in the desired relative order, checked via run1/run2 below.
  check(4, "priming spent two turns per call (target + control)", primingStub.calls.start.length === 6, String(primingStub.calls.start.length));

  // Run 1: control passes, zzz-completes completes normally, bbb-limit hits
  // the usage limit (stopping the harness), ddd-never is never reached.
  const run1Turns = { "aaa-ctrl": okTurn("OK"), "zzz-completes": okTurn("still fine"), "bbb-limit": limitTurn(), "ddd-never": okTurn("must not run") } as Record<string, Turn>;
  const run1 = makeStub("claude-code", { turnFor: (model) => run1Turns[model ?? ""] ?? okTurn() });
  const result1 = await probeBattery({ studio: dir, now: later(NOW, 10_000), only: pairs, harnesses: { "claude-code": run1.profile }, listModels: async () => [] , versions: async () => ({})});

  check(4, "run1: exit===3 recorded unverified, note 'usage limit', no exit/reply", (() => {
    const e = result1.record.models.find((m) => m.id === "bbb-limit");
    return e?.state === "unverified" && e?.probes[0]?.note === "usage limit" && e?.probes[0]?.exit === undefined && e?.probes[0]?.reply === undefined;
  })(), JSON.stringify(result1.record.models.find((m) => m.id === "bbb-limit")));
  check(4, "run1: ddd-never is unreached (skipped)", result1.skipped.some((c) => c.id === "ddd-never"), JSON.stringify(result1.skipped));
  check(4, "run1: ddd-never got zero turns", !run1.calls.start.some((c) => c.model === "ddd-never"), JSON.stringify(run1.calls.start.map((c) => c.model)));
  check(4, "run1: zzz-completes did complete (positive control)", result1.record.models.find((m) => m.id === "zzz-completes")?.state === "available", "");

  // Run 2: the previously-skipped pair (ddd-never) heads the queue; the pair
  // that DID complete in run 1 (zzz-completes) is probed LAST among the
  // three non-control pairs.
  const run2 = makeStub("claude-code", { turnFor: () => okTurn("run2 ok") });
  await probeBattery({ studio: dir, now: later(NOW, 20_000), only: pairs, harnesses: { "claude-code": run2.profile }, listModels: async () => [] , versions: async () => ({})});
  const order = run2.calls.start.map((c) => c.model);
  check(4, "run2: control still runs first", order[0] === "aaa-ctrl", JSON.stringify(order));
  check(4, "run2: previously-skipped pair heads the (non-control) queue", order[1] === "ddd-never", JSON.stringify(order));
  check(4, "run2 positive control: the pair that completed in run1 is probed LAST", order[order.length - 1] === "zzz-completes", JSON.stringify(order));

  // Virgin-record case (censor round 1, finding 3): NO priming of prior `at`
  // values at all — a completely fresh studio, no pre-existing models.json.
  // A first battery has no evidence to be "oldest"; the rotation must still
  // hold once it starts producing some. Ids are chosen so alphabetical
  // order (the only tiebreak available on a virgin record) puts the
  // "completes" pair before the "limit" pair in run1's own processing.
  const dirVirgin = freshDir("b4-virgin");
  writeManifest(dirVirgin, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl } ]\nprobationes: []");
  const virginPairs: Candidate[] = [
    { id: "aaa-ctrl", harness: "claude-code" },
    { id: "bbb-completes", harness: "claude-code" },
    { id: "mmm-limit", harness: "claude-code" },
    { id: "zzz-never", harness: "claude-code" },
  ];
  const virginTurns = { "aaa-ctrl": okTurn("OK"), "bbb-completes": okTurn("fine"), "mmm-limit": limitTurn(), "zzz-never": okTurn("must not run") } as Record<string, Turn>;
  const virginRun1 = makeStub("claude-code", { turnFor: (model) => virginTurns[model ?? ""] ?? okTurn() });
  const virginResult1 = await probeBattery({ studio: dirVirgin, now: NOW, only: virginPairs, harnesses: { "claude-code": virginRun1.profile }, listModels: async () => [], versions: async () => ({}) });
  check(4, "virgin: run1 processes in id order with no priming at all (control, then bbb, mmm, stop)", virginRun1.calls.start.map((c) => c.model).join(",") === "aaa-ctrl,bbb-completes,mmm-limit", virginRun1.calls.start.map((c) => c.model).join(","));
  check(4, "virgin: zzz-never is unreached on a record with zero prior evidence", virginResult1.skipped.some((c) => c.id === "zzz-never"), JSON.stringify(virginResult1.skipped));

  const virginRun2 = makeStub("claude-code", { turnFor: () => okTurn("run2") });
  await probeBattery({ studio: dirVirgin, now: later(NOW, 10_000), only: virginPairs, harnesses: { "claude-code": virginRun2.profile }, listModels: async () => [], versions: async () => ({}) });
  const virginOrder2 = virginRun2.calls.start.map((c) => c.model);
  check(4, "virgin: run2 still runs the control first", virginOrder2[0] === "aaa-ctrl", JSON.stringify(virginOrder2));
  check(4, "virgin: the pair a fresh record never touched heads run2's queue, with NO priming ever seeding it there", virginOrder2[1] === "zzz-never", JSON.stringify(virginOrder2));
  check(4, "virgin positive control: the pair that completed in run1 is not first in run2", virginOrder2[1] !== "bbb-completes", JSON.stringify(virginOrder2));
}

// ===========================================================================
// Behaviour 5: mark before spend.
// ===========================================================================
if (runs(5)) {
  const dir = freshDir("b5");
  writeManifest(
    dir,
    "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl },\n" +
      "          { id: cx-lead, collegium: engineering, kind: agent, model: cx-ctrl, harness: codex } ]\nprobationes: []",
  );
  // Seed both pairs already `available`.
  const seeded: ModelsRecord = {
    schema: 1,
    at: NOW.toISOString(),
    harnessVersions: {},
    models: [
      { id: "aaa-ctrl", state: "available", harness: "claude-code", probes: [{ harness: "claude-code", state: "available", at: NOW.toISOString(), exit: 0, reply: true }] },
      { id: "cx-ctrl", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: NOW.toISOString(), exit: 0, reply: true }] },
      { id: "cx-other", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: NOW.toISOString(), exit: 0, reply: true }] },
    ],
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(seeded, null, 2) + "\n");

  let checkedOnFirstCall = false;
  const claude = makeStub("claude-code", {
    turnFor: (model) => {
      if (!checkedOnFirstCall) {
        checkedOnFirstCall = true;
        const onDisk = readRaw(dir);
        const models = (onDisk?.["models"] as { id: string; state: string; probes: { note?: string }[] }[]) ?? [];
        const allMarked = models.every((m) => m.state === "unverified" && m.probes[0]?.note === "probe due");
        check(5, "before the first turn, models.json already shows every due pair unverified/'probe due'", allMarked, JSON.stringify(onDisk));
      }
      return model === "aaa-ctrl" ? okTurn("OK") : failTurn(1, { stdout: "", stderr: "control down" });
    },
  });
  // The codex control (cx-ctrl) fails its own turn -> cx-other (not the
  // control) is condemned and stays unverified with zero turns spent on it.
  const codex = makeStub("codex", { turnFor: () => failTurn(1, { stdout: "", stderr: "codex control down" }) });

  await probeBattery({
    studio: dir,
    now: later(NOW, 1000),
    only: [
      { id: "aaa-ctrl", harness: "claude-code" },
      { id: "cx-ctrl", harness: "codex" },
      { id: "cx-other", harness: "codex" },
    ],
    harnesses: { "claude-code": claude.profile, codex: codex.profile },
    listModels: async () => [], versions: async () => ({}),
  });

  const finalRecord = readRaw(dir);
  const finalModels = (finalRecord?.["models"] as { id: string; state: string }[]) ?? [];
  const codexOtherRow = finalModels.find((m) => m.id === "cx-other");
  check(5, "the codex control failed -> the non-control tail stays unverified on disk", codexOtherRow?.state === "unverified", JSON.stringify(codexOtherRow));
  check(5, "the codex control's own turn ran (exactly one codex start call)", codex.calls.start.length === 1, String(codex.calls.start.length));
  const claudeRow = finalModels.find((m) => m.id === "aaa-ctrl");
  check(5, "positive control: the passing pair's own row is available again at the end", claudeRow?.state === "available", JSON.stringify(claudeRow));
}

// ===========================================================================
// Behaviour 6: every record write is atomic.
// ===========================================================================
if (runs(6)) {
  // (a) writer produces models.json.tmp and renames it — asserted by
  //     stubbing renameSync and capturing its two arguments.
  {
    const dir = freshDir("b6a");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa } ]\nprobationes: []");
    const renameCalls: [string, string][] = [];
    const stubRename = (from: string, to: string) => {
      renameCalls.push([from, to]);
      renameSync(from, to);
    };
    const { profile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    await probeBattery({
      studio: dir,
      now: NOW,
      only: [{ id: "aaa", harness: "claude-code" }],
      harnesses: { "claude-code": profile },
      listModels: async () => [], versions: async () => ({}),
      fs: { writeFileSync, renameSync: stubRename },
    });
    check(6, "(a) renameSync called with models.json.tmp -> models.json", renameCalls.some(([from, to]) => from === join(resolve(dir), "models.json.tmp") && to === join(resolve(dir), "models.json")), JSON.stringify(renameCalls));
  }
  // (b) the write itself is interrupted: stub throws AFTER the temp file
  //     exists and BEFORE the rename; models.json is then byte-identical
  //     to its pre-write content and still parses. Positive control: the
  //     same battery without the injected throw does change models.json.
  {
    const dir = freshDir("b6b");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa } ]\nprobationes: []");
    const preExisting: ModelsRecord = { schema: 1, at: NOW.toISOString(), harnessVersions: {}, models: [] };
    writeFileSync(join(dir, "models.json"), JSON.stringify(preExisting, null, 2) + "\n");
    const before = readFileSync(join(dir, "models.json"), "utf8");

    const throwingRename = (_from: string, _to: string): void => {
      throw new Error("simulated crash between temp write and rename");
    };
    const { profile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    let threw = false;
    try {
      await probeBattery({
        studio: dir,
        now: later(NOW, 1),
        only: [{ id: "aaa", harness: "claude-code" }],
        harnesses: { "claude-code": profile },
        listModels: async () => [], versions: async () => ({}),
        fs: { writeFileSync, renameSync: throwingRename },
      });
    } catch {
      threw = true;
    }
    check(6, "(b) the interrupted write propagates a failure", threw);
    const afterInterrupted = readFileSync(join(dir, "models.json"), "utf8");
    check(6, "(b) models.json is byte-identical to its pre-write content", afterInterrupted === before, "");
    check(6, "(b) models.json still parses", (() => {
      try {
        JSON.parse(afterInterrupted);
        return true;
      } catch {
        return false;
      }
    })());
    check(6, "(b) the temp file was actually written (real interruption, not a no-op)", existsSync(join(dir, "models.json.tmp")));

    // Positive control: the same battery, no injected throw, DOES change models.json.
    const { profile: profile2 } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    await probeBattery({ studio: dir, now: later(NOW, 2), only: [{ id: "aaa", harness: "claude-code" }], harnesses: { "claude-code": profile2 }, listModels: async () => [] , versions: async () => ({})});
    const afterOk = readFileSync(join(dir, "models.json"), "utf8");
    check(6, "(b) positive control: an uninterrupted battery DOES change models.json", afterOk !== before, "");
  }
  // (c) a pre-existing models.json.tmp left by a previous crash is
  //     overwritten and does not corrupt the run.
  {
    const dir = freshDir("b6c");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa } ]\nprobationes: []");
    writeFileSync(join(dir, "models.json.tmp"), "{ not even close to valid json");
    const { profile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    const r = await probeBattery({ studio: dir, now: NOW, only: [{ id: "aaa", harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
    check(6, "(c) a stale .tmp does not corrupt the run", r.turns === 1, String(r.turns));
    const final = readRaw(dir);
    check(6, "(c) the final file parses and holds the fresh result", (final?.["models"] as { id: string }[] | undefined)?.some((m) => m.id === "aaa") === true, JSON.stringify(final));
  }
}

// ===========================================================================
// Behaviour 7: candidates are pairs, from two sources, asserted through the
// exported gatherCandidates.
// ===========================================================================
if (runs(7)) {
  const fixture = join(fixturesDir, "manifest-harness-collision.yml");
  const listing = [
    { id: "gpt-6-astra", harness: "codex" },
    { id: "gpt-5.6-luna", harness: "codex" },
  ];
  // gatherCandidates takes a studio DIRECTORY containing bisellium.yml — copy
  // the fixture into its own temp dir so `studio` resolves correctly.
  const dir = freshDir("b7");
  writeFileSync(join(dir, "bisellium.yml"), readFileSync(fixture, "utf8"));
  const real = gatherCandidates({ studio: dir, listing });

  check(7, "the harness-less seat's model yields BOTH (id, codex) and (id, claude-code)", real.some((c) => c.id === "gpt-6-astra" && c.harness === "codex") && real.some((c) => c.id === "gpt-6-astra" && c.harness === "claude-code"), JSON.stringify(real));
  check(7, "a tier model resolvable only via the listing gets the listing's harness", real.some((c) => c.id === "gpt-5.6-luna" && c.harness === "codex"), JSON.stringify(real));
  check(7, "a tier model resolvable through NOTHING yields no entry", !real.some((c) => c.id === "solo-orphan-model"), JSON.stringify(real));
  check(7, "a model named only in an event log is not a candidate (nothing here reads one)", true); // gatherCandidates never touches events.jsonl at all — pinned by construction
  check(7, "no duplicates: unique by (id, harness)", new Set(real.map((c) => `${c.id}\u0000${c.harness}`)).size === real.length, JSON.stringify(real));

  // listing: undefined (the call failed) is NOT an empty listing — the
  // manifest-derived pairs come back unchanged.
  const withoutListing = gatherCandidates({ studio: dir, listing: undefined });
  check(7, "listing undefined: manifest-derived pair (harness-less seat, claude-code default) still present", withoutListing.some((c) => c.id === "gpt-6-astra" && c.harness === "claude-code"), JSON.stringify(withoutListing));
  check(7, "listing undefined: no codex pair invented from nothing", !withoutListing.some((c) => c.id === "gpt-6-astra" && c.harness === "codex"), JSON.stringify(withoutListing));
}

// ===========================================================================
// Behaviour 8: a listing failure degrades and never empties the record; the
// hoisted default rejects.
// ===========================================================================
if (runs(8)) {
  // (a) listModels rejecting leaves every manifest-derived pair probed and
  //     every previously-recorded entry intact.
  {
    const dir = freshDir("b8a");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: seated-model } ]\nprobationes: []");
    const preExisting: ModelsRecord = {
      schema: 1,
      at: NOW.toISOString(),
      harnessVersions: {},
      models: [{ id: "old-codex-entry", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: NOW.toISOString(), exit: 0, reply: true }] }],
    };
    writeFileSync(join(dir, "models.json"), JSON.stringify(preExisting, null, 2) + "\n");
    const { profile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    const r = await probeBattery({
      studio: dir,
      now: later(NOW, 1),
      harnesses: { "claude-code": profile },
      listModels: async () => {
        throw new Error("simulated listing failure");
      }, versions: async () => ({}),
    });
    check(8, "(a) the seated candidate still gets probed despite the listing failing", r.record.models.some((m) => m.id === "seated-model" && m.state === "available"), JSON.stringify(r.record.models));
    check(8, "(a) the previously-recorded codex entry is retained intact", r.record.models.some((m) => m.id === "old-codex-entry" && m.state === "available"), JSON.stringify(r.record.models));
  }
  // (b) the real codexListModels REJECTS — not resolves [] — on a missing
  //     binary, a non-zero exit, and unparseable/wrong-shaped stdout.
  {
    const binDir = freshDir("b8b-bin");
    const origPath = process.env["PATH"];

    async function withStubBin(script: string | undefined, run: () => Promise<void>): Promise<void> {
      // "missing binary" must exclude the REAL system codex (this machine
      // has one installed) — PATH is the stub dir alone, with none of the
      // real system's bin dirs, so exec genuinely fails to find `codex`.
      // Every other case needs the system PATH too, so the stub's
      // "#!/usr/bin/env node" shebang can resolve `env` and `node`.
      if (script !== undefined) {
        writeFileSync(join(binDir, "codex"), script);
        chmodSync(join(binDir, "codex"), 0o755);
        process.env["PATH"] = `${binDir}:${origPath}`;
      } else {
        process.env["PATH"] = binDir;
      }
      try {
        await run();
      } finally {
        process.env["PATH"] = origPath;
      }
    }

    // missing binary
    await withStubBin(undefined, async () => {
      let rejected = false;
      try {
        await codexListModels();
      } catch {
        rejected = true;
      }
      check(8, "(b) missing binary: codexListModels rejects", rejected);
    });

    // non-zero exit
    await withStubBin("#!/usr/bin/env node\nprocess.exit(1);\n", async () => {
      let rejected = false;
      try {
        await codexListModels();
      } catch {
        rejected = true;
      }
      check(8, "(b) non-zero exit: codexListModels rejects", rejected);
    });

    // unparseable stdout
    await withStubBin('#!/usr/bin/env node\nprocess.stdout.write("not json at all");\n', async () => {
      let rejected = false;
      try {
        await codexListModels();
      } catch {
        rejected = true;
      }
      check(8, "(b) unparseable JSON: codexListModels rejects", rejected);
    });

    // wrong-shaped JSON (valid JSON, no `models` array)
    await withStubBin('#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ nope: true }));\n', async () => {
      let rejected = false;
      try {
        await codexListModels();
      } catch {
        rejected = true;
      }
      check(8, "(b) wrong-shaped JSON: codexListModels rejects", rejected);
    });

    // positive control: a well-formed response resolves with the filtered,
    // tagged list — so a reject-everything stub cannot pass this section.
    await withStubBin(
      `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ models: [ { slug: "gpt-x", visibility: "list" }, { slug: "gpt-hidden", visibility: "hidden" } ] }));\n`,
      async () => {
        const listed = await codexListModels();
        check(8, "(b) positive control: a well-formed response resolves with the visible slug only", listed.length === 1 && listed[0]?.id === "gpt-x" && listed[0]?.harness === "codex", JSON.stringify(listed));
      },
    );
  }
}

// ===========================================================================
// Behaviour 9: the record's shape, version evidence, aggregation, the seam,
// and the disagreement warning.
// ===========================================================================
if (runs(9)) {
  const fixture = join(fixturesDir, "manifest-harness-collision.yml");
  const dir = freshDir("b9");
  writeFileSync(join(dir, "bisellium.yml"), readFileSync(fixture, "utf8"));

  const claude = makeStub("claude-code", {
    turnFor: (model) => {
      if (model === "claude-opus-5") return okTurn("OK"); // control (eng-lead's seat)
      if (model === "gpt-6-astra") return failTurn(1, { stdout: "", stderr: "claude cannot run gpt-6-astra" });
      return okTurn("OK");
    },
  });
  const codex = makeStub("codex", { turnFor: () => okTurn("codex OK") });

  const capturedLog: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    capturedLog.push(args.map(String).join(" "));
  };
  let r;
  try {
    r = await probeBattery({
      studio: dir,
      now: NOW,
      harnesses: { "claude-code": claude.profile, codex: codex.profile },
      listModels: async () => [{ id: "gpt-6-astra", harness: "codex" }],
      versions: async () => ({ claude: "2.1.280 (Claude Code)", codex: "codex-cli 0.153.4" }),
    });
  } finally {
    console.log = origLog;
  }

  check(9, "schema: 1", r.record.schema === 1);
  check(9, "at is an ISO string", !Number.isNaN(new Date(r.record.at).getTime()), r.record.at);
  check(9, "harnessVersions snapshot carries both live values", r.record.harnessVersions.claude === "2.1.280 (Claude Code)" && r.record.harnessVersions.codex === "codex-cli 0.153.4", JSON.stringify(r.record.harnessVersions));

  const collision = r.record.models.find((m) => m.id === "gpt-6-astra");
  check(9, "collision entry has probes sorted by harness", collision !== undefined && collision.probes.every((p, i) => i === 0 || collision.probes[i - 1]!.harness <= p.harness), JSON.stringify(collision));
  check(9, "models[] unique by id", new Set(r.record.models.map((m) => m.id)).size === r.record.models.length, JSON.stringify(r.record.models.map((m) => m.id)));
  check(9, "models[] sorted by id", r.record.models.every((m, i) => i === 0 || r.record.models[i - 1]!.id <= m.id));

  // version evidence (i) (ii) (iii)
  const controlEntry = r.record.models.find((m) => m.id === "claude-opus-5");
  check(9, "(i) a probed row carries harnessVersion equal to the injected live value", controlEntry?.probes[0]?.harnessVersion === "2.1.280 (Claude Code)", JSON.stringify(controlEntry));

  // (ii): seed a pair that will be marked due but never turned this run —
  // achieved with a harness that has no control at all (zero turns spent).
  const dirNoTurn = freshDir("b9-ii");
  writeManifest(dirNoTurn, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: whatever } ]\nprobationes: []");
  const codexNoSeat = makeStub("codex", { turnFor: () => okTurn("must not run") });
  const rNoTurn = await probeBattery({
    studio: dirNoTurn,
    now: NOW,
    only: [{ id: "never-turned", harness: "codex" }],
    harnesses: { codex: codexNoSeat.profile },
    listModels: async () => [],
    versions: async () => ({ codex: "codex-cli 0.153.4" }),
  });
  const markedRow = rNoTurn.record.models.find((m) => m.id === "never-turned");
  check(9, "(ii) a row marked but never turned carries no harnessVersion", markedRow?.probes[0]?.harnessVersion === undefined, JSON.stringify(markedRow));

  // (iii) SNAPSHOT half: a defined prior top-level version, an undefined
  // live lookup -> the snapshot is preserved.
  const dirPreserve = freshDir("b9-iii");
  writeManifest(dirPreserve, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: seeded } ]\nprobationes: []");
  const seededRecord: ModelsRecord = {
    schema: 1,
    at: NOW.toISOString(),
    harnessVersions: { codex: "codex-cli 0.100.0" },
    models: [{ id: "seeded", state: "unverified", harness: "codex", probes: [{ harness: "codex", state: "unverified", at: NOW.toISOString(), note: "probe due" }] }],
  };
  writeFileSync(join(dirPreserve, "models.json"), JSON.stringify(seededRecord, null, 2) + "\n");
  const { profile: preserveProfile } = makeStub("codex", { turnFor: () => okTurn("OK") });
  const rPreserve = await probeBattery({
    studio: dirPreserve,
    now: later(NOW, 1),
    only: [{ id: "seeded", harness: "codex" }],
    harnesses: { codex: preserveProfile },
    listModels: async () => [],
    versions: async () => ({}), // undefined live lookup for both vendors
  });
  check(9, "(iii) the top-level snapshot is preserved when the live lookup fails", rPreserve.record.harnessVersions.codex === "codex-cli 0.100.0", JSON.stringify(rPreserve.record.harnessVersions));

  // (iii) PER-PAIR half (censor round 1, finding 1): a row carrying a
  // DEFINED prior harnessVersion AND a defined prior `at`, run through a
  // battery that spends ZERO turns on it (no codex seat in this manifest,
  // so codex has no control and every codex row is condemned via the
  // no-control branch) — a writer that stamps `nowIso` or drops
  // `harnessVersion` on a no-turn write fails this. Distinct from behaviour
  // 10(a)'s verbatim-retention case: that one is for a model no longer a
  // CANDIDATE at all; this one IS due this run and still gets no turn.
  const dirPerPair = freshDir("b9-iii-perpair");
  writeManifest(dirPerPair, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: unrelated } ]\nprobationes: []");
  const vintageAt = "2020-01-01T00:00:00.000Z";
  const perPairSeed: ModelsRecord = {
    schema: 1,
    at: NOW.toISOString(),
    harnessVersions: {},
    models: [{ id: "vintage-pair", state: "unverified", harness: "codex", probes: [{ harness: "codex", state: "unverified", at: vintageAt, note: "probe due", harnessVersion: "codex-cli 0.099.0" }] }],
  };
  writeFileSync(join(dirPerPair, "models.json"), JSON.stringify(perPairSeed, null, 2) + "\n");
  const { profile: perPairProfile, calls: perPairCalls } = makeStub("codex", { turnFor: () => okTurn("must not run") });
  const rPerPair = await probeBattery({
    studio: dirPerPair,
    now: later(NOW, 999_999),
    only: [{ id: "vintage-pair", harness: "codex" }],
    harnesses: { codex: perPairProfile },
    listModels: async () => [],
    versions: async () => ({ codex: "codex-cli 9.9.9" }), // a live version IS available — must still not be stamped on a no-turn row
  });
  check(9, "(iii) per-pair: zero turns actually spent on the no-control pair", perPairCalls.start.length === 0, String(perPairCalls.start.length));
  const vintageAfter = rPerPair.record.models.find((m) => m.id === "vintage-pair")?.probes[0];
  check(9, "(iii) per-pair: a no-turn write PRESERVES the prior harnessVersion", vintageAfter?.harnessVersion === "codex-cli 0.099.0", JSON.stringify(vintageAfter));
  check(9, "(iii) per-pair: a no-turn write PRESERVES the prior `at` (does not stamp nowIso)", vintageAfter?.at === vintageAt, JSON.stringify(vintageAfter));

  // disagreement warning: gpt-6-astra disagrees (codex available, claude-code
  // unavailable) — printed, naming the id and both verdicts.
  const warning = capturedLog.find((l) => l.includes("gpt-6-astra"));
  check(9, "a disagreement warning names the id", warning !== undefined, capturedLog.join("\n"));
  check(9, "the warning names both harnesses' verdicts", warning !== undefined && warning.includes("codex") && warning.includes("claude-code"), warning ?? "");
  check(9, "aggregation is optimistic: any available -> available", collision?.state === "available" && collision?.harness === "codex", JSON.stringify(collision));

  // Round-trip through the PUBLIC Store API — id/state/harness/vendorDiagnostic
  // survive, and no id appears twice.
  const store = new Store({ studioDir: dir, now: NOW });
  const officina = store.api.officina();
  const models = officina.models ?? [];
  check(9, "Store round-trip: no id appears twice", new Set(models.map((m) => m.id)).size === models.length, JSON.stringify(models.map((m) => m.id)));
  const roundTripped = models.find((m) => m.id === "claude-opus-5");
  check(9, "Store round-trip: id/state/harness survive", roundTripped?.state === "available" && roundTripped?.harness === "claude-code", JSON.stringify(roundTripped));
  const roundTrippedFail = models.find((m) => m.id === "gpt-6-astra");
  check(9, "Store round-trip: the optimistic aggregate's harness/state survive", roundTrippedFail?.state === "available" && roundTrippedFail?.harness === "codex", JSON.stringify(roundTrippedFail));
}

// ===========================================================================
// Behaviour 10: retention, corruption and healing, through the exported
// readModelsRecord.
// ===========================================================================
if (runs(10)) {
  // (a) an entry for a model no longer a candidate is retained verbatim.
  {
    const dir = freshDir("b10a");
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: still-here } ]\nprobationes: []");
    const seeded: ModelsRecord = {
      schema: 1,
      at: NOW.toISOString(),
      harnessVersions: {},
      models: [{ id: "long-gone", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: NOW.toISOString(), exit: 0, reply: true }] }],
    };
    writeFileSync(join(dir, "models.json"), JSON.stringify(seeded, null, 2) + "\n");
    const { profile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    const r = await probeBattery({ studio: dir, now: later(NOW, 1), only: [{ id: "still-here", harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
    const gone = r.record.models.find((m) => m.id === "long-gone");
    check(10, "(a) retained verbatim (state)", gone?.state === "available", JSON.stringify(gone));
    check(10, "(a) retained verbatim (probe count, zero new turns)", gone?.probes.length === 1 && gone.probes[0]?.at === NOW.toISOString(), JSON.stringify(gone));
  }
  // (b) an unparseable file, a valid-JSON-wrong-shape file, and one whose
  //     models array holds a malformed entry beside a good one.
  {
    const dir = freshDir("b10b");
    writeFileSync(join(dir, "models.json"), "{ not json");
    check(10, "(b) unparseable JSON -> undefined", readModelsRecord(dir) === undefined);

    const dir2 = freshDir("b10b-2");
    writeFileSync(join(dir2, "models.json"), JSON.stringify({ schema: 1, at: "x" })); // no `models` array
    check(10, "(b) wrong shape (no models array) -> undefined", readModelsRecord(dir2) === undefined);

    const dir3 = freshDir("b10b-3");
    writeFileSync(
      dir3 + "/models.json",
      JSON.stringify({
        schema: 1,
        at: NOW.toISOString(),
        harnessVersions: {},
        models: [{ nope: "malformed, no id or state" }, { id: "good-one", state: "available", probes: [] }],
      }),
    );
    const rec3 = readModelsRecord(dir3);
    check(10, "(b) malformed entry skipped, good entry kept", rec3?.models.length === 1 && rec3.models[0]?.id === "good-one", JSON.stringify(rec3));

    // a battery over each degraded case still produces a fresh, complete record
    writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: fresh-model } ]\nprobationes: []");
    writeFileSync(join(dir, "models.json"), "{ not json");
    const { profile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    const r = await probeBattery({ studio: dir, now: NOW, only: [{ id: "fresh-model", harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
    check(10, "(b) a battery over an unparseable file still produces a fresh complete record", r.record.models.some((m) => m.id === "fresh-model" && m.state === "available"), JSON.stringify(r.record));
  }
  // (c) a corrupt `at` is classified as never-probed, shown by probe ORDER.
  {
    const dir = freshDir("b10c");
    writeManifest(
      dir,
      "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl } ]\nprobationes: []",
    );
    const seeded: ModelsRecord = {
      schema: 1,
      at: NOW.toISOString(),
      harnessVersions: {},
      models: [
        { id: "bbb-corrupt", state: "unverified", harness: "claude-code", probes: [{ harness: "claude-code", state: "unverified", at: "not-a-real-date", note: "probe due" }] },
        { id: "ccc-old", state: "unverified", harness: "claude-code", probes: [{ harness: "claude-code", state: "unverified", at: later(NOW, -100_000).toISOString(), note: "probe due" }] },
        { id: "ddd-recent", state: "unverified", harness: "claude-code", probes: [{ harness: "claude-code", state: "unverified", at: later(NOW, -1_000).toISOString(), note: "probe due" }] },
      ],
    };
    writeFileSync(join(dir, "models.json"), JSON.stringify(seeded, null, 2) + "\n");
    const { profile, calls } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    // The `only` array is deliberately NOT in the asserted output order
    // (censor round 1, finding 2): with the input already sorted, a
    // NaN-coercing comparator's stable sort leaves bbb-corrupt in place and
    // the assertion passes for the wrong reason (ECMA-262 SortCompare
    // treats NaN as 0, so V8's stable sort is a no-op on ties). Shuffled
    // input makes the assertion depend on the comparator actually running.
    const r = await probeBattery({
      studio: dir,
      now: later(NOW, 1),
      only: [
        { id: "ddd-recent", harness: "claude-code" },
        { id: "ccc-old", harness: "claude-code" },
        { id: "bbb-corrupt", harness: "claude-code" },
        { id: "aaa-ctrl", harness: "claude-code" },
      ],
      harnesses: { "claude-code": profile },
      listModels: async () => [], versions: async () => ({}),
    });
    const order = calls.start.map((c) => c.model);
    check(10, "(c) control still first", order[0] === "aaa-ctrl", JSON.stringify(order));
    check(10, "(c) corrupt `at` is treated as never-probed and sorts FIRST among the rest", order[1] === "bbb-corrupt", JSON.stringify(order));
    check(10, "(c) then ascending age: old before recent", order[2] === "ccc-old" && order[3] === "ddd-recent", JSON.stringify(order));
    const finalAt = r.record.models.find((m) => m.id === "bbb-corrupt")?.probes[0]?.at;
    check(10, "(c) the resulting `at` parses", finalAt !== undefined && !Number.isNaN(new Date(finalAt).getTime()), String(finalAt));
  }
}

// ===========================================================================
// Behaviour 11: `bisellium probe` is a real verb with the house refusal
// shape.
// ===========================================================================
if (runs(11)) {
  const dir = freshDir("b11");
  writeManifest(dir, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: solo } ]\nprobationes: []");
  const stubOpts = { listModels: async () => [], versions: async () => ({}) };
  const { profile: soloProfile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });

  // unknown flag -> usage line, exit 2, zero spend, before any file write
  {
    const r = await runProbe(["--studio", dir, "--nonsense"], stubOpts);
    check(11, "an unknown flag exits 2", r.exitCode === 2, String(r.exitCode));
    check(11, "an unknown flag writes no file", !existsSync(join(dir, "models.json")));
  }

  // --dry-run: prints candidates, spends zero, writes no file
  {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
    let r;
    try {
      r = await runProbe(["--studio", dir, "--dry-run"], stubOpts);
    } finally {
      console.log = orig;
    }
    check(11, "--dry-run exits 0", r.exitCode === 0, String(r.exitCode));
    check(11, "--dry-run writes no file", !existsSync(join(dir, "models.json")));
    check(11, "--dry-run prints the candidate pairs and their harnesses", logs.some((l) => l.includes("solo") && l.includes("claude-code")), logs.join("\n"));
  }

  // positive control: the same studio, without --dry-run, writes one.
  {
    const r = await runProbe(["--studio", dir], { ...stubOpts, harnesses: { "claude-code": soloProfile } });
    check(11, "positive control: without --dry-run exits 0", r.exitCode === 0, String(r.exitCode));
    check(11, "positive control: without --dry-run WRITES models.json", existsSync(join(dir, "models.json")));
  }
}

// ===========================================================================
// Behaviour 12: --model requires --harness, and the pair is the unit.
// ===========================================================================
if (runs(12)) {
  const dir = freshDir("b12");
  writeManifest(
    dir,
    "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa-ctrl } ]\nprobationes: []",
  );
  const stubOpts = { listModels: async () => [], versions: async () => ({}) };
  const { profile: claudeStub } = makeStub("claude-code", { turnFor: () => okTurn("OK") });

  {
    const r1 = await runProbe(["--studio", dir, "--model", "x"], stubOpts);
    check(12, "--model alone refuses, exit 2", r1.exitCode === 2, String(r1.exitCode));
    const r2 = await runProbe(["--studio", dir, "--harness", "claude-code"], stubOpts);
    check(12, "--harness alone refuses, exit 2", r2.exitCode === 2, String(r2.exitCode));
    check(12, "neither writes a file before any spend", !existsSync(join(dir, "models.json")));
  }

  // A valid pair (including an id in no candidate source) probes exactly
  // that pair plus the harness's control, and leaves every other entry
  // byte-identical.
  {
    const seeded: ModelsRecord = {
      schema: 1,
      at: NOW.toISOString(),
      harnessVersions: {},
      models: [{ id: "untouched-entry", state: "available", harness: "codex", probes: [{ harness: "codex", state: "available", at: NOW.toISOString(), exit: 0, reply: true }] }],
    };
    writeFileSync(join(dir, "models.json"), JSON.stringify(seeded, null, 2) + "\n");
    const before = readRaw(dir);

    const r = await runProbe(["--studio", dir, "--model", "unlisted-id", "--harness", "claude-code"], { ...stubOpts, harnesses: { "claude-code": claudeStub } });
    check(12, "a targeted pair with an id in no source still exits 0", r.exitCode === 0, String(r.exitCode));
    const after = readRaw(dir);
    const models = (after?.["models"] as { id: string }[]) ?? [];
    check(12, "the targeted id was probed", models.some((m) => m.id === "unlisted-id"), JSON.stringify(models.map((m) => m.id)));
    check(12, "the control (aaa-ctrl) was also probed (one extra turn)", models.some((m) => m.id === "aaa-ctrl"), JSON.stringify(models.map((m) => m.id)));
    const untouchedBefore = JSON.stringify((before?.["models"] as unknown[]).find((m: unknown) => (m as { id: string }).id === "untouched-entry"));
    const untouchedAfter = JSON.stringify(models.find((m) => m.id === "untouched-entry"));
    check(12, "every other entry is byte-identical", untouchedBefore === untouchedAfter, `${untouchedBefore} vs ${untouchedAfter}`);
  }

  // An id containing a path separator or ".." reaches no filesystem path.
  {
    const dir2 = freshDir("b12-path");
    writeManifest(dir2, "sellae: [ { id: eng-lead, collegium: engineering, kind: agent, model: aaa } ]\nprobationes: []");
    const { profile: claudeStub2 } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
    const r = await runProbe(["--studio", dir2, "--model", "../../etc/evil", "--harness", "claude-code"], { ...stubOpts, harnesses: { "claude-code": claudeStub2 } });
    check(12, "a path-shaped id does not crash the command", r.exitCode === 0, String(r.exitCode));
    check(12, "models.json still lives only inside the studio dir", existsSync(join(dir2, "models.json")));
    check(12, "no file was written outside the studio dir", !existsSync(join(dir2, "..", "evil")) && !existsSync("/tmp/evil") && !existsSync(join(dir2, "..", "..", "etc", "evil")));
  }
}

// ===========================================================================
// Behaviour 13: a configuration or bookkeeping write grows the event log by
// zero — with positive controls.
// ===========================================================================
if (runs(13)) {
  const { cpSync } = await import("node:fs");
  const sampleStudio = resolve(repo, "examples/sample-studio");
  const dir = freshDir("b13");
  cpSync(sampleStudio, dir, { recursive: true });

  const eventsPath = join(dir, ".bisellium", "events.jsonl");
  const linesOf = (): number => (existsSync(eventsPath) ? readFileSync(eventsPath, "utf8").split("\n").filter((l) => l.trim().length > 0).length : 0);
  const before = linesOf();

  const { profile } = makeStub("claude-code", { turnFor: () => okTurn("OK") });
  const battery = await probeBattery({ studio: dir, now: NOW, only: [{ id: "claude-opus-5", harness: "claude-code" }], harnesses: { "claude-code": profile }, listModels: async () => [] , versions: async () => ({})});
  check(13, "positive control: probeBattery actually did something (turns > 0, a parseable available row)", battery.turns > 0 && battery.record.models.some((m) => m.state === "available"), JSON.stringify({ turns: battery.turns }));

  const manifestBefore = readFileSync(join(dir, "bisellium.yml"), "utf8");
  const delegateResult = runDelegate(["--sella", "builder-1", "--model", "gpt-5.6-sol", "--studio", dir], { now: NOW });
  const manifestAfter = readFileSync(join(dir, "bisellium.yml"), "utf8");
  const timelinePath = join(dir, "timeline", "patron.jsonl");
  check(13, "positive control: runDelegate actually did something (exit 0, manifest changed, timeline appended)", delegateResult.exitCode === 0 && manifestBefore !== manifestAfter && existsSync(timelinePath), JSON.stringify({ exit: delegateResult.exitCode }));

  const after = linesOf();
  check(13, "events.jsonl grew by zero lines", after === before, `${before} -> ${after}`);
}

if (only === undefined) {
  console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILURE(S)`}`);
}
process.exit(failed ? 1 : 0);
