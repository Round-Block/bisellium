import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardModel, type DrawerDetail } from "../src/lib/board.js";
import { BoardDrawer } from "../src/screens/BoardDrawer.js";
import "./support/register-css-stub.mjs";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const lifecycle = {
  id: "opus",
  states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Awaiting review", phase: "awaiting_review" },
    { id: "done", name: "Done", phase: "done" },
    { id: "halted", name: "Halted", phase: "halted" },
  ],
};
const declared = [
  { id: "spec", name: "Spec", kind: "agent" },
  { id: "tests", name: "Tests", kind: "automated" },
  { id: "review", name: "Lead review", kind: "agent" },
  { id: "qa", name: "QA verdict", kind: "agent" },
  { id: "served", name: "Served browser row", kind: "automated" },
  { id: "patron", name: "Patron call", kind: "human" },
];
const opus = (id: string, state: string, probationes: Record<string, { status: string }>) => ({
  id, title: `${id} title`, body: "record description", kind: "ui", collegium: "design", sella: "builder",
  state, tokens: 0, probationes, traditio: undefined,
});

test("W-493-b1 behaviour 1: lifecycle cards state gate progress in words and Planned cards omit it", async () => {
  const some = { spec: { status: "passed" }, tests: { status: "waived" }, review: { status: "passed" } };
  const all = Object.fromEntries(declared.map(({ id }) => [id, { status: "passed" }]));
  const model = boardModel(
    { lifecycle, probationes: declared },
    [
      opus("W-0", "backlog", some),
      opus("W-1", "greenlit", some),
      opus("W-2", "building", some),
      opus("W-3", "verifying", {}),
      opus("W-4", "review", some),
      opus("W-5", "done", all),
      opus("W-6", "halted", {}),
    ],
  );
  const cards = model.columns.flatMap((column) => column.cards.map((card) => ({ column: column.id, card })));
  assert.deepEqual(cards.find(({ card }) => card.id === "W-2")?.card.gateProgress, { cleared: 3, total: 6, next: "QA verdict" }, "three cleared gates name QA verdict as the next declared gate");
  assert.deepEqual(cards.find(({ card }) => card.id === "W-3")?.card.gateProgress, { cleared: 0, total: 6, next: "Spec" }, "zero cleared gates name the first declared gate");
  assert.deepEqual(cards.find(({ card }) => card.id === "W-5")?.card.gateProgress, { cleared: 6, total: 6 }, "all cleared gates have no invented next gate");
  assert.equal(cards.find(({ card }) => card.id === "W-1")?.column, "planned", "the Planned omission is presentation, not a lifecycle reclassification");
  assert.deepEqual(
    model.columns.flatMap((column) => column.cards.map((card) => card.id)).sort(),
    ["W-0", "W-1", "W-2", "W-3", "W-4", "W-5", "W-6"],
    "each lifecycle phase keeps its opus on the Board",
  );
  const noGates = boardModel({ lifecycle, probationes: [] }, [opus("W-7", "building", {})]);
  assert.deepEqual(noGates.columns.flatMap(({ cards }) => cards)[0]?.gateProgress, { cleared: 0, total: 0 }, "a studio with no declared gates reports an empty total");
  const { BoardView } = await import("../src/screens/BoardView.js");
  const markup = renderToStaticMarkup(React.createElement(BoardView, {
    studio: "sample",
    model,
    focusedByColumn: {},
    onSelectCard: () => undefined,
  }));
  assert.match(markup, /class="board__card-title" title="W-2 title"/, "rendered card title keeps its complete native affordance");
  const planned = /data-column-id="planned">[\s\S]*?(?=<div class="board__column"|<div class="board__scroll-cue")/.exec(markup)?.[0];
  assert.ok(planned !== undefined && !planned.includes("board__card-gates"), "rendered Planned cards omit the gate-progress line");
});

test("W-493-css served progress line keeps one line, ellipsis and card containment", async () => {
  const built = spawnSync("npm", ["run", "-s", "build", "--workspace", "@bisellium/web"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(built.status, 0, `the served CSS pin builds its own bundle: ${`${built.stdout ?? ""} ${built.stderr ?? ""}`.trim().slice(-800)}`);
  const dist = resolve(process.cwd(), "apps/web/dist");
  const contentType = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".woff2", "font/woff2"]]);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const candidate = join(dist, relative);
    const file = candidate.startsWith(`${dist}/`) ? candidate : join(dist, "index.html");
    try {
      response.setHeader("content-type", contentType.get(extname(file)) ?? "application/octet-stream");
      response.end(await readFile(file));
    } catch {
      response.setHeader("content-type", "text/html");
      response.end(await readFile(join(dist, "index.html")));
    }
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "the served CSS pin obtains a loopback port");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const longGate = `A deliberately long next gate name ${"that must remain contained ".repeat(8)}`;
    const servedDeclared = declared.map((gate) => gate.id === "served" ? { ...gate, name: longGate } : gate);
    const servedOpera = [
      opus("W-1", "greenlit", {}),
      opus("W-3", "verifying", { spec: { status: "passed" }, tests: { status: "waived" }, review: { status: "passed" }, qa: { status: "passed" } }),
    ];
    await page.route("**/api/officina", (route) => route.fulfill({ json: { studio: "Sample", patron: "patron", collegia: [], sellae: [], wip_limit: 4, lifecycle, probationes: servedDeclared } }));
    await page.route("**/api/opera", (route) => route.fulfill({ json: servedOpera }));
    await page.route("**/api/inbox", (route) => route.fulfill({ json: { opera: [], petitiones: [] } }));
    await page.route("**/api/live*", (route) => route.fulfill({ contentType: "text/event-stream", body: "" }));
    const observed: Array<{ width: number; inside: boolean; oneLine: boolean; ellipsized: boolean; bounded: boolean; noPageOverflow: boolean; title: boolean }> = [];
    for (const width of [1280, 640, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://127.0.0.1:${address.port}/#/board`);
      const line = page.locator('[data-card-id="W-3"] .board__card-gates');
      await line.waitFor();
      observed.push(await line.evaluate((node, measuredWidth) => {
        const element = node as HTMLElement;
        const card = element.closest<HTMLElement>(".board__card")!;
        const box = element.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: measuredWidth,
          inside: box.left >= cardBox.left - 0.5 && box.right <= cardBox.right + 0.5 && box.top >= cardBox.top && box.bottom <= cardBox.bottom,
          oneLine: box.height === Number.parseFloat(style.lineHeight),
          ellipsized: element.scrollWidth > element.clientWidth && style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap",
          bounded: cardBox.height <= 108,
          noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          title: element.title === element.textContent,
        };
      }, width));
    }
    assert.deepEqual(
      observed,
      [1280, 640, 390].map((width) => ({ width, inside: true, oneLine: true, ellipsized: true, bounded: true, noPageOverflow: true, title: true })),
      "served progress line keeps one line, ellipsis and card containment",
    );
  } finally {
    await browser.close();
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
});

test("W-493-b2 behaviour 2: the record description is the drawer's first detail section", () => {
  const detail: DrawerDetail = {
    id: "W-2",
    title: "Rendered drawer",
    state: "building",
    body: "The record description comes first.",
    gates: declared.map(({ id, name }) => ({ id, name, status: "pending", human: false })),
    record: [],
    tokensBySella: [],
    events: [],
  };
  const markup = renderToStaticMarkup(React.createElement(BoardDrawer, { detail, onClose: () => undefined }));
  const order = ["board-drawer__header", "board-drawer__record", "board-drawer__gates", "board-drawer__events"].map((className) => markup.indexOf(className));
  assert.ok(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]!)), "rendered record description follows the header before named gates and events");
  assert.deepEqual(
    declared.filter(({ name }) => markup.includes(`>${name}<`)).map(({ name }) => name),
    declared.map(({ name }) => name),
    "rendered drawer keeps the complete named gate list",
  );
  assert.match(markup, /board-drawer__record-body">The record description comes first\.<\/div>/, "rendered drawer preserves the authored record description");
});
