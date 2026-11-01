import { expect, test, type Locator, type Page } from "@playwright/test";
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

const makeOpus = (index: number, state: string) => ({
  id: `W-${index + 1}`,
  title: index === 0 ? `A long selected title ${"with readable phone detail ".repeat(12)}` : `Work item ${index + 1}`,
  body: index === 0 ? `Long record detail ${"that remains readable and reachable on a phone. ".repeat(80)}` : `Body ${index + 1}`,
  kind: "ui", collegium: "design", sella: "builder", state, tokens: 0,
  probationes: index < 6 ? { patron: { status: "pending", at: "2026-10-31T00:00:00Z" } } : {},
  traditio: { sella: "builder", stage: state, next: "Patron decision", blocked_on: "patron", at: "2026-10-31T00:00:00Z" },
});

const opera = [
  makeOpus(0, "backlog"), makeOpus(1, "backlog"), makeOpus(2, "building"), makeOpus(3, "verifying"),
  makeOpus(4, "review"), makeOpus(5, "done"), makeOpus(6, "greenlit"), makeOpus(7, "building"),
  makeOpus(8, "verifying"), makeOpus(9, "review"), makeOpus(10, "done"), makeOpus(11, "halted"),
];
const inbox = {
  opera: opera.slice(0, 6).map(({ id, title, collegium, sella, traditio }) => ({ id, title, collegium, sella, traditio })),
  petitiones: [{ id: "P-1", opus: "W-1", from: "producer", subject: "Choose the path", body: "Please decide", opened: "2026-10-31T00:00:00Z" }],
};

async function installFixture(page: Page): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: Array.from({ length: 18 }, (_, index) => ({ at: "2026-10-31T00:00:00Z", type: "attention", summary: `detail event ${index + 1}` })) }));
}

async function openBoard(page: Page, width: number, row: string): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served!.baseURL}/?w411=${row}-${width}#/board`);
  const prompt = page.locator("#token-prompt-input");
  if (await prompt.isVisible()) {
    await prompt.fill(served!.token);
    await page.locator(".token-prompt__submit").click();
  }
  await expect(page.locator(".board__column")).toHaveCount(6);
}

async function cssColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

async function cardColours(locator: Locator): Promise<{ background: string; border: string }> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor };
  });
}

function contrastRatio(foreground: string, background: string): number {
  const channels = (value: string): number[] => [...value.matchAll(/[\d.]+/g)].slice(0, 3).map(([part]) => Number(part) / 255);
  const luminance = (value: string): number => {
    const [red = 0, green = 0, blue = 0] = channels(value).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test("W-411-b1 header omits implementation prose at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w411-b1");
  await installFixture(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b1");
    const header = page.locator(".board__header");
    await expect(header).toContainText("Board");
    await expect(header).toContainText("Sample Studio");
    await expect(header).not.toContainText("serve process");
    await expect(header).not.toContainText("project registry");
    await expect(header.locator(".board__project-select-reason")).toHaveCount(0);
    expect(await header.evaluate((node) => node.scrollWidth <= node.clientWidth), `${width}: header has no horizontal overflow`).toBe(true);
  }
});

test("W-411-b2 phase navigation reaches and names every ruled-width phase", async ({ page }) => {
  served = await startServed("w411-b2");
  await installFixture(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b2");
    const strip = page.locator(".board__strip");
    const columns = page.locator(".board__columns");
    if (width === 390) {
      await expect(strip).toBeVisible();
      const rule = await cssColour(page, "--rule");
      const ink = await cssColour(page, "--ink");
      const surface = await cssColour(page, "--surface");
      const initial = strip.getByRole("button", { name: /Planned/ });
      const initialSibling = strip.getByRole("button", { name: /In progress/ });
      await expect(initial).toHaveText(/Planned/);
      expect(await cardColours(initial), "390: current phase uses the neutral ink/rule treatment").toEqual({ background: rule, border: ink });
      expect((await cardColours(initialSibling)).background, "390: an unselected phase keeps the surface fill").toBe(surface);
      const target = strip.getByRole("button", { name: /Awaiting review/ });
      await target.click();
      await expect(target).toHaveAttribute("aria-current", "true");
      expect(await cardColours(target), "390: tap moves the visible current treatment").toEqual({ background: rule, border: ink });
      expect((await cardColours(initial)).background, "390: the prior phase loses the current fill").toBe(surface);
      await expect(page.locator('.board__column[data-column-id="awaiting_review"]')).toBeInViewport();
      await columns.evaluate((node) => node.querySelector<HTMLElement>('[data-column-id="done"]')?.scrollIntoView({ inline: "start", block: "nearest" }));
      const done = strip.getByRole("button", { name: /Done/ });
      await expect(done).toHaveAttribute("aria-current", "true");
      expect(await cardColours(done), "390: direct track scrolling moves the visible current treatment").toEqual({ background: rule, border: ink });
      await page.locator('[data-waiting-id="W-1"]').click();
      await page.locator(".board-drawer__close").click();
      await expect(page.locator(".board-drawer")).toBeHidden();
      await expect(done, "390: return restores the phase named by the sole lifecycle track").toHaveAttribute("aria-current", "true");
      expect(await cardColours(done), "390: restored current styling follows the restored track").toEqual({ background: rule, border: ink });
    } else {
      await expect(strip).toBeHidden();
      expect(await columns.evaluate((node) => node.scrollWidth > node.clientWidth), `${width}: phases remain locally scrollable`).toBe(true);
      await expect(page.locator(".board__scroll-cue")).toBeVisible();
    }
  }
});

test("W-411-b3 item detail remains readable and closable at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w411-b3");
  await installFixture(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b3");
    await page.locator('[data-waiting-id="W-1"]').click();
    const drawer = page.locator(".board-drawer");
    const header = drawer.locator(".board-drawer__header");
    const close = drawer.locator(".board-drawer__close");
    const title = drawer.locator(".board-drawer__title");
    await expect(header).toBeVisible();
    await expect(close).toBeVisible();
    await expect(title).toContainText("A long selected title");
    expect(await title.evaluate((node) => {
      const style = getComputedStyle(node);
      return style.overflow === "visible" && style.textOverflow !== "ellipsis" && style.webkitLineClamp === "none";
    }), `${width}: the complete long title is not truncated`).toBe(true);
    await expect(drawer.locator(".board-drawer__toolbar")).toHaveCount(0);
    await drawer.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(drawer.locator(".board-drawer__record")).toBeVisible();
    const geometry = await drawer.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const head = node.querySelector<HTMLElement>(".board-drawer__header")!.getBoundingClientRect();
      const closeBox = node.querySelector<HTMLElement>(".board-drawer__close")!.getBoundingClientRect();
      return {
        headerScrolledAway: head.bottom <= box.top + 1,
        closeInside: closeBox.top >= box.top && closeBox.bottom <= box.bottom && closeBox.left >= box.left && closeBox.right <= box.right,
        closeTarget: closeBox.width >= 44 && closeBox.height >= 44,
        noHorizontalOverflow: node.scrollWidth <= node.clientWidth,
      };
    });
    expect(geometry.headerScrolledAway, `${width}: the title and metadata scroll away with the detail`).toBe(true);
    expect(geometry.noHorizontalOverflow, `${width}: detail has no horizontal overflow`).toBe(true);
    await expect(close).toBeVisible();
    expect(geometry.closeInside, `${width}: the pinned Close control remains inside the drawer`).toBe(true);
    expect(geometry.closeTarget, `${width}: Close retains its 44px target`).toBe(true);
    expect(await close.evaluate((node) => getComputedStyle(node).backgroundColor), `${width}: Close has an opaque surface backing`).toBe(await cssColour(page, "--surface"));
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const focus = await close.evaluate((node) => {
      const style = getComputedStyle(node);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(focus.style, `${width}: keyboard focus on Close is visible`).not.toBe("none");
    expect(focus.width, `${width}: keyboard focus on Close has a drawn width`).toBeGreaterThanOrEqual(2);
    await close.click();
    await expect(drawer, `${width}: pointer Close remains clickable at the bottom`).toBeHidden();
  }
});

test("W-411-b4 return restores selection, exact focus and both scroll offsets at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w411-b4");
  await installFixture(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b4");
    const columns = page.locator(".board__columns");
    const waitingItems = page.locator(".board__waiting-items");
    const waitingCard = page.locator('[data-card-id="W-5"]');
    const ordinaryCard = page.locator('[data-card-id="W-11"]');
    const waitingBefore = await cardColours(waitingCard);
    const ordinaryBefore = await cardColours(ordinaryCard);
    expect(waitingBefore.background, `${width}: waiting and ordinary cards begin with distinct fills`).not.toBe(ordinaryBefore.background);
    await columns.evaluate((node) => { node.scrollLeft = Math.min(node.scrollWidth - node.clientWidth, Math.max(40, node.clientWidth)); });
    await waitingItems.evaluate((node) => { node.scrollLeft = Math.min(node.scrollWidth - node.clientWidth, 596); });
    const opener = page.locator('[data-waiting-id="W-5"]');
    await opener.focus();
    const before = {
      columns: await columns.evaluate((node) => node.scrollLeft),
      waiting: await waitingItems.evaluate((node) => node.scrollLeft),
    };
    expect(before.columns, `${width}: phase track starts away from zero`).toBeGreaterThan(0);
    expect(before.waiting, `${width}: waiting rail starts away from zero`).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(page.locator(".board-drawer")).toBeVisible();
    await expect(page.locator('[data-card-id="W-5"]')).toHaveAttribute("aria-selected", "true");
    await page.locator(".board-drawer__close").click();
    await expect(page.locator(".board-drawer")).toBeHidden();
    await expect(opener, `${width}: focus returns to the waiting-strip opener`).toBeFocused();
    const selected = page.locator('[data-card-id="W-5"]');
    await expect(selected, `${width}: item selection survives closing detail`).toHaveAttribute("aria-selected", "true");
    const rule = await cssColour(page, "--rule");
    await expect.poll(async () => (await cardColours(selected)).background, { message: `${width}: selected waiting card reaches the rule fill` }).toBe(rule);
    const selectedColours = await cardColours(selected);
    expect(selectedColours.background, `${width}: selection differs from the same waiting card before selection`).not.toBe(waitingBefore.background);
    expect(selectedColours.background, `${width}: selection also differs from an ordinary unselected card`).not.toBe(ordinaryBefore.background);
    for (const label of [".board__waiting-owner small", ".board__waiting-next small", ".board__waiting-ask small"]) {
      const colours = await selected.locator(label).evaluate((node) => {
        const style = getComputedStyle(node);
        return { foreground: style.color, background: getComputedStyle(node.closest(".board__card")!).backgroundColor };
      });
      expect(contrastRatio(colours.foreground, colours.background), `${width}: ${label} meets 4.5:1 on the selected fill`).toBeGreaterThanOrEqual(4.5);
    }
    expect(await columns.evaluate((node) => node.scrollLeft), `${width}: phase scroll is restored`).toBeCloseTo(before.columns, 0);
    expect(await waitingItems.evaluate((node) => node.scrollLeft), `${width}: waiting scroll is restored`).toBeCloseTo(before.waiting, 0);

    await ordinaryCard.scrollIntoViewIfNeeded();
    await ordinaryCard.focus();
    const cardScroll = await columns.evaluate((node) => node.scrollLeft);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(ordinaryCard, `${width}: lifecycle-card focus returns to the lifecycle card`).toBeFocused();
    await expect(ordinaryCard, `${width}: lifecycle-card selection remains`).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => (await cardColours(ordinaryCard)).background, { message: `${width}: an ordinary card reaches the selected rule fill` }).toBe(rule);
    expect(rule, `${width}: an ordinary card also differs from itself after selection`).not.toBe(ordinaryBefore.background);
    expect(await columns.evaluate((node) => node.scrollLeft), `${width}: lifecycle-card phase scroll is restored`).toBeCloseTo(cardScroll, 0);
  }
});
