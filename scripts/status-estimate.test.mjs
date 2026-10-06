/**
 * scripts/status-estimate.test.mjs — W-153 row b4 (studio/briefs/W-153.md): the
 * Status page prints the estimate on one line under the overall %. node:test
 * TAP, selected by `--test-name-pattern=W-153-b4`. The fixture lives under the
 * OS tmp dir; nothing is written in studio/ or examples/.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { computeMeter, readMilestones, readOfficina, renderStatusPage } from "./status-page.mjs";

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GATES = "bisellium: 1\nstudio: Fixture\nprobationes:\n  - { id: tests, name: tests }\n";
const LINE = "Estimated finish: in about 3 days (2 to 5 days) <b>& more</b>";

function officina(withMilestones) {
  const dir = mkdtempSync(join(tmpdir(), "bisellium-w153-b4-"));
  dirs.push(dir);
  writeFileSync(join(dir, "bisellium.yml"), GATES);
  mkdirSync(join(dir, "opera"));
  writeFileSync(
    join(dir, "opera", "W-1.md"),
    "---\nid: W-1\ntitle: Done one\nkind: opus\ncollegium: engineering\nstate: done\nmilestone: M1\nvalue: 3\n---\n",
  );
  if (withMilestones)
    writeFileSync(join(dir, "milestones.yml"), 'milestones:\n  - { id: M1, title: "Alpha", weight: 100, exit: { needs: x } }\n');
  return dir;
}

const section = (html, heading) => new RegExp(`<h2>${heading}</h2>([\\s\\S]*?)(?=<h2>|$)`).exec(html)?.[1] ?? "";

test("W-153-b4 behaviour 4: the Status page prints the estimate on one line under the overall %", () => {
  const dir = officina(true);
  const o = readOfficina(dir);
  const meter = computeMeter({ milestones: readMilestones(dir), opera: o.opera, findings: [] });
  const estimate = { kind: "estimate", remaining: 1, weekly: [1, 1, 1], bulk: [], line: LINE };
  const completion = section(renderStatusPage({ ...o, meter, estimate, historyRows: "" }), "Completion");
  const escaped = "Estimated finish: in about 3 days (2 to 5 days) &lt;b&gt;&amp; more&lt;/b&gt;";
  assert.match(
    completion,
    new RegExp(`<p><strong>Overall [^<]*</strong></p>\\s*<p class="estimate">${escaped.replace(/[()]/g, "\\$&")}</p>`),
    "estimate after Overall",
  );

  const bare = officina(false);
  const none = section(renderStatusPage({ ...readOfficina(bare), meter: undefined, estimate: undefined, historyRows: "" }), "Completion");
  assert.match(none, /No milestone records/);
  assert.doesNotMatch(none, /class="estimate"/);
});
