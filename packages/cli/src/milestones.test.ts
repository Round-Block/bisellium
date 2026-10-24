/**
 * W-152 rows b1-b3 (studio/briefs/W-152.md): `milestones.shape`,
 * `opus.milestone` and `amend --milestone --value`. node:test TAP, one test()
 * per behaviour, selected by `--test-name-pattern=W-152-b<n>`. Every row builds
 * its own fixture under the OS tmp dir and writes nothing in studio/ or
 * examples/.
 * W-404 rows b1 and b2 (studio/briefs/W-404.md): `bisellium milestones` and its `next --all` line report progress by
 * exits, not filings; selected by `--test-name-pattern='^W-404-b<k>\s'`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { checkStudio, type Finding } from "./check.js";
import { initStudio } from "./init.js";
import { runAmend } from "./lifecycle.js";

delete process.env["BISELLIUM_SELLA"];

const NOW = new Date("2026-10-06T12:00:00Z");
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function studio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w152-${tag}-`));
  dirs.push(dir);
  const init = initStudio(dir, { now: NOW });
  assert.ok(init.root, init.message);
  return dir;
}

function milestones(dir: string, yaml: string): void {
  writeFileSync(join(dir, "milestones.yml"), yaml);
}

/** Two milestones, weights 50 + 50, exits that need nothing from the opera. */
const TWO_OK = `milestones:
  - { id: M1, title: "First", weight: 50, exit: { opus: W-1 } }
  - { id: M2, title: "Second", weight: 50, exit: { needs: "a check that does not exist" } }
`;

function opus(dir: string, id: string, state: string, extra = ""): void {
  mkdirSync(join(dir, "opera"), { recursive: true });
  writeFileSync(join(dir, "opera", `${id}.md`), `---\nid: ${id}\ntitle: ${id} fixture\nkind: opus\ncollegium: production\nstate: ${state}\n${extra}---\nbody\n`);
}

const of = (dir: string, rule: string): Finding[] => checkStudio(dir, NOW).findings.filter((f) => f.rule === rule);

test("W-152-b1 behaviour 1: milestones.shape judges the milestone records", () => {
  const dir = studio("b1");

  milestones(
    dir,
    `milestones:
  - { id: M1, title: "First", weight: 50, exit: { opus: W-1 } }
  - { id: M2, title: "Second", weight: 40, exit: { needs: x } }
`,
  );
  const total = of(dir, "milestones.shape");
  assert.equal(total.length, 1, "weights total 90 yields milestones.shape");
  assert.equal(total[0]?.level, "block");
  assert.match(total[0]?.message ?? "", /90/);

  const bad: [string, string][] = [
    ["a duplicate id", `milestones:\n  - { id: M1, title: A, weight: 50, exit: { needs: x } }\n  - { id: M1, title: B, weight: 50, exit: { needs: x } }\n`],
    ["an exit with two keys", `milestones:\n  - { id: M1, title: A, weight: 100, exit: { opus: W-1, rule: lesson.recurrent } }\n`],
    ["an exit with an unknown key", `milestones:\n  - { id: M1, title: A, weight: 100, exit: { check: W-1 } }\n`],
    ["YAML that does not parse", `milestones: [unclosed\n  - {{{\n`],
  ];
  for (const [what, yaml] of bad) {
    milestones(dir, yaml);
    const found = of(dir, "milestones.shape");
    assert.ok(found.length >= 1, `${what} yields a milestones.shape finding`);
    assert.ok(found.every((f) => f.level === "block" && f.where === "milestones.yml"), `${what}: block at milestones.yml`);
  }

  milestones(dir, TWO_OK);
  assert.deepEqual(of(dir, "milestones.shape"), [], "a valid file yields none");
  rmSync(join(dir, "milestones.yml"));
  assert.deepEqual(of(dir, "milestones.shape"), [], "no milestones.yml yields none");
});

test("W-152-b2 behaviour 2: opus.milestone fails an opus that is not halted and maps to zero, or to more than one, milestone", () => {
  const dir = studio("b2");
  milestones(dir, TWO_OK);
  opus(dir, "W-1", "backlog");
  opus(dir, "W-2", "backlog", "milestone: [M1, M2]\nvalue: 3\n");
  opus(dir, "W-3", "backlog", "milestone: M9\nvalue: 3\n");
  opus(dir, "W-4", "backlog", "milestone: M1\nvalue: 4\n");
  opus(dir, "W-5", "halted");
  opus(dir, "W-6", "done", "milestone: M1\nvalue: 3\n");

  const found = of(dir, "opus.milestone");
  const forOpus = (id: string): Finding[] => found.filter((f) => f.where === `opera/${id}.md`);
  assert.equal(forOpus("W-1").length, 1, "a backlog opus with no milestone yields one opus.milestone");
  assert.equal(forOpus("W-1")[0]?.level, "block");
  assert.equal(forOpus("W-2").length, 1, "milestone [M1, M2] yields one");
  assert.match(forOpus("W-2")[0]?.message ?? "", /maps to 2/);
  assert.equal(forOpus("W-3").length, 1, "an undeclared id yields one");
  assert.equal(forOpus("W-4").length, 1, "value 4 yields one");
  assert.ok(found.every((f) => f.level === "block"));
  assert.equal(forOpus("W-5").length, 0, "a halted opus with no mapping yields nothing");
  assert.equal(forOpus("W-6").length, 0, "a done opus at M1/3 yields nothing");
  assert.equal(found.length, 4);

  rmSync(join(dir, "milestones.yml"));
  assert.deepEqual(of(dir, "opus.milestone"), [], "without milestones.yml the rule is inert");
});

test("W-152-b3 behaviour 3: amend --milestone --value is the one way a mapping is written", () => {
  const quiet = <T>(fn: () => T): T => {
    const err = console.error;
    const log = console.log;
    console.error = () => undefined;
    console.log = () => undefined;
    try {
      return fn();
    } finally {
      console.error = err;
      console.log = log;
    }
  };
  const fresh = (tag: string, withMilestones = true): { dir: string; path: string } => {
    const dir = studio(tag);
    if (withMilestones) milestones(dir, TWO_OK);
    opus(dir, "W-1", "backlog");
    return { dir, path: join(dir, "opera", "W-1.md") };
  };
  const amend = (dir: string, ...flags: string[]) => quiet(() => runAmend(["W-1", ...flags, "--reason", "r", "--studio", dir]));

  const a = fresh("b3");
  assert.equal(amend(a.dir, "--milestone", "M1", "--value", "3").exitCode, 0, "the pair exits 0");
  const after = readFront<{ milestone?: unknown; value?: unknown; amendments?: { field: string; superseded: unknown }[] }>(a.path).data;
  assert.equal(after.milestone, "M1");
  assert.equal(after.value, 3);
  assert.equal(after.amendments?.length, 2, "two new amendments entries");
  assert.deepEqual(after.amendments?.map((e) => e.field).sort(), ["milestone", "value"]);
  assert.ok(after.amendments?.every((e) => e.superseded === ""), "each superseded is empty");
  assert.equal(of(a.dir, "opus.milestone").filter((f) => f.where === "opera/W-1.md").length, 0, "check has no opus.milestone for W-1");

  const mapped = readFileSync(a.path, "utf8");
  assert.equal(amend(a.dir, "--milestone", "M1", "--value", "3").exitCode, 2, "the identical pair a second time exits 2");
  assert.equal(readFileSync(a.path, "utf8"), mapped, "and leaves the record byte-identical");

  const refusals: [string, string[], boolean][] = [
    ["--value 4", ["--milestone", "M1", "--value", "4"], true],
    ["--milestone M9", ["--milestone", "M9", "--value", "3"], true],
    ["--milestone without --value", ["--milestone", "M1"], true],
    ["a mapping flag with no milestones.yml", ["--milestone", "M1", "--value", "3"], false],
  ];
  for (const [what, flags, withMilestones] of refusals) {
    const f = fresh("b3r", withMilestones);
    const before = readFileSync(f.path, "utf8");
    assert.equal(amend(f.dir, ...flags).exitCode, 2, `${what} exits 2`);
    assert.equal(readFileSync(f.path, "utf8"), before, `${what} leaves the record byte-identical`);
  }
});

// ---------------------------------------------------------------------------
// W-404 (studio/briefs/W-404.md): milestone progress by exits, not filings. Each row spawns the CLI (main.ts) on a
// fixture repository with an init officina inside it, so a red is the row's own failed assertion, never a load error.
// ---------------------------------------------------------------------------
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "main.ts");
const TSX = import.meta.resolve("tsx");

/** A git repository holding an init officina at `studio/`: the shape `next --all` and `milestones --repo` read. */
function exitWorld(tag: string): { repo: string; studio: string } {
  const root = mkdtempSync(join(tmpdir(), `bisellium-w404-${tag}-`));
  dirs.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  spawnSync("git", ["init", "-q", "-b", "master"], { cwd: repo });
  spawnSync("git", ["-c", "user.name=w404", "-c", "user.email=w404@example.invalid", "commit", "-q", "--allow-empty", "-m", "fixture"], { cwd: repo });
  const init = initStudio(join(repo, "studio"), { now: NOW });
  assert.ok(init.root, init.message);
  return { repo, studio: join(repo, "studio") };
}

function bisellium(cwd: string, args: string[]): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, ...args], { cwd, encoding: "utf8", timeout: 120_000, env: { ...process.env, BISELLIUM_SELLA: "" } });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Every file under `dir` (its .git included), path and bytes: two equal snapshots mean nothing was written. */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}\n${readFileSync(p, "base64")}`);
    }
  };
  walk(dir);
  return out.join("\n");
}

/** Four milestones, one of each exit form and one with none; weights 40 + 30 + 20 + 10. */
const FOUR = `milestones:
  - { id: M1, title: "Opus exit", weight: 40, exit: { opus: W-1 } }
  - { id: M2, title: "Rule exit", weight: 30, exit: { rule: acta.kind } }
  - { id: M3, title: "Needs exit", weight: 20, exit: { needs: "a browser test" } }
  - { id: M4, title: "No exit", weight: 10 }
`;

/** W-1 is M1's exit opus; W-2 was split from it and W-3 from W-2 (its path); W-4 is filed under M1 with no parent. */
function fourOpera(studio: string, exitState: string): void {
  opus(studio, "W-1", exitState, "milestone: M1\nvalue: 3\n");
  opus(studio, "W-2", "done", "milestone: M1\nvalue: 2\nparent: W-1\n");
  opus(studio, "W-3", "halted", "parent: W-2\n");
  opus(studio, "W-4", "done", "milestone: M1\nvalue: 5\n");
  opus(studio, "W-5", "done", "milestone: M2\nvalue: 1\nparent: W-9\n");
}

const NOW_ARG = ["--now", NOW.toISOString()];

/** The YAML reader's own first message line for `text` (the held line quotes it). */
function yamlError(text: string): string {
  try {
    parseYaml(text);
  } catch (e) {
    return (e as Error).message.split("\n")[0] ?? "";
  }
  throw new Error("the fixture parses");
}

test("W-404-b1 behaviour 1: bisellium milestones prints each milestone's exit, whether it is met, its exit path and the weighted share of exits met, and writes nothing", { timeout: 600_000 }, () => {
  const w = exitWorld("b1");
  milestones(w.studio, FOUR);
  fourOpera(w.studio, "greenlit");
  const run = (): { status: number | null; out: string; err: string } => bisellium(w.repo, ["milestones", "--studio", w.studio, "--repo", w.repo, ...NOW_ARG]);
  const report = (head: string, m1: string, m2: string): string =>
    [
      head,
      m1,
      m2,
      "M3 open · weight 20 · Needs exit · exit: needs: a browser test (no record can meet it) · path: none",
      "M4 open · weight 10 · No exit · exit: none stated · path: none",
      "",
    ].join("\n");
  const M1_OPEN = "M1 open · weight 40 · Opus exit · exit: opus W-1 (greenlit) · path: W-1 greenlit, W-2 done, W-3 halted";
  const M2_MET = "M2 met · weight 30 · Rule exit · exit: rule acta.kind (no finding) · path: none";
  const first = report("milestones: 1 of 4 exits met, 30% by weight", M1_OPEN, M2_MET);

  const before = snapshot(w.repo);
  const r = run();
  assert.equal(r.out, first, "the report: a summary, then one line per milestone in file order");
  assert.equal(r.status, 0, "exit 0");
  assert.equal(r.err, "", "nothing on stderr");
  assert.equal(snapshot(w.repo), before, "the run writes nothing: every file under the repository, .git included, is byte-identical");

  // filings do not move it: more opera filed under M1 and M2, and an opus naming an undeclared milestone
  opus(w.studio, "W-6", "backlog", "milestone: M1\nvalue: 8\n");
  opus(w.studio, "W-7", "done", "milestone: M2\nvalue: 8\n");
  opus(w.studio, "W-8", "done", "milestone: M99\nvalue: 3\n");
  assert.equal(run().out, first, "filing more opera, done or not, and an opus naming an undeclared milestone change no line");

  // the exit opus done meets M1: the share is the met weights over every weight
  opus(w.studio, "W-1", "done", "milestone: M1\nvalue: 3\n");
  assert.equal(run().out, report("milestones: 2 of 4 exits met, 70% by weight", "M1 met · weight 40 · Opus exit · exit: opus W-1 (done) · path: W-1 done, W-2 done, W-3 halted", M2_MET), "the exit opus done: M1 met, 70%");

  // a finding of the exit rule opens M2, at any level
  writeFileSync(join(w.studio, "acta", "bad.md"), "---\nauthor: producer\nkind: zz\ntitle: bad\nat: 2026-10-06T00:00:00Z\n---\nbody\n");
  const M1_MET = "M1 met · weight 40 · Opus exit · exit: opus W-1 (done) · path: W-1 done, W-2 done, W-3 halted";
  assert.equal(run().out, report("milestones: 1 of 4 exits met, 40% by weight", M1_MET, "M2 open · weight 30 · Rule exit · exit: rule acta.kind (1 finding) · path: none"), "one acta.kind finding: M2 open");
  rmSync(join(w.studio, "acta", "bad.md"));

  // a parent cycle ends: each opus once
  opus(w.studio, "W-1", "done", "milestone: M1\nvalue: 3\nparent: W-3\n");
  assert.equal(run().out, report("milestones: 2 of 4 exits met, 70% by weight", M1_MET, M2_MET), "a parent cycle W-1 > W-3 > W-2 > W-1: the path lists each once");

  // an exit naming no record, and a rule that is not a check rule, are never met
  milestones(
    w.studio,
    `milestones:
  - { id: M1, title: "Opus exit", weight: 1, exit: { opus: W-77 } }
  - { id: M2, title: "Rule exit", weight: 1, exit: { rule: no.such.rule } }
  - { id: M5, title: "Met", weight: 1, exit: { opus: W-2 } }
`,
  );
  assert.equal(
    run().out,
    [
      "milestones: 1 of 3 exits met, 33% by weight",
      "M1 open · weight 1 · Opus exit · exit: opus W-77 (no record) · path: none",
      "M2 open · weight 1 · Rule exit · exit: rule no.such.rule (not a check rule) · path: none",
      "M5 met · weight 1 · Met · exit: opus W-2 (done) · path: W-2 done, W-1 done, W-3 halted",
      "",
    ].join("\n"),
    "no record and no such rule: open; the share is floored (1 of 3 weights: 33%); W-2's path runs through the cycle, the exit opus first",
  );

  // absent: inert
  rmSync(join(w.studio, "milestones.yml"));
  const absent = run();
  assert.equal(absent.out, "milestones: none: the officina has no milestones.yml\n", "no milestones.yml: one line");
  assert.equal(absent.status, 0, "no milestones.yml: exit 0");

  // malformed: held, exit 1, every problem named, no row printed
  const held: [string, string, string][] = [
    ["a list that does not parse", "milestones: [unclosed\n", `milestones.yml is malformed: it does not parse: ${yamlError("milestones: [unclosed\n")}`],
    ["no milestones list", "milestones: 3\n", 'milestones.yml is malformed: it needs a "milestones" list'],
    ["an empty list", "milestones: []\n", "milestones.yml is malformed: it lists no milestone"],
    [
      "four bad entries",
      `milestones:\n  - 7\n  - { id: M1, title: "A", weight: 0, exit: { opus: W-1, rule: acta.kind } }\n  - { id: M1, title: "", weight: 2.5, exit: null }\n  - { id: "bad id", title: "B", weight: 1, exit: { check: W-1 } }\n`,
      'milestones.yml is malformed: milestone #1 is not a mapping; milestone M1 weight must be a positive integer; milestone M1 exit must be absent or have exactly one of opus | rule | needs, a non-empty string; duplicate milestone id "M1"; milestone M1 title must be a non-empty string; milestone M1 weight must be a positive integer; milestone M1 exit must be absent or have exactly one of opus | rule | needs, a non-empty string; milestone #4 id "bad id" is not a valid id; milestone bad id exit must be absent or have exactly one of opus | rule | needs, a non-empty string',
    ],
  ];
  for (const [what, yaml, why] of held) {
    milestones(w.studio, yaml);
    const h = run();
    assert.equal(h.out, `milestones: held · why: ${why}\n`, `${what}: one held line naming why, no row`);
    assert.equal(h.status, 1, `${what}: exit 1`);
  }

  // an unreadable opus record holds the report: it may be on a path
  milestones(w.studio, FOUR);
  writeFileSync(join(w.studio, "opera", "W-11.md"), "no front matter\n");
  const unreadable = run();
  assert.equal(unreadable.out, `milestones: held · why: opera/W-11.md cannot be read (${join(w.studio, "opera", "W-11.md")}: missing front matter)\n`, "an unreadable record: held");
  assert.equal(unreadable.status, 1, "an unreadable record: exit 1");
  rmSync(join(w.studio, "opera", "W-11.md"));

  // usage: exit 2
  for (const [args, why] of [[["W-1"], "takes no positional argument"], [["--json"], 'unknown flag "--json"'], [["--now", "yesterday"], "--now must be an ISO date"]] as const) {
    const u = bisellium(w.repo, ["milestones", "--studio", w.studio, ...args]);
    assert.equal(u.status, 2, `${args.join(" ")}: exit 2`);
    assert.equal(u.err.split("\n")[0], `milestones: ${why}`, `${args.join(" ")}: ${why}`);
  }
  const notStudio = bisellium(w.repo, ["milestones", "--studio", w.repo]);
  assert.equal(notStudio.status, 2, "not a studio: exit 2");
  assert.equal(notStudio.err.split("\n")[0], `milestones: ${join(w.repo, "bisellium.yml")} not found — not a studio`, "not a studio: named");
});

test("W-404-b2 behaviour 2: next --all prints the milestones report as one line before the open count", { timeout: 600_000 }, () => {
  const w = exitWorld("b2");
  milestones(w.studio, FOUR);
  fourOpera(w.studio, "backlog");
  const all = (): { status: number | null; out: string; err: string } => bisellium(w.repo, ["next", "--all", "--studio", w.studio, "--repo", w.repo]);
  const LINE = "milestones: 1 of 4 exits met, 30% by weight · M1 open: opus W-1; path W-1, W-2, W-3 · M2 met: rule acta.kind; path none · M3 open: needs; path none · M4 open: no exit; path none";

  const before = snapshot(w.repo);
  const r = all();
  assert.equal(r.out, `${LINE}\nopen: 0\n`, "the milestones line, then the open count");
  assert.equal(r.status, 0, "exit 0");
  assert.equal(snapshot(w.repo), before, "next --all writes nothing: every file under the repository, .git included, is byte-identical");

  // the line is the report: the verb's summary and each milestone's met or open
  const v = bisellium(w.repo, ["milestones", "--studio", w.studio, "--repo", w.repo]);
  const verb = v.out.trimEnd().split("\n");
  const parts = LINE.split(" · ");
  assert.equal(parts[0], verb[0], "the same summary as the verb");
  assert.deepEqual(
    parts.slice(1).map((p) => p.split(":")[0]),
    verb.slice(1).map((l) => l.split(" · ")[0]),
    "the same milestones, met or open, in the same order",
  );

  // filings do not move it
  opus(w.studio, "W-6", "backlog", "milestone: M1\nvalue: 8\n");
  opus(w.studio, "W-8", "done", "milestone: M99\nvalue: 3\n");
  assert.equal(all().out, `${LINE}\nopen: 0\n`, "filing more opera, and an opus naming an undeclared milestone, change nothing");

  // malformed: a held line, and the run exits 1 after every line
  milestones(w.studio, "milestones: []\n");
  const held = all();
  assert.equal(held.out, "milestones: held · why: milestones.yml is malformed: it lists no milestone\nopen: 0\n", "a malformed milestones.yml: the held line");
  assert.equal(held.status, 1, "a malformed milestones.yml: exit 1");

  // absent: no line, as before W-404
  rmSync(join(w.studio, "milestones.yml"));
  const absent = all();
  assert.equal(absent.out, "open: 0\n", "no milestones.yml: no milestones line");
  assert.equal(absent.status, 0, "no milestones.yml: exit 0");
});
