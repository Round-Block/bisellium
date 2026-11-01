/**
 * W-452 (D-150 C, D-129 A, D-150 B): the collegium's spec seats (studio/briefs/W-452.md). `bisellium.yml#spec_seats` names, per
 * collegium, the seat that signs an opus's spec and the seat that reviews it; `next` and `verdict --phase spec` both read it, and
 * an opus whose spec sequence began before its `since` keeps today's seats. Select one row with --test-name-pattern='^W-452-b<n>\s'.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Manifest } from "@bisellium/adapter-native";
import { deriveNext, readSpecReviewer, type Facts } from "./next.js";
import { runVerdict } from "./verdict.js";

type Dict = Record<string, unknown>;
const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SINCE = "2026-11-01T12:00:00.000Z";
const SR = "spec-reviewer";
const SOL = "gpt-5.6-sol";
const OPUS_MODEL = "claude-opus-5-5";
const SEATS_TEXT = [
  "spec_seats:",
  `  since: ${SINCE}`,
  "  collegia:",
  `    engineering: { signer: architect, reviewer: ${SR} }`,
  `    ops: { signer: ops-lead, reviewer: ${SR} }`,
  `    production: { signer: ladder-lead, reviewer: ${SR} }`,
  "    design: { signer: design-lead, reviewer: ui-spec-reviewer }",
  "",
].join("\n");
const SELLAE = [
  { id: "producer", collegium: "production", kind: "orchestrator", model: OPUS_MODEL },
  { id: "architect", collegium: "engineering", kind: "agent", model: OPUS_MODEL },
  { id: "eng-lead", collegium: "engineering", kind: "agent", model: OPUS_MODEL },
  { id: "ops-lead", collegium: "ops", kind: "agent", model: OPUS_MODEL },
  { id: "qa-lead", collegium: "qa", kind: "agent", model: OPUS_MODEL },
  { id: "ladder-lead", collegium: "production", kind: "agent", model: OPUS_MODEL },
  { id: "design-lead", collegium: "design", kind: "agent", model: SOL, harness: "codex" },
  { id: "ui-architect", collegium: "design", kind: "agent", model: SOL, harness: "codex" },
  { id: SR, collegium: "qa", kind: "agent", model: SOL, harness: "codex" },
  { id: "ui-spec-reviewer", collegium: "qa", kind: "agent", model: OPUS_MODEL, harness: "claude-code" },
];

/** The five collegia, today's keys (the design magister, spec_reviewer, the UI pair) and the W-452 spec_seats beside them. */
function seatsManifest(edit: (m: Dict & { sellae: Dict[] }) => void = () => {}): Manifest {
  const m = {
    bisellium: 1,
    studio: "seats",
    collegia: [
      { id: "production", name: "Production", magister: "producer" },
      { id: "design", name: "Design", magister: "architect" },
      { id: "engineering", name: "Engineering", magister: "eng-lead" },
      { id: "qa", name: "QA", magister: "qa-lead" },
      { id: "ops", name: "Ops", magister: "ops-lead" },
    ],
    sellae: SELLAE.map((s) => ({ ...s })),
    probationes: [],
    spec_reviewer: SR,
    ui_spec_signer: "ui-architect",
    ui_spec_reviewer: "ui-spec-reviewer",
    spec_seats: {
      since: SINCE,
      collegia: {
        engineering: { signer: "architect", reviewer: SR },
        ops: { signer: "ops-lead", reviewer: SR },
        production: { signer: "ladder-lead", reviewer: SR },
        design: { signer: "design-lead", reviewer: "ui-spec-reviewer" },
      },
    },
  } as unknown as Dict & { sellae: Dict[] };
  edit(m);
  return m as unknown as Manifest;
}
const seatsOf = (m: Dict): Dict => m["spec_seats"] as Dict;
const rowsOf = (m: Dict): Dict => seatsOf(m)["collegia"] as Dict;
const rec = (collegium: string | undefined, o: Dict = {}): Dict => ({ id: "W-900", kind: "feature", state: "greenlit", ...(collegium === undefined ? {} : { collegium }), ...o });
const pair = (signer: string, reviewer: string, model: string) => ({ signer, reviewer: { sella: reviewer, model, design: signer } });

test("W-452-b1 behaviour 1: with spec_seats, an opus's spec is signed and reviewed by its collegium's seats, and every other form of the setting holds", () => {
  const ops = readSpecReviewer(seatsManifest(), rec("ops"));
  assert.deepEqual(ops, pair("ops-lead", SR, SOL), "an ops opus is signed by ops-lead and reviewed by spec-reviewer");
  assert.deepEqual(readSpecReviewer(seatsManifest(), rec("production")), pair("ladder-lead", SR, SOL), "a production opus is signed by ladder-lead (D-129 C)");
  assert.deepEqual(readSpecReviewer(seatsManifest(), rec("engineering")), pair("architect", SR, SOL), "an engineering opus is signed by the architect (D-150 C)");
  assert.deepEqual(readSpecReviewer(seatsManifest(), rec("design")), pair("design-lead", "ui-spec-reviewer", OPUS_MODEL), "a design opus is signed by design-lead and reviewed on the reviewer's own model");
  assert.deepEqual(readSpecReviewer(seatsManifest(), rec("ops", { state: "building" })), { signer: "ops-lead", reviewer: undefined }, "past ready the collegium's signer stands and no review is ordered");
  assert.deepEqual(readSpecReviewer(seatsManifest(), rec("design", { kind: "ui" })), pair("ui-architect", "ui-spec-reviewer", OPUS_MODEL), "a kind: ui opus keeps the UI pair (D-091)");
  const today = seatsManifest((m) => delete m["spec_seats"]);
  assert.deepEqual(readSpecReviewer(today, rec("ops")), pair("architect", SR, SOL), "with no spec_seats every opus keeps the design magister and spec_reviewer");

  const held = (name: string, edit: (m: Dict & { sellae: Dict[] }) => void, why: RegExp, r: Dict = rec("ops")): void => {
    const got = readSpecReviewer(seatsManifest(edit), r);
    assert.ok("error" in got, `${name}: next holds (${JSON.stringify(got)})`);
    assert.match(got.error, why, `${name}: the hold names the cause`);
  };
  held("a setting that is not a mapping", (m) => (m["spec_seats"] = "ops-lead"), /^bisellium\.yml#spec_seats: must be a mapping/);
  held("a since that is no instant", (m) => (seatsOf(m)["since"] = "soon"), /since must be an ISO instant/);
  held("no since", (m) => delete seatsOf(m)["since"], /since must be an ISO instant/);
  held("collegia not a mapping", (m) => (seatsOf(m)["collegia"] = ["ops"]), /collegia must be a mapping/);
  held("a collegium with no row", () => {}, /collegia declares no seats for qa/, rec("qa"));
  held("a record with no collegium", () => {}, /opera\/W-900\.md names no collegium/, rec(undefined));
  held("a row that is not a mapping", (m) => (rowsOf(m)["ops"] = "ops-lead"), /collegia\.ops must be a mapping/);
  held("a row with no signer", (m) => delete (rowsOf(m)["ops"] as Dict)["signer"], /collegia\.ops\.signer must be/);
  held("a row with no reviewer", (m) => delete (rowsOf(m)["ops"] as Dict)["reviewer"], /collegia\.ops\.reviewer must be/);
  held("one seat for both roles", (m) => ((rowsOf(m)["ops"] as Dict)["reviewer"] = "ops-lead"), /signer and reviewer must be different seats/);
  held("an undeclared signer", (m) => ((rowsOf(m)["ops"] as Dict)["signer"] = "ghost"), /ghost is not a declared seat/);
  held("a signer declared twice", (m) => m.sellae.push({ id: "ops-lead", collegium: "ops", kind: "agent", model: OPUS_MODEL }), /ops-lead is declared 2 times/);
  held("a retired signer", (m) => (m.sellae.find((s) => s["id"] === "ops-lead")!["retired"] = true), /ops-lead is retired/);
  held("a signer from another collegium", (m) => ((rowsOf(m)["ops"] as Dict)["signer"] = "qa-lead"), /qa-lead is a seat of qa, not ops; the spec signer must be a seat of the collegium it signs for/);
  held("a signer that is no agent", (m) => (m.sellae.find((s) => s["id"] === "ops-lead")!["kind"] = "human"), /ops-lead must be kind: agent/);
  held("a reviewer with no model", (m) => delete m.sellae.find((s) => s["id"] === SR)!["model"], /spec-reviewer declares no model/);
  held("a reviewer on the same model as the signer", (m) => (m.sellae.find((s) => s["id"] === SR)!["model"] = OPUS_MODEL), /both claude-opus-5-5; the reviewer must be another model/);
  held("a state outside the gate's domain", () => {}, /spec_seats: the trunk record's state backlog is outside the gate's domain/, rec("ops", { state: "backlog" }));
  held("a malformed setting holds a kind: ui opus too", (m) => (seatsOf(m)["since"] = 7), /since must be an ISO instant/, rec("design", { kind: "ui" }));
});

// ---------------------------------------------------------------------------
// W-452-b2 (D-150 B): an opus whose spec sequence began before since keeps today's seats, before the branch and after it.
// ---------------------------------------------------------------------------
/** A brief with the six design-lex sections (as next-world's briefText(1); not imported, so this file is no next row file, W-179). */
const BRIEF = ["# W-900 fixture brief", "", "## Intent", "", "Fixture.", "", "## Files owned", "", "- `source.txt`", "", "## Interfaces", "", "None.", "", "## Behaviours to test", "", "1. **Fixture behaviour 1.**", "", "## Acceptance", "", "Fixture.", "", "## Out of scope", "", "Fixture.", ""].join("\n");
const PIN = `briefs/W-900.md blob:${createHash("sha1").update(`blob ${Buffer.byteLength(BRIEF)}\0`).update(BRIEF).digest("hex")}`;
const specLogText = (round: number, sella: string, at: string, o: { model?: string; outcome?: string; ats?: string[] } = {}): string =>
  [
    "# opus: W-900",
    "# phase: spec",
    `# round: ${round}`,
    `# sella: ${sella}`,
    ...(o.model === undefined ? [] : [`# model: ${o.model}`]),
    `# outcome: ${o.outcome ?? "passed"}`,
    ...(o.ats ?? [`# at: ${at}`]),
    `# brief: ${PIN}`,
    "",
    "## Findings",
    "No findings",
    "",
  ].join("\n");
const src = (files: Record<string, string | undefined>) => ({
  read: (rel: string) => files[rel],
  list: (dir: string) => Object.keys(files).filter((rel) => rel.startsWith(`${dir}/`)).map((rel) => rel.slice(dir.length + 1)),
});
const BEFORE = "2026-11-01T11:59:59.999Z";

function seatFacts(files: Record<string, string>, o: { branch?: boolean; record?: Dict } = {}): Facts {
  const manifest = seatsManifest();
  const record = { ...rec("ops"), title: "seats fixture", probationes: {}, ...o.record };
  const s = src({ [`briefs/W-900.md`]: BRIEF, ...files });
  return {
    id: "W-900",
    repo: "/fixture",
    studioRel: "studio",
    studioAbs: "/fixture/studio",
    excludes: [],
    design: "architect",
    tip: o.branch === true ? "branch-tip" : undefined,
    wt: { dir: "/fixture/.worktrees/W-900", studio: "/fixture/.worktrees/W-900/studio", usable: o.branch === true },
    trunk: src({}),
    trunkRecord: record,
    certified: () => false,
    branch: o.branch === true ? s : undefined,
    branchRecord: o.branch === true ? record : undefined,
    work: o.branch === true ? src({}) : s,
    choreDone: false,
    residue: false,
    pushed: false,
    manifest,
    specOwner: { where: "the main checkout (studio)", record, manifest },
    curTree: () => undefined,
    buildRounds: () => ({ error: "unused" }),
    gates: () => undefined,
    redFindings: () => [],
    replay: () => undefined,
    uiSpecProblems: () => [],
    uiSpecInput: () => undefined,
    uiReviewProblems: () => [],
    uiReviewInput: () => undefined,
    pr: () => ({ kind: "none" }),
    owed: () => ({ owed: [] }),
    daily: () => ({ owed: undefined }),
    evidenceAt: () => 0,
    wtCiProblem: () => undefined,
    wtChanges: () => ({ spec: [], other: [], bad: [] }),
    mainChanges: () => ({ spec: [], other: [], bad: [] }),
  } as unknown as Facts;
}

test("W-452-b2 behaviour 2: an opus whose first spec log predates since keeps today's seats (D-150 B), in next's reader and its orders", () => {
  const logs = (files: Record<string, string | undefined>) => ({ id: "W-900", src: src(files) });
  const legacy = readSpecReviewer(seatsManifest(), rec("ops"), logs({ "ci/W-900-spec-1.log": specLogText(1, "architect", BEFORE) }));
  assert.deepEqual(legacy, pair("architect", SR, SOL), "an ops opus whose first spec log predates since keeps the architect");
  assert.deepEqual(readSpecReviewer(seatsManifest(), rec("ops"), logs({ "ci/W-900-spec-1.log": specLogText(1, "ops-lead", SINCE) })), pair("ops-lead", SR, SOL), "a first spec log at since is under the new seats");
  assert.deepEqual(
    readSpecReviewer(seatsManifest(), rec("ops"), logs({ "ci/W-900-spec-2.log": specLogText(2, SR, SINCE, { model: SOL }), "ci/W-900-spec-10.log": specLogText(10, "architect", BEFORE) })),
    pair("architect", SR, SOL),
    "any spec log before since keeps today's seats, whatever its round",
  );
  assert.deepEqual(
    readSpecReviewer(seatsManifest(), rec("ops"), logs({ "ci/W-9001-spec-1.log": specLogText(1, "architect", BEFORE), "ci/W-900-review-1.log": specLogText(1, "qa-lead", BEFORE), "ci/W-900-spec-01.log": specLogText(1, "architect", BEFORE) })),
    pair("ops-lead", SR, SOL),
    "another opus's spec log, a review log and a spec log named outside the grammar do not start this opus",
  );
  const held = (name: string, files: Record<string, string | undefined>, why: RegExp): void => {
    const got = readSpecReviewer(seatsManifest(), rec("ops"), logs(files));
    assert.ok("error" in got, `${name}: next holds (${JSON.stringify(got)})`);
    assert.match(got.error, why, `${name}: the hold names the log`);
  };
  held("an unreadable spec log", { "ci/W-900-spec-1.log": undefined }, /ci\/W-900-spec-1\.log is unreadable/);
  held("a spec log with no # at:", { "ci/W-900-spec-1.log": specLogText(1, "architect", BEFORE, { ats: [] }) }, /ci\/W-900-spec-1\.log carries no single "# at:" instant/);
  held("a spec log with two # at:", { "ci/W-900-spec-1.log": specLogText(1, "architect", BEFORE, { ats: [`# at: ${BEFORE}`, `# at: ${SINCE}`] }) }, /carries no single "# at:" instant/);
  held("a spec log whose # at: is no instant", { "ci/W-900-spec-1.log": specLogText(1, "architect", "yesterday") }, /carries no single "# at:" instant/);
  assert.deepEqual(readSpecReviewer(seatsManifest(), rec("design", { kind: "ui" }), logs({ "ci/W-900-spec-1.log": undefined })), pair("ui-architect", "ui-spec-reviewer", OPUS_MODEL), "a kind: ui opus reads no log: it keeps the UI pair");

  // next's orders: before the branch the main checkout's logs decide, after it the branch's
  const unsigned = deriveNext(seatFacts({}));
  assert.equal(unsigned.order?.sella, "ops-lead", "a new ops opus orders ops-lead to sign");
  const oldSigned = deriveNext(seatFacts({ "ci/W-900-spec-1.log": specLogText(1, "architect", BEFORE) }));
  assert.equal(oldSigned.order?.sella, SR, "an architect signature from before since is the signature: the review is ordered");
  assert.equal(oldSigned.order?.extra.find(([k]) => k === "model")?.[1], SOL, "on the reviewer's model");
  const newArchitect = deriveNext(seatFacts({ "ci/W-900-spec-1.log": specLogText(1, "architect", SINCE) }));
  assert.equal(newArchitect.order?.sella, "ops-lead", "an architect signature at since is not the ops signature: ops-lead is ordered");
  const reviewed = { "ci/W-900-spec-1.log": specLogText(1, "architect", BEFORE), "ci/W-900-spec-2.log": specLogText(2, SR, SINCE, { model: SOL }) };
  const ready = deriveNext(seatFacts(reviewed, { branch: true }));
  assert.equal(ready.step, "ready", "after the branch, the branch's logs keep today's seats and the reviewed spec reaches ready");
  assert.deepEqual(ready.extra, [["attributed", "architect (signed ci/W-900-spec-1.log)"]], "ready is attributed to the architect");
});

// ---------------------------------------------------------------------------
// W-452-b3: verdict --phase spec judges the seat next names as the signer: its signature owes the promise ledger.
// ---------------------------------------------------------------------------
const NOW = new Date("2026-11-02T00:00:00.000Z");
const LEDGER_BRIEF = ["# W-300 fixture brief", "## Intent", "After this, `ready` refuses the brief and `next` orders the signer.", "Files owned: `packages/cli/src/next.ts`.", "`check` blocks it; `ready` again.", ""].join("\n");
const COVERING = ["brief:3, ready, refuses: packages/x.ts:10 — holds", "brief:3, next, orders the signer: NX:20 — scoped", "brief:5, check and ready: CK:30 — holds"].join("\n");

/** A temp officina: the five collegia's seats, spec_seats (or none) and opus W-300 of `collegium`, with a brief naming verbs. */
function officina(collegium: string, seats = true): string {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w452-"));
  roots.push(root);
  const row = (s: Dict): string => `  - { ${Object.entries(s).map(([k, v]) => `${k}: ${String(v)}`).join(", ")} }`;
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: W-452 seats",
      "patron: patron",
      "collegia:",
      "  - { id: production, name: Production, magister: producer }",
      "  - { id: design, name: Design, magister: architect }",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "  - { id: ops, name: Ops, magister: ops-lead }",
      "sellae:",
      ...SELLAE.map(row),
      "probationes:",
      "  - { id: review, name: Review, kind: agent }",
      "wip_limit: 10",
      `spec_reviewer: ${SR}`,
      ...(seats ? [SEATS_TEXT] : [""]),
    ].join("\n"),
  );
  mkdirSync(join(root, "opera"));
  writeFileSync(join(root, "opera", "W-300.md"), `---\nid: W-300\ntitle: W-300\nkind: feature\ncollegium: ${collegium}\nstate: greenlit\nspec: briefs/W-300.md\nprobationes: {}\n---\n`);
  mkdirSync(join(root, "briefs"));
  writeFileSync(join(root, "briefs", "W-300.md"), LEDGER_BRIEF);
  writeFileSync(join(root, "ledger.md"), COVERING);
  return root;
}
function sign(root: string, sella: string, body: string, round = 1): { exit: number; stderr: string; written: boolean } {
  const from = join(root, `from-${sella}-${round}.md`);
  writeFileSync(from, body);
  let stderr = "";
  const error = console.error;
  console.error = (...args: unknown[]) => void (stderr += `${args.map(String).join(" ")}\n`);
  const log = console.log;
  console.log = () => {};
  let exit: number;
  try {
    exit = runVerdict(["W-300", "--round", String(round), "--sella", sella, "--outcome", "passed", "--phase", "spec", "--from", from, "--studio", root], { now: NOW }).exitCode;
  } finally {
    [console.error, console.log] = [error, log];
  }
  const path = join(root, "ci", `W-300-spec-${round}.log`);
  const written = existsSync(path);
  if (written) rmSync(path);
  return { exit, stderr, written };
}
const NO = "## Findings\nNo findings\n";
const UI_PROMPT = "Inspect navigation contrast spacing hierarchy responsive behavior keyboard flow and visual rhythm without prescribing a recommendation.\n";
const UI_INPUT = [
  "## Findings",
  "No findings",
  "The navigation relationships remain legible across the complete narrow viewport arrangement.",
  "## Recommendation",
  "The implementation can proceed while preserving the documented hierarchy and interaction rhythm.",
  "Additional original observations cover focus movement responsive density and stable content grouping throughout.",
  "Verdict: passed",
  "",
].join("\n");
/** the ui-lead's UI spec input on the kind: ui opus W-301 (W-338), as verdict.test.ts's b8 records one */
function uiInput(root: string): { exit: number; stderr: string; written: boolean } {
  const from = join(root, "from-ui-lead.md");
  writeFileSync(from, UI_INPUT);
  let stderr = "";
  const error = console.error;
  console.error = (...args: unknown[]) => void (stderr += `${args.map(String).join(" ")}\n`);
  const log = console.log;
  console.log = () => {};
  let exit: number;
  try {
    exit = runVerdict(["W-301", "--round", "1", "--sella", "ui-lead", "--outcome", "passed", "--phase", "spec", "--dispatch-prompt", "ci/dispatch.md", "--from", from, "--studio", root], { now: NOW }).exitCode;
  } finally {
    [console.error, console.log] = [error, log];
  }
  const path = join(root, "ci", "W-301-spec-1.log");
  const written = existsSync(path);
  if (written) rmSync(path);
  return { exit, stderr, written };
}
/** the stderr after an assertion message, or nothing: a message never ends in a bare colon */
const said = (r: { stderr: string }): string => (r.stderr.trim() === "" ? "" : `: ${r.stderr.trim()}`);

test("W-452-b3 behaviour 3: verdict --phase spec owes the promise ledger from the seat its collegium names, as next names it", () => {
  const ops = officina("ops");
  const missing = sign(ops, "ops-lead", NO);
  assert.equal(missing.exit, 2, `ops-lead's signature of an ops opus without a ledger is refused${said(missing)}`);
  assert.match(missing.stderr, /W-300: promise ledger: briefs\/W-300\.md names a CLI verb in code/, "the refusal names the promise ledger");
  assert.equal(missing.written, false, "the refused signature writes no log");
  const covered = sign(ops, "ops-lead", `Promise ledger: ${join(ops, "ledger.md")}\n\n${NO}`);
  assert.equal(covered.exit, 0, `ops-lead's signature with a covering ledger is recorded${said(covered)}`);
  assert.equal(covered.written, true, "the signature is written");
  const architect = sign(ops, "architect", NO);
  assert.equal(architect.exit, 0, `on an ops opus the architect is not the signer and owes no ledger${said(architect)}`);

  const production = sign(officina("production"), "ladder-lead", NO);
  assert.equal(production.exit, 2, "ladder-lead signs a production opus and owes the ledger");
  const engineering = sign(officina("engineering"), "architect", NO);
  assert.equal(engineering.exit, 2, "the architect signs an engineering opus and owes the ledger");

  // D-150 B: a spec log from before since keeps today's signer, the design magister
  const old = officina("ops");
  mkdirSync(join(old, "ci"));
  writeFileSync(join(old, "ci", "W-300-spec-1.log"), specLogText(1, "architect", BEFORE).replaceAll("W-900", "W-300"));
  const oldArchitect = sign(old, "architect", NO, 2);
  assert.equal(oldArchitect.exit, 2, `an opus started before since keeps the architect as its signer${said(oldArchitect)}`);
  const oldOps = sign(old, "ops-lead", NO, 2);
  assert.equal(oldOps.exit, 0, `and ops-lead is not its signer${said(oldOps)}`);

  const today = sign(officina("ops", false), "ops-lead", NO);
  assert.equal(today.exit, 0, "with no spec_seats ops-lead is not a signer (today's routing)");

  const broken = officina("qa");
  const refused = sign(broken, "qa-lead", NO);
  assert.equal(refused.exit, 2, "a collegium spec_seats does not declare is refused");
  assert.match(refused.stderr, /W-300: bisellium\.yml#spec_seats: collegia declares no seats for qa/, "the refusal names the setting");
  assert.equal(refused.written, false, "and writes nothing");
  assert.equal(readFileSync(join(broken, "briefs", "W-300.md"), "utf8"), LEDGER_BRIEF, "the brief is untouched");

  // every spec verdict path reads spec_seats: the ui-lead's UI input on a kind: ui opus is refused, as next holds, when it is malformed
  const ui = officina("design");
  writeFileSync(join(ui, "opera", "W-301.md"), "---\nid: W-301\ntitle: W-301\nkind: ui\ncollegium: design\nstate: greenlit\nspec: briefs/W-301.md\nprobationes: {}\n---\n");
  writeFileSync(join(ui, "briefs", "W-301.md"), "# UI brief\n\nBuild the settled interface.\n");
  mkdirSync(join(ui, "ci"));
  writeFileSync(join(ui, "ci", "dispatch.md"), UI_PROMPT);
  const recordedInput = uiInput(ui);
  assert.equal(recordedInput.exit, 0, `with a readable spec_seats the ui-lead's UI input is recorded${said(recordedInput)}`);
  assert.equal(recordedInput.written, true, "the UI input is written");
  const manifestPath = join(ui, "bisellium.yml");
  writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace(`  since: ${SINCE}`, "  since: soon"));
  const heldInput = uiInput(ui);
  assert.equal(heldInput.exit, 2, `the ui-lead's UI input with a malformed spec_seats is refused${said(heldInput)}`);
  assert.match(heldInput.stderr, /W-301: bisellium\.yml#spec_seats: since must be an ISO instant/, "the UI input's refusal names the setting");
  assert.equal(heldInput.written, false, "and writes no UI input");
});
