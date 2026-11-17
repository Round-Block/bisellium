/** W-503 amendment runtime row. Runs under Node via tsx with fetch/storage stubbed before api.ts loads. */
import assert from "node:assert/strict";
import { test } from "node:test";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>)["sessionStorage"] = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
};

const inbox = { opera: [], petitiones: [] };
let requests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  requests++;
  return { ok: true, status: 200, json: async () => inbox } as Response;
}) as typeof fetch;

const api = await import("../src/api.js?r12-rejected-share");

test("W-503-b5 behaviour 5: a rejected shared Inbox read is evicted before a token retry", async () => {
  await assert.rejects(api.fetchInbox({ shared: true }), (error: unknown) => error === 401, "a token-less shared Inbox read rejects with 401");
  assert.equal(requests, 0, "the token-less read sends no request");

  api.setToken("r12-token");
  let retry: unknown;
  try {
    retry = await api.fetchInbox({ shared: true });
  } catch (error) {
    retry = error;
  }
  assert.deepEqual(retry, inbox, "a token save after a rejected shared Inbox read issues a fresh successful read");
  assert.equal(requests, 1, "the retry issues exactly one fresh GET");
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
