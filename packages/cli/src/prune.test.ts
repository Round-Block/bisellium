import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pruneStaleOpusBranches, runPrune } from "./prune.js";
import * as pruneModule from "./prune.js";

function git(args: string[], cwd: string): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "prune-test-"));
  git(["init", "-b", "master"], dir);
  git(["-c", "user.name=test", "-c", "user.email=test@test", "commit", "--allow-empty", "-m", "init"], dir);
  return dir;
}

function makeStudio(repo: string): string {
  const studio = join(repo, "studio");
  mkdirSync(join(studio, "opera"), { recursive: true });
  return studio;
}

function writeOpus(studio: string, id: string, state: string): void {
  writeFileSync(
    join(studio, "opera", `${id}.md`),
    `---\nid: "${id}"\ntitle: "test"\nkind: "task"\ncollegium: "engineering"\nstate: ${state}\nspec: "briefs/${id}.md"\nprobationes: {}\n---\n`
  );
}

describe("pruneStaleOpusBranches", () => {
  let repo: string;
  let studio: string;

  before(() => {
    repo = makeRepo();
    studio = makeStudio(repo);
  });

  after(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("1: deletes a merged branch whose opus is done", () => {
    writeOpus(studio, "W-100", "done");
    git(["branch", "opus/W-100"], repo);
    const result = pruneStaleOpusBranches(repo, studio);
    assert.equal(result.removed.length, 1);
    assert.equal(result.removed[0]!.branch, "opus/W-100");
    const branches = spawnSync("git", ["branch", "--list", "opus/W-100"], { cwd: repo, encoding: "utf8" });
    assert.equal(branches.stdout.trim(), "");
  });

  it("2: keeps a branch whose opus is building", () => {
    writeOpus(studio, "W-101", "building");
    git(["branch", "opus/W-101"], repo);
    const result = pruneStaleOpusBranches(repo, studio);
    assert.equal(result.removed.length, 0);
    const kept = result.kept.find((k) => k.branch === "opus/W-101");
    assert.ok(kept);
    assert.equal(kept.reason, 'opus state is "building"');
  });

  it("3: keeps an unmerged branch even if opus is done", () => {
    writeOpus(studio, "W-102", "done");
    git(["branch", "opus/W-102"], repo);
    git(["checkout", "opus/W-102"], repo);
    git(["-c", "user.name=test", "-c", "user.email=test@test", "commit", "--allow-empty", "-m", "diverge"], repo);
    git(["checkout", "master"], repo);
    const result = pruneStaleOpusBranches(repo, studio);
    assert.equal(result.removed.length, 0);
    const kept = result.kept.find((k) => k.branch === "opus/W-102");
    assert.ok(kept);
    // the safety guard itself must be why this branch survives — not git's
    // own refusal to delete an unmerged branch (which would land here with
    // reason "delete failed" even if the `!mergedSet.has(branch)` check were
    // deleted outright).
    assert.equal(kept.reason, "not merged into HEAD");
  });

  it("4: returns empty when no opus branches exist", () => {
    const fresh = makeRepo();
    const freshStudio = makeStudio(fresh);
    const result = pruneStaleOpusBranches(fresh, freshStudio);
    assert.equal(result.removed.length, 0);
    assert.equal(result.kept.length, 0);
    rmSync(fresh, { recursive: true, force: true });
  });
});

function captureStderr(fn: () => { exitCode: number }): { exitCode: number; stderr: string } {
  const orig = console.error;
  let stderr = "";
  console.error = (...parts: unknown[]) => { stderr += parts.join(" ") + "\n"; };
  try {
    return { exitCode: fn().exitCode, stderr };
  } finally {
    console.error = orig;
  }
}

describe("runPrune flag validation", () => {
  it("rejects an unrecognized flag instead of silently falling back to cwd", () => {
    // must be caught as a bad flag, not merely surface exit 2 from the
    // unrelated "no opera directory" fallback that a cwd-degraded --studio
    // would also trip
    const { exitCode, stderr } = captureStderr(() => runPrune(["--studio=/tmp/whatever"]));
    assert.equal(exitCode, 2);
    assert.match(stderr, /unknown flag "--studio=\/tmp\/whatever"/);
  });

  it("rejects --help instead of silently falling back to cwd", () => {
    const { exitCode, stderr } = captureStderr(() => runPrune(["--help"]));
    assert.equal(exitCode, 2);
    assert.match(stderr, /unknown flag "--help"/);
  });
});

// ---------------------------------------------------------------------------
// W-131 behaviour 4: prune removes the gate logs of a `done` opus that nothing
// outside ci/ cites, and nothing else.
// ---------------------------------------------------------------------------
const MANIFEST = [
  "bisellium: 1",
  "studio: W-131 prune",
  "patron: patron",
  "collegia:",
  "  - { id: engineering, name: Engineering, magister: eng-lead }",
  "sellae:",
  "  - { id: builder-sol, collegium: engineering, kind: agent }",
  "probationes:",
  "  - { id: tests, name: Tests, kind: automated, command: x }",
  "  - { id: lint, name: Lint, kind: automated, command: x }",
  "  - { id: review, name: Review, kind: agent }",
  "wip_limit: 10",
  "",
].join("\n");

/** A repo whose studio/ holds opera, ci/ files (name -> text) and other officina files. */
function w131Fixture(opera: Record<string, string>, ci: Record<string, string>, extra: Record<string, string> = {}): { repo: string; studio: string } {
  const repo = makeRepo();
  const studio = makeStudio(repo);
  writeFileSync(join(studio, "bisellium.yml"), MANIFEST);
  for (const [id, state] of Object.entries(opera)) writeOpus(studio, id, state);
  for (const [name, text] of Object.entries(ci)) {
    mkdirSync(dirname(join(studio, "ci", name)), { recursive: true });
    writeFileSync(join(studio, "ci", name), text);
  }
  for (const [rel, text] of Object.entries(extra)) {
    mkdirSync(dirname(join(studio, rel)), { recursive: true });
    writeFileSync(join(studio, rel), text);
  }
  return { repo, studio };
}

function pruneOutput(fx: { repo: string; studio: string }): string {
  const orig = console.log;
  let out = "";
  console.log = (...parts: unknown[]) => { out += parts.join(" ") + "\n"; };
  try {
    runPrune(["--studio", fx.studio, "--repo", fx.repo]);
  } finally {
    console.log = orig;
  }
  return out;
}

test("W-131 behaviour 4: prune removes exactly the gate logs of a done opus that nothing cites", () => {
  const fixtures: { repo: string }[] = [];
  const fixture = (...args: Parameters<typeof w131Fixture>) => {
    const fx = w131Fixture(...args);
    fixtures.push(fx);
    return fx;
  };
  try {
    const gone = ["W-401-tests-0123abcd.log", "W-401-lint-89abcdef.log"];
    const stays = ["W-401-review-1.log", "W-401.log", "W-401-bogus-0123abcd.log", "W-401-tests-0123abc.log", "reds/W-401/01.log", "W-401-spec-12345678.log", "W-401-review-12345678.log"];
    const main = fixture(
      { "W-401": "done" },
      Object.fromEntries([...gone, ...stays].map((name) => [name, `log ${name}\n`])),
    );
    const first = pruneOutput(main);
    for (const name of gone) {
      assert.ok(first.includes(`ci log removed: ci/${name}\n`), `${name} is reported removed: ${first}`);
      assert.equal(existsSync(join(main.studio, "ci", name)), false, `${name} is deleted`);
    }
    for (const name of stays) assert.equal(existsSync(join(main.studio, "ci", name)), true, `${name} is kept`);
    assert.equal(pruneOutput(main), "nothing to prune\n", "a second run finds nothing");
    assert.deepEqual(pruneModule.pruneCiLogs(main.studio), { removed: [] });

    // Each keeper gets a fixture of its own, so no other rule can be what saves it.
    const cited = fixture({ "W-402": "done" }, { "W-402-tests-aaaaaaaa.log": "log\n" }, { "lessons/L-001.md": "see ci/W-402-tests-aaaaaaaa.log\n" });
    const building = fixture({ "W-403": "building" }, { "W-403-tests-bbbbbbbb.log": "log\n" });
    const linked = fixture({ "W-404": "done" }, {});
    mkdirSync(join(linked.studio, "ci"), { recursive: true });
    writeFileSync(join(linked.repo, "outside.log"), "outside\n");
    symlinkSync(join(linked.repo, "outside.log"), join(linked.studio, "ci", "W-404-tests-cccccccc.log"));
    for (const [what, fx, name] of [
      ["a log cited from lessons/", cited, "W-402-tests-aaaaaaaa.log"],
      ["a log of a building opus", building, "W-403-tests-bbbbbbbb.log"],
      ["a symlinked candidate", linked, "W-404-tests-cccccccc.log"],
    ] as const) {
      assert.equal(pruneOutput(fx), "nothing to prune\n", `${what}: nothing is removed`);
      assert.ok(lstatSync(join(fx.studio, "ci", name)), `${what} stays`);
    }
    assert.equal(existsSync(join(linked.repo, "outside.log")), true, "a symlink's target is never touched");
  } finally {
    for (const fx of fixtures) rmSync(fx.repo, { recursive: true, force: true });
  }
});
