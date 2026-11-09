/**
 * W-543: `bisellium launch`, the verb a timer the Patron installs runs to start one normal refresh session in the agent
 * clone from a landed handoff (studio/briefs/W-543.md). It runs only as the Patron's clone's CLI (the installed
 * `bisellium`, W-379), reads its allow list, prompt and scripts from that clone alone, and judges the agent clone only by
 * reading it: it runs nothing an agent can write. It starts `claude -p` with every hook (never a Stop-hook relaunch, never
 * scripts/cascade-loop.sh), under `--permission-mode dontAsk` and the code-owned allow list in `.claude/refresh/`.
 * Before its first child process it judges PATH: every entry, and the real target of every link in a PATH folder, lies
 * outside both agent-writable folders, and git, bash, gh and claude run by the absolute paths found there. A real launch
 * may sync the agent clone, then otherwise refuses with one `launch: refused:` line and exit 1, writing no launch state
 * and starting no session; `--dry-run` judges the same but the sync and prints the command it would run, writing nothing.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LAUNCH_USAGE = "usage: bisellium launch [--dry-run]";

/** The code-owned launch inputs, relative to the CLI's own checkout (the Patron's clone). */
export const LAUNCH_CONFIG = ".claude/refresh/launch.json";
export const LAUNCH_PROMPT = ".claude/refresh/prompt.md";
/** The GitHub tokens an ambient environment would let override the agent's own gh config (agent-workspace.sh agent_gh). */
const GH_TOKENS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN"] as const;
const HANDOFF = "docs/SESSION-HANDOFF.md";
/** The programs the launch runs, each by the absolute path PATH selects. */
const EXES = ["git", "bash", "gh", "claude"] as const;
/** The rule tokens the config's path rules may start with, replaced by `//` and the folder's real path. */
const TOKENS = { "{agent}": "agent", "{evidence}": "evidence" } as const;
const CHECK_MS = 120_000;

export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}
export interface LaunchDeps {
  /** The top of the git checkout this CLI's own file is in. */
  self: string;
  env: NodeJS.ProcessEnv;
  /** `/proc`, or a test's stand-in. */
  procRoot: string;
  /** This process's pid. */
  pid: number;
  now: () => Date;
  /** A bounded child run: git in the Patron's clone, its scripts and gh. */
  run: (cmd: string, args: readonly string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number }) => Ran;
  /** The session itself: runs to its end, its stdout the `--output-format json` result. */
  session: (cmd: string, args: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ status: number | null; stdout: string }>;
  out: (line: string) => void;
}

/** The nearest ancestor directory of `file` holding `.git` (a directory or a linked worktree's file). */
function checkoutOf(file: string): string | undefined {
  for (let d = dirname(file); ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return undefined;
  }
}
/** The real path of `p`: `realpath` where it exists; a dangling link judged at its target; a missing tail joined, as
 *  written, to its nearest existing ancestor's real path (so a folder not yet made is judged where it would be). */
function real(p: string, links = 0): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    /* judged below */
  }
  try {
    if (links < 40 && lstatSync(abs).isSymbolicLink()) return real(resolve(dirname(abs), readlinkSync(abs)), links + 1);
  } catch {
    /* not there */
  }
  const up = dirname(abs);
  return up === abs ? abs : join(real(up, links), basename(abs));
}
/** True when `child` is `parent` or under it, both read as given. */
const within = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const firstLine = (s: string): string => (s.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "").slice(0, 200);
const quote = (w: string): string => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);

export function defaultDeps(): LaunchDeps {
  return {
    self: checkoutOf(realpathSync(fileURLToPath(import.meta.url))) ?? "",
    env: process.env,
    procRoot: "/proc",
    pid: process.pid,
    now: () => new Date(),
    run: (cmd, args, o) => {
      const r = spawnSync(cmd, args, { cwd: o.cwd, env: o.env ?? process.env, encoding: "utf8", timeout: o.timeoutMs });
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? r.error.message : "") };
    },
    session: (cmd, args, o) =>
      new Promise((done) => {
        const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "inherit"] });
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (c: string) => (stdout += c));
        child.on("error", () => done({ status: null, stdout }));
        child.on("close", (status) => done({ status, stdout }));
      }),
    out: (line) => console.log(line),
  };
}

/** Where the launch reads and writes: the agent clone, its gh config, the evidence folder and the launch's own state. */
interface Places {
  home: string;
  agent: string;
  agentGh: string;
  evidence: string;
  state: string;
}
function places(env: NodeJS.ProcessEnv): Places | string {
  const home = env["HOME"] ?? "";
  if (!isAbsolute(home)) return "HOME is not an absolute path";
  const p: Places = {
    home,
    agent: env["AGENT_DIR"] ?? join(home, "agents", "bisellium"),
    agentGh: env["AGENT_GH"] ?? join(home, ".config", "agent-gh"),
    evidence: join(home, ".bisellium-evidence"),
    state: join(env["XDG_STATE_HOME"] ?? join(home, ".local", "state"), "bisellium", "launch"),
  };
  for (const [k, v] of [["AGENT_DIR", p.agent], ["AGENT_GH", p.agentGh], ["XDG_STATE_HOME", p.state]] as const) if (!isAbsolute(v)) return `${k} is not an absolute path`;
  return p;
}

/** The launch's own config (LAUNCH_CONFIG). */
export interface LaunchConfig {
  allow: string[];
  disallow: string[];
  addDirs: string[];
  cap: { starts: number; hours: number };
}

/** A process as `/proc/<pid>/stat` reads: its state, parent and start time in clock ticks (field 22). */
function stat(procRoot: string, pid: number): { state: string; ppid: number; ticks: number } | undefined {
  let text: string;
  try {
    text = readFileSync(join(procRoot, String(pid), "stat"), "utf8");
  } catch {
    return undefined;
  }
  const rest = text.slice(text.lastIndexOf(")") + 1).trim().split(/\s+/);
  const ppid = Number(rest[1]);
  const ticks = Number(rest[19]);
  if (rest.length < 20 || !/^[A-Za-z]$/.test(rest[0] ?? "") || !Number.isInteger(ppid) || !Number.isInteger(ticks)) return undefined;
  return { state: rest[0]!, ppid, ticks };
}
/** The live processes whose working folder is in the agent clone, but this one and its ancestors. */
function agentProcesses(procRoot: string, pid: number, agent: string): { pid: number; name: string; cwd: string }[] {
  const mine = new Set<number>();
  for (let p = pid, n = 0; p > 1 && n < 64 && !mine.has(p); n++) {
    mine.add(p);
    p = stat(procRoot, p)?.ppid ?? 0;
  }
  const found: { pid: number; name: string; cwd: string }[] = [];
  let entries: string[];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return found;
  }
  for (const e of entries) {
    if (!/^[1-9][0-9]*$/.test(e) || mine.has(Number(e))) continue;
    let cwd: string;
    try {
      cwd = readlinkSync(join(procRoot, e, "cwd"));
    } catch {
      continue;
    }
    if (!within(cwd, agent) || stat(procRoot, Number(e))?.state === "Z") continue;
    let name = "";
    try {
      name = readFileSync(join(procRoot, e, "comm"), "utf8").trim();
      const argv0 = readFileSync(join(procRoot, e, "cmdline"), "utf8").split("\0")[0] ?? "";
      if (basename(argv0) === "claude") name = "claude";
    } catch {
      /* a name that cannot be read is not a session's */
    }
    found.push({ pid: Number(e), name, cwd });
  }
  return found;
}

/** The first fault of PATH, judged before any child runs: an entry relative or whose real path is in a folder an agent
 *  writes, or a link in a PATH folder whose real target is in one (whatever its name, dangling or not). */
function pathFault(path: string, writable: readonly string[]): string | undefined {
  const inside = (q: string): boolean => writable.some((w) => within(q, w));
  for (const d of path.split(delimiter)) {
    if (!isAbsolute(d) || inside(real(d))) return `PATH entry '${d}' is relative or in a folder an agent writes`;
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      const e = join(d, n);
      try {
        if (!lstatSync(e).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      if (inside(real(e))) return `${e} links to ${real(e)}, in a folder an agent writes`;
    }
  }
  return undefined;
}

/** The first `name` on PATH that is an executable file. */
function onPath(name: string, path: string): string | undefined {
  for (const d of path.split(delimiter)) {
    const p = join(d, name);
    try {
      if (statSync(p).isFile() && (statSync(p).mode & 0o111) !== 0) return p;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

interface Start {
  at: string;
  handoff: string;
}
/** `starts.jsonl`: one `{ at, handoff }` per launch started, oldest first; a string names a fault. */
function readStarts(file: string): Start[] | string {
  if (!existsSync(file)) return [];
  const out: Start[] = [];
  for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      return `${file} line ${i + 1} is not JSON`;
    }
    if (!isDict(v) || typeof v["at"] !== "string" || Number.isNaN(Date.parse(v["at"])) || typeof v["handoff"] !== "string" || !/^[0-9a-f]{40}$/.test(v["handoff"])) return `${file} line ${i + 1} is not { at, handoff }`;
    out.push({ at: v["at"], handoff: v["handoff"] });
  }
  return out;
}

export async function runLaunch(argv: readonly string[], deps: LaunchDeps = defaultDeps()): Promise<{ exitCode: number }> {
  let dryRun = false;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else {
      deps.out(`${a} is not a launch flag\n${LAUNCH_USAGE}`);
      return { exitCode: 2 };
    }
  }
  const refuse = (why: string): { exitCode: number } => {
    deps.out(`launch: refused: ${why}`);
    return { exitCode: 1 };
  };
  const p = places(deps.env);
  if (typeof p === "string") return refuse(p);
  const clone = real(deps.self);
  const agent = real(p.agent);
  const evidence = real(p.evidence);

  // the Patron's clone, and nothing agent-writable on the way: all judged before the first child process
  if (deps.self === "") return refuse("this CLI is not in a git checkout");
  if (within(clone, agent) || within(clone, evidence)) return refuse(`this CLI is in ${clone}, which an agent writes; launch runs only as the Patron's clone's CLI, the installed bisellium`);
  if ((deps.env["CLAUDECODE"] ?? "") !== "" || (deps.env["SANDBOX_RUNTIME"] ?? "") !== "") return refuse("launch runs from the Patron's timer or terminal, never inside a Claude Code session");
  const state = real(p.state);
  if (within(state, agent) || within(state, evidence)) return refuse(`the launch state ${state} is in a folder an agent writes`);
  const path = deps.env["PATH"] ?? "";
  const pathWrong = pathFault(path, [agent, evidence]);
  if (pathWrong !== undefined) return refuse(pathWrong);
  const found = EXES.map((n) => [n, onPath(n, path)] as const);
  const absent = found.find(([, at]) => at === undefined);
  if (absent !== undefined) return refuse(`no ${absent[0]} on PATH`);
  const [gitExe, bashExe, ghExe, claude] = found.map(([, at]) => at!) as [string, string, string, string];
  const git = (...args: string[]): Ran => deps.run(gitExe, ["-C", clone, ...args], { timeoutMs: CHECK_MS });
  if (git("symbolic-ref", "-q", "HEAD").stdout.trim() !== "refs/heads/master") return refuse(`${clone} is not on master; launch runs only from the Patron's clone on master`);
  const dirty = git("--no-optional-locks", "status", "--porcelain", "--untracked-files=no");
  if (dirty.status !== 0 || dirty.stdout.trim() !== "") return refuse(`${clone} has uncommitted tracked changes or git status failed; launch runs only from a clean master`);

  // the code-owned allow list and prompt, read from the Patron's clone alone
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(join(clone, LAUNCH_CONFIG), "utf8"));
  } catch {
    return refuse(`${LAUNCH_CONFIG} in ${clone} is missing or not JSON`);
  }
  const c = config as LaunchConfig;
  // the path rules' tokens, read at the agent clone's and the evidence folder's real paths (an absolute `//` rule)
  const folders = { agent, evidence };
  const expand = (r: string): string => {
    for (const [tok, k] of Object.entries(TOKENS)) if (r.includes(`(${tok}`)) return r.replace(`(${tok}`, `(/${folders[k]}`);
    return r;
  };
  const allow = c.allow.map(expand);
  const disallow = c.disallow.map(expand);
  let prompt = "";
  try {
    prompt = readFileSync(join(clone, LAUNCH_PROMPT), "utf8").trim();
  } catch {
    /* judged below */
  }
  if (prompt === "") return refuse(`${LAUNCH_PROMPT} in ${clone} is missing or empty`);

  const lockFile = join(state, "lock.json");
  const startsFile = join(state, "starts.jsonl");
  const resultFile = join(state, "session.json");
  const sessionEnv: NodeJS.ProcessEnv = { ...deps.env, GH_CONFIG_DIR: p.agentGh };
  for (const k of GH_TOKENS) delete sessionEnv[k];
  const handoff = "0".repeat(40);

  const home = (d: string): string => join(p.home, d.slice(2));
  const args = ["-p", prompt, "--permission-mode", "dontAsk", ...c.addDirs.flatMap((d) => ["--add-dir", home(d)]), "--allowedTools", ...allow, ...(disallow.length > 0 ? ["--disallowedTools", ...disallow] : []), "--output-format", "json"];
  const shown = [...GH_TOKENS.flatMap((k) => ["-u", k]), `GH_CONFIG_DIR=${p.agentGh}`, claude, ...args.map((a) => (a === prompt ? `<${LAUNCH_PROMPT}>` : a))];
  if (dryRun) {
    deps.out(`launch: dry run: would start for handoff ${handoff.slice(0, 12)} in ${agent}: env ${shown.map(quote).join(" ")}`);
    return { exitCode: 0 };
  }
  return refuse("only --dry-run runs before behaviour 10");
}
