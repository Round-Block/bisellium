/**
 * W-472 rows (studio/briefs/W-472.md): short opus titles. A title is at most 8 words; the long text is the record's
 * description, its body below the front matter, which `new --description` writes and the served API carries to the
 * Board drawer. node:test TAP, selected by `--test-name-pattern='^W-472-b<n>\s'`. Every row builds its own officina
 * under the OS tmp dir and drives the verbs in process, their console output captured; nothing here reads or writes
 * `studio/` or `examples/sample-studio` (row b2 serves a copy of the sample officina).
 */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { checkStudio } from "./check.js";
import { runAmend } from "./lifecycle.js";
import { newItem, runNew } from "./new.js";
import { runRetro } from "./retro.js";
import { runServe } from "./serve.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-10-30T12:00:00.000Z");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A fresh officina: three collegia, their magistri, a Patron gate; no opus yet. */
function officina(): string {
  const root = join(mkdtempSync(join(tmpdir(), "w472-")), "studio");
  dirs.push(dirname(root));
  for (const d of ["opera", "ci", "decisions", "acta", "lessons"]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(
    join(root, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: w472",
      "patron: patron",
      "collegia:",
      "  - { id: production, name: Production, magister: producer }",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: producer, collegium: production, kind: agent }",
      "  - { id: eng-lead, collegium: engineering, kind: agent }",
      "  - { id: qa-lead, collegium: qa, kind: agent }",
      "probationes:",
      "  - { id: patron, name: Patron call, kind: human }",
      "wip_limit: 4",
      "retro: { since: 2026-10-06T00:00:00Z, high_greenlit_by: D-1 }",
      "",
    ].join("\n"),
  );
  return root;
}
const put = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const opus = (root: string, id: string, title: string, state: string, extra = ""): void =>
  put(root, `opera/${id}.md`, `---\nid: "${id}"\ntitle: ${JSON.stringify(title)}\nkind: "task"\ncollegium: "engineering"\nstate: ${state}\nprobationes: {}\n${extra}---\n`);

interface Ran {
  code: number;
  out: string;
  err: string;
}
/** Run a verb in process with its console captured. */
function quiet(fn: () => { exitCode: number }): Ran {
  const out: string[] = [];
  const err: string[] = [];
  const [log0, err0, warn0] = [console.log, console.error, console.warn];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  console.warn = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    return { code: fn().exitCode, out: out.join("\n"), err: err.join("\n") };
  } finally {
    [console.log, console.error, console.warn] = [log0, err0, warn0];
  }
}
/** Every file under the officina with its bytes, so "writes nothing" is a byte comparison. */
function snapshot(root: string, dir = root): string {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => (e.isDirectory() ? `${e.name}/\n${snapshot(root, join(dir, e.name))}` : `${e.name}\0${readFileSync(join(dir, e.name), "utf8")}`))
    .join("\n");
}
const newArgs = (root: string, title: string, ...more: string[]): string[] => ["--kind", "task", "--collegium", "engineering", "--title", title, ...more, root];
/** Nine words: */
const NINE = "short task titles keep the Board cards readable today";
/** Eight words and two tokens that are no word, a lone dash and a lone bracket: */
const EIGHT = "short task titles — keep the Board ( cards readable";

test("W-472-b1 behaviour 1: every writer that files an opus refuses a title over 8 words", () => {
  const root = officina();
  const before = snapshot(root);
  const cli = quiet(() => runNew(newArgs(root, NINE)));
  assert.equal(cli.code, 1, `new refuses a 9-word title: exit ${cli.code} ${cli.out} ${cli.err}`);
  assert.match(cli.err, /^opus\.title\.words: title has 9 words, at most 8; put the rest in the description$/m, "new names the cap");
  assert.equal(snapshot(root), before, "new writes nothing for a 9-word title");

  const direct = newItem(root, { kind: "task", collegium: "engineering", title: NINE });
  assert.equal(direct.ok, false, "newItem refuses a 9-word title");
  assert.equal(direct.message, "opus.title.words: title has 9 words, at most 8; put the rest in the description", "newItem names the cap");
  assert.equal(snapshot(root), before, "newItem writes nothing for a 9-word title");

  const filed = quiet(() => runNew(newArgs(root, EIGHT)));
  assert.equal(filed.code, 0, `an 8-word title with a lone dash and bracket is filed: ${filed.err}`);
  assert.match(readFileSync(join(root, "opera", `${filed.out.trim()}.md`), "utf8"), new RegExp(`^title: ${JSON.stringify(EIGHT).replace(/[()]/g, "\\$&")}$`, "m"), "the 8-word title is written as given");

  // retro --opus files its fix opera through newItem; its triage pre-check refuses a long fix title before any write
  const r = officina();
  put(r, "decisions/D-1.md", '---\nid: "D-1"\ntitle: "Patron ruling"\nat: 2026-10-06T06:00:00Z\nprovenance: stated\nby: patron\nkill_when: "never"\n---\nRuled.\n');
  opus(r, "W-1", "fixture", "done", "start: 2026-10-06T10:00:00Z\nend: 2026-10-06T12:00:00Z\n");
  const review = (n: number, body: string): string =>
    [`# opus: W-1`, "# phase: build", `# round: ${n}`, "# sella: qa-lead", `# outcome: ${n === 1 ? "failed" : "passed"}`, "# at: 2026-10-06T11:00:00Z", "", "## Findings", body, "", "## Verdict", n === 1 ? "VERDICT: FAIL" : "VERDICT: PASS", ""].join("\n");
  put(r, "ci/W-1-review-1.log", review(1, "1. blocking — a.ts:1 first finding\n2. advisory — b.ts:2 second finding"));
  put(r, "ci/W-1-review-2.log", review(2, "No findings"));
  put(r, "ci/reds/W-1/01.log", "# behaviour: 1\n# exit: 1\n\nnot ok 1 - fixture\n");
  const triage = (title: string): string => {
    const from = join(dirname(r), `triage-${title.length}.json`);
    const fix = { title, collegium: "engineering" };
    writeFileSync(from, JSON.stringify({ findings: [1, 2].map((n) => ({ log: "ci/W-1-review-1.log", n, class: "tests×x", fix })) }));
    return from;
  };
  const retroBefore = snapshot(r);
  const long = quiet(() => runRetro(["--opus", "W-1", "--from", triage(NINE), "--studio", r, "--now", "2026-10-06T14:00:00Z"]));
  assert.equal(long.code, 2, `retro refuses a 9-word fix title: exit ${long.code} ${long.out} ${long.err}`);
  assert.equal(long.err, 'triage: fix of "tests×x": title has 9 words, at most 8; put the rest in the description', "retro names the cap");
  assert.equal(snapshot(r), retroBefore, "retro writes nothing for a 9-word fix title");
  const short = quiet(() => runRetro(["--opus", "W-1", "--from", triage("add the x row"), "--studio", r, "--now", "2026-10-06T14:00:00Z"]));
  assert.equal(short.code, 0, `retro files a short fix title: ${short.err}`);
});
