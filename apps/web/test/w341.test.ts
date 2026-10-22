/**
 * apps/web/test/w341.test.ts — W-341 (D-088 F, D-090 B and C): one states matrix on the four console screens,
 * reported to one live region, and the served states suite with its axe scan. node:test TAP; each row is
 * `W-341-b<k>`. Every module the change introduces is reached through a guarded dynamic import, and source files
 * are read as text that may be absent, so on master each row fails by assertion, never by a missing module. The
 * CSS stub is registered first so components that import CSS render under plain node.
 */
import "./support/register-css-stub.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ponytail: run from the repo root (the recorded red's cwd) tsx finds no tsconfig and compiles JSX to the classic
// `React.createElement`; a global `React` lets the same components render from either cwd.
(globalThis as { React?: unknown }).React = React;

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => {
  try {
    return readFileSync(resolve(WEB, rel), "utf8");
  } catch {
    return "";
  }
};
async function load(rel: string): Promise<Record<string, unknown>> {
  try {
    return (await import(resolve(WEB, rel))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface Status {
  state: string;
  text: string;
}
type Cell = { copy: string } | { na: string };
interface Matrix {
  SCREEN_STATES: readonly string[];
  SCREENS: readonly string[];
  STATES_MATRIX: Record<string, Record<string, Cell>>;
  servedCells: () => { screen: string; state: string; copy: string }[];
  screenStatus: (screen: string, input: Record<string, unknown>) => Status;
}
async function matrix(): Promise<Matrix> {
  const m = await load("src/lib/screenState.ts");
  assert.equal(typeof m["screenStatus"], "function", "src/lib/screenState.ts exports screenStatus");
  return m as unknown as Matrix;
}

const SERVED: Record<string, string[]> = {
  inbox: ["loading", "empty", "error", "refused", "pending"],
  board: ["loading", "empty", "error", "stale", "live"],
  seats: ["loading", "empty", "error", "refused", "pending"],
  officina: ["loading", "empty", "error"],
};

const render = (component: unknown, props: Record<string, unknown>): string => renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));
const count = (html: string, needle: string): number => html.split(needle).length - 1;
const wired = (screen: string): void => assert.match(read("src/App.tsx"), new RegExp(`<${screen} onStatus=\\{setStatus\\} />`), `the shell hands ${screen} its status setter`);

test("W-341-b1 behaviour 1: one states matrix, one status by fixed precedence, one polite live region in the shell", async () => {
  const m = await matrix();
  assert.deepEqual([...m.SCREEN_STATES], ["loading", "empty", "error", "refused", "stale", "live", "pending"], "the seven named states, in order");
  assert.deepEqual([...m.SCREENS], ["inbox", "board", "seats", "officina"], "the four live screens");
  for (const screen of m.SCREENS) {
    for (const state of m.SCREEN_STATES) {
      const cell = m.STATES_MATRIX[screen]![state]!;
      const served = SERVED[screen]!.includes(state);
      assert.equal("copy" in cell, served, `${screen}:${state} is ${served ? "served" : "not reachable"}`);
      const text = "copy" in cell ? cell.copy : cell.na;
      assert.ok(text.trim().length > 0, `${screen}:${state} carries its copy or its reason`);
    }
  }
  assert.equal(m.servedCells().length, 18, "eighteen served cells");

  const s = (screen: string, input: Record<string, unknown>): string => m.screenStatus(screen, input).state;
  assert.deepEqual(m.screenStatus("inbox", { loaded: true }), { state: "ready", text: "" }, "rest is ready, with no text");
  assert.equal(s("inbox", { loaded: false }), "loading");
  assert.equal(s("inbox", { loaded: true, empty: true }), "empty");
  assert.equal(s("inbox", { loaded: false, failed: true }), "error", "error outranks loading");
  assert.equal(s("board", { loaded: false, live: false }), "loading", "loading outranks stale");
  assert.equal(s("inbox", { loaded: true, failed: true, refused: "x" }), "refused", "refused outranks error");
  assert.equal(s("inbox", { loaded: true, refused: "x", pending: true }), "pending", "pending outranks refused");
  assert.equal(s("board", { loaded: true, empty: true, live: false }), "stale", "stale outranks empty");
  assert.equal(s("board", { loaded: true, empty: true, live: true }), "empty", "empty outranks live");
  assert.equal(s("board", { loaded: true, live: true }), "live");
  assert.equal(m.screenStatus("inbox", { loaded: true, failed: "Could not send the answer." }).text, "Could not send the answer.", "a write failure carries its own copy");
  assert.equal(m.screenStatus("seats", { loaded: true, refused: "stale --from" }).text, "The change was refused. stale --from", "a refusal carries the server's output");
  assert.equal(m.screenStatus("seats", { loaded: true, refused: "" }).text, "The change was refused.", "an empty refusal output keeps the copy alone");
  assert.throws(() => m.screenStatus("board", { loaded: true, pending: true }), /board cannot be pending/, "a cell the screen cannot reach is a programming error");

  const app = await load("src/App.tsx");
  assert.equal(typeof app["App"], "function", "src/App.tsx exports App");
  // The Inbox (the default route) reads `location.search` while rendering; plain node has no `location`.
  (globalThis as { location?: unknown }).location ??= { search: "", hash: "" };
  const html = render(app["App"], {});
  assert.equal(count(html, 'role="status"'), 1, "exactly one status region");
  assert.equal(count(html, "aria-live="), 1, "exactly one live region");
  assert.match(html, /<div class="shell__status" role="status" aria-live="polite" data-state="ready"><\/div><\/div>$/, "the region is the shell's last child, polite, at rest and empty");
  assert.match(html, /<main class="shell__main" tabindex="0">/, "the scrolling main region is keyboard focusable");
  const css = read("src/components/w025.css");
  const rule = /\.shell__status \{([^}]*)\}/.exec(css)?.[1] ?? "";
  for (const decl of ["position: absolute;", "width: 1px;", "height: 1px;", "overflow: hidden;", "clip-path: inset(50%);"]) assert.ok(rule.includes(decl), `.shell__status is visually hidden and out of flow: ${decl}`);
});

test("W-341-b2 behaviour 2: the Inbox shows and reports loading, empty, error, refused and pending, and never invents petitions", async () => {
  await matrix();
  const view = (await load("src/screens/InboxView.tsx"))["InboxView"];
  const base = { petitiones: [], opera: [], focusIndex: 0, reason: "", onReasonChange: () => undefined, onFocusChange: () => undefined, onSubmit: () => undefined };
  assert.match(render(view, { ...base, notice: "Loading the inbox…" }), /<p class="inbox__empty">Loading the inbox…<\/p>/, "a notice replaces the empty copy while loading");
  assert.match(render(view, base), /<p class="inbox__empty">Nothing waiting on you<\/p>/, "the empty copy stands without a notice");
  const one = { ...base, petitiones: [{ id: "A-1", opus: "W-1", from: "architect", subject: "s", body: "b" }] };
  assert.match(render(view, { ...one, notice: "Sending your answer…" }), /<div class="inbox__decision-panel"><p class="screen-notice">Sending your answer…<\/p>/, "a pending notice sits in the decision panel");
  assert.equal(count(render(view, one), "screen-notice"), 0, "no notice at rest");
  wired("Inbox");
  const source = read("src/screens/Inbox.tsx");
  assert.doesNotMatch(source, /catch\(\(\) => setData\(DEV_DATA\)\)/, "a failed read never substitutes the demo petitions");
  assert.match(source, /\.catch\(\(\) => setReadFailed\(true\)\)/, "a failed read is the error state");
  assert.match(source, /screenStatus\("inbox", \{/, "the Inbox derives its one status from the matrix");
  assert.match(source, /pending: sending/, "an answer in flight is the pending state");
  assert.match(source, /useEffect\(\(\) => onStatus\?\.\(status\), \[status\.state, status\.text\]\)/, "the Inbox reports each status change");
});

test("W-341-b3 behaviour 3: Seats shows and reports loading, empty, error, refused and pending", async () => {
  await matrix();
  const view = (await load("src/screens/SeatsView.tsx"))["SeatsView"];
  const base = { seats: [], tiers: [], munera: [], availableModels: [], onDraft: () => undefined, onConfirm: () => undefined, onCancel: () => undefined };
  assert.match(render(view, { ...base, notice: "Loading the seats…" }), /<p class="seats__honesty">[^<]*<\/p><p class="screen-notice">Loading the seats…<\/p>/, "the notice follows the honesty line");
  assert.equal(count(render(view, base), "screen-notice"), 0, "no notice at rest");
  wired("Seats");
  const source = read("src/screens/Seats.tsx");
  assert.match(source, /\.catch\(\(\) => setReadFailed\(true\)\)/, "a failed officina read is the error state, not an empty screen");
  assert.match(source, /screenStatus\("seats", \{/, "Seats derives its one status from the matrix");
  assert.match(source, /pending: busy/, "a change in flight is the pending state");
  assert.match(source, /refused: outcome === "refused"/, "a refused change is the refused state");
  assert.match(source, /useEffect\(\(\) => onStatus\?\.\(status\), \[status\.state, status\.text\]\)/, "Seats reports each status change");
});
