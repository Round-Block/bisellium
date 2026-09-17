/**
 * @bisellium/pipeline — the merge-gate seam `bisellium verify` runs through.
 * A MergePipeline runs each automated probatio's command and translates the
 * outcome into the same gate-record shape `verify` writes back into an
 * opus, so a merge-blocking pipeline (no-mistakes) is a drop-in for the
 * local runner and nothing else has to care which one ran.
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Opus } from "@bisellium/schema";

export interface GateRunResult {
  status: "passed" | "failed";
  /** Path to the log/artifact, relative to the studio dir (matches how
   *  opera front matter records evidence everywhere else). */
  evidence: string;
  /** The tree identity this result certifies, as `tree:<hash>`. */
  certifies: string;
}

export interface PipelineRunOpts {
  opus: Opus;
  /** Working directory the commands run in (the git repo, not the studio dir). */
  repo: string;
  /** probatio id -> shell command. Already filtered to automated probationes
   *  that declare a `command` — a pipeline runs exactly these, nothing more. */
  commands: Record<string, string>;
  /** The tree this run certifies (`git rev-parse <ref>^{tree}` in `repo`). */
  treeHash: string;
  /** Directory logs are written under (created if missing). */
  logDir: string;
  now: Date;
  /** Studio directory — evidence paths are recorded relative to this. */
  studioDir: string;
}

export interface MergePipeline {
  id: string;
  run(opts: PipelineRunOpts): Promise<Record<string, GateRunResult>>;
}

const TIMEOUT_MS = 10 * 60 * 1000;
const LOG_TAIL_LINES = 200;

const toPosix = (p: string): string => p.split(sep).join("/");

/** Last `n` lines of `text`, joined back with newlines (never more lines than it has). */
function tail(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

/**
 * localPipeline: runs each command in `repo` with a 10-minute timeout,
 * writes one log per probatio (command, exit code, last 200 lines of
 * combined stdout+stderr) and reports pass/fail from the exit code.
 */
export const localPipeline: MergePipeline = {
  id: "local",
  async run(opts: PipelineRunOpts): Promise<Record<string, GateRunResult>> {
    mkdirSync(opts.logDir, { recursive: true });
    const tree8 = opts.treeHash.slice(0, 8);
    const results: Record<string, GateRunResult> = {};

    for (const [probatioId, command] of Object.entries(opts.commands)) {
      const r = spawnSync(command, {
        cwd: opts.repo,
        shell: true,
        encoding: "utf8",
        timeout: TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      });

      const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
      const exitCode = timedOut ? null : r.status;
      const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      const statusLine = timedOut ? `exit code: (timed out after ${TIMEOUT_MS / 60_000}m)` : `exit code: ${exitCode ?? `(signal ${r.signal ?? "unknown"})`}`;
      const log = `command: ${command}\n${statusLine}\n\n${tail(output, LOG_TAIL_LINES)}\n`;

      const logPath = join(opts.logDir, `${opts.opus.id}-${probatioId}-${tree8}.log`);
      writeFileSync(logPath, log);

      results[probatioId] = {
        status: exitCode === 0 ? "passed" : "failed",
        evidence: toPosix(relative(opts.studioDir, logPath)),
        certifies: `tree:${opts.treeHash}`,
      };
    }

    return results;
  },
};

/** True if the `no-mistakes` binary resolves on PATH. */
function noMistakesOnPath(): boolean {
  try {
    execSync(process.platform === "win32" ? "where no-mistakes" : "command -v no-mistakes", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * noMistakesPipeline: the merge-blocking pipeline as an alternate
 * MergePipeline. Its documented CLI (README, plus `no-mistakes axi --help`,
 * checked 2026-09-18) has no side-effect-free "validate this tree and
 * report pass/fail per check" subcommand to translate — the only
 * non-interactive entry point is `axi run`, which drives a full
 * git-push-bound CI pipeline: it requires `--intent`, a running daemon and
 * a configured push target, and its outcome is a pipeline-wide decision,
 * not a per-probatio result keyed by our own manifest's probatio ids. There
 * is nothing yet to run and translate into MergePipeline's shape, so this
 * always throws and `selectPipeline` always falls back to `localPipeline` —
 * whether or not the binary happens to be on PATH. Revisit if no-mistakes
 * grows a matching non-interactive validate command.
 */
export const noMistakesPipeline: MergePipeline = {
  id: "no-mistakes",
  async run(_opts: PipelineRunOpts): Promise<Record<string, GateRunResult>> {
    void noMistakesOnPath(); // presence probe kept for when a fitting subcommand ships
    throw new Error("no-mistakes not installed");
  },
};

/**
 * Picks the MergePipeline `bisellium verify` should run. Nothing may depend
 * on no-mistakes being present or usable: this only prefers it when it
 * would actually run, and falls back to `localPipeline` otherwise.
 */
export function selectPipeline(): MergePipeline {
  return localPipeline;
}
