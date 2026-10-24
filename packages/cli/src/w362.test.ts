/**
 * W-362 rows b3-b4 (studio/briefs/W-362.md): the guard installer `scripts/agent-workspace.sh guard` and its input
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
import { fetchTrunk, quoted } from "./integrate.js";

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
 *  the stub CLI, the settings merge and this checkout's agent-workspace.sh (the install runs as the Patron clone's copy,
 *  W-379), the Patron's clone one commit behind origin with W-362's old guard worktree, an unrelated
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
  copyFileSync(join(REPO, "scripts", "agent-workspace.sh"), join(seed, "scripts", "agent-workspace.sh"));
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
const install = (f: string, env: Record<string, string>, ...sub: string[]): { code: number | null; out: string } => installWith(join(f, "patron", "scripts", "agent-workspace.sh"), f, env, ...sub);
function installWith(script: string, f: string, env: Record<string, string>, ...sub: string[]): { code: number | null; out: string } {
  const r = spawnSync("bash", [script, ...(sub.length ? sub : ["guard-check"])], {
    encoding: "utf8",
    env: {
      PATH: pathOf(f, join(f, "bin")),
      HOME: f,
      PATRON_DIR: join(f, "patron"),
      AGENT_DIR: join(f, "agent link"),
      OLD_GUARD_DIR: join(f, "guard"),
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
  ];
  for (const [env, what] of valid) {
    const r = install(f, env);
    assert.equal(r.code, 0, `${what}: ${r.out}`);
    assert.match(r.out, /^guard inputs: ok$/m, what);
  }
  const bad: [Record<string, string>, RegExp, string][] = [
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
  // an invalid input changes nothing: the Patron's clone stays on master, no link, no settings, no npm
  const head = git(join(f, "patron"), "rev-parse", "HEAD");
  // a rejected PATH entry runs nothing before the judgement: a logging readlink, dirname and git in it never run
  const log = join(f, "tool.log");
  for (const dir of [join(f, "early"), join(f, "agent", "bin")]) {
    for (const tool of ["readlink", "dirname", "git"]) {
      const real = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
      exe(join(dir, tool), `#!/bin/sh\necho ${tool} >> ${JSON.stringify(log)}\nexec ${JSON.stringify(real)} "$@"\n`);
    }
  }
  for (const entry of [join(f, "early"), join(f, "agent", "bin")]) {
    for (const sub of ["guard-check", "guard"]) {
      const r = install(f, { PATH: pathOf(f, entry, join(f, "bin")) }, sub);
      assert.equal(r.code, 1, `a rejected PATH entry: ${sub} exits 1: ${r.out}`);
      assert.equal(existsSync(log), false, `a rejected PATH entry: ${sub} ran no program found in it`);
    }
  }
  for (const tool of ["readlink", "dirname", "git"]) for (const dir of [join(f, "early"), join(f, "agent", "bin")]) rmSync(join(dir, tool));
  const refused = install(f, { PATH: pathOf(f, join(f, "early"), join(f, "bin")) }, "guard");
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
  // valid inputs: the Patron's clone fast-forwards to origin/master, npm ci runs there, GUARD_BIN links into it, the user
  // settings gain the sandbox deny on the agent clone's real source folders, and the probe passes
  const done = install(f, {}, "guard");
  assert.equal(done.code, 0, done.out);
  const real = (p: string): string => realpathSync(p);
  const origin = git(join(f, "origin.git"), "rev-parse", "master");
  assert.equal(git(join(f, "patron"), "rev-parse", "HEAD"), origin, "the Patron's clone is at origin/master");
  assert.equal(lstatSync(join(f, "bin", "bisellium")).isSymbolicLink(), true, "GUARD_BIN is a link");
  assert.equal(readlinkSync(join(f, "bin", "bisellium")), join(real(join(f, "patron")), "packages", "cli", "bin", "bisellium.mjs"), "GUARD_BIN links into PATRON_DIR");
  assert.match(readFileSync(join(f, "npm.log"), "utf8"), new RegExp(`^npm ci --silent in ${real(join(f, "patron")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "npm ci ran in PATRON_DIR");
  const settings = JSON.parse(readFileSync(join(f, ".claude", "settings.json"), "utf8")) as { sandbox: { enabled: boolean; filesystem: { denyWrite: string[] } } };
  assert.equal(settings.sandbox.enabled, true, "the sandbox is on");
  const agent = real(join(f, "agent"));
  assert.deepEqual(settings.sandbox.filesystem.denyWrite, [real(join(f, "patron")), ...["packages", "apps", "adapters", "scripts"].map((d) => `${agent}/${d}`)], "the deny names the agent clone's real source folders");
  assert.match(done.out, /^guard: live/m, "the probe ran");
  assert.match(done.out, /^guard: installed from .* at [0-9a-f]{7,}$/m, "the install names its commit");
  const verify = install(f, {}, "verify");
  for (const line of ["user settings hold every isolation entry", "the hook guard's installer inputs hold", "GUARD_BIN leads into PATRON_DIR", "the hook guard is wired, installed outside"])
    assert.match(verify.out, new RegExp(`^ok ${line}`, "m"), `verify: ${line}`);
  const inside = install(f, {}, "verify", "--inside").out;
  assert.match(inside, /^FAIL the installed hook guard .* is not writable$/m, "verify --inside: a writable install fails");
  mkdirSync(join(f, "agent", "packages"));
  assert.match(install(f, {}, "verify", "--inside").out, /^FAIL the agent clone's packages\/, apps\/, adapters\/ and scripts\/ are not writable$/m, "verify --inside: a writable source folder fails");
  // a probe that fails stops the install
  const dead = install(f, { W362_PROBE_FAIL: "1" }, "guard");
  assert.equal(dead.code, 1, "a failing probe stops the install");
  assert.match(dead.out, /is not wired, not outside .* or not live/, "a failing probe names the guard: lines");
});

// W-362 spec-2 finding 1: the script's own target is resolved before the inputs are judged
test("W-362-b3 behaviour 3: a shortcut symlink to the agent clone's script refuses the install", () => {
  const f = installFixture();
  const copy = join(f, "agent", "scripts", "agent-workspace.sh");
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(join(REPO, "scripts", "agent-workspace.sh"), copy);
  mkdirSync(join(f, "short"));
  symlinkSync(copy, join(f, "short", "agent-workspace.sh"));
  symlinkSync(dirname(copy), join(f, "short dir"));
  for (const [what, script] of [["a symlinked file", join(f, "short", "agent-workspace.sh")], ["a symlinked parent", join(f, "short dir", "agent-workspace.sh")]] as const) {
    const r = installWith(script, f, {}, "guard");
    assert.equal(r.code, 1, `${what} into the agent clone refuses the install: ${r.out}`);
    assert.match(r.out, /never the agent clone's \(nothing was changed\)/, `${what} names the route`);
    assert.equal(existsSync(join(f, "bin", "bisellium")), false, `${what}: no link was made`);
    assert.equal(existsSync(join(f, ".claude", "settings.json")), false, `${what}: the user settings were not written`);
    assert.equal(existsSync(join(f, "npm.log")), false, `${what}: npm did not run`);
    assert.equal(git(join(f, "patron"), "rev-parse", "HEAD"), git(join(f, "origin.git"), "rev-parse", "master~1"), `${what}: the Patron's clone did not move`);
  }
});

/** A main checkout on master with `packages/a`, `studio/s` and `root`, and a bare origin; `advance` pushes a commit
 *  changing the named files from a second clone, fetched into the main checkout as the reviewed merge commit. */
function mainCheckout(): { main: string; advance: (...files: string[]) => string } {
  const t = join(tmp(), "main it's ü");
  mkdirSync(t);
  git(t, "init", "-q", "--bare", "origin.git");
  git(t, "clone", "-q", join(t, "origin.git"), "main");
  const main = join(t, "main");
  for (const [file, text] of [["packages/a", "a\n"], ["studio/s", "s\n"], ["root", "r\n"]] as const) {
    mkdirSync(dirname(join(main, file)), { recursive: true });
    writeFileSync(join(main, file), text);
  }
  git(main, "add", ".");
  git(main, "commit", "-qm", "one");
  git(main, "push", "-q", "origin", "master");
  git(t, "clone", "-q", join(t, "origin.git"), "other");
  const other = join(t, "other");
  let n = 0;
  const advance = (...files: string[]): string => {
    n++;
    for (const file of files) writeFileSync(join(other, file), `${n}\n`);
    git(other, "commit", "-qam", `change ${n}`);
    git(other, "push", "-q", "origin", "master");
    git(main, "fetch", "-q", "origin");
    return git(other, "rev-parse", "HEAD");
  };
  return { main, advance };
}

test("W-362-b4 behaviour 4: the merge rung hands the Patron a fast-forward that would write a folder the session may not write, before touching the main checkout", (t) => {
  if (process.getuid?.() === 0) return t.skip("root writes a read-only directory");
  const { main, advance } = mainCheckout();
  chmodSync(join(main, "packages"), 0o555);
  try {
    // a change only to folders the session may write still moves master
    const writable = advance("studio/s", "root");
    assert.deepEqual(fetchTrunk(main, writable), { ok: true }, "a fast-forward into writable folders runs");
    assert.equal(git(main, "rev-parse", "HEAD"), writable);
    const target = advance("packages/a", "root");
    const held = fetchTrunk(main, target);
    assert.equal(held.ok, false, "a fast-forward into a folder the session may not write is held");
    assert.ok(!held.ok);
    assert.match(held.reason, /^refusing: this session may not write incoming paths \(packages\/a\) in the main checkout/, "the reason names the denied path");
    assert.match(held.reason, /the main checkout is untouched$/);
    assert.deepEqual(held.after?.[0], `patron: git -C ${quoted(main)} merge --ff-only ${target}`, "the Patron's one command");
    assert.equal(git(main, "rev-parse", "HEAD"), writable, "master did not move");
    assert.equal(git(main, "status", "--porcelain"), "", "nothing in the main checkout changed");
    assert.equal(readFileSync(join(main, "root"), "utf8"), "1\n", "not even a file the session may write");
  } finally {
    chmodSync(join(main, "packages"), 0o755);
  }
  // with the folder writable (the Patron's terminal), the same fast-forward runs
  const source = git(main, "rev-parse", "origin/master");
  assert.deepEqual(fetchTrunk(main, source), { ok: true }, "a writable source folder runs");
  assert.equal(readFileSync(join(main, "packages", "a"), "utf8"), "2\n");
});
