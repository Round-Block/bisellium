/**
 * W-317 rows b1-b2 (studio/briefs/W-317.md): brief.stale. node:test TAP, selected by `--test-name-pattern='^W-317-b<n>\s'`.
 * Every row builds its own officina under the OS tmp dir and reads no studio/ file.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { checkStudio } from "../check.js";
import { initStudio } from "../init.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const ID = "W-900";
const SIGNED = "2026-10-10T00:00:00.000Z";
const LATER = "2026-10-11T00:00:00.000Z";
const NEWER = "2026-10-12T00:00:00.000Z";
const OLD = "Old title of the opus";
const NEW = "New title of the opus, with the scope the Patron added";
const FINDING = [`advise opera/${ID}.md`];

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Amend { at: string; field?: string; superseded: string }
interface World { state?: string; title?: string; amendments?: Amend[]; brief?: string; design?: boolean }
function officina(w: World = {}): string {
  const root = mkdtempSync(join(tmpdir(), "bisellium-w317-"));
  dirs.push(root);
  assert.ok(initStudio(root, { now: NOW }).root);
  if (w.design !== false) {
    const manifest = join(root, "bisellium.yml");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace("collegia:\n", "collegia:\n  - { id: design, name: Design, magister: architect, lex: leges/design.md }\n"));
  }
  const amendments = (w.amendments ?? [{ at: LATER, superseded: OLD }])
    .map((a) => `  - { at: ${a.at}, sella: producer, field: ${a.field ?? "title"}, reason: "r", superseded: ${JSON.stringify(a.superseded)} }\n`)
    .join("");
  writeFileSync(
    join(root, "opera", `${ID}.md`),
    `---\nid: "${ID}"\ntitle: ${JSON.stringify(w.title ?? NEW)}\nkind: "feature"\ncollegium: "production"\nstate: ${w.state ?? "greenlit"}\namendments:\n${amendments}---\n`,
  );
  mkdirSync(join(root, "briefs"), { recursive: true });
  writeFileSync(join(root, "briefs", `${ID}.md`), w.brief ?? `# ${ID} — ${OLD}\n\nStatus: signed.\n`);
  log(root, 1, "architect", "passed", SIGNED);
  return root;
}
function log(root: string, n: number | bigint, sella: string, outcome: string, at: string): void {
  mkdirSync(join(root, "ci"), { recursive: true });
  writeFileSync(join(root, "ci", `${ID}-spec-${n}.log`), `# opus: ${ID}\n# phase: spec\n# round: ${n}\n# sella: ${sella}\n# outcome: ${outcome}\n# at: ${at}\n# brief: briefs/${ID}.md blob:0\n\n## Findings\nNo findings\n`);
}
const stale = (root: string) => checkStudio(root, NOW).findings.filter((f) => f.rule === "brief.stale");
const found = (root: string): string[] => stale(root).map((f) => `${f.level} ${f.where}`);

test("W-317-b1 behaviour 1: an open opus retitled after its newest architect signature is advised stale", () => {
  const root = officina();
  assert.deepEqual(found(root), FINDING, "a greenlit opus retitled after its signature: one advise at its record");
  assert.match(stale(root)[0]!.message, /amended at 2026-10-11T00:00:00\.000Z, after the newest signature ci\/W-900-spec-1\.log \(2026-10-10T00:00:00\.000Z\)/, "the message names the amendment, the signature and their times");
  for (const state of ["building", "verifying", "review"]) assert.deepEqual(found(officina({ state })), FINDING, `${state}: judged`);
  for (const state of ["done", "halted", "backlog"]) assert.deepEqual(found(officina({ state })), [], `${state}: not judged`);
  assert.deepEqual(found(officina({ amendments: [{ at: "2026-10-09T00:00:00.000Z", superseded: OLD }] })), [], "a title amended before the signature is no finding");
  assert.deepEqual(found(officina({ amendments: [{ at: LATER, field: "milestone", superseded: "M1" }] })), [], "another field amended after the signature is no finding");
  const resigned = officina();
  log(resigned, 3, "architect", "passed", NEWER);
  assert.deepEqual(found(resigned), [], "a newer signature after the amendment is no finding");
  const reviewed = officina();
  log(reviewed, 2, "spec-reviewer", "passed", NEWER);
  log(reviewed, 3, "architect", "failed", NEWER);
  assert.deepEqual(found(reviewed), FINDING, "a review and a failed architect log are no signature");
  assert.match(stale(reviewed)[0]!.message, /ci\/W-900-spec-1\.log/, "the newest signature is still round 1");
  const unsigned = officina();
  rmSync(join(unsigned, "ci"), { recursive: true });
  assert.deepEqual(found(unsigned), [], "no spec log: no signature, no finding");
  assert.deepEqual(found(officina({ design: false })), [], "no design collegium: no architect, no finding");
  const huge = officina();
  log(huge, 9007199254740992n, "architect", "passed", SIGNED);
  log(huge, 9007199254740993n, "architect", "passed", NEWER);
  assert.deepEqual(found(huge), [], "rounds above the safe-integer range order exactly: the highest n is the newest signature");
});

test("W-317-b2 behaviour 2: a brief that names the current title, or a title back as signed, is no finding", () => {
  assert.deepEqual(found(officina({ brief: `# ${ID}\n\nRecord title: New title of the\nopus, with the   scope the Patron added\n` })), [], "a brief that names the current title is no finding");
  assert.deepEqual(found(officina({ title: OLD, brief: `# ${ID}\n`, amendments: [{ at: LATER, superseded: OLD }, { at: NEWER, superseded: "Mid" }] })), [], "a title back as signed is no finding");
  assert.deepEqual(found(officina({ brief: `# ${ID} — ${OLD}\n` })), FINDING, "a brief that names only the title as signed is stale");
});

test("W-348-b5 behaviour 5: brief stale uses the configured UI signer, never the design magister or UI reviewer", () => {
  const root = officina();
  const manifest = join(root, "bisellium.yml");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8")
      .replace("sellae:\n", "sellae:\n  - { id: ui-architect, collegium: design, kind: agent, model: gpt-5.6-sol, harness: codex }\n  - { id: ui-spec-reviewer, collegium: qa, kind: agent, model: claude-opus-5-5, harness: claude-code }\n") +
      "ui_spec_signer: ui-architect\nui_spec_reviewer: ui-spec-reviewer\n",
  );
  const record = join(root, "opera", `${ID}.md`);
  writeFileSync(record, readFileSync(record, "utf8").replace('kind: "feature"', 'kind: "ui"'));
  assert.deepEqual(found(root), [], "the design magister's engineering signature is no UI signature");

  log(root, 2, "ui-architect", "passed", SIGNED);
  log(root, 3, "ui-spec-reviewer", "passed", NEWER);
  assert.deepEqual(found(root), FINDING, "the UI signer before the amendment makes the retitled brief stale");
  assert.match(stale(root)[0]!.message, /ci\/W-900-spec-2\.log/, "the message names the UI signature, not the newer review");

  log(root, 4, "ui-architect", "passed", NEWER);
  assert.deepEqual(found(root), [], "a newer UI signature after the amendment clears the finding");

  const broken = officina();
  const brokenManifest = join(broken, "bisellium.yml");
  writeFileSync(brokenManifest, `${readFileSync(brokenManifest, "utf8")}ui_spec_signer: ui-architect\n`);
  const brokenRecord = join(broken, "opera", `${ID}.md`);
  writeFileSync(brokenRecord, readFileSync(brokenRecord, "utf8").replace('kind: "feature"', 'kind: "ui"'));
  assert.deepEqual(found(broken), [`block opera/${ID}.md`], "a malformed UI pairing makes the advisory reader fail closed");
});
