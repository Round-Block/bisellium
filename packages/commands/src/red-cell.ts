/**
 * packages/commands/src/red-cell.ts — W-573: certify replays every recorded red in a cell with an empty HOME and a fresh,
 * writable TMPDIR (`scripts/host-cells.mjs` `replayCell`, run by `scripts/run-builder-host.mjs`) and accepts it only when
 * its classifier (`scripts/replay-accept.mjs` `classifyReplay`, imported, never copied) does. `red`, for a brief that
 * declares "Red order: one at a time", runs the red's command a second time in this module's cell and records nothing
 * when either run is not a red that classifier accepts, or when the two runs fail at different tests.
 *
 * The cell here is an environment, not certify's bubblewrap cell: the command runs in the same directory with only
 * PATH (the host's), HOME (a new empty directory), TMPDIR (a new empty directory), CI, LANG, LC_ALL, TZ and, when the
 * host has a playwright browser cache, PLAYWRIGHT_BROWSERS_PATH naming it (`browserCache`, certify's own resolver). Both
 * directories are made under the host's temporary directory, and their removal is attempted after every run. Opening the
 * cell can throw (a TMPDIR that is missing or unwritable); `red` catches that and refuses. Removal never throws: a cell
 * the host filesystem will not remove (a command that left a directory unwritable) is left behind, a host-filesystem limit.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { classifyReplay } from "../../../scripts/replay-accept.mjs";
import { browserCache } from "../../../scripts/host-cells.mjs";

export interface CellRun {
  exitCode: number;
  output: string;
}
export interface Cell {
  home: string;
  tmp: string;
  env: Record<string, string>;
  close: () => void;
}

/** The cell's environment: certify's replay cell's names, with the host's PATH and these two directories. */
export function cellEnv(host: NodeJS.ProcessEnv, home: string, tmp: string, browsers: string | undefined): Record<string, string> {
  return {
    PATH: host["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    TMPDIR: tmp,
    CI: "1",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    ...(browsers === undefined ? {} : { PLAYWRIGHT_BROWSERS_PATH: browsers }),
  };
}

/** A new cell under the host's temporary directory, made absolute here so the child, run from another `--cwd`, reads the same paths; throws when it cannot be made (the root's removal attempted first).
 *  `close` attempts its recursive removal and never throws. */
export function openCell(): Cell {
  const root = mkdtempSync(join(resolve(tmpdir()), "bisellium-red-cell-"));
  const close = (): void => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* left behind: a host-filesystem limit (the brief's Limits) */
    }
  };
  try {
    const home = join(root, "home");
    const tmp = join(root, "tmp");
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(tmp, { mode: 0o700 });
    return { home, tmp, env: cellEnv(process.env, home, tmp, browserCache(process.env, homedir())), close };
  } catch (e) {
    close();
    throw e;
  }
}

/** The root-level failing test titles, as certify re-attests them. */
export function failedTitles(output: string): string[] {
  return [...new Set([...output.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]!.replace(/\r$/, "")))].sort();
}

/** Why this red would not replay in certify's cell, or undefined when both runs are one accepted red. */
export function cellRefusal(host: CellRun, cell: CellRun): string | undefined {
  const onHost = classifyReplay({ status: host.exitCode, output: host.output });
  if (!onHost.accepted) return `is not a red certify's classifier accepts on this host: ${onHost.reason}`;
  const inCell = classifyReplay({ status: cell.exitCode, output: cell.output });
  if (!inCell.accepted) return `run again in certify's replay cell (an empty HOME, a fresh TMPDIR) is not a red certify accepts: ${inCell.reason}`;
  const a = failedTitles(host.output);
  const b = failedTitles(cell.output);
  if (a.length !== b.length || a.some((t, i) => t !== b[i]))
    return `fails at other tests in certify's replay cell (an empty HOME, a fresh TMPDIR) than on this host: ${JSON.stringify(a)} here, ${JSON.stringify(b)} there`;
  return undefined;
}
