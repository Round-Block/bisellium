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
import { relative, resolve, sep } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { startServer, type LadderRead, type StartServerOptions } from "@bisellium/server";
import { runAnswer, runGreenlight, runBudget, runHandoff } from "@bisellium/commands/writes.js";
import { runTalk } from "@bisellium/commands/talk.js";
import { runPause, runResume } from "@bisellium/commands/pause.js";
import { runDelegate } from "@bisellium/commands/delegate.js";
import {
  appendUiCaptureComment,
  readUiCaptureImage,
  readUiCaptureReview,
  type UiCaptureCommentInput,
} from "@bisellium/commands/ui-capture-comments.js";
import { checkStudio } from "./check.js";
import { instant } from "@bisellium/schema";
import { readManifest } from "@bisellium/adapter-native";
import { sourceTreeHash } from "@bisellium/shim";

const REAL_RUNNERS: StartServerOptions["runners"] = {
  answer: (args) => runAnswer(args),
  greenlight: (args) => runGreenlight(args),
  budget: (args) => runBudget(args),
  handoff: (args) => runHandoff(args),
  talk: (args) => runTalk(args),
  pause: (args) => runPause(args),
  resume: (args) => runResume(args),
  delegate: (args) => runDelegate(args),
};

/** W-300: the longest one step read may take: measured at 2 s to 4 s (docs/NEXT.md), and bounded so a hung git or gh cannot hold the line. */
export const LADDER_READ_TIMEOUT_MS = 15_000;
const LADDER_READ_BYTES = 1024 * 1024;

/**
 * W-300: one opus's step, read by a child process, since `gather` and `deriveNext` block on git and gh and the server must
 * not. Never rejects: a child that fails, overruns or prints anything but its own answer reads `unavailable`.
 */
export function readLadderInChild(studioDir: string, id: string, opts: { entry?: string; timeoutMs?: number } = {}): Promise<LadderRead> {
  const entry = opts.entry ?? fileURLToPath(new URL("./ladder-read.ts", import.meta.url));
  const timeoutMs = opts.timeoutMs ?? LADDER_READ_TIMEOUT_MS;
  return new Promise((settle) => {
    const unavailable = (why: string): void => settle({ id, read: "unavailable", why });
    const child = spawn(process.execPath, [...process.execArgv, entry, studioDir, id], { stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs, killSignal: "SIGKILL" });
    const chunks: Buffer[] = [];
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > LADDER_READ_BYTES) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.on("error", (e) => unavailable(`the step read did not start: ${e.message}`));
    child.on("close", (code, signal) => {
      if (signal !== null) return unavailable(bytes > LADDER_READ_BYTES ? "the step read printed too much" : `the step read took longer than ${timeoutMs / 1000} s`);
      if (code !== 0) return unavailable(`the step read exited ${code}`);
      try {
        const answer = JSON.parse(Buffer.concat(chunks).toString("utf8")) as LadderRead;
        if (answer.id === id && (answer.read === "ok" || answer.read === "unavailable")) return settle(answer);
      } catch {
        /* falls through: not its answer */
      }
      unavailable("the step read answered nothing readable");
    });
  });
}

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

/** The same SOURCE tree identity verify binds, excluding officina bookkeeping and declared source exclusions. */
function captureSourceTree(studioDir: string): string {
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: studioDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const studioRel = relative(repo, studioDir);
  if (studioRel === "" || studioRel.split(sep)[0] === "..") throw new Error("could not establish the capture browser's SOURCE tree");
  const excludes = [studioRel.split(sep).join("/"), ".bisellium", ...(readManifest(studioDir).source_excludes ?? [])];
  return `tree:${sourceTreeHash(repo, excludes, "HEAD")}`;
}

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
        const d = instant(v);
        if (!d) return { error: `--now must be an ISO date\n${USAGE}` };
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
      readLadder: (id) => readLadderInChild(studioDir, id),
      captureReview: {
        read: () => readUiCaptureReview(studioDir, captureSourceTree(studioDir)),
        image: (opus, name) => readUiCaptureImage(studioDir, captureSourceTree(studioDir), opus, name),
        comment: (input) => appendUiCaptureComment(studioDir, captureSourceTree(studioDir), input as unknown as UiCaptureCommentInput),
      },
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
