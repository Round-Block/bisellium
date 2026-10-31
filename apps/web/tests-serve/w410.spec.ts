import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const MASTER_STRIP_CARD_HEIGHT = 66;
const MASTER_LIFECYCLE_WAITING_HEIGHT = 108;
const HEIGHT_RATIO = 1.3;
const HEIGHT_RATIO_TOLERANCE = 0.05;
const NOW = new Date("2026-10-31T12:00:00Z");

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

const makeOpus = (
  id: string,
  state: string,
  title = `${id} title`,
  probationes: Record<string, { status: string; at?: string; evidence?: { href: string } }> = {},
  traditio: unknown = { sella: "builder", stage: state, next: "move", blocked_on: "patron", at: "2026-10-31T06:00:00Z" },
) => ({ id, title, body: `${id} reason`, kind: "ui", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio });

const longTitle = `A waiting title long enough to exercise the selected handoff rail ${"without colliding with its facts ".repeat(8)}`;
const opera = [
  makeOpus("W-1", "backlog", longTitle, { patron: { status: "pending", at: "2026-10-31T08:00:00Z", evidence: { href: "studio/ci/reviews/W-1.md" } } }),
  makeOpus("W-2", "backlog", "Second greenlight", {}, { sella: "builder", stage: "backlog", blocked_on: "patron", at: "2026-10-31T06:00:00Z" }),
  makeOpus("W-3", "building", "Human sign-off", { patron: { status: "pending", at: "2026-10-31T09:00:00Z" } }),
  makeOpus("W-4", "verifying", "Unknown next actor", { patron: { status: "pending" } }, { sella: "qa-lead", stage: "verifying", next: "sign off", blocked_on: "none", at: "not-a-time" }),
  makeOpus("W-5", "greenlit"), makeOpus("W-6", "building"), makeOpus("W-7", "building"), makeOpus("W-8", "verifying"),
  makeOpus("W-9", "review"), makeOpus("W-10", "review"), makeOpus("W-11", "done"), makeOpus("W-12", "halted"),
];
const inbox = {
  opera: [
    { id: "W-1", title: longTitle, collegium: "design", sella: "builder", traditio: opera[0]!.traditio },
    { id: "W-3", title: "Human sign-off", collegium: "design", sella: "builder", traditio: opera[2]!.traditio },
    { id: "W-4", title: "Unknown next actor", collegium: "design", sella: "builder", traditio: opera[3]!.traditio },
  ],
  petitiones: [{ id: "P-1", opus: "W-1", from: "architect", opened: new Date("2026-10-29T12:00:00Z").getTime(), subject: "Choose", body: "Choose the reviewed design" }],
};

async function installFixture(page: Page): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: [] }));
}

async function openBoard(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served!.baseURL}/?w410=b3-${width}#/board`);
  const prompt = page.locator("#token-prompt-input");
  if (await prompt.isVisible()) {
    await prompt.fill(served!.token);
    await page.locator(".token-prompt__submit").click();
  }
  await expect(page.locator(".board__waiting-item")).toHaveCount(4);
}

test("W-410-b3 selected handoff rail is about 1.3x taller and legible at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w410-b3");
  await page.clock.setFixedTime(NOW);
  await installFixture(page);

  for (const width of [1280, 640, 390] as const) {
    await openBoard(page, width);
    const strip = page.locator('[data-waiting-id="W-1"]');
    const card = page.locator('[data-card-id="W-1"]');
    const stripHeight = (await strip.boundingBox())!.height;
    const cardHeight = (await card.boundingBox())!.height;
    expect(stripHeight / MASTER_STRIP_CARD_HEIGHT, `${width}: strip card ratio against master`).toBeGreaterThanOrEqual(HEIGHT_RATIO - HEIGHT_RATIO_TOLERANCE);
    expect(stripHeight / MASTER_STRIP_CARD_HEIGHT, `${width}: strip card ratio against master`).toBeLessThanOrEqual(HEIGHT_RATIO + HEIGHT_RATIO_TOLERANCE);
    expect(cardHeight / MASTER_LIFECYCLE_WAITING_HEIGHT, `${width}: lifecycle waiting-card ratio against master`).toBeGreaterThanOrEqual(HEIGHT_RATIO - HEIGHT_RATIO_TOLERANCE);
    expect(cardHeight / MASTER_LIFECYCLE_WAITING_HEIGHT, `${width}: lifecycle waiting-card ratio against master`).toBeLessThanOrEqual(HEIGHT_RATIO + HEIGHT_RATIO_TOLERANCE);
    const railClearance = await page.locator(".board__waiting-rail").evaluate((node) => {
      const items = node.querySelector<HTMLElement>(".board__waiting-items")!.getBoundingClientRect();
      const chevron = node.querySelector<HTMLElement>(".board__waiting-more")!.getBoundingClientRect();
      return items.right <= chevron.left + 0.5;
    });
    expect(railClearance, `${width}: scroll viewport ends before the chevron`).toBe(true);

    for (const surface of [strip, card]) {
      await expect(surface.locator(".board__waiting-owner-value"), `${width}: owner value`).toHaveText("builder");
      await expect(surface.locator(".board__waiting-next-value"), `${width}: next-actor value`).toHaveText("patron");
      await expect(surface.locator(".board__waiting-ask-value"), `${width}: exact W-409 ask words`).toHaveText("Greenlight, Inbox decision, Human gate");
      await expect(surface.locator(".board__waiting-age"), `${width}: mono age numeral`).toHaveText("2d");
      const geometry = await surface.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const selectors = [".board__waiting-owner", ".board__waiting-next", ".board__waiting-ask"];
        const parts = selectors.map((selector) => node.querySelector<HTMLElement>(selector)!.getBoundingClientRect());
        const captions = [...node.querySelectorAll<HTMLElement>(".board__waiting-owner small, .board__waiting-next small, .board__waiting-ask small")];
        const values = [...node.querySelectorAll<HTMLElement>(".board__waiting-owner-value, .board__waiting-next-value, .board__waiting-ask-value")];
        const ask = node.querySelector<HTMLElement>(".board__waiting-ask-value")!;
        const chevron = document.querySelector<HTMLElement>(".board__waiting-more");
        return {
          contained: parts.every((part) => part.top >= box.top && part.bottom <= box.bottom && part.left >= box.left && part.right <= box.right),
          separated: parts[0]!.bottom <= parts[2]!.top && parts[1]!.bottom <= parts[2]!.top,
          captionsReadable: captions.every((caption) => Number.parseFloat(getComputedStyle(caption).fontSize) >= 11 && !getComputedStyle(caption).fontFamily.includes("Mono")),
          valuesReadable: values.every((value) => Number.parseFloat(getComputedStyle(value).fontSize) >= 12 && !getComputedStyle(value).fontFamily.includes("Mono")),
          askReadable: ask.scrollWidth <= ask.clientWidth + 0.5 && ask.getBoundingClientRect().right <= box.right + 0.5,
          clearsChevron: !node.classList.contains("board__waiting-item") || chevron === null || box.right <= chevron.getBoundingClientRect().left + 0.5,
        };
      });
      expect(geometry.contained, `${width}: OWNER/NEXT/ASK captions and values stay inside the card`).toBe(true);
      expect(geometry.separated, `${width}: OWNER/NEXT/ASK captions and values do not overlap`).toBe(true);
      expect(geometry.captionsReadable, `${width}: captions are at least 11px readable sans text`).toBe(true);
      expect(geometry.valuesReadable, `${width}: values are at least 12px readable sans text`).toBe(true);
      expect(geometry.askReadable, `${width}: every active ask kind is visibly readable`).toBe(true);
      expect(geometry.clearsChevron, `${width}: strip entry stays clear of the chevron`).toBe(true);
    }
    await expect(page.locator('[data-waiting-id="W-4"] .board__waiting-next-value'), `${width}: unknown next actor is explicit`).toHaveText("Unassigned");
    await expect(card.locator(".board__card-title"), `${width}: complete long title remains available`).toHaveAttribute("title", longTitle);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: no page overflow`).toBeLessThanOrEqual(0);
  }
});
test("W-410-b4 drawer shows reasons and evidence at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w410-b4");
  await page.clock.setFixedTime(NOW);
  await installFixture(page);

  for (const width of [1280, 640, 390] as const) {
    await openBoard(page, width);
    await page.locator('[data-waiting-id="W-1"]').click();
    const drawer = page.getByRole("dialog", { name: longTitle });
    await expect(drawer, `${width}: the existing drawer opens`).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Why it waits" }), `${width}: reasons are named`).toBeVisible();
    await expect(drawer.locator(".board-drawer__reason"), `${width}: question, recorded-pending gate and handoff reasons are displayed`).toContainText(["Choose: Choose the reviewed design", "Patron call is pending.", "move"]);
    await expect(drawer.locator(".board-drawer__reason", { hasText: "W-1 reason" }), `${width}: the opus body is not repeated as a waiting reason`).toHaveCount(0);
    await expect(drawer.getByText("W-1 reason", { exact: true }), `${width}: the opus body appears once in its record section`).toHaveCount(1);
    await expect(drawer.getByRole("heading", { name: "Evidence" }), `${width}: evidence is named`).toBeVisible();
    await expect(drawer.locator('.board-drawer__waiting-evidence[href="studio/ci/reviews/W-1.md"]'), `${width}: recorded evidence is a visible link`).toHaveText("Patron call");
    const geometry = await drawer.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const reason = node.querySelector<HTMLElement>(".board-drawer__reasons")!.getBoundingClientRect();
      const evidence = node.querySelector<HTMLElement>(".board-drawer__waiting-evidence-list")!.getBoundingClientRect();
      return { reasonInside: reason.left >= box.left && reason.right <= box.right, evidenceInside: evidence.left >= box.left && evidence.right <= box.right };
    });
    expect(geometry.reasonInside, `${width}: reasons stay inside the drawer`).toBe(true);
    expect(geometry.evidenceInside, `${width}: evidence stays inside the drawer`).toBe(true);
    await page.getByRole("button", { name: "close" }).click();

    await page.locator('[data-waiting-id="W-2"]').click();
    const unrecordedDrawer = page.getByRole("dialog", { name: "Second greenlight" });
    await expect(unrecordedDrawer.locator(".board-drawer__reason"), `${width}: an unrecorded human gate gives no waiting reason`).toHaveCount(0);
    await expect(unrecordedDrawer.getByText("Patron call is pending.", { exact: true }), `${width}: the drawer does not invent a pending human gate`).toHaveCount(0);
    await expect(unrecordedDrawer.getByText("No waiting reason recorded.", { exact: true }), `${width}: an empty reason list is stated`).toBeVisible();
    await expect(unrecordedDrawer.getByText("No evidence recorded.", { exact: true }), `${width}: an empty evidence list is stated`).toBeVisible();
    await expect(unrecordedDrawer.getByText("W-2 reason", { exact: true }), `${width}: the unrecorded card body remains only in its record section`).toHaveCount(1);
    await page.getByRole("button", { name: "close" }).click();
  }
});
