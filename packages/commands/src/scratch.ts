/**
 * `bisellium run --scratch <dir>` (W-474): run a command in a throwaway copy of the repository at one commit, made under
 * `<dir>` (one opus's evidence folder), that shares the repository's git objects instead of copying them, and is
 * deleted when the command ends, and on a failure. No sella, no officina, no receipt: the copy is scratch, not a seat's work.
 *
 * Exit codes: the command's own (128+signal when it was killed by one) · 2 a refusal (bad flags,
 * not a directory, not a repository, no such commit) before any copy is made · 1 the copy could not be made or
 * removed.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { join, resolve } from "node:path";

/** The copy's name under the folder: `scratch.` and mkdtemp's six characters, the form prune-scratch.sh removes. */
export const SCRATCH_PREFIX = "scratch.";
const GIT_TIMEOUT_MS = 120_000;

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

/**
 * The copy's node_modules: a directory of links to the repository's. An entry that is itself a link (a workspace
 * package, `../../packages/x`) is recreated with the same target text, so it resolves inside the copy; every other
 * entry links to the repository's by absolute path. Scoped folders (`@x/`) are walked one level down.
 */
function linkModules(repo: string, copy: string): void {
  const from = join(repo, "node_modules");
  if (!existsSync(from) || !statSync(from).isDirectory()) return;
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
  return remove() ? status : 1;
}
