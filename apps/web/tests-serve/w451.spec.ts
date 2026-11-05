process.env["NODE_ENV"] = "test";

import { expect, test } from "@playwright/test";
import { runGreenlight } from "@bisellium/commands/writes.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;

async function forcePoll(instance: { baseURL: string }): Promise<void> {
  const response = await fetch(`${instance.baseURL}/api/_poll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (response.status !== 200) throw new Error(`/api/_poll answered ${response.status}`);
}

function setOpusState(path: string, from: string, to: string): void {
  writeFileSync(path, readFileSync(path, "utf8").replace(`state: ${from}`, `state: ${to}`));
}

async function expectFocusedAndVisible(page: import("@playwright/test").Page, message: string): Promise<void> {
  expect(await page.evaluate(() => document.activeElement === document.body), `${message}: focus never falls to body`).toBe(false);
  const focused = page.locator(":focus");
  await expect(focused, `${message}: one destination owns focus`).toHaveCount(1);
  await expect(focused, `${message}: the destination is visible`).toBeVisible();
  const box = await focused.boundingBox();
  expect(box, `${message}: the destination has rendered geometry`).not.toBeNull();
  expect(box!.x + box!.width, `${message}: the destination reaches the viewport`).toBeGreaterThan(0);
  expect(box!.x, `${message}: the destination starts before the viewport ends`).toBeLessThan(page.viewportSize()!.width);
  expect(box!.y + box!.height, `${message}: the destination reaches the vertical viewport`).toBeGreaterThan(0);
  expect(box!.y, `${message}: the destination starts before the vertical viewport ends`).toBeLessThan(page.viewportSize()!.height);
}

const boardActionFixture = {
  officina: {
    studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], wip_limit: 4,
    probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
    lifecycle: { id: "opus", states: [
      { id: "backlog", name: "Backlog", phase: "backlog" },
      { id: "greenlit", name: "Greenlit", phase: "planned" },
      { id: "building", name: "Building", phase: "in_progress" },
      { id: "done", name: "Done", phase: "done" },
    ] },
  },
  opera: [
    { id: "W-1", title: "W-1 title", body: "", kind: "ui", collegium: "design", sella: "builder", state: "backlog", tokens: 0, probationes: { patron: { status: "pending" } }, traditio: undefined },
    { id: "W-2", title: "W-2 title", body: "", kind: "ui", collegium: "design", sella: "builder", state: "building", tokens: 0, probationes: { patron: { status: "pending", at: "2026-10-27T00:00:00Z" } }, traditio: undefined },
  ],
  inbox: {
    opera: [{ id: "W-2", title: "W-2 title", collegium: "design", sella: "builder" }],
    petitiones: [{ id: "P-1", opus: "W-1", from: "producer", opened: Date.UTC(2026, 9, 27), subject: "First decision", body: "First question" }],
  },
};

async function installBoardActionFixture(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: boardActionFixture.officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: boardActionFixture.opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: boardActionFixture.inbox }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: [] }));
}

async function expectModifiedEnterKeepsInbox(
  page: import("@playwright/test").Page,
  link: import("@playwright/test").Locator,
  label: string,
): Promise<void> {
  await link.focus();
  await page.keyboard.press("Control+Enter");
  await expect(page, `${label}: Control+Enter leaves the current tab at Inbox`).toHaveURL(/#\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true }), `${label}: Control+Enter keeps the Inbox screen`).toBeVisible();

  await link.focus();
  // Linux Chromium natively follows Meta+Enter, so synthesize it to isolate the window listener.
  await link.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })));
  await expect(page, `${label}: Meta+Enter leaves the current tab at Inbox`).toHaveURL(/#\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true }), `${label}: Meta+Enter keeps the Inbox screen`).toBeVisible();
}

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-451-b1 pasted and Inbox work links open a durable Board drawer at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w451-b1");
  await seedToken(page, served);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    await page.goto(`${served.baseURL}/?w451=b1-paste-${width}#/board/W-004`);
    await expect(page.getByRole("dialog", { name: "Inventory drag-and-drop" }), `${width}: a pasted existing id opens its drawer`).toBeVisible();
    await page.locator(".board-drawer__close").click();
    await expect(page, `${width}: explicit close returns to the closed Board route`).toHaveURL(/#\/board$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto(`${served.baseURL}/?w451=b1-history-${width}#/board`);
    await page.locator('[data-card-id="W-004"]').click();
    await expect(page, `${width}: a Board card writes its durable route`).toHaveURL(/#\/board\/W-004$/);
    await page.goBack();
    await expect(page, `${width}: Back closes the route-owned drawer`).toHaveURL(/#\/board$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goForward();
    await expect(page.getByRole("dialog", { name: "Inventory drag-and-drop" }), `${width}: Forward reopens the same drawer`).toBeVisible();

    await page.goto(`${served.baseURL}/?w451=b1-inbox-${width}#/inbox`);
    const workLink = page.locator('.inbox__item[href^="#/board/"]').first();
    await expect(workLink, `${width}: Inbox exposes a real work-item link`).toBeVisible();
    const href = await workLink.getAttribute("href");
    expect(href, `${width}: Inbox href is canonical`).toMatch(/^#\/board\/W-\d+$/);
    const popupPromise = page.context().waitForEvent("page");
    await workLink.click({ modifiers: ["Control"] });
    const popup = await popupPromise;
    await expect(page, `${width}: a modified Inbox link click leaves the current tab in Inbox`).toHaveURL(/#\/inbox$/);
    await popup.close();
    await workLink.click();
    await expect(page, `${width}: the Inbox link remains in the address bar`).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.getByRole("dialog"), `${width}: the linked existing opus opens`).toBeVisible();

    await page.goto(`${served.baseURL}/?w451=b1-missing-${width}#/board/W-999`);
    await expect(page.getByText("Work item W-999 was not found.", { exact: true }), `${width}: an unknown id is explicit`).toBeVisible();
    await expect(page.getByRole("dialog"), `${width}: an unknown id never opens an empty drawer`).toHaveCount(0);

    await page.goto(`${served.baseURL}/?w451=b1-malformed-${width}#/board/not-an-opus`);
    const malformedNotice = page.getByText("That Board link is not valid.", { exact: true });
    await expect(malformedNotice, `${width}: a malformed Board link is explicit and unclipped`).toBeVisible();
    const malformedBox = await malformedNotice.boundingBox();
    expect(malformedBox, `${width}: the malformed notice has rendered geometry`).not.toBeNull();
    expect(malformedBox!.x, `${width}: the malformed notice starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(malformedBox!.y, `${width}: the malformed notice starts below the viewport top`).toBeGreaterThanOrEqual(0);
    expect(malformedBox!.x + malformedBox!.width, `${width}: the malformed notice ends inside the viewport`).toBeLessThanOrEqual(width);
    expect(malformedBox!.y + malformedBox!.height, `${width}: the malformed notice ends inside the viewport`).toBeLessThanOrEqual(900);
    await expect(page.getByRole("dialog"), `${width}: a malformed Board link opens no drawer`).toHaveCount(0);
  }
});

test("W-451-b1 modified Enter keeps the focused Inbox Board link in its current tab", async ({ page }) => {
  served = await startServed("w451-b1-modified-enter");
  await seedToken(page, served);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${served.baseURL}/?w451=b1-Control+Enter#/inbox`);
  const controlWorkLink = page.locator('.inbox__item[href^="#/board/"]').first();
  await controlWorkLink.focus();
  await page.keyboard.press("Control+Enter");
  await expect(page, "Control+Enter: modified activation leaves the current tab at Inbox").toHaveURL(/#\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true }), "Control+Enter: modified activation keeps the Inbox screen").toBeVisible();

  await page.goto(`${served.baseURL}/?w451=b1-Meta+Enter#/inbox`);
  const metaWorkLink = page.locator('.inbox__item[href^="#/board/"]').first();
  await metaWorkLink.focus();
  // Linux Chromium natively follows Meta+Enter, so synthesize it to isolate the window listener.
  await metaWorkLink.evaluate((link) => link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })));
  await expect(page, "Meta+Enter: modified activation leaves the current tab at Inbox").toHaveURL(/#\/inbox$/);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true }), "Meta+Enter: modified activation keeps the Inbox screen").toBeVisible();

  await page.goto(`${served.baseURL}/?w451=b1-plain-enter#/inbox`);
  const workLink = page.locator('.inbox__item[href^="#/board/"]').first();
  await workLink.focus();
  await page.keyboard.press("Enter");
  await expect(page, "plain Enter routes the current tab").toHaveURL(/#\/board\/W-\d+$/);
  await expect(page.getByRole("dialog"), "plain Enter opens the linked Board drawer").toBeVisible();
});

test("W-451-b1 modified Enter keeps the Open Board drawer action in its current tab", async ({ page }) => {
  served = await startServed("w451-b1-modified-enter-drawer");
  await seedToken(page, served);
  await installBoardActionFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w451=b1-modified-enter-drawer#/inbox`);
  await page.locator('.inbox__item[href^="#/board/"]').focus();
  const drawerLink = page.getByRole("link", { name: "Open Board drawer" });
  await expect(drawerLink).toBeVisible();
  await expectModifiedEnterKeepsInbox(page, drawerLink, "Open Board drawer");
});

test("W-451-b1 modified Enter keeps the Open Board actions state in its current tab", async ({ page }) => {
  served = await startServed("w451-b1-modified-enter-actions");
  await seedToken(page, served);
  await installBoardActionFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w451=b1-modified-enter-actions#/inbox`);
  const petitionRow = page.locator(".inbox__item", { hasText: "First decision" });
  await petitionRow.focus();
  const actionsLink = page.getByRole("link", { name: "Open Board actions" });
  await expect(actionsLink).toBeVisible();
  const readState = await petitionRow.getAttribute("class");
  const detailState = await page.locator(".inbox").getAttribute("class");
  await expectModifiedEnterKeepsInbox(page, actionsLink, "Open Board actions");
  await expect(petitionRow, "Open Board actions leaves the petition read state unchanged").toHaveAttribute("class", readState ?? "");
  await expect(page.locator(".inbox"), "Open Board actions leaves the detail state unchanged").toHaveAttribute("class", detailState ?? "");
});

test("W-451-b1 a pasted returned opus with no lifecycle column stays open after refetch", async ({ page }) => {
  served = await startServed("w451-b1-unplaced", {
    prepareStudio: (studioDir) => {
      const path = join(studioDir, "opera", "W-006.md");
      writeFileSync(path, readFileSync(path, "utf8").replace("state: greenlit", "state: unplaced-test"));
    },
  });
  await seedToken(page, served);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w451=b1-unplaced#/board/W-006`);
  await expect(page.getByRole("dialog", { name: "Guild chat" }), "a pasted returned opus with no lifecycle column opens its drawer").toBeVisible();
  const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  const unplacedPath = join(served.studioDir, "opera", "W-006.md");
  const refetched = page.waitForResponse((response) => response.url().endsWith("/api/opera") && response.request().method() === "GET");
  writeFileSync(unplacedPath, readFileSync(unplacedPath, "utf8").replace("title: Guild chat", "title: Guild chat after refetch"));
  const greenlight = runGreenlight(["W-007", "--studio", served.studioDir]);
  expect(greenlight.exitCode).toBe(0);
  await forcePoll(served);
  await refetched;
  await expect(page.getByRole("dialog", { name: "Guild chat after refetch" }), "an unplaced returned opus stays open after a refetch").toBeVisible();
  await expect(page, "an unplaced returned opus keeps its durable route after a refetch").toHaveURL(/#\/board\/W-006$/);
  expect(await page.evaluate(() => performance.timeOrigin), "the row refetches while open without reloading the document").toBe(documentTimeOrigin);
});

test("W-451-b1 Back and Forward keep a returned filtered opus route-owned", async ({ page }) => {
  served = await startServed("w451-b1-filter-history");
  await seedToken(page, served);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w451=b1-filter-history#/board`);
  await page.locator('[data-card-id="W-001"]').click();
  await expect(page).toHaveURL(/#\/board\/W-001$/);
  await page.goBack();
  await page.getByLabel("Choose which tasks to show").selectOption("blocked");
  await expect(page.locator('[data-card-id="W-001"]'), "the filter hides the route target's card").toHaveCount(0);
  await page.goForward();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("dialog", { name: "Save-slot migration" }), "Forward keeps a returned filtered opus open").toBeVisible();
  await expect(page, "Forward keeps the filtered opus route").toHaveURL(/#\/board\/W-001$/);
});

test("W-451-b1 Close exposes the same closed-Board Back step and consumes the drawer Forward entry", async ({ page }) => {
  served = await startServed("w451-b1-close-history");
  await seedToken(page, served);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w451=b1-close-history#/board`);
  await page.locator('[data-card-id="W-004"]').click();
  await expect(page).toHaveURL(/#\/board\/W-004$/);
  await page.locator(".board-drawer__close").click();
  await expect(page, "Close replaces the drawer entry with bare Board").toHaveURL(/#\/board$/);
  await page.goBack();
  await expect(page, "the first Back can show the same closed Board").toHaveURL(/#\/board$/);
  await expect(page.getByRole("dialog"), "Back does not recover the replaced drawer entry").toHaveCount(0);
  await page.goForward();
  await expect(page, "Forward also shows closed Board because Close replaced the drawer entry").toHaveURL(/#\/board$/);
  await expect(page.getByRole("dialog"), "Forward cannot reopen the replaced drawer entry").toHaveCount(0);
});

test("W-451-b1 Close and Escape restore visible Board focus after route-state changes", async ({ page }) => {
  test.setTimeout(120_000);
  served = await startServed("w451-b1-close-focus", {
    prepareStudio: (studioDir) => setOpusState(join(studioDir, "opera", "W-006.md"), "greenlit", "unplaced-test"),
  });
  await seedToken(page, served);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    await page.goto(`${served.baseURL}/?w451=b1-focus-moved-${width}#/board`);
    const originalMovedCard = page.locator('[data-card-id="W-002"]');
    const originalColumnId = await originalMovedCard.getAttribute("data-column-id");
    expect(originalColumnId).not.toBeNull();
    await originalMovedCard.click();
    setOpusState(join(served.studioDir, "opera", "W-002.md"), "building", "review");
    await forcePoll(served);
    const movedCard = page.locator('[data-card-id="W-002"]');
    await expect(movedCard, `${width}: the open opus moves to its current lifecycle column`).toHaveCount(1);
    await expect(movedCard, `${width}: the current placement differs from the opening placement`).not.toHaveAttribute("data-column-id", originalColumnId!);
    await page.locator(".board-drawer__close").click();
    await expect(movedCard, `${width}: Close focuses the moved opus's current card`).toBeFocused();
    await expectFocusedAndVisible(page, `${width}: moved opus Close`);
    setOpusState(join(served.studioDir, "opera", "W-002.md"), "review", "building");
    await forcePoll(served);

    await page.goto(`${served.baseURL}/?w451=b1-focus-filtered-${width}#/board`);
    const filteredCard = page.locator('[data-card-id="W-001"]');
    const formerColumnId = await filteredCard.getAttribute("data-column-id");
    expect(formerColumnId).not.toBeNull();
    await filteredCard.click();
    await page.getByLabel("Choose which tasks to show").selectOption("blocked", { force: true });
    await expect(filteredCard, `${width}: the local filter hides the selected card`).toHaveCount(0);
    await page.keyboard.press("Escape");
    const formerColumnFallback = page.locator(`[data-column-id="${formerColumnId}"]`).locator(":focus");
    await expect(formerColumnFallback, `${width}: Escape focuses a card or head in the former column`).toHaveCount(1);
    await expectFocusedAndVisible(page, `${width}: filtered opus Escape`);

    await page.goto(`${served.baseURL}/?w451=b1-focus-unplaced-${width}#/board/W-006`);
    await expect(page.getByRole("dialog", { name: "Guild chat" })).toBeVisible();
    await page.locator(".board-drawer__close").click();
    const firstVisibleColumn = page.locator(".board__column").first();
    await expect(firstVisibleColumn.locator(":focus"), `${width}: unplaced Close chooses the deterministic first visible column`).toHaveCount(1);
    await expectFocusedAndVisible(page, `${width}: unplaced opus Close`);
  }
});

test("W-451-b2 the narrow menu opens on the current page at 640 and 390", async ({ page }) => {
  served = await startServed("w451-b2");
  await seedToken(page, served);
  for (const width of [640, 390] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["inbox", "board", "seats", "officina"] as const) {
      await page.goto(`${served.baseURL}/?w451=b2-${width}-${route}#/${route}`);
      await page.locator(".sidebar__toggle").click();
      await expect(page.locator(`.sidebar__link[href="#/${route}"]`), `${width} ${route}: current page receives focus`).toBeFocused();
      await page.keyboard.press("Escape");
    }
  }
});
