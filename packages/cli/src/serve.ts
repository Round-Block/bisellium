/**
 * `bisellium serve` — localhost HTTP + SSE over the store (W-014). All the
 * actual mechanism (Store, HTTP routing, SSE) lives in @bisellium/server;
 * this is the argv-parsing CLI entry, matching every other command in this
 * directory (run/verify/talk/tick/pause/resume/handoff/…), AND (W-016,
 * cascade-4 review) the one place that wires apps/server's injected
 * `checkStudio`/`runners` to the real implementations — apps/server itself
 * must never import @bisellium/cli or @bisellium/commands (that was the
 * actual dependency cycle). The generated write-auth token is printed here,
 * once, at start.
 */
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { startServer, type StartServerOptions } from "@bisellium/server";
import { runAnswer, runGreenlight, runBudget, runHandoff } from "@bisellium/commands/writes.js";
import { runTalk } from "@bisellium/commands/talk.js";
import { runPause, runResume } from "@bisellium/commands/pause.js";
import { checkStudio } from "./check.js";

const REAL_RUNNERS: StartServerOptions["runners"] = {
  answer: (args) => runAnswer(args),
  greenlight: (args) => runGreenlight(args),
  budget: (args) => runBudget(args),
  handoff: (args) => runHandoff(args),
  talk: (args) => runTalk(args),
  pause: (args) => runPause(args),
  resume: (args) => runResume(args),
};

export interface RunServeOptions {
  /** Pinned clock override, used when `--now` isn't in `args` (tests). */
  now?: Date;
  /** Pinned write-auth token override (tests only) — production always lets
   *  startServer generate one. */
  token?: string;
}

export interface RunServeResult {
  exitCode: number;
  /** The write-auth token in effect (X-Bisellium-Token on every POST),
   *  undefined on a usage-error / failed-start exit. Also printed to stdout
   *  at start — returned too so a caller (or a test) doesn't have to scrape
   *  the log line for it. */
  token?: string;
  /** Stops polling and closes the HTTP server. A no-op resolved promise on
   *  a usage-error / failed-start exit (there's nothing to close). */
  close: () => Promise<void>;
}

const USAGE = "usage: bisellium serve [--studio <dir>] [--port 4477] [--poll-ms 5000] [--now <iso>] [--once]";
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
      checkStudio,
      runners: REAL_RUNNERS,
      token: opts.token ?? randomBytes(24).toString("hex"),
    });
    console.log(`bisellium serve: listening on http://127.0.0.1:${started.port} (studio ${studioDir})`);
    console.log(`bisellium serve: write-auth token (X-Bisellium-Token): ${started.token}`);
    return { exitCode: 0, token: started.token, close: started.close };
  } catch (e) {
    console.error((e as Error).message);
    return { exitCode: 2, close: NOOP_CLOSE };
  }
}
