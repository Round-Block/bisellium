/**
 * @bisellium/pipeline — the merge-gate seam `bisellium verify` runs through.
 * A MergePipeline runs each automated probatio's command and translates the
 * outcome into the same gate-record shape `verify` writes back into an
 * opus, so a merge-blocking pipeline (no-mistakes) is a drop-in for the
 * local runner and nothing else has to care which one ran.
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { join, relative, sep } from "node:path";
import type { Opus } from "@bisellium/schema";
import { filterEnv, redact } from "@bisellium/shim";

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
  /** True when `repo`'s working tree had uncommitted changes at run time —
   *  certifies is then `dirty:<hash>`, never `tree:<hash>` (a `tree:`
   *  certificate is a claim that `treeHash` is exactly what ran). */
  dirty?: boolean;
  /** Extra environment per probatio id, merged over the filtered env for that
   *  command only. A gate that is not named here sees exactly today's env. */
  commandEnv?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface MergePipeline {
  id: string;
  run(opts: PipelineRunOpts): Promise<Record<string, GateRunResult>>;
}

/** Wall-clock cap on one automated gate command under `verify`, and on one `bisellium ci` step. */
export const GATE_TIMEOUT_MS = 30 * 60_000;
const LOG_TAIL_LINES = 200;

const toPosix = (p: string): string => p.split(sep).join("/");

/** Last `n` lines of `text`, joined back with newlines (never more lines than it has). */
function tail(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

/** W-313: how often a running gate or `bisellium ci` step prints its progress line. */
export const PROGRESS_INTERVAL_MS = 60_000;
/** spawnSync's cap on one captured stream, kept for a gate's output. */
const CAPTURE_MAX = 64 * 1024 * 1024;
const LAST_LINE_MAX = 200;

export interface WatchOptions {
  /** Names the run in each line: `bisellium verify: gate <id>` or `bisellium ci: step <command>`. */
  label: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  timeoutMs: number;
  /** `true`: the child's stdout and stderr are passed to this process's own as they arrive and not kept
   *  (`bisellium ci`); otherwise they are captured, each up to 64 MiB, and returned (`verify`'s gate log). */
  tee?: boolean;
  /** The interval between progress lines; tests shorten it. */
  everyMs?: number;
  /** Where the start, progress and end lines go; defaults to this process's stderr. */
  write?: (line: string) => void;
}

export interface WatchResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** The spawn failure, or `ENOBUFS` when a captured stream passed 64 MiB (the child is then killed, as spawnSync did). */
  error?: NodeJS.ErrnoException;
  stdout: string;
  stderr: string;
}

const LABEL_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

const elapsed = (ms: number): string => `${Math.floor(ms / 60_000)}m${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;

/** The last non-blank line of `text` for a progress line: `\n` and `\r` end a line, CSI escapes are dropped,
 *  any other C0 control or DEL reads `?` (so an OSC or other non-CSI escape loses its framing bytes and its
 *  printable payload passes), secrets are redacted, and it is cut to 200 characters. A C1 control, bidirectional
 *  or zero-width character passes through (a stated limit). */
export function progressLine(text: string): string | undefined {
  const line = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .at(-1);
  if (line === undefined) return undefined;
  const clean = redact(line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")).replace(/[\u0000-\u001f\u007f]/g, "?");
  return clean.length > LAST_LINE_MAX ? `${clean.slice(0, LAST_LINE_MAX)}…` : clean;
}

/**
 * W-313: runs one gate or ci step without blocking the event loop, printing `<label>: start <time>`, then every
 * `everyMs` while it runs `<label>: running <elapsed> at <time>, <n> bytes of output, last line: <line>`, then
 * `<label>: end <time> after <elapsed>, <outcome>`, so a silent healthy run is not read as a hung one.
 * A label that is empty, untrimmed or holds a control, bidirectional or zero-width character is refused with
 * `EINVAL`: nothing is spawned or written. A captured stream passing 64 MiB sets `ENOBUFS` and kills the child; the
 * prefix kept is whole chunks, so it is not promised byte-identical to spawnSync's.
 */
export function runWatched(command: string, args: readonly string[], opts: WatchOptions): Promise<WatchResult> {
  if (opts.label.length === 0 || opts.label !== opts.label.trim() || LABEL_FORBIDDEN.test(opts.label)) {
    const error: NodeJS.ErrnoException = Object.assign(new Error("invalid label"), { code: "EINVAL" });
    return Promise.resolve({ status: null, signal: null, timedOut: false, error, stdout: "", stderr: "" });
  }
  const write = opts.write ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const started = new Date();
  write(`${opts.label}: start ${started.toISOString()}`);
  return new Promise((resolvePromise) => {
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      shell: opts.shell ?? false,
      stdio: [opts.tee ? "inherit" : "ignore", "pipe", "pipe"],
    });
    let bytes = 0;
    let last: string | undefined;
    let timedOut = false;
    let error: NodeJS.ErrnoException | undefined;
    let settled = false;
    const kept = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const keptBytes = { stdout: 0, stderr: 0 };
    const recent = { stdout: "", stderr: "" };
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    for (const name of ["stdout", "stderr"] as const) {
      child[name].on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        recent[name] = (recent[name] + decoders[name].write(chunk)).slice(-4096); // ponytail: a line over 4 KiB shows its end
        last = progressLine(recent[name]) ?? last;
        if (opts.tee) {
          process[name].write(chunk);
        } else if (error === undefined) {
          if (keptBytes[name] + chunk.length > CAPTURE_MAX) {
            error = Object.assign(new Error(`${name} passed ${CAPTURE_MAX} bytes`), { code: "ENOBUFS" });
            child.kill();
          } else {
            kept[name].push(chunk);
            keptBytes[name] += chunk.length;
          }
        }
      });
    }
    const progress = setInterval(() => {
      const at = new Date();
      write(`${opts.label}: running ${elapsed(at.getTime() - started.getTime())} at ${at.toISOString()}, ${bytes} bytes of output, last line: ${last ?? "(none yet)"}`);
    }, opts.everyMs ?? PROGRESS_INTERVAL_MS);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    const finish = (status: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearInterval(progress);
      clearTimeout(timer);
      const at = new Date();
      const outcome = timedOut
        ? `timed out after ${opts.timeoutMs / 60_000}m`
        : error !== undefined && child.pid === undefined
          ? `failed to start: ${error.message}`
          : status !== null
            ? `exited ${status}`
            : `killed by ${signal ?? "an unknown signal"}`;
      write(`${opts.label}: end ${at.toISOString()} after ${elapsed(at.getTime() - started.getTime())}, ${outcome}`);
      const result: WatchResult = { status, signal, timedOut, stdout: Buffer.concat(kept.stdout).toString("utf8"), stderr: Buffer.concat(kept.stderr).toString("utf8") };
      if (error !== undefined) result.error = error;
      resolvePromise(result);
    };
    child.on("error", (e: NodeJS.ErrnoException) => {
      error ??= e;
      if (child.pid === undefined) finish(null, null);
    });
    child.on("close", finish);
  });
}

/**
 * localPipeline: runs each command in `repo` with a 30-minute timeout,
 * writes one log per probatio (command, exit code, last 200 lines of
 * combined stdout+stderr) and reports pass/fail from the exit code. Each
 * command prints its start, a progress line a minute and its end (W-313).
 */
export const localPipeline: MergePipeline = {
  id: "local",
  async run(opts: PipelineRunOpts): Promise<Record<string, GateRunResult>> {
    mkdirSync(opts.logDir, { recursive: true });
    const tree8 = opts.treeHash.slice(0, 8);
    const results: Record<string, GateRunResult> = {};
    const certifies = `${opts.dirty ? "dirty" : "tree"}:${opts.treeHash}`;
    // Drop anything env-var-shaped like a credential before an untrusted
    // probatio command ever sees it (docs/ADOPTION.md: allowlist is
    // PATH/HOME/NODE_*/LANG/TZ; everything else matching
    // TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL is dropped).
    const base = filterEnv(process.env);

    for (const [probatioId, command] of Object.entries(opts.commands)) {
      const extra = opts.commandEnv?.[probatioId];
      const env = extra === undefined ? base : { ...base, ...extra };
      const r = await runWatched(command, [], { cwd: opts.repo, shell: true, timeoutMs: GATE_TIMEOUT_MS, env, label: `bisellium verify: gate ${probatioId}` });

      const timedOut = r.timedOut;
      // any error (a spawn failure, ENOBUFS) fails the gate, whatever status the child then exited with
      const exitCode = timedOut || r.error !== undefined ? null : r.status;
      const output = `${r.stdout}${r.stderr}`;
      const statusLine = timedOut
        ? `exit code: (timed out after ${GATE_TIMEOUT_MS / 60_000}m)`
        : r.error !== undefined
          ? `exit code: (error ${r.error.code ?? "unknown"})`
          : `exit code: ${exitCode ?? `(signal ${r.signal ?? "unknown"})`}`;
      // The tree/certifies header is our own metadata, not part of the
      // command's (untrusted) output — check.ts's probatio.evidence.tree
      // rule reads it back to confirm a gate's log actually mentions the
      // tree it certifies. `command` and the command's own output ARE
      // untrusted (they can echo secrets back), so those are redacted;
      // the header line is not.
      const log = `certifies: ${certifies}\ncommand: ${redact(command)}\n${statusLine}\n\n${redact(tail(output, LOG_TAIL_LINES))}\n`;

      const logPath = join(opts.logDir, `${opts.opus.id}-${probatioId}-${tree8}.log`);
      writeFileSync(logPath, log);

      results[probatioId] = {
        status: exitCode === 0 ? "passed" : "failed",
        evidence: toPosix(relative(opts.studioDir, logPath)),
        certifies,
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
