import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pruneStaleOpusBranches } from "./prune.js";

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
    assert.ok(result.kept.some((k) => k.branch === "opus/W-101"));
  });

  it("3: keeps an unmerged branch even if opus is done", () => {
    writeOpus(studio, "W-102", "done");
    git(["branch", "opus/W-102"], repo);
    git(["checkout", "opus/W-102"], repo);
    git(["-c", "user.name=test", "-c", "user.email=test@test", "commit", "--allow-empty", "-m", "diverge"], repo);
    git(["checkout", "master"], repo);
    const result = pruneStaleOpusBranches(repo, studio);
    assert.equal(result.removed.length, 0);
    assert.ok(result.kept.some((k) => k.branch === "opus/W-102"));
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
