/**
 * W-137 row b5: `check` warns on an overdue retro (`retro.overdue`) and on a lesson with no fix
 * (`lesson.unfixed`), and blocks a malformed `retro` setting as `manifest.shape`. `node:test`, named
 * `W-137-b5 behaviour 5: …`, recorded with `--test-name-pattern=W-137-b5`. Fixtures are temp officinae
 * built with `initStudio`; nothing is written in `studio/` or `examples/`.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { checkStudio, type Finding } from "../check.js";
import { initStudio } from "../init.js";

const NOW = new Date("2026-10-06T14:00:00Z");
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const put = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
function opus(root: string, id: string, state: string, end?: string): void {
  put(root, `opera/${id}.md`, `---\nid: "${id}"\ntitle: "fixture ${id}"\nkind: "opus"\ncollegium: "engineering"\nstate: ${state}\nprobationes: {}\n${end === undefined ? "" : `end: ${end}\n`}---\n`);
}
function fixture(retro: string | undefined = "{ since: 2026-10-06T00:00:00Z }"): string {
  const root = join(mkdtempSync(join(tmpdir(), "bisellium-w137-check-")), "studio");
  made.push(join(root, ".."));
  initStudio(root, { now: NOW });
  put(
    root,
    "bisellium.yml",
    [
      "bisellium: 1",
      "studio: w137",
      "patron: patron",
      "collegia:",
      "  - { id: production, name: Production, magister: producer }",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "sellae:",
      "  - { id: producer, collegium: production, kind: agent }",
      "  - { id: eng-lead, collegium: engineering, kind: agent }",
      "probationes:",
      "  - { id: patron, name: Patron call, kind: human }",
      "wip_limit: 9",
      ...(retro === undefined ? [] : [`retro: ${retro}`]),
      "",
    ].join("\n"),
  );
  return root;
}
const findings = (root: string, rule: string): Finding[] => checkStudio(root, NOW).findings.filter((f) => f.rule === rule);
const lesson = (root: string, id: string, addressedBy?: string): void =>
  put(root, `lessons/${id}.md`, `---\nid: "${id}"\nat: 2026-10-06T10:00:00Z\nclass: "tests×${id}"\nevidence: ["bisellium.yml"]\n${addressedBy === undefined ? "" : `addressed_by: "${addressedBy}"\n`}---\nFixture.\n`);
const filing = (root: string, id: string): void =>
  put(root, `acta/2026-10-06-retro-${id}.md`, `---\nauthor: producer\nkind: decision\ntitle: "Retro ${id}"\nat: 2026-10-06T13:00:00Z\nopus: ${id}\n---\nFiled.\n`);

test("W-137-b5 behaviour 5: check warns on an overdue retro and on a lesson with no fix", () => {
  const root = fixture();
  opus(root, "W-1", "done", "2026-10-06T12:00:00Z");
  opus(root, "W-2", "done");
  opus(root, "W-3", "done", '"soon"');
  opus(root, "W-4", "done", "2026-10-05T12:00:00Z");

  const overdue = findings(root, "retro.overdue");
  assert.deepEqual(
    overdue.map((f) => f.where).sort(),
    ["opera/W-1.md", "opera/W-3.md"],
    `W-1 is overdue, W-2 (no end) and W-4 (before since) are not, W-3 (end "soon") fails closed: ${JSON.stringify(overdue)}`,
  );
  const w1 = overdue.find((f) => f.where === "opera/W-1.md")!;
  assert.equal(w1.level, "advise");
  assert.match(w1.message, /W-1 is done \(2026-10-06T12:00:00Z\) and its retro is not filed: bisellium retro --opus W-1 --from <triage\.json>/);

  filing(root, "W-1");
  assert.deepEqual(findings(root, "retro.overdue").map((f) => f.where), ["opera/W-3.md"], "filing W-1's retro clears W-1");

  lesson(root, "L-1");
  lesson(root, "L-2", "W-1");
  const unfixed = findings(root, "lesson.unfixed");
  assert.deepEqual(unfixed.map((f) => f.where), ["lessons/L-1.md"], "only the lesson with no addressed_by");
  assert.equal(unfixed[0]!.level, "advise");
  assert.match(unfixed[0]!.message, /L-1 names no fix \(addressed_by\)/);

  for (const bad of ['"yes"', "{ since: 2026-10-06T00:00:00Z, extra: 1 }"]) {
    const shape = findings(fixture(bad), "manifest.shape").filter((f) => f.where === "bisellium.yml#retro");
    assert.equal(shape.length, 1, `retro: ${bad} is one manifest.shape finding`);
    assert.equal(shape[0]!.level, "block");
  }
  assert.equal(findings(fixture(undefined), "retro.overdue").length, 0, "with no retro key nothing is owed");
});
