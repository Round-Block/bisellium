/**
 * W-379 rows b1-b4 (studio/briefs/W-379.md): `scripts/agent-workspace.sh guard` installs the hook guard from the
 * Patron's own clone at master, run as that clone's copy, removes W-362's old guard worktree only when GUARD_BIN
 * proves it, and runs every git but the fetch clean. node:test TAP, selected by `--test-name-pattern='^W-379-b<n>\s'`.
 * Every fixture (an origin, the Patron's clone, an agent clone, a home, a PATH) lives under the OS tmp dir; nothing here
 * reads or writes the real ~/.claude, ~/projects, ~/.local/bin or the agent clone.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "agent-workspace.sh");
const dirs: string[] = [];
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w379-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** git in a fixture, with a fixed identity and no global config; its trimmed stdout. */
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "init.defaultBranch=master", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function put(path: string, text: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  if (mode !== undefined) chmodSync(path, mode);
}
const head = (dir: string): string => git(dir, "rev-parse", "HEAD");
/** A path single-quoted for the shell, as the guard prints it. */
const sq = (p: string): string => `'${p.replace(/'/g, "'\\''")}'`;

type World = {
  f: string;
  patron: string;
  old: string;
  other: string;
  bin: string;
  origin: () => string;
  guard: (sub: string, env?: Record<string, string>, script?: string) => { code: number | null; out: string };
  linkOld: () => void;
};

/** The guard's world under a directory whose name holds a space, a quote and a non-ASCII letter: an origin holding a
 *  stand-in CLI, the real settings merge and this checkout's `agent-workspace.sh`; the Patron's clone one commit behind
 *  it (also reached through `patron link`), with W-362's old guard worktree (an ignored `node_modules` in it) and a
 *  second clean linked worktree, `other wt`; an agent clone; `bin/bisellium` linked into the old guard, as W-362
 *  installed it; a stand-in npm that logs. `guard(sub)` runs the Patron clone's copy of the script. */
function world(): World {
  const f = join(tmp(), "guard ü it's");
  mkdirSync(f);
  git(f, "init", "-q", "--bare", "origin.git");
  git(f, "init", "-q", "seed");
  const seed = join(f, "seed");
  put(join(seed, "x"), "x\n");
  put(join(seed, ".gitignore"), "node_modules/\n");
  put(join(seed, "packages", "cli", "bin", "bisellium.mjs"), '#!/usr/bin/env node\nconsole.log("guard: wired\\nguard: installed at " + process.argv[1] + "\\nguard: live (stub)");\n', 0o755);
  put(join(seed, "scripts", "agent-settings-merge.mjs"), readFileSync(join(REPO, "scripts", "agent-settings-merge.mjs"), "utf8"));
  copyFileSync(SCRIPT, join(seed, "scripts", "agent-workspace.sh"));
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "one");
  git(seed, "push", "-q", join(f, "origin.git"), "master");
  git(f, "clone", "-q", join(f, "origin.git"), "patron");
  const patron = join(f, "patron");
  symlinkSync(patron, join(f, "patron link"));
  const old = join(f, "old guard");
  git(patron, "worktree", "add", "-q", "--detach", old, "origin/master");
  put(join(old, "node_modules", "m"), "m\n");
  const other = join(f, "other wt");
  git(patron, "worktree", "add", "-q", "--detach", other, "origin/master");
  put(join(seed, "x"), "y\n");
  git(seed, "commit", "-qam", "two");
  git(seed, "push", "-q", join(f, "origin.git"), "master");
  git(f, "init", "-q", "agent");
  const bin = join(f, "bin", "bisellium");
  mkdirSync(dirname(bin));
  const linkOld = (): void => {
    rmSync(bin, { force: true });
    symlinkSync(join(old, "packages", "cli", "bin", "bisellium.mjs"), bin);
  };
  linkOld();
  put(join(f, "stub", "npm"), '#!/bin/sh\necho "npm $* in $(pwd -P)" >> "$HOME/npm.log"\n', 0o755);
  const guard = (sub: string, env: Record<string, string> = {}, script = join(patron, "scripts", "agent-workspace.sh")): { code: number | null; out: string } => {
    const r = spawnSync("bash", [script, sub], {
      encoding: "utf8",
      env: { PATH: [join(f, "stub"), join(f, "bin"), dirname(process.execPath), "/usr/bin", "/bin"].join(":"), HOME: f, PATRON_DIR: patron, AGENT_DIR: join(f, "agent"), GUARD_BIN: bin, AGENT_GH: join(f, "gh"), OLD_GUARD_DIR: old, ...env },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { f, patron, old, other, bin, origin: () => git(join(f, "origin.git"), "rev-parse", "master"), guard, linkOld };
}

test("W-379-b1 behaviour 1: guard and guard-check refuse a PATRON_DIR off master or with a tracked change, changing nothing", () => {
  const w = world();
  const was = head(w.patron);
  const target = readlinkSync(w.bin);
  for (const [what, setup, undo, why] of [
    ["PATRON_DIR off master", () => git(w.patron, "checkout", "-q", "-b", "side"), () => git(w.patron, "checkout", "-q", "master"), /^PATRON_DIR .* is on refs\/heads\/side, not master; the guard runs only while it is on master$/m],
    ["PATRON_DIR detached", () => git(w.patron, "checkout", "-q", "--detach"), () => git(w.patron, "checkout", "-q", "master"), /^PATRON_DIR .* is on detached, not master; the guard runs only while it is on master$/m],
    ["PATRON_DIR with a tracked change", () => writeFileSync(join(w.patron, "x"), "mine\n"), () => git(w.patron, "checkout", "-q", "--", "x"), /^PATRON_DIR .* has uncommitted tracked changes \( M x\); the guard runs only while it is on a clean master$/m],
  ] as const) {
    setup();
    const checked = w.guard("guard-check");
    assert.equal(checked.code, 1, `${what}: guard-check exits 1: ${checked.out}`);
    assert.match(checked.out, why, `${what}: guard-check names the reason`);
    const r = w.guard("guard");
    assert.equal(r.code, 1, `${what}: guard exits 1: ${r.out}`);
    assert.match(r.out, why, `${what}: guard names the reason`);
    assert.match(r.out, /\(nothing was changed\)\.$/m, `${what}: nothing was changed`);
    assert.equal(readlinkSync(w.bin), target, `${what}: GUARD_BIN still leads into the old guard`);
    assert.equal(existsSync(join(w.f, "npm.log")), false, `${what}: npm did not run`);
    assert.equal(existsSync(join(w.f, ".claude", "settings.json")), false, `${what}: the user settings were not written`);
    assert.ok(existsSync(join(w.old, "x")), `${what}: the old guard worktree stays`);
    const verify = w.guard("verify");
    assert.match(verify.out, /^FAIL the hook guard's installer inputs hold/m, `${what}: verify fails the inputs`);
    // verify's settings check runs the merge script's main and writes the user settings (W-362's, unchanged: a limit)
    rmSync(join(w.f, ".claude"), { recursive: true, force: true });
    undo();
  }
  assert.equal(head(w.patron), was, "the refusals moved nothing");
  // an untracked file is not a tracked change (a stated limit, not a refusal)
  writeFileSync(join(w.patron, "scratch"), "untracked\n");
  const untracked = w.guard("guard-check");
  assert.doesNotMatch(untracked.out, /PATRON_DIR .* (is on|has uncommitted)/, "an untracked file in PATRON_DIR is not refused");
});

test("W-379-b2 behaviour 2: guard installs only as PATRON_DIR's own copy: it fast-forwards the clone's master and links GUARD_BIN into it", () => {
  const w = world();
  const was = head(w.patron);
  const target = readlinkSync(w.bin);
  const patronReal = realpathSync(w.patron);
  // a copy of the script outside PATRON_DIR/scripts changes nothing: this checkout's, and the old guard worktree's
  for (const [what, script] of [
    ["a script outside PATRON_DIR", SCRIPT],
    ["the old guard worktree's copy", join(w.old, "scripts", "agent-workspace.sh")],
  ] as const) {
    const r = w.guard("guard", {}, script);
    assert.equal(r.code, 1, `${what}: exits 1: ${r.out}`);
    assert.match(r.out, new RegExp(`^run the guard step as ${reEsc(patronReal)}/scripts/agent-workspace\\.sh, the copy in the clone it installs, not the copy in .* \\(nothing was changed\\)\\.$`, "m"), `${what}: the reason`);
    assert.equal(readlinkSync(w.bin), target, `${what}: GUARD_BIN did not move`);
    assert.equal(head(w.patron), was, `${what}: the Patron's clone did not move`);
    assert.equal(existsSync(join(w.f, "npm.log")), false, `${what}: npm did not run`);
    assert.equal(existsSync(join(w.f, ".claude", "settings.json")), false, `${what}: the user settings were not written`);
  }
  // the clone's own copy, PATRON_DIR given through a symlink: the clone fast-forwards and GUARD_BIN leads into it
  const r = w.guard("guard", { PATRON_DIR: join(w.f, "patron link") }, join(w.f, "patron link", "scripts", "agent-workspace.sh"));
  assert.equal(r.code, 0, `the Patron clone's script installs: ${r.out}`);
  assert.equal(head(w.patron), w.origin(), "the Patron's clone is at origin/master");
  assert.equal(git(w.patron, "symbolic-ref", "HEAD"), "refs/heads/master", "on master");
  assert.equal(readlinkSync(w.bin), join(patronReal, "packages", "cli", "bin", "bisellium.mjs"), "GUARD_BIN links into PATRON_DIR's real path");
  assert.match(readFileSync(join(w.f, "npm.log"), "utf8"), new RegExp(`^npm ci --silent in ${reEsc(patronReal)}$`, "m"), "npm ci ran in PATRON_DIR");
  const settings = JSON.parse(readFileSync(join(w.f, ".claude", "settings.json"), "utf8")) as { sandbox: { filesystem: { denyWrite: string[] } } };
  assert.equal(settings.sandbox.filesystem.denyWrite[0], patronReal, "the settings deny writes to the Patron's clone");
  assert.match(r.out, /^guard: installed from .*patron link at [0-9a-f]{7,}$/m, "the install names the Patron's clone");
  const verify = w.guard("verify");
  assert.match(verify.out, /^ok the hook guard's installer inputs hold \(PATH, PATRON_DIR on master, GUARD_BIN\)$/m, "verify: the inputs hold");
  assert.match(verify.out, /^ok GUARD_BIN leads into PATRON_DIR$/m, "verify: GUARD_BIN leads into PATRON_DIR");
  // a master that does not fast-forward (a local commit, origin moved on) stops it after the fetch
  writeFileSync(join(w.patron, "x"), "local\n");
  git(w.patron, "commit", "-qam", "local");
  const seed = join(w.f, "seed");
  writeFileSync(join(seed, "x"), "origin's\n");
  git(seed, "commit", "-qam", "three");
  git(seed, "push", "-q", join(w.f, "origin.git"), "master");
  const diverged = w.guard("guard");
  assert.equal(diverged.code, 1, `a diverged master stops it: ${diverged.out}`);
  assert.match(diverged.out, /^PATRON_DIR's master does not fast-forward to origin\/master; see git's line above \(only origin\/master was fetched\)\.$/m, "a diverged master: the reason");
});

