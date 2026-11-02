import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { drawerDetail, type CardRow } from "../src/lib/board.js";
import { BoardDrawer } from "../src/screens/BoardDrawer.js";
import type { OpusEntry } from "../src/api.js";
import "./support/register-css-stub.mjs";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const phases = ["backlog", "greenlit", "building", "verifying", "review", "done", "halted"];
const declared = [
  { id: "spec", name: "Spec", kind: "agent" },
  { id: "review", name: "A deliberately long next-gate name that remains complete in the drawer", kind: "agent" },
  { id: "patron", name: "Patron call", kind: "human" },
];
const makeOpus = (state: string, probationes: OpusEntry["probationes"], body = ""): OpusEntry => ({
  id: `W-${state}`,
  title: `A deliberately long ${state} title ${"that remains available ".repeat(8)}`,
  body,
  kind: "ui",
  collegium: "design",
  sella: "builder",
  state,
  tokens: 0,
  probationes,
  traditio: undefined,
});
const waitingCard = (opus: OpusEntry): CardRow => ({
  id: opus.id, title: opus.title, state: opus.state, gates: [], needsYou: true, blocked: false,
});

test("W-412-b1 behaviour 1: drawer evidence names revision, gate result and decision record", () => {
  const some = {
    spec: { status: "passed", evidence: { certifies: `tree:${"a".repeat(40)}`, href: "ci/W-1-spec-1.log" } },
    patron: { status: "pending", evidence: { certifies: `tree:${"b".repeat(40)}`, href: "decisions/D-412.md" } },
  };
  const all = Object.fromEntries(declared.map(({ id }, index) => [id, {
    status: "passed",
    evidence: { certifies: `tree:${String(index + 1).repeat(40)}`, href: `ci/W-1-${id}.log` },
  }]));
  const cases = [
    makeOpus(phases[0]!, {}),
    ...phases.slice(1, -1).map((phase) => makeOpus(phase, some)),
    makeOpus(phases.at(-1)!, all),
  ];
  assert.deepEqual(cases.map((opus) => drawerDetail(opus, { probationes: declared }, { petitiones: [] }, [], waitingCard(opus)).state), phases, "every lifecycle phase keeps its native state while evidence is projected");

  const detail = drawerDetail(cases[1]!, { probationes: declared }, { petitiones: [] }, [], waitingCard(cases[1]!));
  assert.deepEqual(detail.waitingEvidence?.[0], {
    gate: "spec",
    label: "Spec",
    status: "passed",
    revision: `tree:${"a".repeat(40)}`,
    record: "ci/W-1-spec-1.log",
  }, "one binding carries the reviewed revision, literal gate result and decision record together");
  const markup = renderToStaticMarkup(React.createElement(BoardDrawer, { detail, onClose: () => undefined }));
  for (const label of ["Reviewed revision", "Gate result", "Decision record"]) assert.match(markup, new RegExp(`>${label}<`), `${label} is explicit in rendered drawer copy`);
  assert.match(markup, /tree:a{40}/, "the complete reviewed source revision is rendered");
  assert.match(markup, /spec · passed/, "the gate id and result are rendered together");
  assert.match(markup, /href="ci\/W-1-spec-1\.log"/, "the decision record stays actionable");
  assert.match(markup, /board-drawer__record-body">No record body\.<\/div>/, "a record with no description keeps its honest fallback");

  const none = drawerDetail(cases[0]!, { probationes: declared }, { petitiones: [] }, [], waitingCard(cases[0]!));
  assert.deepEqual(none.waitingEvidence, [], "zero recorded evidence invents no binding");
  const complete = drawerDetail(cases.at(-1)!, { probationes: declared }, { petitiones: [] }, [], waitingCard(cases.at(-1)!));
  assert.equal(complete.waitingEvidence?.length, declared.length, "all recorded gates retain all decision bindings");
});
