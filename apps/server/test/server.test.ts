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
import { runAnswer, runGreenlight, runBudget, runHandoff } from "@bisellium/commands/writes.js";
import { runTalk } from "@bisellium/commands/talk.js";
import { runPause, runResume } from "@bisellium/commands/pause.js";
import { startServer, isPathContained, type StartServerOptions } from "../src/index.js";

process.env["NODE_ENV"] = "test";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T17:00:00Z");
const TEST_TOKEN = "test-token-w016";

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
};

function baseOpts(studioDir: string, extra: Partial<StartServerOptions> = {}): StartServerOptions {
  return { studioDir, checkStudio: fakeCheckStudio, runners: realRunners, token: TEST_TOKEN, ...extra };
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
  return { status: res.status, body };
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
  return { status: res.status, body };
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
          resolvePromise({ status: res.statusCode ?? 0, body: parsedBody });
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

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
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
      const pA = postJson(talkBase, "/api/talk", { sella: "builder-1", message: "one", harness: "fake" });
      await new Promise((r) => setTimeout(r, 25));
      const pB = postJson(talkBase, "/api/talk", { sella: "builder-2", message: "two", harness: "fake" });
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
