/**
 * W-369 rows b1-b3 (studio/briefs/W-369.md): `scripts/agent-workspace.sh sync`, the installed guard's `hook-event sync`
 * and its wiring, and the merge rung's sync request. node:test TAP, selected by `--test-name-pattern='^W-369-b<n>\s'`.
 * Every fixture (an origin, the Patron's clone, an agent clone, a home) lives under the OS tmp dir; nothing here reads
 * or writes the real ~/.claude, ~/projects or the agent clone.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { fetchTrunk, quoted } from "./integrate.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "agent-workspace.sh");
const URL = "https://github.com/Round-Block/bisellium.git";
const HELPER = "!GH_CONFIG_DIR=/x gh auth git-credential";
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w369-"));
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
function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** The sync's world under a directory whose name holds a space, a quote and a non-ASCII letter: a bare origin, a seed
 *  clone that advances it, the Patron's clone and the agent clone (setup's remote URL and credential helper, a VS Code
 *  merge-base note), the agent clone one commit behind. `advance` pushes a commit to origin; the Patron's clone is
 *  not fetched (the sync fetches it). */
function world(): { f: string; agent: string; patron: string; seed: string; advance: (files: Record<string, string>) => string } {
  const f = join(tmp(), "sync ü it's");
  mkdirSync(f);
  git(f, "init", "-q", "--bare", "origin.git");
  git(f, "init", "-q", "seed");
  const seed = join(f, "seed");
  put(join(seed, "packages", "a"), "a0\n");
  put(join(seed, "root"), "r0\n");
  put(join(seed, ".gitignore"), "ignored/\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "one");
  git(seed, "remote", "add", "origin", join(f, "origin.git"));
  git(seed, "push", "-q", "origin", "master");
  git(f, "clone", "-q", join(f, "origin.git"), "patron");
  git(f, "clone", "-q", join(f, "origin.git"), "agent");
  const agent = join(f, "agent");
  symlinkSync(agent, join(f, "agent link"));
  git(agent, "config", "remote.origin.url", URL);
  git(agent, "config", "--replace-all", "credential.helper", "");
  git(agent, "config", "--add", "credential.helper", HELPER);
  git(agent, "config", "branch.master.vscode-merge-base", "origin/master");
  const advance = (files: Record<string, string>): string => {
    for (const [file, text] of Object.entries(files)) put(join(seed, file), text);
    git(seed, "add", "-f", "--", ...Object.keys(files));
    git(seed, "commit", "-qm", "advance");
    git(seed, "push", "-q", "origin", "master");
    return git(seed, "rev-parse", "HEAD");
  };
  advance({ "packages/a": "a1\n", "packages/new": "n1\n" });
  return { f, agent, patron: join(f, "patron"), seed, advance };
}
/** `agent-workspace.sh sync` (or `script`) on the fixture: exit code and output. */
function sync(w: { f: string; agent: string; patron: string }, env: Record<string, string> = {}, script = SCRIPT): { code: number | null; out: string } {
  const r = spawnSync("bash", [script, "sync"], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: w.f, AGENT_DIR: w.agent, PATRON_DIR: w.patron, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const head = (dir: string): string => git(dir, "rev-parse", "HEAD");

test("W-369-b1 behaviour 1: agent-workspace.sh sync fast-forwards the agent clone to the Patron clone's fetched origin/master, prunes dead worktree entries and refuses an unexpected .git", () => {
  // a valid sync: the request is answered, master moves to origin's master through the Patron's clone
  const w = world();
  const before = head(w.agent);
  put(join(w.agent, ".git", "bisellium", "sync"), "0000\n");
  const target = git(w.seed, "rev-parse", "HEAD");
  const r = sync(w, { AGENT_DIR: join(w.f, "agent link") });
  assert.equal(r.code, 0, `a valid sync, AGENT_DIR through a symlink: ${r.out}`);
  assert.match(r.out, new RegExp(`^sync: master ${before.slice(0, 12)} -> ${target.slice(0, 12)}$`, "m"), "the sync names the move");
  assert.equal(head(w.agent), target, "the agent clone's master is at origin's master");
  assert.equal(git(w.patron, "rev-parse", "origin/master"), target, "through the Patron clone's fetched origin/master");
  assert.equal(readFileSync(join(w.agent, "packages", "new"), "utf8"), "n1\n", "the source folders are written");
  assert.equal(git(w.agent, "status", "--porcelain"), "", "the checkout is clean");
  assert.equal(existsSync(join(w.agent, ".git", "bisellium", "sync")), false, "the request is answered");
  const again = sync(w);
  assert.equal(again.code, 0, `a second sync: ${again.out}`);
  assert.match(again.out, /^sync: master is current \(/m, "a current master is said so");
  // a tracked edit after the sync made master current is refused, not reported current (spec-2 finding 1)
  writeFileSync(join(w.agent, "root"), "mine\n");
  const edited = sync(w);
  assert.equal(edited.code, 1, `a dirty tracked tree at a current master: ${edited.out}`);
  assert.match(edited.out, /^sync: refused: AGENT_DIR has uncommitted tracked changes \( M root\); master was not moved$/m, "a dirty tracked tree at a current master: the reason");
  assert.doesNotMatch(edited.out, /master is current/, "a dirty tracked tree at a current master is not reported current");
  assert.equal(readFileSync(join(w.agent, "root"), "utf8"), "mine\n", "the edit is kept");
  git(w.agent, "checkout", "-q", "--", "root");

  // dead worktree entries: a removed worktree's entry (the busy case) and an entry with no gitdir go; a live one stays
  const wd = join(w.f, "wt dead");
  git(w.agent, "worktree", "add", "-q", "-b", "dead", wd);
  rmSync(wd, { recursive: true, force: true });
  put(join(w.agent, ".git", "worktrees", "ghost", "commondir"), "../..\n");
  git(w.agent, "worktree", "add", "-q", "-b", "live", join(w.f, "wt live"));
  const swept = sync(w);
  assert.equal(swept.code, 0, `a sync with dead entries: ${swept.out}`);
  assert.match(swept.out, /^sync: pruned 2 dead worktree entries$/m, "the dead entries are pruned");
  assert.equal(existsSync(join(w.agent, ".git", "worktrees", "wt dead")), false, "the removed worktree's entry is gone");
  assert.equal(existsSync(join(w.agent, ".git", "worktrees", "ghost")), false, "the entry with no gitdir is gone");
  git(w.agent, "branch", "-D", "dead");
  assert.ok(existsSync(join(w.f, "wt live", "root")), "the live worktree stays");
  assert.match(git(w.agent, "worktree", "list"), /wt live/, "and stays registered");

  // filters are off: a filter in the global config the tree names never runs
  put(join(w.f, ".gitconfig"), `[filter "x"]\n\tsmudge = touch \\"${join(w.f, "smudged")}\\"; cat\n`);
  const filtered = w.advance({ ".gitattributes": "* filter=x\n", "root": "r2\n" });
  const ran = sync(w);
  assert.equal(ran.code, 0, `a sync over a filtered path: ${ran.out}`);
  assert.equal(head(w.agent), filtered);
  assert.equal(existsSync(join(w.f, "smudged")), false, "global and system config are ignored: no filter ran");

  // refusals: each changes nothing, the request is answered all the same
  const refused = (what: string, setup: (w: ReturnType<typeof world>) => void, why: RegExp, env: Record<string, string> = {}, script?: string): void => {
    const v = world();
    setup(v);
    const was = head(v.agent);
    put(join(v.agent, ".git", "bisellium", "sync"), "0000\n");
    const out = sync(v, env, script);
    assert.equal(out.code, 1, `${what}: ${out.out}`);
    assert.match(out.out, why, `${what}: the reason`);
    assert.match(out.out, /master was not moved$/m, `${what}: says master was not moved`);
    assert.equal(head(v.agent), was, `${what}: master did not move`);
    assert.equal(readFileSync(join(v.agent, "packages", "a"), "utf8"), "a0\n", `${what}: no incoming file was written`);
    if (!/agent clone's copy|absolute/.test(what)) assert.equal(existsSync(join(v.agent, ".git", "bisellium", "sync")), /config|hook|attributes|PATRON_DIR/.test(what), `${what}: the request is answered only past the input checks`);
  };
  for (const [key, value] of [
    ["core.hooksPath", "/tmp"],
    ["core.fsmonitor", "true"],
    ["filter.x.smudge", "cat"],
    ["include.path", "/tmp/x"],
    ["extensions.worktreeConfig", "true"],
    ["user.name", "x"],
  ] as const)
    refused(`a config key ${key}`, (v) => git(v.agent, "config", key, value), new RegExp(`^sync: refused: unexpected \\.git/config key: ${key.toLowerCase().replace(/\./g, "\\.")};`, "m"));
  // a core value git consults other than its clone's is refused (spec-2 finding 2): a mistaken core.filemode false would
  // hide a mode-only tracked change from the cleanliness check and let the merge overwrite it
  for (const [key, value, setup] of [
    ["core.filemode", "false", (v: ReturnType<typeof world>) => chmodSync(join(v.agent, "packages", "a"), 0o755)],
    ["core.bare", "true", () => undefined],
    ["core.logallrefupdates", "false", () => undefined],
    ["core.repositoryformatversion", "1", () => undefined],
  ] as const)
    refused(
      `a config value ${key} ${value}`,
      (v) => {
        setup(v);
        git(v.agent, "config", key, value);
      },
      new RegExp(`^sync: refused: the \\.git/config value ${key.replace(/\./g, "\\.")} = ${value} is not (true|false|0);`, "m"),
    );
  refused("a config value core.logallrefupdates that git cannot read as a bool", (v) => git(v.agent, "config", "core.logallrefupdates", "always"), /^sync: refused: the \.git\/config value of core\.logallrefupdates is not a bool/m);
  refused("PATRON_DIR off master", (v) => git(v.patron, "checkout", "-q", "-b", "side"), /^sync: refused: PATRON_DIR .* is on refs\/heads\/side, not master; the sync runs only while it is on master;/m);
  refused("PATRON_DIR with a tracked change", (v) => writeFileSync(join(v.patron, "root"), "patron's\n"), /^sync: refused: PATRON_DIR .* has uncommitted tracked changes \( M root\); the sync runs only while it is on a clean master;/m);
  refused("an info/attributes file", (v) => put(join(v.agent, ".git", "info", "attributes"), "* filter=x\n"), /^sync: refused: .*info\/attributes exists;/m);
  refused(
    "a git hook",
    (v) => {
      put(join(v.agent, ".git", "hooks", "post-merge"), `#!/bin/sh\ntouch "${join(v.f, "hooked")}"\n`);
      chmodSync(join(v.agent, ".git", "hooks", "post-merge"), 0o755);
    },
    /^sync: refused: a git hook is installed: .*post-merge;/m,
  );
  refused("a dirty tracked tree", (v) => writeFileSync(join(v.agent, "root"), "mine\n"), /^sync: refused: AGENT_DIR has uncommitted tracked changes/m);
  refused("HEAD off master", (v) => git(v.agent, "checkout", "-q", "-b", "side"), /^sync: refused: HEAD of AGENT_DIR is refs\/heads\/side, not master;/m);
  refused(
    "a master ahead of origin (not a fast-forward)",
    (v) => {
      writeFileSync(join(v.agent, "root"), "local\n");
      git(v.agent, "commit", "-qam", "local");
    },
    /^sync: refused: AGENT_DIR's master .* is not behind origin\/master .* \(ahead or diverged\);/m,
  );
  refused("an untracked file in an incoming path", (v) => put(join(v.agent, "packages", "new"), "mine\n"), /^sync: refused: git merge --ff-only .* refused \(/m);
  refused(
    "an ignored file in an incoming path",
    (v) => {
      put(join(v.agent, "ignored", "keep"), "mine\n");
      v.advance({ "ignored/keep": "theirs\n" });
    },
    /^sync: refused: git merge --ff-only .* refused \(/m,
  );
  refused("a Patron clone that cannot fetch", (v) => git(v.patron, "remote", "set-url", "origin", join(v.f, "missing.git")), /^sync: refused: could not fetch origin's master into PATRON_DIR/m);
  refused("a relative AGENT_DIR (absolute paths only)", () => undefined, /^sync: refused: AGENT_DIR and PATRON_DIR must be absolute paths;/m, { AGENT_DIR: "agent" });
  const inside = world();
  const copy = join(inside.agent, "scripts", "agent-workspace.sh");
  put(copy, "");
  copyFileSync(SCRIPT, copy);
  refused("the agent clone's copy of the script", () => undefined, /^sync: refused: this is the agent clone's copy of the script; the sync runs only from the installed guard;/m, { AGENT_DIR: inside.agent, PATRON_DIR: inside.patron }, copy);
  // an unparseable or absent .git/config refuses before any git runs in the agent clone
  const broken = world();
  const config = join(broken.agent, ".git", "config");
  const kept = readFileSync(config, "utf8");
  writeFileSync(config, "[core\n\tbare = \n");
  const unparsed = sync(broken);
  assert.equal(unparsed.code, 1, `an unparseable config: ${unparsed.out}`);
  assert.match(unparsed.out, /^sync: refused: .*config does not parse;/m, "an unparseable config is refused");
  renameSync(config, `${config}.away`);
  const absent = sync(broken);
  assert.equal(absent.code, 1, `an absent config: ${absent.out}`);
  assert.match(absent.out, /^sync: refused: .* is not a git directory with its own config;/m, "an absent config is refused");
  writeFileSync(config, kept);
  assert.equal(readFileSync(join(broken.agent, "packages", "a"), "utf8"), "a0\n", "neither moved master");
  const hooked = world();
  put(join(hooked.agent, ".git", "hooks", "post-merge"), `#!/bin/sh\ntouch "${join(hooked.f, "hooked")}"\n`);
  chmodSync(join(hooked.agent, ".git", "hooks", "post-merge"), 0o755);
  assert.equal(sync(hooked).code, 1);
  assert.equal(existsSync(join(hooked.f, "hooked")), false, "no hook ran");
});
