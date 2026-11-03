import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardModel, drawerDetail } from "../src/lib/board.js";
import { BoardDrawer } from "../src/screens/BoardDrawer.js";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { startServed } from "../tests-serve/harness.js";

(globalThis as { React?: unknown }).React = React;

test("W-499-b1 behaviour 1: opened lifecycle column aligns and the most recent open restores", async () => {
  const boardSource = readFileSync(new URL("../src/screens/Board.tsx", import.meta.url), "utf8");
  const boardCss = readFileSync(new URL("../src/components/w025.css", import.meta.url), "utf8");
  assert.match(
    boardSource,
    /const target = columns\?\.querySelector<HTMLElement>[\s\S]*target\.offsetLeft - inset/,
    "drawer alignment derives a clamped target from the opened lifecycle column",
  );
  assert.match(
    boardSource,
    /const target = columns\?\.querySelector<HTMLElement>[\s\S]*if \(!columns \|\| !target\) return;/,
    "an item without a lifecycle column leaves the current track position unchanged",
  );
  assert.match(
    boardSource,
    /const closedMax = Math\.max\(0, scrollEl\.scrollWidth - scrollEl\.clientWidth\);[\s\S]*Math\.min\(closedMax, Math\.max\(0, pending\.scrollLeft\)\)/,
    "Close clamps the latest browser-reported snapshot to the closed layout's range",
  );
  assert.match(
    boardCss,
    /--board-columns-left-clip: calc\(var\(--sp-6\) - 4px\);[\s\S]*clip-path: inset\(0 0 0 var\(--board-columns-left-clip\)\)[\s\S]*\.board__column-cards \{[\s\S]*margin: -4px;[\s\S]*padding: 4px;/,
    "both track and card scroller preserve the focus ring's four-pixel reach on all four sides",
  );
  const built = spawnSync("npm", ["run", "-s", "build", "--workspace", "@bisellium/web"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(built.status, 0, `the served geometry pin builds its own bundle: ${`${built.stdout ?? ""} ${built.stderr ?? ""}`.trim().slice(-800)}`);
  const served = await startServed("w499-b1-node");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${served.baseURL}/?w499=b1-node#/board`);
    const prompt = page.locator("#token-prompt-input");
    if (await prompt.isVisible()) {
      await prompt.fill(served.token);
      await page.locator(".token-prompt__submit").click();
    }
    await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "expanded"));
    await page.reload();
    const columns = page.locator(".board__columns");
    const expectedFor = (columnId: string): Promise<{ actual: number; expected: number }> => page.evaluate((id) => {
      const track = document.querySelector<HTMLElement>(".board__columns")!;
      const target = track.querySelector<HTMLElement>(`[data-column-id="${id}"]`)!;
      const inset = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      return { actual: track.scrollLeft, expected: Math.min(max, Math.max(0, target.offsetLeft - inset)) };
    }, columnId);

    const terminal = page.locator('[data-card-id="W-001"]');
    await columns.evaluate((node) => { node.scrollLeft = 164; });
    await terminal.evaluate((node) => (node as HTMLElement).click());
    await page.locator(".board-drawer").waitFor();
    const first = await expectedFor("done");
    assert.equal(first.actual, first.expected, "opened lifecycle column aligns to the lifecycle viewport inset");

    const later = page.locator('[data-card-id="W-004"]');
    await later.evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const mostRecent = await later.evaluate((node) => new Promise<number>((resolve) => {
      node.addEventListener("click", () => {
        const track = node.closest(".board__columns") as HTMLElement;
        track.scrollLeft = track.scrollLeft;
        resolve(track.scrollLeft);
      }, { once: true });
      (node as HTMLElement).click();
    }));
    const second = await expectedFor("awaiting_review");
    assert.equal(second.actual, second.expected, "a second open aligns its own later lifecycle column");
    await page.locator(".board-drawer__close").click();
    await page.locator(".board-drawer").waitFor({ state: "hidden" });
    const closedMax = await columns.evaluate((node) => Math.max(0, node.scrollWidth - node.clientWidth));
    assert.equal(await columns.evaluate((node) => node.scrollLeft), Math.min(mostRecent, closedMax), "Close restores the latest browser-reported position within the closed range");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-card-id")), "W-004", "Close returns focus to the latest opener");
  } finally {
    await browser.close();
    await served.close();
  }
});

test("W-499-b2 behaviour 2: Why it waits states each reason once", () => {
  const question = "Drag-and-drop grew a second screen (split stacks). Accept the scope drift and ship both, or cut split stacks to a new item?";
  const officina: Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit"> = {
    lifecycle: { id: "opus", states: [{ id: "review", name: "Review", phase: "awaiting_review" }] },
    probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
    wip_limit: 4,
  };
  const opus: OpusEntry = {
    id: "W-004", title: "Inventory drag-and-drop", body: "Record body", kind: "ui", collegium: "design",
    sella: "builder", state: "review", tokens: 0, probationes: { patron: { status: "pending" } },
    traditio: { next: question, blocked_on: "patron" },
  };
  const inbox: Pick<InboxResponse, "opera" | "petitiones"> = {
    opera: [{ id: opus.id, title: opus.title, collegium: opus.collegium, sella: opus.sella }],
    petitiones: [
      { id: "P-1", opus: opus.id, from: "eng-lead", subject: "Drag-and-drop grew a second screen (split stacks). Accept the scope drift and ship both, or cut split stacks to a new…", body: question },
      { id: "P-2", opus: opus.id, from: "producer", subject: "Call", body: "Patron call is pending." },
      { id: "P-3", opus: opus.id, from: "producer", subject: "Explicit subject fallback", body: "   " },
    ],
  };
  const card = boardModel(officina, [opus], inbox).waiting[0];
  const detail = drawerDetail(opus, officina, inbox, [], card);
  assert.deepEqual(
    detail.waitingReasons,
    [
      { text: question, from: "eng-lead" },
      { text: "Patron call is pending.", from: "producer" },
      { text: "Explicit subject fallback", from: "producer" },
    ],
    "petitio bodies contribute one exact attributed bullet apiece without lower-priority restatements",
  );
  assert.equal(detail.waitingReasons?.[0]?.text, question, "the complete long question is not replaced by its capped subject");
});

test("W-499-b3 behaviour 3: the 640 drawer takes the content row and restores its mounted Board", async () => {
  const boardSource = readFileSync(new URL("../src/screens/Board.tsx", import.meta.url), "utf8");
  const boardCss = readFileSync(new URL("../src/components/w025.css", import.meta.url), "utf8");
  assert.match(
    boardCss,
    /@media \(max-width: 640px\) \{[\s\S]*\.board-workspace:has\(\.board-drawer\) \{\s*grid-template-columns: minmax\(0, 1fr\) 100%;/,
    "the 640 drawer owns the full content row while the Board remains mounted in its zero-width grid cell",
  );
  assert.match(
    boardSource,
    /window\.matchMedia\("\(max-width: 640px\)"\)[\s\S]*inert=\{selected !== undefined && boardTrackCollapsed\}/,
    "the mounted Board becomes inert at the full-drawer breakpoint",
  );

  const built = spawnSync("npm", ["run", "-s", "build", "--workspace", "@bisellium/web"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(built.status, 0, `the 640 served pin builds its own bundle: ${`${built.stdout ?? ""} ${built.stderr ?? ""}`.trim().slice(-800)}`);
  const served = await startServed("w499-b3-node");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
    await page.goto(`${served.baseURL}/?w499=b3-node#/board`);
    const prompt = page.locator("#token-prompt-input");
    if (await prompt.isVisible()) {
      await prompt.fill(served.token);
      await page.locator(".token-prompt__submit").click();
    }
    const board = page.locator(".board");
    const opener = page.locator('[data-card-id="W-004"]');
    await opener.evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
    await opener.evaluate((node) => (node as HTMLElement).click());
    await page.locator(".board-drawer").waitFor();
    const geometry = await page.evaluate(() => ({
      workspace: document.querySelector<HTMLElement>(".board-workspace")!.getBoundingClientRect().width,
      board: document.querySelector<HTMLElement>(".board")!.getBoundingClientRect().width,
      drawer: document.querySelector<HTMLElement>(".board-drawer")!.getBoundingClientRect().width,
      inert: document.querySelector<HTMLElement>(".board")!.hasAttribute("inert"),
    }));
    assert.equal(geometry.board, 0, "the mounted Board is entirely out of view at 640");
    assert.equal(geometry.drawer, geometry.workspace, "the drawer receives the full available content width at 640");
    assert.equal(geometry.inert, true, "the out-of-view Board is unavailable to keyboard interaction");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("board-drawer__close")), true, "the visible Close control receives focus");
    await page.locator(".board-drawer__close").click();
    await page.locator(".board-drawer").waitFor({ state: "hidden" });
    assert.equal(await board.evaluate((node) => node.getBoundingClientRect().width), geometry.workspace, "Close restores the Board to the content row");
    assert.equal(await board.evaluate((node) => node.hasAttribute("inert")), false, "Close restores Board keyboard availability");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-card-id")), "W-004", "Close restores focus to the opener");
  } finally {
    await browser.close();
    await served.close();
  }
});

test("W-499-b4 behaviour 4: the banner routes plainly and reasons choose one source", () => {
  const officina: Pick<OfficinaResponse, "probationes"> = {
    probationes: [
      { id: "patron", name: "Patron call", kind: "human" },
      { id: "copy", name: "Patron call", kind: "human" },
    ],
  };
  const makeOpus = (traditio: unknown, probationes: OpusEntry["probationes"]): OpusEntry => ({
    id: "W-004", title: "Inventory drag-and-drop", body: "Record body", kind: "ui", collegium: "design",
    sella: "builder", state: "review", tokens: 0, probationes, traditio,
  });
  const waitingCard = { id: "W-004", title: "Inventory drag-and-drop", state: "review", gates: [], needsYou: true, blocked: false };
  const question = "Choose the reviewed scope.";
  const petitiones: InboxResponse["petitiones"] = [
    { id: "P-1", opus: "W-004", from: "eng-lead", subject: "Choose", body: `  ${question}  ` },
    { id: "P-2", opus: "W-004", from: "producer", subject: "Duplicate", body: question },
    { id: "P-3", opus: "W-004", from: "qa-lead", subject: "  Subject fallback  ", body: "   " },
  ];
  const petitionDetail = drawerDetail(
    makeOpus({ next: "lower-priority next" }, { patron: { status: "pending" } }),
    officina,
    { petitiones },
    [],
    waitingCard,
  );
  assert.deepEqual(
    petitionDetail.waitingReasons,
    [{ text: question, from: "eng-lead" }, { text: "Subject fallback", from: "qa-lead" }],
    "petitio reasons keep source order and first-sender attribution while lower-priority sources stay absent",
  );

  const nextDetail = drawerDetail(
    makeOpus({ next: "  Use the recorded handoff.  " }, { patron: { status: "pending" } }),
    officina,
    { petitiones: [{ id: "P-empty", opus: "W-004", from: "producer", subject: " ", body: " " }] },
    [],
    waitingCard,
  );
  assert.deepEqual(nextDetail.waitingReasons, [{ text: "Use the recorded handoff." }], "recorded next is chosen only when no petitio supplies usable text");

  const gateDetail = drawerDetail(
    makeOpus({ next: " " }, { patron: { status: "pending" }, copy: { status: "pending" } }),
    officina,
    { petitiones: [] },
    [],
    waitingCard,
  );
  assert.deepEqual(gateDetail.waitingReasons, [{ text: "Patron call is pending." }], "outstanding human-gate descriptions are the third source and collapse exact duplicates");

  const emptyDetail = drawerDetail(makeOpus({}, {}), officina, { petitiones: [] }, [], waitingCard);
  assert.deepEqual(emptyDetail.waitingReasons, [], "no usable source leaves the honest empty reason state");

  const petitionDrawer = renderToStaticMarkup(BoardDrawer({ detail: petitionDetail, onClose: () => undefined }));
  const petitionBanner = petitionDrawer.match(/<div class="board-drawer__banner">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(petitionBanner, /<span[^>]*>Waiting on you<\/span> —\s*<a[^>]*href="#\/inbox"[^>]*>Go to Inbox<\/a>/, "only the plain Go to Inbox navigation words are linked");
  assert.doesNotMatch(petitionBanner, /Choose the reviewed scope|eng-lead/, "the banner does not repeat the question or sender");
  const noPetitioDrawer = renderToStaticMarkup(BoardDrawer({ detail: gateDetail, onClose: () => undefined }));
  const noPetitioBanner = noPetitioDrawer.match(/<div class="board-drawer__banner">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(noPetitioBanner, /Waiting on you[\s\S]*no question recorded\./, "the no-petitio banner states that no question is recorded without a link");
  assert.doesNotMatch(noPetitioBanner, /<a(?![\p{L}\p{M}\p{N}])/u, "the no-petitio banner has no link");
  const emptyDrawer = renderToStaticMarkup(BoardDrawer({ detail: emptyDetail, onClose: () => undefined }));
  assert.match(emptyDrawer, /No waiting reason recorded\./, "no chosen source is stated honestly");
  const css = readFileSync(new URL("../src/components/w025.css", import.meta.url), "utf8");
  assert.match(css, /\.board-drawer__banner-link,[\s\S]*\.board-drawer__banner-link:visited[\s\S]*color:\s*var\(--ink\);[\s\S]*text-decoration:\s*underline;/, "the Inbox route is a plain underlined text link, not an evidence link");
});
