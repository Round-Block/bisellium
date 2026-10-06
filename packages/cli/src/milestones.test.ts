/**
 * W-152 rows b1-b3 (studio/briefs/W-152.md): `milestones.shape`,
 * `opus.milestone` and `amend --milestone --value`. node:test TAP, one test()
 * per behaviour, selected by `--test-name-pattern=W-152-b<n>`. Every row builds
 * its own fixture under the OS tmp dir and writes nothing in studio/ or
 * examples/.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
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
