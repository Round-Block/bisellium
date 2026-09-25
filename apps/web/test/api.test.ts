/**
 * apps/web/test/api.test.ts — W-024 behaviours 2 and 3. Runs under plain
 * node via tsx (not vite), so `global.fetch` is mocked directly and
 * `import.meta.env` is left undefined on purpose (api.ts must tolerate
 * that — see its header comment).
 *
 * An optional behaviour number as `process.argv[2]` (`bisellium red`'s
 * one-behaviour-per-log contract) restricts which behaviour's checks run;
 * omitted, all of this file's behaviours run.
 */
import { fetchInbox, postWrite, submitAnswer } from "../src/api.js";

const only = process.argv[2] ? Number(process.argv[2]) : undefined;

let failed = 0;
const check = (behaviour: number, name: string, ok: boolean, detail = "") => {
  if (only !== undefined && behaviour !== only) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
};

type FetchCall = { url: string; init?: RequestInit };
const calls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function mockFetch(response: { status: number; body: unknown }): void {
  calls.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    } as Response;
  }) as typeof fetch;
}

/** W-067 behaviour 3's fourth `WriteResult` polarity: a network failure —
 *  `fetch` itself rejects (offline, DNS, the server process gone). */
function mockFetchThrows(): void {
  calls.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    throw new TypeError("network error");
  }) as typeof fetch;
}

/** Runs a WriteResult-returning call, surfacing a thrown error as its own
 *  distinguishable "kind" instead of aborting main() — lets every later
 *  check in this file still run (and show FAIL) rather than one uncaught
 *  throw silently swallowing the rest (relevant while postWrite is still
 *  the red-recording skeleton: a throw is expected, not a crash). */
async function safeWrite<T extends { kind: string }>(fn: () => Promise<T>): Promise<T | { kind: string; error: string }> {
  try {
    return await fn();
  } catch (e) {
    return { kind: "threw", error: String(e) };
  }
}

async function main(): Promise<void> {
  // behaviour 2: fetchInbox GETs /api/inbox and returns the parsed body.
  mockFetch({ status: 200, body: { opera: [], petitiones: [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask", body: "" }] } });
  const inbox = await fetchInbox();
  check(2, "fetchInbox sends GET to /api/inbox", calls[0]?.url === "/api/inbox", calls[0]?.url);
  check(2, "fetchInbox returns the parsed JSON response", inbox.petitiones[0]?.id === "P-1", JSON.stringify(inbox));

  // behaviour 2: a non-200 status rejects the promise with the status.
  mockFetch({ status: 404, body: { error: "not found" } });
  let rejection: unknown;
  try {
    await fetchInbox();
  } catch (e) {
    rejection = e;
  }
  check(2, "fetchInbox rejects with the response status on non-200", rejection === 404, String(rejection));

  // behaviour 3: submitAnswer POSTs /api/answer with body, headers, and
  // (W-067) returns postWrite's WriteResult rather than the raw body.
  mockFetch({ status: 200, body: { ok: true, exitCode: 0, output: "done" } });
  const answer = await safeWrite(() => submitAnswer("P-1", "approve: looks good"));
  const call = calls[0];
  const init = call?.init;
  const headers = new Headers(init?.headers);
  check(3, "submitAnswer sends POST to /api/answer", call?.url === "/api/answer" && init?.method === "POST", call?.url);
  check(3, "submitAnswer sends JSON body { petitio, reply }", init?.body === JSON.stringify({ petitio: "P-1", reply: "approve: looks good" }), String(init?.body));
  check(3, "submitAnswer sets Content-Type: application/json", headers.get("content-type") === "application/json");
  check(3, "submitAnswer sets X-Bisellium-Token", headers.has("x-bisellium-token"));
  check(3, "submitAnswer returns { kind: 'ok', output } via postWrite", answer.kind === "ok" && answer.output === "done", JSON.stringify(answer));

  // ── W-067 behaviour 3: postWrite's WriteResult, all four polarities ──
  // res.ok is never the success signal — a 200 still reads the body's own
  // `ok` field, so both a 200/ok:true AND the 200/ok:false refusal are
  // tested, or an implementation returning "refused" unconditionally would
  // pass this file undetected.
  mockFetch({ status: 200, body: { ok: true, exitCode: 0, output: "done" } });
  const wOk = await safeWrite(() => postWrite("/api/greenlight", { opus: "W-001" }));
  check(3, "postWrite: 200 + ok:true -> kind 'ok'", wOk.kind === "ok" && wOk.output === "done", JSON.stringify(wOk));

  mockFetch({ status: 200, body: { ok: false, exitCode: 3, output: "W-001 is not in backlog" } });
  const wRefused = await safeWrite(() => postWrite("/api/greenlight", { opus: "W-001" }));
  check(
    3,
    "postWrite: 200 + ok:false -> kind 'refused' carrying exitCode + output",
    wRefused.kind === "refused" && wRefused.exitCode === 3 && wRefused.output === "W-001 is not in backlog",
    JSON.stringify(wRefused),
  );

  mockFetch({ status: 401, body: { error: "missing or invalid X-Bisellium-Token" } });
  const wUnauth = await safeWrite(() => postWrite("/api/greenlight", { opus: "W-001" }));
  check(3, "postWrite: 401 -> kind 'unauthorized'", wUnauth.kind === "unauthorized", JSON.stringify(wUnauth));

  mockFetch({ status: 415, body: { error: "Content-Type must be application/json" } });
  const w415 = await safeWrite(() => postWrite("/api/greenlight", { opus: "W-001" }));
  check(3, "postWrite: 415 -> kind 'error'", w415.kind === "error" && w415.status === 415, JSON.stringify(w415));

  mockFetch({ status: 400, body: { error: "opus is required" } });
  const w400 = await safeWrite(() => postWrite("/api/greenlight", {}));
  check(3, "postWrite: 400 -> kind 'error'", w400.kind === "error" && w400.status === 400, JSON.stringify(w400));

  mockFetchThrows();
  const wNet = await safeWrite(() => postWrite("/api/greenlight", { opus: "W-001" }));
  check(3, "postWrite: a thrown network error -> kind 'error', no status", wNet.kind === "error" && wNet.status === undefined, JSON.stringify(wNet));

  // A 200 with a malformed/absent `ok` field is a fifth real outcome
  // (Sol's red-team target 4) — never mis-filed as success.
  mockFetch({ status: 200, body: { exitCode: 0, output: "done" } });
  const wNoOkField = await safeWrite(() => postWrite("/api/greenlight", { opus: "W-001" }));
  check(3, "postWrite: 200 with no 'ok' field -> kind 'error', not 'ok'", wNoOkField.kind === "error", JSON.stringify(wNoOkField));
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
    process.exit(failed ? 1 : 0);
  });
