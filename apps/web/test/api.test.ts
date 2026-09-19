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
import { fetchInbox, submitAnswer } from "../src/api.js";

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

async function main(): Promise<void> {
  // behaviour 2: fetchInbox GETs /api/inbox and returns the parsed body.
  mockFetch({ status: 200, body: { opera: [], petitiones: [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask" }] } });
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
  // returns the parsed { ok, exitCode, output } response.
  mockFetch({ status: 200, body: { ok: true, exitCode: 0, output: "done" } });
  const answer = await submitAnswer("P-1", "approve: looks good");
  const call = calls[0];
  const init = call?.init;
  const headers = new Headers(init?.headers);
  check(3, "submitAnswer sends POST to /api/answer", call?.url === "/api/answer" && init?.method === "POST", call?.url);
  check(3, "submitAnswer sends JSON body { petitio, reply }", init?.body === JSON.stringify({ petitio: "P-1", reply: "approve: looks good" }), String(init?.body));
  check(3, "submitAnswer sets Content-Type: application/json", headers.get("content-type") === "application/json");
  check(3, "submitAnswer sets X-Bisellium-Token", headers.has("x-bisellium-token"));
  check(3, "submitAnswer returns the parsed response", answer.ok === true && answer.exitCode === 0 && answer.output === "done", JSON.stringify(answer));
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
