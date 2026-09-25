/**
 * apps/server/src/http.ts — the localhost HTTP + SSE surface over
 * apps/server/src/store.ts's Store (W-014, rewritten W-016). `startServer`
 * owns the whole lifecycle: open the Store, ingest one snapshot, start
 * polling (unless `--once`), bind the HTTP server to 127.0.0.1 only, and
 * hand back a `close()` that stops both. `packages/cli/src/serve.ts` is the
 * thin argv wrapper around this; apps/server/test/server.test.ts drives this
 * module directly so the tests never depend on main.ts wiring the command
 * in.
 *
 * W-016 (cascade-4 review) rewired this module for dependency inversion:
 * apps/server must never import `@bisellium/cli` or `@bisellium/commands`
 * (that was the actual cycle — apps/server re-implementing ingest AND
 * importing the CLI's write commands both at once). Every write command and
 * `checkStudio` are injected via `StartServerOptions` instead; the CLI
 * (packages/cli/src/serve.ts) is what wires the real ones in.
 *
 * Also fixed this cascade: writes require `X-Bisellium-Token` (loopback bind
 * alone never authorized anything — it's the same 127.0.0.1 every process on
 * the machine shares), an `Origin` header on any write is refused outright
 * (this is a local tool, not a CORS-enabled API), a wrong Content-Type on a
 * write is 415, an oversized body is 413 with a real JSON response instead
 * of a destroyed socket, `?limit=` on /api/events and /api/timeline/:sella
 * clamps into [1,500] and never throws, the SSE fan-out is one
 * `store.on("event")` listener total (not one per client), a client past
 * MAX_SSE_CLIENTS gets 503, a client whose socket errors is dropped without
 * taking the server down, a slow client's backpressure (`res.write()`
 * returning false) never blocks the others, and static file containment
 * uses `path.relative` instead of a bare `startsWith` (which a sibling
 * directory sharing WEB_DIST's name as a prefix could pass).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GantryEvent } from "@bisellium/schema";
import { codexListModels } from "@bisellium/shim";
import { Store, type ModelRecordEntry } from "./store.js";

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
  /** Injected by packages/cli/src/serve.ts. apps/server must not import
   *  @bisellium/cli or @bisellium/commands — that is the cycle. */
  checkStudio: (root: string, now?: Date) => { ok: boolean; blocks: number; advisories: number; findings: unknown[] };
  /** Printed by serve.ts at start; required on every POST as
   *  X-Bisellium-Token. Auto-generated when omitted (tests pin one so they
   *  can craft the header deterministically). */
  token?: string;
  /** Injected write runners, so apps/server calls no CLI module by name. */
  runners: {
    answer: (args: string[]) => { exitCode: number };
    greenlight: (args: string[]) => { exitCode: number };
    budget: (args: string[]) => { exitCode: number };
    handoff: (args: string[]) => { exitCode: number };
    talk: (args: string[]) => Promise<{ exitCode: number }>;
    pause: (args: string[]) => Promise<{ exitCode: number }>;
    resume: (args: string[]) => Promise<{ exitCode: number }>;
    /** W-065: `bisellium delegate` — the Patron's write, like
     *  answer/greenlight/budget below. */
    delegate: (args: string[]) => { exitCode: number };
  };
  /** W-065: GET /api/models' live vendor-listing call — `codex debug models`
   *  by default, injected so tests never spawn a real vendor CLI and can
   *  assert "no route runs a vendor turn" with a stub that fails the test if
   *  called past a listing (never a turn). Cheap and local; still raced
   *  against a timeout here, since a hung stub or a hung real process must
   *  never block the route. */
  listModels?: () => Promise<{ id: string; harness: string }[]>;
  /** W-064 (censor's W-065 r2 seam note, folded in): the GET /api/models
   *  listing cache's TTL. Defaults to `MODELS_LISTING_TTL_MS`; tests pin a
   *  short one so "a call AFTER the TTL refreshes the listing" doesn't need
   *  a real 5.2s sleep. */
  listingTtlMs?: number;
}

export interface StartServerResult {
  port: number;
  token: string;
  store: Store;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 4477;
const DEFAULT_POLL_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const MAX_SSE_CLIENTS = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 500;

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

/** Every `error` value any response may carry. A caught value cannot be a
 *  member, so `sendError` cannot be handed one — enforced by tsc. */
type ErrorCode =
  | "internal error"
  | "invalid JSON body"
  | "request body must be a JSON object"
  | "request body too large"
  | "forbidden"
  | "not found"
  | "too many /api/live clients"
  | "missing or invalid X-Bisellium-Token"
  | "cross-origin writes are refused"
  | "Content-Type must be application/json"
  | "item cannot be combined with since"
  | "petitio and reply are required strings"
  | "opus is required"
  | "period, collegium and tokens are required"
  | "opus, sella and next are required"
  | "sella and message are required"
  | "either {sella, model} or {munus, tier} are required"
  | "unknown opus"
  | "unknown sella";

// @ts-expect-error — an arbitrary string must not be assignable to ErrorCode.
// This is the closedness assertion (W-057 behaviour 3): widening the union
// with `| string` makes this line stop erroring, which fails `typecheck` —
// the member count is deliberately not asserted, since a count would only
// teach the next widening to get past it.
const _errorCodeIsClosed: ErrorCode = "arbitrary" as string;

/** The single choke point every error response body goes through — every
 *  other `sendJson`/`sendText` call in this file answering an error is
 *  forbidden from carrying an `error` key (W-057 behaviour 3's source pin,
 *  apps/server/test/server.test.ts). `ref` correlates a 500 with its stderr
 *  log line (serverError, below); no other status ever carries one. */
function sendError(res: ServerResponse, status: number, code: ErrorCode, ref?: string): void {
  sendJson(res, status, ref === undefined ? { error: code } : { error: code, ref });
}

/** The 500 body is a constant plus a correlation id — never derived from the
 *  caught value's message or stack. CodeQL's taint model treats an
 *  exception's *message* as stack-derived, so serialising it into a
 *  response, even with `.stack` already dropped, is the flagged flow (GHAS
 *  alert 3, js/stack-trace-exposure). The real message and stack go to
 *  `process.stderr` instead, tagged with the same `ref`, so an operator with
 *  a `ref` from a console screenshot can still find the throw — logged
 *  unconditionally, even when the response itself is undeliverable (a
 *  destroyed client socket), since the log is what the property is really
 *  about. */
function serverError(res: ServerResponse, e: unknown): void {
  const ref = randomUUID();
  const message = e instanceof Error ? e.message : String(e);
  const stack = e instanceof Error && e.stack ? e.stack : "(no stack)";
  process.stderr.write(`bisellium serve: 500 ${ref} ${message}\n${stack}\n`);
  if (res.headersSent) return;
  sendError(res, 500, "internal error", ref);
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

class PayloadTooLargeError extends Error {}
class MalformedJsonError extends Error {}
class NotAnObjectError extends Error {}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return; // already over cap: drain and ignore the rest
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0; // stop holding what we'd already buffered
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new PayloadTooLargeError("request body too large"));
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw === "") {
        resolvePromise({});
        return;
      }
      try {
        const v: unknown = JSON.parse(raw);
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          reject(new NotAnObjectError("request body must be a JSON object"));
          return;
        }
        resolvePromise(v as Record<string, unknown>);
      } catch {
        // The V8 parse message (position, token) is dropped: it's the only
        // remaining path by which an arbitrary exception's text could reach
        // a response body (W-057). It describes the client's own malformed
        // input, but dropping it makes "no caught value's text reaches a
        // response" total over the file rather than true of the 500 alone.
        reject(new MalformedJsonError("invalid JSON body"));
      }
    });
    // The raw request-stream error, unwrapped (e.g. `aborted`, `ECONNRESET`
    // under a future tailnet deployment) — deliberately NOT given its own
    // typed class: it is not a client mistake like the three above, so
    // readJsonBodyOr400 rethrows it rather than answering 400 with its
    // message (W-057 behaviour 6).
    req.on("error", reject);
  });
}

/** readJsonBody, but a malformed body answers 400 {error} (a client mistake,
 *  413 for an oversized one) here instead of letting the rejection reach
 *  route()'s catch, which hands everything to serverError() and answers 500
 *  (spec: 500 is reserved for server errors). Returns `undefined` after
 *  already sending a response — the caller's job is just to `return` when it
 *  sees that.
 *
 *  Dispatch is by `instanceof` over readJsonBody's three typed rejections
 *  only; anything else — in particular `:166`'s raw, untyped request-stream
 *  error — is rethrown to route()'s catch, which answers the generic 500
 *  (with a correlation ref) instead of narrating the stream error's message
 *  into a 400 body. That 400→500 shift on this one path is ruled honest:
 *  the shipped client special-cases only 401 (apps/web's api.ts). */
async function readJsonBodyOr400(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJsonBody(req);
  } catch (e) {
    if (e instanceof PayloadTooLargeError) {
      sendError(res, 413, "request body too large");
      return undefined;
    }
    if (e instanceof NotAnObjectError) {
      sendError(res, 400, "request body must be a JSON object");
      return undefined;
    }
    if (e instanceof MalformedJsonError) {
      sendError(res, 400, "invalid JSON body");
      return undefined;
    }
    throw e;
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

const MODELS_LISTING_TTL_MS = 5_000;
const MODELS_LISTING_TIMEOUT_MS = 3_000;

interface ListingResult {
  /** True only when a listing genuinely succeeded (now, or within the TTL
   *  window) — false means "we have never obtained real data", which must
   *  NOT be read as "the vendor listed nothing" (see mergeModelsWithListing:
   *  withdrawal requires `ok`, precisely so a failure or a cold start never
   *  empties the dropdown by mistake). */
  ok: boolean;
  listing: { id: string; harness: string }[];
}

/** Wraps `listModels` with the TTL + timeout the brief's refresh policy
 *  requires: an in-process TTL so an SSE-driven re-render burst doesn't
 *  spawn a subprocess per event, and a hard timeout independent of whatever
 *  `listModels` does — a hung stub or a hung real process degrades to the
 *  last-known-GOOD listing (or, with none yet, `{ ok: false, listing: [] }`)
 *  exactly like an outright failure, and never blocks the route. */
function createListingCache(listModels: () => Promise<{ id: string; harness: string }[]>, ttlMs: number = MODELS_LISTING_TTL_MS): () => Promise<ListingResult> {
  let cache: { at: number; result: ListingResult } | undefined;
  return async () => {
    const now = Date.now();
    if (cache && now - cache.at < ttlMs) return cache.result;
    try {
      const listing = await Promise.race([
        listModels(),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("listing timed out")), MODELS_LISTING_TIMEOUT_MS)),
      ]);
      cache = { at: now, result: { ok: true, listing } };
    } catch {
      cache = { at: now, result: cache?.result ?? { ok: false, listing: [] } };
    }
    return cache.result;
  };
}

/** Harnesses this system knows how to list at all (the brief's own survey:
 *  "one vendor of two can enumerate, and only through a debug verb" — codex
 *  has `debug models`, claude has no listing verb). Fixed, not inferred from
 *  one call's own (possibly empty) result — inferring it that way could never
 *  tell "codex listed zero models" apart from "codex wasn't asked". */
const LISTED_HARNESSES = new Set(["codex"]);

/** Layers a live listing over the probe record: a listed id with no record
 *  entry is a fresh "unverified" candidate; a record entry the listing no
 *  longer offers is flagged withdrawn by downgrading it to "unverified"
 *  (kept, not dropped — never a fourth state). The listing never promotes
 *  anything to "available" by itself, and withdrawal only ever fires when
 *  `ok` — a failed or never-yet-successful listing changes nothing. */
function mergeModelsWithListing(record: ModelRecordEntry[], { ok, listing }: ListingResult): ModelRecordEntry[] {
  const listedIds = new Set(listing.map((m) => m.id));
  const byId = new Map<string, ModelRecordEntry>();
  for (const entry of record) {
    const withdrawn = ok && entry.state !== "unverified" && entry.harness !== undefined && LISTED_HARNESSES.has(entry.harness) && !listedIds.has(entry.id);
    byId.set(entry.id, withdrawn ? { ...entry, state: "unverified" } : entry);
  }
  for (const m of listing) {
    if (!byId.has(m.id)) byId.set(m.id, { id: m.id, harness: m.harness, state: "unverified" });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Write auth: token + no-Origin + application/json. "Loopback alone never
// authorizes" (W-016 behaviour 5) — the server binding to 127.0.0.1 is still
// true but is no longer treated as sufficient on its own.
// ---------------------------------------------------------------------------

/** Constant-time token compare — a plain `===` would leak the token's real
 *  length/prefix through timing, cheap to avoid with a fixed-size digest
 *  compare instead. */
function tokensMatch(expected: string, given: string | undefined): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The two `Origin` values the served console may legitimately carry: the
 *  bound loopback socket, addressed as `127.0.0.1` or `localhost` (a
 *  browser's Origin follows the URL the page was loaded from, and both
 *  reach the same socket on every platform this runs on). Computed once at
 *  startup from `server.address().port` — the port actually bound, not
 *  `opts.port` (`0`/`undefined` in exactly the cases that matter, including
 *  every test here) — and threaded in rather than recomputed per request. */
export type AcceptedOrigins = readonly [string, string];

export function acceptedOriginsFor(port: number): AcceptedOrigins {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/** Order matters, and is exactly what the spec's cases pin down: Origin
 *  (this is a local tool, never a CORS-enabled API) is checked before the
 *  token is even looked at; then the token; then Content-Type. An absent
 *  Origin is accepted outright (curl, the CLI, every non-browser caller) —
 *  the token is what authorizes those, unchanged (W-016 behaviour 5). A
 *  present Origin must equal one of the two accepted strings exactly:
 *  `Origin: null` (a value, not an absence — a sandboxed iframe, `file://`,
 *  some redirect chains) and a wrong port/scheme/host all fall through to
 *  the same 403 as a foreign origin, since none of them equal either
 *  accepted string. No trust is derived from `Host` or any
 *  `X-Forwarded-*` header — only `Origin`, compared against the pair
 *  computed from the bound socket. Returns the status to answer with, or
 *  `undefined` when the request is authorized to proceed. */
function checkWriteAuth(req: IncomingMessage, token: string, acceptedOrigins: AcceptedOrigins): number | undefined {
  const origin = req.headers["origin"];
  if (origin !== undefined) {
    if (typeof origin !== "string" || !acceptedOrigins.includes(origin)) return 403;
  }
  if (!tokensMatch(token, req.headers["x-bisellium-token"] as string | undefined)) return 401;
  const contentType = (req.headers["content-type"] ?? "").toString();
  if (!/^application\/json(\s*;.*)?$/i.test(contentType.trim())) return 415;
  return undefined;
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
<li>GET /api/models</li>
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
<li>POST /api/answer, /api/greenlight, /api/budget, /api/handoff, /api/talk, /api/pause, /api/resume, /api/delegate (X-Bisellium-Token required)</li>
</ul>
</body>
</html>`;

/** Containment via `path.relative`, not a bare `startsWith`: a sibling
 *  directory that merely shares WEB_DIST's name as a string prefix (e.g.
 *  `.../web-dist-evil/x` against `.../web-dist`) would pass a `startsWith`
 *  check with no separator boundary — `relative()` can't be fooled that way,
 *  since it always answers in terms of real path segments. */
export function isPathContained(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (pathname === "/") {
    const indexPath = join(WEB_DIST, "index.html");
    if (existsSync(indexPath)) sendFile(res, indexPath);
    else sendText(res, 200, ROUTE_INDEX_HTML, "text/html; charset=utf-8");
    return true;
  }
  if (pathname.startsWith("/assets/")) {
    const filePath = resolve(WEB_DIST, "." + pathname);
    if (!isPathContained(WEB_DIST, filePath)) {
      sendError(res, 403, "forbidden");
      return true;
    }
    let isFile = false;
    try {
      isFile = statSync(filePath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      sendError(res, 404, "not found");
      return true;
    }
    sendFile(res, filePath);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// SSE — one store "event" listener fans out to every connected client
// (never one listener per client), with per-client backpressure and a hard
// connection cap.
// ---------------------------------------------------------------------------

interface SseHub {
  clients: Set<ServerResponse>;
  /** Clients whose last res.write() returned false — skipped on broadcast
   *  until their "drain" fires, so one slow reader never blocks the rest. */
  paused: WeakSet<ServerResponse>;
  stop: () => void;
}

function createSseHub(store: Store): SseHub {
  const clients = new Set<ServerResponse>();
  const paused = new WeakSet<ServerResponse>();
  const onEvent = (e: GantryEvent): void => {
    const frame = `data: ${JSON.stringify(e)}\n\n`;
    for (const res of clients) {
      if (paused.has(res)) continue;
      let ok: boolean;
      try {
        ok = res.write(frame);
      } catch {
        continue; // client gone; its own close handler cleans it up
      }
      if (!ok) {
        paused.add(res);
        res.once("drain", () => paused.delete(res));
      }
    }
  };
  store.on("event", onEvent);
  return { clients, paused, stop: () => store.off("event", onEvent) };
}

function handleLive(hub: SseHub, req: IncomingMessage, res: ServerResponse): void {
  if (hub.clients.size >= MAX_SSE_CLIENTS) {
    sendError(res, 503, "too many /api/live clients");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  hub.clients.add(res);

  const heartbeat = setInterval(() => {
    if (hub.paused.has(res)) return;
    try {
      res.write(": heartbeat\n\n");
    } catch {
      // client gone; close handler cleans up
    }
  }, HEARTBEAT_MS);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    hub.clients.delete(res);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
  // A client whose socket errors (reset, broken pipe, …) must be dropped
  // the same way a clean close is — without this, an unhandled "error" on a
  // response stream can crash the whole process.
  res.on("error", cleanup);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Clamps a `?limit=` query param into `[MIN_LIMIT, MAX_LIMIT]`. `null`
 *  (the param was never given) means "no limit" — the caller decides what
 *  that means for its own route; anything else (out of range, `0`,
 *  negative, non-numeric) is clamped, never thrown on (W-016 behaviour 7). */
function clampedLimit(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return MAX_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)));
}

function num(v: string | null): number | undefined {
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function route(
  store: Store,
  allowPoll: () => Promise<GantryEvent[]>,
  withWriteLock: <T>(fn: () => Promise<T>) => Promise<T>,
  sseHub: SseHub,
  checkStudio: StartServerOptions["checkStudio"],
  runners: StartServerOptions["runners"],
  getListing: () => Promise<ListingResult>,
  token: string,
  acceptedOrigins: AcceptedOrigins,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  // ---- writes: token + accepted-origin + application/json required.
  // Loopback (the bind itself) is never sufficient on its own — see
  // checkWriteAuth. --------------------------------------------------------
  const WRITE_PATHS = new Set(["/api/answer", "/api/greenlight", "/api/budget", "/api/handoff", "/api/talk", "/api/pause", "/api/resume", "/api/delegate"]);
  if (method === "POST" && WRITE_PATHS.has(pathname)) {
    const authStatus = checkWriteAuth(req, token, acceptedOrigins);
    if (authStatus !== undefined) {
      const code: ErrorCode = authStatus === 401 ? "missing or invalid X-Bisellium-Token" : authStatus === 403 ? "cross-origin writes are refused" : "Content-Type must be application/json";
      sendError(res, authStatus, code);
      return;
    }
  }

  if (method === "GET" && pathname === "/api/officina") return sendJson(res, 200, store.api.officina());

  // W-065: the merged view GET /api/officina's own `models` field does not
  // attempt — that field is the record alone, unmerged (see store.ts). This
  // route layers the live listing over it on every call (TTL-cached, timed
  // out independently of whatever `getListing` does); a listing failure or
  // timeout degrades to the record alone and never empties the dropdown.
  if (method === "GET" && pathname === "/api/models") {
    const record = store.api.officina().models ?? [];
    const listing = await getListing();
    return sendJson(res, 200, mergeModelsWithListing(record, listing));
  }

  if (method === "GET" && pathname === "/api/opera") {
    const state = url.searchParams.get("state") ?? undefined;
    const collegium = url.searchParams.get("collegium") ?? undefined;
    return sendJson(res, 200, store.api.opera({ state, collegium }));
  }

  {
    const m = /^\/api\/opus\/([^/]+)$/.exec(pathname);
    if (method === "GET" && m) {
      const opus = store.api.opus(decodeURIComponent(m[1]!));
      if (!opus) return sendError(res, 404, "unknown opus");
      return sendJson(res, 200, opus);
    }
  }

  if (method === "GET" && pathname === "/api/inbox") return sendJson(res, 200, store.api.needsYou());

  if (method === "GET" && pathname === "/api/acta") {
    const days = num(url.searchParams.get("days")) ?? 7;
    return sendJson(res, 200, store.api.acta(days));
  }

  if (method === "GET" && pathname === "/api/aerarium") {
    const period = url.searchParams.get("period") ?? undefined;
    return sendJson(res, 200, store.api.aerarium(period));
  }

  if (method === "GET" && pathname === "/api/providers") {
    const live = url.searchParams.get("live") === "1" || url.searchParams.get("live") === "true";
    return sendJson(res, 200, await store.api.providers(live));
  }

  if (method === "GET" && pathname === "/api/health") return sendJson(res, 200, store.api.health(checkStudio));

  {
    const m = /^\/api\/timeline\/([^/]+)$/.exec(pathname);
    if (method === "GET" && m) {
      const sella = decodeURIComponent(m[1]!);
      if (!store.sellaExists(sella)) return sendError(res, 404, "unknown sella");
      const limit = clampedLimit(url.searchParams.get("limit"));
      return sendJson(res, 200, store.api.timeline(sella, limit));
    }
  }

  if (method === "GET" && pathname === "/api/events") {
    const since = num(url.searchParams.get("since"));
    const limit = clampedLimit(url.searchParams.get("limit"));
    const item = url.searchParams.get("item") ?? undefined;
    // `since` resumes the whole stream by the Index's seq; the `item` path
    // reads the log fresh (never the Index) and its rows carry no seq, so
    // there is nothing to resume from — refusing is the honest answer
    // (W-064 Interfaces).
    if (item !== undefined && since !== undefined) {
      sendError(res, 400, "item cannot be combined with since");
      return;
    }
    return sendJson(res, 200, store.api.events({ since, limit, item }));
  }

  if (method === "GET" && pathname === "/api/receipts") {
    const sella = url.searchParams.get("sella") ?? undefined;
    return sendJson(res, 200, store.api.receipts(sella));
  }

  if (method === "GET" && pathname === "/api/live") {
    handleLive(sseHub, req, res);
    return;
  }

  // ---- test-only manual poll hook (spec: "allowed only when NODE_ENV=test") --
  if (method === "POST" && pathname === "/api/_poll") {
    if (process.env["NODE_ENV"] !== "test") {
      sendError(res, 404, "not found");
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
      sendError(res, 400, "petitio and reply are required strings");
      return;
    }
    const args = ["--petitio", petitio, reply, "--studio", store.studioDir];
    if (body["askBack"] === true) args.push("--ask-back");
    if (body["charterGap"] === true) args.push("--charter-gap");
    const { result, stdout, stderr } = await withWriteLock(() => asPatron(() => withCapturedConsole(() => runners.answer(args))));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/greenlight") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const opus = body["opus"];
    if (typeof opus !== "string") {
      sendError(res, 400, "opus is required");
      return;
    }
    const args = [opus, "--studio", store.studioDir];
    if (typeof body["decline"] === "string") args.push("--decline", body["decline"]);
    const { result, stdout, stderr } = await withWriteLock(() => asPatron(() => withCapturedConsole(() => runners.greenlight(args))));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/budget") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const period = body["period"];
    const collegium = body["collegium"];
    const tokens = body["tokens"];
    if (typeof period !== "string" || typeof collegium !== "string" || (typeof tokens !== "number" && typeof tokens !== "string")) {
      sendError(res, 400, "period, collegium and tokens are required");
      return;
    }
    const args = [period, "--collegium", collegium, "--tokens", String(tokens), "--studio", store.studioDir];
    if (body["hours"] !== undefined) args.push("--hours", String(body["hours"]));
    const { result, stdout, stderr } = await withWriteLock(() => asPatron(() => withCapturedConsole(() => runners.budget(args))));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/handoff") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const opus = body["opus"];
    const sella = body["sella"];
    const next = body["next"];
    if (typeof opus !== "string" || typeof sella !== "string" || typeof next !== "string") {
      sendError(res, 400, "opus, sella and next are required");
      return;
    }
    const args = ["--opus", opus, "--sella", sella, "--next", next, "--studio", store.studioDir];
    if (typeof body["stage"] === "string") args.push("--stage", body["stage"]);
    if (typeof body["blockedOn"] === "string") args.push("--blocked-on", body["blockedOn"]);
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runners.handoff(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/talk") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const sella = body["sella"];
    const message = body["message"];
    if (typeof sella !== "string" || typeof message !== "string") {
      sendError(res, 400, "sella and message are required");
      return;
    }
    const args = ["--sella", sella, "--studio", store.studioDir];
    if (typeof body["harness"] === "string") args.push("--harness", body["harness"]);
    args.push(message);
    // May take minutes (a real harness turn) — no server-side timeout here;
    // the caller waits for the reply, same as the CLI would. withWriteLock
    // queues this behind any other in-flight write rather than letting it
    // interleave with one through the shared console/env mutation.
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runners.talk(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/pause") {
    const body = await readJsonBody(req).catch(() => ({}) as Record<string, unknown>);
    const args = ["--studio", store.studioDir];
    if (typeof body["reason"] === "string") args.push("--reason", body["reason"]);
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runners.pause(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/resume") {
    const args = ["--studio", store.studioDir];
    const { result, stdout, stderr } = await withWriteLock(() => withCapturedConsole(() => runners.resume(args)));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  if (method === "POST" && pathname === "/api/delegate") {
    const body = await readJsonBodyOr400(req, res);
    if (body === undefined) return;
    const args = ["--studio", store.studioDir];
    if (typeof body["sella"] === "string" && typeof body["model"] === "string") {
      args.push("--sella", body["sella"], "--model", body["model"]);
    } else if (typeof body["munus"] === "string" && typeof body["tier"] === "string") {
      args.push("--munus", body["munus"], "--tier", body["tier"]);
    } else {
      sendError(res, 400, "either {sella, model} or {munus, tier} are required");
      return;
    }
    if (typeof body["from"] === "string") args.push("--from", body["from"]);
    // A write from the console is the Patron's — asPatron, like
    // answer/greenlight/budget above. (D-023 §3's "acting role" concern is
    // about main.ts's CLI path, not the console: every console write IS the
    // Patron's, same as the other six.)
    const { result, stdout, stderr } = await withWriteLock(() => asPatron(() => withCapturedConsole(() => runners.delegate(args))));
    return writeResponse(res, result.exitCode, stdout, stderr);
  }

  // ---- static -----------------------------------------------------------
  if (method === "GET" && serveStatic(pathname, res)) return;

  sendError(res, 404, "not found");
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

export async function startServer(opts: StartServerOptions): Promise<StartServerResult> {
  const studioDir = resolve(opts.studioDir);
  if (!existsSync(join(studioDir, "bisellium.yml"))) {
    throw new Error(`not a studio: ${studioDir}`);
  }

  const token = opts.token ?? randomBytes(24).toString("hex");
  const store = new Store({ studioDir, now: opts.now, live: opts.live });
  await store.ingestOnce();

  const once = opts.once ?? false;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  let polling = false;
  const doPoll = async (): Promise<GantryEvent[]> => {
    if (polling) return []; // skip when a poll is still running (spec)
    polling = true;
    try {
      return await store.ingestOnce();
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

  // Every write route serializes through this (see createWriteLock's docs).
  const withWriteLock = createWriteLock();
  // GET /api/models' live listing: TTL-cached + timed out per-server-instance
  // (see createListingCache's docs).
  const getListing = createListingCache(opts.listModels ?? codexListModels, opts.listingTtlMs ?? MODELS_LISTING_TTL_MS);
  // One store "event" listener for every connected /api/live client to fan
  // out from (W-016 behaviour 8) — never one listener per client.
  const sseHub = createSseHub(store);

  // Set for real right after listen() resolves, below — no request can
  // arrive before that (nothing has called startServer's caller back yet).
  // A `let`, not a `const`, read fresh by `route()` on every request via
  // closure: the accepted pair depends on the bound port, only known once
  // the socket is actually listening.
  let acceptedOrigins: AcceptedOrigins = ["", ""];

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
    route(store, doPoll, withWriteLock, sseHub, opts.checkStudio, opts.runners, getListing, token, acceptedOrigins, req, res).catch((e) => serverError(res, e));
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? DEFAULT_PORT, "127.0.0.1", () => resolvePromise());
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (opts.port ?? DEFAULT_PORT);
  acceptedOrigins = acceptedOriginsFor(port);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (pollTimer) clearInterval(pollTimer);
    sseHub.stop();
    // End every open SSE stream (and force its socket shut) before asking
    // the server to close — otherwise server.close()'s callback waits
    // forever for a connection that, by design, never ends on its own.
    for (const client of sseHub.clients) {
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
    sseHub.clients.clear();
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise());
      // Backstop for any other lingering connection (e.g. a slow client
      // mid-response) so close() always settles promptly.
      server.closeAllConnections();
    });
  };

  return { port, token, store, close };
}
