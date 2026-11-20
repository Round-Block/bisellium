/**
 * W-700 (studio/briefs/W-700.md): lessons name their fix and reach master. Rows b1-b5 build temp officinae with
 * `initStudio` under the OS tmp dir (b3 also a temp git repo for `bisellium ci`); row b6 reads the kept texts under
 * studio/ (bisellium.yml and lex production), so this file is a test:record file. Select one row with
 * --test-name-pattern='^W-700-b1\s'.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { openLessons } from "@bisellium/commands/lessons.js";
import { checkStudio, type Finding } from "./check.js";
import { runCi } from "./ci.js";
import { initStudio } from "./init.js";
import { landable } from "./land.js";
import { draftRetro } from "./retro.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-11-21T00:00:00Z");
const made: string[] = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-700-b[1-9] /, "");
  test(name, { timeout: 600_000 }, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}

const put = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
/** A git repo holding an officina at `studio/`; `defaults` is the manifest's defaults line, or none. */
function world(defaults: string | undefined): { repo: string; root: string } {
  const repo = mkdtempSync(join(tmpdir(), "bisellium-w700-"));
  made.push(repo);
  const root = join(repo, "studio");
  initStudio(root, { now: NOW });
  put(
    root,
    "bisellium.yml",
    [
      "bisellium: 1",
      "studio: w700",
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
      ...(defaults === undefined ? [] : [defaults]),
      "",
    ].join("\n"),
  );
  git(repo, ["init", "-q", "-b", "master"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "init"]);
  return { repo, root };
}
function lesson(root: string, id: string, at: string, cls: string, addressedBy?: string, cascade?: number): void {
  put(
    root,
    `lessons/${id}.md`,
    `---\nid: "${id}"\nat: ${at}\nclass: "${cls}"\nevidence: ["bisellium.yml"]\n${cascade === undefined ? "" : `cascade: ${cascade}\n`}${addressedBy === undefined ? "" : `addressed_by: ${JSON.stringify(addressedBy)}\n`}---\nFixture.\n`,
  );
}
const findings = (root: string, rule: string, repo?: string): Finding[] => checkStudio(root, NOW, repo === undefined ? {} : { repo }).findings.filter((f) => f.rule === rule);
const at = (fs: Finding[], where: string): Finding | undefined => fs.find((f) => f.where === where);

row("W-700-b1 land carries a lesson", () => {
  assert.equal(landable("studio/lessons/L-1.md", "studio"), true, "a lesson under studio/lessons/ is a landable record");
  assert.equal(landable("studio/lessons/", "studio"), false, "the directory itself is no record");
  assert.equal(landable("studio/opera/W-1.md", "studio"), true, "an opus record still lands");
  assert.equal(landable("studio/briefs/W-1.md", "studio"), false, "a brief rides its opus branch");
  assert.equal(landable("studio/leges/production.md", "studio"), false, "a lex keeps its real PR");
});

row("W-700-b2 a lesson names its fix from the switch's day on", () => {
  const on = world('defaults: { lesson_fix_required_from: "2026-11-20" }');
  lesson(on.root, "L-1", "2026-11-20T00:00:00Z", "tests×a");
  lesson(on.root, "L-2", "2026-11-19T23:59:59Z", "tests×b");
  const unfixed = findings(on.root, "lesson.unfixed", on.repo);
  assert.equal(at(unfixed, "lessons/L-1.md")?.level, "block", "a lesson at the switch day with no fix blocks");
  assert.match(at(unfixed, "lessons/L-1.md")!.message, /^L-1 names no fix \(addressed_by\): a lesson from 2026-11-20 on \(bisellium\.yml#defaults\.lesson_fix_required_from\) names a fix, or prose:<reason>$/, "the block names the switch");
  assert.equal(at(unfixed, "lessons/L-2.md")?.level, "advise", "a lesson before the switch day only advises");
  assert.deepEqual(findings(on.root, "manifest.defaults", on.repo), [], "a well-formed switch is a known default");

  const off = world(undefined);
  lesson(off.root, "L-2", "2026-01-01T00:00:00Z", "tests×b");
  const absent = at(findings(off.root, "lesson.unfixed"), "lessons/L-2.md");
  assert.equal(absent?.level, "block", "with the switch absent every lesson with no fix blocks");
  assert.match(absent!.message, /bisellium\.yml#defaults\.lesson_fix_required_from is absent/, "the absent block names the key");

  for (const [bad, what] of [['"2026-02-30"', "an impossible day"], ["soon", "a word"], ["20261120", "a number"], ['"2026-11-20T00:00:00Z"', "a timestamp"]] as const) {
    const w = world(`defaults: { lesson_fix_required_from: ${bad} }`);
    lesson(w.root, "L-2", "2026-01-01T00:00:00Z", "tests×b");
    assert.match(findings(w.root, "manifest.defaults").map((f) => `${f.level} ${f.message}`).join("\n"), /^block "lesson_fix_required_from" must be a date YYYY-MM-DD \(got .+\)$/, `a malformed switch, ${what}, blocks as manifest.defaults`);
    assert.match(at(findings(w.root, "lesson.unfixed"), "lessons/L-2.md")?.message ?? "", /is malformed/, `a malformed switch, ${what}, blocks every lesson with no fix`);
  }

  const head = git(on.repo, ["rev-parse", "HEAD"]);
  lesson(on.root, "L-3", "2026-11-20T01:00:00Z", "tests×c", "prose:the lex line is the fix");
  lesson(on.root, "L-4", "2026-11-20T01:00:00Z", "tests×d", "prose:   ");
  lesson(on.root, "L-5", "2026-11-20T01:00:00Z", "tests×e", `closed:${head}`);
  lesson(on.root, "L-6", "2026-11-20T01:00:00Z", "tests×f", `closed:${"0".repeat(40)}`);
  lesson(on.root, "L-7", "2026-11-20T01:00:00Z", "tests×g", "closed:XYZ");
  const claims = findings(on.root, "lesson.addressed_by", on.repo);
  const named = findings(on.root, "lesson.unfixed", on.repo).map((f) => f.where);
  for (const id of ["L-3", "L-5"]) {
    assert.equal(at(claims, `lessons/${id}.md`), undefined, `${id}'s disposition is accepted`);
    assert.ok(!named.includes(`lessons/${id}.md`), `${id} names its fix`);
  }
  assert.match(at(claims, "lessons/L-4.md")?.message ?? "", /gives no reason after prose:/, "prose: with no reason blocks");
  assert.match(at(claims, "lessons/L-6.md")?.message ?? "", /names no commit in HEAD's history/, "closed: on a commit outside HEAD's history blocks");
  assert.match(at(claims, "lessons/L-7.md")?.message ?? "", /closed: takes a commit sha, 7 to 40 lower-case hex digits/, "closed: on no sha blocks");
  assert.equal(at(findings(on.root, "lesson.addressed_by"), "lessons/L-6.md"), undefined, "without --repo a closed: sha is checked for shape only");

  lesson(on.root, "L-8", "2026-11-20T01:00:00Z", "tests×r", "prose:kept as prose", 1);
  lesson(on.root, "L-9", "2026-11-20T01:00:00Z", "tests×r", undefined, 2);
  assert.match(findings(on.root, "lesson.recurrent", on.repo).map((f) => f.message).join("\n"), /class "tests×r" recurs/, "a prose disposition does not quiet a recurring class");
  lesson(on.root, "L-9", "2026-11-20T01:00:00Z", "tests×r", `closed:${head}`, 2);
  assert.doesNotMatch(findings(on.root, "lesson.recurrent", on.repo).map((f) => f.message).join("\n"), /class "tests×r" recurs/, "a closed: commit quiets a recurring class");
});

row("W-700-b3 an untracked record is unlanded: check advises, ci refuses", async () => {
  const w = world(undefined);
  put(w.repo, "ci-marker.mjs", 'import { appendFileSync } from "node:fs";\nappendFileSync("order.log", `${process.argv[2]}\\n`);\n');
  const scripts = Object.fromEntries(["audit", "typecheck", "lint", "format:check", "test", "check"].map((s) => [s, `node ci-marker.mjs ${s}`]));
  put(w.repo, "package.json", JSON.stringify({ name: "w700-ci", private: true, scripts }, null, 2));
  put(w.repo, ".gitignore", "order.log\n");
  git(w.repo, ["add", "-A"]);
  git(w.repo, ["commit", "-q", "-m", "ci fixture"]);
  lesson(w.root, "L-9", "2026-11-20T01:00:00Z", "tests×u", "prose:fixture");
  put(w.root, "decisions/D-9.md", "---\nid: D-9\n---\n");
  put(w.root, "acta/note.md", "note\n");
  put(w.root, "ci/W-9-spec-1.log", "a spec log rides its branch\n");
  put(w.root, "ci/W-9-ui-prompt-1.md", "a ui prompt rides its branch\n");
  put(w.root, "ci/W-9-tests-abc.log", "a gate log\n");
  put(w.root, "briefs/W-9.md", "a brief rides its branch\n");

  const unlanded = findings(w.root, "records.unlanded", w.repo);
  assert.equal(at(unlanded, "lessons/L-9.md")?.level, "advise", "an untracked lesson is a records.unlanded advisory");
  assert.deepEqual(unlanded.map((f) => f.where).sort(), ["acta/note.md", "ci/W-9-tests-abc.log", "decisions/D-9.md", "lessons/L-9.md"], "lessons, decisions, acta and ci are listed; a spec log, a ui prompt and a brief are not");
  assert.match(at(unlanded, "lessons/L-9.md")!.message, /studio\/lessons\/L-9\.md is not tracked by git: land it/, "the advisory names the land");
  assert.deepEqual(findings(w.root, "records.unlanded"), [], "without --repo nothing is listed");

  let err = "";
  const write = console.error;
  console.error = (m?: unknown) => {
    err += `${String(m)}\n`;
  };
  let refused: number;
  try {
    refused = (await runCi(["--repo", w.repo])).exitCode;
  } finally {
    console.error = write;
  }
  assert.equal(existsSync(join(w.repo, "order.log")), false, "ci runs no step while a record is unlanded");
  assert.equal(refused, 1, "ci exits 1");
  assert.match(err, /records\.unlanded: 4 record\(s\) git does not track/, "ci names the count");
  assert.match(err, /studio\/lessons\/L-9\.md/, "ci names the lesson");

  git(w.repo, ["add", "-A"]);
  git(w.repo, ["commit", "-q", "-m", "land"]);
  console.error = () => {};
  let ran: number;
  try {
    ran = (await runCi(["--repo", w.repo])).exitCode;
  } finally {
    console.error = write;
  }
  assert.equal(ran, 0, "with every record tracked ci runs its steps");
  assert.ok(existsSync(join(w.repo, "order.log")), "the steps ran");
});

row("W-700-b4 retro writes the finding's text into the lesson and refuses a finding with none", () => {
  const w = world(undefined);
  const where = "the row asserted one side\nof the bound only";
  const draft = draftRetro(w.root, 3, { verifierIssues: 0, reviewFindings: [{ class: "tests×one-sided", where, evidence: ["bisellium.yml"] }, { class: "tests×one-sided", where: "a second finding", evidence: ["bisellium.yml"] }], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0 }, NOW);
  const path = draft.lessons[0]?.path ?? "";
  const text = readFileSync(join(w.root, path), "utf8");
  assert.match(text, /^- the row asserted one side of the bound only$/m, "the filed lesson carries the finding's text");
  assert.match(text, /^- a second finding$/m, "each finding of the class is a line");
  assert.match(text, /^Filed by `bisellium retro --cascade 3`\. 2 finding\(s\) in this cascade\.$/m, "the filing line stays");
  // a finding with no text: draftRetro refuses the whole draft before its first write
  const files = (): string[] => readdirSync(w.root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)).sort();
  const before = files();
  const cases: [string, unknown][] = [
    ["an absent where", undefined],
    ["a non-string where", 42],
    ["a non-string where (an object)", { text: "x" }],
    ["a blank where", " \n\t\u0007 "],
  ];
  for (const [label, where] of cases) {
    const finding = { class: "tests×no-text", evidence: ["bisellium.yml"], ...(where === undefined ? {} : { where }) } as unknown as { class: string; where: string; evidence: string[] };
    const input = { verifierIssues: 0, reviewFindings: [{ class: "tests×good", where: "a real finding", evidence: ["bisellium.yml"] }, finding], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0 };
    assert.throws(() => draftRetro(w.root, 4, input, NOW), /tests×no-text.*where/, `${label} is refused`);
    assert.deepEqual(files(), before, `${label} writes nothing: no lesson file, no acta entry`);
  }
});

