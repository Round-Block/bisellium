/**
 * W-610 (review-order-meet-1112): the light gates a build review is ordered on, before the one full `ci --opus`. The list
 * is kept in one place, `bisellium.yml#light_gates` (each entry a shell command; `{studio}` is the officina's
 * repo-relative path), and the opus's own test files (Files owned paths ending `.test.ts`, `.test.mts` or `.test.mjs`)
 * run one at a time after it (`node --test-reporter=tap`, with `--import tsx` for a TypeScript file). The light-gates perform runs them at the worktree's HEAD and writes one log,
 * `ci/<id>-light-<8 hex>.log`, opening with `certifies: tree:<hash>`, `command: sha256:<hex>` (the shared `commandLine`
 * binding of the exact command sequence) and `exit code: <n>`; `admitLightGates` recomputes the sequence from the main
 * checkout's manifest and the brief committed at HEAD and refuses a log of another sequence. Every git call, manifest
 * read and write refuses on failure (spec review r2).
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { bindsCommands, commandLine, isDirtyOutside, sourceTreeHash } from "@bisellium/shim";
import { ownedFiles } from "./brief-admission.js";
import { ensureRealDirectory } from "./ids.js";
import { readContainedRegularFile } from "./opus-model.js";
import { readSourceExcludes, readWorktreeManifest } from "./verdict.js";

const GIT_TIMEOUT_MS = 30_000;
/** One light-gate command's ceiling; a timeout is a non-zero exit (124). */
export const LIGHT_GATE_TIMEOUT_MS = 600_000;
const TEST_FILE = /\.test\.(?:ts|mts|mjs)$/;
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

export type LightAdmission = { ok: true } | { ok: false; error: string; failed?: string };

/** The light-gate commands for `briefText` (the committed brief) in an officina at `studioRel`, or why there are none. */
export function lightGateCommands(manifest: Record<string, unknown>, studioRel: string, briefText: string): string[] | { error: string } {
  const raw = manifest["light_gates"];
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((c) => typeof c !== "string" || c.trim() === ""))
    return { error: "bisellium.yml#light_gates must be a non-empty list of commands" };
  const tests = ownedFiles(briefText).filter((p) => TEST_FILE.test(p));
  // a test path reaches a shell command line: only a repo-relative path of letters, digits, `_`, `.`, `/` and `-`, no `..`
  const unsafe = tests.filter((p) => !SAFE_PATH.test(p) || p.split("/").includes(".."));
  if (unsafe.length > 0) return { error: `the brief's Files owned names a test path the light gates do not run (${unsafe.join(", ")}): only [A-Za-z0-9_./-], repo-relative, no ..` };
  return [...(raw as string[]).map((c) => c.split("{studio}").join(studioRel)), ...tests.map((p) => `node --test-reporter=tap${p.endsWith(".mjs") ? "" : " --import tsx"} ${p}`)];
}

type RepoOf = { repo: string; studioRel: string; exclusions: string[] };
const gitIn = (cwd: string, args: string[]): SpawnSyncReturns<string> => spawnSync("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });

/** The worktree's repository, its officina path and the source exclusions: its manifest must parse as a mapping and pass `readSourceExcludes`, as next's and verify's do. */
function repoOf(studioRoot: string): RepoOf | { error: string } {
  const root = gitIn(studioRoot, ["rev-parse", "--show-toplevel"]);
  if (root.status !== 0) return { error: "the current source tree is unavailable" };
  const repo = resolve(root.stdout.trim());
  const studioRel = relative(repo, studioRoot).split(sep).join("/");
  const read = readWorktreeManifest(studioRoot);
  if ("error" in read) return { error: `the worktree manifest cannot be read: ${read.error}` };
  const excludes = readSourceExcludes(read.manifest);
  if ("error" in excludes) return { error: `the worktree manifest is malformed: ${excludes.error}` };
  return { repo, studioRel, exclusions: [studioRel, ".bisellium", ...excludes.excludes] };
}

/** The light-gate commands at the worktree's HEAD: the main checkout's `light_gates` (the trusted list) and the test files of the brief committed at HEAD; or why not. */
function commandsAt(r: RepoOf, opus: string): string[] | { error: string } {
  const common = gitIn(r.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.status !== 0) return { error: "the main checkout is unavailable" };
  const main = readWorktreeManifest(join(dirname(resolve(common.stdout.trim())), r.studioRel));
  if ("error" in main) return { error: `the main checkout's manifest cannot be read: ${main.error}` };
  const briefPath = `${r.studioRel === "" ? "" : `${r.studioRel}/`}briefs/${opus}.md`;
  const brief = gitIn(r.repo, ["show", `HEAD:${briefPath}`]);
  if (brief.status !== 0) return { error: `${briefPath} cannot be read at HEAD, so its own test files are unknown` };
  return lightGateCommands(main.manifest as unknown as Record<string, unknown>, r.studioRel, brief.stdout);
}

/** The light-gate commands for the opus whose worktree officina is `studioRoot`, or why there are none (`next`'s order and its perform, and `admitLightGates`, read this one). */
export function currentLightCommands(studioRoot: string, opus: string): string[] | { error: string } {
  try {
    const r = repoOf(studioRoot);
    return "error" in r ? r : commandsAt(r, opus);
  } catch (error) {
    return { error: `the light-gate commands cannot be read: ${(error as Error).message}` };
  }
}

export const lightLogRel = (opus: string, tree: string): string => `ci/${opus}-light-${tree.slice(5, 13)}.log`;

/** The light gates passed at the worktree's current source tree, their log committed and unchanged; or why not. */
export function admitLightGates(studioRoot: string, opus: string): LightAdmission {
  try {
    const r = repoOf(studioRoot);
    if ("error" in r) return { ok: false, error: `${opus}: ${r.error}` };
    if (isDirtyOutside(r.repo, r.exclusions)) return { ok: false, error: `${opus}: current source tree is dirty` };
    const tree = `tree:${sourceTreeHash(r.repo, r.exclusions, "HEAD")}`;
    const rel = lightLogRel(opus, tree);
    const log = readContainedRegularFile(studioRoot, rel, "ci");
    if ("error" in log) return { ok: false, error: `${opus}: no light-gate log at the current source tree ${tree.slice(0, 17)} (${rel})` };
    const path = `${r.studioRel}/${rel}`;
    if (spawnSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: r.repo, encoding: "utf8", timeout: GIT_TIMEOUT_MS }).status !== 0)
      return { ok: false, error: `${opus}: the light-gate log is not committed (${path})` };
    const status = spawnSync("git", ["status", "--porcelain", "--", path], { cwd: r.repo, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
    if (status.status !== 0 || status.stdout !== "") return { ok: false, error: `${opus}: the light-gate log is not committed (${path})` };
    const [first, second, third] = log.bytes.toString("utf8").split("\n");
    if (first !== `certifies: ${tree}`) return { ok: false, error: `${opus}: ${rel} does not open with certifies: ${tree}` };
    // the log binds the exact command sequence: a change to light_gates or to the brief's test files voids it (one cheap rerun)
    const cmds = commandsAt(r, opus);
    if ("error" in cmds) return { ok: false, error: `${opus}: ${cmds.error}` };
    if (!bindsCommands(second, cmds)) return { ok: false, error: `${opus}: ${rel} was not run for the current light-gate commands (line 2 is not ${commandLine(cmds)})` };
    if (third !== "exit code: 0") return { ok: false, error: `${opus}: the light gates failed at the current source tree (${rel}: ${third ?? "no exit line"})`, failed: rel };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `${opus}: the light-gate evidence cannot be read: ${(error as Error).message}` };
  }
}

/** Runs `commands` in turn at the worktree's HEAD (the first non-zero exit stops the run) and writes the log; returns its path and exit, or why it refused (every git, tree or write failure). */
export function runLightGates(studioRoot: string, opus: string, commands: string[]): { rel: string; exitCode: number } | { error: string } {
  try {
    const r = repoOf(studioRoot);
    if ("error" in r) return r;
    if (isDirtyOutside(r.repo, r.exclusions)) return { error: "the current source tree is dirty; commit it before the light gates" };
    const tree = `tree:${sourceTreeHash(r.repo, r.exclusions, "HEAD")}`;
    const body: string[] = [];
    let exitCode = 0;
    for (const c of commands) {
      const run = spawnSync("sh", ["-c", c], { cwd: r.repo, encoding: "utf8", timeout: LIGHT_GATE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      const code = run.error !== undefined ? 124 : (run.status ?? 1);
      body.push(`$ ${c}`, `exit: ${code}`, run.stdout ?? "", run.stderr ?? "");
      if (code !== 0) {
        exitCode = code;
        break;
      }
    }
    const rel = lightLogRel(opus, tree);
    // ci/ in a real directory chain (ensureRealDirectory throws on a symlinked or non-directory level); the name is built from the validated opus id and the tree's hex
    writeFileSync(join(ensureRealDirectory(studioRoot, "ci"), basename(rel)), [`certifies: ${tree}`, commandLine(commands), `exit code: ${exitCode}`, "", ...body, ""].join("\n"));
    return { rel, exitCode };
  } catch (error) {
    return { error: `the light gates cannot be run or logged: ${(error as Error).message}` };
  }
}
