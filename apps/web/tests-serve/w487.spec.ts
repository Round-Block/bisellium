import { expect, test, type Page } from "@playwright/test";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

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
    { id: "done", name: "Done", phase: "done" },
  ] },
};

const makeOpus = (id: string, state: string, probationes: Record<string, { status: string; at?: string }> = {}, title = `${id} title`) => ({
  id, title, body: "", kind: "ui", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined,
});

type Fixture = {
  opera: ReturnType<typeof makeOpus>[];
  inbox: {
    opera: { id: string; title: string; collegium: string; sella: string; traditio?: unknown }[];
    petitiones: { id: string; opus?: string; from: string; opened?: number; subject: string; body: string }[];
  };
};

function fixture(): Fixture {
  return {
    opera: [
      makeOpus("W-1", "backlog", { patron: { status: "pending" } }),
      makeOpus("W-2", "building", { patron: { status: "pending", at: "2026-10-27T00:00:00Z" } }),
      makeOpus("W-3", "done"),
    ],
    inbox: {
      opera: [{ id: "W-2", title: "W-2 title", collegium: "design", sella: "builder" }],
      petitiones: [
        { id: "P-1", opus: "W-1", from: "producer", opened: Date.UTC(2026, 9, 27), subject: "First decision", body: "First question" },
        { id: "P-2", opus: "W-1", from: "architect", opened: Date.UTC(2026, 9, 28), subject: "Second decision", body: "Second question" },
        { id: "P-orphan", opus: "W-404", from: "reviewer", opened: Date.UTC(2026, 9, 29), subject: "Orphan decision", body: "Orphan question" },
        { id: "P-solo", from: "qa-lead", opened: Date.UTC(2026, 9, 30), subject: "Standalone decision", body: "Standalone question" },
      ],
    },
  };
}

async function install(page: Page, data: Fixture): Promise<void> {
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: data.opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: data.inbox }));
  await page.route("**/api/events?item=*", (route) => route.fulfill({ json: [] }));
}

async function installLiveDouble(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let source: EventTarget | undefined;
    class LiveDouble extends EventTarget {
      constructor(_url: string) {
        super();
        source = this;
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }

      close(): void {}
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: LiveDouble });
    (window as typeof window & { __w487EmitLive: (type: "error" | "open" | "message") => void }).__w487EmitLive = (type) => {
      source?.dispatchEvent(type === "message"
        ? new MessageEvent("message", { data: JSON.stringify({ name: "workflow.state_changed", attrs: {} }) })
        : new Event(type));
    };
  });
}

async function expectGeometry(page: Page, width: number, selector: string): Promise<void> {
  const geometry = await page.locator(selector).evaluate((node) => {
    const box = node.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      width: box.width,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(geometry.width, `${width}: ${selector} has useful width`).toBeGreaterThan(120);
  expect(geometry.left, `${width}: ${selector} begins inside the viewport`).toBeGreaterThanOrEqual(-0.5);
  expect(geometry.right, `${width}: ${selector} ends inside the viewport`).toBeLessThanOrEqual(width + 0.5);
  expect(geometry.pageOverflow, `${width}: page has no horizontal overflow`).toBeLessThanOrEqual(0);
}

async function expectBoardRowLabels(page: Page, width: number): Promise<void> {
  const boardOnly = page.locator(".inbox__item", { hasText: "W-2 title" });
  await expect(boardOnly.locator(".inbox__ask-kind"), `${width}: Board-owned row names its ask kind`).toHaveText("Human gate");
  await expect(boardOnly.locator(".inbox__route"), `${width}: Board-owned row states the full route`).toHaveText("Opens Board drawer");
  const labels = await boardOnly.evaluate((node) => {
    const ask = node.querySelector<HTMLElement>(".inbox__ask-kind")!;
    const route = node.querySelector<HTMLElement>(".inbox__route")!;
    return {
      askFull: ask.scrollWidth <= ask.clientWidth,
      routeFull: route.scrollWidth <= route.clientWidth,
    };
  });
  expect(labels.askFull, `${width}: Board-owned ask kinds show in full`).toBe(true);
  expect(labels.routeFull, `${width}: Opens Board drawer shows in full when both labels fit`).toBe(true);
}

test("W-487-b1 one attention collection combines asks at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w487-b1");
  await seedToken(page, served);
  const data = fixture();
  await install(page, data);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w487=b1-${width}#/board`);
    await expect(page.locator(".board__waiting-item"), `${width}: four unique attention items`).toHaveCount(4);
    await expect(page.locator('[data-waiting-id="W-1"]'), `${width}: two questions combine with greenlight under W-1`).toHaveCount(1);
    await expect(page.locator('[data-waiting-id="W-1"] .board__waiting-ask-value')).toHaveText("Greenlight, 2 Inbox decisions, Human gate");
    await expect(page.locator('[data-waiting-id="W-2"] .board__waiting-ask-value')).toHaveText("Human gate");
    await expect(page.locator('[data-waiting-id="W-404"] .board__waiting-ask-value')).toHaveText("Inbox decision");
    await expect(page.locator('[data-waiting-id="P-solo"] .board__waiting-ask-value')).toHaveText("Inbox decision");
    await expect(page.locator('[data-card-id="W-404"], [data-card-id="P-solo"]'), `${width}: questions without Board records invent no lifecycle cards`).toHaveCount(0);
    await expectGeometry(page, width, ".board__waiting");
  }
});

test("W-487-b2 Inbox labels Board routes without reply controls at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w487-b2");
  await seedToken(page, served);
  const data = fixture();
  await install(page, data);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w487=b2-${width}#/inbox`);
    const rows = page.locator(".inbox__item");
    await expect(rows, `${width}: Inbox renders the same four attention items`).toHaveCount(4);
    const mixed = rows.filter({ hasText: "First decision" });
    const askKinds = mixed.locator(".inbox__ask-kind");
    await expect(askKinds, `${width}: combined row names every ask in full`).toHaveText("Greenlight, 2 Inbox decisions, Human gate");
    await expect(mixed.locator(".inbox__route"), `${width}: question rows omit the redundant Inbox route`).toHaveCount(0);
    const askGeometry = await askKinds.evaluate((node) => {
      const ask = node.getBoundingClientRect();
      const row = node.closest(".inbox__item")!.getBoundingClientRect();
      return {
        full: node.scrollWidth <= node.clientWidth + 0.5,
        vertical: ask.top >= row.top && ask.bottom <= row.bottom,
      };
    });
    expect(askGeometry.full, `${width}: all ask-kind text is visible`).toBe(true);
    expect(askGeometry.vertical, `${width}: ask-kind metadata does not clip vertically`).toBe(true);
    await expectBoardRowLabels(page, width);
    await mixed.click();
    await expect(page.locator(".inbox__action-bar"), `${width}: questions retain the Inbox reply controls`).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Board actions" }), `${width}: combined row exposes its Board-owned action`).toBeVisible();
    await expectGeometry(page, width, ".inbox__workspace");
  }

  for (const width of [840, 1280] as const) {
    data.opera = [makeOpus("W-2", "building", { patron: { status: "pending", at: "2026-10-27T00:00:00Z" } })];
    data.inbox = { opera: [{ id: "W-2", title: "W-2 title", collegium: "design", sella: "builder" }], petitiones: [] };
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w487=b2-board-initial-${width}#/inbox`);
    await expectBoardRowLabels(page, width);
    const reading = page.locator(".inbox__reading-pane");
    await expect(reading.locator(".inbox__meta").getByText("W-2", { exact: true }), `${width}: Board-only initial selection shows the opus id`).toBeVisible();
    await expect(reading.locator(".inbox__expanded-subject"), `${width}: Board-only initial selection shows the title`).toHaveText("W-2 title");
    await expect(reading.locator(".inbox__board-asks"), `${width}: Board-only initial selection shows its ask kinds`).toHaveText("Human gate");
    await expect(reading.getByRole("button", { name: "Open Board drawer" }), `${width}: Board-only initial selection offers one drawer action`).toBeVisible();
    await expect(reading.locator(".inbox__action-bar"), `${width}: Board-only initial selection has no reply controls`).toHaveCount(0);
    await page.locator(".inbox__item").click();
    await expect(page.getByRole("dialog", { name: "W-2 title" }), `${width}: clicking the Board-only row opens the existing drawer`).toBeVisible();

    const restored = fixture();
    data.opera = restored.opera;
    data.inbox = restored.inbox;
    await page.goto(`${served.baseURL}/?w487=b2-board-keyboard-${width}#/inbox`);
    await page.locator(".inbox__item").first().focus();
    await page.keyboard.press("j");
    await expect(page.locator(".inbox__reading-pane .inbox__expanded-subject"), `${width}: keyboard selection fills the reading pane`).toHaveText("W-2 title");
    await expect(page.locator(".inbox__reading-pane .inbox__action-bar"), `${width}: keyboard-selected Board item has no reply controls`).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "W-2 title" }), `${width}: Enter opens the existing Board drawer`).toBeVisible();
  }
});

test("W-487-b2 keeps a withdrawn mixed-row draft when its petition alone disappears", async ({ page }) => {
  served = await startServed("w487-b2-withdrawn-mixed");
  await seedToken(page, served);
  const data = fixture();
  await install(page, data);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w487=b2-withdrawn-mixed#/inbox`);
  await page.locator(".inbox__item", { hasText: "First decision" }).click();
  await page.locator(".inbox__input-ratio").fill("mixed-row draft");
  data.inbox.petitiones = data.inbox.petitiones.filter((petitio) => petitio.id !== "P-1");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".inbox__expanded-subject")).toHaveText("First decision");
  await expect(page.locator(".inbox__input-ratio")).toHaveValue("mixed-row draft");
  await expect(page.getByText("This petitio no longer needs a decision.")).toBeVisible();
  await expect(page.locator(".inbox__btn-action:disabled")).toHaveCount(4);
});

test("W-487-b3 Inbox and Board items route to their owning action at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w487-b3");
  await seedToken(page, served);
  const data = fixture();
  await install(page, data);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w487=b3-board-${width}#/board`);
    await page.locator('[data-waiting-id="P-solo"]').click();
    await expect(page, `${width}: standalone Board-strip question routes to Inbox`).toHaveURL(/#\/inbox$/);
    await expect(page.locator(".inbox__expanded-subject"), `${width}: the requested question opens`).toHaveText("Standalone decision");
    await expectGeometry(page, width, ".inbox__workspace");

    await page.goto(`${served.baseURL}/?w487=b3-inbox-${width}#/inbox`);
    await page.locator(".inbox__item", { hasText: "W-2 title" }).click();
    await expect(page, `${width}: Board-owned Inbox item routes to Board`).toHaveURL(/#\/board$/);
    await expect(page.getByRole("dialog", { name: "W-2 title" }), `${width}: existing Board drawer opens`).toBeVisible();
    await expectGeometry(page, width, ".board-workspace");
  }
});

test("W-487-b4 Inbox and Board badges share zero and many totals at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w487-b4");
  await seedToken(page, served);
  const data: Fixture = {
    opera: [],
    inbox: { opera: [], petitiones: Array.from({ length: 12 }, (_, index) => ({ id: `P-${index + 1}`, from: "producer", subject: `Standalone ${index + 1}`, body: "Choose" })) },
  };
  await install(page, data);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w487=b4-many-${width}#/board`);
    await expect(page.locator(".board__waiting-label strong"), `${width}: strip count is the collection total`).toHaveText("12");
    if (width === 1280) {
      await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("12");
      await expect(page.locator('a[href="#/board"] .sidebar__badge')).toHaveText("12");
      await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("9+");
      await expect(page.locator('a[href="#/board"] .sidebar__badge')).toHaveText("9+");
    } else {
      await expect(page.locator(".sidebar__toggle .sidebar__badge--toggle"), `${width}: closed shell caps the shared total`).toHaveText("9+");
      await page.getByRole("button", { name: "Expand sidebar" }).click();
      await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("12");
      await expect(page.locator('a[href="#/board"] .sidebar__badge')).toHaveText("12");
    }
    await expectGeometry(page, width, ".board__waiting");

    data.inbox.petitiones = [];
    await page.reload();
    await expect(page.locator(".board__waiting-label strong"), `${width}: zero collection collapses the strip`).toHaveText("0");
    await expect(page.locator('a[href="#/inbox"] .sidebar__badge, a[href="#/board"] .sidebar__badge'), `${width}: zero hides both badges`).toHaveCount(0);
    data.inbox.petitiones = Array.from({ length: 12 }, (_, index) => ({ id: `P-${index + 1}`, from: "producer", subject: `Standalone ${index + 1}`, body: "Choose" }));
  }
});

test("W-487-b4 hides both badges when the mounted Inbox first load fails", async ({ page }) => {
  served = await startServed("w487-b4-mounted-failure");
  await seedToken(page, served);
  const data = fixture();
  let failMountedLoad = false;
  await page.route("**/api/officina", (route) => failMountedLoad ? route.fulfill({ status: 500 }) : route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => failMountedLoad ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.opera }));
  await page.route("**/api/inbox", (route) => failMountedLoad ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.inbox }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${served.baseURL}/?w487=b4-mounted-failure#/officina`);
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("4");
  await expect(page.locator('a[href="#/board"] .sidebar__badge')).toHaveText("4");
  failMountedLoad = true;
  await page.evaluate(() => { window.location.hash = "#/inbox"; });
  await expect(page.locator(".inbox__empty")).toBeVisible();
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge, a[href="#/board"] .sidebar__badge')).toHaveCount(0);
});

test("W-487-b4 retains both badges after an Inbox background read failure", async ({ page }) => {
  served = await startServed("w487-b4-inbox-retained-failure");
  await seedToken(page, served);
  const data = fixture();
  let failRead = false;
  await page.route("**/api/officina", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.opera }));
  await page.route("**/api/inbox", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.inbox }));
  await page.goto(`${served.baseURL}/?w487=b4-inbox-retained-failure#/inbox`);
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("4");
  failRead = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".screen-notice").first()).toContainText("Could not load the inbox.");
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("4");
  await expect(page.locator('a[href="#/board"] .sidebar__badge')).toHaveText("4");
});

test("W-487-b4 retains both badges after a relevant Board event read failure", async ({ page }) => {
  served = await startServed("w487-b4-board-event-retained-failure");
  await seedToken(page, served);
  const data = fixture();
  let failRead = false;
  await installLiveDouble(page);
  await page.route("**/api/officina", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.opera }));
  await page.route("**/api/inbox", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.inbox }));
  await page.goto(`${served.baseURL}/?w487=b4-board-event-retained-failure#/board`);
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("4");
  failRead = true;
  await page.evaluate(() => (window as typeof window & { __w487EmitLive: (type: "message") => void }).__w487EmitLive("message"));
  await expect(page.locator(".shell__status")).toHaveAttribute("data-state", "error");
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("4");
  await expect(page.locator('a[href="#/board"] .sidebar__badge')).toHaveText("4");
});

test("W-487-b4 retains both badges after an unselected Board reconnect read failure", async ({ page }) => {
  served = await startServed("w487-b4-board-reconnect-retained-failure");
  await seedToken(page, served);
  const data = fixture();
  let failRead = false;
  await installLiveDouble(page);
  await page.route("**/api/officina", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.opera }));
  await page.route("**/api/inbox", (route) => failRead ? route.fulfill({ status: 500 }) : route.fulfill({ json: data.inbox }));
  await page.goto(`${served.baseURL}/?w487=b4-board-reconnect-retained-failure#/board`);
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("4");
  failRead = true;
  await page.evaluate(() => {
    const live = window as typeof window & { __w487EmitLive: (type: "error" | "open") => void };
    live.__w487EmitLive("error");
    live.__w487EmitLive("open");
  });
  await expect(page.locator(".shell__status")).toHaveAttribute("data-state", "error");
  await expect(page.locator('a[href="#/inbox"] .sidebar__badge')).toHaveText("4");
  await expect(page.locator('a[href="#/board"] .sidebar__badge')).toHaveText("4");
});
