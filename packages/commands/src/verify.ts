/**
 * `bisellium verify <opus-id>` — runs each automated probatio's command
 * (packages/pipeline) against the current tree and writes the outcome back
 * into that opus's front matter. This is the first tool-written change to
 * an opus: it may write ONLY the automated probationes' status/evidence/
 * certifies, preserving every other key (order included) and the body
 * byte-for-byte. Kept out of main.ts on purpose — wired in by the
 * integrator alongside the other builders' commands.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { parseDocument } from "yaml";
import { readManifest, snapshotDir } from "@bisellium/adapter-native";
import { localPipeline, selectPipeline, type GateRunResult, type MergePipeline } from "@bisellium/pipeline";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { editOpusFrontMatter, splitFront } from "./frontmatter.js";

export interface RunVerifyOptions {
  /** Override pipeline selection — mainly for tests. Defaults to selectPipeline(). */
  pipeline?: MergePipeline;
  /** Overrides the officina's position within `repo`'s tree, used only to
   *  exclude studio bookkeeping from the source-tree hash and dirty check.
   *  Needed whenever `repo` is not the checkout `--studio` actually lives
   *  under — `bisellium ci --ref` hands `repo` a scratch worktree of a
   *  different ref while `--studio` still names the real officina, so
   *  `relative(repo, studioDir)` walks all the way out of `repo` and
   *  matches nothing in ITS tree; the worktree's own, ref-checked-out
   *  `studio/` then gets hashed in instead of excluded. Defaults to
   *  `relative(repo, studioDir)`, which is correct whenever `--studio`
   *  really is nested under `--repo` (every direct, non-`--ref` call). */
  studioRepoRelative?: string;
}

export interface RunVerifyResult {
  exitCode: number;
}

const USAGE =
  "usage: bisellium verify <opus-id> [--studio <dir>] [--repo <dir>] [--commit <ref>] [--now <iso>] [--allow-dirty]";

const GIT_TIMEOUT_MS = 30_000;

interface ParsedArgs {
  id?: string;
  studio: string;
  repo?: string;
  commit: string;
  now: Date;
  allowDirty: boolean;
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  let id: string | undefined;
  let studio = ".";
  let repo: string | undefined;
  let commit = "HEAD";
  let now = new Date();
  let allowDirty = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--allow-dirty") {
      allowDirty = true;
      continue;
    }
    if (a === "--studio" || a === "--repo" || a === "--commit" || a === "--now") {
      const v = args[++i];
      if (v === undefined) return { error: `${a} needs a value\n${USAGE}` };
      if (a === "--studio") studio = v;
      else if (a === "--repo") repo = v;
      else if (a === "--commit") commit = v;
      else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return { error: `--now must be an ISO date\n${USAGE}` };
        now = d;
      }
      continue;
    }
    if (a.startsWith("--")) return { error: `flag ${a} not allowed for "verify"\n${USAGE}` };
    if (id !== undefined) return { error: `unexpected argument "${a}"\n${USAGE}` };
    id = a;
  }
  return { id, studio, repo, commit, now, allowDirty };
}

function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: dir,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/** POSIX-separated path of `path` relative to `base`. Exported so callers
 *  that hand `runVerify` a `repo` other than the one `--studio` lives under
 *  (`ci.ts`'s `--ref` path) can compute the same shape of value for
 *  `RunVerifyOptions.studioRepoRelative`, rooted at the checkout `--studio`
 *  really is nested under instead of at `repo`. */
export function toPosixRelative(base: string, path: string): string {
  return relative(base, path).split(sep).join("/");
}

export async function runVerify(args: string[], opts: RunVerifyOptions = {}): Promise<RunVerifyResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    console.error(parsed.error);
    return { exitCode: 2 };
  }
  const { id: opusId, commit, now } = parsed;
  if (!opusId) {
    console.error(USAGE);
    return { exitCode: 2 };
  }

  const studioDir = resolve(parsed.studio);
  const manifestPath = join(studioDir, "bisellium.yml");
  if (!existsSync(manifestPath)) {
    console.error(`${manifestPath} not found — not a studio`);
    return { exitCode: 2 };
  }

  let manifest: ReturnType<typeof readManifest>;
  try {
    manifest = readManifest(studioDir);
  } catch (e) {
    console.error(`${manifestPath} unparseable — not a studio: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  const opusPath = join(studioDir, "opera", `${opusId}.md`);
  if (!existsSync(opusPath)) {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }

  const repo = resolve(parsed.repo ?? (isGitRepo(resolve(studioDir, "..")) ? resolve(studioDir, "..") : process.cwd()));
  // The studio's own bookkeeping (opera front matter, ci logs, receipts)
  // never counts toward what a probatio certifies or whether the tree is
  // "dirty" — otherwise verify writing its own result, or committing that
  // write, would make every certificate stale or refuse to run at all.
  const excludeDirs = [
    opts.studioRepoRelative ?? toPosixRelative(repo, studioDir),
    ".bisellium",
    ...(manifest.source_excludes ?? []),
  ];
  let treeHash: string;
  try {
    treeHash = sourceTreeHash(repo, excludeDirs, commit);
  } catch (e) {
    console.error(`could not resolve source tree for "${commit}" in ${repo}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  // Honest certifies: a certificate is a claim about what was actually run.
  // If the SOURCE tree is dirty, the commands below run against files that
  // don't match `treeHash` — certifying `tree:<hash>` would be a lie. Refuse
  // unless the caller explicitly accepts a `dirty:<hash>` certificate instead.
  let dirty = false;
  if (isGitRepo(repo)) {
    try {
      dirty = isDirtyOutside(repo, excludeDirs);
    } catch (e) {
      console.error(`could not check working tree status in ${repo}: ${(e as Error).message}`);
      return { exitCode: 2 };
    }
    if (dirty && !parsed.allowDirty) {
      console.error("working tree is dirty; commit or pass --allow-dirty");
      return { exitCode: 2 };
    }
  }

  const commands: Record<string, string> = {};
  for (const p of manifest.probationes) if (p.kind === "automated" && p.command) commands[p.id] = p.command;

  let snap: ReturnType<typeof snapshotDir>;
  try {
    snap = snapshotDir(studioDir, "verify", now);
  } catch (e) {
    console.error(`could not read studio: ${(e as Error).message}`);
    return { exitCode: 2 };
  }
  const opus = snap.opera.find((o) => o.id === opusId);
  if (!opus) {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }

  const raw = readFileSync(opusPath, "utf8");
  const split = splitFront(raw);
  if (!split) {
    console.error(`${opusPath}: missing front matter`);
    return { exitCode: 2 };
  }
  const doc = parseDocument(split.front);

  // A gate the studio has already waived is never touched by verify, even if
  // it has a command in the manifest — don't run its command at all, and
  // leave every one of its keys (waived_by, note, comments, …) exactly as is.
  const waivedIds: string[] = [];
  const runCommands: Record<string, string> = {};
  for (const [gateId, command] of Object.entries(commands)) {
    const currentStatus = doc.getIn(["probationes", gateId, "status"]);
    if (currentStatus === "waived") waivedIds.push(gateId);
    else runCommands[gateId] = command;
  }

  const logDir = join(studioDir, "ci");
  const runOpts = { opus, repo, commands: runCommands, treeHash, logDir, now, studioDir, dirty };
  const pipeline = opts.pipeline ?? selectPipeline();
  let results: Record<string, GateRunResult>;
  try {
    results = await pipeline.run(runOpts);
  } catch {
    // MergePipeline's contract: an unusable pipeline throws rather than
    // half-run — fall back to the local runner so `verify` still completes.
    results = await localPipeline.run(runOpts);
  }

  // Merge, don't replace: set status/evidence/certifies individually on the
  // existing probatio node so sibling keys (waived_by, note, …) and comments
  // survive — only these three keys are ever tool-written. Nothing else
  // touches opusPath between the read above and this write, so re-parsing
  // it here (via the shared editOpusFrontMatter seam every write command
  // uses — see frontmatter.ts) is equivalent to mutating `doc` in place.
  editOpusFrontMatter(opusPath, (freshDoc) => {
    for (const [gateId, r] of Object.entries(results)) {
      freshDoc.setIn(["probationes", gateId, "status"], r.status);
      freshDoc.setIn(["probationes", gateId, "evidence"], r.evidence);
      freshDoc.setIn(["probationes", gateId, "certifies"], r.certifies);
    }
    return undefined;
  });

  let anyFailed = false;
  for (const id of waivedIds) console.log(`${id}: waived (untouched)`);
  for (const [gateId, r] of Object.entries(results)) {
    console.log(`${gateId}: ${r.status}  ${r.evidence}`);
    if (r.status === "failed") anyFailed = true;
  }

  return { exitCode: anyFailed ? 1 : 0 };
}
