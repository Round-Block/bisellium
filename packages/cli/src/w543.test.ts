/**
 * W-543 rows b1-b6 (studio/briefs/W-543.md): `bisellium launch`, the verb the Patron's timer runs to start one refresh
 * session from a landed handoff. node:test TAP, selected by `--test-name-pattern='^W-543-b<n>\s'`. Every fixture (the
 * Patron's clone, an agent clone, a home, a state folder, a PATH, a /proc stand-in) lives under the OS tmp dir; the
 * session, the workspace verify, the sync and gh are stand-ins, so nothing here starts claude or reads the real home.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOW = new Date("2026-11-10T02:00:00.000Z");
const ME = 4242;
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** The verb's module, read when a row runs (it is new in this opus). */
const load = async (): Promise<typeof import("./launch.js")> => import("./launch.js");

function put(path: string, text: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  if (mode !== undefined) chmodSync(path, mode);
}
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "init.defaultBranch=master", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
/** The real path of the test host's own `name` (git, bash), which the fixture's tools folder links to. */
function host(name: string): string {
  for (const d of (process.env["PATH"] ?? "").split(":")) {
    try {
      if (d !== "" && statSync(join(d, name)).isFile()) return realpathSync(join(d, name));
    } catch {
      /* not here */
    }
  }
  throw new Error(`the test host has no ${name} on PATH`);
}
/** A `/proc/<pid>` stand-in: stat (state, parent, start ticks in field 22), comm, cmdline and, given one, a cwd link. */
function proc(root: string, pid: number, o: { comm?: string; ppid?: number; cwd?: string; ticks?: number; state?: string; argv0?: string }): void {
  const d = join(root, String(pid));
  mkdirSync(d, { recursive: true });
  const comm = o.comm ?? "node";
  writeFileSync(join(d, "stat"), `${pid} (${comm}) ${o.state ?? "S"} ${o.ppid ?? 1} ${"0 ".repeat(17)}${o.ticks ?? 1000} 0 0\n`);
  writeFileSync(join(d, "comm"), `${comm}\n`);
  writeFileSync(join(d, "cmdline"), `${o.argv0 ?? comm}\0--flag\0`);
  rmSync(join(d, "cwd"), { force: true });
  if (o.cwd !== undefined) symlinkSync(o.cwd, join(d, "cwd"));
}

type Ran = { status: number | null; stdout: string; stderr: string };
type Call = { cmd: string; exe?: string; args: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv };
interface World {
  t: string;
  self: string;
  agent: string;
  home: string;
  agentGh: string;
  state: string;
  procRoot: string;
  env: NodeJS.ProcessEnv;
  calls: Call[];
  lines: string[];
  fake: { verify: Ran; gh: Ran; sync: Ran; session: { status: number | null; stdout: string }; during?: () => void };
  /** Commits a handoff edit in the Patron's clone and moves its origin/master there; the commit. */
  land: (text: string, file?: string) => string;
  launch: (...argv: string[]) => Promise<number>;
}
const ok: Ran = { status: 0, stdout: "", stderr: "" };

/** The Patron's clone (the shipped `.claude/refresh/` files, a handoff on origin/master), an agent clone, a home with its
 *  evidence folder, a state home, a PATH of two folders (stand-in claude and gh; links to the host's git and bash), and a
 *  /proc holding this process alone. */
function world(): World {
  const t = mkdtempSync(join(tmpdir(), "w543-"));
  dirs.push(t);
  const self = join(t, "patron");
  const agent = join(t, "agent");
  const home = join(t, "home");
  const procRoot = join(t, "proc");
  for (const d of [agent, join(home, ".bisellium-evidence"), procRoot]) mkdirSync(d, { recursive: true });
  for (const f of [".claude/refresh/launch.json", ".claude/refresh/prompt.md"]) put(join(self, f), readFileSync(join(REPO, f), "utf8"));
  put(join(self, "scripts", "agent-workspace.sh"), "exit 0\n");
  put(join(t, "bin", "claude"), "#!/bin/sh\nexit 0\n", 0o755);
  put(join(t, "bin", "gh"), "#!/bin/sh\nexit 0\n", 0o755);
  mkdirSync(join(t, "tools"));
  for (const n of ["git", "bash"]) symlinkSync(host(n), join(t, "tools", n));
  git(t, "init", "-q", self);
  const w: World = {
    t,
    self,
    agent,
    home,
    agentGh: join(home, ".config", "agent-gh"),
    state: join(t, "xdg", "bisellium", "launch"),
    procRoot,
    env: { HOME: home, AGENT_DIR: agent, AGENT_GH: join(home, ".config", "agent-gh"), XDG_STATE_HOME: join(t, "xdg"), PATH: `${join(t, "bin")}:${join(t, "tools")}`, GH_TOKEN: "ambient", GITHUB_TOKEN: "ambient" },
    calls: [],
    lines: [],
    fake: { verify: ok, gh: ok, sync: ok, session: { status: 0, stdout: JSON.stringify({ type: "result", permission_denials: [] }) } },
    land: (text, file = "docs/SESSION-HANDOFF.md") => {
      put(join(self, file), text);
      git(self, "add", "-A");
      git(self, "commit", "-q", "-m", text);
      git(self, "update-ref", "refs/remotes/origin/master", "HEAD");
      return git(self, "rev-parse", "HEAD");
    },
    launch: async (...argv) => {
      const { runLaunch } = await load();
      const r = await runLaunch(argv, {
        self,
        env: w.env,
        procRoot,
        pid: ME,
        now: () => NOW,
        run: (cmd, args, o) => {
          // String(): a launch that ran a program it never found is caught at an assertion, not by a TypeError here
          w.calls.push({ cmd: basename(String(cmd)), exe: cmd, args, ...(o.cwd ? { cwd: o.cwd } : {}), ...(o.env ? { env: o.env } : {}) });
          if (basename(String(cmd)) === "git") {
            const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
            return { status: r.status, stdout: r.stdout, stderr: r.stderr };
          }
          if (basename(String(cmd)) === "gh") return w.fake.gh;
          if (basename(String(cmd)) === "bash" && args[1] === "verify") return w.fake.verify;
          if (basename(String(cmd)) === "bash" && args[1] === "sync") return w.fake.sync;
          return { status: 127, stdout: "", stderr: `no stand-in for ${cmd}` };
        },
        session: async (cmd, args, o) => {
          w.calls.push({ cmd: "session", args: [cmd, ...args], cwd: o.cwd, env: o.env });
          w.fake.during?.();
          return w.fake.session;
        },
        out: (line) => w.lines.push(line),
      });
      return r.exitCode;
    },
  };
  w.land("handoff 1\n");
  proc(procRoot, ME, { comm: "node", ppid: 1, cwd: home, ticks: 9000 });
  return w;
}
const said = (w: World): string => w.lines.join("\n");
/** A config rule as the launch passes it: `{agent}` and `{evidence}` read as `//` and the folder's real path. */
const resolved = (w: World, r: string): string => r.replace("({agent}", `(/${realpathSync(w.agent)}`).replace("({evidence}", `(/${realpathSync(join(w.home, ".bisellium-evidence"))}`);

test("W-543-b1 behaviour 1: launch runs only as the Patron's clone's CLI on a clean master, outside a session, with nothing agent-writable on PATH; --dry-run prints the claude command built from the code-owned allow list and writes nothing", async () => {
  const cli = spawnSync(process.execPath, ["--import", "tsx", join(REPO, "packages", "cli", "src", "main.ts"), "launch", "--dry-run"], { cwd: REPO, encoding: "utf8", env: { ...process.env, AGENT_DIR: REPO, CLAUDECODE: "", SANDBOX_RUNTIME: "" } });
  assert.equal(cli.status, 1, "the agent clone's CLI refuses to launch");
  assert.match(cli.stdout, /launch: refused: this CLI is in .*, which an agent writes/, "the refusal names the agent clone's CLI");

  let w = world();
  w.env["CLAUDECODE"] = "1";
  assert.equal(await w.launch("--dry-run"), 1, "a launch inside a Claude Code session refused");
  assert.match(said(w), /inside a Claude Code session/, "the refusal names the session");
  assert.deepEqual(w.calls, [], "a launch inside a Claude Code session runs no child");

  w = world();
  git(w.self, "checkout", "-q", "-b", "side");
  assert.equal(await w.launch("--dry-run"), 1, "the Patron's clone off master refused");
  w = world();
  put(join(w.self, ".claude", "refresh", "prompt.md"), "changed\n");
  assert.equal(await w.launch("--dry-run"), 1, "the Patron's clone with a tracked change refused");
  w = world();
  w.env["XDG_STATE_HOME"] = join(w.home, ".bisellium-evidence", "state");
  assert.equal(await w.launch("--dry-run"), 1, "a state folder in the evidence folder refused");
  w = world();
  w.env["PATH"] = `${join(w.agent, "bin")}:${w.env["PATH"]}`;
  assert.equal(await w.launch("--dry-run"), 1, "a PATH entry in the agent clone refused");
  assert.deepEqual(w.calls, [], "a PATH entry in the agent clone runs no child");
  for (const name of ["git", "bash", "gh", "claude"]) {
    w = world();
    put(join(w.agent, "bin", name), "#!/bin/sh\nexit 0\n", 0o755);
    mkdirSync(join(w.t, "safe"));
    symlinkSync(join(w.agent, "bin", name), join(w.t, "safe", name));
    w.env["PATH"] = `${join(w.t, "safe")}:${w.env["PATH"]}`;
    assert.equal(await w.launch("--dry-run"), 1, `a ${name} in a safe PATH folder linked into the agent clone refused`);
    assert.match(said(w), new RegExp(`safe/${name} links to .*/agent/bin/${name}, in a folder an agent writes`), `the refusal names the ${name} link`);
    assert.deepEqual(w.calls, [], `a ${name} linked into the agent clone runs no child`);
  }
  w = world();
  mkdirSync(join(w.t, "safe"));
  symlinkSync(join(w.home, ".bisellium-evidence", "jq"), join(w.t, "safe", "jq"));
  w.env["PATH"] = `${join(w.t, "safe")}:${w.env["PATH"]}`;
  assert.equal(await w.launch("--dry-run"), 1, "a dangling link on PATH into the evidence folder refused, whatever its name");
  w = world();
  w.env["PATH"] = join(w.t, "tools");
  assert.equal(await w.launch("--dry-run"), 1, "no gh on PATH refused");
  assert.match(said(w), /no gh on PATH/, "the refusal names the missing gh");
  w = world();
  rmSync(join(w.t, "bin", "claude"));
  assert.equal(await w.launch("--dry-run"), 1, "no claude on PATH refused");
  w = world();
  assert.equal(await w.launch("--now"), 2, "an unknown flag is a usage error");

  w = world();
  assert.equal(await w.launch("--dry-run"), 0, "a dry run from the Patron's clone exits 0");
  const line = said(w);
  const cfg = JSON.parse(readFileSync(join(REPO, ".claude", "refresh", "launch.json"), "utf8")) as { allow: string[]; disallow: string[] };
  for (const want of ["-u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN", `GH_CONFIG_DIR=${w.agentGh}`, `${join(w.t, "bin", "claude")} -p '<.claude/refresh/prompt.md>'`, "--permission-mode dontAsk", `--add-dir ${join(w.home, ".bisellium-evidence")}`, "--allowedTools Agent", "--output-format json", `in ${w.agent}:`])
    assert.ok(line.includes(want), `the dry run names ${want}`);
  for (const rule of [...cfg.allow, ...cfg.disallow].map((r) => resolved(w, r))) assert.ok(line.includes(rule) || line.includes(`'${rule}'`), `the dry run names the rule ${rule}`);
  const exes = w.calls.map((c) => c.exe);
  assert.ok(exes.length > 0 && exes.every((e) => e === join(w.t, "tools", "git") || e === join(w.t, "tools", "bash") || e === join(w.t, "bin", "gh")), "each child runs by the absolute path PATH selects");
  assert.equal(existsSync(w.state), false, "a dry run writes no state");
  assert.equal(w.calls.some((c) => c.cmd === "session" || (c.cmd === "bash" && c.args[1] === "sync")), false, "a dry run starts no session and runs no sync");
});





