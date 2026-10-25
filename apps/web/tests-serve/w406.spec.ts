import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

async function open(page: Page, route: "board" | "officina", width: 1280 | 390): Promise<void> {
  served = await startServed(`w406-${route}-${width}`);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served.baseURL}/#/${route}`);
  await page.locator("#token-prompt-input").fill(served.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
  await expect(page.locator(`.${route}`)).toBeVisible();
}

test("W-406-b1 Board exposes and reaches its terminal phase at 1280 and 390", async ({ page }) => {
  for (const width of [1280, 390] as const) {
    await open(page, "board", width);
    const columns = page.locator(".board__columns");
    const lastColumn = page.locator(".board__column").last();
    await expect.poll(() => page.locator(".board__column").count(), `${width}: the served Board has every phase`).toBeGreaterThan(1);
    const scroll = await columns.evaluate((node) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      const webkitScrollbar = getComputedStyle(element, "::-webkit-scrollbar");
      const webkitTrack = getComputedStyle(element, "::-webkit-scrollbar-track");
      const webkitThumb = getComputedStyle(element, "::-webkit-scrollbar-thumb");
      return {
        clientWidth: element.clientWidth,
        gutter: style.scrollbarGutter,
        scrollWidth: element.scrollWidth,
        webkitScrollbar: { display: webkitScrollbar.display, height: webkitScrollbar.height },
        webkitTrack: { backgroundColor: webkitTrack.backgroundColor },
        webkitThumb: { backgroundColor: webkitThumb.backgroundColor, borderRadius: webkitThumb.borderRadius },
      };
    });
    expect(scroll.scrollWidth, `${width}: phases overflow into a horizontal scroll range`).toBeGreaterThan(scroll.clientWidth);
    expect(scroll.gutter, `${width}: the Board columns keep a stable inline scrollbar gutter`).toContain("stable");
    expect(scroll.webkitScrollbar.height, `${width}: Chromium accepts the 8px scrollbar before test interaction`).toBe("8px");
    expect(scroll.webkitScrollbar.display, `${width}: the accepted scrollbar pseudo-element is not suppressed`).not.toBe("none");
    expect(scroll.webkitTrack.backgroundColor, `${width}: the track has a visible ruled colour`).not.toBe("rgba(0, 0, 0, 0)");
    expect(scroll.webkitThumb.backgroundColor, `${width}: the thumb has a visible ruled colour`).not.toBe(scroll.webkitTrack.backgroundColor);
    expect(scroll.webkitThumb.borderRadius, `${width}: the thumb remains square`).toBe("0px");
    await columns.evaluate((node) => {
      const element = node as HTMLElement;
      element.scrollLeft = element.scrollWidth - element.clientWidth;
    });
    await expect.poll(() => columns.evaluate((node) => (node as HTMLElement).scrollLeft), `${width}: the Board reaches its terminal horizontal offset`).toBeGreaterThan(0);
    const [containerBox, terminalBox] = await Promise.all([columns.boundingBox(), lastColumn.boundingBox()]);
    expect(containerBox, `${width}: the Board scroll container has a box`).toBeTruthy();
    expect(terminalBox, `${width}: the terminal phase has a box`).toBeTruthy();
    expect(terminalBox!.x + terminalBox!.width, `${width}: terminal phase right edge is reachable inside the scroll container`).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);
    await served.close();
    served = undefined;
  }
});

test("W-406-b2 Board header preserves live and stale refresh time above one footer at 1280 and 390", async ({ page }) => {
  for (const width of [1280, 390] as const) {
    await open(page, "board", width);
    await expect(page.locator('.shell__status[data-state="live"]'), `${width}: live remains in the shell announcement`).toHaveText("Connected: the board updates live.");
    const liveness = page.locator(".board__header .board__liveness");
    await expect(liveness, `${width}: live state and refresh time are visible in the header`).toHaveText(/^live · updated \d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    const liveText = await liveness.textContent();
    const refreshTime = liveText!.replace(/^live · updated /, "");
    const headerGeometry = await page.locator(".board__header").evaluate((node) => {
      const element = node as HTMLElement;
      return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    });
    expect(headerGeometry.scrollWidth, `${width}: the header has no horizontal overflow`).toBeLessThanOrEqual(headerGeometry.clientWidth);
    await expect(page.locator(".board > footer"), `${width}: the ruled colophon remains`).toHaveCount(1);
    const textLines = page.locator(".board > footer > div").filter({ hasText: /\S/ });
    await expect(textLines, `${width}: the colophon has one visible text line`).toHaveCount(1);
    const [titleBox, lineBox] = await Promise.all([page.locator(".board__title").boundingBox(), textLines.boundingBox()]);
    expect(titleBox, `${width}: the Board title has a box`).toBeTruthy();
    expect(lineBox, `${width}: the colophon line has a box`).toBeTruthy();
    expect(lineBox!.x, `${width}: footer left inset equals the content gutter`).toBeCloseTo(titleBox!.x, 0);
    expect(lineBox!.height, `${width}: the colophon remains one 14px line`).toBeCloseTo(14, 0);

    await page.locator(".board__card").first().click();
    await expect(page.locator(".board-drawer"), `${width}: the card opens the drawer`).toBeVisible();
    await expect(liveness, `${width}: the open drawer keeps the complete live refresh time visible`).toBeVisible();
    await expect(liveness, `${width}: the open drawer preserves the complete live refresh time`).toHaveText(liveText!);
    if (width === 1280) {
      const [livenessBox, drawerBox] = await Promise.all([liveness.boundingBox(), page.locator(".board-drawer").boundingBox()]);
      expect(livenessBox, "1280: the open drawer leaves the liveness label measurable").toBeTruthy();
      expect(drawerBox, "1280: the open drawer has a box").toBeTruthy();
      const intersectsDrawer = livenessBox!.x < drawerBox!.x + drawerBox!.width && livenessBox!.x + livenessBox!.width > drawerBox!.x && livenessBox!.y < drawerBox!.y + drawerBox!.height && livenessBox!.y + livenessBox!.height > drawerBox!.y;
      expect(intersectsDrawer, "1280: the open drawer does not cover the liveness label").toBe(false);
      const insideViewport = livenessBox!.x >= 0 && livenessBox!.y >= 0 && livenessBox!.x + livenessBox!.width <= width && livenessBox!.y + livenessBox!.height <= 900;
      expect(insideViewport, "1280: the liveness label remains fully inside the viewport").toBe(true);
    }
    await page.locator(".board-drawer__close").click();
    await expect(liveness, `${width}: an unrelated drawer render preserves the refresh time`).toHaveText(liveText!);

    await served.close();
    served = undefined;
    await expect(page.locator('.shell__status[data-state="stale"]'), `${width}: stale remains in the shell announcement`).toHaveText("Disconnected: the board may be out of date.");
    await expect(liveness, `${width}: stale state retains the last successful refresh`).toHaveText(`stale · last updated ${refreshTime}`);
  }
});

test("W-406-b3 Officina today rule clears the last day letter at 1280 and 390", async ({ page }) => {
  for (const width of [1280, 390] as const) {
    await open(page, "officina", width);
    const rule = page.locator(".fasti-strip__today-rule");
    await expect(rule, `${width}: exactly one day is today`).toHaveCount(1);
    const column = rule.locator("xpath=..");
    const letter = column.locator(".fasti-strip__weekday");
    const [columnBox, ruleBox, letterBox] = await Promise.all([column.boundingBox(), rule.boundingBox(), letter.boundingBox()]);
    expect(columnBox, `${width}: the today column has a box`).toBeTruthy();
    expect(ruleBox, `${width}: the today rule has a box`).toBeTruthy();
    expect(letterBox, `${width}: the last weekday letter has a box`).toBeTruthy();
    expect(ruleBox!.height, `${width}: the today rule remains full-height`).toBeCloseTo(columnBox!.height, 0);
    const separated = ruleBox!.x >= letterBox!.x + letterBox!.width - 0.5 || ruleBox!.x + ruleBox!.width <= letterBox!.x + 0.5;
    expect(separated, `${width}: today rule and weekday letter do not overlap`).toBe(true);
    await served.close();
    served = undefined;
  }
});
