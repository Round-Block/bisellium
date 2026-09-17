/**
 * @bisellium/shim — the worktree seam. Two providers behind one interface:
 * the always-available git implementation and an optional treehouse pool
 * (kunchenguid/treehouse) used when it happens to be on PATH. Nothing else
 * in the tree may depend on treehouse being installed — `selectProvider`
 * falls back to git whenever it is not.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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

const TIMEOUT_MS = 30_000;

function run(cmd: string, args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS });
  if (r.error) return { status: -1, stdout: "", stderr: r.error.message };
  if (r.signal) return { status: -1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") || `killed by ${r.signal} (timed out after ${TIMEOUT_MS}ms)` };
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

// ---------------------------------------------------------------------------
// reclaim — `bisellium run --reclaim` (W-008 follow-up). Worktree growth
// under <repo>/.bisellium/worktrees/ is otherwise unbounded: every `run`
// without `--keep` on a clean tree already cleans up after itself, but a
// crashed run, a `--keep`, or a dirty worktree left behind by a builder that
// later merged its branch all leak a slot forever. This only ever removes a
// slot whose directory is gone (stale `git worktree` bookkeeping) or whose
// branch is fully merged into HEAD and has no uncommitted changes — never a
// worktree that's still doing something.
// ---------------------------------------------------------------------------

export interface ReclaimResult {
  removed: { path: string; branch?: string; reason: "missing" | "merged" }[];
  kept: { path: string; reason: string }[];
}

interface WorktreeEntry {
  path: string;
  branch?: string;
}

/** Parses `git worktree list --porcelain` into one entry per worktree. */
function parseWorktreeList(text: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (current) entries.push(current);
  return entries;
}

export function reclaimWorktrees(repo: string): ReclaimResult {
  const repoAbs = resolve(repo);
  const worktreesRoot = join(repoAbs, ".bisellium", "worktrees");
  const removed: ReclaimResult["removed"] = [];
  const kept: ReclaimResult["kept"] = [];
  if (!existsSync(worktreesRoot)) return { removed, kept };

  const list = run("git", ["worktree", "list", "--porcelain"], repoAbs);
  const registered = list.status === 0 ? parseWorktreeList(list.stdout) : [];
  const byPath = new Map(registered.map((e) => [resolve(e.path), e] as const));

  const merged = run("git", ["branch", "--merged", "HEAD", "--format=%(refname:short)"], repoAbs);
  const mergedBranches = new Set(merged.status === 0 ? merged.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : []);

  let slots: string[] = [];
  try {
    slots = readdirSync(worktreesRoot);
  } catch {
    slots = [];
  }

  for (const slot of slots) {
    const path = join(worktreesRoot, slot);
    const entry = byPath.get(resolve(path));
    const dirMissing = !existsSync(path);

    if (dirMissing) {
      // git already knows the slot is gone, or never registered it — either
      // way there's nothing to run `worktree remove` against; just drop the
      // branch (if any) and the leftover directory entry, then let `prune`
      // clean up git's own bookkeeping.
      run("git", ["worktree", "prune"], repoAbs);
      if (entry?.branch && mergedBranches.has(entry.branch)) run("git", ["branch", "-D", entry.branch], repoAbs);
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        /* already gone */
      }
      removed.push({ path, branch: entry?.branch, reason: "missing" });
      continue;
    }

    if (!entry) {
      kept.push({ path, reason: "not registered with git worktree list — leaving it alone" });
      continue;
    }

    if (entry.branch && mergedBranches.has(entry.branch)) {
      const status = run("git", ["-C", path, "status", "--porcelain"], repoAbs);
      if (status.status === 0 && status.stdout.trim().length === 0) {
        const rm = run("git", ["worktree", "remove", "--force", path], repoAbs);
        if (rm.status === 0) {
          run("git", ["branch", "-D", entry.branch], repoAbs);
          removed.push({ path, branch: entry.branch, reason: "merged" });
          continue;
        }
      }
    }
    kept.push({ path, reason: entry.branch ? `branch "${entry.branch}" not merged, or has uncommitted changes` : "detached, in use" });
  }

  return { removed, kept };
}
