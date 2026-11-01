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
