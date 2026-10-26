import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const ROUTES = ["inbox", "board", "seats", "officina"] as const;
test.setTimeout(120_000);
let served: ServedInstance | undefined;
test.afterEach(async () => { await served?.close(); served = undefined; });

async function signIn(page: Page, width: number, name: string): Promise<void> {
  served = await startServed(name);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served.baseURL}/?demo#/inbox`);
  await page.locator("#token-prompt-input").fill(served.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
}

async function expectInboxSubjectsContained(page: Page, width: number): Promise<void> {
  await expect.poll(() => page.locator(".inbox__row").count(), `${width}: adjacent Inbox rows are populated`).toBeGreaterThan(1);
  for (const row of await page.locator(".inbox__row").all()) {
    const subject = row.locator(".inbox__subject");
    const [rowBox, subjectBox] = await Promise.all([row.boundingBox(), subject.boundingBox()]);
    expect(subjectBox!.y, `${width}: subject stays inside its 40px row`).toBeGreaterThanOrEqual(rowBox!.y);
    expect(subjectBox!.y + subjectBox!.height, `${width}: subject does not cross the adjacent row`).toBeLessThanOrEqual(rowBox!.y + rowBox!.height + 1);
    await expect(subject, `${width}: subject keeps its single-line ellipsis`).toHaveCSS("white-space", "nowrap");
    await expect(subject).toHaveCSS("overflow", "hidden");
    await expect(subject).toHaveCSS("text-overflow", "ellipsis");
  }
}

test("W-415-b1 every screen collapses to D-119's icon rail at 1280 and 960", async ({ page }) => {
  for (const width of [1280, 960]) {
    await signIn(page, width, `w415-wide-${width}`);
    for (const route of ROUTES) {
      await page.goto(`${served!.baseURL}/?demo#/${route}`);
      const toggle = page.locator(".sidebar__toggle");
      await expect(toggle).toHaveAccessibleName("Collapse sidebar");
      const expanded = await page.locator(".shell__main").boundingBox();
      const expandedToggle = await toggle.boundingBox();
      await toggle.click();
      await expect(toggle).toHaveAccessibleName("Expand sidebar");
      await expect(page.locator(".sidebar__link")).toHaveCount(4);
      await expect(page.locator(".sidebar__link-text").first(), "rail labels are visually clipped but remain available to assistive technology").toHaveCSS("clip-path", "inset(50%)");
      const rail = await page.locator(".sidebar").boundingBox();
      const collapsed = await page.locator(".shell__main").boundingBox();
      const collapsedToggle = await toggle.boundingBox();
      expect(collapsedToggle, `${width} ${route}: toggle retains identical viewport coordinates`).toEqual(expandedToggle);
      expect(collapsedToggle!.x, `${width} ${route}: focus ring clears the left edge`).toBeGreaterThanOrEqual(2);
      expect(collapsedToggle!.y, `${width} ${route}: focus ring clears the top edge`).toBeGreaterThanOrEqual(2);
      expect(rail!.width, `${width} ${route}: D-119 rail is 48px`).toBeCloseTo(48, 0);
      expect(collapsed!.width, `${width} ${route}: main receives released width`).toBeGreaterThan(expanded!.width);
      await toggle.focus(); await toggle.press("Enter");
      await expect(toggle).toHaveAccessibleName("Collapse sidebar");
      await toggle.press("Space"); await expect(toggle).toHaveAccessibleName("Expand sidebar");
      await toggle.press("Enter");
    }
    await served!.close(); served = undefined;
  }
});

test("W-415-b1 D-120 puts the Inbox count in one collapsed-rail notification dot", async ({ page }) => {
  await signIn(page, 1280, "w415-icons");
  for (const route of ROUTES) {
    await page.goto(`${served!.baseURL}/?demo#/${route}`);
    await expect(page.locator(".sidebar__badge"), `${route}: expanded Inbox keeps its current inline count`).toHaveText("3");
    await expect(page.locator(".sidebar__badge")).not.toHaveClass(/sidebar__badge--dot/);
    await page.locator(".sidebar__toggle").click();
    const links = page.locator(".sidebar__link"); await expect(links).toHaveCount(4); await expect(links.locator(".sidebar__icon")).toHaveCount(4);
    for (const label of ["Inbox 3", "Board", "Seats", "Officina"]) await expect(page.getByRole("link", { name: label })).toBeVisible();
    await expect(page.locator(`.sidebar__link[href="#/${route}"]`), `${route}: current icon is marked`).toHaveAttribute("aria-current", "page");
    await expect(page.locator('.sidebar__link[href="#/inbox"]'), "collapsed Inbox has a native tooltip").toHaveAttribute("title", "Inbox");
    const inbox = page.locator('.sidebar__link[href="#/inbox"]');
    const dot = inbox.locator(".sidebar__badge--dot");
    await expect(dot, "D-120 nonzero count is the rail's notification dot").toHaveText("3");
    await expect(dot, "D-120 dot keeps the full count in accessible text").toHaveAccessibleName("Inbox, 3 needs you");
    await expect(dot, "D-120 dot uses the 11px micro-count size").toHaveCSS("font-size", "11px");
    await expect(dot, "D-120 dot uses the 14px micro-count line-height").toHaveCSS("line-height", "14px");
    const [railBox, linkBox, iconBox, dotBox] = await Promise.all([page.locator(".sidebar").boundingBox(), inbox.boundingBox(), inbox.locator(".sidebar__icon").boundingBox(), dot.boundingBox()]);
    expect(dotBox!.x + dotBox!.width / 2, `${route}: dot sits at the Inbox icon's right edge`).toBeGreaterThanOrEqual(iconBox!.x + iconBox!.width - 2);
    expect(dotBox!.y + dotBox!.height / 2, `${route}: dot sits at the Inbox icon's top edge`).toBeLessThanOrEqual(iconBox!.y + 2);
    expect(dotBox!.x, `${route}: dot does not cover the icon's left half`).toBeGreaterThanOrEqual(iconBox!.x + iconBox!.width / 2);
    expect(dotBox!.x + dotBox!.width, `${route}: dot does not clip at the 48px rail`).toBeLessThanOrEqual(railBox!.x + railBox!.width);
    expect(dotBox!.y, `${route}: dot remains inside its Inbox link`).toBeGreaterThanOrEqual(linkBox!.y);
    await page.locator(".sidebar__toggle").click();
  }

  await page.route("**/api/inbox", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones: [] }) }));
  await page.goto(`${served!.baseURL}/#/seats`);
  await expect(page.locator(".sidebar__badge"), "zero Inbox count removes the expanded count").toHaveCount(0);
  await page.locator(".sidebar__toggle").click();
  await expect(page.locator(".sidebar__badge--dot"), "zero Inbox count removes the collapsed notification dot").toHaveCount(0);
  await page.locator(".sidebar__toggle").click();
  await page.unroute("**/api/inbox");

  const petitiones = Array.from({ length: 123 }, (_, index) => ({ id: `P-${index}`, opus: `W-${index}`, from: "builder", subject: "Alert", body: "Alert" }));
  await page.route("**/api/inbox", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones }) }));
  await page.goto(`${served!.baseURL}/#/officina`);
  await expect(page.locator(".sidebar__badge"), "expanded Inbox keeps its full uncapped count").toHaveText("123");
  await expect(page.locator(".sidebar__badge")).not.toHaveClass(/sidebar__badge--dot/);
  await page.locator(".sidebar__toggle").click();
  await expect(page.locator(".sidebar__badge--dot"), "collapsed dot caps only its visible count").toHaveText("9+");
  await expect(page.locator(".sidebar__badge--dot"), "capped dot retains the full count for assistive technology").toHaveAccessibleName("Inbox, 123 needs you");
  expect(await page.locator(".sidebar__badge--dot").evaluate((node) => node.scrollWidth <= node.clientWidth), "9+ fits inside the dot without clipping").toBe(true);
});

test("W-415-b2 every screen stays inside 1280 and a 640 CSS-pixel zoom viewport", async ({ page }) => {
  await signIn(page, 1280, "w415-reflow");
  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => innerWidth), `${width}: CSS viewport models ${width === 640 ? "200% zoom" : "100% zoom"}`).toBe(width);
    for (const route of ROUTES) {
      await page.goto(`${served!.baseURL}/?demo#/${route}`);
      const screen = page.locator(`.${route}`); await expect(screen).toBeVisible();
      if (route === "board") await expect.poll(() => page.locator(".board__column").count()).toBeGreaterThan(1);
      const box = await screen.boundingBox();
      expect(box!.x + box!.width, `${width} ${route}: screen right edge stays inside viewport`).toBeLessThanOrEqual(width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width} ${route}: document has no horizontal page overflow`).toBeLessThanOrEqual(0);
      if (route === "board") {
        const g = await page.locator(".board__columns").evaluate((n) => ({ client: n.clientWidth, scroll: n.scrollWidth, overflow: getComputedStyle(n).overflowX }));
        expect(g.overflow, `${width}: Board names its phase strip as the sole horizontal scroller`).toBe("auto"); expect(g.scroll).toBeGreaterThan(g.client);
      } else expect(await screen.evaluate((n) => n.scrollWidth - n.clientWidth), `${width} ${route}: screen does not clip right-edge content`).toBeLessThanOrEqual(0);
      if (route === "inbox") await expectInboxSubjectsContained(page, width);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 }); await page.goto(`${served!.baseURL}/?demo#/inbox`);
  await expect(page.locator(".inbox--split")).toHaveCSS("grid-template-columns", /320px/);
  await page.setViewportSize({ width: 640, height: 900 });
  await expect.poll(() => page.locator(".inbox--split").evaluate((n) => getComputedStyle(n).gridTemplateColumns), "layout changes on live resize").not.toContain("320px");
  await page.setViewportSize({ width: 390, height: 900 });
  await expectInboxSubjectsContained(page, 390);
});

test("W-415-b2 Seats confirm bar spans the 640px zoom viewport", async ({ page }) => {
  await signIn(page, 640, "w415-seats-confirm-640");
  await page.goto(`${served!.baseURL}/?demo#/seats`);
  const model = page.locator('select[aria-label="model for seat builder"]');
  await model.selectOption("claude-opus-5");
  const bar = page.locator(".seats__confirm-bar");
  await expect(bar).toBeVisible();
  const [barBox, cancelBox] = await Promise.all([bar.boundingBox(), page.locator(".seats__cancel-btn").boundingBox()]);
  expect(barBox!.x, "640 Seats confirm bar begins at the viewport edge").toBeCloseTo(0, 0);
  expect(cancelBox!.x + cancelBox!.width, "640 Seats Cancel remains inside the viewport").toBeLessThanOrEqual(640);
});

test("W-415-b2 narrow content remains contained and D-116 Board boundaries remain intact", async ({ page }) => {
  await signIn(page, 390, "w415-contained"); await page.goto(`${served!.baseURL}/?demo#/officina`);
  const main = await page.locator(".shell__main").boundingBox(); const items = page.locator(".officina__title, .officina__panel-heading, .officina__completion-row > span, .officina__row > span");
  for (const item of await items.all()) if (await item.isVisible()) { const box = await item.boundingBox(); expect(box!.x + box!.width, "Officina text, counts and row labels stay in main pane").toBeLessThanOrEqual(main!.x + main!.width + 1); }
  await page.setViewportSize({ width: 640, height: 900 }); await page.goto(`${served!.baseURL}/?demo#/board`); await expect.poll(() => page.locator(".board__column").count()).toBeGreaterThan(1);
  const columns = await page.locator(".board__columns").evaluate((n) => ({ client: n.clientWidth, scroll: n.scrollWidth })); expect(columns.scroll, "Board phase strip remains its sole local scroller").toBeGreaterThan(columns.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "Board has no page overflow").toBeLessThanOrEqual(0);
  const [reason, liveness] = await Promise.all([page.locator(".board__project-select-reason").boundingBox(), page.locator(".board__liveness").boundingBox()]);
  expect(liveness!.y, "640 Board liveness wraps below the project explanation").toBeGreaterThan(reason!.y);
});

test("W-415-b3 the closed 390px shell retains its approved 48px top row", async ({ page }) => {
  await signIn(page, 390, "w415-phone");
  for (const route of ROUTES) {
    await page.goto(`${served!.baseURL}/?demo#/${route}`);
    const [s, m] = await Promise.all([page.locator(".sidebar").boundingBox(), page.locator(".shell__main").boundingBox()]);
    expect(s!.width, `${route}: approved 390px navigation spans viewport`).toBeCloseTo(390, 0);
    expect(s!.height, `${route}: approved top navigation remains 48px high`).toBeCloseTo(48, 0);
    expect(m!.y, `${route}: content begins below top row`).toBeCloseTo(48, 0);
    await expect(page.locator(".sidebar__links")).toBeHidden();
    const toggle = page.locator(".sidebar__toggle"); await toggle.focus(); const t = await toggle.boundingBox();
    expect(t!.y, `${route}: focus ring clears top`).toBeGreaterThanOrEqual(4);
    expect(t!.y + t!.height, `${route}: focus ring clears bottom`).toBeLessThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});

test("W-415-b3 the 959px overlay is click-only, focused, dismissible and non-scrolling", async ({ page }) => {
  await signIn(page, 959, "w415-overlay");
  await expect(page.locator(".sidebar__links"), "959 boundary starts with overlay closed").toBeHidden(); await page.locator(".sidebar").hover();
  await expect(page.locator(".sidebar__links"), "hover never opens the drawer").toBeHidden();
  for (const width of [640, 390]) {
    await page.setViewportSize({ width, height: 900 }); const toggle = page.locator(".sidebar__toggle");
    const closedToggle = await toggle.boundingBox();
    await toggle.click();
    const openToggle = await toggle.boundingBox();
    expect(openToggle, `${width}: toggle retains identical viewport coordinates`).toEqual(closedToggle);
    await expect(page.locator(".shell")).toHaveClass(/shell--overlay-open/);
    await expect(page.locator('.sidebar__link[href="#/inbox"]'), `${width}: focus moves into drawer`).toBeFocused();
    await expect(page.locator(".shell__main"), `${width}: page behind does not scroll`).toHaveCSS("overflow", "hidden");
    const main = await page.locator(".shell__main").boundingBox();
    expect(main!.y, `${width}: open overlay leaves main in its own row`).toBeCloseTo(48, 0);
    expect(main!.height, `${width}: open overlay keeps the main pane visible behind it`).toBeGreaterThanOrEqual(800);
    await page.keyboard.press("Escape"); await expect(toggle, `${width}: Escape returns focus to toggle`).toBeFocused();
    await toggle.press("Enter"); await page.getByRole("link", { name: "Board" }).click();
    await expect(page.locator(".sidebar__links"), `${width}: choosing a screen closes drawer`).toBeHidden(); await expect(toggle, `${width}: navigation close returns focus`).toBeFocused();
  }
  await page.setViewportSize({ width: 960, height: 900 }); await expect(page.locator(".sidebar__links"), "960 boundary is the persistent wide sidebar").toBeVisible();
});

test("W-415-b4 the wide preference persists while the narrow overlay never overwrites it", async ({ browser }) => {
  served = await startServed("w415-persistence");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage();
  await page.goto(`${served.baseURL}/#/inbox`);
  await expect(page.locator(".sidebar__toggle"), "absent storage defaults to expanded").toHaveAccessibleName("Collapse sidebar");
  await page.locator("#token-prompt-input").fill(served.token); await page.locator(".token-prompt__submit").click(); await page.locator(".sidebar__toggle").click();
  expect(await page.evaluate(() => localStorage.getItem("bisellium.sidebar")), "wide collapse stores collapsed").toBe("collapsed");
  await page.reload(); await expect(page.locator(".sidebar__toggle"), "reload restores collapsed").toHaveAccessibleName("Expand sidebar");
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(page.locator(".sidebar__toggle"), "narrow overlay starts closed regardless of preference").toHaveAccessibleName("Expand sidebar");
  await page.locator(".sidebar__toggle").click(); await page.locator(".sidebar__toggle").click();
  expect(await page.evaluate(() => localStorage.getItem("bisellium.sidebar")), "narrow overlay never overwrites wide preference").toBe("collapsed");
  await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "sideways")); await page.setViewportSize({ width: 1280, height: 900 }); await page.reload();
  await expect(page.locator(".sidebar__toggle"), "invalid stored value falls back to expanded").toHaveAccessibleName("Collapse sidebar"); await context.close();
  const denied = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await denied.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException("denied"); }; Storage.prototype.setItem = () => { throw new DOMException("denied"); }; });
  const deniedPage = await denied.newPage(); await deniedPage.goto(`${served.baseURL}/#/board`);
  await expect(deniedPage.locator(".sidebar__toggle"), "unreadable storage falls back to expanded").toHaveAccessibleName("Collapse sidebar");
  await expect(deniedPage.locator(".board"), "storage failure never crashes").toBeVisible(); await denied.close();
});
