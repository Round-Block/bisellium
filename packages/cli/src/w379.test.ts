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
  guard: (sub: string, env?: Record<string, string>, script?: string, cwd?: string) => { code: number | null; out: string };
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
  const guard = (sub: string, env: Record<string, string> = {}, script = join(patron, "scripts", "agent-workspace.sh"), cwd?: string): { code: number | null; out: string } => {
    const r = spawnSync("bash", [script, sub], {
      encoding: "utf8",
      cwd,
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
    assert.match(r.out, /^the guard's inputs are not valid; see the lines above \(nothing was changed\)\.$/m, `${what}: nothing was changed`);
    assert.equal(readlinkSync(w.bin), target, `${what}: GUARD_BIN still leads into the old guard`);
    assert.equal(existsSync(join(w.f, "npm.log")), false, `${what}: npm did not run`);
    assert.equal(existsSync(join(w.f, ".claude", "settings.json")), false, `${what}: the user settings were not written`);
    assert.ok(existsSync(join(w.old, "x")), `${what}: the old guard worktree stays`);
    const verify = w.guard("verify");
    assert.match(verify.out, /^FAIL the hook guard's installer inputs hold \(PATH, PATRON_DIR on master, GUARD_BIN\)$/m, `${what}: verify fails the inputs`);
    // verify's settings check runs the merge script's main and writes the user settings (W-362's, unchanged: a limit)
    rmSync(join(w.f, ".claude"), { recursive: true, force: true });
    undo();
  }
  assert.equal(head(w.patron), was, "the refusals moved nothing");
  // a rejected PATH entry is never searched: a logging git, readlink and dirname in each of them never run, whatever the guard judges
  const tools = ["git", "readlink", "dirname"] as const;
  const logging = (dir: string, name: string): void => {
    for (const tool of tools) {
      const real = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
      put(join(dir, tool), `#!/bin/sh\necho ${name}:${tool} >> "$HOME/path-tool.log"\nexec ${sq(real)} "$@"\n`, 0o755);
    }
  };
  logging(join(w.f, "rel"), "relative");
  logging(join(w.f, "agent", "tools"), "inside-agent");
  logging(join(w.f, "early"), "earlier-bisellium");
  put(join(w.f, "early", "bisellium"), "#!/bin/sh\n", 0o755);
  const toolLog = join(w.f, "path-tool.log");
  for (const [what, entry] of [
    ["a relative PATH entry", "rel"],
    ["a PATH entry inside AGENT_DIR", join(w.f, "agent", "tools")],
    ["an earlier bisellium on PATH", join(w.f, "early")],
  ] as const) {
    const base = [join(w.f, "stub"), join(w.f, "bin"), dirname(process.execPath), "/usr/bin", "/bin"];
    const env = { PATH: [entry, ...base].join(":") };
    for (const sub of ["guard-check", "guard"]) {
      const r = w.guard(sub, env, undefined, w.f);
      assert.equal(r.code, 1, `${what}: ${sub} exits 1: ${r.out}`);
      assert.equal(existsSync(toolLog), false, `${what}: ${sub} ran no program found in it: ${existsSync(toolLog) ? readFileSync(toolLog, "utf8") : ""}`);
    }
    assert.equal(w.guard("verify", env, undefined, w.f).code, 1, `${what}: verify fails`);
    // verify's other git calls (W-362's, unchanged) may run its git: a stated limit; its readlink and dirname never do
    const ran = existsSync(toolLog) ? readFileSync(toolLog, "utf8") : "";
    assert.doesNotMatch(ran, /:(readlink|dirname)$/m, `${what}: verify ran no readlink or dirname found in it`);
    rmSync(toolLog, { force: true });
    rmSync(join(w.f, ".claude"), { recursive: true, force: true });
  }
  // a missing /usr/bin/readlink is a fault line, not a crash: a copy of the script naming a readlink that is not there
  const noReadlink = join(w.f, "no-readlink.sh");
  writeFileSync(noReadlink, readFileSync(SCRIPT, "utf8").replace("RL=/usr/bin/readlink", "RL=/nonexistent/readlink"));
  const lacking = w.guard("guard-check", {}, noReadlink, w.f);
  assert.equal(lacking.code, 1, `a missing readlink: guard-check exits 1: ${lacking.out}`);
  assert.match(lacking.out, /^\/nonexistent\/readlink is not an executable file; the guard runs readlink only by that path$/m, "a missing readlink: the fault line");
  assert.doesNotMatch(lacking.out, /No such file or directory|not found/, "a missing readlink: nothing ran and failed");
  // an untracked file is not a tracked change (a stated limit, not a refusal)
  writeFileSync(join(w.patron, "scratch"), "untracked\n");
  const untracked = w.guard("guard-check");
  assert.doesNotMatch(untracked.out, /PATRON_DIR .* (is on|has uncommitted)/, "an untracked file in PATRON_DIR is not refused");
  rmSync(join(w.patron, "scratch"));
  const base = [join(w.f, "stub"), join(w.f, "bin"), dirname(process.execPath), "/usr/bin", "/bin"];
  // every fault is its own line: a rejected PATH entry does not hide the clone's faults (the judgement searches no PATH)
  for (const [what, setup, undo, why] of [
    ["off master", () => git(w.patron, "checkout", "-q", "-b", "side2"), () => git(w.patron, "checkout", "-q", "master"), /^PATRON_DIR .* is on refs\/heads\/side2, not master; the guard runs only while it is on master$/m],
    ["with a tracked change", () => writeFileSync(join(w.patron, "x"), "mine\n"), () => git(w.patron, "checkout", "-q", "--", "x"), /^PATRON_DIR .* has uncommitted tracked changes \( M x\); the guard runs only while it is on a clean master$/m],
  ] as const) {
    setup();
    const both = w.guard("guard-check", { PATH: ["rel", ...base].join(":") }, undefined, w.f);
    assert.equal(both.code, 1, `a rejected PATH and a PATRON_DIR ${what}: guard-check exits 1: ${both.out}`);
    assert.match(both.out, /^a relative PATH entry \('rel'\) comes before GUARD_BIN's directory$/m, `a rejected PATH and a PATRON_DIR ${what}: the PATH reason`);
    assert.match(both.out, why, `a rejected PATH and a PATRON_DIR ${what}: the clone's reason`);
    assert.equal(existsSync(toolLog), false, `a rejected PATH and a PATRON_DIR ${what}: no program found in it ran`);
    undo();
  }
  // verify's probe line runs GUARD_BIN (env finds node through PATH) only when the inputs hold
  const realNode = spawnSync("bash", ["-c", "command -v node"], { encoding: "utf8" }).stdout.trim();
  put(join(w.f, "rel", "node"), `#!/bin/sh\necho "relative:node:$1" >> "$HOME/path-tool.log"\nexec ${sq(realNode)} "$@"\n`, 0o755);
  assert.equal(w.guard("verify", { PATH: ["rel", ...base].join(":") }, undefined, w.f).code, 1, "a rejected PATH: verify fails");
  const probed = existsSync(toolLog) ? readFileSync(toolLog, "utf8") : "";
  assert.doesNotMatch(probed, /:node:.*bisellium$/m, `a rejected PATH: verify's probe ran no node found in it: ${probed}`);
  rmSync(toolLog, { force: true });
  rmSync(join(w.f, ".claude"), { recursive: true, force: true });
  // an agent-clone PATH entry after GUARD_BIN's directory and before /usr/bin is rejected too, and its git never runs
  const lateAgent = join(w.f, "agent", "late");
  logging(lateAgent, "late-agent");
  const lateEnv = { PATH: [join(w.f, "stub"), join(w.f, "bin"), lateAgent, dirname(process.execPath), "/usr/bin", "/bin"].join(":") };
  for (const sub of ["guard-check", "guard"]) {
    const r = w.guard(sub, lateEnv, undefined, w.f);
    assert.equal(r.code, 1, `an agent-clone PATH entry after GUARD_BIN's directory: ${sub} exits 1: ${r.out}`);
    assert.match(r.out, /^a PATH entry inside AGENT_DIR \(.*agent\/late\) comes after GUARD_BIN's directory$/m, `an agent-clone PATH entry after GUARD_BIN's directory: ${sub} names it`);
    assert.equal(existsSync(toolLog), false, `an agent-clone PATH entry after GUARD_BIN's directory: ${sub} ran no git found in it: ${existsSync(toolLog) ? readFileSync(toolLog, "utf8") : ""}`);
  }
  // an accepted later entry is judged, never searched for git: the judgement and the install run git by its own path
  const late = join(w.f, "late");
  logging(late, "late");
  const okEnv = { PATH: [join(w.f, "stub"), join(w.f, "bin"), late, dirname(process.execPath), "/usr/bin", "/bin"].join(":") };
  const lateCheck = w.guard("guard-check", okEnv, undefined, w.f);
  assert.equal(lateCheck.code, 0, `an accepted later PATH entry: guard-check passes: ${lateCheck.out}`);
  assert.equal(existsSync(toolLog), false, `an accepted later PATH entry: guard-check ran no git found in it: ${existsSync(toolLog) ? readFileSync(toolLog, "utf8") : ""}`);
  const lateGuard = w.guard("guard", okEnv, undefined, w.f);
  assert.equal(lateGuard.code, 0, `an accepted later PATH entry: guard installs: ${lateGuard.out}`);
  assert.doesNotMatch(existsSync(toolLog) ? readFileSync(toolLog, "utf8") : "", /:git$/m, "an accepted later PATH entry: the guard ran no git found through PATH");
  // a missing pinned program prints its one line, and every check that needs it is skipped, never run, so it adds no fault
  // it could not judge, while every check that needs none of it still runs (the ordering rule, brief Interfaces): a copy
  // of the script per program naming a path that is not there, run through a link inside AGENT_DIR (the script's own
  // directory is resolved only by readlink)
  const shown = (out: string, re: RegExp = /./): string[] => out.split("\n").filter((l) => l !== "" && re.test(l));
  const verifyLine = /^(ok|FAIL|skip) (user settings|the hook guard|GUARD_BIN)/;
  const offMaster = `PATRON_DIR ${w.patron} is on refs/heads/side3, not master; the guard runs only while it is on master`;
  const relLine = "a relative PATH entry ('rel') comes before GUARD_BIN's directory";
  const notValid = "the guard's inputs are not valid; see the lines above (nothing was changed).";
  const inputsLine = "the hook guard's installer inputs hold (PATH, PATRON_DIR on master, GUARD_BIN)";
  const probeLine = `the hook guard is wired, installed outside ${join(w.f, "agent")} and live`;
  for (const [tool, pin] of [
    ["readlink", "RL"],
    ["env", "ENV"],
    ["git", "GIT"],
  ] as const) {
    const missing = `/nonexistent/${tool}`;
    const copy = join(w.patron, "scripts", `no-${tool}.sh`);
    writeFileSync(copy, readFileSync(SCRIPT, "utf8").replace(`${pin}=/usr/bin/${tool}`, `${pin}=${missing}`));
    const link = join(w.f, "agent", `no-${tool}.sh`);
    symlinkSync(copy, link);
    const fault = `${missing} is not an executable file; the guard runs ${tool} only by that path`;
    const skip = (what: string): string => `skip ${what} (${missing} is not an executable file, so it was not judged)`;
    const run = (sub: string, env: Record<string, string> = {}): { code: number | null; lines: string[] } => {
      const r = w.guard(sub, env, link, w.f);
      return { code: r.code, lines: shown(r.out, sub === "verify" ? verifyLine : undefined) };
    };
    // an otherwise valid setup (valid clones, valid PATH, GUARD_BIN installed): that program's line and nothing it would judge
    const valid = { guardCheck: run("guard-check"), guard: run("guard"), verify: run("verify"), sync: run("sync") };
    rmSync(join(w.f, ".claude", "settings.json"), { force: true });
    assert.deepEqual(
      valid,
      {
        guardCheck: { code: 1, lines: [fault] },
        guard: { code: 1, lines: [fault, notValid] },
        verify: {
          code: 1,
          lines: tool === "readlink" ? [skip("user settings hold every isolation entry"), `FAIL ${inputsLine}`, skip("GUARD_BIN leads into PATRON_DIR"), `skip ${probeLine} (the installer inputs do not hold, so it was not judged)`] : ["ok user settings hold every isolation entry", `FAIL ${inputsLine}`, "ok GUARD_BIN leads into PATRON_DIR", `skip ${probeLine} (the installer inputs do not hold, so it was not judged)`],
        },
        sync: { code: 1, lines: [`sync: refused: ${missing} is not an executable file; the sync runs ${tool} only by that path; master was not moved`] },
      },
      `a missing ${tool} with a valid setup: exactly its line; no clone, branch, dirty or overlap fault and no FAIL for a check it needs`,
    );
    // an otherwise invalid setup: every fault the guard can judge without that program is printed, and only those
    git(w.patron, "checkout", "-q", "-b", "side3");
    const bad: Record<string, string> = tool === "readlink" ? { PATH: ["rel", ...base].join(":") } : { PATH: ["rel", ...base].join(":"), AGENT_DIR: join(w.patron, "packages") };
    const judged = tool === "readlink" ? [fault, relLine, offMaster] : [fault, relLine, "PATRON_DIR and AGENT_DIR are one inside the other"];
    assert.deepEqual({ guardCheck: run("guard-check", bad), guard: run("guard", bad) }, { guardCheck: { code: 1, lines: judged }, guard: { code: 1, lines: [...judged, notValid] } }, `a missing ${tool} with an invalid setup: the faults it can judge`);
    // sync_inputs keeps its unchanged absolute-path check first: with a relative AGENT_DIR or PATRON_DIR the path fault is
    // the one line, the missing program is not reached
    for (const [what, env] of [
      ["a relative AGENT_DIR", { AGENT_DIR: "agent" }],
      ["a relative PATRON_DIR", { PATRON_DIR: "patron" }],
    ] as const) {
      assert.deepEqual(run("sync", env), { code: 1, lines: ["sync: refused: AGENT_DIR and PATRON_DIR must be absolute paths; master was not moved"] }, `a missing ${tool} with ${what}: sync prints the absolute-path fault first`);
    }
    // the guard's own script inside AGENT_DIR (the agent clone's copy): a missing env or git is still its one line, printed
    // with the agent-copy refusal, which changes nothing either (readlink's line is the refusal's own gate)
    if (tool !== "readlink") {
      const inside = join(w.f, "agent", `no-${tool}-inside.sh`);
      writeFileSync(inside, readFileSync(copy, "utf8"));
      const refused = w.guard("guard", {}, inside, w.f);
      assert.deepEqual(
        { code: refused.code, lines: shown(refused.out) },
        { code: 1, lines: [fault, "run the guard step from your own clone's copy of this script, never the agent clone's (nothing was changed)."] },
        `a missing ${tool} with the script inside AGENT_DIR: its line and the agent-copy refusal`,
      );
      rmSync(inside);
    }
    git(w.patron, "checkout", "-q", "master");
    git(w.patron, "branch", "-q", "-D", "side3");
    unlinkSync(link);
    rmSync(copy);
  }
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

test("W-379-b3 behaviour 3: guard removes W-362's old guard worktree only when GUARD_BIN led into it and git finds it clean", () => {
  const w = world();
  const removeCmd = (dir: string): string => `once it holds nothing you need: git -C ${sq(w.patron)} worktree remove ${sq(dir)}`;
  // OLD_GUARD_DIR naming another clean linked worktree of the clone (a typo): GUARD_BIN does not lead into it, so it stays
  const typo = w.guard("guard", { OLD_GUARD_DIR: w.other });
  assert.equal(typo.code, 0, `a typo in OLD_GUARD_DIR still installs: ${typo.out}`);
  assert.ok(typo.out.split("\n").includes(`guard: left ${w.other} in place (GUARD_BIN did not lead into it when this run began, so it is not proved the old guard); ${removeCmd(w.other)}`), `another clean linked worktree is left, with the Patron's command: ${typo.out}`);
  assert.ok(existsSync(join(w.other, "x")), "the other worktree stays");
  assert.match(git(w.patron, "worktree", "list"), /other wt/, "and its entry");
  // OLD_GUARD_DIR the Patron's clone itself, GUARD_BIN now leading into it: not a linked worktree, so it stays
  const self = w.guard("guard", { OLD_GUARD_DIR: w.patron });
  assert.equal(self.code, 0, self.out);
  assert.ok(self.out.split("\n").includes(`guard: left ${w.patron} in place (it is not a linked worktree of PATRON_DIR); ${removeCmd(w.patron)}`), `the Patron's clone is never removed: ${self.out}`);
  assert.ok(existsSync(join(w.patron, "x")), "the Patron's clone stays");
  // OLD_GUARD_DIR the Patron's clone itself with GUARD_BIN led into it as the run began (proved by the pre-run link): the
  // explicit rejection holds before any worktree record is scanned, so a typo naming PATRON_DIR never removes it
  assert.equal(readlinkSync(w.bin), join(realpathSync(w.patron), "packages", "cli", "bin", "bisellium.mjs"), "GUARD_BIN led into PATRON_DIR as the run began");
  const proved = w.guard("guard", { OLD_GUARD_DIR: w.patron });
  assert.equal(proved.code, 0, proved.out);
  assert.ok(proved.out.split("\n").includes(`guard: left ${w.patron} in place (it is not a linked worktree of PATRON_DIR); ${removeCmd(w.patron)}`), `PATRON_DIR as OLD_GUARD_DIR (the main worktree) is left even when GUARD_BIN led into it: ${proved.out}`);
  assert.ok(existsSync(join(w.patron, "x")), "the main worktree PATRON_DIR stays");
  // PATRON_DIR a linked worktree (the main clone detached, master checked out in `linked wt`), GUARD_BIN led into it,
  // OLD_GUARD_DIR the same linked worktree: a worktree record after the first, yet never removed
  const v = world();
  const linked = join(v.f, "linked wt");
  git(v.patron, "checkout", "-q", "--detach");
  git(v.patron, "worktree", "add", "-q", linked, "master");
  rmSync(v.bin, { force: true });
  symlinkSync(join(linked, "packages", "cli", "bin", "bisellium.mjs"), v.bin);
  const asLinked = v.guard("guard", { PATRON_DIR: linked, OLD_GUARD_DIR: linked }, join(linked, "scripts", "agent-workspace.sh"));
  assert.equal(asLinked.code, 0, asLinked.out);
  assert.ok(asLinked.out.split("\n").includes(`guard: left ${linked} in place (it is not a linked worktree of PATRON_DIR); once it holds nothing you need: git -C ${sq(linked)} worktree remove ${sq(linked)}`), `PATRON_DIR as OLD_GUARD_DIR (a linked worktree) is left even when GUARD_BIN led into it: ${asLinked.out}`);
  assert.ok(existsSync(join(linked, "x")), "the linked worktree PATRON_DIR stays");
  assert.match(git(v.patron, "worktree", "list"), /linked wt/, "and its entry");
  // OLD_GUARD_DIR a file: not a directory
  const file = join(w.f, "a file");
  writeFileSync(file, "f\n");
  assert.match(w.guard("guard", { OLD_GUARD_DIR: file }).out, /^guard: left .*a file in place \(it is not a directory\); once it holds nothing you need: git -C .* worktree remove .*a file'$/m, "a file as OLD_GUARD_DIR is left");
  // the old guard, proved (GUARD_BIN led into it as the run began), with a tracked edit: git refuses, it stays
  w.linkOld();
  writeFileSync(join(w.old, "x"), "edit\n");
  const dirty = w.guard("guard");
  assert.equal(dirty.code, 0, `a dirty old guard still installs: ${dirty.out}`);
  assert.match(dirty.out, new RegExp(`^guard: left ${reEsc(w.old)} in place \\(.*contains modified or untracked files.*\\); ${reEsc(removeCmd(w.old))}$`, "m"), "a dirty old guard worktree is left with git's reason and the Patron's command");
  assert.ok(existsSync(join(w.old, "x")), "and stays");
  // the old guard proved and clean (its ignored node_modules aside): git removes it, folder and entry
  git(w.old, "checkout", "-q", "--", "x");
  w.linkOld();
  const swept = w.guard("guard");
  assert.equal(swept.code, 0, swept.out);
  assert.ok(swept.out.split("\n").includes(`guard: removed the old guard worktree ${w.old}`), `a proved clean old guard worktree is removed: ${swept.out}`);
  assert.equal(existsSync(w.old), false, "its folder is gone");
  assert.doesNotMatch(git(w.patron, "worktree", "list"), /old guard/, "and its entry");
  assert.ok(existsSync(join(w.other, "x")), "the other worktree still stays");
  // an absent GUARD_BIN proves nothing: under another linked worktree's ignored directory, that worktree is left
  const z = world();
  const hidden = join(z.other, "node_modules", "bin");
  mkdirSync(hidden, { recursive: true });
  rmSync(z.bin, { force: true });
  const hiddenBin = join(hidden, "bisellium");
  const absentEnv = { GUARD_BIN: hiddenBin, OLD_GUARD_DIR: z.other, PATH: [join(z.f, "stub"), hidden, dirname(process.execPath), "/usr/bin", "/bin"].join(":") };
  const absent = z.guard("guard", absentEnv);
  assert.equal(absent.code, 0, absent.out);
  assert.match(absent.out, /^guard: left .*other wt in place \(GUARD_BIN did not lead into it when this run began, so it is not proved the old guard\); once it holds nothing you need: git -C .* worktree remove .*other wt'$/m, "an absent GUARD_BIN proves no worktree the old guard");
  assert.ok(existsSync(join(z.other, "x")), "the worktree holding the absent GUARD_BIN's directory stays");
  // a dangling GUARD_BIN (a link whose target is missing) proves nothing either: its missing target lies under another
  // worktree's ignored directory, and that worktree is left
  const d = world();
  const dangleDir = join(d.other, "node_modules", "bin");
  mkdirSync(dangleDir, { recursive: true });
  rmSync(d.bin, { force: true });
  const dangleBin = join(dangleDir, "bisellium");
  symlinkSync(join(dangleDir, "missing.mjs"), dangleBin);
  const dangling = d.guard("guard", { GUARD_BIN: dangleBin, OLD_GUARD_DIR: d.other, PATH: [join(d.f, "stub"), dangleDir, dirname(process.execPath), "/usr/bin", "/bin"].join(":") });
  assert.equal(dangling.code, 0, dangling.out);
  assert.match(dangling.out, /^guard: left .*other wt in place \(GUARD_BIN did not lead into it when this run began, so it is not proved the old guard\); once it holds nothing you need: git -C .* worktree remove .*other wt'$/m, "a dangling GUARD_BIN proves no worktree the old guard");
  assert.ok(existsSync(join(d.other, "x")), "the worktree holding the dangling GUARD_BIN's missing target stays");
  // a file ignored only by the Patron's global excludes makes the old guard dirty: git refuses, the folder stays
  const y = world();
  put(join(y.f, ".config", "git", "ignore"), "*.secret\n");
  put(join(y.old, "keep.secret"), "mine\n");
  const ignored = y.guard("guard");
  assert.equal(ignored.code, 0, ignored.out);
  assert.match(ignored.out, new RegExp(`^guard: left ${reEsc(y.old)} in place \\(.*contains modified or untracked files.*\\); once it holds nothing you need: git -C .* worktree remove .*$`, "m"), "a file ignored only by the global excludes is untracked: the old guard is left");
  assert.ok(existsSync(join(y.old, "keep.secret")), "and the file stays");
  // absent: nothing to remove, nothing said
  const again = w.guard("guard");
  assert.equal(again.code, 0, again.out);
  assert.doesNotMatch(again.out, /^guard: (left|removed)/m, "an absent old guard is skipped");
});

test("W-379-b4 behaviour 4: every git the guard runs has no hooks, no fsmonitor and no global config; the fetch keeps the Patron's config", () => {
  const w = world();
  // origin's next commit names a filter that only the Patron's global config defines; the Patron's remote is a name that
  // only a url rule in that global config resolves; the Patron's clone carries hooks that log when they run
  const seed = join(w.f, "seed");
  put(join(seed, ".gitattributes"), "x filter=mark\n");
  writeFileSync(join(seed, "x"), "z\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "three");
  git(seed, "push", "-q", join(w.f, "origin.git"), "master");
  const gc = join(w.f, ".gitconfig");
  writeFileSync(gc, "");
  git(w.f, "config", "--file", gc, "filter.mark.smudge", `sh -c 'echo smudge >> "$HOME/filter.log"; cat'`);
  git(w.f, "config", "--file", gc, "filter.mark.clean", `sh -c 'echo clean >> "$HOME/filter.log"; cat'`);
  git(w.f, "config", "--file", gc, "core.fsmonitor", `sh -c 'echo fsmonitor >> "$HOME/fsmonitor.log"'`);
  git(w.f, "config", "--file", gc, `url.${join(w.f, "origin.git")}.insteadOf`, "w379-origin:");
  git(w.patron, "remote", "set-url", "origin", "w379-origin:");
  for (const h of ["post-merge", "post-checkout", "reference-transaction", "post-rewrite"]) put(join(w.patron, ".git", "hooks", h), `#!/bin/sh\necho ${h} >> "$HOME/hooks.log"\n`, 0o755);
  const r = w.guard("guard");
  assert.equal(r.code, 0, `the fetch keeps the Patron's own config (its url rule resolves origin): ${r.out}`);
  assert.equal(head(w.patron), w.origin(), "the Patron's clone is at origin/master");
  assert.equal(existsSync(join(w.f, "hooks.log")), false, `no hook ran in the Patron's clone: ${existsSync(join(w.f, "hooks.log")) ? readFileSync(join(w.f, "hooks.log"), "utf8") : ""}`);
  assert.equal(existsSync(join(w.f, "filter.log")), false, "the global config was ignored: no filter ran");
  assert.equal(existsSync(join(w.f, "fsmonitor.log")), false, "no fsmonitor ran");
  assert.equal(readFileSync(join(w.patron, "x"), "utf8"), "z\n", "the file is as committed");
  // the removal's git is clean too: the old guard (proved, clean) goes with no hook run
  assert.equal(existsSync(w.old), false, "the old guard worktree was removed");
  unlinkSync(gc);
});
