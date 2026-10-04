import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFront, readManifest } from "@bisellium/adapter-native";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
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

/** Every regular file under `dir` outside `ci/` (symlinks are never followed), as one string. */
function officinaTextOutsideCi(root: string): string {
  const parts: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entryRel === "ci") continue;
      if (entry.isDirectory()) walk(join(dir, entry.name), entryRel);
      else if (entry.isFile()) parts.push(readFileSync(join(dir, entry.name), "utf8"));
    }
  };
  walk(root, "");
  return parts.join("\n");
}

/** W-131: removes the gate logs (`<opus>-<probatio>-<tree8>.log`) of a `done` opus that nothing outside `ci/` cites. */
export function pruneCiLogs(studio: string): { removed: string[] } {
  const root = resolve(studio);
  const removed: string[] = [];
  const ciDir = join(root, "ci");
  if (!existsSync(ciDir)) return { removed };
  const probationes = readManifest(root).probationes.map((p) => p.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (probationes.length === 0) return { removed };
  const shape = new RegExp(`^([A-Za-z]+-\\d+)-(?:${probationes.join("|")})-[0-9a-f]{8}\\.log$`);
  let cited: string | undefined;
  for (const name of readdirSync(ciDir)) {
    const opus = shape.exec(name)?.[1];
    // A verdict log (`<opus>-spec|review-<round>.log`) is evidence, never a gate log, even when the round is eight digits.
    if (opus === undefined || /-(?:spec|review)-\d+\.log$/.test(name)) continue;
    const opusFile = readContainedRegularFile(root, `opera/${opus}.md`, "opera");
    if ("error" in opusFile || readFront<Record<string, unknown>>(opusFile.absolute).data["state"] !== "done") continue;
    cited ??= officinaTextOutsideCi(root);
    if (cited.includes(`ci/${name}`)) continue;
    const log = readContainedRegularFile(root, `ci/${name}`, "ci");
    if ("error" in log) continue;
    unlinkSync(log.absolute);
    removed.push(`ci/${name}`);
  }
  return { removed };
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
  const logResult = pruneCiLogs(studio);

  if (worktreeResult.removed.length > 0) {
    for (const w of worktreeResult.removed) console.log(`worktree removed: ${w.path} (${w.reason})`);
  }
  if (branchResult.removed.length > 0) {
    for (const b of branchResult.removed) console.log(`branch removed: ${b.branch} (${b.reason})`);
  }
  for (const name of logResult.removed) console.log(`ci log removed: ${name}`);
  if (worktreeResult.removed.length === 0 && branchResult.removed.length === 0 && logResult.removed.length === 0) {
    console.log("nothing to prune");
  }

  return { exitCode: 0 };
}
