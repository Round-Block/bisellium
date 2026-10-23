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
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  assert.match(again.out, /^sync: master is current \([0-9a-f]{12}\)$/m, "a current master is said so");
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
    assert.match(out.out, /^sync: refused: .*; master was not moved$/m, `${what}: says master was not moved`);
    assert.equal(head(v.agent), was, `${what}: master did not move`);
    assert.equal(readFileSync(join(v.agent, "packages", "a"), "utf8"), "a0\n", `${what}: no incoming file was written`);
    if (!/agent clone's copy|absolute/.test(what)) assert.equal(existsSync(join(v.agent, ".git", "bisellium", "sync")), /config|hook|attributes|alternates|grafts|PATRON_DIR/.test(what), `${what}: the request is answered only past the input checks`);
  };
  for (const [key, value] of [
    ["core.hooksPath", "/tmp"],
    ["core.fsmonitor", "true"],
    ["filter.x.smudge", "cat"],
    ["include.path", "/tmp/x"],
    ["extensions.worktreeConfig", "true"],
    ["user.name", "x"],
  ] as const)
    refused(`a config key ${key}`, (v) => git(v.agent, "config", key, value), new RegExp(`^sync: refused: unexpected \\.git/config key: ${reEsc(key.toLowerCase())};`, "m"));
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
      new RegExp(`^sync: refused: the \\.git/config value ${reEsc(key)} = ${value} is not (true|false|0);`, "m"),
    );
  refused("a config value core.logallrefupdates that git cannot read as a bool", (v) => git(v.agent, "config", "core.logallrefupdates", "always"), /^sync: refused: the \.git\/config value of core\.logallrefupdates is not a bool/m);
  refused("PATRON_DIR off master", (v) => git(v.patron, "checkout", "-q", "-b", "side"), /^sync: refused: PATRON_DIR .* is on refs\/heads\/side, not master; the sync runs only while it is on master;/m);
  refused("PATRON_DIR with a tracked change", (v) => writeFileSync(join(v.patron, "root"), "patron's\n"), /^sync: refused: PATRON_DIR .* has uncommitted tracked changes \( M root\); the sync runs only while it is on a clean master;/m);
  refused("an info/attributes file", (v) => put(join(v.agent, ".git", "info", "attributes"), "* filter=x\n"), /^sync: refused: .*info\/attributes exists;/m);
  // object substitution inputs a session can plant in .git are refused (review 1)
  refused("an objects/info/alternates file", (v) => put(join(v.agent, ".git", "objects", "info", "alternates"), `${join(v.patron, ".git", "objects")}\n`), /^sync: refused: .*objects\/info\/alternates exists;/m);
  refused("an info/grafts file", (v) => put(join(v.agent, ".git", "info", "grafts"), `${head(v.agent)}\n`), /^sync: refused: .*info\/grafts exists;/m);
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
  assert.match(unparsed.out, /^sync: refused: .*config does not parse; master was not moved$/m, "an unparseable config is refused");
  renameSync(config, `${config}.away`);
  const absent = sync(broken);
  assert.equal(absent.code, 1, `an absent config: ${absent.out}`);
  assert.match(absent.out, /^sync: refused: .* is not a git directory with its own config; master was not moved$/m, "an absent config is refused");
  writeFileSync(config, kept);
  assert.equal(readFileSync(join(broken.agent, "packages", "a"), "utf8"), "a0\n", "neither moved master");
  const hooked = world();
  put(join(hooked.agent, ".git", "hooks", "post-merge"), `#!/bin/sh\ntouch "${join(hooked.f, "hooked")}"\n`);
  chmodSync(join(hooked.agent, ".git", "hooks", "post-merge"), 0o755);
  assert.equal(sync(hooked).code, 1);
  assert.equal(existsSync(join(hooked.f, "hooked")), false, "no hook ran");

  // a planted replacement ref for the fetched target never reaches the checkout (review 1): the replaced commit would
  // check out another tree, so the sync reads objects as they are, whether the target was already in the agent clone or not
  for (const present of [false, true]) {
    const r = world();
    const target = git(r.seed, "rev-parse", "HEAD");
    const old = head(r.agent);
    git(r.agent, "update-ref", `refs/replace/${target}`, git(r.agent, "commit-tree", "-p", old, "-m", "evil", `${old}^{tree}`));
    if (present) {
      git(r.patron, "fetch", "-q", "origin");
      git(r.agent, "fetch", "-q", "--no-write-fetch-head", r.patron, "refs/remotes/origin/master");
    }
    const replaced = sync(r);
    const what = `a replacement ref for the target${present ? " already in the agent clone" : ""}`;
    assert.equal(replaced.code, 0, `${what}: ${replaced.out}`);
    assert.equal(head(r.agent), target, `${what}: master is at origin's master`);
    assert.equal(readFileSync(join(r.agent, "packages", "a"), "utf8"), "a1\n", `${what}: the checkout is the fetched commit's tree`);
    assert.equal(readFileSync(join(r.agent, "packages", "new"), "utf8"), "n1\n", `${what}: the fetched commit's new file is written`);
    assert.equal(git(r.agent, "--no-replace-objects", "status", "--porcelain"), "", `${what}: the checkout is clean`);
  }

  // every git the sync runs, in either clone, reads objects as they are: replacement refs off, no alternates or graft
  // file from the environment (a shim on PATH records each call's GIT_ variables)
  const shim = tmp();
  const calls = join(shim, "calls");
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  put(join(shim, "git"), `#!/bin/sh\n{ echo "CALL $*"; env | grep '^GIT_' | sort; } >> "${calls}"\nexec "${realGit}" "$@"\n`);
  chmodSync(join(shim, "git"), 0o755);
  const env = world();
  const seen = sync(env, { PATH: `${shim}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(env.f, "alt"), GIT_GRAFT_FILE: join(env.f, "grafts") });
  assert.equal(seen.code, 0, `a sync with substitution variables in its environment: ${seen.out}`);
  const logged = readFileSync(calls, "utf8").split(/^CALL /m).filter(Boolean);
  assert.ok(logged.length >= 8, `the shim saw the sync's git calls (${logged.length})`);
  for (const call of logged) {
    assert.match(call, /^GIT_NO_REPLACE_OBJECTS=1$/m, `replacement objects are off: ${call.split("\n")[0]}`);
    assert.doesNotMatch(call, /^GIT_(ALTERNATE_OBJECT_DIRECTORIES|GRAFT_FILE)=/m, `no alternates or graft file from the environment: ${call.split("\n")[0]}`);
  }
});

/** `bisellium hook-event sync` on the fixture with `payload` on stdin: exit code, stdout and stderr. */
function hookSync(w: { f: string; agent: string; patron: string }, payload: Record<string, unknown>): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(REPO, "packages", "cli", "src", "main.ts"), "hook-event", "sync", "--studio", "studio"], {
    cwd: REPO,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 60_000,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: w.f, AGENT_DIR: w.agent, PATRON_DIR: w.patron },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const contextOf = (stdout: string, event: string): string => {
  assert.match(stdout, /"additionalContext"/, `the sync's lines reach the model as additionalContext: ${stdout}`);
  const v = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(v.hookSpecificOutput.hookEventName, event);
  return v.hookSpecificOutput.additionalContext;
};

test("W-369-b2 behaviour 2: hook-event sync runs the sync beside the installed CLI and hands its lines to the model; the repo wires it at SessionStart and after a requested Bash call", () => {
  const w = world();
  const target = git(w.seed, "rev-parse", "HEAD");
  const post = hookSync(w, { hook_event_name: "PostToolUse", tool_name: "Bash" });
  assert.equal(post.code, 0, post.stderr);
  assert.match(contextOf(post.stdout, "PostToolUse"), /^sync: master [0-9a-f]{12} -> [0-9a-f]{12}$/m, "the move reaches the model");
  assert.equal(head(w.agent), target, "the agent clone is synced");
  const start = hookSync(w, { hook_event_name: "SessionStart" });
  assert.equal(start.code, 0);
  assert.match(contextOf(start.stdout, "SessionStart"), /^sync: master is current \([0-9a-f]{12}\)$/m, "at SessionStart too");
  writeFileSync(join(w.agent, "root"), "mine\n");
  w.advance({ root: "r3\n" });
  const dirty = hookSync(w, { hook_event_name: "PostToolUse" });
  assert.equal(dirty.code, 0, "a refusal never blocks the harness");
  assert.match(contextOf(dirty.stdout, "PostToolUse"), /^sync: refused: AGENT_DIR has uncommitted tracked changes \( M root\); master was not moved$/m, "the refusal reaches the model");
  for (const [payload, what] of [
    [{ hook_event_name: "Stop" }, "another event"],
    [{}, "an absent event name"],
    [{ hook_event_name: 5 }, "an event name of the wrong type"],
  ] as const) {
    const other = hookSync(w, payload);
    assert.equal(other.code, 0, what);
    assert.match(other.stdout, /^sync: refused: .*; master was not moved$/m, `plain lines for ${what}`);
  }
  const unreadable = spawnSync(process.execPath, ["--import", "tsx", join(REPO, "packages", "cli", "src", "main.ts"), "hook-event", "sync", "--studio", "studio"], {
    cwd: REPO,
    input: "not json",
    encoding: "utf8",
    timeout: 60_000,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: w.f, AGENT_DIR: w.agent, PATRON_DIR: w.patron },
  });
  assert.equal(unreadable.status, 0, "an unreadable payload never blocks the harness");
  assert.doesNotMatch(unreadable.stdout, /sync:/, "and runs no sync");

  // the wiring: the installed bisellium, at SessionStart and on Bash after a request, 60 s each
  const settings = JSON.parse(readFileSync(join(REPO, ".claude", "settings.json"), "utf8")) as { hooks: Record<string, { matcher: string; hooks: { type: string; command: string; timeout: number }[] }[]> };
  const startHooks = settings.hooks["SessionStart"]?.[0]?.hooks ?? [];
  assert.ok(
    startHooks.some((h) => h.type === "command" && h.command === "bisellium hook-event sync --studio studio" && h.timeout === 60),
    "SessionStart runs the sync",
  );
  const postGroup = settings.hooks["PostToolUse"]?.find((g) => g.matcher === "Bash");
  const requested = postGroup?.hooks.find((h) => h.command.includes("hook-event sync"));
  assert.equal(requested?.command, 'test ! -e "$CLAUDE_PROJECT_DIR/.git/bisellium/sync" || bisellium hook-event sync --studio studio', "PostToolUse on Bash runs it when requested");
  assert.equal(requested?.timeout, 60);
  // the command runs the bisellium on PATH only when the request exists
  const bin = join(w.f, "bin");
  put(join(bin, "bisellium"), `#!/bin/sh\necho "$*" >> "${join(w.f, "ran")}"\n`);
  chmodSync(join(bin, "bisellium"), 0o755);
  const run = (): void => {
    const r = spawnSync("sh", ["-c", requested?.command ?? "false"], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, CLAUDE_PROJECT_DIR: join(w.f, "agent link") } });
    assert.equal(r.status, 0, r.stderr);
  };
  run();
  assert.equal(existsSync(join(w.f, "ran")), false, "no request: the sync does not run");
  put(join(w.agent, ".git", "bisellium", "sync"), "x\n");
  run();
  assert.equal(readFileSync(join(w.f, "ran"), "utf8"), "hook-event sync --studio studio\n", "a request: the installed bisellium runs the sync");
});

/** A main checkout on master with `packages/a`, `studio/s` and `root`, and a bare origin; `advance` pushes a commit
 *  changing the named files from a second clone, fetched into the main checkout as the reviewed merge commit. */
function mainCheckout(): { main: string; advance: (...files: string[]) => string } {
  const t = join(tmp(), "main it's ü");
  mkdirSync(t);
  git(t, "init", "-q", "--bare", "origin.git");
  git(t, "clone", "-q", join(t, "origin.git"), "main");
  const main = join(t, "main");
  for (const [file, text] of [["packages/a", "a\n"], ["studio/s", "s\n"], ["root", "r\n"]] as const) put(join(main, file), text);
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

test("W-369-b3 behaviour 3: the merge rung's hold on a path the session may not write requests the sync and says so", (t) => {
  if (process.getuid?.() === 0) return t.skip("root writes a read-only directory");
  const { main, advance } = mainCheckout();
  const request = join(main, ".git", "bisellium", "sync");
  const writable = advance("studio/s", "root");
  assert.deepEqual(fetchTrunk(main, writable), { ok: true }, "a fast-forward into writable folders runs");
  assert.equal(existsSync(request), false, "and requests no sync");
  chmodSync(join(main, "packages"), 0o555);
  try {
    const target = advance("packages/a", "root");
    const held = fetchTrunk(main, target);
    assert.ok(!held.ok, "a fast-forward into a folder the session may not write is held");
    assert.deepEqual(
      held.after,
      [`patron: git -C ${quoted(main)} merge --ff-only ${target}`, "sync: requested; the installed guard fast-forwards master to origin/master when this call returns and prints a sync: line; then rerun (W-369)"],
      "the hold requests the sync and keeps the Patron's command",
    );
    assert.equal(readFileSync(request, "utf8"), `${target}\n`, "the request names the reviewed commit");
    assert.equal(git(main, "rev-parse", "HEAD"), writable, "master did not move");
    assert.equal(git(main, "status", "--porcelain"), "", "the main checkout is untouched");
    rmSync(request);
    mkdirSync(request);
    const unwritten = fetchTrunk(main, target);
    assert.ok(!unwritten.ok);
    assert.match(unwritten.after?.[1] ?? "", /^sync: not requested \(.*\)$/, "a request that cannot be written is said so");
  } finally {
    chmodSync(join(main, "packages"), 0o755);
  }
});
