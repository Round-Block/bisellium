/**
 * scripts/status-page.test.mjs — W-152 rows b4-b5 (studio/briefs/W-152.md):
 * the meter's formula and the one page's order. node:test TAP, selected by
 * `--test-name-pattern=W-152-b<n>`. Each row builds its own fixture under the
 * OS tmp dir and writes nothing in studio/ or examples/.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { computeMeter, readHistoryRows, readMilestones, readOfficina, renderStatusPage } from "./status-page.mjs";

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function tmp(tag) {
  const d = mkdtempSync(join(tmpdir(), `bisellium-w152-${tag}-`));
  dirs.push(d);
  return d;
}

test("W-152-b4 behaviour 4: the meter computes the Patron's formula from records", () => {
  const milestones = [
    { id: "M1", title: "One", weight: 50, exit: { opus: "W-1" } },
    { id: "M2", title: "Two", weight: 30, exit: { needs: "x" } },
    { id: "M3", title: "Three", weight: 15, exit: { rule: "lesson.recurrent" } },
    { id: "M4", title: "Four", weight: 5, exit: { opus: "W-9" } },
  ];
  const opera = [
    { id: "W-1", state: "done", milestone: "M1", value: 3 },
    { id: "W-2", state: "backlog", milestone: "M1", value: 1 },
    { id: "W-3", state: "done", milestone: "M2", value: 2 },
    { id: "W-4", state: "done", milestone: "M3", value: 5 },
    { id: "W-6", state: "halted", milestone: "M3", value: 8 },
    { id: "W-7", state: "backlog" },
  ];
  const pct = (meter) => Object.fromEntries(meter.rows.map((r) => [r.id, r.pct]));

  const clear = computeMeter({ milestones, opera, findings: [] });
  const p = pct(clear);
  assert.equal(p.M1, 75, "M1 reads 75 (met, not 100)");
  assert.equal(clear.rows[0].met, true);
  assert.equal(p.M2, 95, "M2 is capped at 95 (raw 100)");
  assert.equal(p.M3, 100, "M3 reads 100 (met; W-6 is not planned)");
  assert.equal(p.M4, 0, "M4 reads 0 (nothing planned)");
  assert.equal(clear.overall, 81, "overall is exactly 81");

  const open = computeMeter({ milestones, opera, findings: [{ rule: "lesson.recurrent" }] });
  assert.equal(pct(open).M3, 95, "M3 is capped at 95 while its rule has a finding");
  assert.equal(open.overall, 80.25, "overall is exactly 80.25");
});

const GATES = "bisellium: 1\nstudio: Fixture\nprobationes:\n  - { id: tests, name: tests }\n";
const ROW1 = '<tr><td>cascade 1</td><td data-x="a&amp;b">first</td></tr>';
const ROW2 = "<tr><td>cascade 2</td><td>second</td></tr>";

function officina(withMilestones) {
  const dir = tmp("b5");
  writeFileSync(join(dir, "bisellium.yml"), GATES);
  mkdirSync(join(dir, "opera"));
  writeFileSync(
    join(dir, "opera", "W-1.md"),
    "---\nid: W-1\ntitle: Done one\nkind: opus\ncollegium: engineering\nstate: done\nmilestone: M1\nvalue: 3\n---\n",
  );
  writeFileSync(
    join(dir, "opera", "W-2.md"),
    "---\nid: W-2\ntitle: Backlog one\nkind: opus\ncollegium: engineering\nstate: backlog\nmilestone: M2\nvalue: 2\n---\n",
  );
  if (withMilestones)
    writeFileSync(
      join(dir, "milestones.yml"),
      'milestones:\n  - { id: M1, title: "Alpha", weight: 60, exit: { opus: W-1 } }\n  - { id: M2, title: "Beta", weight: 40, exit: { needs: x } }\n',
    );
  const history = join(dir, "history.html");
  writeFileSync(history, `<table><thead><tr><th>c</th><th>t</th></tr></thead><tbody>\n${ROW1}\n${ROW2}\n</tbody></table>\n`);
  return { dir, history };
}

const section = (html, heading) => {
  const m = new RegExp(`<h2>${heading}</h2>([\\s\\S]*?)(?=<h2>|$)`).exec(html);
  return m ? m[1] : "";
};

test("W-152-b5 behaviour 5: one page, in the approved order, with the history carried verbatim", () => {
  const { dir, history } = officina(true);
  const render = (d) => {
    const milestones = readMilestones(d);
    const o = readOfficina(d);
    const meter = milestones && computeMeter({ milestones, opera: o.opera, findings: [] });
    return renderStatusPage({ ...o, meter, historyRows: readHistoryRows(history), outPath: join(d, "out.html") });
  };

  const html = render(dir);
  const headings = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ["Completion", "In flight", "Planned", "Backlog", "Cascade history", "Standing constraints"], "the <h2> headings, in order");

  const completion = section(html, "Completion");
  assert.equal([...completion.matchAll(/class="bar"/g)].length, 2, "Completion carries one row (and bar) per milestone");
  assert.match(completion, /Alpha/);
  assert.match(completion, /Beta/);
  assert.match(completion, /\b60(\.0)?\s*%/, "Completion carries the overall %");
  const past = section(html, "Cascade history");
  assert.ok(past.includes(ROW1), "history row 1 appears byte-for-byte");
  assert.ok(past.includes(ROW2), "history row 2 appears byte-for-byte");

  const none = tmp("b5-none");
  writeFileSync(join(none, "bisellium.yml"), GATES);
  const bare = render(none);
  assert.match(section(bare, "Completion"), /No milestone records/);
  assert.doesNotMatch(section(bare, "Completion"), /class="bar"/, "no bar without milestones.yml");

  const noBody = join(dir, "none.html");
  writeFileSync(noBody, "<table></table>\n");
  assert.throws(() => readHistoryRows(noBody), (e) => e instanceof Error && e.message.includes(noBody), "no <tbody> throws, naming the file");
  const twoBody = join(dir, "two.html");
  writeFileSync(twoBody, "<table><tbody></tbody></table><table><tbody></tbody></table>\n");
  assert.throws(() => readHistoryRows(twoBody), (e) => e instanceof Error && e.message.includes(twoBody), "two <tbody> throws, naming the file");
});
