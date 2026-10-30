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
