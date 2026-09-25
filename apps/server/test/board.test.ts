/**
 * apps/server/test/board.test.ts — W-064 behaviour 10: the server read
 * surface. A NEW file rather than additions to `server.test.ts`: that file
 * takes only a repo path (`argv[2]`) and has no behaviour selector, so a red
 * against it would run all ~900 lines and cover two behaviours at once (the
 * lex's own assertion-level-red rule). This file carries the house
 * convention from line one (`argv[2]` repo, `argv[3]` behaviour) and
 * duplicates ~40 lines of temp-studio setup rather than importing
 * `server.test.ts` (which would execute its whole suite).
 */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { readManifest, STATES } from "@bisellium/adapter-native";
import { startServer, type StartServerOptions } from "../src/index.js";

process.env["NODE_ENV"] = "test";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T17:00:00Z");
const TEST_TOKEN = "test-token-w064";

const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
let failed = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  if (only !== undefined && only !== 10) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
};

const fakeCheckStudio: StartServerOptions["checkStudio"] = () => ({ ok: true, blocks: 0, advisories: 0, findings: [] });
const noopRunners: StartServerOptions["runners"] = {
  answer: () => ({ exitCode: 0 }),
  greenlight: () => ({ exitCode: 0 }),
  budget: () => ({ exitCode: 0 }),
  handoff: () => ({ exitCode: 0 }),
  talk: async () => ({ exitCode: 0 }),
  pause: async () => ({ exitCode: 0 }),
  resume: async () => ({ exitCode: 0 }),
  delegate: () => ({ exitCode: 0 }),
};
// W-065 behaviour 9's guard, reused (W-069 b13 — the emit guard is DONE and
// not re-specified): fails the test if any route asks for a vendor listing.
const failingListModels: StartServerOptions["listModels"] = () => {
  throw new Error("no route in this test should request GET /api/models");
};

function baseOpts(studioDir: string, extra: Partial<StartServerOptions> = {}): StartServerOptions {
  return { studioDir, checkStudio: fakeCheckStudio, runners: noopRunners, listModels: failingListModels, token: TEST_TOKEN, once: true, now: NOW, port: 0, ...extra };
}

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-board-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  // examples/sample-studio is checked directly (not always via a copy) by
  // other commands (e.g. `bisellium check examples/sample-studio`), which
  // can leave a gitignored `.bisellium/` index/snapshot cache behind on
  // disk; a blind recursive copy would carry that STALE state into this
  // "fresh" temp studio and corrupt this file's exact-count assertions
  // (measured: a leftover snapshot doubled the ingested event count). Strip
  // it so every test here starts from a genuinely cold ingest.
  rmSync(join(dir, ".bisellium"), { recursive: true, force: true });
  dirs.push(dir);
  return dir;
}

interface JsonResponse {
  status: number;
  // eslint no-explicit-any is not enabled in this repo's config (see
  // eslint.config.mjs's own header) — no disable comment needed.
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

async function postJson(base: string, path: string, payload: unknown): Promise<JsonResponse> {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-bisellium-token": TEST_TOKEN }, body: JSON.stringify(payload) });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** A minimal SSE client for /api/live — same recipe as server.test.ts's own
 *  `connectSSE`, duplicated per this file's own header note. */
function connectSSE(port: number): { events: Record<string, unknown>[]; close: () => void } {
  const events: Record<string, unknown>[] = [];
  let buffer = "";
  const req = httpRequest({ host: "127.0.0.1", port, path: "/api/live", method: "GET" }, (res: IncomingMessage) => {
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
            // not a data frame we care about
          }
        }
      }
    });
  });
  req.on("error", () => undefined);
  req.end();
  return { events, close: () => req.destroy() };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
}

function eventsLogLineCount(dir: string): number {
  return readFileSync(join(dir, ".bisellium", "events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean).length;
}

async function main(): Promise<void> {
  // ===========================================================================
  // GET /api/officina — lifecycle (additive) + every pre-existing key unchanged
  // ===========================================================================
  {
    const dir = freshStudio("officina");
    const started = await startServer(baseOpts(dir));
    const base = `http://127.0.0.1:${started.port}`;
    const r = await getJson(base, "/api/officina");

    check("officina.lifecycle.states deep-equals STATES (@bisellium/adapter-native)", JSON.stringify(r.body.lifecycle?.states) === JSON.stringify(STATES), JSON.stringify(r.body.lifecycle));
    check('officina.lifecycle.id is "bisellium"', r.body.lifecycle?.id === "bisellium", String(r.body.lifecycle?.id));

    const manifest = readManifest(dir);
    check(
      "officina: every pre-existing key is byte-identical to a direct manifest read",
      r.body.studio === manifest.studio &&
        r.body.patron === (manifest.patron ?? "patron") &&
        JSON.stringify(r.body.sellae) === JSON.stringify(manifest.sellae) &&
        JSON.stringify(r.body.probationes) === JSON.stringify(manifest.probationes) &&
        r.body.wip_limit === manifest.wip_limit,
      JSON.stringify(r.body),
    );

    await started.close();
  }

  // ===========================================================================
  // GET /api/events — unfiltered path, byte-for-byte unchanged
  // ===========================================================================
  {
    const dir = freshStudio("events-unfiltered");
    const started = await startServer(baseOpts(dir));
    const base = `http://127.0.0.1:${started.port}`;

    const all = await getJson(base, "/api/events");
    check("omitted limit -> every event (measured against the log's own line count)", Array.isArray(all.body) && all.body.length === eventsLogLineCount(dir), `${all.body.length} vs ${eventsLogLineCount(dir)}`);

    const three = await getJson(base, "/api/events?limit=3");
    check(
      "supplied limit=3 -> the EARLIEST three, ascending seq",
      three.body.length === 3 && three.body[0].seq < three.body[1].seq && three.body[1].seq < three.body[2].seq && three.body[0].seq === all.body[0].seq,
      JSON.stringify(three.body.map((e: { seq: number }) => e.seq)),
    );

    const clamp = await getJson(base, "/api/events?limit=9999");
    check("limit=9999 clamps to 500", clamp.body.length === Math.min(500, eventsLogLineCount(dir)), String(clamp.body.length));

    const sinceSeq = all.body[2].seq as number;
    const sinceRes = await getJson(base, `/api/events?since=${sinceSeq}`);
    check("since=<seq> is exclusive", sinceRes.body.every((e: { seq: number }) => e.seq > sinceSeq), JSON.stringify(sinceRes.body.map((e: { seq: number }) => e.seq)));

    const isoSince = await getJson(base, `/api/events?since=${encodeURIComponent(NOW.toISOString())}`);
    check(
      "since=<an ISO timestamp> is silently treated as absent -> from the start of the log (num()'s real behaviour, pinned)",
      isoSince.body.length === all.body.length,
      `${isoSince.body.length} vs ${all.body.length}`,
    );

    await started.close();
  }

  // ===========================================================================
  // GET /api/events?item= — the new filtered path
  // ===========================================================================
  {
    const dir = freshStudio("events-filtered");
    const started = await startServer(baseOpts(dir));
    const base = `http://127.0.0.1:${started.port}`;

    const all = await getJson(base, "/api/events");
    const w2 = await getJson(base, "/api/events?item=W-002");
    const includedCount = w2.body.length as number;
    const excludedCount = all.body.length - includedCount;
    check(
      "filtered: only W-002's events — both the included and excluded counts asserted",
      includedCount > 0 && excludedCount > 0 && w2.body.every((e: { attrs: Record<string, unknown> }) => e.attrs["workflow.item.id"] === "W-002"),
      `${includedCount} included / ${excludedCount} excluded`,
    );

    const limited = await getJson(base, "/api/events?item=W-002&limit=2");
    const lastTwo = w2.body.slice(-2);
    check("filtered + limit=2 -> W-002's LAST two, still ascending", JSON.stringify(limited.body) === JSON.stringify(lastTwo), JSON.stringify(limited.body));

    const omitted = await getJson(base, "/api/events?item=W-002");
    check("filtered, omitted limit -> all of W-002's events", JSON.stringify(omitted.body) === JSON.stringify(w2.body));

    const unknown = await getJson(base, "/api/events?item=NOPE-NOT-REAL");
    check("an unknown item -> 200 []", unknown.status === 200 && Array.isArray(unknown.body) && unknown.body.length === 0, JSON.stringify(unknown));

    const unsafe = await getJson(base, `/api/events?item=${encodeURIComponent("../../etc/passwd")}`);
    check("an id carrying a path separator -> 200 [] without throwing", unsafe.status === 200 && Array.isArray(unsafe.body) && unsafe.body.length === 0, JSON.stringify(unsafe));

    const combo = await getJson(base, "/api/events?item=W-002&since=1");
    check("item combined with since -> 400 (no seq to resume from on this path)", combo.status === 400, String(combo.status));

    // An event appended by ANOTHER writer while the server runs must appear —
    // false for an Index-backed read (survey), and the whole reason for the
    // fresh-log source.
    appendFileSync(
      join(dir, ".bisellium", "events.jsonl"),
      JSON.stringify({ id: "external:1", name: "gen_ai.usage", ts: new Date().toISOString(), projectId: started.store.projectId, attrs: { "workflow.item.id": "W-002" } }) + "\n",
      "utf8",
    );
    const afterAppend = await getJson(base, "/api/events?item=W-002");
    check(
      "an event appended to events.jsonl by another writer while the server runs appears in the filtered response",
      afterAppend.body.length === includedCount + 1,
      `${afterAppend.body.length} vs ${includedCount + 1}`,
    );

    await started.close();
  }

  // ===========================================================================
  // GET /api/live — the attribute set the Board reads
  // ===========================================================================
  {
    const dir = freshStudio("live");
    const started = await startServer(baseOpts(dir));
    const sse = connectSSE(started.port);
    await new Promise((r) => setTimeout(r, 75)); // let the SSE connection register

    const opusPath = join(dir, "opera", "W-002.md");
    writeFileSync(opusPath, readFileSync(opusPath, "utf8").replace("state: building", "state: verifying"), "utf8");
    await postJson(`http://127.0.0.1:${started.port}`, "/api/_poll", {});

    const arrived = await waitFor(() => sse.events.some((e) => e["name"] === "workflow.state_changed" && (e["attrs"] as Record<string, unknown>)?.["workflow.item.id"] === "W-002"));
    check("a front-matter state change + POST /api/_poll delivers a workflow.state_changed frame", arrived, JSON.stringify(sse.events));

    const frame = sse.events.find((e) => e["name"] === "workflow.state_changed" && (e["attrs"] as Record<string, unknown>)?.["workflow.item.id"] === "W-002");
    const attrs = (frame?.["attrs"] ?? {}) as Record<string, unknown>;
    check(
      "the frame's attrs carry workflow.item.id, state.from, state.to and time.derived",
      attrs["workflow.item.id"] === "W-002" && attrs["workflow.state.from"] === "building" && attrs["workflow.state.to"] === "verifying" && attrs["workflow.time.derived"] === true,
      JSON.stringify(attrs),
    );

    sse.close();
    await started.close();
  }

  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

void main();
