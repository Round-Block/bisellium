/**
 * apps/web/test/w501.test.ts — W-501 behaviour 3: the console's reads carry the session token the Patron pasted (held in
 * sessionStorage, D-023, and in memory for this page), a read with none held is refused with no request, a refused read
 * (or a live stream the server closed, checked by one read) raises the one token prompt, and a token saved after a refused
 * read re-mounts the routed screen so it reads again; whether a read succeeded is scoped to the routed-screen mount
 * (`beginReadMount`), so a stale token on a newly mounted screen owes the re-read after an earlier screen loaded. Plain node (no DOM): `fetch`, `sessionStorage` and `EventSource` are
 * stubbed on globalThis before api.ts is loaded. node:test TAP; selected by `--test-name-pattern='^W-501-b3\s'`.
 *
 * Run from the repo root:
 *   node --test-reporter=tap --import tsx apps/web/test/w501.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TOKEN = "tok w501/+";
const store = new Map<string, string>([["bisellium.token", TOKEN]]);
let storageDenied = false;
const g = globalThis as Record<string, unknown>;
g["sessionStorage"] = {
  getItem: (k: string) => {
    if (storageDenied) throw new Error("denied");
    return store.get(k) ?? null;
  },
  setItem: (k: string, v: string) => {
    if (storageDenied) throw new Error("denied");
    store.set(k, v);
  },
};
class FakeSource {
  static readonly CLOSED = 2;
  readyState = 1;
  readonly listeners = new Map<string, (() => void)[]>();
  constructor(readonly url: string) {
    opened.push(this);
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  close(): void {}
}
const opened: FakeSource[] = [];
g["EventSource"] = FakeSource;
type Call = { url: string; init?: RequestInit };
const calls: Call[] = [];
let status = 200;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  calls.push({ url: String(url), init });
  return { ok: status >= 200 && status < 300, status, json: async () => ({ studio: "s", ok: true, output: "" }) } as Response;
}) as typeof fetch;
// sleep-waiver: fixture -- a zero-delay turn only, to let the stubbed fetch promises settle; there is no real wait
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

// A namespace import, so a name api.ts does not export yet is an assertion's failure, not a module-load error.
const api = (await import("../src/api.js")) as typeof import("../src/api.js") & Record<string, unknown>;
const tokenOf = (c: Call | undefined): string | undefined => (c?.init?.headers as Record<string, string> | undefined)?.["X-Bisellium-Token"];

test("W-501-b3 behaviour 3: reads send the session token, a refused read raises the prompt, and a token saved after one re-reads the screens", async () => {
  // a read sends the token the Patron pasted
  await api.fetchOfficina();
  assert.equal(tokenOf(calls.at(-1)), TOKEN, "a read sends the session token");
  // the live stream carries it in its query, since EventSource sends no header
  const stop = api.subscribeLive({ onEvent: () => undefined });
  const source = opened.at(-1)!;
  assert.equal(source.url, `/api/live?token=${encodeURIComponent(TOKEN)}`, "the live stream carries the token in its query");
  const reread = api["rereadAfterTokenSaved"] as (() => boolean) | undefined;
  assert.equal(typeof reread, "function", "api.ts exports rereadAfterTokenSaved");
  const begin = api["beginReadMount"] as (() => void) | undefined;
  assert.equal(typeof begin, "function", "api.ts exports beginReadMount");
  // a refused write alone: a token saved then keeps the screens (a drafted answer survives)
  let prompts = 0;
  api.setUnauthorizedListener(() => prompts++);
  status = 401;
  assert.equal((await api.postWrite("/api/greenlight", { opus: "W-001" })).kind, "unauthorized", "a refused write is unauthorized");
  assert.equal(reread!(), false, "a token saved after only a refused write keeps the screens");
  // a stream the browser is reconnecting issues no read; one the server closed is checked by one read, whose 401 raises the prompt
  const before = calls.length;
  source.readyState = 0;
  source.fire("error");
  await tick();
  assert.equal(calls.length, before, "a reconnecting stream issues no read");
  source.readyState = FakeSource.CLOSED;
  source.fire("error");
  await tick();
  assert.equal(calls.length, before + 1, "a stream the server closed is checked by one read");
  assert.equal(tokenOf(calls.at(-1)), TOKEN, "the check read sends the session token");
  assert.equal(prompts, 2, "a closed stream's refused check raises the token prompt");
  assert.equal(reread!(), true, "a token saved after a refused stream re-reads the screens");
  assert.equal(reread!(), false, "the re-read is taken once");
  stop();
  // the screens re-mounted and read again; a read refused once they have loaded raises the prompt but keeps them (a draft survives)
  begin!();
  status = 200;
  await api.fetchOfficina();
  status = 401;
  await assert.rejects(api.fetchInbox(), (e: unknown) => e === 401, "the refused read still rejects with its status");
  assert.equal(prompts, 3, "a refused read raises the token prompt");
  assert.equal(reread!(), false, "a read refused after the screens loaded keeps them");
  // a serve restart leaves the stored token stale after an earlier screen loaded; the Patron navigates, and the newly
  // mounted screen's first read is refused: the new mount has no successful read, so the saved token re-reads it, once
  begin!();
  await assert.rejects(api.fetchOpera(), (e: unknown) => e === 401, "a stale token's read on a new mount is refused");
  assert.equal(prompts, 4, "a stale token's read on a new mount raises the token prompt");
  assert.equal(reread!(), true, "a stale token on a new mount after an earlier success re-reads once");
  assert.equal(reread!(), false, "the new mount's re-read is taken once");
  // no token held (a fresh tab): a read is refused with no request, and no stream opens
  status = 200;
  store.delete("bisellium.token");
  const sent = calls.length;
  await assert.rejects(api.fetchOpera(), (e: unknown) => e === 401, "a read with no token held is refused");
  assert.equal(calls.length, sent, "a read with no token held sends no request");
  assert.equal(prompts, 5, "a read with no token held raises the token prompt");
  const streams = opened.length;
  api.subscribeLive({ onEvent: () => undefined })();
  assert.equal(opened.length, streams, "no stream opens with no token held");
  assert.equal(reread!(), true, "a token saved on a fresh tab re-reads the screens");
  // a stale stored token refused before any read succeeded (a tab kept across a serve restart): the screens re-read
  store.set("bisellium.token", "stale w501");
  status = 401;
  const fresh = (await import("../src/api.js?w501=stale")) as typeof import("../src/api.js") & Record<string, unknown>;
  await assert.rejects(fresh.fetchOfficina(), (e: unknown) => e === 401, "a stale token's first read is refused");
  assert.equal((fresh["rereadAfterTokenSaved"] as () => boolean)(), true, "a stale token refused before any read re-reads the screens");
  status = 200;
  // a browser that denies sessionStorage still reads with the token pasted this page
  storageDenied = true;
  api.setToken("pasted w501");
  await api.fetchOfficina().catch(() => undefined);
  assert.equal(tokenOf(calls.at(-1)), "pasted w501", "a pasted token is read when storage is denied");
  api.setUnauthorizedListener(undefined);
  // the shell re-mounts its routed screen after a refused read, keyed by its read epoch
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.ok(app.includes("if (rereadAfterTokenSaved()) setReadEpoch((n) => n + 1);"), "the shell's token prompt asks whether to re-read");
  assert.ok(app.includes("<Fragment key={readEpoch}>"), "the shell keys its routed screen by the read epoch");
  assert.ok(app.includes("useLayoutEffect(() => beginReadMount(), [route, readEpoch]);"), "the shell begins a read mount on each route and read epoch");
});
