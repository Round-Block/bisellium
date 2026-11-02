import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

async function signIn(page: Page): Promise<void> {
  const prompt = page.locator("#token-prompt-input");
  if (await prompt.isVisible()) {
    await prompt.fill(served!.token);
    await page.locator(".token-prompt__submit").click();
  }
}

async function openBoard(page: Page, width: number, state: "expanded" | "collapsed", tag: string): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served!.baseURL}/?w499=${tag}#/board`);
  await signIn(page);
  await page.evaluate((value) => localStorage.setItem("bisellium.sidebar", value), state);
  await page.reload();
  await expect(page.locator(".board__column")).toHaveCount(6);
  await expect(page.locator('[data-column-id="planned"] .board__column-head')).toContainText("Planned");
  await expect(page.locator('[data-column-id="planned"] [data-card-id="W-007"]')).toBeAttached();
}

async function alignedColumn(page: Page, columnId: string): Promise<{ actual: number; expected: number; trackLeft: number; trackWidth: number; headLeft: number; cardLeft: number; gutterColumnId: string | null }> {
  return page.evaluate((id) => {
    const track = document.querySelector<HTMLElement>(".board__columns")!;
    const target = track.querySelector<HTMLElement>(`[data-column-id="${id}"]`)!;
    const head = target.querySelector<HTMLElement>(".board__column-head")!;
    const card = target.querySelector<HTMLElement>("[data-card-id]")!;
    const inset = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const max = Math.max(0, track.scrollWidth - track.clientWidth);
    const trackBox = track.getBoundingClientRect();
    const gutterColumnId = inset > 0 && trackBox.width > inset
      ? document.elementFromPoint(trackBox.left + inset / 2, head.getBoundingClientRect().top + 8)?.closest<HTMLElement>("[data-column-id]")?.dataset.columnId ?? null
      : null;
    return {
      actual: track.scrollLeft,
      expected: Math.min(max, Math.max(0, target.offsetLeft - inset)),
      trackLeft: trackBox.left,
      trackWidth: trackBox.width,
      headLeft: head.getBoundingClientRect().left,
      cardLeft: card.getBoundingClientRect().left,
      gutterColumnId,
    };
  }, columnId);
}

async function focusedCardClearance(page: Page, cardId: string): Promise<{ cardLeft: number; cardTop: number; cardWidth: number; cardHeight: number; columnLeft: number; columnWidth: number; outlineLeft: number; outlineTop: number; outlineRight: number; outlineBottom: number; clipLeft: number; scrollerLeft: number; scrollerTop: number; scrollerRight: number; scrollerBottom: number; trackTop: number; trackRight: number; trackBottom: number; gutterColumnId: string | null }> {
  return page.evaluate((id) => {
    const track = document.querySelector<HTMLElement>(".board__columns")!;
    const card = track.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;
    const trackBox = track.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const columnBox = card.closest<HTMLElement>(".board__column")!.getBoundingClientRect();
    const scrollerBox = card.closest<HTMLElement>(".board__column-cards")!.getBoundingClientRect();
    const trackStyle = getComputedStyle(track);
    const cardStyle = getComputedStyle(card);
    const reach = (Number.parseFloat(cardStyle.outlineWidth) || 0) + (Number.parseFloat(cardStyle.outlineOffset) || 0);
    const clipValues = trackStyle.clipPath.match(/-?\d+(?:\.\d+)?px/g)?.map((value) => Number.parseFloat(value)) ?? [];
    const clipInset = clipValues.at(-1) ?? 0;
    const inset = Number.parseFloat(trackStyle.paddingLeft) || 0;
    const gutterColumnId = inset > 0 && trackBox.width > inset
      ? document.elementFromPoint(trackBox.left + Math.max(1, clipInset / 2), cardBox.top + 8)?.closest<HTMLElement>("[data-column-id]")?.dataset.columnId ?? null
      : null;
    return {
      cardLeft: cardBox.left,
      cardTop: cardBox.top,
      cardWidth: cardBox.width,
      cardHeight: cardBox.height,
      columnLeft: columnBox.left,
      columnWidth: columnBox.width,
      outlineLeft: cardBox.left - reach,
      outlineTop: cardBox.top - reach,
      clipLeft: trackBox.left + clipInset,
      scrollerLeft: scrollerBox.left,
      scrollerTop: scrollerBox.top,
      scrollerRight: scrollerBox.right,
      scrollerBottom: scrollerBox.bottom,
      trackTop: trackBox.top,
      trackRight: trackBox.right,
      outlineRight: cardBox.right + reach,
      outlineBottom: cardBox.bottom + reach,
      trackBottom: trackBox.bottom,
      gutterColumnId,
    };
  }, cardId);
}

test("W-499-b1 opened lifecycle columns stay contained and restore at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w499-b1");
  const cases = [
    { width: 1280, state: "expanded" as const },
    { width: 1280, state: "collapsed" as const },
    { width: 640, state: "expanded" as const },
    { width: 390, state: "expanded" as const },
  ];

  const openers = [
    { cardId: "W-007", columnId: "planned", kind: "Planned", prior: 300 },
    { cardId: "W-004", columnId: "awaiting_review", kind: "later", prior: 164 },
    { cardId: "W-001", columnId: "done", kind: "terminal", prior: 0 },
  ];

  for (const { width, state } of cases) {
    for (const { cardId, columnId, kind, prior: requestedPrior } of openers) {
      const label = `${width}-${state}-${kind}`;
      await openBoard(page, width, state, label);
      const columns = page.locator(".board__columns");
      const opener = page.locator(`[data-card-id="${cardId}"]`);
      await columns.evaluate((node, value) => { node.scrollLeft = value; }, requestedPrior);
      const prior = await columns.evaluate((node) => node.scrollLeft);
      await opener.evaluate((node) => (node as HTMLElement).click());
      const drawer = page.locator(".board-drawer");
      await expect(drawer, `${label}: drawer opens`).toBeVisible();
      await expect.poll(async () => {
        const geometry = await alignedColumn(page, columnId);
        return geometry.actual === geometry.expected;
      }, `${label}: opened lifecycle column aligns to its clamped left inset`).toBe(true);

      const geometry = await alignedColumn(page, columnId);
      if (width === 1280) {
        expect(geometry.headLeft, `${label}: selected column header is not lost under the track edge`).toBeGreaterThanOrEqual(geometry.trackLeft - 0.5);
        expect(geometry.cardLeft, `${label}: selected card is not lost under the track edge`).toBeGreaterThanOrEqual(geometry.trackLeft - 0.5);
        expect(geometry.gutterColumnId, `${label}: the aligned inset contains no detached preceding-column fragment`).toBeNull();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label}: drawer creates no page overflow`).toBeLessThanOrEqual(0);

      await page.locator(".board-drawer__close").click();
      await expect(drawer, `${label}: drawer closes`).toBeHidden();
      const closedMax = await columns.evaluate((node) => Math.max(0, node.scrollWidth - node.clientWidth));
      await expect.poll(() => columns.evaluate((node) => node.scrollLeft), `${label}: close restores the caller within the closed range`).toBe(Math.min(prior, closedMax));
    }
  }
});

test("W-499-b1 a second open clamps the most recent lifecycle position to the closed range", async ({ page }) => {
  served = await startServed("w499-b1-second-open");
  await openBoard(page, 1280, "expanded", "second-open");
  const columns = page.locator(".board__columns");
  await columns.evaluate((node) => { node.scrollLeft = 164; });
  await page.locator('[data-card-id="W-001"]').evaluate((node) => (node as HTMLElement).click());
  await expect.poll(async () => (await alignedColumn(page, "done")).actual === (await alignedColumn(page, "done")).expected).toBe(true);
  const later = page.locator('[data-card-id="W-004"]');
  await later.evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
  const mostRecent = await later.evaluate((node) => new Promise<number>((resolve) => {
    node.addEventListener("click", () => {
      const track = node.closest(".board__columns") as HTMLElement;
      track.scrollLeft = track.scrollLeft;
      resolve(track.scrollLeft);
    }, { once: true });
    (node as HTMLElement).click();
  }));
  await expect.poll(async () => (await alignedColumn(page, "awaiting_review")).actual === (await alignedColumn(page, "awaiting_review")).expected).toBe(true);
  await page.locator(".board-drawer__close").click();
  const closedMax = await columns.evaluate((node) => Math.max(0, node.scrollWidth - node.clientWidth));
  await expect.poll(() => columns.evaluate((node) => node.scrollLeft), "Close restores min(snapshot, closedMax) from W-004's most recent open").toBe(Math.min(mostRecent, closedMax));
  await expect(later).toBeFocused();
});

test("W-499-b1 keyboard-focused cards keep their complete outline in the clear inset", async ({ page }) => {
  served = await startServed("w499-b1-focus-clearance");
  for (const { width, state } of [
    { width: 1280, state: "expanded" as const },
    { width: 1280, state: "collapsed" as const },
    { width: 640, state: "expanded" as const },
  ]) {
    const label = `${width}-${state}-W-006`;
    await openBoard(page, width, state, label);
    const columns = page.locator(".board__columns");
    await columns.evaluate((node) => { node.scrollLeft = 0; });
    await page.locator('[data-card-id="W-007"]').evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('[data-card-id="W-006"]'), `${label}: ArrowUp gives W-006 keyboard focus`).toBeFocused();
    expect(await columns.evaluate((node) => node.scrollLeft), `${label}: focus at scroll zero does not move the target`).toBe(0);
    const geometry = await focusedCardClearance(page, "W-006");
    expect(geometry.cardLeft, `${label}: focus clearance does not move the card inside its column`).toBeCloseTo(geometry.columnLeft, 1);
    expect(geometry.cardWidth, `${label}: focus clearance does not change the card or column width`).toBeCloseTo(geometry.columnWidth, 1);
    expect(geometry.outlineLeft, `${label}: the complete four-pixel left outline clears the track clip`).toBeGreaterThanOrEqual(geometry.clipLeft - 0.5);
    expect(geometry.outlineLeft, `${label}: the complete left outline clears the card scroller clip`).toBeGreaterThanOrEqual(geometry.scrollerLeft - 0.5);
    expect(geometry.outlineRight, `${label}: the complete right outline remains in the track`).toBeLessThanOrEqual(geometry.trackRight + 0.5);
    expect(geometry.outlineRight, `${label}: the complete right outline clears the card scroller clip`).toBeLessThanOrEqual(geometry.scrollerRight + 0.5);
    expect(geometry.outlineTop, `${label}: the complete top outline remains in the track`).toBeGreaterThanOrEqual(geometry.trackTop - 0.5);
    expect(geometry.outlineTop, `${label}: the complete top outline clears the card scroller clip`).toBeGreaterThanOrEqual(geometry.scrollerTop - 0.5);
    expect(geometry.outlineBottom, `${label}: the complete bottom outline remains in the track`).toBeLessThanOrEqual(geometry.trackBottom + 0.5);
    expect(geometry.outlineBottom, `${label}: the complete bottom outline clears the card scroller clip`).toBeLessThanOrEqual(geometry.scrollerBottom + 0.5);
    expect(geometry.gutterColumnId, `${label}: at scroll zero no preceding-column content occupies the clipped inset`).toBeNull();
  }

  await openBoard(page, 1280, "expanded", "1280-expanded-W-004-open");
  await page.locator('[data-card-id="W-004"]').click();
  await expect(page.locator(".board-drawer")).toBeVisible();
  await expect.poll(async () => (await alignedColumn(page, "awaiting_review")).actual === (await alignedColumn(page, "awaiting_review")).expected).toBe(true);
  await page.locator('[data-card-id="W-003"]').evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("ArrowRight");
  const focused = page.locator('[data-card-id="W-004"]');
  await expect(focused, "1280-expanded-W-004-open: ArrowRight gives the drawer opener keyboard focus").toBeFocused();
  await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>(".board__columns")!;
    const target = track.querySelector<HTMLElement>('[data-column-id="awaiting_review"]')!;
    const inset = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
    track.scrollLeft = Math.min(Math.max(0, track.scrollWidth - track.clientWidth), Math.max(0, target.offsetLeft - inset));
  });
  const openGeometry = await focusedCardClearance(page, "W-004");
  expect(openGeometry.cardLeft, "1280-expanded-W-004-open: focus clearance does not move the card inside its column").toBeCloseTo(openGeometry.columnLeft, 1);
  expect(openGeometry.cardWidth, "1280-expanded-W-004-open: focus clearance does not change the card or column width").toBeCloseTo(openGeometry.columnWidth, 1);
  expect(openGeometry.outlineLeft, "1280-expanded-W-004-open: the complete four-pixel left outline clears the track clip beside the drawer").toBeGreaterThanOrEqual(openGeometry.clipLeft - 0.5);
  expect(openGeometry.outlineLeft, "1280-expanded-W-004-open: the complete left outline clears the card scroller clip beside the drawer").toBeGreaterThanOrEqual(openGeometry.scrollerLeft - 0.5);
  expect(openGeometry.outlineRight, "1280-expanded-W-004-open: the complete right outline remains in the pushed track").toBeLessThanOrEqual(openGeometry.trackRight + 0.5);
  expect(openGeometry.outlineRight, "1280-expanded-W-004-open: the complete right outline clears the card scroller clip beside the drawer").toBeLessThanOrEqual(openGeometry.scrollerRight + 0.5);
  expect(openGeometry.outlineTop, "1280-expanded-W-004-open: the complete top outline remains in the pushed track").toBeGreaterThanOrEqual(openGeometry.trackTop - 0.5);
  expect(openGeometry.outlineTop, "1280-expanded-W-004-open: the complete top outline clears the card scroller clip beside the drawer").toBeGreaterThanOrEqual(openGeometry.scrollerTop - 0.5);
  expect(openGeometry.outlineBottom, "1280-expanded-W-004-open: the complete bottom outline remains in the pushed track").toBeLessThanOrEqual(openGeometry.trackBottom + 0.5);
  expect(openGeometry.outlineBottom, "1280-expanded-W-004-open: the complete bottom outline clears the card scroller clip beside the drawer").toBeLessThanOrEqual(openGeometry.scrollerBottom + 0.5);
  expect(openGeometry.gutterColumnId, "1280-expanded-W-004-open: at the aligned target no preceding-column content occupies the clipped inset").toBeNull();
});

test("W-499-b2 Why it waits states each reason once at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w499-b2");
  for (const width of [1280, 640, 390] as const) {
    await openBoard(page, width, "expanded", `b2-${width}`);
    await page.locator('[data-card-id="W-004"]').click();
    const reasons = page.locator(".board-drawer__reason");
    await expect(reasons, `${width}: the sample wait has one question, one pending gate and one handoff reason`).toHaveCount(3);
    await expect(reasons.nth(0), `${width}: the complete question appears once`).toHaveText(/Drag-and-drop grew a second screen \(split stacks\)\. Accept the scope drift and\s+ship both, or cut split stacks to a new item\?/);
    await expect(reasons.nth(1), `${width}: the recorded pending gate appears once`).toHaveText("Patron call is pending.");
    await expect(reasons.nth(2), `${width}: the handoff reason appears once`).toHaveText("await patron call");
    expect((await reasons.allTextContents()).join(" ").match(/Drag-and-drop grew a second screen/g)?.length, `${width}: the question sentence is not repeated inside its own bullet`).toBe(1);
    await expect(page.locator(".board-drawer__reasons"), `${width}: no capped subject is joined back onto its source body`).not.toContainText("new…:");
    await page.locator(".board-drawer__close").click();
  }
});

