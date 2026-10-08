/**
 * W-166: a recorded red certifies the tree its brief names. Rows are named
 * `W-166-b<n> behaviour <n>: …` and selected with `--test-name-pattern=W-166-b<n>`.
 * node:test TAP. The `red` rows spawn the real CLI against real git fixtures
 * under os.tmpdir(); no timers, sleeps or polling.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { sourceTreeHash } from "@bisellium/shim";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "main.ts");
const REPO = join(HERE, "..", "..", "..");
const SAMPLE = join(REPO, "examples", "sample-studio");
/** tsx by absolute URL: a red under test runs with cwd in a scratch repository, where a bare "tsx" does not resolve. */
const TSX = import.meta.resolve("tsx");
const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

Object.assign(process.env, {
  LC_ALL: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "W-166 Test",
  GIT_AUTHOR_EMAIL: "w166@example.invalid",
  GIT_COMMITTER_NAME: "W-166 Test",
  GIT_COMMITTER_EMAIL: "w166@example.invalid",
});
delete process.env["BISELLIUM_SELLA"];

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function scratch(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `w166-${tag}-`)));
  dirs.push(d);
  return d;
}

/** Fixture git: the real binary by absolute path. */
function G(cwd: string, args: string[]): string {
  const r = spawnSync(REAL_GIT, args, { cwd, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed in ${cwd}: ${r.stderr}${r.stdout}`);
  return r.stdout.trim();
}
function put(dir: string, rel: string, text: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

/** A scratch repository on master with `src/a.txt` and a copy of the sample officina at `studio/`, all committed. */
function repoWithStudio(tag: string): string {
  const R = scratch(tag);
  G(R, ["init", "-q", "-b", "master"]);
  put(R, "src/a.txt", "one\n");
  cpSync(SAMPLE, join(R, "studio"), { recursive: true, dereference: true });
  G(R, ["add", "-A"]);
  G(R, ["commit", "-q", "-m", "fixture"]);
  return R;
}
/** A linked worktree of `R` detached at its HEAD. */
function linked(R: string, name: string): string {
  const wt = join(scratch(name), "wt");
  G(R, ["worktree", "add", "-q", "--detach", wt, "HEAD"]);
  return realpathSync(wt);
}

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}
/** The real `bisellium red <id> --behaviour <n> --sella eng-lead …` in `cwd`; `flags` go before the `--` command. */
function red(cwd: string, id: string, n: number, flags: string[], cmd: string[]): Ran {
  const r = spawnSync(
    process.execPath,
    ["--import", TSX, MAIN, "red", id, "--behaviour", String(n), "--sella", "eng-lead", "--now", "2026-10-02T12:00:00Z", ...flags, "--", ...cmd],
    { cwd, encoding: "utf8", timeout: 120_000, env: process.env },
  );
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const FAIL: string[] = ["node", "-e", "process.exit(1)"];
const logOf = (studio: string, id: string, k: number): string => join(studio, "ci", "reds", id, `${String(k).padStart(2, "0")}.log`);
const headerLine = (log: string, key: string): string => readFileSync(log, "utf8").split("\n").find((l) => l.startsWith(`# ${key}:`)) ?? "";

// ---------------------------------------------------------------------------
// 1. a red never certifies another repository; it hashes with the officina's exclusions in every worktree of the studio's repository
// ---------------------------------------------------------------------------
test("W-166-b1 behaviour 1: a linked-worktree red hashes with the studio's exclusions", () => {
  const M = repoWithStudio("b1-main");
  const WT = linked(M, "b1-wt");
  const studio = join(M, "studio");
  const r = red(M, "W-900", 1, ["--studio", studio, "--cwd", WT], FAIL);
  assert.equal(r.status, 0, `1a: the red records (${r.stderr})`);
  const expected = `tree:${sourceTreeHash(WT, ["studio", ".bisellium"], "HEAD")}`;
  assert.equal(headerLine(logOf(studio, "W-900", 1), "tree"), `# tree: ${expected}`, "1a: # tree: is the worktree's source tree under the studio exclusions");
});

test("W-166-b1 behaviour 1: a --repo that is another worktree is refused and nothing runs", () => {
  const M = repoWithStudio("b1-two");
  const A = linked(M, "b1-a");
  const B = linked(M, "b1-b");
  const studio = join(M, "studio");
  const redsDir = join(studio, "ci", "reds", "W-900");
  put(studio, "ci/reds/W-900/01.log", "PRESEEDED-01\n");
  const marker = join(A, "ran-here.txt");
  const r = red(M, "W-900", 2, ["--studio", studio, "--cwd", A, "--repo", B], ["node", "-e", "require('node:fs').writeFileSync('ran-here.txt','x');process.exit(1)"]);
  assert.equal(r.status, 2, `1b: a disagreeing --repo exits 2 (${r.stderr})`);
  assert.equal(existsSync(marker), false, "1b: the command never ran");
  assert.deepEqual(readdirSync(redsDir), ["01.log"], "1b: no log was written");
  assert.equal(readFileSync(join(redsDir, "01.log"), "utf8"), "PRESEEDED-01\n", "1b: the preseeded log is byte-identical");
  assert.ok(r.stderr.includes(A) && r.stderr.includes(B), `1b: the refusal names both roots (${r.stderr})`);
});

test("W-166-b1 behaviour 1: a symlinked spelling of the cwd's root is accepted", () => {
  const M = repoWithStudio("b1-link");
  const A = linked(M, "b1-linka");
  const spelled = join(scratch("b1-spell"), "alias");
  symlinkSync(A, spelled);
  const r = red(M, "W-900", 1, ["--studio", join(M, "studio"), "--cwd", A, "--repo", spelled], FAIL);
  assert.equal(r.status, 0, `1c: the symlinked --repo is the same root (${r.stderr})`);
});

test("W-166-b1 behaviour 1: a non-Git --repo still records unknown", () => {
  const M = repoWithStudio("b1-nongit");
  const plain = scratch("b1-plain");
  const studio = join(M, "studio");
  const r = red(M, "W-900", 1, ["--studio", studio, "--repo", plain], FAIL);
  assert.equal(r.status, 0, `1d: a non-Git --repo records (${r.stderr})`);
  assert.equal(headerLine(logOf(studio, "W-900", 1), "tree"), "# tree: unknown", "1d: no repository is certified");
});
