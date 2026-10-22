/**
 * W-362 row b3 (studio/briefs/W-362.md): the guard installer `scripts/agent-workspace.sh guard` and its input
 * checks, and the merge rung under the sandbox's deny on the agent clone's source. node:test TAP, selected by
 * `--test-name-pattern='^W-362-b<n>\s'`. Every fixture (clones, a home, a PATH) lives under the OS tmp dir; nothing
 * here reads or writes the real ~/.claude, ~/projects or the agent clone.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w362-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** git in a fixture, with a fixed identity; its trimmed stdout. */
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "init.defaultBranch=master", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function exe(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

/** A stand-in for the CLI the guard worktree holds: `hooks check` prints the probe's three lines, or fails when asked. */
const STUB_CLI = '#!/usr/bin/env node\nif (process.env.W362_PROBE_FAIL) { console.log("guard: dead (stub)"); process.exit(1); }\nconsole.log("guard: wired\\nguard: installed at " + process.argv[1] + "\\nguard: live (stub: " + process.argv.slice(2).join(" ") + ")");\n';

/** The installer's world under a directory whose name holds a space, a quote and a non-ASCII letter: an origin holding
 *  the stub CLI and the settings merge, the Patron's clone with a guard worktree one commit behind origin, an unrelated
 *  clone, an agent clone reached through a symlink (its `bin/bisellium` a link to an outside one), `bin/` (GUARD_BIN's directory, empty), `stub/` (npm and gh stand-ins
 *  that log and fail closed) and `early/`, `late/` and `file/`, each holding a plain `bisellium`. */
function installFixture(): string {
  const f = join(tmp(), "inst ü it's");
  mkdirSync(f);
  git(f, "init", "-q", "--bare", "origin.git");
  git(f, "init", "-q", "seed");
  const seed = join(f, "seed");
  writeFileSync(join(seed, "x"), "x\n");
  exe(join(seed, "packages", "cli", "bin", "bisellium.mjs"), STUB_CLI);
  mkdirSync(join(seed, "scripts"));
  copyFileSync(join(REPO, "scripts", "agent-settings-merge.mjs"), join(seed, "scripts", "agent-settings-merge.mjs"));
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "one");
  git(seed, "remote", "add", "origin", join(f, "origin.git"));
  git(seed, "push", "-q", "origin", "master");
  git(f, "clone", "-q", join(f, "origin.git"), "patron");
  symlinkSync(join(f, "patron"), join(f, "patron link"));
  git(join(f, "patron"), "worktree", "add", "-q", "--detach", join(f, "guard"), "origin/master");
  writeFileSync(join(seed, "x"), "y\n");
  git(seed, "commit", "-qam", "two");
  git(seed, "push", "-q", "origin", "master");
  git(f, "clone", "-q", join(f, "origin.git"), "unrelated");
  git(f, "init", "-q", "agent");
  symlinkSync(join(f, "agent"), join(f, "agent link"));
  for (const d of ["bin", "other"]) mkdirSync(join(f, d));
  symlinkSync(join(f, "bin"), join(f, "bin link"));
  for (const d of ["early", "late", "file"]) exe(join(f, d, "bisellium"), "#!/bin/sh\nexit 0\n");
  mkdirSync(join(f, "agent", "bin"));
  symlinkSync(join(f, "late", "bisellium"), join(f, "agent", "bin", "bisellium"));
  exe(join(f, "stub", "npm"), '#!/bin/sh\necho "npm $* in $(pwd -P)" >> "$HOME/npm.log"\n');
  exe(join(f, "stub", "gh"), "#!/bin/sh\nexit 1\n");
  return f;
}
const pathOf = (f: string, ...entries: string[]): string => [join(f, "stub"), ...entries, dirname(process.execPath), "/usr/bin", "/bin"].join(":");
/** `scripts/agent-workspace.sh <sub…>` on the fixture, `env` over its defaults: exit code and output. */
const install = (f: string, env: Record<string, string>, ...sub: string[]): { code: number | null; out: string } => installWith(join(REPO, "scripts", "agent-workspace.sh"), f, env, ...sub);
function installWith(script: string, f: string, env: Record<string, string>, ...sub: string[]): { code: number | null; out: string } {
  const r = spawnSync("bash", [script, ...(sub.length ? sub : ["guard-check"])], {
    encoding: "utf8",
    env: {
      PATH: pathOf(f, join(f, "bin")),
      HOME: f,
      PATRON_DIR: join(f, "patron"),
      AGENT_DIR: join(f, "agent link"),
      GUARD_DIR: join(f, "guard"),
      GUARD_BIN: join(f, "bin", "bisellium"),
      AGENT_GH: join(f, "gh"),
      ...env,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test("W-362-b3 behaviour 3: the guard installer judges its inputs before any change, then installs the guard outside the agent clone", () => {
  const f = installFixture();
  const valid: [Record<string, string>, string][] = [
    [{}, "valid installer inputs"],
    [{ PATH: pathOf(f, join(f, "bin"), join(f, "late")) }, "a bisellium later on PATH than GUARD_BIN's directory (spec-5 finding 1)"],
    [{ PATH: pathOf(f, join(f, "bin link")) }, "a PATH entry that is a symlink to GUARD_BIN's directory"],
    [{ GUARD_DIR: join(f, "new guard") }, "an absent GUARD_DIR under an existing directory"],
  ];
  for (const [env, what] of valid) {
    const r = install(f, env);
    assert.equal(r.code, 0, `${what}: ${r.out}`);
    assert.match(r.out, /^guard inputs: ok$/m, what);
  }
  const dirty = join(f, "guard", "x");
  const bad: [Record<string, string>, RegExp, string][] = [
    [{ GUARD_DIR: join(f, "patron") }, /GUARD_DIR .* is PATRON_DIR itself/, "GUARD_DIR the Patron's clone itself (spec-5 finding 2)"],
    [{ GUARD_DIR: join(f, "patron link") }, /GUARD_DIR .* is PATRON_DIR itself/, "GUARD_DIR the Patron's clone through a symlink"],
    [{ GUARD_DIR: join(f, "unrelated") }, /GUARD_DIR .* is not a linked worktree of PATRON_DIR/, "an unrelated clone as GUARD_DIR"],
    [{ GUARD_DIR: join(f, "agent link", "guard") }, /GUARD_DIR .* is inside AGENT_DIR/, "GUARD_DIR inside AGENT_DIR, through its symlink"],
    [{ GUARD_DIR: "guard" }, /GUARD_DIR guard is not an absolute path/, "a relative GUARD_DIR"],
    [{ GUARD_DIR: join(f, "missing", "guard") }, /GUARD_DIR .* has no parent directory/, "GUARD_DIR under a missing directory"],
    [{ PATH: pathOf(f, join(f, "early"), join(f, "bin")) }, /an earlier bisellium on PATH \(.*early\/bisellium\) is not GUARD_BIN/, "a different earlier bisellium on PATH"],
    [{ PATH: pathOf(f, join(f, "agent link"), join(f, "bin")) }, /a PATH entry inside AGENT_DIR .* comes before GUARD_BIN's directory/, "an agent-clone PATH entry before GUARD_BIN's directory"],
    [{ PATH: `${join(f, "stub")}:.:${join(f, "bin")}:/usr/bin:/bin` }, /a relative PATH entry \('\.'\) comes before GUARD_BIN's directory/, "a relative PATH entry first"],
    [{ PATH: `${join(f, "stub")}::${join(f, "bin")}:/usr/bin:/bin` }, /a relative PATH entry \(''\) comes before GUARD_BIN's directory/, "an empty PATH entry first"],
    [{ GUARD_BIN: join(f, "agent link", "bin", "bisellium"), PATH: pathOf(f, join(f, "agent link", "bin")) }, /GUARD_BIN .* is inside AGENT_DIR/, "GUARD_BIN inside AGENT_DIR (spec-2 finding 2)"],
    [{ GUARD_BIN: "bin/bisellium" }, /GUARD_BIN bin\/bisellium is not an absolute path/, "a relative GUARD_BIN"],
    [{ GUARD_BIN: join(f, "other", "bisellium") }, /GUARD_BIN's directory .*other is not on PATH/, "GUARD_BIN off PATH"],
    [{ GUARD_BIN: join(f, "file", "bisellium"), PATH: pathOf(f, join(f, "file")) }, /GUARD_BIN .* exists and is not a link/, "GUARD_BIN a regular file"],
    [{ GUARD_BIN: join(f, "bin", "bis") }, /GUARD_BIN .* is not named bisellium/, "GUARD_BIN with another name"],
    [{ GUARD_BIN: join(f, "nowhere", "bisellium") }, /GUARD_BIN's directory .*nowhere does not exist/, "GUARD_BIN's directory missing"],
    [{ PATRON_DIR: join(f, "agent") }, /PATRON_DIR .* is not the top of a git checkout holding origin\/master/, "PATRON_DIR without origin/master"],
    [{ AGENT_DIR: join(f, "early") }, /AGENT_DIR .* is not the top of a git checkout/, "AGENT_DIR not a checkout"],
    [{ AGENT_DIR: join(f, "patron") }, /PATRON_DIR and AGENT_DIR are one inside the other/, "AGENT_DIR the Patron's clone"],
  ];
  for (const [env, why, what] of bad) {
    const r = install(f, env);
    assert.equal(r.code, 1, `${what}: ${r.out}`);
    assert.match(r.out, why, what);
    assert.doesNotMatch(r.out, /guard inputs: ok/, what);
  }
  writeFileSync(dirty, "local edit\n");
  const edited = install(f, {});
  assert.equal(edited.code, 1, "a guard worktree with local changes");
  assert.match(edited.out, /GUARD_DIR .* has uncommitted changes/);
  git(join(f, "guard"), "checkout", "--", "x");
  // an invalid input changes nothing: the Patron's clone stays on master, no link, no settings, no npm
  const head = git(join(f, "patron"), "rev-parse", "HEAD");
  const refused = install(f, { GUARD_DIR: join(f, "patron") }, "guard");
  assert.equal(refused.code, 1, "the install stops on invalid inputs");
  assert.match(refused.out, /nothing was changed/);
  assert.equal(git(join(f, "patron"), "symbolic-ref", "HEAD"), "refs/heads/master", "the Patron's clone is not detached");
  assert.equal(git(join(f, "patron"), "rev-parse", "HEAD"), head, "the Patron's clone is not moved");
  assert.equal(existsSync(join(f, "bin", "bisellium")), false, "no link was made");
  assert.equal(existsSync(join(f, ".claude", "settings.json")), false, "the user settings were not written");
  assert.equal(existsSync(join(f, "npm.log")), false, "npm did not run");
  // the agent clone's own copy of the script never installs (the install runs unsandboxed)
  const copy = join(f, "agent", "scripts", "agent-workspace.sh");
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(join(REPO, "scripts", "agent-workspace.sh"), copy);
  const fromAgent = installWith(copy, f, {}, "guard");
  assert.equal(fromAgent.code, 1, "the agent clone's copy refuses the install");
  assert.match(fromAgent.out, /never the agent clone's \(nothing was changed\)/, "the agent clone's copy names the route");
  assert.equal(existsSync(join(f, "bin", "bisellium")), false, "no link was made from the agent clone's copy");
  // valid inputs: the guard worktree moves to origin/master, npm ci runs there, GUARD_BIN links into it, the user
  // settings gain the sandbox deny on the agent clone's real source folders, and the probe passes
  const done = install(f, {}, "guard");
  assert.equal(done.code, 0, done.out);
  const real = (p: string): string => realpathSync(p);
  const origin = git(join(f, "origin.git"), "rev-parse", "master");
  assert.equal(git(join(f, "guard"), "rev-parse", "HEAD"), origin, "the guard worktree is at origin/master");
  assert.equal(lstatSync(join(f, "bin", "bisellium")).isSymbolicLink(), true, "GUARD_BIN is a link");
  assert.equal(readlinkSync(join(f, "bin", "bisellium")), join(f, "guard", "packages", "cli", "bin", "bisellium.mjs"), "GUARD_BIN links into GUARD_DIR");
  assert.match(readFileSync(join(f, "npm.log"), "utf8"), new RegExp(`^npm ci --silent in ${real(join(f, "guard")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "npm ci ran in GUARD_DIR");
  const settings = JSON.parse(readFileSync(join(f, ".claude", "settings.json"), "utf8")) as { sandbox: { enabled: boolean; filesystem: { denyWrite: string[] } } };
  assert.equal(settings.sandbox.enabled, true, "the sandbox is on");
  const agent = real(join(f, "agent"));
  assert.deepEqual(settings.sandbox.filesystem.denyWrite, [real(join(f, "patron")), ...["packages", "apps", "adapters", "scripts"].map((d) => `${agent}/${d}`)], "the deny names the agent clone's real source folders");
  assert.match(done.out, /^guard: live/m, "the probe ran");
  assert.match(done.out, /^guard: installed from .* at [0-9a-f]{7,}$/m, "the install names its commit");
  const verify = install(f, {}, "verify");
  for (const line of ["user settings hold every isolation entry", "the hook guard's installer inputs hold", "GUARD_BIN leads into GUARD_DIR", "the hook guard is wired, installed outside"])
    assert.match(verify.out, new RegExp(`^ok ${line}`, "m"), `verify: ${line}`);
  const inside = install(f, {}, "verify", "--inside").out;
  assert.match(inside, /^FAIL the installed hook guard .* is not writable$/m, "verify --inside: a writable install fails");
  mkdirSync(join(f, "agent", "packages"));
  assert.match(install(f, {}, "verify", "--inside").out, /^FAIL the agent clone's packages\/, apps\/, adapters\/ and scripts\/ are not writable$/m, "verify --inside: a writable source folder fails");
  // an absent GUARD_DIR is added as a detached worktree of the Patron's clone
  const fresh = install(f, { GUARD_DIR: join(f, "new guard") }, "guard");
  assert.equal(fresh.code, 0, `an absent GUARD_DIR is installed: ${fresh.out}`);
  assert.equal(git(join(f, "new guard"), "rev-parse", "--path-format=absolute", "--git-common-dir"), git(join(f, "patron"), "rev-parse", "--path-format=absolute", "--git-common-dir"), "a worktree of the Patron's clone");
  assert.equal(spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: join(f, "new guard") }).status, 1, "detached");
  // a probe that fails stops the install
  const dead = install(f, { W362_PROBE_FAIL: "1" }, "guard");
  assert.equal(dead.code, 1, "a failing probe stops the install");
  assert.match(dead.out, /is not wired, not outside .* or not live/, "a failing probe names the guard: lines");
});
