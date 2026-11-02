import { expect, test, type Page } from "@playwright/test";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

const longGateName = `A deliberately long next gate name ${"that must remain contained ".repeat(8)}`;
const officina = {
  studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], wip_limit: 4,
  probationes: [
    { id: "spec", name: "Spec", kind: "agent" },
    { id: "tests", name: "Tests", kind: "automated" },
    { id: "review", name: "Lead review", kind: "agent" },
    { id: "qa", name: "QA verdict", kind: "agent" },
    { id: "served", name: longGateName, kind: "automated" },
    { id: "patron", name: "Patron call", kind: "human" },
  ],
  lifecycle: { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Awaiting review", phase: "awaiting_review" },
    { id: "done", name: "Done", phase: "done" },
    { id: "halted", name: "Halted", phase: "halted" },
  ] },
};
const passedThree = { spec: { status: "passed" }, tests: { status: "waived" }, review: { status: "passed" } };
const passedFour = { ...passedThree, qa: { status: "passed" } };
const passedAll = Object.fromEntries(officina.probationes.map(({ id }) => [id, { status: "passed" }]));
const makeOpus = (id: string, state: string, probationes: Record<string, { status: string }>, body: string, title = `${id} title`) => ({
  id, title, body, kind: "ui", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined,
});
const opera = [
  makeOpus("W-0", "backlog", passedThree, "Backlog description"),
  makeOpus("W-1", "greenlit", passedThree, "Planned description"),
  makeOpus("W-2", "building", passedThree, "The record description comes first.", `A deliberately long card title ${"that stays bounded ".repeat(20)}`),
  makeOpus("W-3", "verifying", passedFour, ""),
  makeOpus("W-4", "done", passedAll, "Complete description"),
  makeOpus("W-5", "review", passedThree, "Review description"),
  makeOpus("W-6", "halted", {}, "Zero-passed description"),
];

async function install(page: Page): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: { opera: [], petitiones: [] } }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: [{ at: "2026-11-02T00:00:00Z", type: "event", summary: "Newest event" }] }));
}

async function openBoard(page: Page, width: number, row: string): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served!.baseURL}/?w493=${row}-${width}#/board`);
  await expect(page.locator(".board__column")).toHaveCount(6);
}

test("W-493-b1 gate progress replaces card squares at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w493-b1");
  await seedToken(page, served);
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b1");
    await expect(page.locator(".board__card .gate-ladder"), `${width}: lifecycle cards contain no unlabelled gate squares`).toHaveCount(0);
    await expect(page.locator('[data-column-id="planned"] [data-card-id="W-1"] .board__card-gates'), `${width}: Planned omits gate progress`).toHaveCount(0);
    await expect(page.locator('[data-card-id="W-2"] .board__card-gates'), `${width}: some cleared gates name the next gate`).toHaveText("3/6 · next: QA verdict");
    await expect(page.locator('[data-card-id="W-3"] .board__card-gates'), `${width}: long next-gate copy stays available`).toHaveAttribute("title", `4/6 · next: ${longGateName}`);
    await expect(page.locator('[data-card-id="W-4"] .board__card-gates'), `${width}: all cleared gates state completion`).toHaveText("6/6 · complete");
    await expect(page.locator('[data-card-id="W-6"] .board__card-gates'), `${width}: zero cleared gates name the first gate`).toHaveText("0/6 · next: Spec");
    await expect(page.locator('[data-card-id="W-2"] .board__card-title'), `${width}: the long title remains available after clamping`).toHaveAttribute("title", /^A deliberately long card title/);
    const geometry = await page.locator('[data-card-id="W-3"]').evaluate((node) => {
      const card = node.getBoundingClientRect();
      const line = node.querySelector<HTMLElement>(".board__card-gates")!;
      const box = line.getBoundingClientRect();
      const style = getComputedStyle(line);
      return {
        lineInside: box.left >= card.left - 0.5 && box.right <= card.right + 0.5 && box.top >= card.top && box.bottom <= card.bottom,
        oneLine: box.height === Number.parseFloat(style.lineHeight),
        ellipsized: line.scrollWidth > line.clientWidth && style.textOverflow === "ellipsis" && style.whiteSpace === "nowrap",
        cardHeight: card.height,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.lineInside, `${width}: progress remains inside its card`).toBe(true);
    expect(geometry.oneLine, `${width}: progress keeps one complete line box`).toBe(true);
    expect(geometry.ellipsized, `${width}: the long next-gate name truncates visibly`).toBe(true);
    expect(geometry.cardHeight, `${width}: ordinary cards retain the 108px bound`).toBeLessThanOrEqual(108);
    expect(geometry.pageOverflow, `${width}: gate copy adds no page overflow`).toBeLessThanOrEqual(0);
  }
});

test("W-493-b2 drawer puts the record description first at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w493-b2");
  await seedToken(page, served);
  await install(page);
  for (const width of WIDTHS) {
    await openBoard(page, width, "b2");
    await page.locator('[data-card-id="W-2"]').click();
    const drawer = page.locator(".board-drawer");
    const directOrder = await drawer.locator(":scope > *").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).className));
    expect(directOrder.slice(0, 2), `${width}: record follows the header`).toEqual(["board-drawer__header", "board-drawer__record"]);
    await expect(drawer.locator(".board-drawer__record-body"), `${width}: authored description is first detail`).toHaveText("The record description comes first.");
    await expect(drawer.getByRole("heading", { name: "Gate ladder" }), `${width}: named gate list stays`).toBeAttached();
    await expect(drawer.locator(".board-drawer__gate-name"), `${width}: all six gate names stay`).toHaveCount(6);
    await drawer.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(drawer.locator(".board-drawer__events"), `${width}: events remain reachable after the named gate list`).toBeVisible();
    await drawer.locator(".board-drawer__close").click();

    await page.locator('[data-card-id="W-3"]').click();
    await expect(page.locator(".board-drawer__record-body"), `${width}: an absent description has an honest first-section placeholder`).toHaveText("No record body.");
    await page.locator(".board-drawer__close").click();
  }
});
