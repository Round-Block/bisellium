/**
 * apps/server/src/http.ts — the localhost HTTP + SSE surface over
 * apps/server/src/store.ts's Store (W-014). `startServer` owns the whole
 * lifecycle: open the Store, ingest one snapshot, start polling (unless
 * `--once`), bind the HTTP server to 127.0.0.1 only, and hand back a
 * `close()` that stops both. `packages/cli/src/serve.ts` is the thin argv
 * wrapper around this; apps/server/test/server.test.ts drives this module
 * directly so the tests never depend on main.ts wiring the command in.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GantryEvent } from "@bisellium/schema";
import { runHandoff, runAnswer, runGreenlight, runBudget } from "@bisellium/cli/src/writes.js";
import { runTalk } from "@bisellium/cli/src/talk.js";
import { runPause, runResume } from "@bisellium/cli/src/pause.js";
import { Store } from "./store.js";

export interface StartServerOptions {
  studioDir: string;
  /** Bind port; 0 picks a random free port (tests). Default 4477. */
  port?: number;
  pollMs?: number;
  /** Ingest once at start and never poll again — served state is then
   *  whatever that one snapshot showed. */
  once?: boolean;
  /** Pinned clock, for reproducible query results in tests. */
  now?: Date;
  /** providerStatus() runs quota-axi (a live subprocess) only when true. */
  live?: boolean;
}

export interface StartServerResult {
  port: number;
  store: Store;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 4477;
const DEFAULT_POLL_MS = 5_000;
const HEARTBEAT_MS = 15_000;

// ---------------------------------------------------------------------------
// Small response helpers
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, text: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function notFound(res: ServerResponse, what: string): void {
  sendJson(res, 404, { error: `unknown ${what}` });
}

/** Never leaks a stack — the message only (spec: "500 never leaks a stack"). */
function serverError(res: ServerResponse, e: unknown): void {
  if (res.headersSent) return;
  sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") {
        resolvePromise({});
        return;
      }
      try {
        const v: unknown = JSON.parse(raw);
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          reject(new Error("request body must be a JSON object"));
          return;
        }
        resolvePromise(v as Record<string, unknown>);
      } catch (e) {
        reject(new Error(`invalid JSON body: ${(e as Error).message}`));
      }
    });
    req.on("error", reject);
  });
}

/** readJsonBody, but a malformed body answers 400 {error} here (a client
 *  mistake) instead of letting the rejection reach route()'s catch, which
 *  hands everything to serverError() and answers 500 (spec: 500 is
 *  reserved for server errors, never surfaced as the way to tell a caller
 *  "you sent junk"). Returns `undefined` after already sending the 400 —
 *  the caller's job is just to `return` when it sees that. */
async function readJsonBodyOr400(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

/** Runs `fn` with console.log/console.error captured instead of printed —
 *  every write command here (handoff/answer/greenlight/budget/talk/pause/
 *  resume) prints its result rather than returning it, and the spec wants
 *  that output back in the response body instead.
 *
 *  This mutates the process-global `console`, so it is only ever safe to
 *  run one call at a time: two overlapping calls would each save the
 *  other's capturing function as "the original" and restore into it,
 *  cross-wiring both requests' output and permanently wedging console.log/
 *  console.error afterwards. `createWriteLock()` below is what actually
 *  enforces the one-at-a-time discipline — this function assumes it, it
 *  doesn't enforce it itself. */
async function withCapturedConsole<T>(fn: () => Promise<T> | T): Promise<{ result: T; stdout: string; stderr: string }> {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => outLines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => errLines.push(args.map(String).join(" "));
  try {
    const result = await fn();
    return { result, stdout: outLines.join("\n"), stderr: errLines.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

/** A per-server-instance async mutex: every write route (and its
 *  withCapturedConsole/asPatron console+env mutation) runs through this so
 *  overlapping writes — expected, since /api/talk can take minutes — queue
 *  instead of interleaving through the same process-global state. A
 *  rejection from one queued call never blocks the ones behind it. */
function createWriteLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<void> = Promise.resolve();
  return function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function writeResponse(res: ServerResponse, exitCode: number, stdout: string, stderr: string): void {
  const output = [stdout, stderr].filter((s) => s.length > 0).join("\n");
  sendJson(res, 200, { ok: exitCode === 0, exitCode, output });
}

/** answer/greenlight/budget are Patron writes — main.ts sets this env var
 *  before calling them (docs/ADOPTION.md); do the same here, restoring
 *  whatever was there before so one request's role never leaks into the
 *  next (or into a concurrent read route's own process.env access). */
async function asPatron<T>(fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env["BISELLIUM_ROLE"];
  process.env["BISELLIUM_ROLE"] = "patron";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env["BISELLIUM_ROLE"];
    else process.env["BISELLIUM_ROLE"] = prev;
  }
}

// ---------------------------------------------------------------------------
// Static file serving: apps/web/dist if it's been built, else a one-page
// index of the API routes.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(HERE, "..", "..", "web", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function sendFile(res: ServerResponse, path: string): void {
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(path));
}

const ROUTE_INDEX_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>bisellium serve</title></head>
<body>
<h1>bisellium serve</h1>
<p>apps/web/dist is not built. API routes:</p>
<ul>
<li>GET /api/officina</li>
<li>GET /api/opera?state=&amp;collegium=</li>
<li>GET /api/opus/:id</li>
<li>GET /api/inbox</li>
<li>GET /api/acta?days=</li>
<li>GET /api/aerarium?period=</li>
<li>GET /api/providers?live=</li>
<li>GET /api/health</li>
<li>GET /api/timeline/:sella?limit=</li>
<li>GET /api/events?since=&amp;limit=</li>
<li>GET /api/receipts?sella=</li>
<li>GET /api/live (SSE)</li>
<li>POST /api/answer, /api/greenlight, /api/budget, /api/handoff, /api/talk, /api/pause, /api/resume</li>
</ul>
</body>
</html>`;

function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (pathname === "/") {
    const indexPath = join(WEB_DIST, "index.html");
    if (existsSync(indexPath)) sendFile(res, indexPath);
    else sendText(res, 200, ROUTE_INDEX_HTML, "text/html; charset=utf-8");
    return true;
  }
  if (pathname.startsWith("/assets/")) {
    const filePath = resolve(WEB_DIST, "." + pathname);
    // Containment: "." + pathname can never climb above WEB_DIST because
    // pathname always starts with "/assets/", but a decoded "../" would —
    // refuse anything that resolves outside WEB_DIST rather than trust that.
    if (!filePath.startsWith(WEB_DIST)) {
      sendJson(res, 403, { error: "forbidden" });
      return true;
    }
    let isFile = false;
    try {
      isFile = statSync(filePath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
    sendFile(res, filePath);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

function handleLive(store: Store, req: IncomingMessage, res: ServerResponse, sseClients: Set<ServerResponse>): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  sseClients.add(res);

  const onEvent = (e: GantryEvent) => {
    try {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    } catch {
      // client gone; the close handler below will clean up
    }
  };
  store.on("event", onEvent);

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      // client gone; close handler cleans up
    }
  }, HEARTBEAT_MS);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    store.off("event", onEvent);
    sseClients.delete(res);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function route(
  store: Store,
  allowPoll: () => Promise<GantryEvent[]>,
  withWriteLock: <T>(fn: () => Promise<T>) => Promise<T>,
  sseClients: Set<ServerResponse>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  // ---- writes: 127.0.0.1 only (the server is bound there too, but this is
  // the explicit contract the spec names, not just an accident of bind()). --
  const remote = req.socket.remoteAddress ?? "";
  const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const WRITE_PATHS = new Set(["/api/answer", "/api/greenlight", "/api/budget", "/api/handoff", "/api/talk", "/api/pause", "/api/resume"]);
  if (method === "POST" && WRITE_PATHS.has(pathname) && !isLoopback) {
    sendJson(res, 403, { error: "writes are only accepted from 127.0.0.1" });
    return;
  }

  if (method === "GET" && pathname === "/api/officina") return sendJson(res, 200, store.query.officina());

  if (method === "GET" && pathname === "/api/opera") {
    const state = url.searchParams.get("state") ?? undefined;
    const collegium = url.searchParams.get("collegium") ?? undefined;
    return sendJson(res, 200, store.query.opera({ state, collegium }));
  }

  {
    const m = /^\/api\/opus\/([^/]+)$/.exec(pathname);
    if (method === "GET" && m) {
      const opus = store.query.opus(decodeURIComponent(m[1]!));
      if (!opus) return notFound(res, "opus");
      return sendJson(res, 200, opus);
    }
  }

  if (method === "GET" && pathname === "/api/inbox") return sendJson(res, 200, store.query.needsYou());

  if (method === "GET" && pathname === "/api/acta") {
    const days = num(url.searchParams.get("days")) ?? 7;
    return sendJson(res, 200, store.query.acta(days));
  }

  if (method === "GET" && pathname === "/api/aerarium") {
    const period = url.searchParams.get("period") ?? undefined;
    return sendJson(res, 200, store.query.aerarium(period));
  }

  if (method === "GET" && pathname === "/api/providers") {
    const live = url.searchParams.get("live") === "1" || url.searchParams.get("live") === "true";
    return sendJson(res, 200, await store.query.providers(live));
  }

  if (method === "GET" && pathname === "/api/health") return sendJson(res, 200, store.query.health());

  {
    const m = /^\/api\/timeline\/([^/]+)$/.exec(pathname);
    if (method === "GET" && m) {
      const sella = decodeURIComponent(m[1]!);
      if (!store.sellaExists(sella)) return notFound(res, "sella");
      const limit = num(url.searchParams.get("limit"));
      return sendJson(res, 200, store.query.timeline(sella, limit));
    }
  }

  if (method === "GET" && pathname === "/api/events") {
    const since = num(url.searchParams.get("since"));
    const limit = num(url.searchParams.get("limit"));
    return sendJson(res, 200, store.query.events({ since, limit }));
  }

  if (method === "GET" && pathname === "/api/receipts") {
    const sella = url.searchParams.get("sella") ?? undefined;
    return sendJson(res, 200, store.query.receipts(sella));
  }

  if (method === "GET" && pathname === "/api/live") {
    handleLive(store, req, res, sseClients);
    return;
  }

  // ---- test-only manual poll hook (spec: "allowed only when NODE_ENV=test") --
  if (method === "POST" && pathname === "/api/_poll") {
    if (process.env["NODE_ENV"] !== "test") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    const events = await allowPoll();
    sendJson(res, 200, { ok: true, ingested: events.length });
    return;
  }

  // ---- writes ---------------------------------------------------------
  if (method === "POST" && pathname === "/api/answer") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const petitio = body["petitio"];
    const reply = body["reply"];
    if (typeof petitio !== "string" || typeof reply !== "string") {
      sendJson(res, 400, { error: "petitio and reply are required strings" });
      return;
    }
    const args = ["--petitio", petitio, reply, "--studio", store.studioDir];
    if (body["askBack"] === true) args.push("--ask-back");
    if (body["charterGap"] === true) args.push("--charter-gap");
    const { result, stdout, stderr } = await withWriteLock(() => asPatron(() => withCapturedConsole(() => runAnswer(args))));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/greenlight") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const opus = body["opus"];
    if (typeof opus !== "string") {
      sendJson(res, 400, { error: "opus is required" });
      return;
    }
    const args = [opus, "--studio", store.studioDir];
    if (typeof body["decline"] === "string") args.push("--decline", body["decline"]);
    const { result, stdout, stderr } = await withWriteLock(() => asPatron(() => withCapturedConsole(() => runGreenlight(args))));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/budget") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const period = body["period"];
    const collegium = body["collegium"];
    const tokens = body["tokens"];
    if (typeof period !== "string" || typeof collegium !== "string" || (typeof tokens !== "number" && typeof tokens !== "string")) {
      sendJson(res, 400, { error: "period, collegium and tokens are required" });
      return;
    }
    const args = [period, "--collegium", collegium, "--tokens", String(tokens), "--studio", store.studioDir];
    if (body["hours"] !== undefined) args.push("--hours", String(body["hours"]));
    const { result, stdout, stderr } = await withWriteLock(() => asPatron(() => withCapturedConsole(() => runBudget(args))));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/handoff") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const opus = body["opus"];
    const sella = body["sella"];
    const next = body["next"];
    if (typeof opus !== "string" || typeof sella !== "string" || typeof next !== "string") {
      sendJson(res, 400, { error: "opus, sella and next are required" });
      return;
    }
    const args = ["--opus", opus, "--sella", sella, "--next", next, "--studio", store.studioDir];
    if (typeof body["stage"] === "string") args.push("--stage", body["stage"]);
    if (typeof body["blockedOn"] === "string") args.push("--blocked-on", body["blockedOn"]);
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runHandoff(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/talk") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const sella = body["sella"];
    const message = body["message"];
    if (typeof sella !== "string" || typeof message !== "string") {
      sendJson(res, 400, { error: "sella and message are required" });
      return;
    }
    const args = ["--sella", sella, "--studio", store.studioDir];
    if (typeof body["harness"] === "string") args.push("--harness", body["harness"]);
    args.push(message);
    // May take minutes (a real harness turn) — no server-side timeout here;
    // the caller waits for the reply, same as the CLI would. withWriteLock
    // queues this behind any other in-flight write rather than letting it
    // interleave with one through the shared console/env mutation.
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runTalk(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/pause") {
    const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);
    const args = ["--studio", store.studioDir];
    if (typeof body["reason"] === "string") args.push("--reason", body["reason"]);
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runPause(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/resume") {
    const args = ["--studio", store.studioDir];
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runResume(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  // ---- static -----------------------------------------------------------
  if (method === "GET" && serveStatic(pathname, res)) return;

  sendJson(res, 404, { error: "not found" });
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

export async function startServer(opts: StartServerOptions): Promise<StartServerResult> {
  const studioDir = resolve(opts.studioDir);
  if (!existsSync(join(studioDir, "bisellium.yml"))) {
    throw new Error(`not a studio: ${studioDir}`);
  }

  const store = new Store({ studioDir, now: opts.now, live: opts.live });
  await store.ingest();

  const once = opts.once ?? false;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  let polling = false;
  const doPoll = async (): Promise<GantryEvent[]> => {
    if (polling) return []; // skip when a poll is still running (spec)
    polling = true;
    try {
      return await store.ingest();
    } catch (e) {
      // Same reasoning as the access-log line above: never console.error,
      // this can fire from the poll timer while a write's console capture
      // is active.
      process.stderr.write(`bisellium serve: poll failed: ${(e as Error).message}\n`);
      return [];
    } finally {
      polling = false;
    }
  };

  let pollTimer: NodeJS.Timeout | undefined;
  if (!once) pollTimer = setInterval(() => void doPoll(), pollMs);

  // Every write route serializes through this (see createWriteLock's docs);
  // every open /api/live response is tracked here so close() can end them
  // instead of waiting on server.close()'s callback forever (an SSE client
  // never disconnects on its own — that's the whole point of the route).
  const withWriteLock = createWriteLock();
  const sseClients = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    const start = Date.now();
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    res.on("finish", () => {
      // Deliberately not console.error: that binding can be mid-swap for an
      // unrelated concurrent write (withCapturedConsole), which would
      // otherwise capture this access-log line into that write's own
      // response body instead of the terminal.
      process.stderr.write(`${method} ${url} ${res.statusCode} ${Date.now() - start}ms\n`);
    });
    route(store, doPoll, withWriteLock, sseClients, req, res).catch((e) => serverError(res, e));
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, "127.0.0.1", () => resolvePromise());
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (opts.port ?? DEFAULT_PORT);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    // End every open SSE stream (and force its socket shut) before asking
    // the server to close — otherwise server.close()'s callback waits
    // forever for a connection that, by design, never ends on its own.
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // already gone
      }
      try {
        client.socket?.destroy();
      } catch {
        // already gone
      }
    }
    sseClients.clear();
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
      // Backstop for any other lingering connection (e.g. a slow client
      // mid-response) so close() always settles promptly.
      server.closeAllConnections();
    });
  };

  return { port, store, close };
}
