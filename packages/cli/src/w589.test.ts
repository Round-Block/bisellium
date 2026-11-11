/**
 * W-589 rows b1-b2: the generated Roles section names, beside each collegium's magister, the spec signer
 * `bisellium.yml#spec_seats` routes a new opus of that collegium to (read through `readSpecSeats`, the one reader `next` and
 * `verdict --phase spec` share). Rows are `node:test`, named `W-589-b<n> …`; each red is recorded with
 * `--test-name-pattern='^W-589-b<n>\s'`. Tests run from the repo root. The b1 rows render fixture manifests in a temporary
 * directory and read no studio record; the b2 rows read the real officina and the committed CLAUDE.md and AGENTS.md.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderInstructions, runInstructions } from "./instructions.js";

const NOW = new Date("2026-11-11T00:00:00Z");

const HEAD = `bisellium: 1
studio: Fixture
patron: patron
collegia:
  - { id: design, name: Design, magister: architect, lex: leges/design.md }
  - { id: engineering, name: Engineering, magister: eng-lead, lex: leges/engineering.md }
  - { id: qa, name: QA, magister: qa-lead, lex: leges/qa.md }
sellae:
  - { id: architect, collegium: engineering, kind: agent, model: claude-opus-5-5 }
  - { id: design-lead, collegium: design, kind: agent, model: gpt-5.6-sol, harness: codex }
  - { id: eng-lead, collegium: engineering, kind: agent, model: claude-opus-5-5 }
  - { id: qa-lead, collegium: qa, kind: agent, model: claude-opus-5-5 }
  - { id: spec-reviewer, collegium: qa, kind: agent, model: gpt-5.6-sol, harness: codex }
  - { id: ui-spec-reviewer, collegium: qa, kind: agent, model: claude-opus-5-5 }
`;

const SEATS = (design: string): string => `spec_seats:
  since: 2026-11-01T00:00:00.000Z
  collegia:
    design: { signer: ${design}, reviewer: ui-spec-reviewer }
    engineering: { signer: architect, reviewer: spec-reviewer }
`;

/** The rendered Roles section's lines, for CLAUDE.md and AGENTS.md alike (one template). */
function roles(manifest: string): { claude: string[]; agents: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "w589-"));
  try {
    writeFileSync(join(dir, "bisellium.yml"), manifest);
    const r = renderInstructions(dir, { now: NOW });
    const block = (doc: string): string[] => {
      const at = doc.indexOf("## Roles\n\n");
      assert.ok(at >= 0, "the render has a Roles section");
      const body = doc.slice(at + "## Roles\n\n".length);
      return body.slice(0, body.indexOf("\n\n")).split("\n");
    };
    return { claude: block(r.claude), agents: block(r.agents) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("W-589-b1 the design Roles line names design-lead as its spec signer", () => {
  const r = roles(HEAD + SEATS("design-lead"));
  for (const lines of [r.claude, r.agents])
    assert.deepEqual(lines, ["- design (magister: architect; spec signer: design-lead)", "- engineering (magister: eng-lead; spec signer: architect)", "- qa (magister: qa-lead)"], "the design Roles line names design-lead as its spec signer");
});

test("W-589-b1 a collegium spec_seats does not name renders as today", () => {
  const r = roles(HEAD + SEATS("design-lead"));
  for (const lines of [r.claude, r.agents]) assert.equal(lines[2], "- qa (magister: qa-lead)", "a collegium spec_seats does not name renders as today");
});

test("W-589-b1 a studio without spec_seats renders every line as today", () => {
  const r = roles(HEAD);
  for (const lines of [r.claude, r.agents]) assert.deepEqual(lines, ["- design (magister: architect)", "- engineering (magister: eng-lead)", "- qa (magister: qa-lead)"], "a studio without spec_seats renders every line as today");
});

test("W-589-b1 a spec_seats row the routing refuses renders as today", () => {
  // architect is an engineering seat: readSpecSeats refuses it as the design signer, so no signer is named for design.
  const r = roles(HEAD + SEATS("architect"));
  for (const lines of [r.claude, r.agents]) assert.equal(lines[0], "- design (magister: architect)", "a spec_seats row the routing refuses renders as today");
});

test("W-589-b2 the real officina's Roles lines name each spec signer", () => {
  const { claude } = renderInstructions("studio", { now: NOW });
  assert.ok(claude.includes("- design (magister: architect; spec signer: design-lead)\n"), "the real officina's Roles lines name each spec signer: design");
  assert.ok(claude.includes("- engineering (magister: eng-lead; spec signer: architect)\n"), "the real officina's Roles lines name each spec signer: engineering");
});

test("W-589-b2 the committed CLAUDE.md and AGENTS.md are instructions --write output", () => {
  const dir = mkdtempSync(join(tmpdir(), "w589-repo-"));
  try {
    const origLog = console.log;
    let code: number;
    try {
      console.log = () => {};
      code = runInstructions(["--studio", "studio", "--repo", dir, "--write"], { now: NOW }).exitCode;
    } finally {
      console.log = origLog;
    }
    assert.equal(code, 0);
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      const committed = readFileSync(name, "utf8");
      assert.ok(committed.includes("- design (magister: architect; spec signer: design-lead)\n") && committed === readFileSync(join(dir, name), "utf8"), `the committed CLAUDE.md and AGENTS.md are instructions --write output: ${name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
