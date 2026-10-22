import { expect, test } from "@playwright/test";
import { CAPTURE_NOW, expectCapturedScreenSettled, freezeCaptureClock } from "./capture-state.js";
import { startServed, type ServedInstance } from "./harness.js";

let served: ServedInstance | undefined;
test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-360-b1 the capture clock fixes browser-owned dates at the ruled instant", async ({ page }) => {
  await freezeCaptureClock(page);
  expect(await page.evaluate(() => new Date().toISOString()), "the browser wall clock is fixed before a screen loads").toBe(CAPTURE_NOW);
});

test("W-360-b2 a mounted Board does not settle while its served cards are still loading", async ({ page }) => {
  let sawOpera!: () => void;
  const operaRequested = new Promise<void>((resolve) => {
    sawOpera = resolve;
  });
  let releaseOpera!: () => void;
  const holdOpera = new Promise<void>((resolve) => {
    releaseOpera = resolve;
  });

  await page.route("**/api/opera", async (route) => {
    sawOpera();
    await holdOpera;
    await route.continue();
  });
  served = await startServed("w360-loaded-board", { now: CAPTURE_NOW });
  await freezeCaptureClock(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${served.baseURL}/#/board`);
  await page.locator("#token-prompt-input").fill(served.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();

  let settled = false;
  const wait = expectCapturedScreenSettled(page, "board").then(() => {
    settled = true;
  });
  await operaRequested;
  try {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(settled, "screen mount alone cannot release the capture gate").toBe(false);
  } finally {
    releaseOpera();
    await wait;
  }
  await expect(page.locator(".board"), "the released gate leaves no placeholder over the cards").not.toContainText("Loading the board…");
});

test("W-360-b2 Board waits for its inbox read at both capture widths", async ({ page }) => {
  for (const width of [1280, 390] as const) {
    let sawInbox!: () => void;
    const inboxRequested = new Promise<void>((resolve) => {
      sawInbox = resolve;
    });
    let releaseInbox!: () => void;
    const holdInbox = new Promise<void>((resolve) => {
      releaseInbox = resolve;
    });
    await page.route("**/api/inbox", async (route) => {
      sawInbox();
      await holdInbox;
      await route.continue();
    });
    served = await startServed(`w360-board-inbox-${width}`, { now: CAPTURE_NOW });
    await freezeCaptureClock(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/#/board`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    let settled = false;
    const wait = expectCapturedScreenSettled(page, "board").then(() => {
      settled = true;
    });
    await inboxRequested;
    try {
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(settled, `Board ${width}: inbox must settle before capture`).toBe(false);
    } finally {
      releaseInbox();
      await wait;
      await page.unroute("**/api/inbox");
      await served.close();
      served = undefined;
    }
    await expect(page.locator('.shell__status[data-state="live"]'), `Board ${width}: the completed shell is live`).toHaveCount(1);
  }
});

test("W-360-b2 Seats waits for its models read at both capture widths", async ({ page }) => {
  for (const width of [1280, 390] as const) {
    let sawModels!: () => void;
    const modelsRequested = new Promise<void>((resolve) => {
      sawModels = resolve;
    });
    let releaseModels!: () => void;
    const holdModels = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });
    await page.route("**/api/models", async (route) => {
      sawModels();
      await holdModels;
      await route.continue();
    });
    served = await startServed(`w360-seats-models-${width}`, { now: CAPTURE_NOW });
    await freezeCaptureClock(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    let settled = false;
    const wait = expectCapturedScreenSettled(page, "seats").then(() => {
      settled = true;
    });
    await modelsRequested;
    try {
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(settled, `Seats ${width}: models must settle before capture`).toBe(false);
    } finally {
      releaseModels();
      await wait;
      await page.unroute("**/api/models");
      await served.close();
      served = undefined;
    }
    const builder = page.locator('select[aria-label="model for seat builder"]');
    await expect(builder).toHaveValue("claude-sonnet-5");
    await expect(builder.locator("option:checked"), `Seats ${width}: selected model identity is rendered`).toContainText("claude-sonnet-5");
  }
});
