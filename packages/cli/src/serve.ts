/**
 * `bisellium serve` — localhost HTTP + SSE over the store (W-014). All the
 * actual mechanism (Store, HTTP routing, SSE) lives in @bisellium/server;
 * this is just the argv-parsing CLI entry, matching every other command in
 * this directory (run/verify/talk/tick/pause/resume/handoff/…). Kept out of
 * main.ts on purpose — wired in by the integrator ("bisellium serve
 * [--studio dir] [--port 4477] [--poll-ms 5000] [--now <iso>] [--once]").
 */
import { resolve } from "node:path";
import { startServer } from "@bisellium/server";

export interface RunServeOptions {
  /** Pinned clock override, used when `--now` isn't in `args` (tests). */
  now?: Date;
}

export interface RunServeResult {
  exitCode: number;
  /** Stops polling and closes the HTTP server. A no-op resolved promise on
   *  a usage-error / failed-start exit (there's nothing to close). */
  close: () => Promise<void>;
}

const USAGE = "usage: bisellium serve [--studio dir] [--port 4477] [--poll-ms 5000] [--now <iso>] [--once]";
const NOOP_CLOSE = async (): Promise<void> => {};

interface ParsedServeArgs {
  studio: string;
  port?: number;
  pollMs?: number;
  once: boolean;
  now: Date;
}

function parseArgs(args: string[], defaultNow: Date): ParsedServeArgs | { error: string } {
  let studio = ".";
  let port: number | undefined;
  let pollMs: number | undefined;
  let once = false;
  let now = defaultNow;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--once") {
      once = true;
      continue;
    }
    if (a === "--studio" || a === "--port" || a === "--poll-ms" || a === "--now") {
      const v = args[++i];
      if (v === undefined) return { error: `${a} needs a value\n${USAGE}` };
      if (a === "--studio") {
        studio = v;
      } else if (a === "--port") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return { error: `--port must be a non-negative number\n${USAGE}` };
        port = n;
      } else if (a === "--poll-ms") {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return { error: `--poll-ms must be a positive number\n${USAGE}` };
        pollMs = n;
      } else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return { error: `--now must be an ISO date\n${USAGE}` };
        now = d;
      }
      continue;
    }
    return { error: `flag ${a} not allowed for "serve"\n${USAGE}` };
  }

  return { studio, port, pollMs, once, now };
}

export async function runServe(args: string[], opts: RunServeOptions = {}): Promise<RunServeResult> {
  const parsed = parseArgs(args, opts.now ?? new Date());
  if ("error" in parsed) {
    console.error(parsed.error);
    return { exitCode: 2, close: NOOP_CLOSE };
  }

  const studioDir = resolve(parsed.studio);
  try {
    const started = await startServer({
      studioDir,
      port: parsed.port ?? 4477,
      pollMs: parsed.pollMs ?? 5000,
      once: parsed.once,
      now: parsed.now,
    });
    console.log(`bisellium serve: listening on http://127.0.0.1:${started.port} (studio ${studioDir})`);
    return { exitCode: 0, close: started.close };
  } catch (e) {
    console.error((e as Error).message);
    return { exitCode: 2, close: NOOP_CLOSE };
  }
}
