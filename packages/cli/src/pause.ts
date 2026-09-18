/**
 * `bisellium pause` / `bisellium resume` — the manual brake (W-011, dossier
 * §10): "per-item halt, `bisellium pause` (stop starting)". The marker is a
 * small JSON file at `<studio>/PAUSED`, `{ at, reason }`. `bisellium tick`
 * (tick.ts) reads it and, while present, runs only the check + health-
 * snapshot step and does no cadence work. `run`/`talk` proceed regardless —
 * the brake stops starting, not talking — but print a one-line warning via
 * `pauseWarning` below. Kept out of main.ts on purpose (W-011 spec) — wired
 * in by the integrator.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface PauseState {
  paused: boolean;
  at?: string;
  reason?: string;
}

export interface PauseOptions {
  /** Pinned clock, for reproducible `at` timestamps in tests. */
  now?: Date;
}

export interface PauseResult {
  exitCode: number;
}

const USAGE_PAUSE = "usage: bisellium pause [--studio dir] [--reason text]";
const USAGE_RESUME = "usage: bisellium resume [--studio dir]";

export function pausedFilePath(studio: string): string {
  return join(resolve(studio), "PAUSED");
}

/**
 * Never throws. A missing PAUSED file reads as not paused; a present but
 * unreadable/corrupt one still reads as paused (an operator's brake must
 * never be silently ignored just because its detail can't be parsed) —
 * `at`/`reason` come back undefined in that case.
 */
export function readPauseState(studio: string): PauseState {
  const p = pausedFilePath(studio);
  if (!existsSync(p)) return { paused: false };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { at?: unknown; reason?: unknown };
    return {
      paused: true,
      at: typeof raw.at === "string" ? raw.at : undefined,
      reason: typeof raw.reason === "string" && raw.reason.length > 0 ? raw.reason : undefined,
    };
  } catch {
    return { paused: true };
  }
}

/** One-line warning for `run`/`talk` to print (and otherwise ignore) when
 *  the studio is paused. Undefined when not paused — nothing to print. */
export function pauseWarning(studio: string): string | undefined {
  const s = readPauseState(studio);
  if (!s.paused) return undefined;
  return `warning: studio is paused${s.at ? ` since ${s.at}` : ""}${s.reason ? `: ${s.reason}` : ""} — proceeding (pause stops starting, not talking)`;
}

function takeValue(args: string[], i: number, flag: string, usage: string): { value: string } | { error: string } {
  const v = args[i];
  if (v === undefined) return { error: `${flag} needs a value\n${usage}` };
  if (v.startsWith("--")) return { error: `${flag} needs a value, got flag "${v}"\n${usage}` };
  return { value: v };
}

export async function runPause(args: string[], opts: PauseOptions = {}): Promise<PauseResult> {
  let studio = ".";
  let reason: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--studio") {
      const r = takeValue(args, ++i, "--studio", USAGE_PAUSE);
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      studio = r.value;
      continue;
    }
    if (a === "--reason") {
      const r = takeValue(args, ++i, "--reason", USAGE_PAUSE);
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      reason = r.value;
      continue;
    }
    console.error(`bisellium pause: unknown flag "${a}"\n${USAGE_PAUSE}`);
    return { exitCode: 2 };
  }

  const studioRoot = resolve(studio);
  if (!existsSync(join(studioRoot, "bisellium.yml"))) {
    console.error(`not a studio: ${studioRoot}`);
    return { exitCode: 2 };
  }

  const at = (opts.now ?? new Date()).toISOString();
  const p = pausedFilePath(studioRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ at, reason: reason ?? "" }, null, 2) + "\n");
  console.log(`paused ${studioRoot} since ${at}${reason ? `: ${reason}` : ""}`);
  return { exitCode: 0 };
}

export async function runResume(args: string[]): Promise<PauseResult> {
  let studio = ".";
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--studio") {
      const r = takeValue(args, ++i, "--studio", USAGE_RESUME);
      if ("error" in r) { console.error(r.error); return { exitCode: 2 }; }
      studio = r.value;
      continue;
    }
    console.error(`bisellium resume: unknown flag "${a}"\n${USAGE_RESUME}`);
    return { exitCode: 2 };
  }

  const studioRoot = resolve(studio);
  if (!existsSync(join(studioRoot, "bisellium.yml"))) {
    console.error(`not a studio: ${studioRoot}`);
    return { exitCode: 2 };
  }
  const p = pausedFilePath(studioRoot);
  if (existsSync(p)) rmSync(p);
  console.log(`resumed ${studioRoot}`);
  return { exitCode: 0 };
}
