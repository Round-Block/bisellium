/**
 * @bisellium/shim — the worktree seam. Two providers behind one interface:
 * the always-available git implementation and an optional treehouse pool
 * (kunchenguid/treehouse) used when it happens to be on PATH. Nothing else
 * in the tree may depend on treehouse being installed — `selectProvider`
 * falls back to git whenever it is not.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AcquiredWorktree {
  path: string;
  branch: string;
  release(): Promise<void>;
}

export interface WorktreeProvider {
  id: string;
  acquire(opts: { repo: string; sella: string; base?: string }): Promise<AcquiredWorktree>;
}

function run(cmd: string, args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.error) return { status: -1, stdout: "", stderr: r.error.message };
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runOrThrow(cmd: string, args: string[], cwd?: string): string {
  const r = run(cmd, args, cwd);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** True when `cmd` can be spawned at all (found on PATH), regardless of exit code. */
function isOnPath(cmd: string): boolean {
  return run(cmd, ["--version"]).status !== -1;
}

// ---------------------------------------------------------------------------
// git — always available. Never touches the main working tree: every
// worktree lives under <repo>/.bisellium/worktrees/, which must be
// gitignored (see repo root .gitignore).
// ---------------------------------------------------------------------------

/** First free `<sella>-<n>` under <repo>/.bisellium/worktrees/. */
function firstFreeSlot(worktreesRoot: string, sella: string): number {
  let n = 1;
  while (existsSync(join(worktreesRoot, `${sella}-${n}`))) n++;
  return n;
}

export const gitWorktreeProvider: WorktreeProvider = {
  id: "git",
  async acquire({ repo, sella, base }) {
    const repoAbs = resolve(repo);
    const worktreesRoot = join(repoAbs, ".bisellium", "worktrees");
    mkdirSync(worktreesRoot, { recursive: true });

    const n = firstFreeSlot(worktreesRoot, sella);
    const path = join(worktreesRoot, `${sella}-${n}`);
    const branch = `bisellium/${sella}/${n}`;
    const ref = base ?? "HEAD";

    runOrThrow("git", ["worktree", "add", "-B", branch, path, ref], repoAbs);

    return {
      path,
      branch,
      release: async () => {
        runOrThrow("git", ["worktree", "remove", "--force", path], repoAbs);
        runOrThrow("git", ["branch", "-D", branch], repoAbs);
      },
    };
  },
};

// ---------------------------------------------------------------------------
// treehouse — optional pool-based provider. CLI shape learned from
// https://raw.githubusercontent.com/kunchenguid/treehouse/main/README.md:
// `treehouse get --lease [--lease-holder <label>]` durably leases a worktree
// and prints ONLY its absolute path to stdout (banners go to stderr);
// `treehouse return <path> --force` releases it. The README also documents
// a `--base` override for `get`, but the CLI actually on PATH when this was
// written (v1.8.0) does not accept it — passing an unsupported base is
// surfaced as a normal acquire failure rather than silently ignored.
// ---------------------------------------------------------------------------

export const treehouseProvider: WorktreeProvider = {
  id: "treehouse",
  async acquire({ repo, sella, base }) {
    if (!isOnPath("treehouse")) throw new Error("treehouse not installed");
    const repoAbs = resolve(repo);

    const args = ["get", "--lease", "--lease-holder", sella];
    if (base !== undefined) args.push("--base", base);
    const r = run("treehouse", args, repoAbs);
    if (r.status !== 0) throw new Error(`treehouse get failed: ${(r.stderr || r.stdout).trim()}`);
    const path = r.stdout.trim().split("\n").filter(Boolean).pop();
    if (!path) throw new Error("treehouse get produced no path");

    // treehouse worktrees aren't necessarily on a named branch (pool
    // worktrees can be left detached) — report whatever HEAD actually is,
    // never a fabricated bisellium/<sella>/<n> name.
    const b = run("git", ["-C", path, "rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = b.status === 0 ? b.stdout.trim() : "HEAD";

    return {
      path,
      branch,
      release: async () => {
        runOrThrow("treehouse", ["return", path, "--force"], repoAbs);
      },
    };
  },
};

/** git unless treehouse happens to be on PATH. */
export function selectProvider(): WorktreeProvider {
  return isOnPath("treehouse") ? treehouseProvider : gitWorktreeProvider;
}
