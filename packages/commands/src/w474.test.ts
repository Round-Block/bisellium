/**
 * W-474 rows (studio/briefs/W-474.md): `bisellium run --scratch <dir>` runs a command in a copy of a repository that
 * borrows its git objects, deletes the copy when the command ends or the run is signalled, and refuses the next copy
 * when the folder holds 3 GiB or more. node:test TAP, selected by `--test-name-pattern='^W-474-b<n>\s'`. Each row runs
 * the CLI as a child (`node --import tsx packages/cli/src/main.ts run --scratch …`) against a fixture repository and
 * folders under the OS tmp dir; nothing reads or writes the real repository, `studio/` or the evidence folders.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MAIN = join(REPO, "packages", "cli", "src", "main.ts");
const TSX = import.meta.resolve("tsx");
const CAP = 3 * 1024 ** 3;
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

  const linked = fixtureRepo();
  const target = join(tmp("modules"), "node_modules");
  renameSync(join(linked.root, "node_modules"), target);
  symlinkSync(target, join(linked.root, "node_modules"));
  const out4 = join(tmp("out"), "facts.json");
  const r4 = cli(REPO, ["--scratch", folder, "--repo", linked.root, "--", process.execPath, "-e", FACTS, out4, "0"]);
  const f4 = facts(out4);
  assert.ok(r4.status === 0 && f4 !== undefined && f4.dep === "" && f4.pkg === "", "a symlinked top-level node_modules is not linked");
});

/** A run whose command prints `<its pid> <its cwd>` and then blocks reading stdin; `trap` makes it ignore SIGTERM. */
function startBlocked(folder: string, root: string, trap: string): { p: ChildProcess; line: Promise<string | undefined>; exit: Promise<number | null> } {
  const p = spawn(process.execPath, ["--import", TSX, MAIN, "run", "--scratch", folder, "--repo", root, "--", "sh", "-c", `${trap}echo "$$ $PWD"; read x`], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
  const exit = new Promise<number | null>((res) => p.on("exit", (code) => res(code)));
  const line = new Promise<string | undefined>((res) => {
    let buf = "";
    p.stdout!.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      const i = buf.indexOf("\n");
      if (i >= 0) res(buf.slice(0, i));
    });
    p.on("exit", () => res(undefined));
  });
  return { p, line, exit };
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("W-474-b2 behaviour 2: a run --scratch stopped by SIGINT, SIGTERM or SIGHUP stops its command, deletes the copy and exits 128 plus the signal", { timeout: 180_000 }, async () => {
  const { root } = fixtureRepo();
  const cases: [NodeJS.Signals, number, string][] = [
    ["SIGTERM", 143, ""],
    ["SIGINT", 130, ""],
    ["SIGHUP", 129, ""],
    ["SIGTERM", 143, 'trap "" TERM; '],
  ];
  for (const [sig, code, trap] of cases) {
    const name = trap === "" ? sig : `${sig}, ignored by the command`;
    const folder = tmp("folder");
    const run = startBlocked(folder, root, trap);
    const line = await run.line;
    const [pid, cwd] = (line ?? "").split(" ");
    assert.ok(line !== undefined && dirname(cwd ?? "") === folder && /^scratch\.[A-Za-z0-9]{6}$/.test(basename(cwd ?? "")), `${name}: the command starts in a copy under the folder`);
    run.p.kill(sig);
    assert.equal(await run.exit, code, `${name}: the run exits ${code}`);
    assert.equal(alive(Number(pid)), false, `${name}: the command is stopped`);
    assert.deepEqual(readdirSync(folder), [], `${name}: the copy is gone`);
  }
});

const refusal = (m: string): string => `bisellium run --scratch: ${m}\n`;
const sparse = (file: string, size: number): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "");
  truncateSync(file, size);
};

test("W-474-b3 behaviour 3: run --scratch refuses the next copy when the folder holds 3 GiB or more, and on a bad folder, repository, base or flag, before any copy is made", () => {
  const { root } = fixtureRepo();
  const marker = join(tmp("out"), "ran");
  const cmd = ["--", "sh", "-c", `echo ran > ${marker}`];

  const full = tmp("folder");
  sparse(join(full, "big"), CAP);
  const r1 = cli(REPO, ["--scratch", full, "--repo", root, ...cmd]);
  assert.equal(r1.stderr, refusal(`${full} holds 3.00 GiB, at or over the 3.00 GiB cap of one opus's folder; no copy is made`), "a folder at the cap refuses the copy, naming the cap");
  assert.equal(r1.status, 2, "the refusal exits 2");
  assert.ok(!existsSync(marker) && JSON.stringify(readdirSync(full)) === JSON.stringify(["big"]), "at the cap nothing runs and no copy is made");

  const deep = tmp("folder");
  sparse(join(deep, "r2", "big"), CAP + 1);
  const r2 = cli(REPO, ["--scratch", deep, "--repo", root, ...cmd]);
  assert.equal(r2.stderr, refusal(`${deep} holds 3.00 GiB, at or over the 3.00 GiB cap of one opus's folder; no copy is made`), "a file in a subfolder counts toward the cap");

  truncateSync(join(full, "big"), CAP - 1);
  const r3 = cli(REPO, ["--scratch", full, "--repo", root, ...cmd]);
  assert.ok(r3.status === 0 && existsSync(marker), "a folder one byte under the cap copies and runs");
  assert.deepEqual(readdirSync(full), ["big"], "and its copy is gone after");
  rmSync(marker);

  const linked = tmp("folder");
  const elsewhere = join(tmp("elsewhere"), "big");
  sparse(elsewhere, CAP);
  symlinkSync(elsewhere, join(linked, "big"));
  const r4 = cli(REPO, ["--scratch", linked, "--repo", root, ...cmd]);
  assert.ok(r4.status === 0 && existsSync(marker), "a link to a large file is not counted");
  rmSync(marker);

  const folder = tmp("folder");
  const notGit = tmp("plain");
  const refusals: [string, string[], string][] = [
    ["a folder that does not exist", ["--scratch", join(folder, "missing"), "--repo", root, ...cmd], refusal(`${join(folder, "missing")} is not a directory`)],
    ["a repository that is not one", ["--scratch", folder, "--repo", notGit, ...cmd], refusal(`${notGit} is not inside a git repository`)],
    ["a base that is not a commit", ["--scratch", folder, "--repo", root, "--base", "no-such-ref", ...cmd], refusal(`no-such-ref is not a commit in ${root}`)],
  ];
  for (const [what, args, stderr] of refusals) {
    const r = cli(REPO, args);
    assert.ok(r.status === 2 && r.stderr === stderr, `${what} refuses with exit 2`);
    assert.ok(!existsSync(marker) && readdirSync(folder).length === 0, `${what}: nothing runs and no copy is made`);
  }
  const flags: [string, string[], string][] = [
    ["--sella", ["--scratch", folder, "--sella", "architect", ...cmd], "bisellium run --scratch: --sella does not go with --scratch"],
    ["--keep", ["--scratch", folder, "--keep", ...cmd], "bisellium run --scratch: --keep does not go with --scratch"],
    ["no command", ["--scratch", folder, "--repo", root, "--"], 'bisellium run --scratch: a command after "--" is required'],
  ];
  for (const [what, args, first] of flags) {
    const r = cli(REPO, args);
    assert.ok(r.status === 2 && r.stderr.split("\n")[0] === first, `${what} refuses with exit 2 and its reason first`);
    assert.ok(!existsSync(marker) && readdirSync(folder).length === 0, `${what}: nothing runs and no copy is made`);
  }
  const unknown = cli(REPO, ["--scratch", folder, "--no-such-flag", ...cmd]);
  assert.ok(unknown.status === 2 && unknown.stderr.split("\n")[0] === "bisellium run --scratch: --no-such-flag does not go with --scratch", "an unknown flag refuses with exit 2 and the scratch reason first");
  assert.ok(!existsSync(marker) && readdirSync(folder).length === 0, "an unknown flag: nothing runs and no copy is made");

  const other = tmp("folder");
  const grammar: [string, string[], string][] = [
    ["a repeated --scratch", ["--scratch", folder, "--scratch", other, "--repo", root, ...cmd], "bisellium run --scratch: --scratch is given more than once"],
    ["a repeated --repo", ["--scratch", folder, "--repo", root, "--repo", root, ...cmd], "bisellium run --scratch: --repo is given more than once"],
    ["a repeated --base", ["--scratch", folder, "--repo", root, "--base", "HEAD", "--base", "HEAD", ...cmd], "bisellium run --scratch: --base is given more than once"],
    ["a positional", ["--scratch", folder, "stray", ...cmd], "bisellium run --scratch: stray does not go with --scratch"],
    ["a flag missing its value", ["--scratch", folder, "--repo"], "bisellium run --scratch: --repo needs a value"],
    ["the first wrong token", ["--scratch", folder, "--sella", "architect", "--scratch", other, ...cmd], "bisellium run --scratch: --sella does not go with --scratch"],
    ["a terminal stray", ["--scratch", folder, "stray"], "bisellium run --scratch: stray does not go with --scratch"],
    ["a terminal repeated --scratch", ["--scratch", folder, "--scratch"], "bisellium run --scratch: --scratch is given more than once"],
  ];
  for (const [what, args, first] of grammar) {
    const r = cli(REPO, args);
    assert.ok(r.status === 2 && r.stderr.split("\n")[0] === first, `${what} refuses with exit 2 and its reason first`);
    assert.ok(!existsSync(marker) && readdirSync(folder).length === 0 && readdirSync(other).length === 0, `${what}: nothing runs and no copy is made`);
  }
  const reordered = cli(REPO, ["--repo", root, "--scratch", folder, ...cmd]);
  assert.ok(reordered.status === 0 && existsSync(marker), "--repo before --scratch is recognised");
  assert.deepEqual(readdirSync(folder), [], "and its copy is gone after");
  rmSync(marker);

  const parent = tmp("parent");
  mkdirSync(join(parent, "--dashes"));
  const dashed = cli(parent, ["--scratch", "--dashes", "--repo", root, ...cmd]);
  assert.ok(dashed.status === 0 && existsSync(marker), "a folder whose name begins with dashes is recognised");
  assert.deepEqual(readdirSync(join(parent, "--dashes")), [], "and its copy is gone after");
  rmSync(marker);

  const odd = fixtureRepo();
  const oddRoot = join(parent, "--repo-dir");
  renameSync(odd.root, oddRoot);
  const dashedRepo = cli(parent, ["--scratch", folder, "--repo", "--repo-dir", ...cmd]);
  assert.ok(dashedRepo.status === 0 && existsSync(marker), "a repository whose path begins with dashes is recognised");
  rmSync(marker);

  git(root, "update-ref", "refs/heads/--odd-base", "HEAD");
  const dashedBase = cli(REPO, ["--scratch", folder, "--repo", root, "--base", "--odd-base", ...cmd]);
  assert.ok(dashedBase.status === 0 && existsSync(marker), "a base whose text begins with dashes is recognised");
  rmSync(marker);

  const bare = tmp("bare");
  const bareRepo = fixtureRepo();
  renameSync(bareRepo.root, join(bare, "--"));
  git(join(bare, "--"), "update-ref", "refs/heads/--", "HEAD");
  const dashesOnly = cli(bare, ["--scratch", "--", "--repo", "--", "--base", "--", "--", ...cmd.slice(1)]);
  assert.ok(dashesOnly.status === 0 && existsSync(marker), 'a folder, repository and base that are exactly "--" are recognised');
});
