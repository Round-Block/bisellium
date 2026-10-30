/**
 * `bisellium run --scratch <dir>` (W-474): run a command in a throwaway copy of the repository at one commit, made under
 * `<dir>` (one opus's evidence folder), that shares the repository's git objects instead of copying them, and is
 * deleted when the command ends, on a failure and on SIGINT, SIGTERM or SIGHUP too. A folder at or over
 * `SCRATCH_CAP_BYTES` refuses the next copy. No sella, no officina, no receipt: the copy is scratch, not a seat's work.
 *
 * Exit codes: the command's own (128+signal when it was killed by one, or when this run was) · 2 a refusal (bad flags,
 * not a directory, not a repository, no such commit, the cap) before any copy is made · 1 the copy could not be made or
 * removed.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { join, resolve } from "node:path";

/** 3 GiB: the most one opus's evidence folder holds before the next copy is refused. */
export const SCRATCH_CAP_BYTES = 3 * 1024 ** 3;
/** The copy's name under the folder: `scratch.` and mkdtemp's six characters, the form prune-scratch.sh removes. */
export const SCRATCH_PREFIX = "scratch.";
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const GIT_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 5_000;

export interface ScratchArgs {
  dir: string;
  repo?: string;
  base?: string;
  cmd: string[];
}

function git(cwd: string, args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  return { status: r.error ? -1 : (r.status ?? -1), out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.error?.message ?? "").trim() };
}

/** The bytes `dir` holds: the size of every regular file under it, symlinks never followed; stops counting past `stop`. */
export function folderBytes(dir: string, stop = Infinity): number {
  let total = 0;
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (total >= stop) return;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) total += lstatSync(p).size;
    }
  };
  walk(dir);
  return total;
}

const gb = (n: number): string => (n / 1024 ** 3).toFixed(2);

/**
 * The copy's node_modules: a directory of links to the repository's. An entry that is itself a link (a workspace
 * package, `../../packages/x`) is recreated with the same target text, so it resolves inside the copy; every other
 * entry links to the repository's by absolute path. Scoped folders (`@x/`) are walked one level down.
 */
function linkModules(repo: string, copy: string): void {
  const from = join(repo, "node_modules");
  if (!existsSync(from) || !lstatSync(from).isDirectory()) return; // lstat: a symlinked node_modules is not linked
  const into = join(copy, "node_modules");
  const link = (src: string, dst: string): void => {
    if (lstatSync(src).isSymbolicLink()) symlinkSync(readlinkSync(src), dst);
    else symlinkSync(src, dst);
  };
  mkdirSync(into);
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name);
    if (e.name.startsWith("@") && e.isDirectory()) {
      mkdirSync(join(into, e.name));
      for (const s of readdirSync(src)) link(join(src, s), join(into, e.name, s));
    } else link(src, join(into, e.name));
  }
}

export async function runScratch(a: ScratchArgs): Promise<number> {
  const say = (m: string): void => console.error(`bisellium run --scratch: ${m}`);
  if (!existsSync(a.dir) || !statSync(a.dir).isDirectory()) {
    say(`${a.dir} is not a directory`);
    return 2;
  }
  const dir = realpathSync(a.dir);
  const top = git(resolve(a.repo ?? "."), ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    say(`${resolve(a.repo ?? ".")} is not inside a git repository`);
    return 2;
  }
  const repo = top.out;
  const base = a.base ?? "HEAD";
  const commit = git(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${base}^{commit}`]);
  if (commit.status !== 0 || commit.out === "") {
    say(`${base} is not a commit in ${repo}`);
    return 2;
  }
  const held = folderBytes(dir, SCRATCH_CAP_BYTES);
  if (held >= SCRATCH_CAP_BYTES) {
    say(`${dir} holds ${gb(held)} GiB, at or over the ${gb(SCRATCH_CAP_BYTES)} GiB cap of one opus's folder; no copy is made`);
    return 2;
  }

  const copy = mkdtempSync(join(dir, SCRATCH_PREFIX));
  let child: ReturnType<typeof spawn> | undefined;
  let removed = false;
  const remove = (): boolean => {
    if (removed) return true;
    try {
      rmSync(copy, { recursive: true, force: true });
      removed = true;
    } catch (e) {
      say(`could not remove ${copy}: ${(e as Error).message}`);
    }
    return removed;
  };
  // the trap: a signal stops the command, waits for it, removes the copy and exits 128+signal
  const handlers = SIGNALS.map((sig) => {
    const h = (): void => {
      const code = 128 + (osConstants.signals[sig] ?? 0);
      const done = (): void => {
        remove();
        process.exit(code);
      };
      if (child === undefined || child.exitCode !== null || child.signalCode !== null) return done();
      child.once("exit", done);
      child.kill(sig);
      setTimeout(() => child?.kill("SIGKILL"), STOP_GRACE_MS).unref();
    };
    process.on(sig, h);
    return [sig, h] as const;
  });
  const status = await (async (): Promise<number> => {
    const cloned = git(dir, ["clone", "-q", "--shared", "--no-checkout", "--", repo, copy]);
    if (cloned.status !== 0) {
      say(`git clone --shared failed: ${cloned.err}`);
      return 1;
    }
    const out = git(copy, ["checkout", "-q", "--detach", commit.out]);
    if (out.status !== 0) {
      say(`git checkout of ${commit.out} failed: ${out.err}`);
      return 1;
    }
    linkModules(repo, copy);
    return new Promise<number>((res) => {
      child = spawn(a.cmd[0]!, a.cmd.slice(1), { cwd: copy, env: { ...process.env, BISELLIUM_SCRATCH: copy }, stdio: "inherit" });
      child.on("error", (err) => {
        say(`failed to start "${a.cmd[0]}": ${err.message}`);
        res(127);
      });
      child.on("exit", (code, signal) => res(code ?? 128 + (signal === null ? 0 : (osConstants.signals[signal] ?? 0))));
    });
  })().catch((e: unknown) => {
    say(`the copy could not be made: ${(e as Error).message}`);
    return 1;
  });
  for (const [sig, h] of handlers) process.off(sig, h);
  return remove() ? status : 1;
}
