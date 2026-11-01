import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
  "  - { id: spec, name: Spec, kind: agent }",
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

// ---------------------------------------------------------------------------
// W-489 (studio/briefs/W-489.md): worktrees reclaimed when their opus or PR ends. Each fixture is a repository with a
// bare origin whose master is fetched, its worktrees under <repo>/.worktrees/; "old" is a gitdir file two hours back.
// The PR lookup is a fake that records each call: no row runs gh.
// ---------------------------------------------------------------------------
const W489_ID = ["-c", "user.name=test", "-c", "user.email=test@test"];
function w489Repo(): { root: string; repo: string; studio: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "w489-")));
  const repo = join(root, "repo");
  git(["init", "-q", "--bare", "-b", "master", join(root, "origin.git")], root);
  git(["init", "-q", "-b", "master", repo], root);
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(["add", "a.txt"], repo);
  git([...W489_ID, "commit", "-q", "-m", "init"], repo);
  git(["remote", "add", "origin", join(root, "origin.git")], repo);
  git(["push", "-q", "origin", "master"], repo);
  git(["fetch", "-q", "origin"], repo);
  writeFileSync(join(repo, ".git", "info", "exclude"), ".worktrees/\n.bisellium/\nstudio/\n");
  return { root, repo, studio: makeStudio(repo) };
}
/** A worktree `.worktrees/<name>`, on a new branch or detached at master; old unless `young`. */
function w489Wt(repo: string, name: string, branch: string | undefined, o: { young?: boolean } = {}): string {
  const path = join(repo, ".worktrees", name);
  git(["worktree", "add", "-q", ...(branch === undefined ? ["--detach"] : ["-b", branch]), path, "master"], repo);
  if (o.young !== true) w489Age(path, 2);
  return path;
}
function w489Age(path: string, hours: number): void {
  const admin = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: path, encoding: "utf8" }).stdout.trim();
  const t = new Date(Date.now() - hours * 3_600_000);
  utimesSync(join(admin, "gitdir"), t, t);
}
const w489Commit = (path: string, msg: string): void => git([...W489_ID, "commit", "-q", "--allow-empty", "-m", msg], path);
/** A fake PR lookup over `states`, answering only the branches asked for; `calls` records each call's branches, sorted. */
function w489Prs(states: Record<string, string>): { calls: string[][]; prs: (branches: readonly string[]) => Map<string, string> } {
  const calls: string[][] = [];
  return { calls, prs: (branches) => (calls.push([...branches].sort()), new Map(Object.entries(states).filter(([b]) => branches.includes(b)))) };
}
type W489Entry = { path: string; reason: string; saved?: string; adminLeft?: true };
type W489Sweep = { removed: W489Entry[]; kept: W489Entry[]; adminLeft: number };
/** The sweep under test; before it exists, an empty result, so a row fails at its first assertion, never at a load. */
function w489Sweep(repo: string, studio: string, o: Record<string, unknown>): W489Sweep {
  const sweep = (pruneModule as unknown as Record<string, unknown>)["sweepWorktrees"];
  return typeof sweep === "function" ? (sweep as (r: string, s: string, o: unknown) => W489Sweep)(repo, studio, o) : { removed: [], kept: [], adminLeft: 0 };
}
const w489Brief = (es: W489Entry[]): [string, string][] => es.map((e): [string, string] => [basename(e.path), e.reason]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const w489Admin = (repo: string): string => join(repo, ".git", "worktrees");

test("W-489-b1 behaviour 1: the done perform's sweep removes every worktree that carries its opus id, past the guards, saving a dirty one's patch", () => {
  const fx = w489Repo();
  try {
    const { repo, studio, root } = fx;
    const spec = w489Wt(repo, "W-7-spec", "spec-scratch/W-7");
    const stage = w489Wt(repo, "W-7-stage", undefined);
    writeFileSync(join(stage, "a.txt"), "a changed\n");
    writeFileSync(join(stage, "new.txt"), "new file content\n");
    w489Wt(repo, "verify-W-7", "verify/W-7");
    w489Wt(repo, "x-W-7", undefined, { young: true });
    const lost = w489Wt(repo, "W-7-lost", undefined);
    w489Commit(lost, "a commit no ref holds");
    w489Age(lost, 2);
    w489Wt(repo, "W-7-locked", undefined);
    git(["worktree", "lock", join(repo, ".worktrees", "W-7-locked")], repo);
    w489Wt(repo, "W-7-unread", "scratch/W-7-unread");
    const other = w489Wt(repo, "W-70-spec", "spec-scratch/W-70");
    const outside = join(root, "elsewhere-W-7");
    git(["worktree", "add", "-q", "--detach", outside, "master"], repo);
    w489Age(outside, 2);
    const fake = w489Prs({ "spec-scratch/W-7": "NONE", "verify/W-7": "OPEN", "spec-scratch/W-70": "NONE" });

    const s = w489Sweep(repo, studio, { opus: "W-7", prs: fake.prs, nowMs: Date.now() });
    assert.deepEqual(w489Brief(s.removed), [["W-7-spec", "opus W-7 done"], ["W-7-stage", "opus W-7 done"]], "every old, unguarded worktree carrying W-7 is removed");
    assert.equal(existsSync(spec), false, "a clean worktree on a never-pushed branch is gone");
    assert.equal(existsSync(stage), false, "a dirty detached worktree is gone");
    const saved = s.removed.find((e) => basename(e.path) === "W-7-stage")?.saved ?? "";
    assert.equal(dirname(saved), join(repo, ".bisellium", "worktree-diffs"), "a dirty worktree patch is saved under <repo>/.bisellium/worktree-diffs/");
    assert.match(basename(saved), /^W-7-stage-.+\.patch$/, "the patch is named for its worktree");
    const patch = readFileSync(saved, "utf8");
    assert.ok(patch.includes("+a changed") && patch.includes("+new file content"), "the patch holds the tracked change and the untracked file content");
    git(["apply", "--check", saved], repo);
    assert.equal(s.removed.find((e) => basename(e.path) === "W-7-spec")?.saved, undefined, "a clean worktree saves no patch");
    assert.deepEqual(
      w489Brief(s.kept),
      [
        ["W-7-locked", "locked"],
        ["W-7-lost", "detached at a commit no branch, tag or remote-tracking ref holds"],
        ["W-7-unread", "its PR state was not read"],
        ["verify-W-7", "its PR is open"],
        ["x-W-7", "younger than an hour"],
      ],
      "a locked, unheld, unread, open-PR or young worktree of W-7 is kept, each for its own reason",
    );
    assert.equal(existsSync(other), true, "W-70 is not W-7: its worktree is untouched");
    assert.equal(existsSync(outside), true, "a worktree outside .worktrees/ is untouched");
    assert.deepEqual(fake.calls, [["scratch/W-7-unread", "spec-scratch/W-7", "verify/W-7"]], "the PR lookup is asked once, for the candidates' branches only");

    // a sandbox holds an admin directory busy: the checkout goes, the admin directory waits for a later run
    const busy = w489Wt(repo, "W-7-busy", undefined);
    chmodSync(w489Admin(repo), 0o555);
    let held: W489Sweep;
    try {
      held = w489Sweep(repo, studio, { opus: "W-7", prs: fake.prs, nowMs: Date.now() });
    } finally {
      chmodSync(w489Admin(repo), 0o755);
    }
    assert.deepEqual(held.removed.map((e) => [basename(e.path), e.adminLeft]), [["W-7-busy", true]], "a busy admin directory still counts the checkout removed");
    assert.equal(existsSync(busy), false, "its checkout is gone");
    assert.equal(held.adminLeft, 1, "the busy admin directory is counted");
    assert.equal(w489Sweep(repo, studio, { opus: "W-7", prs: fake.prs, nowMs: Date.now() }).adminLeft, 0, "a later run prunes it");
    assert.equal(existsSync(join(w489Admin(repo), "W-7-busy")), false, "its admin directory is gone");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("W-489-b1 submodule-dirty patch round-trip: a worktree whose initialized submodule holds modified or untracked contents is kept, never force-removed", () => {
  const fx = w489Repo();
  try {
    const { repo, studio, root } = fx;
    const subSrc = join(root, "subsrc");
    git(["init", "-q", "-b", "master", subSrc], root);
    writeFileSync(join(subSrc, "s.txt"), "s\n");
    git(["add", "s.txt"], subSrc);
    git([...W489_ID, "commit", "-q", "-m", "sub init"], subSrc);
    git([...W489_ID, "-c", "protocol.file.allow=always", "submodule", "add", "-q", subSrc, "vendor"], repo);
    git([...W489_ID, "commit", "-q", "-m", "add submodule"], repo);
    git(["push", "-q", "origin", "master"], repo);
    const wt = w489Wt(repo, "W-9-sub", undefined);
    git(["-c", "protocol.file.allow=always", "submodule", "update", "-q", "--init"], wt);
    writeFileSync(join(wt, "vendor", "s.txt"), "s modified in the submodule\n");
    writeFileSync(join(wt, "vendor", "untracked.txt"), "untracked in the submodule\n");
    const fake = w489Prs({});

    const s = w489Sweep(repo, studio, { opus: "W-9", prs: fake.prs, nowMs: Date.now() });
    assert.equal(existsSync(join(wt, "vendor", "untracked.txt")), true, "the submodule's untracked file is still on disk");
    assert.equal(readFileSync(join(wt, "vendor", "s.txt"), "utf8"), "s modified in the submodule\n", "the submodule's modification is still on disk");
    assert.deepEqual(s.removed, [], "the worktree is not removed");
    assert.equal(s.kept.length, 1, "the worktree is kept");
    assert.match(s.kept[0]?.reason ?? "", /submodule.*vendor/, "the kept reason names the submodule");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("W-489-b5 behaviour 5: a dirty worktree holding a nested repository in a recognised form is kept by both sweeps, never saved as a gitlink and force-removed", () => {
  const fx = w489Repo();
  try {
    const { repo, studio, root } = fx;
    const subSrc = join(root, "subsrc");
    git(["init", "-q", "-b", "master", subSrc], root);
    writeFileSync(join(subSrc, "s.txt"), "s\n");
    git(["add", "s.txt"], subSrc);
    git([...W489_ID, "commit", "-q", "-m", "sub init"], subSrc);
    git([...W489_ID, "-c", "protocol.file.allow=always", "submodule", "add", "-q", subSrc, "vendor"], repo);
    git([...W489_ID, "commit", "-q", "-m", "add submodule"], repo);
    git(["push", "-q", "origin", "master"], repo);
    git(["fetch", "-q", "origin"], repo);
    writeOpus(studio, "W-7", "done");
    const nested = (dir: string, file: string, gitdir?: string): void => {
      mkdirSync(dir, { recursive: true });
      git(["init", "-q", "-b", "master", ...(gitdir === undefined ? [] : ["--separate-git-dir", gitdir]), dir], root);
      writeFileSync(join(dir, file), `${file}\n`);
      git(["add", file], dir);
      git([...W489_ID, "commit", "-q", "-m", file], dir);
    };
    const emb = w489Wt(repo, "W-7-emb", "w7-emb");
    nested(join(emb, "emb"), "x.txt");
    const gf = w489Wt(repo, "W-7-gitfile", "w7-gitfile");
    mkdirSync(join(gf, "plain"));
    writeFileSync(join(gf, "plain", "p.txt"), "p\n");
    nested(join(gf, "plain", "deep"), "y.txt", join(root, "deep.git"));
    const sub = w489Wt(repo, "W-7-sub", "w7-sub");
    git(["-c", "protocol.file.allow=always", "submodule", "update", "-q", "--init"], sub);
    writeFileSync(join(sub, "note.txt"), "note\n");
    const fake = w489Prs({ "w7-emb": "NONE", "w7-gitfile": "NONE", "w7-sub": "NONE" });

    const s = w489Sweep(repo, studio, { opus: "W-7", prs: fake.prs, nowMs: Date.now() });
    const kept = new Map(s.kept.map((e) => [basename(e.path), e.reason]));
    assert.equal(kept.has("W-7-emb"), true, "the worktree holding an untracked embedded repository is kept");
    assert.equal(readFileSync(join(emb, "emb", "x.txt"), "utf8"), "x.txt\n", "the embedded repository's committed file is still on disk");
    assert.equal(kept.has("W-7-gitfile"), true, "the worktree holding an untracked gitfile is kept");
    assert.equal(existsSync(join(gf, "plain", "deep", "y.txt")), true, "the gitfile repository's file is still on disk");
    assert.equal(kept.has("W-7-sub"), true, "the worktree holding a clean initialized submodule is kept");
    assert.equal(existsSync(join(sub, "vendor", "s.txt")), true, "the submodule's checkout is still on disk");
    assert.deepEqual(s.removed, [], "none of the three is removed");
    assert.match(kept.get("W-7-emb") ?? "", /untracked emb is a nested repository/, "each kept reason names its nested repository's path");
    assert.match(kept.get("W-7-gitfile") ?? "", /plain\/deep/, "each kept reason names its nested repository's path");
    assert.match(kept.get("W-7-sub") ?? "", /submodule.*vendor/, "each kept reason names its nested repository's path");
    assert.equal(existsSync(join(repo, ".bisellium", "worktree-diffs")), false, "no patch is saved for them");

    const p = w489Sweep(repo, studio, { prs: fake.prs, nowMs: Date.now() });
    assert.deepEqual([p.removed, p.kept.map((e) => basename(e.path)).sort()], [[], ["W-7-emb", "W-7-gitfile", "W-7-sub"]], "prune's sweep keeps all three");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("W-489-b6 behaviour 6: a filesystem shape the sweep cannot probe never aborts it: a gitlink replaced by a regular file is saved and removed, an unreadable gitlink path keeps its worktree, and a sweep that throws leaves prune exiting 0", () => {
  const fx = w489Repo();
  const here = process.cwd();
  let locked: string | undefined;
  try {
    const { repo, studio, root } = fx;
    const subSrc = join(root, "subsrc");
    git(["init", "-q", "-b", "master", subSrc], root);
    writeFileSync(join(subSrc, "s.txt"), "s\n");
    git(["add", "s.txt"], subSrc);
    git([...W489_ID, "commit", "-q", "-m", "sub init"], subSrc);
    git([...W489_ID, "-c", "protocol.file.allow=always", "submodule", "add", "-q", subSrc, "vendor"], repo);
    git([...W489_ID, "commit", "-q", "-m", "add submodule"], repo);
    git(["push", "-q", "origin", "master"], repo);
    git(["fetch", "-q", "origin"], repo);
    const tc = w489Wt(repo, "W-7-typechange", "w7-typechange");
    rmSync(join(tc, "vendor"), { recursive: true, force: true });
    writeFileSync(join(tc, "vendor"), "vendor is now a file\n");
    const un = w489Wt(repo, "W-7-unreadable", "w7-unreadable");
    writeFileSync(join(un, "note.txt"), "note\n");
    locked = join(un, "vendor");
    chmodSync(locked, 0o000);
    const fake = w489Prs({ "w7-typechange": "NONE", "w7-unreadable": "NONE" });

    let s: W489Sweep | undefined;
    let thrown: string | undefined;
    try {
      s = w489Sweep(repo, studio, { opus: "W-7", prs: fake.prs, nowMs: Date.now() });
    } catch (e) {
      thrown = (e as Error).message;
    }
    assert.equal(thrown, undefined, "a gitlink replaced by a regular file does not abort the sweep");
    const removed = new Map((s?.removed ?? []).map((e) => [basename(e.path), e]));
    const kept = new Map((s?.kept ?? []).map((e) => [basename(e.path), e.reason]));
    assert.equal(removed.has("W-7-typechange"), true, "the worktree whose gitlink is now a regular file is removed");
    assert.match(readFileSync(removed.get("W-7-typechange")?.saved ?? join(root, "none"), { encoding: "utf8", flag: "a+" }), /vendor is now a file/, "its patch holds the regular file's content");
    assert.match(kept.get("W-7-unreadable") ?? "", /submodule vendor cannot be probed/, "an unreadable gitlink path keeps its worktree, naming the path");
    assert.equal(existsSync(join(un, "note.txt")), true, "the kept worktree's untracked file is still on disk");
    chmodSync(locked, 0o755);
    locked = undefined;

    w489Wt(repo, "W-7-later", "w7-later");
    const gone = mkdtempSync(join(root, "gone-"));
    process.chdir(gone);
    rmSync(gone, { recursive: true, force: true });
    const orig = console.log;
    let out = "";
    let code: number | undefined;
    let pruneThrown: string | undefined;
    console.log = (...parts: unknown[]) => void (out += parts.join(" ") + "\n");
    try {
      code = (runPrune as (args: string[], deps: unknown) => { exitCode: number })(["--studio", studio, "--repo", repo], { prs: fake.prs, nowMs: Date.now() }).exitCode;
    } catch (e) {
      pruneThrown = (e as Error).message;
    } finally {
      console.log = orig;
      process.chdir(here);
    }
    assert.deepEqual([pruneThrown, code], [undefined, 0], "a sweep that throws leaves prune exiting 0");
    assert.match(out, /^worktree sweep failed: /m, "prune prints the sweep's failure");
    assert.equal(existsSync(join(repo, ".worktrees", "W-7-later")), true, "no worktree is removed by a sweep that failed");
  } finally {
    if (locked !== undefined) chmodSync(locked, 0o755);
    process.chdir(here);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("W-489-b2 behaviour 2: prune's sweep removes a worktree whose opus is done, whose PR is merged or closed, or (clean) whose commit is in origin/master, and keeps the rest", () => {
  const fx = w489Repo();
  try {
    const { repo, studio } = fx;
    writeOpus(studio, "W-7", "done");
    writeOpus(studio, "W-8", "building");
    const a = w489Wt(repo, "W-7-a", "spec-scratch/W-7");
    writeFileSync(join(a, "a.txt"), "a, W-7's leftover\n");
    w489Wt(repo, "W-8-spec", "spec-scratch/W-8");
    const dirty8 = w489Wt(repo, "W-8-dirty", "stage/W-8");
    writeFileSync(join(dirty8, "a.txt"), "W-8 in progress\n");
    const recA = w489Wt(repo, "records-a", "chore/records-a");
    w489Commit(recA, "records a");
    const recB = w489Wt(repo, "records-b", "chore/records-b");
    writeFileSync(join(recB, "draft.md"), "a records draft\n");
    w489Wt(repo, "records-c", "chore/records-c");
    w489Wt(repo, "fresh", "chore/fresh", { young: true });
    const work = w489Wt(repo, "W-8-work", "opus/W-8");
    w489Commit(work, "W-8 work");
    w489Wt(repo, "verify-W-9", undefined);
    const both = w489Wt(repo, "W-7-into-W-8", "merge/W-7-W-8");
    w489Commit(both, "W-7 into W-8");
    const fake = w489Prs({
      "spec-scratch/W-7": "NONE",
      "spec-scratch/W-8": "NONE",
      "stage/W-8": "NONE",
      "chore/records-a": "MERGED",
      "chore/records-b": "CLOSED",
      "chore/records-c": "OPEN",
      "opus/W-8": "NONE",
      "merge/W-7-W-8": "NONE",
    });

    const s = w489Sweep(repo, studio, { prs: fake.prs, nowMs: Date.now() });
    assert.deepEqual(
      w489Brief(s.removed),
      [
        ["W-7-a", "opus W-7 done"],
        ["W-8-spec", "its commit is in origin/master"],
        ["records-a", "its PR is merged"],
        ["records-b", "its PR is closed"],
        ["verify-W-9", "its commit is in origin/master"],
      ],
      "a worktree of a done opus, one whose PR ended, and a clean one whose commit is in origin/master are removed",
    );
    assert.deepEqual(
      w489Brief(s.kept),
      [
        ["W-7-into-W-8", "not in origin/master, and neither its opus nor its PR has ended"],
        ["W-8-dirty", "uncommitted changes, and neither its opus nor its PR has ended"],
        ["W-8-work", "not in origin/master, and neither its opus nor its PR has ended"],
        ["fresh", "younger than an hour"],
        ["records-c", "its PR is open"],
      ],
      "a dirty worktree at master, unmerged work, an open PR, a young worktree and one carrying an opus not done are kept",
    );
    for (const name of ["W-7-a", "records-b"]) {
      const saved = s.removed.find((e) => basename(e.path) === name)?.saved ?? "";
      assert.match(basename(saved), new RegExp(`^${name}-.+\\.patch$`), `${name}: its uncommitted changes are saved first`);
    }
    assert.ok(readFileSync(s.removed.find((e) => basename(e.path) === "records-b")!.saved!, "utf8").includes("+a records draft"), "the content of an untracked file is in the patch");
    assert.equal(existsSync(dirty8), true, "the dirty worktree at master stays (a fresh branch at master only looks merged)");
    assert.equal(spawnSync("git", ["rev-parse", "--verify", "-q", "refs/heads/chore/records-a"], { cwd: repo }).status, 0, "the branch of a removed worktree is never deleted");

    // a PR lookup that fails keeps every worktree on a branch
    const b = w489Wt(repo, "W-7-b", "scratch/W-7-b");
    const failed = w489Sweep(repo, studio, { prs: () => ({ error: "gh is offline" }), nowMs: Date.now() });
    assert.deepEqual(failed.removed, [], "nothing on a branch is removed while PR states cannot be read");
    assert.ok(failed.kept.some((e) => e.path === b && e.reason === "its PR cannot be read: gh is offline"), "the kept reason names the lookup error");
    assert.equal(existsSync(b), true, "the worktree stays");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("W-489-b3 behaviour 3: bisellium prune runs the sweep and prints each removed worktree, asking for PR states only when a worktree is a candidate", () => {
  const fx = w489Repo();
  try {
    const { repo, studio } = fx;
    writeOpus(studio, "W-7", "done");
    const a = w489Wt(repo, "W-7-a", "spec-scratch/W-7");
    writeFileSync(join(a, "notes.txt"), "W-7 notes\n");
    w489Wt(repo, "fresh-W-7", "chore/fresh", { young: true });
    const fake = w489Prs({ "spec-scratch/W-7": "NONE", "chore/fresh": "NONE" });
    const prune = (): string => {
      const orig = console.log;
      let out = "";
      console.log = (...parts: unknown[]) => void (out += parts.join(" ") + "\n");
      try {
        (runPrune as (args: string[], deps: unknown) => { exitCode: number })(["--studio", studio, "--repo", repo], { prs: fake.prs, nowMs: Date.now() });
      } finally {
        console.log = orig;
      }
      return out;
    };

    const first = prune().split("\n").filter(Boolean);
    const diffs = join(repo, ".bisellium", "worktree-diffs");
    assert.equal(first.length, 1, `one line, the removed worktree: ${first.join(" | ")}`);
    assert.match(first[0]!, new RegExp(`^worktree removed: ${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(opus W-7 done\\); uncommitted changes saved to ${diffs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/W-7-a-.+\\.patch$`), "prune prints the removed worktree, its reason and its patch");
    assert.equal(existsSync(a), false, "the worktree is gone");
    assert.deepEqual(fake.calls, [["spec-scratch/W-7"]], "the lookup is asked once, for the branch of the one candidate");
    assert.equal(prune(), "nothing to prune\n", "a second run finds nothing: a young worktree is kept silently");
    assert.equal(fake.calls.length, 1, "with no candidate the PR lookup is not asked");

    // a busy admin directory is named, and a later run clears it
    const c = w489Wt(repo, "W-7-c", undefined);
    chmodSync(w489Admin(repo), 0o555);
    let busy: string;
    try {
      busy = prune();
    } finally {
      chmodSync(w489Admin(repo), 0o755);
    }
    assert.deepEqual(
      busy.split("\n").filter(Boolean),
      [`worktree removed: ${c} (opus W-7 done); its admin directory is held busy, a later prune retries`, "worktree admin directories left: 1 (held busy; a later prune retries)"],
      "the removal and the busy admin directory are printed",
    );
    assert.equal(prune(), "nothing to prune\n", "a later run prunes the admin directory");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
