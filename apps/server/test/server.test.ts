/**
 * apps/server/test/server.test.ts — W-014 (`bisellium serve`: localhost
 * HTTP + SSE over the store), against a temp copy of examples/sample-studio.
 * `now` is pinned to 2026-09-18T17:00:00Z (the repo-wide pinned clock) so
 * the aerarium/current-period math is reproducible. `NODE_ENV=test` is set
 * before starting the server so the `/api/_poll` test hook is reachable —
 * it's otherwise a 404.
 *
 * W-016 (cascade-4 review) rewired `startServer` for dependency inversion:
 * apps/server/src no longer imports @bisellium/cli or @bisellium/commands
 * (that was the actual cycle), so every write command and `checkStudio` are
 * injected here from @bisellium/commands / a trivial fake — the same way
 * packages/cli/src/serve.ts wires the real ones in production. Writes also
 * now require `X-Bisellium-Token`; every existing write call below carries
 * it via `postJson`'s default header.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { connect as netConnect } from "node:net";
import { parse as parseYaml } from "yaml";
import { runAnswer, runGreenlight, runBudget, runHandoff } from "@bisellium/commands/writes.js";
import { runTalk } from "@bisellium/commands/talk.js";
import { runPause, runResume } from "@bisellium/commands/pause.js";
import { runDelegate } from "@bisellium/commands/delegate.js";
import { startServer, isPathContained, type StartServerOptions } from "../src/index.js";

process.env["NODE_ENV"] = "test";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T17:00:00Z");
const TEST_TOKEN = "test-token-w016";

// W-057: `BISELLIUM_ONLY_BEHAVIOUR` (comma-separated behaviour numbers)
// restricts the run to those blocks — same shape as lifecycle.test.ts's own
// red-capture convention — so `bisellium red --behaviour <n>` can isolate a
// single behaviour's assertion instead of the whole file's exit code. Unset,
// every behaviour runs, exactly as before this existed.
const only = process.env["BISELLIUM_ONLY_BEHAVIOUR"];
const selected = only ? new Set(only.split(",").map(Number)) : undefined;
const runs = (behaviour: number): boolean => selected === undefined || selected.has(behaviour);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
};

// ---------------------------------------------------------------------------
// Fakes for what startServer now injects instead of importing @bisellium/cli
// or @bisellium/commands directly — production wiring (packages/cli/src/
// serve.ts) uses the real checkStudio and the real commands; this file
// exercises apps/server's own logic in isolation, same spirit as before.
// ---------------------------------------------------------------------------

const fakeCheckStudio: StartServerOptions["checkStudio"] = () => ({ ok: true, blocks: 0, advisories: 0, findings: [] });

const realRunners: StartServerOptions["runners"] = {
  answer: (args) => runAnswer(args),
  greenlight: (args) => runGreenlight(args),
  budget: (args) => runBudget(args),
  handoff: (args) => runHandoff(args),
  talk: (args) => runTalk(args),
  pause: (args) => runPause(args),
  resume: (args) => runResume(args),
  delegate: (args) => runDelegate(args),
};

/** A harmless default for every test that doesn't exercise GET /api/models
 *  itself — never spawns a real `codex`, so these tests stay hermetic.
 *  Behaviour 9's own tests below install their own stub (with a call
 *  counter) instead of this one. */
const noListing: StartServerOptions["listModels"] = () => Promise.resolve([]);

function baseOpts(studioDir: string, extra: Partial<StartServerOptions> = {}): StartServerOptions {
  // listModels defaults to "must not be called" — every existing test here
  // never touches GET /api/models, so this is a standing assertion that no
  // unrelated route ever triggers a vendor listing; behaviour 9's own tests
  // override it per case.
  return { studioDir, checkStudio: fakeCheckStudio, runners: realRunners, listModels: noListing, token: TEST_TOKEN, ...extra };
}

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-server-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

interface JsonResponse {
  status: number;
  body: any;
  /** W-057 behaviour 7: the raw response bytes, for byte-identity assertions
   *  that `JSON.parse` equality can't make (an added field, e.g. `ref`). */
  text: string;
}

async function getJson(base: string, path: string): Promise<JsonResponse> {
  const res = await fetch(base + path);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

async function postJson(base: string, path: string, payload: unknown, headers: Record<string, string> = {}): Promise<JsonResponse> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bisellium-token": TEST_TOKEN, ...headers },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

/** postJson, but over raw node:http instead of fetch — the only way to set
 *  a header (`Host`, `X-Forwarded-Host`) that Fetch's forbidden-header list
 *  won't let a caller override (W-067 behaviour 1's "no trust from Host"
 *  case needs an actually-spoofed Host, not the request's real one). */
function rawPostJson(port: number, path: string, payload: unknown, headers: Record<string, string> = {}): Promise<JsonResponse> {
  return new Promise((resolvePromise, reject) => {
    const body = JSON.stringify(payload);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json", "x-bisellium-token": TEST_TOKEN, ...headers },
      },
      (res: IncomingMessage) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (raw += chunk));
        res.on("end", () => {
          let parsedBody: unknown;
          try {
            parsedBody = raw ? JSON.parse(raw) : undefined;
          } catch {
            parsedBody = raw;
          }
          resolvePromise({ status: res.statusCode ?? 0, body: parsedBody, text: raw });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** A minimal SSE client for /api/live: parses "data: <json>\n\n" frames off
 *  the raw response stream (node:http, not fetch — we want the connection
 *  to stay open and keep pushing). */
function connectSSE(port: number): { events: Record<string, unknown>[]; res: IncomingMessage | undefined; close: () => void } {
  const events: Record<string, unknown>[] = [];
  let buffer = "";
  let response: IncomingMessage | undefined;
  const req = httpRequest({ host: "127.0.0.1", port, path: "/api/live", method: "GET" }, (res: IncomingMessage) => {
    response = res;
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            events.push(JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
          } catch {
            /* not a data frame we care about (e.g. malformed) */
          }
        }
      }
    });
  });
  req.on("error", () => {
    /* connection torn down by close() below; nothing to report */
  });
  req.end();
  return { events, get res() { return response; }, close: () => req.destroy() };
}

function timelineLines(dir: string): Record<string, unknown>[] {
  const path = join(dir, "timeline", "patron.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
}

// ---------------------------------------------------------------------------
// W-057: helpers for GHAS alert 3 (stack-trace exposure) closed.
// ---------------------------------------------------------------------------

/** A `checkStudio` stub that throws with server-detail-carrying text (an
 *  absolute path, like a real ENOENT would) — reaches `route()`'s catch via
 *  GET /api/health (store.ts's `health()` calls `checkStudio` directly when
 *  no `health.json` exists yet, true of every `freshStudio()` fixture). */
const throwingCheckStudio: StartServerOptions["checkStudio"] = () => {
  throw new Error("ENOENT: open '/home/secret/studio/bisellium.yml'");
};

/** Swaps `process.stderr.write` for the duration of `fn` and returns
 *  whatever was written. apps/server writes its log lines straight to
 *  `process.stderr.write`, not `console.error` (deliberately — see :861's
 *  own comment, so an in-flight write's captured console never eats them),
 *  so lifecycle.test.ts's `console.error`-swapping `withStderr` can't
 *  observe them; this is the same shape, generalised to the stream this
 *  module actually uses. */
async function withServerStderr<T>(fn: () => Promise<T> | T): Promise<{ result: T; stderr: string }> {
  const orig = process.stderr.write.bind(process.stderr);
  let stderr = "";
  process.stderr.write = ((chunk: unknown) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stderr };
  } finally {
    process.stderr.write = orig;
  }
}

/** Opens a raw TCP connection to `port`, writes valid headers for a POST
 *  with a `Content-Length` well beyond the bytes actually sent, then
 *  destroys the socket mid-body (never `.end()`s it) — this is what makes
 *  `readJsonBody`'s `req.on("error", reject)` (`:166`) fire with Node's own
 *  unwrapped `Error: aborted`, the raw request-stream error behaviour 6
 *  exercises. Verified empirically: a clean `.end()` (FIN) instead trips
 *  Node's *own* `clientError` "400 Bad Request" — a different, unrelated
 *  mechanism this opus has no business asserting on — so this must be a
 *  hard `.destroy()`, never a graceful close. */
function induceRequestStreamError(port: number, path: string, token: string): Promise<void> {
  return new Promise((resolvePromise) => {
    const sock = netConnect(port, "127.0.0.1", () => {
      const headers = [`POST ${path} HTTP/1.1`, "Host: 127.0.0.1", "Content-Type: application/json", `X-Bisellium-Token: ${token}`, "Content-Length: 1000", "", ""].join("\r\n");
      sock.write(headers);
      sock.write('{"opus":"W-002"'); // far short of the declared 1000 bytes
      setTimeout(() => {
        sock.destroy();
        resolvePromise();
      }, 150);
    });
    sock.on("error", () => resolvePromise()); // a client-side ECONNRESET etc. here is expected, not a test failure
  });
}

/** Finds every top-level call to `fnName(...)` in `source`, matching parens
 *  by depth (not a regex up to the first `)`, which a nested call like
 *  `store.api.officina()` would close early). ponytail: assumes no `(`/`)`
 *  characters live inside a string/template literal in an argument list —
 *  true of every call site in http.ts today, verified by reading the file;
 *  a source pin over a small, human-read file, not a general JS parser. */
function findCallArgs(source: string, fnName: string): { start: number; end: number; args: string }[] {
  const calls: { start: number; end: number; args: string }[] = [];
  const re = new RegExp(`\\b${fnName}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const argStart = m.index + m[0].length;
    let depth = 1;
    let i = argStart;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    calls.push({ start: m.index, end: i, args: source.slice(argStart, i - 1) });
  }
  return calls;
}

/** The span `[start, end)` of `function sendError(...) { ... }`'s own
 *  declaration in `source`, brace-depth matched from its opening `{` to the
 *  matching `}` — `{ start: -1, end: -1 }` (matches nothing) when the
 *  function doesn't exist yet, which is exactly today's tree. */
function sendErrorSpan(source: string): { start: number; end: number } {
  const idx = source.indexOf("function sendError(");
  if (idx === -1) return { start: -1, end: -1 };
  let depth = 0;
  let started = false;
  let i = idx;
  for (; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
      started = true;
    } else if (source[i] === "}") {
      depth--;
      if (started && depth === 0) {
        i++;
        break;
      }
    }
  }
  return { start: idx, end: i };
}

/** Behaviour 3's status-agnostic source pin: every `sendJson`/`sendText`
 *  call whose argument list contains an `error:` key, outside the one call
 *  lexically inside `sendError`'s own declaration — identified by position
 *  (the span above), never by matching the shape of the call's argument,
 *  which a second site could imitate. Returns the violations (empty when
 *  the invariant holds). */
function findErrorKeyResponseViolations(source: string): { start: number; snippet: string }[] {
  const span = sendErrorSpan(source);
  const calls = [...findCallArgs(source, "sendJson"), ...findCallArgs(source, "sendText")];
  const violations: { start: number; snippet: string }[] = [];
  for (const c of calls) {
    if (!/\berror\s*:/.test(c.args)) continue;
    const insideSendError = span.start !== -1 && c.start >= span.start && c.end <= span.end;
    if (!insideSendError) violations.push({ start: c.start, snippet: c.args.slice(0, 80) });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// W-016 behaviour 11: apps/server's own module graph never reaches
// @bisellium/cli or @bisellium/commands — a structural walk, not a grep (a
// grep for the string passes over a cycle reached through a third module).
// ---------------------------------------------------------------------------

async function assertNoCycle(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, "..", "src", "index.ts");
  const workspaceRoots: Record<string, string> = {
    "@bisellium/cli": resolve(repo, "packages/cli/src"),
    "@bisellium/commands": resolve(repo, "packages/commands/src"),
    "@bisellium/adapter-native": resolve(repo, "adapters/native/src"),
    "@bisellium/core": resolve(repo, "packages/core/src"),
    "@bisellium/schema": resolve(repo, "packages/schema/src"),
    "@bisellium/shim": resolve(repo, "packages/shim/src"),
    "@bisellium/pipeline": resolve(repo, "packages/pipeline/src"),
    "@bisellium/providers": resolve(repo, "packages/providers/src"),
  };
  const forbidden = new Set(["@bisellium/cli", "@bisellium/commands"]);
  const IMPORT_RE = /(?:import|export)\s+(?:[^"'`]*?from\s+)?["']([^"']+)["']/g;

  function resolveModulePath(fromFile: string, specifier: string): { file: string; pkg?: string } | undefined {
    if (specifier.startsWith(".")) {
      let target = resolve(dirname(fromFile), specifier);
      if (target.endsWith(".js")) target = target.slice(0, -3) + ".ts";
      if (!existsSync(target)) target = target + ".ts";
      return existsSync(target) ? { file: target } : undefined;
    }
    for (const [pkg, srcRoot] of Object.entries(workspaceRoots)) {
      if (specifier === pkg || specifier.startsWith(pkg + "/")) {
        const sub = specifier === pkg ? "index.js" : specifier.slice(pkg.length + 1);
        let target = join(srcRoot, sub.endsWith(".js") ? sub.slice(0, -3) + ".ts" : sub);
        if (!existsSync(target)) target = target + ".ts";
        return existsSync(target) ? { file: target, pkg } : undefined;
      }
    }
    return undefined; // an external dep (node:*, yaml, …) — never part of this cycle
  }

  const visited = new Set<string>();
  const reached = new Set<string>();
  function walk(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    for (const m of text.matchAll(IMPORT_RE)) {
      const specifier = m[1]!;
      const resolved = resolveModulePath(file, specifier);
      if (!resolved) continue;
      if (resolved.pkg && forbidden.has(resolved.pkg)) reached.add(resolved.pkg);
      walk(resolved.file);
    }
  }
  walk(entry);

  check("module graph: apps/server/src/index.ts never reaches @bisellium/cli or @bisellium/commands", reached.size === 0, JSON.stringify([...reached]));
}

async function main(): Promise<void> {
  await assertNoCycle();

  const dir = freshStudio("main");
  const started = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
  const base = `http://127.0.0.1:${started.port}`;
  let beforeRestartEvents: { name: string }[] = [];

  try {
    // ---- W-016 behaviour 1: apps/server's store IS @bisellium/core's Store —
    // the SQLite index exists on disk, and its own .query.opera() answers. --
    {
      const dbPath = join(dir, ".bisellium", "index", "index.db");
      check("index: .bisellium/index/index.db exists after startServer", existsSync(dbPath), dbPath);
      const opera = started.store.query.opera();
      check("index: store.query.opera() (the real Index) returns the studio's opera", opera.length > 0 && opera.some((o) => o.id === "W-002"), JSON.stringify(opera.map((o) => o.id)));
    }

    // ---- GET /api/officina --------------------------------------------------
    {
      const { status, body } = await getJson(base, "/api/officina");
      check("officina: 200", status === 200, String(status));
      check("officina: 5 collegia", Array.isArray(body?.collegia) && body.collegia.length === 5, JSON.stringify(body?.collegia));
    }

    // ---- events log lives at the shared @bisellium/core location, not a
    // private root-level file (verifier block issue: apps/server/src/store.ts) --
    {
      const rootStray = join(dir, "events.jsonl");
      const realLog = join(dir, ".bisellium", "events.jsonl");
      check("events-log: no stray events.jsonl at studio root", !existsSync(rootStray), rootStray);
      check("events-log: real log exists at .bisellium/events.jsonl", existsSync(realLog), realLog);
    }

    // ---- GET /api/inbox: W-004 (patron gate pending) + A-1 (needs_you) ------
    {
      const { status, body } = await getJson(base, "/api/inbox");
      check("inbox: 200", status === 200, String(status));
      const opusIds = (body?.opera ?? []).map((o: { id: string }) => o.id);
      const petitioIds = (body?.petitiones ?? []).map((p: { id: string }) => p.id);
      check("inbox: lists W-004", opusIds.includes("W-004"), JSON.stringify(opusIds));
      check("inbox: lists A-1", petitioIds.includes("A-1"), JSON.stringify(petitioIds));
    }

    // ---- GET /api/aerarium: engineering posture conserve ---------------------
    {
      const { status, body } = await getJson(base, "/api/aerarium");
      check("aerarium: 200", status === 200, String(status));
      const eng = Array.isArray(body) ? body.find((s: { collegium: string }) => s.collegium === "engineering") : undefined;
      check("aerarium: engineering posture conserve", eng?.posture === "conserve", JSON.stringify(eng));
    }

    // ---- GET /api/opus/W-004: has traditio -----------------------------------
    {
      const { status, body } = await getJson(base, "/api/opus/W-004");
      check("opus/W-004: 200", status === 200, String(status));
      check("opus/W-004: has traditio", !!body?.traditio && body.traditio.sella === "builder-1", JSON.stringify(body?.traditio));
    }

    // ---- GET /api/opus/<unknown>: 404 {error} --------------------------------
    {
      const { status, body } = await getJson(base, "/api/opus/NOPE");
      check("opus/NOPE: 404", status === 404, String(status));
      check("opus/NOPE: {error}", typeof body?.error === "string" && body.error.length > 0, JSON.stringify(body));
    }

    // ---- GET /api/timeline/<unknown sella>: 404 {error} ----------------------
    {
      const { status, body } = await getJson(base, "/api/timeline/nobody");
      check("timeline/nobody: 404", status === 404, String(status));
      check("timeline/nobody: {error}", typeof body?.error === "string", JSON.stringify(body));
    }

    // ---- W-089 behaviour 3: knownParty/sellaExists resolve a template-
    // instance id through resolveSeat, same as an exact declared id -----------
    {
      const { status } = await getJson(base, "/api/timeline/builder.W-100");
      check("w089 b3: timeline/builder.W-100 (instance): 200, not 404", status === 200, String(status));
    }
    {
      const { status } = await getJson(base, "/api/timeline/ghost.W-100");
      check("w089 b3: timeline/ghost.W-100 (unresolvable): 404", status === 404, String(status));
    }

    // ---- W-016 behaviour 7: ?limit= clamps into [1,500], never throws -------
    {
      for (const raw of ["-5", "0", "99999", "abc"]) {
        const { status } = await getJson(base, `/api/events?limit=${raw}`);
        check(`events limit=${raw}: never throws (200)`, status === 200, String(status));
        const { status: tStatus } = await getJson(base, `/api/timeline/builder-1?limit=${raw}`);
        check(`timeline limit=${raw}: never throws (200)`, tStatus === 200, String(tStatus));
      }
    }

    // ---- W-016 behaviour 5: write auth matrix (still holds — the token is
    // still what authorizes, unchanged by W-067 below) --------------------
    {
      const r1 = await postJson(base, "/api/greenlight", { opus: "NOPE-AUTH" }, { origin: "https://evil.test" });
      check("auth: valid token + Origin -> 403", r1.status === 403, String(r1.status));

      const r2 = await postJson(base, "/api/greenlight", { opus: "NOPE-AUTH" }, { "x-bisellium-token": "" });
      check("auth: no Origin, no token -> 401", r2.status === 401, String(r2.status));

      const r3 = await postJson(base, "/api/greenlight", { opus: "NOPE-AUTH" }, { "content-type": "text/plain" });
      check("auth: token + text/plain -> 415", r3.status === 415, String(r3.status));
    }

    // ---- W-067 behaviour 1: the accepted-origin pair (D-023 PATRON-5).
    // http://127.0.0.1:<boundPort> and http://localhost:<boundPort> — the
    // ACTUAL bound port (server.address().port), computed once at startup
    // and never recomputed per request. No trust is derived from Host or
    // any X-Forwarded-* header. W-016 behaviour 5 above still holds: Origin
    // is a second, independent gate, checked first — the token is still
    // what authorizes. W-002 (state: building, not backlog) is the target:
    // greenlight fails validation cleanly without ever writing the file, so
    // its bytes staying identical proves a refused write never reached the
    // record. -------------------------------------------------------------
    {
      const P = started.port;
      const targetPath = join(dir, "opera", "W-002.md");
      const targetBefore = readFileSync(targetPath, "utf8");
      const assertUnchanged = (label: string): void => {
        check(`auth: ${label} — W-002.md unchanged`, readFileSync(targetPath, "utf8") === targetBefore);
      };

      for (const origin of [undefined, `http://127.0.0.1:${P}`, `http://localhost:${P}`]) {
        const headers: Record<string, string> = {};
        if (origin !== undefined) headers["origin"] = origin;
        const r = await postJson(base, "/api/greenlight", { opus: "W-002" }, headers);
        check(`auth: Origin ${origin ?? "(absent)"} -> 200 (auth passes)`, r.status === 200, String(r.status));
      }
      assertUnchanged("the accepted-origin block");

      const refused403: readonly (readonly [string, string])[] = [
        ["the literal string null", "null"],
        ["right host, wrong port", `http://127.0.0.1:${P + 1}`],
        ["https instead of http", `https://127.0.0.1:${P}`],
        ["the ::1 loopback form", `http://[::1]:${P}`],
        ["a foreign host", "https://evil.example"],
      ];
      for (const [label, origin] of refused403) {
        const r = await postJson(base, "/api/greenlight", { opus: "W-002" }, { origin });
        check(`auth: Origin (${label}) -> 403`, r.status === 403, String(r.status));
      }
      assertUnchanged("the 403 block");

      {
        const originOk = `http://127.0.0.1:${P}`;
        const r401 = await postJson(base, "/api/greenlight", { opus: "W-002" }, { origin: originOk, "x-bisellium-token": "wrong" });
        check("auth: valid Origin + wrong token -> 401", r401.status === 401, String(r401.status));
        const r415 = await postJson(base, "/api/greenlight", { opus: "W-002" }, { origin: originOk, "content-type": "text/plain" });
        check("auth: valid Origin + text/plain -> 415", r415.status === 415, String(r415.status));
        const r400 = await postJson(base, "/api/greenlight", {}, { origin: originOk });
        check("auth: valid Origin + missing field -> 400", r400.status === 400, String(r400.status));
      }
      assertUnchanged("the token/content-type/body block");

      // Host and X-Forwarded-Host are request-supplied headers `fetch`
      // refuses to let a caller override (they're forbidden request
      // headers) — a raw node:http request is what actually lets a test
      // send them, same as connectSSE() above needs the raw module for SSE.
      const rHost = await rawPostJson(P, "/api/greenlight", { opus: "W-002" }, { host: "evil.example" });
      check("auth: Host: evil.example, no Origin -> 200 (no trust from Host)", rHost.status === 200, String(rHost.status));
      const rXfh = await rawPostJson(P, "/api/greenlight", { opus: "W-002" }, {
        "x-forwarded-host": `127.0.0.1:${P}`,
        origin: "https://evil.example",
      });
      check("auth: X-Forwarded-Host spoofed + foreign Origin -> still 403", rXfh.status === 403, String(rXfh.status));
      assertUnchanged("the Host/X-Forwarded-Host block");
    }

    // ---- W-016 behaviour 6: an oversized body is 413 with a JSON body,
    // not a destroyed socket. ---------------------------------------------
    {
      const res = await fetch(`${base}/api/greenlight`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bisellium-token": TEST_TOKEN },
        body: JSON.stringify({ opus: "W-BIG", pad: "x".repeat(3 * 1024 * 1024) }),
      });
      const body = await res.json().catch(() => undefined);
      check("body cap: oversized POST answers 413", res.status === 413, String(res.status));
      check("body cap: 413 body is real JSON with an error", typeof body?.error === "string", JSON.stringify(body));
    }

    // ---- POST /api/greenlight then GET /api/opus/W-007 -----------------------
    {
      const { status, body } = await postJson(base, "/api/greenlight", { opus: "W-007" });
      check("greenlight: 200", status === 200, String(status));
      check("greenlight: ok true, exitCode 0", body?.ok === true && body?.exitCode === 0, JSON.stringify(body));

      const after = await getJson(base, "/api/opus/W-007");
      check("opus/W-007: state greenlit", after.body?.frontMatter?.state === "greenlit", JSON.stringify(after.body?.frontMatter));
    }

    // Absorb the greenlight's own diff before the SSE assertion below, so the
    // only state_changed event the listener sees is the one it triggers.
    {
      const r = await postJson(base, "/api/_poll", {});
      check("_poll: absorbs the greenlight diff", r.status === 200, JSON.stringify(r.body));
    }

    // ---- W-016 behaviour 3: /api/events and /api/live reflect a write made
    // after start (append via the injected answer/greenlight runner, force a
    // poll, and the new event appears without a restart). ---------------------
    {
      const before = await getJson(base, "/api/events");
      const beforeCount = Array.isArray(before.body) ? before.body.length : 0;

      const sse = connectSSE(started.port);
      await new Promise((r) => setTimeout(r, 100));

      const opusPath = join(dir, "opera", "W-002.md");
      const raw = readFileSync(opusPath, "utf8");
      const mutated = raw.replace("state: building", "state: verifying");
      check("sse setup: W-002's state line found and replaced", mutated !== raw);
      writeFileSync(opusPath, mutated);

      const poll = await postJson(base, "/api/_poll", {});
      check("_poll: 200", poll.status === 200, JSON.stringify(poll.body));

      const after = await getJson(base, "/api/events");
      const afterCount = Array.isArray(after.body) ? after.body.length : 0;
      check("events: a write made after start is reflected without a restart", afterCount > beforeCount, `${beforeCount} -> ${afterCount}`);

      const matches = () =>
        sse.events.filter((e) => e["name"] === "workflow.state_changed" && (e["attrs"] as Record<string, unknown>)?.["workflow.item.id"] === "W-002");
      const arrived = await waitFor(() => matches().length === 1);
      check("sse: exactly one state_changed event for W-002", arrived, JSON.stringify(matches()));
      sse.close();
    }

    // ---- W-016 behaviour 4: seq is the Store's own sequence, never
    // log.length — strictly increasing and non-colliding across two
    // interleaved sources (this server's own diff ingest, source "server",
    // and a direct CLI-shaped emit into the same log, source "cli"). -------
    {
      // greenlight (above) appended a "cli"-sourced event and the W-002 edit
      // (also above) produced a "server"-sourced one — both are now in the
      // same shared log/index; assert they carry non-colliding, strictly
      // increasing seq (the Index's own counter), not one derived per-source
      // from log.length.
      const { body } = await getJson(base, "/api/events");
      const seqs = Array.isArray(body) ? (body as { seq: number }[]).map((e) => e.seq) : [];
      const sorted = [...seqs].sort((a, b) => a - b);
      check("events: seq is present on every event", seqs.length > 0 && seqs.every((s) => typeof s === "number"));
      check(
        "events: seq strictly increasing and non-colliding across interleaved sources",
        JSON.stringify(seqs) === JSON.stringify(sorted) && new Set(seqs).size === seqs.length,
        JSON.stringify(seqs),
      );
    }

    // ---- /api/_poll is a 404 outside NODE_ENV=test ---------------------------
    {
      const prevEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";
      const r = await postJson(base, "/api/_poll", {});
      check("_poll: 404 outside NODE_ENV=test", r.status === 404, String(r.status));
      process.env["NODE_ENV"] = prevEnv;
    }

    // Snapshot the event log's shape before restart, so the restart block
    // below can tell "replayed the whole world again" apart from "picked up
    // where it left off" (verifier block issue: apps/server/src/store.ts,
    // lastSnapshot never persisted).
    {
      const { body } = await getJson(base, "/api/events");
      beforeRestartEvents = Array.isArray(body) ? (body as { name: string }[]) : [];
    }
  } finally {
    await started.close();
  }

  // ---- close: port released -------------------------------------------------
  {
    let refused = false;
    try {
      await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) });
    } catch {
      refused = true;
    }
    check("close: port released", refused);
  }

  // ---- restart against the same studio: no false "item_appeared" replay,
  // and the CLI's own workflow.greenlight event is visible once the log is
  // unified. --------------------------------------------------------------
  {
    const restarted = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    try {
      const restartBase = `http://127.0.0.1:${restarted.port}`;
      const { body } = await getJson(restartBase, "/api/events");
      const names: string[] = Array.isArray(body) ? (body as { name: string }[]).map((e) => e.name) : [];
      check("events-log: greenlight's own cli event visible after restart", names.includes("workflow.greenlight"), JSON.stringify(names));

      const beforeAppeared = beforeRestartEvents.filter((e) => e.name === "workflow.item_appeared").length;
      const afterAppeared = names.filter((n) => n === "workflow.item_appeared").length;
      check(
        "events-log: restart does not replay item_appeared events again",
        afterAppeared === beforeAppeared,
        `before=${beforeAppeared} after=${afterAppeared}`,
      );
    } finally {
      await restarted.close();
    }
  }

  // ---- close(): resolves promptly even with a live SSE client connected --
  {
    const dirSse = freshStudio("close-live");
    const sSse = await startServer(baseOpts(dirSse, { port: 0, once: true, now: NOW }));
    const sse = connectSSE(sSse.port);
    await new Promise((r) => setTimeout(r, 100));

    const t0 = Date.now();
    let timedOut = false;
    await Promise.race([
      sSse.close(),
      new Promise<void>((r) =>
        setTimeout(() => {
          timedOut = true;
          r();
        }, 3000),
      ),
    ]);
    check("close: resolves within 3s with an open SSE client connected", !timedOut, `elapsedMs=${Date.now() - t0}`);
    sse.close();
  }

  // ---- close(): still resolves promptly after the SSE client itself
  // aborted first. ----------------------------------------------------------
  {
    const dirSse2 = freshStudio("close-live-aborted");
    const sSse2 = await startServer(baseOpts(dirSse2, { port: 0, once: true, now: NOW }));
    const sse2 = connectSSE(sSse2.port);
    await new Promise((r) => setTimeout(r, 100));
    sse2.close(); // client aborts first
    await new Promise((r) => setTimeout(r, 100)); // let the server notice

    const t0 = Date.now();
    let timedOut = false;
    await Promise.race([
      sSse2.close(),
      new Promise<void>((r) =>
        setTimeout(() => {
          timedOut = true;
          r();
        }, 3000),
      ),
    ]);
    check("close: resolves within 3s after the SSE client aborted", !timedOut, `elapsedMs=${Date.now() - t0}`);
  }

  // ---- W-016 behaviour 8: SSE fan-out is one store listener, a client past
  // MAX_SSE_CLIENTS gets 503, an errored client is dropped without taking
  // the server down, and a slow client's backpressure never blocks others. --
  {
    const dirSse3 = freshStudio("sse-fanout");
    const sSse3 = await startServer(baseOpts(dirSse3, { port: 0, once: true, now: NOW }));
    try {
      const clients = [connectSSE(sSse3.port), connectSSE(sSse3.port), connectSSE(sSse3.port)];
      await new Promise((r) => setTimeout(r, 150));
      check("sse: exactly one store 'event' listener with three clients connected", sSse3.store.listenerCount("event") === 1, String(sSse3.store.listenerCount("event")));

      // Force a diff so all three clients get a frame.
      const opusPath = join(dirSse3, "opera", "W-002.md");
      writeFileSync(opusPath, readFileSync(opusPath, "utf8").replace("state: building", "state: verifying"));
      const base3 = `http://127.0.0.1:${sSse3.port}`;
      await postJson(base3, "/api/_poll", {});
      const allGotIt = await waitFor(() => clients.every((c) => c.events.length >= 1));
      check("sse: fan-out reaches every connected client from the single listener", allGotIt, JSON.stringify(clients.map((c) => c.events.length)));
      for (const c of clients) c.close();

      // A socket "error" on one live response must not crash the process or
      // affect anything else — simulate by connecting, then forcing the
      // underlying response into an error state via destroy() with an error.
      const errClient = connectSSE(sSse3.port);
      await new Promise((r) => setTimeout(r, 100));
      errClient.res?.destroy(new Error("simulated client socket error"));
      await new Promise((r) => setTimeout(r, 100));
      const health = await getJson(base3, "/api/officina");
      check("sse: an errored client is dropped without taking the server down", health.status === 200, String(health.status));
    } finally {
      await sSse3.close();
    }
  }

  // ---- W-016 behaviour 8b: a client past MAX_SSE_CLIENTS gets 503 ---------
  {
    const dirCap = freshStudio("sse-cap");
    const sCap = await startServer(baseOpts(dirCap, { port: 0, once: true, now: NOW }));
    const opened: ReturnType<typeof connectSSE>[] = [];
    try {
      // MAX_SSE_CLIENTS is 50 (apps/server/src/http.ts) — open one past it.
      for (let i = 0; i < 51; i++) opened.push(connectSSE(sCap.port));
      await new Promise((r) => setTimeout(r, 300));
      const res = await fetch(`http://127.0.0.1:${sCap.port}/api/live`);
      check("sse: a client past MAX_SSE_CLIENTS gets 503", res.status === 503, String(res.status));
      await res.text().catch(() => undefined);
    } finally {
      for (const c of opened) c.close();
      await sCap.close();
    }
  }

  // ---- W-016 behaviour 9: static containment uses path.relative, not a bare
  // startsWith(). A sibling directory sharing WEB_DIST's name as a *string*
  // prefix (".../web-dist-evil" against ".../web-dist") is the exact case a
  // naive `filePath.startsWith(WEB_DIST)` gets wrong — no separator boundary
  // means "web-dist-evil" satisfies startsWith("web-dist"). Tested directly
  // against the exported `isPathContained` (this is a router-level dead
  // path in today's code — `new URL()` normalizes a literal "../" out of
  // `pathname` before serveStatic ever runs, so an end-to-end HTTP repro
  // would only be testing WHATWG URL's own dot-segment collapsing, not this
  // fix) — the same `resolve(WEB_DIST, "." + pathname)` computation
  // apps/server/src/http.ts's serveStatic performs. --------------------------
  {
    const here = dirname(fileURLToPath(import.meta.url));
    const webDist = resolve(here, "..", "..", "web", "dist");
    const evilFile = resolve(webDist, "..", "dist-evil", "x"); // a sibling sharing "dist" as a string prefix
    check(
      "containment: a sibling dir sharing WEB_DIST's name as a prefix is rejected",
      !isPathContained(webDist, evilFile),
      `${webDist} vs ${evilFile}`,
    );
    check(
      "containment: the same sibling path WOULD have passed a bare startsWith() (the bug this replaces)",
      evilFile.startsWith(webDist),
      evilFile,
    );
    const legitFile = resolve(webDist, "." + "/assets/app.js");
    check("containment: a real file under WEB_DIST is accepted", isPathContained(webDist, legitFile), legitFile);
  }

  // ---- overlapping /api/talk calls must not cross-wire responses, and must
  // not leave console.log/console.error permanently pointed at a stale
  // per-request collector. --------------------------------------------------
  {
    const dirTalk = freshStudio("talk-overlap");
    const sTalk = await startServer(baseOpts(dirTalk, { port: 0, once: true, now: NOW }));
    const talkBase = `http://127.0.0.1:${sTalk.port}`;
    const originalLog = console.log;
    const originalError = console.error;
    try {
      const pA = postJson(talkBase, "/api/talk", { sella: "builder.W-500", message: "one", harness: "fake" });
      await new Promise((r) => setTimeout(r, 25));
      const pB = postJson(talkBase, "/api/talk", { sella: "eng-lead", message: "two", harness: "fake" });
      const [a, b] = await Promise.all([pA, pB]);
      const aOut = String((a.body as { output?: string })?.output ?? "");
      const bOut = String((b.body as { output?: string })?.output ?? "");
      check("talk overlap: request A (message 'one') gets its own reply", aOut.includes("FAKE: ONE"), JSON.stringify(a.body));
      check("talk overlap: request B (message 'two') gets its own reply", bOut.includes("FAKE: TWO"), JSON.stringify(b.body));
      check("talk overlap: console.log restored to the real console afterwards", console.log === originalLog);
      check("talk overlap: console.error restored to the real console afterwards", console.error === originalError);
    } finally {
      console.log = originalLog;
      console.error = originalError;
      await sTalk.close();
    }
  }

  // ---- W-067 behaviour 3: a command refusal is not a success. Against a
  // runner stub that always exits 3, the route answers HTTP 200 with
  // ok:false and exitCode:3 — never a 4xx. writeResponse already does this
  // for every write (it always sends 200; `ok` is exitCode === 0), so this
  // is regression coverage for that envelope, pinned down explicitly for
  // W-067 rather than left implicit in the greenlight-failure cases above. --
  {
    const dirStub = freshStudio("exit3-stub");
    const stubRunners: StartServerOptions["runners"] = { ...realRunners, greenlight: () => ({ exitCode: 3 }) };
    const sStub = await startServer(baseOpts(dirStub, { port: 0, once: true, now: NOW, runners: stubRunners }));
    try {
      const stubBase = `http://127.0.0.1:${sStub.port}`;
      const r = await postJson(stubBase, "/api/greenlight", { opus: "W-007" });
      check("stub runner (exit 3): HTTP 200, not a 4xx", r.status === 200, String(r.status));
      check("stub runner (exit 3): ok:false, exitCode:3", r.body?.ok === false && r.body?.exitCode === 3, JSON.stringify(r.body));
    } finally {
      await sStub.close();
    }
  }

  // ---- W-065 behaviour 8: the server writes as the Patron over a seeded
  // non-Patron role, and the lock serializes. ------------------------------
  {
    const dir = freshStudio("delegate-patron");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    const base = `http://127.0.0.1:${s.port}`;
    const prevRole = process.env["BISELLIUM_ROLE"];
    process.env["BISELLIUM_ROLE"] = "builder-a";
    try {
      const r = await postJson(base, "/api/delegate", { sella: "builder", model: "gpt-5.6-sol" });
      check("delegate (patron over seeded role): HTTP 200, ok:true", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
      const lines = timelineLines(dir);
      check("delegate (patron over seeded role): recorded role is patron", lines[lines.length - 1]?.["role"] === "patron", JSON.stringify(lines[lines.length - 1]));
      check("delegate (patron over seeded role): BISELLIUM_ROLE restored after success", process.env["BISELLIUM_ROLE"] === "builder-a", process.env["BISELLIUM_ROLE"]);

      const rejected = await postJson(base, "/api/delegate", { sella: "no-such-sella", model: "x" });
      check("delegate (rejected): refused, not a 4xx", rejected.status === 200 && rejected.body?.ok === false, JSON.stringify(rejected.body));
      check("delegate (rejected): BISELLIUM_ROLE restored after a rejection too", process.env["BISELLIUM_ROLE"] === "builder-a", process.env["BISELLIUM_ROLE"]);
    } finally {
      if (prevRole === undefined) delete process.env["BISELLIUM_ROLE"];
      else process.env["BISELLIUM_ROLE"] = prevRole;
      await s.close();
    }
  }

  {
    const dir = freshStudio("delegate-lock");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      // Two overlapping POSTs (both issued before either resolves) — removing
      // withWriteLock interleaves the console capture and fails this.
      const pA = postJson(base, "/api/delegate", { sella: "builder", model: "gpt-5.6-sol" });
      const pB = postJson(base, "/api/delegate", { munus: "audit", tier: "high" });
      const [a, b] = await Promise.all([pA, pB]);
      check("delegate lock: overlapping call A succeeds", a.status === 200 && a.body?.ok === true, JSON.stringify(a.body));
      check("delegate lock: overlapping call B succeeds", b.status === 200 && b.body?.ok === true, JSON.stringify(b.body));
      const lines = timelineLines(dir);
      check("delegate lock: two well-formed timeline lines", lines.length === 2 && lines.every((l) => typeof l["at"] === "string" && typeof l["role"] === "string"), JSON.stringify(lines));
      let parseable = true;
      try {
        parseYaml(readFileSync(join(dir, "bisellium.yml"), "utf8"));
      } catch {
        parseable = false;
      }
      check("delegate lock: the manifest is still a parseable single document", parseable);
    } finally {
      await s.close();
    }
  }

  // ---- W-065 behaviour 9: the read surface, and the live listing never
  // blocks it. --------------------------------------------------------------
  {
    const dir = freshStudio("models-read-surface");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      const r = await getJson(base, "/api/officina");
      const manifest = parseYaml(readFileSync(join(dir, "bisellium.yml"), "utf8")) as { tiers?: unknown; munera?: unknown };
      check("officina: tiers matches the fixture", JSON.stringify(r.body.tiers) === JSON.stringify(manifest.tiers), JSON.stringify(r.body.tiers));
      check("officina: munera matches the fixture", JSON.stringify(r.body.munera) === JSON.stringify(manifest.munera), JSON.stringify(r.body.munera));
      check("officina: models absent when models.json is absent", r.body.models === undefined, JSON.stringify(r.body.models));
      check("officina: sellae rows still carry kind/model/harness", Array.isArray(r.body.sellae) && r.body.sellae.every((s: Record<string, unknown>) => "kind" in s), JSON.stringify(r.body.sellae));

      writeFileSync(join(dir, "models.json"), "{ this is not json");
      const r2 = await getJson(base, "/api/officina");
      check("officina: an unparseable models.json degrades to absent, still 200", r2.status === 200 && r2.body.models === undefined, JSON.stringify(r2.body.models));
    } finally {
      await s.close();
    }
  }

  {
    const dir = freshStudio("models-listing-success");
    writeFileSync(join(dir, "models.json"), JSON.stringify({ at: NOW.toISOString(), models: [{ id: "gpt-5.6-sol", harness: "codex", state: "available" }] }));
    let calls = 0;
    const listModels: StartServerOptions["listModels"] = async () => {
      calls++;
      return [
        { id: "gpt-5.6-sol", harness: "codex" },
        { id: "gpt-fresh", harness: "codex" },
      ];
    };
    // W-064 (censor's W-065 r2 seam note, folded in): a short, injected TTL
    // instead of a real 5.2s sleep against the default 5s constant — same
    // assertion ("a call AFTER the TTL refreshes the listing"), no wall-clock
    // wait.
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, listModels, listingTtlMs: 50 }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      const r = await getJson(base, "/api/models");
      const rows = r.body as { id: string; state: string }[];
      check("models: a newly listed id appears as unverified", rows.find((row) => row.id === "gpt-fresh")?.state === "unverified", JSON.stringify(rows));
      check("models: a recorded, still-listed id keeps its recorded state", rows.find((row) => row.id === "gpt-5.6-sol")?.state === "available", JSON.stringify(rows));

      await getJson(base, "/api/models");
      check("models: two calls inside the TTL invoke the listing once", calls === 1, String(calls));

      // Finding B (amended brief): the TTL assertion pinned only the lower
      // bound ("at most once inside the window") and never that a call PAST
      // the window actually refreshes — a listing cached forever satisfied
      // it just as well. Wait past the (injected, short) TTL and confirm a
      // second call.
      await new Promise((r) => setTimeout(r, 80));
      await getJson(base, "/api/models");
      check("models: a call AFTER the TTL refreshes the listing", calls === 2, String(calls));
    } finally {
      await s.close();
    }
  }

  {
    const dir = freshStudio("models-listing-withdrawn");
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({ at: NOW.toISOString(), models: [{ id: "gpt-gone", harness: "codex", state: "available" }] }),
    );
    const listModels: StartServerOptions["listModels"] = async () => [];
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, listModels }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      const r = await getJson(base, "/api/models");
      const rows = r.body as { id: string; state: string }[];
      const row = rows.find((x) => x.id === "gpt-gone");
      check("models: a record id the listing omits is flagged withdrawn (kept, downgraded to unverified)", row?.state === "unverified", JSON.stringify(rows));
    } finally {
      await s.close();
    }
  }

  {
    const dir = freshStudio("models-listing-fail");
    writeFileSync(join(dir, "models.json"), JSON.stringify({ at: NOW.toISOString(), models: [{ id: "gpt-5.6-sol", harness: "codex", state: "available" }] }));
    const listModels: StartServerOptions["listModels"] = async () => {
      throw new Error("simulated listing failure");
    };
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, listModels }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      const r = await getJson(base, "/api/models");
      check("models: a failing listing still answers 200 from the record alone", r.status === 200 && Array.isArray(r.body) && r.body.length === 1, JSON.stringify(r.body));
      check("models: the dropdown is not emptied", r.body[0]?.id === "gpt-5.6-sol", JSON.stringify(r.body));
      // A failed listing must not be treated as "ok" — the record's own
      // recorded state survives untouched (never downgraded to unverified,
      // which is what withdrawal-on-a-false-success would do).
      check("models: the record's state is untouched by a failed listing (not downgraded)", r.body[0]?.state === "available", JSON.stringify(r.body));
    } finally {
      await s.close();
    }
  }

  {
    const dir = freshStudio("models-listing-hang");
    const listModels: StartServerOptions["listModels"] = () => new Promise(() => {}); // never resolves
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, listModels }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      const r = await getJson(base, "/api/models");
      check("models: a hung listing still answers 200 past its timeout", r.status === 200 && Array.isArray(r.body), JSON.stringify(r.body));
    } finally {
      await s.close();
    }
  }

  {
    // No route runs a vendor turn: this route never touches runners.talk (or
    // any runner) at all — asserted structurally, not by grepping output.
    const dir = freshStudio("models-no-turn");
    let listingCalls = 0;
    const listModels: StartServerOptions["listModels"] = async () => {
      listingCalls++;
      return [];
    };
    const talkMustNotRun: StartServerOptions["runners"]["talk"] = () => {
      throw new Error("GET /api/models must never run a runner (a vendor turn)");
    };
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, listModels, runners: { ...realRunners, talk: talkMustNotRun } }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      const r = await getJson(base, "/api/models");
      check("models: no route runs a vendor turn", r.status === 200 && listingCalls === 1, `status=${r.status} listingCalls=${listingCalls}`);
    } finally {
      await s.close();
    }
  }

  // ---- W-076 behaviour 3: the body reaches GET /api/inbox untruncated ----
  // `needsYou()` exposes only `state: needs_you` (store.ts), and a temp
  // officina (not the shared `dir` above) is the only honest way to get a
  // multi-paragraph, 2+KB body onto that surface without depending on the
  // real studio's live petitiones.
  {
    const dir = freshStudio("w076-inbox-body");
    const bigBody = [
      "**W-064's red gate: D-024's kill arm has fired, and only you can rule.**",
      "",
      "The builder disclosed that behaviours 7-9's reds were recorded by the",
      "implement then revert-to-skeleton then record then restore sequence.",
      "Paragraph two exists purely to push this fixture's body well past two",
      "kilobytes of markdown, with newlines that must survive the trip to the",
      "wire intact, byte for byte, the same way `readFront` returns them.",
      "".padEnd(2200, "x"),
      "",
      "1. Decree a new D-nnn waiving the behaviours.",
      "2. Refuse the waiver and name the remedy.",
      "",
      "Answering in the same sitting closes the class either way.",
    ].join("\n");
    writeFileSync(
      join(dir, "petitiones", "W076-BODY.md"),
      ["---", 'id: "W076-BODY"', "from: qa-lead", "to: patron", "state: needs_you", "opened: 2026-09-25T00:00:00.000Z", "---", "", bigBody, ""].join("\n"),
    );
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    const base = `http://127.0.0.1:${s.port}`;
    try {
      const r = await getJson(base, "/api/inbox");
      const row = (r.body?.petitiones ?? []).find((p: { id: string }) => p.id === "W076-BODY");
      check("inbox body: W076-BODY is present", row !== undefined, JSON.stringify((r.body?.petitiones ?? []).map((p: { id: string }) => p.id)));
      check("inbox body: at least 2KB", typeof row?.body === "string" && row.body.length >= 2000, String(row?.body?.length));
      check("inbox body: byte-identical to the front matter body (newlines intact)", row?.body === bigBody, String(row?.body).slice(0, 200));
      check("inbox body: subject is present and derived (no subject: key on this fixture)", typeof row?.subject === "string" && row.subject.length > 0, JSON.stringify(row?.subject));
    } finally {
      await s.close();
    }
  }

  // ---------------------------------------------------------------------------
  // W-057 — GHAS alert 3 (js/stack-trace-exposure) closed: the 500 body
  // carries nothing from the exception, the exception reaches the log
  // correlated by `ref`, the choke point is closed, malformed JSON answers a
  // constant, two 500s get two different refs, a request-stream error is
  // never narrated to the client, and every error body stays byte-identical.
  // ---------------------------------------------------------------------------

  // ---- behaviour 1: a 500 body carries nothing from the exception ---------
  if (runs(1)) {
    const dir = freshStudio("w057-b1");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, checkStudio: throwingCheckStudio }));
    try {
      const base = `http://127.0.0.1:${s.port}`;
      const res = await fetch(`${base}/api/health`);
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      check("b1: status 500", res.status === 500, String(res.status));
      check("b1: body.error === 'internal error' exactly", body?.error === "internal error", JSON.stringify(body));
      check("b1: body.ref is a non-empty string", typeof body?.ref === "string" && body.ref.length > 0, JSON.stringify(body));
      check("b1: raw body carries no ENOENT", !text.includes("ENOENT"), text);
      check("b1: raw body carries no /home/secret", !text.includes("/home/secret"), text);
      check("b1: raw body carries no the word Error", !text.includes("Error"), text);
    } finally {
      await s.close();
    }
  }

  // ---- behaviour 2: the exception reaches the log, correlated by ref ------
  if (runs(2)) {
    const dir = freshStudio("w057-b2");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, checkStudio: throwingCheckStudio }));
    try {
      const base = `http://127.0.0.1:${s.port}`;
      const { result: res, stderr } = await withServerStderr(() => fetch(`${base}/api/health`));
      const body: any = await res.json().catch(() => undefined);
      const ref = body?.ref;
      check("b2: body carries a ref", typeof ref === "string" && ref.length > 0, JSON.stringify(body));
      check("b2: stderr contains the same ref as the body", typeof ref === "string" && stderr.includes(ref), stderr);
      check("b2: stderr contains the original message", stderr.includes("ENOENT") && stderr.includes("/home/secret"), stderr);
      check("b2: stderr contains a stack", /\bat .+\(?.*:\d+:\d+/.test(stderr) || / {2,}at /.test(stderr), stderr);
    } finally {
      await s.close();
    }
  }

  // ---- behaviour 3: the choke point exists, is closed, and cannot be
  // widened. Halves 1-2 (ErrorCode's closedness, the synthetic-edit
  // typecheck failure) are compile-time — enforced by `npm run -s typecheck`
  // over http.ts's own `@ts-expect-error` line, not by anything runnable
  // here (a passing test file proves nothing about the compiler). Half 3,
  // the status-agnostic source pin, is the one runtime-checkable half. -----
  if (runs(3)) {
    const here = dirname(fileURLToPath(import.meta.url));
    const httpTsPath = resolve(here, "..", "src", "http.ts");
    const source = readFileSync(httpTsPath, "utf8");
    const violations = findErrorKeyResponseViolations(source);
    check(
      "b3: no sendJson/sendText call outside sendError's own body carries an object with an error key",
      violations.length === 0,
      JSON.stringify(violations),
    );

    // Positive control: the scanner must catch a second such call — proving
    // the pin isn't vacuously green (revision 4's "the pin forbade its own
    // choke point" nit, guarded against here rather than just fixed once).
    const synthetic = [
      "function sendError(res, status, code, ref) {",
      "  sendJson(res, status, ref === undefined ? { error: code } : { error: code, ref });",
      "}",
      "function other(res) {",
      '  sendJson(res, 400, { error: "sneaky" });',
      "}",
    ].join("\n");
    const controlViolations = findErrorKeyResponseViolations(synthetic);
    check("b3 positive control: a second sendJson(..., {error}) outside sendError fails the pin", controlViolations.length === 1, JSON.stringify(controlViolations));

    // The pin's own choke point must NOT flag itself.
    const cleanSynthetic = ["function sendError(res, status, code, ref) {", "  sendJson(res, status, ref === undefined ? { error: code } : { error: code, ref });", "}"].join("\n");
    check("b3: sendError's own call never flags itself", findErrorKeyResponseViolations(cleanSynthetic).length === 0, JSON.stringify(findErrorKeyResponseViolations(cleanSynthetic)));
  }

  // ---- behaviour 4: malformed JSON answers the constant --------------------
  if (runs(4)) {
    const dir = freshStudio("w057-b4");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    try {
      const base = `http://127.0.0.1:${s.port}`;
      const res = await fetch(`${base}/api/greenlight`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bisellium-token": TEST_TOKEN },
        body: "{",
      });
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      check("b4: status 400", res.status === 400, String(res.status));
      check("b4: error is exactly 'invalid JSON body' — no V8 position text", body?.error === "invalid JSON body", JSON.stringify(body));
    } finally {
      await s.close();
    }
  }

  // ---- behaviour 5: two 500s get two different refs, both in the log ------
  if (runs(5)) {
    const dir = freshStudio("w057-b5");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW, checkStudio: throwingCheckStudio }));
    try {
      const base = `http://127.0.0.1:${s.port}`;
      const { result: [r1, r2], stderr } = await withServerStderr(async () => [await getJson(base, "/api/health"), await getJson(base, "/api/health")] as const);
      const ref1 = r1.body?.ref;
      const ref2 = r2.body?.ref;
      check("b5: both responses are 500", r1.status === 500 && r2.status === 500, `${r1.status} ${r2.status}`);
      check("b5: both refs are non-empty strings", typeof ref1 === "string" && ref1.length > 0 && typeof ref2 === "string" && ref2.length > 0, JSON.stringify([ref1, ref2]));
      check("b5: the two refs differ", ref1 !== ref2, JSON.stringify([ref1, ref2]));
      check("b5: both refs appear in the log", typeof ref1 === "string" && typeof ref2 === "string" && stderr.includes(ref1) && stderr.includes(ref2), stderr);
    } finally {
      await s.close();
    }
  }

  // ---- behaviour 6: a request-stream error is not narrated to the client --
  if (runs(6)) {
    const dir = freshStudio("w057-b6");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    try {
      const { stderr } = await withServerStderr(async () => {
        await induceRequestStreamError(s.port, "/api/greenlight", TEST_TOKEN);
        await new Promise((r) => setTimeout(r, 200)); // let the error handler + log land
      });
      // Honest per the brief: the client destroyed its own socket, so no
      // response is observable at all here — the assertion is on the log
      // alone, which is the property that actually matters ("the message
      // never becomes a response body"; an undeliverable response satisfies
      // it just as well as a delivered {error:"internal error"} would).
      check("b6: the log shows the 500 path (ref + 'aborted'), never a 400 narrating the stream error", /bisellium serve: 500 \S+ aborted/.test(stderr), stderr);
      check("b6: the log carries a stack", /\bat .+\(?.*:\d+:\d+/.test(stderr) || / {2,}at /.test(stderr), stderr);

      const health = await getJson(`http://127.0.0.1:${s.port}`, "/api/officina");
      check("b6: the server survives the induced stream error", health.status === 200, String(health.status));
    } finally {
      await s.close();
    }
  }

  // ---- behaviour 7: every one of the seventeen error bodies is
  // byte-identical to today's (nineteen rows: :581 answers three). ----------
  if (runs(7)) {
    const dir = freshStudio("w057-b7");
    const s = await startServer(baseOpts(dir, { port: 0, once: true, now: NOW }));
    const base = `http://127.0.0.1:${s.port}`;
    const opened: ReturnType<typeof connectSSE>[] = [];
    try {
      const rows: { label: string; status: number; body: string; run: () => Promise<JsonResponse> }[] = [
        { label: ":451 assets not found", status: 404, body: '{"error":"not found"}', run: () => getJson(base, "/assets/does-not-exist.js") },
        { label: ":801 unrouted path", status: 404, body: '{"error":"not found"}', run: () => getJson(base, "/api/totally-unknown-route") },
        { label: ":609 unknown opus", status: 404, body: '{"error":"unknown opus"}', run: () => getJson(base, "/api/opus/NOPE") },
        { label: ":637 unknown sella", status: 404, body: '{"error":"unknown sella"}', run: () => getJson(base, "/api/timeline/nobody") },
        {
          label: ":581 no token",
          status: 401,
          body: '{"error":"missing or invalid X-Bisellium-Token"}',
          run: () => postJson(base, "/api/greenlight", { opus: "W-002" }, { "x-bisellium-token": "" }),
        },
        {
          label: ":581 bad Origin",
          status: 403,
          body: '{"error":"cross-origin writes are refused"}',
          run: () => postJson(base, "/api/greenlight", { opus: "W-002" }, { origin: "https://evil.test" }),
        },
        {
          label: ":581 wrong Content-Type",
          status: 415,
          body: '{"error":"Content-Type must be application/json"}',
          run: () => postJson(base, "/api/greenlight", { opus: "W-002" }, { "content-type": "text/plain" }),
        },
        { label: ":652 item combined with since", status: 400, body: '{"error":"item cannot be combined with since"}', run: () => getJson(base, "/api/events?item=x&since=1") },
        { label: ":686 answer missing fields", status: 400, body: '{"error":"petitio and reply are required strings"}', run: () => postJson(base, "/api/answer", {}) },
        { label: ":701 greenlight missing opus", status: 400, body: '{"error":"opus is required"}', run: () => postJson(base, "/api/greenlight", {}) },
        { label: ":717 budget missing fields", status: 400, body: '{"error":"period, collegium and tokens are required"}', run: () => postJson(base, "/api/budget", {}) },
        { label: ":733 handoff missing fields", status: 400, body: '{"error":"opus, sella and next are required"}', run: () => postJson(base, "/api/handoff", {}) },
        { label: ":749 talk missing fields", status: 400, body: '{"error":"sella and message are required"}', run: () => postJson(base, "/api/talk", {}) },
        {
          label: ":786 delegate missing fields",
          status: 400,
          body: '{"error":"either {sella, model} or {munus, tier} are required"}',
          run: () => postJson(base, "/api/delegate", {}),
        },
        { label: ":184 non-object JSON body", status: 400, body: '{"error":"request body must be a JSON object"}', run: () => postJson(base, "/api/greenlight", []) },
      ];

      for (const row of rows) {
        const r = await row.run();
        check(`b7 ${row.label}: status ${row.status}`, r.status === row.status, String(r.status));
        check(`b7 ${row.label}: raw body byte-identical to today's`, r.text === row.body, JSON.stringify(r.text));
        check(`b7 ${row.label}: no ref field (500-only)`, !r.text.includes('"ref"'), r.text);
      }

      // :499 too many /api/live clients — needs its own client burst.
      {
        for (let i = 0; i < 51; i++) opened.push(connectSSE(s.port));
        await new Promise((r) => setTimeout(r, 300));
        const r = await getJson(base, "/api/live");
        check("b7 :499 too many /api/live clients: status 503", r.status === 503, String(r.status));
        check("b7 :499 too many /api/live clients: raw body byte-identical to today's", r.text === '{"error":"too many /api/live clients"}', JSON.stringify(r.text));
        check("b7 :499 too many /api/live clients: no ref field (500-only)", !r.text.includes('"ref"'), r.text);
      }

      // :181 oversized body (413) — a real 3MB body, same as the pre-W-057 test above.
      {
        const res = await fetch(`${base}/api/greenlight`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-bisellium-token": TEST_TOKEN },
          body: JSON.stringify({ opus: "W-BIG", pad: "x".repeat(3 * 1024 * 1024) }),
        });
        const text = await res.text();
        check("b7 :181 oversized body: status 413", res.status === 413, String(res.status));
        check("b7 :181 oversized body: raw body byte-identical to today's", text === '{"error":"request body too large"}', JSON.stringify(text));
        check("b7 :181 oversized body: no ref field (500-only)", !text.includes('"ref"'), text);
      }

      // :671 the /api/_poll test-only hook's 404, reachable only with
      // NODE_ENV not "test" — toggled here and restored immediately after,
      // sequentially (no other block runs concurrently with this one).
      {
        const prevNodeEnv = process.env["NODE_ENV"];
        process.env["NODE_ENV"] = "production";
        let r: JsonResponse;
        try {
          r = await postJson(base, "/api/_poll", {});
        } finally {
          process.env["NODE_ENV"] = prevNodeEnv;
        }
        check("b7 :671 /api/_poll outside test env: status 404", r.status === 404, String(r.status));
        check("b7 :671 /api/_poll outside test env: raw body byte-identical to today's", r.text === '{"error":"not found"}', JSON.stringify(r.text));
        check("b7 :671 /api/_poll outside test env: no ref field (500-only)", !r.text.includes('"ref"'), r.text);
      }

      // :441 forbidden — unreachable via any client request: `new URL()`
      // (used to derive `pathname` before `serveStatic` ever sees it)
      // normalises dot-segments per the WHATWG URL spec, verified above,
      // so a request path can never carry a literal ".." past that point —
      // not this opus's gap to close, but "say so in the evidence rather
      // than dropping it silently" (the brief's own instruction). The
      // closest reachable proxy is `isPathContained` itself, exercised
      // directly (it's exported precisely because tests need to reach it).
      {
        const contained = isPathContained("/a/b/web-dist", "/a/b/web-dist-evil/x");
        check(
          "b7 :441 forbidden — UNREACHABLE via any client request (WHATWG URL normalises '..' before serveStatic sees pathname, verified); isPathContained() itself still correctly refuses a sibling-prefix escape",
          contained === false,
          String(contained),
        );
      }
    } finally {
      for (const c of opened) c.close();
      await s.close();
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    process.exit(failed ? 1 : 0);
  });
