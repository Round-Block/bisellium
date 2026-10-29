import { expect, test } from "@playwright/test";
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

const makeOpus = (id: string, state: string, probationes: Record<string, { status: string }> = {}) => ({
  id, title: `${id} title`, body: "", kind: "task", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined,
});

test("W-409-b1 Patron asks retain lifecycle membership at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w409-b1");
  const opera = [
    makeOpus("W-1", "backlog"), makeOpus("W-2", "greenlit"), makeOpus("W-3", "building"),
    makeOpus("W-4", "verifying", { patron: { status: "pending" } }), makeOpus("W-5", "review"),
    makeOpus("W-6", "done"), makeOpus("W-7", "halted"),
  ];
  const inbox = {
    opera: [{ id: "W-1", title: "W-1 title", collegium: "design", sella: "builder" }, { id: "W-4", title: "W-4 title", collegium: "design", sella: "builder" }],
    petitiones: [{ id: "P-1", opus: "W-3", from: "producer", subject: "Choose", body: "Choose" }, { id: "P-orphan", opus: "W-404", from: "producer", subject: "Orphan", body: "Orphan" }],
  };
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w409=b1-${width}#/board`);
    await expect(page.locator('.board__column[data-column-id="needs_you"] [data-card-id]'), `${width}: the three ask sources form membership`).toHaveCount(3);
    for (const [column, id] of [["planned", "W-1"], ["in_progress", "W-3"], ["verifying", "W-4"], ["awaiting_review", "W-5"], ["done", "W-6"], ["halted", "W-7"]] as const) {
      await expect(page.locator(`.board__column[data-column-id="${column}"] [data-card-id="${id}"]`), `${width}: ${id} remains in ${column}`).toHaveCount(1);
    }
    await expect(page.locator('[data-card-id="W-404"]'), `${width}: an orphan ask makes no ghost Board card`).toHaveCount(0);
  }
});

test("W-409-b2 Inbox question totals stay distinct from Board membership at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w409-b2");
  const opera = [makeOpus("W-1", "backlog"), makeOpus("W-2", "building", { patron: { status: "pending" } }), makeOpus("W-3", "done")];
  const inbox = {
    opera: [{ id: "W-1", title: "W-1 title", collegium: "design", sella: "producer" }, { id: "W-2", title: "W-2 title", collegium: "design", sella: "builder" }],
    petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
      { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
    ],
  };
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w409=b2-${width}#/board`);
    await expect(page.locator('.board__column[data-column-id="needs_you"] .board__column-count'), `${width}: Board membership keeps greenlight and human-gate asks`).toHaveText("2");
    await expect(page.locator('.board__column[data-column-id="planned"] .board__column-count'), `${width}: Planned counts W-1 once`).toHaveText("1");
    await expect(page.locator('.board__column[data-column-id="in_progress"] .board__column-count'), `${width}: in progress counts W-2 once`).toHaveText("1");
    await expect(page.locator('.board__column[data-column-id="done"] .board__column-count'), `${width}: Done counts the no-ask opus once`).toHaveText("1");
    if (width === 1280) {
      await expect(page.locator('.sidebar__badge'), `${width}: expanded Inbox badge counts two linked questions as one opus`).toHaveText("1");
    } else {
      await page.getByRole("button", { name: "Expand sidebar" }).click();
      await expect(page.locator('.sidebar__badge'), `${width}: overlay Inbox badge counts questions, not Board-only asks`).toHaveText("1");
      await page.keyboard.press("Escape");
    }
  }
});

test("W-409-b3 ask kinds and long titles stay legible at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w409-b3");
  const longTitle = `A greenlight request whose deliberately long title remains readable from its native affordance ${"across widths ".repeat(20)}`;
  const opera = [
    { ...makeOpus("W-1", "backlog"), title: longTitle },
    makeOpus("W-2", "building", { patron: { status: "pending" } }),
    makeOpus("W-3", "done"),
  ];
  const inbox = {
    opera: [{ id: "W-1", title: longTitle, collegium: "design", sella: "producer" }, { id: "W-2", title: "W-2 title", collegium: "design", sella: "builder" }],
    petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
      { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
      { id: "P-orphan", opus: "W-404", from: "reviewer", subject: "No Board entry", body: "No Board entry" },
    ],
  };
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w409=b3-${width}#/board`);
    const needsW1 = page.locator('.board__column[data-column-id="needs_you"] [data-card-id="W-1"]');
    const phaseW1 = page.locator('.board__column[data-column-id="planned"] [data-card-id="W-1"]');
    for (const card of [needsW1, phaseW1]) {
      await expect(card.locator(".board__card-ask"), `${width}: greenlight and Inbox decisions are distinct on both copies`).toHaveText(["Greenlight", "2 Inbox decisions"]);
      await expect(card.locator(".board__card-title"), `${width}: complete long title remains available`).toHaveAttribute("title", longTitle);
      const geometry = await card.evaluate((node) => {
        const mark = node.querySelector<HTMLElement>(".board__card-asks")!;
        const box = node.getBoundingClientRect();
        const markBox = mark.getBoundingClientRect();
        return { cardHeight: box.height, markLeft: markBox.left, markRight: markBox.right, left: box.left, right: box.right };
      });
      expect(geometry.cardHeight, `${width}: marked card stays within the ruled 108px maximum`).toBeLessThanOrEqual(108.5);
      expect(geometry.markLeft, `${width}: ask mark starts inside its card`).toBeGreaterThanOrEqual(geometry.left - 0.5);
      expect(geometry.markRight, `${width}: ask mark ends inside its card`).toBeLessThanOrEqual(geometry.right + 0.5);
    }
    await expect(page.locator('.board__column[data-column-id="needs_you"] [data-card-id="W-2"] .board__card-ask'), `${width}: unlinked human wait is not called Inbox`).toHaveText("Human gate");
    await expect(page.locator('[data-card-id="W-404"]'), `${width}: orphan decision has no Board mark or card`).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: marks add no page-level horizontal clipping`).toBeLessThanOrEqual(0);
  }
});
