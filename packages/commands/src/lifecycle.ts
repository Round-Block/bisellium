/**
 * packages/commands/src/lifecycle.ts — W-020: the per-behaviour red store
 * (`bisellium red`), landed first per the brief ("Land red on master first
 * ... Builder B cannot record a single red for W-021 until that commit
 * exists"). `ready`/`done`/`review` land in a follow-up commit on this
 * same branch. Kept out of main.ts's generic flag table on purpose, same
 * as `verify`/`talk` — this parses its own argv.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { openStudio, parseFlags, resolveNow, type WriteOptions, type WriteResult } from "./writes.js";

const GIT_TIMEOUT_MS = 30_000;

/** Same fallback chain `context`/`hook-event` already use: an explicit
 *  `--sella`, else $BISELLIUM_SELLA, else the "guest" sella every studio
 *  declares. */
function resolveSella(flagValue: string | undefined): string {
  return flagValue ?? process.env["BISELLIUM_SELLA"] ?? "guest";
}

const RED_USAGE =
  "usage: bisellium red <opus> --behaviour <n> [--sella <id>] [--studio <dir>] [--repo <dir>] [--now <iso>] -- <cmd…>";

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

/**
 * Same containment idiom as writes.ts's `safeItemPath`, applied to a
 * directory (`<studio>/ci/reds/<opus>/`) instead of an `<id>.md` file — an
 * opus id with a path separator or a `..` segment is rejected outright, and
 * `dirname(dir) !== resolvedBase` is defense in depth against `join()`'s own
 * normalization ever surprising us (resolved-path relation, never `startsWith`).
 */
function safeRedsDir(studioRoot: string, opusId: string): string | { error: string } {
  if (!opusId || /[\\/]/.test(opusId) || opusId === "." || opusId === "..") return { error: `invalid opus id "${opusId}"` };
  const base = resolve(join(studioRoot, "ci", "reds"));
  const dir = join(base, opusId);
  if (dirname(dir) !== base) return { error: `invalid opus id "${opusId}"` };
  return dir;
}

/** Runs `cmd` (cwd: the caller's own), collecting stdout+stderr in the order
 *  the OS actually delivers them — real chronological combination, which is
 *  why this (unlike ready/done/review) has to be async. */
function runCapture(cmd: string[], cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((done) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", (err) => done({ exitCode: 1, output: output + `\n[red] failed to run command: ${(err as Error).message}\n` }));
    child.on("close", (code) => done({ exitCode: code ?? 1, output }));
  });
}

export async function runRed(args: string[], opts: WriteOptions = {}): Promise<WriteResult> {
  if (args.length === 0) {
    console.error(RED_USAGE);
    return { exitCode: 2 };
  }
  const sepIdx = args.indexOf("--");
  if (sepIdx === -1) {
    console.error(`missing "--" separator before the command\n${RED_USAGE}`);
    return { exitCode: 2 };
  }
  const before = args.slice(0, sepIdx);
  const cmd = args.slice(sepIdx + 1);
  if (cmd.length === 0) {
    console.error(`empty command after "--"\n${RED_USAGE}`);
    return { exitCode: 2 };
  }

  const parsed = parseFlags(before, { valued: ["--behaviour", "--sella", "--studio", "--repo", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${RED_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(RED_USAGE);
    return { exitCode: 2 };
  }

  const behaviourRaw = values.get("--behaviour");
  if (behaviourRaw === undefined || !/^\d+$/.test(behaviourRaw) || Number(behaviourRaw) < 1) {
    console.error(`--behaviour must be a positive integer\n${RED_USAGE}`);
    return { exitCode: 2 };
  }
  const behaviour = Number(behaviourRaw);

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;

  const redsDir = safeRedsDir(root, opusId);
  if (typeof redsDir !== "string") {
    console.error(redsDir.error);
    return { exitCode: 2 };
  }

  const sella = resolveSella(values.get("--sella"));
  const repo = resolve(values.get("--repo") ?? (isGitRepo(resolve(root, "..")) ? resolve(root, "..") : process.cwd()));

  let treeHeader = "unknown";
  if (isGitRepo(repo)) {
    try {
      // Same exclusion set verify.ts computes: the officina itself,
      // .bisellium/, and any manifest source_excludes — so red's own log
      // write is never what makes the tree it just certified "dirty".
      const excludeDirs = [relative(repo, root).split(sep).join("/"), ".bisellium", ...(manifest.source_excludes ?? [])];
      const hash = sourceTreeHash(repo, excludeDirs, "HEAD");
      const dirty = isDirtyOutside(repo, excludeDirs);
      treeHeader = `${dirty ? "dirty" : "tree"}:${hash}`;
    } catch {
      treeHeader = "unknown";
    }
  }

  const { exitCode: cmdExit, output } = await runCapture(cmd, process.cwd());

  if (cmdExit === 0) {
    console.error(`red: command exited 0 — that command passed, nothing recorded`);
    return { exitCode: 1 };
  }

  mkdirSync(redsDir, { recursive: true });
  const nn = String(behaviour).padStart(2, "0");
  const logPath = join(redsDir, `${nn}.log`);
  const header = [
    `# behaviour: ${behaviour}`,
    `# command: ${cmd.join(" ")}`,
    `# exit: ${cmdExit}`,
    `# at: ${now.toISOString()}`,
    `# sella: ${sella}`,
    `# tree: ${treeHeader}`,
  ].join("\n");
  writeFileSync(logPath, `${header}\n\n${output}`);

  console.log(`${opusId}: red recorded for behaviour ${behaviour} -> ci/reds/${opusId}/${nn}.log`);
  return { exitCode: 0 };
}
