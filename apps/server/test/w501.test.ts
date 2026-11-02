/**
 * apps/server/test/w501.test.ts — W-501: the console refuses DNS-rebinding reads. A page served from a foreign name that
 * re-resolves to 127.0.0.1 reaches this socket with its own name in `Host`; every request whose Host is not the bound
 * loopback authority is refused (row b1), and every GET under /api/ needs the session token (row b2). node:test TAP;
 * a row is selected by `--test-name-pattern='^W-501-b<n>\s'`. Raw node:http requests, since `fetch` cannot set or drop
 * `Host` (a forbidden request header). The fixture is a copy of examples/sample-studio under the OS tmp dir.
 *
 * Run from the repo root:
 *   node --test-reporter=tap --import tsx apps/server/test/w501.test.ts
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { startServer, type StartServerOptions } from "../src/index.js";

process.env["NODE_ENV"] = "test";

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples", "sample-studio");
const NOW = new Date("2026-09-18T17:00:00Z");
const TOKEN = "test-token-w501";
const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

let writes = 0;
const countingRunners: StartServerOptions["runners"] = {
  answer: () => ({ exitCode: 0 }),
  greenlight: () => (writes++, { exitCode: 0 }),
  budget: () => ({ exitCode: 0 }),
  handoff: () => ({ exitCode: 0 }),
  talk: async () => ({ exitCode: 0 }),
  pause: async () => ({ exitCode: 0 }),
  resume: async () => ({ exitCode: 0 }),
  delegate: () => ({ exitCode: 0 }),
};

async function serve(tag: string) {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-w501-${tag}-`));
  cpSync(SAMPLE, dir, { recursive: true });
  dirs.push(dir);
  return startServer({
    studioDir: dir,
    port: 0,
    once: true,
    now: NOW,
    token: TOKEN,
    checkStudio: () => ({ ok: true, blocks: 0, advisories: 0, findings: [] }),
    runners: countingRunners,
    listModels: () => Promise.resolve([]),
  });
}

interface Got {
  status: number;
  type: string;
  body: string;
}

/** One raw request. `host: null` sends no Host header at all; a string is sent verbatim. The response is read whole,
 *  except an event stream, which is answered from its head and then dropped. */
function send(port: number, path: string, opts: { host?: string | null; method?: string; headers?: OutgoingHttpHeaders; body?: string } = {}): Promise<Got> {
  return new Promise((resolvePromise, reject) => {
    const headers: OutgoingHttpHeaders = { ...opts.headers };
    if (typeof opts.host === "string") headers["host"] = opts.host;
    const req = httpRequest({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers, setHost: opts.host === undefined }, (res: IncomingMessage) => {
      const type = String(res.headers["content-type"] ?? "");
      if (type.startsWith("text/event-stream")) {
        resolvePromise({ status: res.statusCode ?? 0, type, body: "" });
        req.destroy();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, type, body }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

const withToken = { "x-bisellium-token": TOKEN };
const HOST_REFUSED = JSON.stringify({ error: "host is not this console" });

test("W-501-b1 behaviour 1: a request whose Host is not the bound loopback authority is refused before any route, read or write", async () => {
  const s = await serve("b1");
  try {
    const P = s.port;
    // a rebinding page's own name, on the bound port: a state read with the right token is still refused
    const rebound = await send(P, "/api/inbox", { host: `evil.example:${P}`, headers: withToken });
    assert.equal(rebound.status, 403, "a rebinding Host is refused on a state read");
    assert.equal(rebound.body, HOST_REFUSED, "the refusal names the Host");
    for (const [label, host] of [
      ["a foreign name without a port", "evil.example"],
      ["the loopback address on another port", `127.0.0.1:${P + 1}`],
      ["the loopback address without its port", "127.0.0.1"],
      ["the ::1 loopback form", `[::1]:${P}`],
      ["a loopback name with a trailing dot", `localhost.:${P}`],
    ] as const) {
      const r = await send(P, "/api/officina", { host, headers: withToken });
      assert.equal(r.status, 403, `${label} is refused`);
    }
    // an absent Host never reaches a route: Node's parser answers 400 first (requireHostHeader, reused)
    assert.equal((await send(P, "/api/officina", { host: null, headers: withToken })).status, 400, "an absent Host is refused");
    // the stream, the shell and an asset: refused under a foreign Host too
    assert.equal((await send(P, `/api/live?token=${TOKEN}`, { host: `evil.example:${P}`, headers: withToken })).status, 403, "the live stream is refused under a foreign Host");
    assert.equal((await send(P, "/", { host: `evil.example:${P}` })).status, 403, "the shell is refused under a foreign Host");
    assert.equal((await send(P, "/assets/index.js", { host: `evil.example:${P}` })).status, 403, "an asset is refused under a foreign Host");
    // a write with the token and no Origin, under a foreign Host: refused, and no runner runs
    const before = writes;
    const w = await send(P, "/api/greenlight", { method: "POST", host: `evil.example:${P}`, headers: { ...withToken, "content-type": "application/json" }, body: JSON.stringify({ opus: "W-002" }) });
    assert.equal(w.status, 403, "a write under a foreign Host is refused");
    assert.equal(writes, before, "no write runs under a foreign Host");
    // the bound loopback authority, by either name and in any case, is accepted
    for (const host of [`127.0.0.1:${P}`, `localhost:${P}`, `LOCALHOST:${P}`]) {
      const r = await send(P, "/api/officina", { host, headers: withToken });
      assert.equal(r.status, 200, `Host ${host} is accepted`);
    }
    const ok = await send(P, "/api/greenlight", { method: "POST", host: `localhost:${P}`, headers: { ...withToken, "content-type": "application/json", origin: `http://localhost:${P}` }, body: JSON.stringify({ opus: "W-002" }) });
    assert.equal(ok.status, 200, "a write under the bound Host and Origin still runs");
    assert.equal(writes, before + 1, "the accepted write runs once");
  } finally {
    await s.close();
  }
});

const TOKEN_REFUSED = JSON.stringify({ error: "missing or invalid X-Bisellium-Token" });
/** Every GET route under /api/ that serves studio state, and one no route answers. */
const STATE_READS = [
  "/api/officina",
  "/api/models",
  "/api/opera",
  "/api/opus/W-001",
  "/api/inbox",
  "/api/acta",
  "/api/aerarium",
  "/api/providers",
  "/api/health",
  "/api/completion",
  "/api/timeline/patron",
  "/api/events",
  "/api/receipts",
  "/api/live",
  "/api/no-such-route",
];

test("W-501-b2 behaviour 2: every GET under /api/ needs the session token, by header or, on /api/live only, by query; the shell and assets need none", async () => {
  const s = await serve("b2");
  const logged: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    logged.push(String(chunk));
    return (write as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  try {
    const P = s.port;
    for (const path of STATE_READS) {
      const r = await send(P, path);
      assert.equal(r.status, 401, `${path} without the token is refused`);
      assert.equal(r.body, TOKEN_REFUSED, `${path}: the refusal names the token`);
    }
    assert.equal((await send(P, "/api/officina", { headers: { "x-bisellium-token": "wrong" } })).status, 401, "a wrong token is refused");
    assert.equal((await send(P, "/api/officina", { headers: { "x-bisellium-token": "" } })).status, 401, "an empty token is refused");
    assert.equal((await send(P, "/api/live?token=wrong")).status, 401, "a wrong query token is refused on /api/live");
    // the token by header reads every route; /api/live also by query, since EventSource sends no header
    const officina = await send(P, "/api/officina", { headers: withToken });
    assert.equal(officina.status, 200, "the header token reads /api/officina");
    assert.equal(typeof (JSON.parse(officina.body) as { studio?: unknown }).studio, "string", "the read serves the officina");
    assert.equal((await send(P, "/api/opus/W-001", { headers: withToken })).status, 200, "the header token reads an opus");
    const byHeader = await send(P, "/api/live", { headers: withToken });
    assert.equal(byHeader.status, 200, "the header token opens the live stream");
    const byQuery = await send(P, `/api/live?token=${TOKEN}`);
    assert.equal(byQuery.status, 200, "the query token opens the live stream");
    // one-sided: the stream's Content-Type may carry a charset suffix; the prefix is the contract
    assert.ok(byQuery.type.startsWith("text/event-stream"), "the query token's response is the event stream");
    assert.equal((await send(P, `/api/inbox?token=${TOKEN}`)).status, 401, "the query token is accepted on /api/live only");
    // the shell and its assets carry no studio state and need no token
    assert.equal((await send(P, "/")).status, 200, "the shell loads without the token");
    const asset = await send(P, "/assets/no-such-asset.js");
    assert.equal(asset.status, 404, "an asset GET needs no token");
    // the access log never prints a token given in the query
    await new Promise((r) => setImmediate(r));
    const log = logged.join("");
    assert.match(log, /GET \/api\/inbox\?token=redacted 401/, "the access log redacts the query token");
    assert.equal(log.includes(TOKEN), false, "the access log never prints the token");
  } finally {
    await s.close();
    process.stderr.write = write;
  }
});

test("W-501-f1: the access log never prints the token, whatever spelling of the parameter the reader accepts", async () => {
  const s = await serve("f1");
  const logged: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    logged.push(String(chunk));
    return (write as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  try {
    const P = s.port;
    const spellings = [
      `token=${TOKEN}`,
      `%74oken=${TOKEN}`,
      `to%6Ben=${TOKEN}`,
      `%74%6F%6B%65%6E=${TOKEN}`,
      `%74oken=wrong&token=${TOKEN}`,
      `x=1&%74oken=${TOKEN}&y=2`,
      `token=wrong&%74oken=${TOKEN}`,
      `Token=${TOKEN}`,
      `TOKEN=${TOKEN}`,
      `%54oken=${TOKEN}`,
    ];
    for (const q of spellings) {
      // /api/live opens a stream for an accepted spelling; an unaccepted one is refused: both are logged
      await send(P, `/api/live?${q}`);
      await send(P, `/api/inbox?${q}`);
    }
    // the reader and the redaction agree: a decoded-name `token` is accepted AND redacted
    assert.equal((await send(P, `/api/live?%74oken=${TOKEN}`)).status, 200, "the reader accepts the encoded name");
    // `send` drops the stream once its head is read, and the access log line follows the stream's finish: closing the
    // server ends every live stream, then the line is awaited
    await s.close();
    const liveLine = /GET \/api\/live\?%74oken=redacted 200/;
    for (let i = 0; i < 100 && !liveLine.test(logged.join("")); i++) await new Promise((r) => setTimeout(r, 20));
    const log = logged.join("");
    assert.match(log, liveLine, "an accepted encoded name is logged on the live stream, redacted");
    assert.equal(log.includes(TOKEN), false, "the access log never prints the token, in any spelling");
    assert.match(log, /GET \/api\/inbox\?%74oken=redacted 401/, "an encoded name is redacted, name kept");
    assert.match(log, /GET \/api\/inbox\?x=1&%74oken=redacted&y=2 401/, "other parameters are kept");
  } finally {
    await s.close().catch(() => undefined);
    process.stderr.write = write;
  }
});
