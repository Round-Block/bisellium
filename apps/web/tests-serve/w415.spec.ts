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
