/**
 * packages/cli/src/rules/process.test.ts — process.tdd rule: a commit
 * that changes source code without a corresponding test change is an
 * advisory. Mostly pure-function tests (no git, no temp dirs); behaviour 22
 * is the exception — it drives checkProcess's real execSync git-diff path
 * against a non-git directory to prove the catch branch now reports
 * "process.history" instead of swallowing the failure (the CI shallow-clone
 * bug this rule exists to surface).
 */

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkStudio } from "../check.js";
import { checkProcess, tddViolation, checkpointStale, sameSellaBuiltAndReviewed, reviewTierAdvisory } from "./process.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

// behaviour 1: source change with no test change is a violation
{
  const files = ["apps/web/src/screens/Officina.tsx", "apps/web/src/components/w025.css"];
  check(1, "source-only commit is a violation", tddViolation(files) === true, String(tddViolation(files)));
}

// behaviour 2: source change with a test change is not a violation
{
  const files = ["apps/web/src/screens/Officina.tsx", "apps/web/test/inboxview.test.ts"];
  check(2, "source + test commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 3: test-only change is not a violation
{
  const files = ["apps/web/test/inboxview.test.ts", "apps/web/src/lib/posture.test.ts"];
  check(3, "test-only commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 4: non-code changes (docs, config, css-only) are not violations
{
  const files = ["docs/SESSION-HANDOFF.md", "package.json", "README.md"];
  check(4, "docs/config-only commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 5: .test.ts inline in src/ counts as a test
{
  const files = ["packages/cli/src/check.ts", "packages/cli/src/check.test.ts"];
  check(5, "inline .test.ts counts as test coverage", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 6: empty file list is not a violation
{
  check(6, "empty commit is not a violation", tddViolation([]) === false, String(tddViolation([])));
}

// behaviour 7: css-only changes are not violations (styling, not logic)
{
  const files = ["apps/web/src/components/w025.css"];
  check(7, "css-only commit is not a violation", tddViolation(files) === false, String(tddViolation(files)));
}

// behaviour 8: opera changed without handoff is stale
{
  const files = ["studio/opera/W-026.md", "packages/cli/src/branch.ts"];
  check(8, "opera changed without handoff is stale", checkpointStale(files) === true, String(checkpointStale(files)));
}

// behaviour 9: opera and handoff both changed is not stale
{
  const files = ["studio/opera/W-026.md", "docs/SESSION-HANDOFF.md", "packages/cli/src/branch.ts"];
  check(9, "opera + handoff is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 10: only handoff changed is not stale
{
  const files = ["docs/SESSION-HANDOFF.md"];
  check(10, "handoff-only is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 11: docs-only commit (no opera) is not stale
{
  const files = ["docs/ARCHITECTURE.md", "README.md"];
  check(11, "docs-only is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 12: empty file list is not stale
{
  check(12, "empty is not stale", checkpointStale([]) === false, String(checkpointStale([])));
}

// behaviour 13: progress page counts as checkpoint update
{
  const files = ["studio/opera/W-026.md", "docs/design/dossier/progress-body.html"];
  check(13, "opera + progress page is not stale", checkpointStale(files) === false, String(checkpointStale(files)));
}

// behaviour 14: same sella on spec and review gates fires
{
  const probationes = { spec: { sella: "sonnet-5", status: "passed" }, review: { sella: "sonnet-5", status: "passed" } };
  check(14, "same sella on spec and review fires", sameSellaBuiltAndReviewed(probationes) === true, String(sameSellaBuiltAndReviewed(probationes)));
}

// behaviour 15: different sellae on spec and review does not fire
{
  const probationes = { spec: { sella: "sonnet-5", status: "passed" }, review: { sella: "opus-4-6", status: "passed" } };
  check(15, "different sellae does not fire", sameSellaBuiltAndReviewed(probationes) === false, String(sameSellaBuiltAndReviewed(probationes)));
}

// behaviour 16: only one gate recorded does not fire
{
  const probationes = { spec: { sella: "sonnet-5", status: "passed" } };
  check(16, "only one gate recorded does not fire", sameSellaBuiltAndReviewed(probationes) === false, String(sameSellaBuiltAndReviewed(probationes)));
}

// behaviour 17: no probationes does not fire
{
  check(17, "no probationes does not fire", sameSellaBuiltAndReviewed(undefined) === false, String(sameSellaBuiltAndReviewed(undefined)));
}

// behaviour 18: review gate recorded with an opus-tier model is silent
{
  const probationes = { review: { sella: "eng-lead", status: "passed", model: "claude-opus-5" } };
  const result = reviewTierAdvisory(probationes);
  check(18, "opus-tier recorded model is silent", result === undefined, String(result));
}

// behaviour 19: review gate recorded with a non-opus-tier model advises
{
  const probationes = { review: { sella: "qa-lead", status: "passed", model: "claude-sonnet-5" } };
  const result = reviewTierAdvisory(probationes);
  check(19, "sonnet-tier recorded model advises", result === 'review sella "qa-lead" ran on claude-sonnet-5, not an opus-tier model', String(result));
}

// behaviour 20: no review gate at all is silent
{
  const probationes = { spec: { sella: "guest", status: "passed" } };
  const result = reviewTierAdvisory(probationes);
  check(20, "no review gate is silent", result === undefined, String(result));
}

// behaviour 21: review gate recorded with no `model:` field at all (every
// gate written before this field existed) ADVISES rather than staying
// silent — the whole point of this rule is to stop D-014 violations from
// going unnoticed, and a silent default here would keep every pre-existing
// gate invisible until individually re-recorded.
{
  const probationes = { review: { sella: "eng-lead", status: "passed" } };
  const result = reviewTierAdvisory(probationes);
  check(
    21,
    "review gate with no recorded model advises",
    result === 'review gate (sella "eng-lead") has no recorded model — re-record with "bisellium review --model <id>" to verify tier',
    String(result),
  );
}

// behaviour 22: repo given but has no git history at all (same symptom as
// CI's shallow `fetch-depth: 1` checkouts, where `git diff HEAD~1 HEAD`
// hits an ambiguous-argument fatal) — checkProcess must report
// process.history instead of silently skipping process.tdd/checkpoint.
{
  const officina = mkdtempSync(join(tmpdir(), "bisellium-process-history-officina-"));
  const repo = mkdtempSync(join(tmpdir(), "bisellium-process-history-repo-"));
  writeFileSync(join(officina, "bisellium.yml"), "id: test\n");
  const findings = checkProcess(officina, { now: new Date(), repo });
  const finding = findings.find((f) => f.rule === "process.history");
  check(
    22,
    "git history unavailable emits process.history advisory",
    finding?.level === "advise" && finding.where === "HEAD" && finding.message.includes("process.tdd and process.checkpoint not evaluated"),
    JSON.stringify(finding),
  );
  rmSync(officina, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
}

// behaviour 23 (W-186): `check` blocks a stale, relative, oversized or unreadable
// docs/SESSION-HANDOFF.md in the repository's own `studio/` only. Each row is the
// exact [rule, where] list of the `process.handoff.*` findings checkStudio emits,
// on a scratch <repo>/studio built from the sample studio's manifest (no `retro`
// setting, so owedRetros reads no opera).
const HANDOFF = "docs/SESSION-HANDOFF.md";
const SAMPLE_MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "examples", "sample-studio", "bisellium.yml");
const W186_NOW = new Date("2026-10-10T12:00:00Z");
const record = (id: string, state: string | undefined, end?: string): string =>
  `---\nid: "${id}"\ntitle: "x"\nkind: "feature"\ncollegium: "engineering"\n${state === undefined ? "" : `state: ${state}\n`}${end === undefined ? "" : `end: ${end}\n`}---\n`;
/** W-1 is done (ended 2026-10-09), W-2 is halted, W-3 and W-5 are greenlit, W-4 is backlog. */
const baseRecords = (): Record<string, string> => ({
  "W-1": record("W-1", "done", "2026-10-09T12:00:00Z"),
  "W-2": record("W-2", "halted"),
  "W-3": record("W-3", "greenlit"),
  "W-4": record("W-4", "backlog"),
  "W-5": record("W-5", "greenlit"),
});
interface HandoffParts {
  resume?: string;
  next?: string[];
  queue?: string[];
  extra?: string[];
}
/** A handoff shaped like today's: a Resume section with a Next field, then the Queue. */
function handoff(p: HandoffParts = {}): string {
  const lines = [
    "# Session handoff",
    "",
    p.resume ?? "## Resume point (2026-10-10)",
    "",
    ...(p.next ?? ["- **Next, in order:** W-3 first,", "  then W-5."]),
    ...(p.extra ?? []),
    "",
    "## Queue",
    "",
    ...(p.queue ?? ["1. W-3 - one.", "2. W-5 - two."]),
  ];
  return lines.join("\n");
}
const at = (text: string, needle: string): string => {
  const n = text.split("\n").findIndex((l) => l.includes(needle));
  assert.notEqual(n, -1, `the fixture has a line with ${needle}`);
  return `${HANDOFF}:${n + 1}`;
};
const scratches: string[] = [];
/** Run checkStudio over a scratch repo and return the process.handoff.* findings as [rule, where]. */
function handoffFindings(records: Record<string, string>, text: string | null, o: { studioDir?: string; repo?: boolean; setup?: (repo: string, studio: string) => void } = {}): string[][] {
  const repo = mkdtempSync(join(tmpdir(), "bisellium-w186-"));
  scratches.push(repo);
  const studio = join(repo, o.studioDir ?? "studio");
  mkdirSync(join(studio, "opera"), { recursive: true });
  copyFileSync(SAMPLE_MANIFEST, join(studio, "bisellium.yml"));
  for (const [id, body] of Object.entries(records)) writeFileSync(join(studio, "opera", `${id}.md`), body);
  if (text !== null) {
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, HANDOFF), text);
  }
  o.setup?.(repo, studio);
  const result = checkStudio(studio, W186_NOW, o.repo === false ? {} : { repo });
  return result.findings.filter((f) => f.rule.startsWith("process.handoff.")).map((f) => [f.rule, f.where]);
}

test("W-186-b1 behaviour 23: check blocks a stale, relative, oversized or unreadable handoff in the repository's own studio only", () => {
  const base = baseRecords();
  // a handoff shaped like today's, naming a queued greenlit opus in its Next field
  assert.deepEqual(handoffFindings(base, handoff()), []);

  // the Queue names a done opus, then a halted one; a greenlit opus is never named
  let text = handoff({ queue: ["1. W-3 - one.", "2. W-5 - two.", "3. W-1 - gone."] });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.queue", at(text, "W-1 - gone")]]);
  text = handoff({ queue: ["1. W-3 - one.", "2. W-5 - two.", "3. W-2 - stopped."] });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.queue", at(text, "W-2 - stopped")]]);
  assert.deepEqual(handoffFindings({ ...base, "W-6": record("W-6", "greenlit") }, handoff()), [["process.handoff.queue", HANDOFF]]);

  // an id with no record is input, in the Queue, in a Next field and in a status claim
  text = handoff({ queue: ["1. W-3 - one.", "2. W-5 - two.", "3. W-77 - nobody."] });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.input", at(text, "W-77")]]);
  text = handoff({ next: ["- **Next:** W-3, W-78."] });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.input", at(text, "W-78")]]);
  text = handoff({ extra: ["- **W-79** is building."] });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.input", at(text, "W-79")]]);

  // Next fields, under both labels: a done id on a continuation line, and a backlog id the Queue does not name
  for (const label of ["**Next:**", "**Next, in order:**"]) {
    text = handoff({ next: [`- ${label} W-3 first,`, "  then W-1."] });
    assert.deepEqual(handoffFindings(base, text), [["process.handoff.resume", at(text, "then W-1")]], `${label} done id`);
    text = handoff({ next: [`- ${label} W-3 first,`, "  then W-4,", "  then W-5."] });
    assert.deepEqual(handoffFindings(base, text), [["process.handoff.resume", at(text, "then W-4")]], `${label} backlog id`);
  }
  // a claim that a done opus is building
  text = handoff({ extra: ["- **W-1** is building."] });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.resume", at(text, "**W-1**")]]);

  // Resume dates against the newest done end (UTC)
  text = handoff({ resume: "## Resume point (2026-10-08)" });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.resume", at(text, "## Resume point")]], "one day before the newest done end");
  assert.deepEqual(handoffFindings(base, handoff({ resume: "## Resume point (2026-10-09)" })), [], "the same UTC date passes");
  assert.deepEqual(handoffFindings({ ...base, "W-1": record("W-1", "done") }, handoff({ resume: "## Resume point (2000-01-01)" })), [], "no done end: the comparison is skipped");

  // headings
  const noQueue = ["# Session handoff", "", "## Resume point (2026-10-10)", "", "- **Next:** W-3."].join("\n");
  assert.deepEqual(handoffFindings(base, noQueue), [["process.handoff.input", HANDOFF]], "no Queue heading");
  const twoQueues = `${handoff()}\n\n## Queue\n\n- again`;
  assert.deepEqual(handoffFindings(base, twoQueues), [["process.handoff.input", `${HANDOFF}:${twoQueues.split("\n").lastIndexOf("## Queue") + 1}`]], "a duplicate Queue heading");
  text = handoff({ resume: "## Resume point" });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.input", at(text, "## Resume point")]], "a Resume heading without a date");
  text = handoff({ resume: "## Resume point (2026-02-30)" });
  assert.deepEqual(handoffFindings(base, text), [["process.handoff.input", at(text, "## Resume point")]], "an impossible date");

  // the three relative phrases, and the 100-line cap
  for (const phrase of ["see this one", "as in this PR", "the list (above)"]) {
    text = handoff({ extra: [`- ${phrase}.`] });
    assert.deepEqual(handoffFindings(base, text), [["process.handoff.reference", at(text, phrase)]], phrase);
  }
  const padded = (n: number): string => {
    const head = handoff().split("\n");
    return [...head, ...Array.from({ length: n - head.length }, (_, i) => `- pad ${i}`)].join("\n");
  };
  assert.equal(padded(100).split("\n").length, 100);
  assert.deepEqual(handoffFindings(base, padded(100)), [], "100 split lines pass");
  assert.deepEqual(handoffFindings(base, padded(101)), [["process.handoff.lines", HANDOFF]], "101 split lines block");

  // unreadable inputs, each one input
  assert.deepEqual(handoffFindings(base, null, { setup: (repo) => mkdirSync(join(repo, HANDOFF), { recursive: true }) }), [["process.handoff.input", HANDOFF]], "a directory at the handoff path");
  const opera = (repo: string): void => {
    rmSync(join(repo, "studio", "opera"), { recursive: true, force: true });
    writeFileSync(join(repo, "studio", "opera"), "not a directory\n");
  };
  assert.deepEqual(handoffFindings(base, handoff(), { setup: opera }), [["process.handoff.input", HANDOFF]], "a regular file at studio/opera");
  const broken = { ...base, "W-8": "---\nid: [unclosed\n---\n" };
  assert.deepEqual(handoffFindings(broken, handoff()), [["process.handoff.input", HANDOFF]], "a record that does not parse");
  const typo = { ...base, "W-8": record("W-8", "greenlitt") };
  const stateless = { ...base, "W-8": record("W-8", undefined) };
  for (const [name, records] of [["greenlitt", typo], ["no state", stateless]] as const) {
    assert.deepEqual(handoffFindings(records, handoff()), [["process.handoff.input", HANDOFF]], `${name}, handoff present`);
    assert.deepEqual(handoffFindings(records, null), [["process.handoff.input", HANDOFF]], `${name}, handoff absent`);
  }

  // an absent handoff with valid records is none; other officinae and a run with no repo are outside the rule
  assert.deepEqual(handoffFindings(base, null), []);
  const stale = handoff({ queue: ["1. W-3 - one.", "2. W-5 - two.", "3. W-1 - gone."] });
  assert.deepEqual(handoffFindings(base, null, { studioDir: "other" }), []);
  assert.deepEqual(handoffFindings(base, stale, { studioDir: "other" }), []);
  assert.deepEqual(handoffFindings(base, stale, { repo: false }), []);
  assert.equal(handoffFindings(base, stale).length, 1, "control: the same handoff blocks in <repo>/studio");
  for (const d of scratches.splice(0)) rmSync(d, { recursive: true, force: true });
});

process.exitCode = failed ? 1 : 0;
