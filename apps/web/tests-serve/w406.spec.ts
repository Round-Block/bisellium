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
    expect(scroll.gutter, `${width}: horizontal scrolling has stable visible space`).toContain("stable");
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
