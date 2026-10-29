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
