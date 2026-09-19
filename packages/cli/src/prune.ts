import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFront } from "@bisellium/adapter-native";
import { reclaimWorktrees } from "@bisellium/shim";

interface PruneEntry {
  branch: string;
  reason: string;
}

export interface PruneResult {
  removed: PruneEntry[];
  kept: PruneEntry[];
}

function git(args: string[], cwd: string): { status: number; stdout: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
  return { status: r.status ?? -1, stdout: r.stdout ?? "" };
}

export function pruneStaleOpusBranches(repo: string, studio: string): PruneResult {
  const cwd = resolve(repo);
  const removed: PruneEntry[] = [];
  const kept: PruneEntry[] = [];

  const branchList = git(["branch", "--list", "opus/*", "--format=%(refname:short)"], cwd);
  if (branchList.status !== 0) return { removed, kept };

  const branches = branchList.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  if (branches.length === 0) return { removed, kept };

  const merged = git(["branch", "--merged", "HEAD", "--format=%(refname:short)"], cwd);
  const mergedSet = new Set(merged.status === 0 ? merged.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : []);

  const operaDir = join(resolve(studio), "opera");

  for (const branch of branches) {
    const opusId = branch.replace(/^opus\//, "");
    const opusPath = join(operaDir, `${opusId}.md`);

    if (!existsSync(opusPath)) {
      kept.push({ branch, reason: "no opus file found" });
      continue;
    }

    let state: string | undefined;
    try {
      const fm = readFront<Record<string, unknown>>(opusPath);
      state = typeof fm.data["state"] === "string" ? fm.data["state"] : undefined;
    } catch {
      kept.push({ branch, reason: "opus file unreadable" });
      continue;
    }

    if (state !== "done") {
      kept.push({ branch, reason: `opus state is "${state}"` });
      continue;
    }

    if (!mergedSet.has(branch)) {
      kept.push({ branch, reason: "not merged into HEAD" });
      continue;
    }

    const del = git(["branch", "-d", branch], cwd);
    if (del.status === 0) {
      removed.push({ branch, reason: "done and merged" });
    } else {
      kept.push({ branch, reason: "delete failed" });
    }
  }

  return { removed, kept };
}

const PRUNE_USAGE = "usage: bisellium prune --studio <dir> [--repo <dir>]";

const PRUNE_FLAGS = new Set(["--studio", "--repo"]);

export function runPrune(args: string[]): { exitCode: number } {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--") || !PRUNE_FLAGS.has(a)) {
      console.error(`${a.startsWith("--") ? `unknown flag "${a}"` : `unexpected argument "${a}"`}\n${PRUNE_USAGE}`);
      return { exitCode: 2 };
    }
    const v = args[++i];
    if (v === undefined) {
      console.error(`${a} needs a value\n${PRUNE_USAGE}`);
      return { exitCode: 2 };
    }
    values.set(a, v);
  }

  const studio = resolve(values.get("--studio") ?? ".");
  const repo = resolve(values.get("--repo") ?? ".");

  if (!existsSync(join(studio, "opera"))) {
    console.error(`no opera directory at ${studio}`);
    return { exitCode: 2 };
  }

  const worktreeResult = reclaimWorktrees(repo);
  const branchResult = pruneStaleOpusBranches(repo, studio);

  if (worktreeResult.removed.length > 0) {
    for (const w of worktreeResult.removed) console.log(`worktree removed: ${w.path} (${w.reason})`);
  }
  if (branchResult.removed.length > 0) {
    for (const b of branchResult.removed) console.log(`branch removed: ${b.branch} (${b.reason})`);
  }
  if (worktreeResult.removed.length === 0 && branchResult.removed.length === 0) {
    console.log("nothing to prune");
  }

  return { exitCode: 0 };
}
