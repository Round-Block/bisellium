process.env["NODE_ENV"] = "test";

import { expect, test } from "@playwright/test";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-503-b1 Home is the default route and first shared navigation entry at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w503-b1");
  await seedToken(page, served);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w503=b1-${width}`);
    await expect(page.getByRole("heading", { name: "Home", exact: true }), `${width}: bare entry opens Home`).toBeVisible();
    await expect(page.locator(".sidebar__link").first(), `${width}: Home is first in shared navigation`).toHaveAttribute("href", "#/home");
    await expect(page.locator('.sidebar__link[href="#/home"]'), `${width}: Home is the current page`).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: Home does not overflow horizontally`).toBeLessThanOrEqual(0);
  }
  await page.goto(`${served.baseURL}/?w503=b1-unknown#/not-a-screen`);
  await expect(page.getByRole("heading", { name: "Home", exact: true }), "an unknown hash falls back to Home").toBeVisible();
});

test("W-503-b2 Needs you groups the D-151 collection once at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w503-b2");
  await seedToken(page, served);
  const officina = {
    studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
    lifecycle: { id: "opus", states: [
      { id: "backlog", name: "Backlog", phase: "backlog" },
      { id: "building", name: "Building", phase: "in_progress" },
    ] },
  };
  const make = (id: string, state: string, human = false) => ({ id, title: `${id} title`, body: "", kind: "ui", collegium: "design", sella: "builder", state, tokens: 0, probationes: human ? { patron: { status: "pending" } } : {}, traditio: undefined });
  let opera = [make("W-1", "backlog", true), make("W-2", "building", true), make("W-3", "building")];
  let inbox = { opera: [], petitiones: [
    { id: "P-1", opus: "W-1", from: "producer", subject: "Combined ask", body: "" },
    { id: "P-2", opus: "W-3", from: "producer", subject: "Inbox decision", body: "" },
    { id: "P-3", opus: "W-404", from: "producer", subject: "Missing work question", body: "" },
    { id: "P-4", from: "producer", subject: "Standalone question", body: "" },
  ] };
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: inbox }));
  const needBoxes = () => page.locator(".home-needs__group").evaluateAll((groups) => groups.map((group) => {
    const box = group.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  const expectFourGroupGrid = async (width: number, state: string) => {
    await expect(page.locator(".home-needs__group"), `${state}: all four populated groups render`).toHaveCount(4);
    const boxes = await needBoxes();
    if (width === 1280) {
      expect(boxes[1]!.y, `${state}: the first three signed groups share the first row`).toBeCloseTo(boxes[0]!.y, 0);
      expect(boxes[2]!.y, `${state}: the third signed group stays on the first row`).toBeCloseTo(boxes[0]!.y, 0);
      expect(boxes[3]!.y, `${state}: the fourth group wraps after the signed three columns`).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height - 1);
    } else {
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index]!.y, `${state}: group ${index + 1} follows the previous group`).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height - 1);
      }
    }
  };
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w503=b2-${width}#/home`);
    await expect(page.locator(".home-needs__group h3"), `${width}: the four D-151 groups are named`).toHaveText(["Greenlights", "Human gates", "Inbox decisions", "Questions"]);
    await expect(page.locator(".home-needs__item"), `${width}: five attention identities render once`).toHaveCount(5);
    await expect(page.locator(".home-needs__open"), `${width}: every signed attention row names its existing destination`).toHaveText(["Open", "Open", "Open", "Open", "Open"]);
    await expect(page.locator(".home-needs__group h3").first(), `${width}: signed group labels are capital mono`).toHaveCSS("text-transform", "uppercase");
    expect(await page.locator(".home-needs__item").evaluateAll((rows) => new Set(rows.map((row) => row.getAttribute("data-attention-key"))).size), `${width}: no attention key is duplicated`).toBe(5);
    await expect(page.locator('[data-attention-key="opus:W-1"]'), `${width}: combined asks stay one row`).toContainText("Greenlight, Inbox decision, Human gate");
    await expect(page.locator('[data-attention-key="opus:W-2"]'), `${width}: Board-owned work opens its drawer`).toHaveAttribute("href", "#/board/W-2");
    await expect(page.locator('[data-attention-key="opus:W-3"]'), `${width}: replyable work opens Inbox`).toHaveAttribute("href", "#/inbox");
    await expectFourGroupGrid(width, `${width} expanded`);
    if (width === 1280) {
      await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "collapsed"));
      await page.reload();
      await expectFourGroupGrid(width, "1280 collapsed");
      opera = [make("W-2", "building", true)];
      inbox = { opera: [], petitiones: [{ id: "P-4", from: "producer", subject: "Standalone question", body: "" }] };
      for (const sidebar of ["expanded", "collapsed"] as const) {
        await page.evaluate((value) => localStorage.setItem("bisellium.sidebar", value), sidebar);
        await page.reload();
        await expect(page.locator(".home-needs__group h3"), `1280 ${sidebar}: two populated groups remain named`).toHaveText(["Human gates", "Questions"]);
        const grid = await page.locator(".home-needs").boundingBox();
        const boxes = await needBoxes();
        expect(boxes[1]!.y, `1280 ${sidebar}: two groups share the signed three-column row`).toBeCloseTo(boxes[0]!.y, 0);
        expect(boxes[1]!.x + boxes[1]!.width, `1280 ${sidebar}: the unused signed third column remains available`).toBeLessThan(grid!.x + grid!.width - 1);
        expect(await page.locator(".home-needs").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), `1280 ${sidebar}: Needs you keeps three signed columns`).toBe(3);
      }
      opera = [make("W-2", "building", true)];
      inbox = { opera: [], petitiones: [] };
      for (const sidebar of ["expanded", "collapsed"] as const) {
        await page.evaluate((value) => localStorage.setItem("bisellium.sidebar", value), sidebar);
        await page.reload();
        await expect(page.locator(".home-needs__group h3"), `1280 ${sidebar}: the one populated group keeps its name`).toHaveText(["Human gates"]);
        const grid = await page.locator(".home-needs").boundingBox();
        const group = await page.locator(".home-needs__group").boundingBox();
        expect(group!.x, `1280 ${sidebar}: one group starts at the card edge`).toBeCloseTo(grid!.x, 0);
        expect(group!.width, `1280 ${sidebar}: one group spans the available card width`).toBeCloseTo(grid!.width, 0);
      }
      opera = [make("W-1", "backlog", true), make("W-2", "building", true), make("W-3", "building")];
      inbox = { opera: [], petitiones: [
        { id: "P-1", opus: "W-1", from: "producer", subject: "Combined ask", body: "" },
        { id: "P-2", opus: "W-3", from: "producer", subject: "Inbox decision", body: "" },
        { id: "P-3", opus: "W-404", from: "producer", subject: "Missing work question", body: "" },
        { id: "P-4", from: "producer", subject: "Standalone question", body: "" },
      ] };
      await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "expanded"));
      await page.reload();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: attention rows stay contained`).toBeLessThanOrEqual(0);
    opera = [];
    inbox = { opera: [], petitiones: [] };
    await page.reload();
    await expect(page.locator(".home-card--needs"), `${width}: zero has one honest resting state`).toContainText("Nothing waiting on you");
    await expect(page.locator(".home-needs__group"), `${width}: zero renders no empty group shell`).toHaveCount(0);
    opera = [make("W-1", "backlog", true), make("W-2", "building", true), make("W-3", "building")];
    inbox = { opera: [], petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "Combined ask", body: "" },
      { id: "P-2", opus: "W-3", from: "producer", subject: "Inbox decision", body: "" },
      { id: "P-3", opus: "W-404", from: "producer", subject: "Missing work question", body: "" },
      { id: "P-4", from: "producer", subject: "Standalone question", body: "" },
    ] };
  }
});

test("W-503-b3 Stuck precedes Health and one signed work summary reflows at 1280, 640 and 390", async ({ page }) => {
  served = await startServed("w503-b3");
  await seedToken(page, served);
  const officina = {
    studio: "Sample Studio", patron: "patron", collegia: [], sellae: [], probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
    lifecycle: { id: "opus", states: [
      { id: "backlog", name: "Backlog", phase: "backlog" }, { id: "greenlit", name: "Greenlit", phase: "planned" },
      { id: "building", name: "Building", phase: "in_progress" }, { id: "checking", name: "Checking", phase: "verifying" },
      { id: "review", name: "Review", phase: "awaiting_review" }, { id: "halted", name: "Halted", phase: "halted" }, { id: "done", name: "Done", phase: "done" },
    ] },
  };
  const make = (id: string, state: string, failed = false) => ({ id, title: `${id} title`, body: "", kind: "ui", collegium: "design", sella: "builder", state, tokens: 0, probationes: failed ? { tests: { status: "failed" } } : {}, traditio: undefined });
  const stuck = make("W-2", "checking", true);
  stuck.probationes = { tests: { status: "failed" }, lint: { status: "failed" } };
  let opera = [make("W-1", "building"), make("W-6", "building"), stuck, make("W-3", "review"), make("W-4", "done", true), make("W-5", "halted", true)];
  let health = { at: "", ok: false, blocks: 0, advisories: 2, findingsByRule: {}, autonomy: { paused: false }, lastTick: "", due: [] };
  let healthMode: "ok" | "fail" | "hold" = "ok";
  let heldHealth: import("@playwright/test").Route | undefined;
  await page.route("**/api/officina", (route) => route.fulfill({ json: officina }));
  await page.route("**/api/opera", (route) => route.fulfill({ json: opera }));
  await page.route("**/api/inbox", (route) => route.fulfill({ json: { opera: [], petitiones: [] } }));
  await page.route("**/api/health", (route) => {
    if (healthMode === "hold") { heldHealth = route; return; }
    if (healthMode === "fail") return route.fulfill({ status: 503, body: "unavailable" });
    return route.fulfill({ json: health });
  });
  const resolvedColour = (name: "--ink" | "--bad" | "--amber") => page.evaluate((token) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${served.baseURL}/?w503=b3-${width}#/home`);
    await expect(page.locator(".home-tile").first(), `${width}: Stuck is above Health`).toHaveAttribute("data-tile", "stuck");
    await expect(page.locator(".home-tile").nth(1), `${width}: Health follows Stuck`).toHaveAttribute("data-tile", "health");
    await expect(page.locator('[data-tile="stuck"] .home-tile__value'), `${width}: one active work item with several failed gates counts once`).toHaveText("1");
    await expect(page.locator('[data-tile="stuck"] .home-tile__foot span'), `${width}: the Stuck caption names the counted unit`).toHaveText("Work items with failed gates");
    await expect(page.locator('[data-tile="health"]'), `${width}: served advisories are the Health fact`).toContainText("2 high findings");
    await expect(page.locator('[data-tile="health"] .severity-cue--high'), `${width}: high advisories use the shared diamond cue`).toHaveCount(1);
    await expect(page.locator(".home-cue"), `${width}: Home defines no competing severity cue`).toHaveCount(0);
    const [ink, bad, amber] = await Promise.all([resolvedColour("--ink"), resolvedColour("--bad"), resolvedColour("--amber")]);
    await expect(page.locator(".home__title"), `${width}: the signed Home heading is white`).toHaveCSS("color", ink);
    await expect(page.getByRole("heading", { name: "Needs you", exact: true }), `${width}: signed card headings are white`).toHaveCSS("color", ink);
    await expect(page.getByRole("heading", { name: "Stuck", exact: true }), `${width}: signed status headings are white`).toHaveCSS("color", ink);
    await expect(page.locator('[data-tile="stuck"] .home-tile__value'), `${width}: a blocking Stuck number is red`).toHaveCSS("color", bad);
    await expect(page.locator('[data-tile="health"] .home-tile__value'), `${width}: a high Health number is amber`).toHaveCSS("color", amber);
    await expect(page.locator(".home-card--wip"), `${width}: active work appears in one card`).toHaveCount(1);
    await expect(page.locator(".home-wip__row"), `${width}: the 2/1/1 active fixture appears in phase order`).toHaveText(["In progress2", "Verifying1", "Awaiting review1"]);
    await expect(page.locator(".home-wip__bar"), `${width}: each recorded active phase has its signed proportional bar`).toHaveCount(3);
    const bars = await page.locator(".home-wip__bar").evaluateAll((tracks) => tracks.map((track) => ({
      track: track.getBoundingClientRect().width,
      fill: track.firstElementChild!.getBoundingClientRect().width,
    })));
    for (const [index, ratio] of [0.5, 0.25, 0.25].entries()) {
      expect(Math.abs(bars[index]!.fill - bars[index]!.track * ratio), `${width}: bar ${index + 1} fills ${ratio * 100}% of its own track within 1px`).toBeLessThanOrEqual(1);
    }
    await expect(page.getByRole("heading", { name: /Queue|Time|Completion|Spend/ }), `${width}: later-piece empty cards are absent`).toHaveCount(0);
    const needs = await page.locator(".home-card--needs").boundingBox();
    const status = await page.locator(".home__tiles").boundingBox();
    if (width === 1280) {
      expect(status!.y, "1280: the status column starts beside Needs you").toBeCloseTo(needs!.y, 0);
      await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "collapsed"));
      await page.reload();
      await expect(page.locator(".shell"), "1280: the collapsed sidebar keeps Home mounted").toHaveClass(/shell--sidebar-collapsed/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "1280 collapsed: no horizontal overflow").toBeLessThanOrEqual(0);
      await page.evaluate(() => localStorage.setItem("bisellium.sidebar", "expanded"));
    } else {
      expect(status!.y, `${width}: the status column follows Needs you`).toBeGreaterThanOrEqual(needs!.y + needs!.height - 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: the composition stays in the viewport`).toBeLessThanOrEqual(0);

    health = { ...health, blocks: 1 };
    await page.reload();
    await expect(page.locator('[data-tile="health"] .home-tile__value'), `${width}: blocking Health shows its served count`).toHaveText("1");
    await expect(page.locator('[data-tile="health"] .home-tile__value'), `${width}: blocking Health uses the signed red number`).toHaveCSS("color", bad);
    const blockingCue = page.locator('[data-tile="health"] .severity-cue--blocking');
    await expect(blockingCue, `${width}: blocking Health uses the shared square cue`).toHaveCount(1);
    await expect(blockingCue, `${width}: the blocking cue is not rounded`).toHaveCSS("border-radius", "0px");
    expect(await blockingCue.evaluate((cue) => Math.abs(cue.getBoundingClientRect().width - cue.getBoundingClientRect().height)), `${width}: the blocking cue is square`).toBeLessThanOrEqual(0.01);
    health = { ...health, blocks: 0 };
  }

  opera = [];
  health = { ...health, ok: true, advisories: 0 };
  await page.reload();
  await expect(page.locator(".home-card--wip"), "zero in-flight work leaves no empty lower card").toHaveCount(0);
  await expect(page.locator('[data-tile="health"] .severity-cue--normal'), "healthy uses the shared hollow-circle cue").toHaveCount(1);

  healthMode = "hold";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Home", exact: true }), "a slow read keeps the page identity visible").toBeVisible();
  await expect(page.locator(".home-card"), "a slow read does not fabricate summary cards").toHaveCount(0);
  await expect(page.locator(".shell__status"), "a slow read is named").toHaveText("Loading home…");
  await heldHealth!.fulfill({ json: health });
  await expect(page.locator(".home-card--needs"), "the held read settling reveals the factual composition").toBeVisible();

  healthMode = "fail";
  await page.reload();
  await expect(page.getByText("Could not load home.", { exact: true }).first(), "a failed read is explicit").toBeVisible();
  await expect(page.locator(".home-card"), "a failed joined read leaves no stale or invented card").toHaveCount(0);
});
