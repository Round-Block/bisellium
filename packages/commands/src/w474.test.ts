/**
 * W-474 rows (studio/briefs/W-474.md): `bisellium run --scratch <dir>` runs a command in a copy of a repository that
 * borrows its git objects, deletes the copy when the command ends or the run is signalled, and refuses the next copy
 * when the folder holds 3 GiB or more. node:test TAP, selected by `--test-name-pattern='^W-474-b<n>\s'`. Each row runs
 * the CLI as a child (`node --import tsx packages/cli/src/main.ts run --scratch …`) against a fixture repository and
 * folders under the OS tmp dir; nothing reads or writes the real repository, `studio/` or the evidence folders.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAIN = join(REPO, "packages", "cli", "src", "main.ts");
const TSX = import.meta.resolve("tsx");
const dirs: string[] = [];
const tmp = (tag: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w474-${tag}-`)));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", ["-c", "user.name=w474", "-c", "user.email=w474@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A fixture repository: a.txt "one" at c1 and "two" at c2 (HEAD), a workspace package, and an untracked node_modules
 * holding a dependency directory and a workspace link `@bisellium/pkg -> ../../packages/pkg`. */
function fixtureRepo(): { root: string; c1: string } {
  const root = tmp("repo");
  git(root, "init", "-q", "-b", "master");
  mkdirSync(join(root, "packages", "pkg"), { recursive: true });
  writeFileSync(join(root, "packages", "pkg", "name.txt"), "pkg\n");
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  writeFileSync(join(root, "a.txt"), "one");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "c1");
  const c1 = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "a.txt"), "two");
  git(root, "commit", "-q", "-am", "c2");
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  mkdirSync(join(root, "node_modules", "@bisellium"));
  symlinkSync(join("..", "..", "packages", "pkg"), join(root, "node_modules", "@bisellium", "pkg"));
  return { root, c1 };
}

const cli = (cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSync(process.execPath, ["--import", TSX, MAIN, "run", ...args], { cwd, encoding: "utf8", timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

/** The command the copy runs: it writes what it sees to argv[1] and exits with argv[2]. */
const FACTS = `const fs = require("fs"), path = require("path");
const [out, code] = process.argv.slice(1);
const objects = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else objects.push(path.relative(".git/objects", p)); } })(".git/objects");
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const real = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : "");
fs.writeFileSync(out, JSON.stringify({ cwd: process.cwd(), env: process.env.BISELLIUM_SCRATCH, a: read("a.txt"), alternates: read(".git/objects/info/alternates"), objects, pkg: real("node_modules/@bisellium/pkg"), dep: real("node_modules/dep") }));
process.exit(Number(code));`;
interface Facts {
  cwd: string;
  env: string;
  a: string;
  alternates: string;
  objects: string[];
  pkg: string;
  dep: string;
}
const facts = (file: string): Facts | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Facts) : undefined);

test("W-474-b1 behaviour 1: run --scratch runs the command in a copy at the base that borrows the repository's objects and links its node_modules, passes its exit status through and deletes the copy", () => {
  const { root, c1 } = fixtureRepo();
  const folder = tmp("folder");
  const out1 = join(tmp("out"), "facts.json");
  const r1 = cli(REPO, ["--scratch", folder, "--repo", root, "--base", c1, "--", process.execPath, "-e", FACTS, out1, "0"]);
  const f1 = facts(out1);
  assert.ok(r1.status === 0 && f1 !== undefined && dirname(f1.cwd) === folder && /^scratch\.[A-Za-z0-9]{6}$/.test(basename(f1.cwd)), "the command runs in a copy under the folder");
  assert.equal(f1.env, f1.cwd, "the copy names itself in BISELLIUM_SCRATCH");
  assert.equal(f1.a, "one", "the copy is at the base commit");
  assert.ok(f1.alternates === `${join(root, ".git", "objects")}\n` && JSON.stringify(f1.objects) === JSON.stringify(["info/alternates"]), "the copy borrows the repository's objects and holds none of its own");
  assert.equal(f1.pkg, join(f1.cwd, "packages", "pkg"), "a workspace link resolves inside the copy");
  assert.equal(f1.dep, join(root, "node_modules", "dep"), "a dependency links to the repository's");
  assert.deepEqual(readdirSync(folder), [], "the copy is gone when the command passes");

  const out2 = join(tmp("out"), "facts.json");
  const r2 = cli(root, ["--scratch", folder, "--", process.execPath, "-e", FACTS, out2, "3"]);
  assert.equal(r2.status, 3, "the command's exit status is the run's");
  assert.equal(facts(out2)?.a, "two", "the default is the current directory's repository at HEAD");
  assert.deepEqual(readdirSync(folder), [], "the copy is gone when the command fails");

  const r3 = cli(REPO, ["--scratch", folder, "--repo", root, "--", join(folder, "no-such-command")]);
  assert.equal(r3.status, 127, "a command that cannot start exits 127");
  assert.deepEqual(readdirSync(folder), [], "the copy is gone when the command cannot start");
});
