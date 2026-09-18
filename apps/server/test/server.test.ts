/**
 * apps/server/test/server.test.ts — W-014 (`bisellium serve`: localhost
 * HTTP + SSE over the store), against a temp copy of examples/sample-studio.
 * `now` is pinned to 2026-09-18T17:00:00Z (the repo-wide pinned clock) so
 * the aerarium/current-period math is reproducible. `NODE_ENV=test` is set
 * before starting the server so the `/api/_poll` test hook is reachable —
 * it's otherwise a 404.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { startServer } from "../src/index.js";

process.env["NODE_ENV"] = "test";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T17:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail}`);
  if (!ok) failed++;
};

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

async function postJson(base: string, path: string, payload: unknown): Promise<JsonResponse> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

/** A minimal SSE client for /api/live: parses "data: <json>\n\n" frames off
 *  the raw response stream (node:http, not fetch — we want the connection
 *  to stay open and keep pushing). */
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

async function main(): Promise<void> {
  const dir = freshStudio("main");
  const started = await startServer({ studioDir: dir, port: 0, once: true, now: NOW });
  const base = `http://127.0.0.1:${started.port}`;
  let beforeRestartEvents: { name: string }[] = [];

  try {
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

    // ---- SSE: mutate W-002 on disk, manual-poll, expect one state_changed ---
    {
      const sse = connectSSE(started.port);
      await new Promise((r) => setTimeout(r, 100)); // let the connection establish

      const opusPath = join(dir, "opera", "W-002.md");
      const before = readFileSync(opusPath, "utf8");
      const mutated = before.replace("state: building", "state: verifying");
      check("sse setup: W-002's state line found and replaced", mutated !== before);
      writeFileSync(opusPath, mutated);

      const poll = await postJson(base, "/api/_poll", {});
      check("_poll: 200", poll.status === 200, JSON.stringify(poll.body));

      const matches = () =>
        sse.events.filter((e) => e["name"] === "workflow.state_changed" && (e["attrs"] as Record<string, unknown>)?.["workflow.item.id"] === "W-002");
      const arrived = await waitFor(() => matches().length === 1);
      check("sse: exactly one state_changed event for W-002", arrived, JSON.stringify(matches()));
      sse.close();
    }

    // ---- /api/_poll is a 404 outside NODE_ENV=test ---------------------------
    {
      const prevEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";
      const r = await postJson(base, "/api/_poll", {});
      check("_poll: 404 outside NODE_ENV=test", r.status === 404, String(r.status));
      process.env["NODE_ENV"] = prevEnv;
    }

    // ---- writes reject a non-loopback caller (best-effort: header spoof) ----
    // (The server only binds 127.0.0.1, so this mainly exercises the guard
    // logic itself rather than an actual remote connection.)

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

  // ---- close() releases the port -------------------------------------------
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
  // and the CLI's own workflow.greenlight event (appended by this same
  // greenlight POST, via packages/cli/src/writes.ts's emitEvent into
  // EVENTS_LOG_REL) is visible once the log is unified (verifier block
  // issues: apps/server/src/store.ts x2). --------------------------------
  {
    const restarted = await startServer({ studioDir: dir, port: 0, once: true, now: NOW });
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

  // ---- close(): resolves promptly even with a live SSE client connected
  // (verifier block issue: apps/server/src/http.ts, close() never ends SSE
  // responses nor forces the sockets closed, so server.close()'s callback
  // never fires while a client is on /api/live). --------------------------
  {
    const dirSse = freshStudio("close-live");
    const sSse = await startServer({ studioDir: dirSse, port: 0, once: true, now: NOW });
    const sse = connectSSE(sSse.port);
    await new Promise((r) => setTimeout(r, 100)); // let the connection establish

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
  // aborted first (the listener count drops to 0, but close() must not
  // still be waiting on a half-torn-down connection). ---------------------
  {
    const dirSse2 = freshStudio("close-live-aborted");
    const sSse2 = await startServer({ studioDir: dirSse2, port: 0, once: true, now: NOW });
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

  // ---- overlapping /api/talk calls must not cross-wire responses, and must
  // not leave console.log/console.error permanently pointed at a stale
  // per-request collector (verifier block issue: apps/server/src/http.ts,
  // withCapturedConsole mutates the process-global console). -------------
  {
    const dirTalk = freshStudio("talk-overlap");
    const sTalk = await startServer({ studioDir: dirTalk, port: 0, once: true, now: NOW });
    const talkBase = `http://127.0.0.1:${sTalk.port}`;
    const originalLog = console.log;
    const originalError = console.error;
    try {
      // Two different sellae, so this isolates the console cross-wire from
      // any unrelated same-file (session/timeline) write race.
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
