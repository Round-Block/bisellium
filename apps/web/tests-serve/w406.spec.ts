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

test("W-406-b1 Board exposes one draggable horizontal-scroll cue at 1280 and 390", async ({ page }) => {
  for (const width of [1280, 390] as const) {
    await open(page, "board", width);
    const columns = page.locator(".board__columns");
    const lastColumn = page.locator(".board__column").last();
    await expect.poll(() => page.locator(".board__column").count(), `${width}: the served Board has every phase`).toBeGreaterThan(1);
    const cue = page.locator(".board__scroll-cue");
    const thumb = cue.locator(".board__scroll-cue-thumb");
    expect(await cue.count(), `${width}: the in-page scroll cue exists before interaction`).toBe(1);
    await expect(cue, `${width}: the in-page scroll cue is visibly painted before interaction`).toBeVisible();
    await expect(thumb, `${width}: the in-page scroll thumb is visibly painted before interaction`).toBeVisible();
    const scroll = await columns.evaluate((node) => {
      const element = node as HTMLElement;
      const style = getComputedStyle(element);
      const webkitScrollbar = getComputedStyle(element, "::-webkit-scrollbar");
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scrollbarWidth: style.scrollbarWidth,
        webkitScrollbar: { display: webkitScrollbar.display },
      };
    });
    expect(scroll.scrollWidth, `${width}: phases overflow into a horizontal scroll range`).toBeGreaterThan(scroll.clientWidth);
    expect(scroll.scrollbarWidth, `${width}: standard native scrollbar is hidden`).toBe("none");
    expect(scroll.webkitScrollbar.display, `${width}: WebKit native scrollbar is hidden`).toBe("none");
    await expect(cue, `${width}: cue stays hidden from assistive technology`).toHaveAttribute("aria-hidden", "true");
    expect(await cue.getAttribute("role"), `${width}: cue does not duplicate the container as a semantic scrollbar`).toBeNull();
    expect(await cue.getAttribute("tabindex"), `${width}: cue stays an aria-hidden unfocusable pointer proxy`).toBeNull();
    const [trackBox, thumbBox] = await Promise.all([cue.boundingBox(), thumb.boundingBox()]);
    expect(trackBox, `${width}: the in-page scroll track has a rendered box`).toBeTruthy();
    expect(thumbBox, `${width}: the in-page scroll thumb has a rendered box`).toBeTruthy();
    expect(trackBox!.height, `${width}: the rendered scroll track is 8px high`).toBeCloseTo(8, 0);
    expect(thumbBox!.width, `${width}: the rendered thumb has positive width`).toBeGreaterThan(0);
    expect(thumbBox!.width, `${width}: the rendered thumb exposes part of the continuation track`).toBeLessThan(trackBox!.width);
    expect(thumbBox!.x, `${width}: the thumb starts inside the track`).toBeGreaterThanOrEqual(trackBox!.x - 1);
    expect(thumbBox!.x + thumbBox!.width, `${width}: the thumb ends inside the track`).toBeLessThanOrEqual(trackBox!.x + trackBox!.width + 1);
    expect(trackBox!.x, `${width}: the track starts inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(trackBox!.x + trackBox!.width, `${width}: the track ends inside the viewport`).toBeLessThanOrEqual(width);
    expect(trackBox!.y, `${width}: the track starts inside the viewport height`).toBeGreaterThanOrEqual(0);
    expect(trackBox!.y + trackBox!.height, `${width}: the track ends inside the viewport height`).toBeLessThanOrEqual(900);
    const expectedThumbWidth = trackBox!.width * scroll.clientWidth / scroll.scrollWidth;
    expect(Math.abs(thumbBox!.width - expectedThumbWidth), `${width}: initial thumb width matches the visible scroll fraction`).toBeLessThanOrEqual(1);
    const maxScroll = scroll.scrollWidth - scroll.clientWidth;
    const initialScrollLeft = await columns.evaluate((node) => (node as HTMLElement).scrollLeft);
    const expectedThumbOffset = (trackBox!.width - thumbBox!.width) * initialScrollLeft / maxScroll;
    expect(Math.abs(thumbBox!.x - trackBox!.x - expectedThumbOffset), `${width}: initial thumb offset matches the Board scroll position`).toBeLessThanOrEqual(1);

    const leftGap = thumbBox!.x - trackBox!.x;
    const rightGap = trackBox!.x + trackBox!.width - thumbBox!.x - thumbBox!.width;
    const trackSampleX = leftGap >= rightGap ? trackBox!.x + leftGap / 2 : thumbBox!.x + thumbBox!.width + rightGap / 2;
    const sampleY = trackBox!.y + trackBox!.height / 2;
    const [trackPixel, thumbPixel] = await Promise.all([
      page.screenshot({ clip: { x: Math.floor(trackSampleX), y: Math.floor(sampleY), width: 1, height: 1 } }),
      page.screenshot({ clip: { x: Math.floor(thumbBox!.x + thumbBox!.width / 2), y: Math.floor(sampleY), width: 1, height: 1 } }),
    ]);
    expect(thumbPixel.equals(trackPixel), `${width}: rendered thumb and track pixels are visibly distinct`).toBe(false);

    await columns.evaluate((node) => {
      const element = node as HTMLElement;
      element.style.scrollSnapType = "none";
      element.scrollLeft = 0;
    });
    await expect.poll(() => columns.evaluate((node) => (node as HTMLElement).scrollLeft), `${width}: drag starts at the left terminal`).toBe(0);
    const [dragTrack, dragThumb] = await Promise.all([cue.boundingBox(), thumb.boundingBox()]);
    expect(dragTrack, `${width}: drag track has a rendered box`).toBeTruthy();
    expect(dragThumb, `${width}: drag thumb has a rendered box`).toBeTruthy();
    const availableTrack = dragTrack!.width - dragThumb!.width;
    const dragDistance = Math.min(48, availableTrack / 3);
    const dragStartX = dragThumb!.x + dragThumb!.width / 2;
    const dragY = dragThumb!.y + dragThumb!.height / 2;
    await page.mouse.move(dragStartX, dragY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(dragStartX + dragDistance, dragY);
    await page.mouse.up({ button: "right" });
    expect(await columns.evaluate((node) => (node as HTMLElement).scrollLeft), `${width}: secondary-button drag leaves scrollLeft unchanged`).toBe(0);
    await page.mouse.move(dragStartX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragStartX + dragDistance, dragY, { steps: 2 });
    const expectedDraggedScroll = dragDistance * maxScroll / availableTrack;
    await expect.poll(async () => Math.abs(await columns.evaluate((node) => (node as HTMLElement).scrollLeft) - expectedDraggedScroll), `${width}: pointer drag moves scrollLeft by the inverse cue ratio`).toBeLessThanOrEqual(1);
    await expect.poll(async () => {
      const box = await thumb.boundingBox();
      return box === null ? Number.POSITIVE_INFINITY : Math.abs(box.x - dragTrack!.x - dragDistance);
    }, `${width}: synchronized thumb follows the container during drag`).toBeLessThanOrEqual(1);
    await page.mouse.move(dragStartX + availableTrack + 8, dragY, { steps: 2 });
    await expect.poll(async () => Math.abs(await columns.evaluate((node) => (node as HTMLElement).scrollLeft) - maxScroll), `${width}: drag reaches the terminal horizontal offset`).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect.poll(async () => {
      const [terminalTrack, terminalThumb] = await Promise.all([cue.boundingBox(), thumb.boundingBox()]);
      return terminalTrack !== null && terminalThumb !== null ? Math.abs(terminalTrack.x + terminalTrack.width - terminalThumb.x - terminalThumb.width) : Number.POSITIVE_INFINITY;
    }, `${width}: terminal thumb reaches the track right edge after drag`).toBeLessThanOrEqual(1);
    const [containerBox, terminalBox] = await Promise.all([columns.boundingBox(), lastColumn.boundingBox()]);
    expect(containerBox, `${width}: the Board scroll container has a box`).toBeTruthy();
    expect(terminalBox, `${width}: the terminal phase has a box`).toBeTruthy();
    expect(terminalBox!.x + terminalBox!.width, `${width}: terminal phase right edge is reachable inside the scroll container`).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 1);

    await columns.evaluate((node) => { (node as HTMLElement).scrollLeft = 0; });
    await expect.poll(() => columns.evaluate((node) => (node as HTMLElement).scrollLeft), `${width}: track press starts at the left terminal`).toBe(0);
    const trackPressX = dragTrack!.x + dragTrack!.width * 0.75;
    await page.mouse.click(trackPressX, dragY);
    const expectedTrackScroll = Math.min(maxScroll, Math.max(0, (trackPressX - dragTrack!.x - dragThumb!.width / 2) * maxScroll / availableTrack));
    await expect.poll(async () => Math.abs(await columns.evaluate((node) => (node as HTMLElement).scrollLeft) - expectedTrackScroll), `${width}: track press jumps to its centred proportional offset`).toBeLessThanOrEqual(1);
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
