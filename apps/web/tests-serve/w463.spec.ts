import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

const officina = {
  studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], wip_limit: 4,
  probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
  lifecycle: { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Review", phase: "awaiting_review" },
    { id: "done", name: "Done", phase: "done" },
    { id: "halted", name: "Halted", phase: "halted" },
  ] },
};

const makeOpus = (id: string, state: string, probationes: Record<string, { status: string }> = {}, title = `${id} title`) => ({
  id, title, body: "", kind: "task", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined,
});

type Fixture = { opera: ReturnType<typeof makeOpus>[]; inbox: { opera: { id: string; title: string; collegium: string; sella: string }[]; petitiones: { id: string; opus?: string; from: string; subject: string; body: string }[] } };

async function installFixture(page: Page, fixture: Fixture): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: fixture.opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: fixture.inbox }));
}

async function waitingLabelGeometry(page: Page): Promise<{ belowDelta: number; rightDelta: number; inlineGap: number; verticalOverlap: number }> {
  return page.locator(".board__waiting-label").evaluate((label) => {
    const range = document.createRange();
    range.selectNodeContents(label.querySelector("span")!);
    const name = range.getBoundingClientRect();
    const count = label.querySelector("strong")!.getBoundingClientRect();
    return {
      belowDelta: count.top - name.bottom,
      rightDelta: Math.abs(name.right - count.right),
      inlineGap: count.left - name.right,
      verticalOverlap: Math.min(name.bottom, count.bottom) - Math.max(name.top, count.top),
    };
  });
}

test("W-463-b1 variant C keeps one lifecycle card and one strip membership at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w463-b1");
  const fixture: Fixture = {
    opera: [
      makeOpus("W-1", "backlog"), makeOpus("W-2", "greenlit"), makeOpus("W-3", "building", { patron: { status: "pending" } }),
      makeOpus("W-4", "verifying"), makeOpus("W-5", "review"), makeOpus("W-6", "done"), makeOpus("W-7", "halted"),
      makeOpus("W-8", "unknown", { patron: { status: "pending" } }),
    ],
    inbox: {
      opera: [{ id: "W-1", title: "W-1 title", collegium: "design", sella: "builder" }, { id: "W-3", title: "W-3 title", collegium: "design", sella: "builder" }],
      petitiones: [
        { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
        { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
        { id: "P-3", opus: "W-4", from: "producer", subject: "Verify", body: "Verify" },
        { id: "P-orphan", opus: "W-404", from: "producer", subject: "Orphan", body: "Orphan" },
      ],
    },
  };
  await installFixture(page, fixture);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w463=b1-${width}#/board`);
    await expect(page.locator(".board__waiting-item"), `${width}: the four ask sources form one strip membership each`).toHaveCount(4);
    await expect(page.locator('.board__column[data-column-id="needs_you"]'), `${width}: the W-409 membership column is replaced`).toHaveCount(0);
    await expect(page.locator('[data-waiting-id="W-1"] .board__card-ask'), `${width}: the strip carries W-409's counted ask words`).toHaveText(["Greenlight", "2 Inbox decisions"]);
    await expect(page.locator('[data-waiting-id="W-3"] .board__card-ask')).toHaveText(["Human gate"]);
    await expect(page.locator('[data-waiting-id="W-4"] .board__card-ask')).toHaveText(["Inbox decision"]);
    await expect(page.locator('[data-waiting-id="W-8"] .board__card-ask'), `${width}: an unplaced opus keeps its waiting entry`).toHaveText(["Human gate"]);
    for (const [column, id] of [["planned", "W-1"], ["in_progress", "W-3"], ["verifying", "W-4"], ["awaiting_review", "W-5"], ["done", "W-6"], ["halted", "W-7"]] as const) {
      await expect(page.locator(`.board__column[data-column-id="${column}"] [data-card-id="${id}"]`), `${width}: ${id} remains once in ${column}`).toHaveCount(1);
    }
    await expect(page.locator('[data-card-id="W-404"], [data-waiting-id="W-404"]'), `${width}: an orphan ask makes no ghost Board entry`).toHaveCount(0);
    await expect(page.locator('[data-card-id="W-8"]'), `${width}: unplaced means no lifecycle card`).toHaveCount(0);
  }
});

test("W-463-b2 the horizontal strip, responsive count and highlighted cards fit at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w463-b2");
  const longTitle = `A waiting title that is deliberately long enough to ellipsize in the compact pinned strip ${"across every ruled width ".repeat(12)}`;
  const many: Fixture = {
    opera: [...Array.from({ length: 6 }, (_, index) => makeOpus(`W-${index + 1}`, index < 3 ? "backlog" : "building", index === 0 ? { patron: { status: "pending" } } : {}, index === 0 ? longTitle : `Waiting work ${index + 1}`)), makeOpus("W-7", "done")],
    inbox: {
      opera: [{ id: "W-1", title: longTitle, collegium: "design", sella: "builder" }],
      petitiones: [
        ...Array.from({ length: 3 }, (_, index) => ({ id: `P-${index + 1}`, opus: `W-${index + 4}`, from: "producer", subject: "Choose", body: "Choose" })),
        { id: "P-4", opus: "W-1", from: "producer", subject: "First", body: "First" },
        { id: "P-5", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
      ],
    },
  };
  await installFixture(page, many);
  const manyOpera = many.opera;
  const manyInbox = many.inbox;

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w463=b2-many-${width}#/board`);
    const strip = page.locator(".board__waiting");
    const columns = page.locator(".board__columns");
    await expect(page.locator(".board__waiting-item"), `${width}: many asks remain visible`).toHaveCount(6);
    const geometry = await page.evaluate(() => {
      const waiting = document.querySelector<HTMLElement>(".board__waiting")!;
      const items = document.querySelector<HTMLElement>(".board__waiting-items")!;
      const columns = document.querySelector<HTMLElement>(".board__columns")!;
      const long = document.querySelector<HTMLElement>('[data-waiting-id="W-1"] .board__waiting-title')!;
      return {
        stripBottom: waiting.getBoundingClientRect().bottom,
        stripHeight: waiting.getBoundingClientRect().height,
        columnsTop: columns.getBoundingClientRect().top,
        columnsHeight: columns.getBoundingClientRect().height,
        rowTops: new Set([...items.querySelectorAll<HTMLElement>(".board__waiting-item")].map((item) => Math.round(item.getBoundingClientRect().top))).size,
        initialScrollLeft: items.scrollLeft,
        horizontalOverflow: items.scrollWidth > items.clientWidth,
        overflowX: getComputedStyle(items).overflowX,
        overflowY: getComputedStyle(items).overflowY,
        entryHeights: [...items.querySelectorAll<HTMLElement>(".board__waiting-item")].map((item) => item.getBoundingClientRect().height),
        titleEllipsized: long.scrollWidth > long.clientWidth && getComputedStyle(long).textOverflow === "ellipsis",
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        combinedAsksFit: [...document.querySelectorAll<HTMLElement>('[data-waiting-id="W-1"] .board__card-ask')].every((ask) => {
          const askBox = ask.getBoundingClientRect();
          const itemBox = ask.closest<HTMLElement>(".board__waiting-item")!.getBoundingClientRect();
          return getComputedStyle(ask).whiteSpace === "nowrap" && askBox.left >= itemBox.left - 0.5 && askBox.right <= itemBox.right + 0.5;
        }),
        separatorsEndPreviousAsk: [...document.querySelectorAll<HTMLElement>(".board__card-ask")].every((ask) => {
          const before = getComputedStyle(ask, "::before").content;
          const after = getComputedStyle(ask, "::after").content;
          return !before.includes(",") && (ask === ask.parentElement?.lastElementChild || after.includes(","));
        }),
        continuationStartsWithAsk: [...document.querySelectorAll<HTMLElement>('[data-waiting-id="W-1"] .board__card-ask')]
          .slice(1)
          .some((ask, index, asks) => ask.getBoundingClientRect().top > (asks[index - 1] ?? ask.parentElement!.firstElementChild!).getBoundingClientRect().top + 0.5),
        continuationUnindented: (() => {
          const asks = [...document.querySelectorAll<HTMLElement>('[data-waiting-id="W-1"] .board__card-ask')];
          const first = asks[0]?.getBoundingClientRect();
          if (!first) return false;
          return asks.filter((ask) => ask.getBoundingClientRect().top > first.top + 0.5)
            .every((ask) => Math.abs(ask.getBoundingClientRect().left - first.left) <= 0.5);
        })(),
      };
    });
    expect(geometry.stripBottom, `${width}: strip stays above the lifecycle columns`).toBeLessThanOrEqual(geometry.columnsTop + 0.5);
    expect(geometry.stripHeight, `${width}: many-entry strip keeps the reference whole-strip height`).toBeCloseTo(96, 0);
    expect(geometry.columnsHeight, `${width}: strip leaves useful lifecycle space`).toBeGreaterThan(260);
    expect(geometry.rowTops, `${width}: every waiting entry stays in one horizontal row`).toBe(1);
    expect(geometry.initialScrollLeft, `${width}: the horizontal waiting row opens at its first entry`).toBe(0);
    expect(geometry.horizontalOverflow, `${width}: excess waiting entries overflow inside the strip`).toBe(true);
    expect(geometry.overflowX, `${width}: the waiting row scrolls left and right`).toBe("auto");
    expect(geometry.overflowY, `${width}: the waiting row never scrolls vertically`).toBe("hidden");
    expect(geometry.entryHeights.every((height) => Math.abs(height - 66) <= 0.5), `${width}: every entry has reference height for one title plus three ask lines`).toBe(true);
    expect(geometry.titleEllipsized, `${width}: long strip title ellipsizes on one line`).toBe(true);
    expect(geometry.combinedAsksFit, `${width}: every combined ask wraps at a kind boundary and remains complete`).toBe(true);
    expect(geometry.separatorsEndPreviousAsk, `${width}: no continuation line begins with a separator on strip or card copy`).toBe(true);
    if (width === 390) {
      expect(geometry.continuationStartsWithAsk, "390: the combined strip entry exercises a continuation line").toBe(true);
      expect(geometry.continuationUnindented, "390: wrapped ask continuations start flush with the first ask").toBe(true);
    }
    await expect(page.locator('[data-waiting-id="W-1"] .board__card-ask'), `${width}: combined ask words and question count stay complete`).toHaveText(["Greenlight", "2 Inbox decisions", "Human gate"]);
    expect(geometry.pageOverflow, `${width}: strip creates no page-level overflow`).toBeLessThanOrEqual(0);
    await expect(strip).toBeVisible();
    await expect(columns).toBeVisible();
    const items = page.locator(".board__waiting-items");
    const more = page.getByRole("button", { name: "Show more waiting asks" });
    await expect(more, `${width}: overflow arrow appears while entries continue right`).toBeVisible();

    const resetWaitingRow = async (): Promise<void> => {
      await items.evaluate((node) => {
        node.scrollLeft = 0;
        node.dispatchEvent(new Event("scroll"));
      });
      await expect(more).toBeVisible();
    };
    const expectAdvance = async (activate: "pointer" | "Enter" | "Space"): Promise<void> => {
      await resetWaitingRow();
      const measure = await items.evaluate((node) => ({ width: node.clientWidth, max: node.scrollWidth - node.clientWidth }));
      if (activate === "pointer") await more.click();
      else {
        await more.focus();
        await more.press(activate);
      }
      await expect.poll(() => items.evaluate((node) => node.scrollLeft), { message: `${width}: ${activate} on the right arrow advances the waiting row` })
        .toBeGreaterThanOrEqual(Math.max(1, Math.min(measure.width * 0.8, measure.max) - 2));
    };
    await expectAdvance("pointer");
    if (width === 1280 || width === 390) {
      await expectAdvance("Enter");
      await expectAdvance("Space");
    }
    await items.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
      node.dispatchEvent(new Event("scroll"));
    });
    await expect(more, `${width}: right arrow hides at the end`).toHaveCount(0);
    await resetWaitingRow();
    const populatedLabel = await waitingLabelGeometry(page);
    if (width === 1280) {
      expect(populatedLabel.belowDelta, "1280: populated count sits below the label").toBeGreaterThanOrEqual(-0.5);
      expect(populatedLabel.rightDelta, "1280: populated count right edge matches the label text").toBeLessThanOrEqual(1);
    } else {
      expect(populatedLabel.inlineGap, `${width}: populated count sits just right of the label`).toBeGreaterThanOrEqual(0);
      expect(populatedLabel.inlineGap, `${width}: populated count stays close to the label`).toBeLessThanOrEqual(8);
      expect(populatedLabel.verticalOverlap, `${width}: populated label and count share one line`).toBeGreaterThan(0);
    }

    const rowEntries = page.locator(".board__waiting-item");
    await rowEntries.first().focus();
    for (let index = 0; index < 6; index += 1) {
      await expect(rowEntries.nth(index), `${width}: keyboard focus reaches horizontal entry ${index + 1}`).toBeFocused();
      const visible = await rowEntries.nth(index).evaluate((item) => {
        const entry = item.getBoundingClientRect();
        const rail = item.parentElement!.getBoundingClientRect();
        return entry.right > rail.left + 0.5 && entry.left < rail.right - 0.5;
      });
      expect(visible, `${width}: focused entry ${index + 1} scrolls into view`).toBe(true);
      if (index < 5) await page.keyboard.press("Tab");
    }

    const waitingCard = page.locator('[data-card-id="W-1"]');
    const normalCard = page.locator('[data-card-id="W-7"]');
    const colours = await Promise.all([waitingCard, normalCard].map((card) => card.evaluate((node) => ({ background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderLeftColor }))));
    expect(colours[0]?.background, `${width}: waiting lifecycle card has a neutral highlight`).not.toBe(colours[1]?.background);
    expect(colours[0]?.border, `${width}: waiting lifecycle card keeps its amber rule`).not.toBe(colours[1]?.border);

    many.opera = [makeOpus("W-7", "done")];
    many.inbox = { opera: [], petitiones: [] };
    await page.goto(`${served.baseURL}/?w463=b2-empty-${width}#/board`);
    const emptyStrip = page.locator(".board__waiting");
    await expect(emptyStrip, `${width}: empty Board keeps its waiting strip`).toBeVisible();
    await expect(emptyStrip, `${width}: empty Board marks its collapsed strip`).toHaveClass(/board__waiting--empty/);
    const emptyGeometry = await emptyStrip.evaluate((node) => {
      const label = node.querySelector<HTMLElement>(".board__waiting-label")!;
      const stripBox = node.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      return { stripHeight: stripBox.height, labelHeight: labelBox.height, stripBottom: stripBox.bottom };
    });
    expect(emptyGeometry.stripHeight, `${width}: empty strip collapses to exactly its label line`).toBeCloseTo(emptyGeometry.labelHeight, 0);
    expect(emptyGeometry.stripHeight, `${width}: empty strip reserves no populated entry height`).toBeLessThan(30);
    expect(await page.locator(".board__columns").evaluate((node) => node.getBoundingClientRect().top), `${width}: lifecycle columns move up below the collapsed label line`).toBeLessThan(geometry.columnsTop - 50);
    await expect(emptyStrip.locator(".board__waiting-label span"), `${width}: empty strip keeps its label`).toHaveText("Waiting on you");
    await expect(emptyStrip.locator(".board__waiting-label strong"), `${width}: empty strip keeps its zero`).toHaveText("0");
    await expect(emptyStrip.locator(".board__waiting-items, .board__waiting-item"), `${width}: empty strip has no item content`).toHaveCount(0);
    await expect(emptyStrip.locator(".board__waiting-more"), `${width}: empty strip has no overflow arrow`).toHaveCount(0);
    const emptyText = await emptyStrip.evaluate((node) => node.textContent?.replace(/\s/g, ""));
    expect(emptyText, `${width}: empty strip contains only its inline label and zero`).toBe("Waitingonyou0");
    await expect(page.locator('a[href="#/board"] .sidebar__badge--board, .sidebar__toggle .sidebar__badge--toggle'), `${width}: empty Board carries no Board badge`).toHaveCount(0);
    const emptyLabel = await waitingLabelGeometry(page);
    expect(emptyLabel.inlineGap, `${width}: empty zero sits just right of the label`).toBeGreaterThanOrEqual(0);
    expect(emptyLabel.inlineGap, `${width}: empty zero stays close to the label`).toBeLessThanOrEqual(8);
    expect(emptyLabel.verticalOverlap, `${width}: empty label and zero share one collapsed line`).toBeGreaterThan(0);
    if (width === 390) {
      await expect(page.locator('.board__column').first(), "390: the empty phone Board visibly opens on Planned").toHaveAttribute("data-column-id", "planned");
    }

    many.opera = [makeOpus("W-9", "backlog")];
    await page.goto(`${served.baseURL}/?w463=b2-one-${width}#/board`);
    await expect(page.locator(".board__waiting-item"), `${width}: one ask has one fixed-height entry`).toHaveCount(1);
    expect(await page.locator(".board__waiting").evaluate((node) => node.getBoundingClientRect().height), `${width}: one-entry strip keeps the reference whole-strip height`).toBeCloseTo(96, 0);
    await expect(page.getByRole("button", { name: "Show more waiting asks" }), `${width}: no arrow appears without horizontal overflow`).toHaveCount(0);

    if (width === 390) {
      many.opera = Array.from({ length: 14 }, (_, index) => makeOpus(`W-${20 + index}`, "backlog"));
      many.inbox = { opera: [], petitiones: [] };
      await page.goto(`${served.baseURL}/?w463=b2-overflow-${width}#/board`);
      await expect(page.locator(".board__waiting-item"), "390: more than twelve waits remain in the strip").toHaveCount(14);
      const scrolling = await page.evaluate(() => {
        const items = document.querySelector<HTMLElement>(".board__waiting-items")!;
        const columns = document.querySelector<HTMLElement>(".board__columns")!;
        const initialScrollLeft = items.scrollLeft;
        return {
          overflowX: getComputedStyle(items).overflowX,
          scrollable: items.scrollWidth > items.clientWidth,
          rowTops: new Set([...items.querySelectorAll<HTMLElement>(".board__waiting-item")].map((item) => Math.round(item.getBoundingClientRect().top))).size,
          initialScrollLeft,
          columnsTop: columns.getBoundingClientRect().top,
          viewportHeight: innerHeight,
        };
      });
      expect(scrolling.overflowX).toBe("auto");
      expect(scrolling.scrollable, "390: the long waiting row scrolls independently").toBe(true);
      expect(scrolling.rowTops, "390: fourteen waiting entries remain in one row").toBe(1);
      expect(scrolling.initialScrollLeft, "390: the waiting row opens at its first entries").toBe(0);
      await expect(page.getByRole("button", { name: "Show more waiting asks" }), "390: the chevron cues additional waiting entries").toBeVisible();
      expect(scrolling.columnsTop, "390: lifecycle work remains in the initial viewport").toBeLessThan(scrolling.viewportHeight);
      const overflowEntries = page.locator(".board__waiting-item");
      await overflowEntries.first().focus();
      for (let index = 0; index < 14; index += 1) {
        await expect(overflowEntries.nth(index), `390: keyboard focus reaches waiting entry ${index + 1}`).toBeFocused();
        if (index < 13) await page.keyboard.press("Tab");
      }
    }
    many.opera = manyOpera;
    many.inbox = manyInbox;
  }
});

test("W-463-b3 Board badge counts waiting opera while Inbox badge stays question-only", async ({ page }) => {
  served = await startServed("w463-b3");
  const fixture: Fixture = {
    opera: [makeOpus("W-1", "backlog"), makeOpus("W-2", "building", { patron: { status: "pending" } }), makeOpus("W-3", "done")],
    inbox: {
      opera: [{ id: "W-1", title: "W-1 title", collegium: "design", sella: "builder" }, { id: "W-2", title: "W-2 title", collegium: "design", sella: "builder" }],
      petitiones: [
        { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
        { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
      ],
    },
  };
  await installFixture(page, fixture);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w463=b3-wide#/board`);
  await expect(page.locator('a[href="#/board"] .sidebar__badge--board'), "expanded Board badge counts each waiting opus once").toHaveText("2");
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge'), "Inbox badge stays question-only and once per linked opus").toHaveText("1");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.locator('a[href="#/board"] .sidebar__badge--dot')).toHaveText("2");
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge--dot')).toHaveText("1");

  for (const width of [640, 390] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    const toggle = page.getByRole("button", { name: "Expand sidebar" });
    await expect(page.locator(".sidebar__toggle .sidebar__badge--toggle"), `${width}: closed overlay keeps the mock's Board alert visible`).toHaveText("2");
    await expect(toggle, `${width}: D-119 toggle name is unchanged`).toHaveAccessibleName("Expand sidebar");
    await expect(toggle, `${width}: closed toggle describes the full Board wait`).toHaveAccessibleDescription("Board, 2 waiting on you");
    await toggle.click();
    await expect(page.locator(".sidebar__toggle .sidebar__badge--toggle"), `${width}: open overlay has no duplicate Board alert`).toHaveCount(0);
    await expect(page.locator('a[href="#/board"] .sidebar__badge--board')).toHaveText("2");
    await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("1");
    await page.keyboard.press("Escape");
  }

  fixture.opera = Array.from({ length: 12 }, (_, index) => makeOpus(`W-${20 + index}`, "backlog"));
  fixture.inbox = { opera: [], petitiones: [] };
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  const cappedToggle = page.getByRole("button", { name: "Expand sidebar" });
  await expect(page.locator(".sidebar__toggle .sidebar__badge--toggle"), "closed dot caps only its visible copy").toHaveText("9+");
  await expect(cappedToggle, "the description exposes the full number behind 9+").toHaveAccessibleDescription("Board, 12 waiting on you");

  await page.unroute("**/api/officina");
  await page.unroute("**/api/opera");
  await page.unroute("**/api/inbox");
  const liveOpera = [makeOpus("W-1", "backlog"), makeOpus("W-2", "backlog")];
  const staleOpera = [makeOpus("W-9", "backlog")];
  let releaseShell!: () => void;
  const shellGate = new Promise<void>((resolve) => { releaseShell = resolve; });
  let officinaCalls = 0;
  let operaCalls = 0;
  let staleOfficinaSettled = false;
  let staleOperaSettled = false;
  await page.route("**/api/officina", async (route) => {
    const call = ++officinaCalls;
    if (call === 1) await shellGate;
    await route.fulfill({ json: officina });
    if (call === 1) staleOfficinaSettled = true;
  });
  await page.route("**/api/opera", async (route) => {
    const call = ++operaCalls;
    if (call === 1) await shellGate;
    await route.fulfill({ json: call === 1 ? staleOpera : liveOpera });
    if (call === 1) staleOperaSettled = true;
  });
  await page.route("**/api/inbox", (route) => route.fulfill({ json: { opera: [], petitiones: [] } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w463=b3-stale-shell#/inbox`);
  await expect.poll(() => officinaCalls).toBeGreaterThanOrEqual(1);
  await expect.poll(() => operaCalls).toBeGreaterThanOrEqual(1);
  await page.goto(`${served.baseURL}/?w463=b3-live-board#/board`);
  await expect(page.locator(".board__waiting-label strong"), "the mounted Board reports its live model").toHaveText("2");
  await expect(page.locator('a[href="#/board"] .sidebar__badge--board')).toHaveText("2");
  releaseShell();
  await expect.poll(() => staleOfficinaSettled && staleOperaSettled).toBe(true);
  await expect(page.locator('a[href="#/board"] .sidebar__badge--board'), "an obsolete shell snapshot cannot overwrite the mounted Board").toHaveText("2");

  await page.unroute("**/api/officina");
  await page.unroute("**/api/opera");
  await page.unroute("**/api/inbox");
  await page.route("**/api/officina", (route) => route.fulfill({ status: 500, json: { error: "officina unavailable" } }));
  await page.route("**/api/opera", (route) => route.fulfill({ status: 500, json: { error: "opera unavailable" } }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: {
    opera: [{ id: "W-1", title: "W-1 title", collegium: "design", sella: "builder" }],
    petitiones: [{ id: "P-1", opus: "W-1", from: "producer", subject: "Choose", body: "Choose" }],
  } }));
  await page.goto(`${served.baseURL}/?w463=b3-independent-inbox#/board`);
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge'), "Inbox refresh survives failed Officina and opera reads").toHaveText("1");
});
