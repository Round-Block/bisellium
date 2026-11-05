/**
 * apps/web/tests-serve/w300.spec.ts — W-300: the Board drawer's one line, at 1280, 640 and 390, over a real `bisellium
 * serve` whose officina is a git repository, so the read is the real child. Rows whose rung no fixture opus reaches (a
 * round, a PR, a long why) take their answer from `page.route`. W300_CAPTURE_DIR, when set, keeps a picture per width.
 */
process.env["NODE_ENV"] = "test";

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
const AMBER = "rgb(255, 184, 108)";
let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

/** The repository around the officina, as `next` wants it: `<root>/studio`. */
function gitRepository(studioDir: string): void {
  execFileSync("git", ["init", "-q", "-b", "master"], { cwd: dirname(studioDir), stdio: "ignore" });
  commitAll(studioDir);
}
function commitAll(studioDir: string): void {
  const git = (...args: string[]): void => void execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@bisellium.invalid", ...args], { cwd: dirname(studioDir), stdio: "ignore" });
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
}

async function openBoard(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served!.baseURL}/?w300=${width}#/board`);
  const prompt = page.locator("#token-prompt-input");
  if (await prompt.isVisible()) {
    await prompt.fill(served!.token);
    await page.locator(".token-prompt__submit").click();
  }
  await expect(page.locator('[data-card-id="W-007"]')).toBeAttached();
}

async function openDrawer(page: Page, id: string): Promise<void> {
  await page.locator(`[data-card-id="${id}"]`).evaluate((node) => (node as HTMLElement).click());
  await expect(page.locator(".board-drawer__id")).toHaveText(id);
}

const closeDrawer = (page: Page): Promise<void> => page.locator(".board-drawer__close").click();
const color = (page: Page): Promise<string> => page.locator(".board-drawer__ladder").evaluate((node) => getComputedStyle(node).color);

/** One line, directly under the title, inside the drawer, and the drawer does not scroll sideways for it. */
async function expectOneLine(page: Page, width: number, label: string): Promise<void> {
  const g = await page.evaluate(() => {
    const line = document.querySelector<HTMLElement>(".board-drawer__ladder")!.getBoundingClientRect();
    const title = document.querySelector<HTMLElement>(".board-drawer__title")!.getBoundingClientRect();
    const meta = document.querySelector<HTMLElement>(".board-drawer__meta")!.getBoundingClientRect();
    const drawer = document.querySelector<HTMLElement>(".board-drawer")!;
    return { top: line.top, bottom: line.bottom, right: line.right, height: line.height, titleBottom: title.bottom, metaTop: meta.top, drawerRight: drawer.getBoundingClientRect().right, scroll: drawer.scrollWidth, client: drawer.clientWidth };
  });
  expect(g.height, `one line of 18 px: ${width} ${label}`).toBeLessThanOrEqual(19);
  expect(g.top, `under the title: ${width} ${label}`).toBeGreaterThanOrEqual(g.titleBottom);
  expect(g.bottom, `above the meta line: ${width} ${label}`).toBeLessThanOrEqual(g.metaTop + 1);
  expect(g.right, `inside the drawer: ${width} ${label}`).toBeLessThanOrEqual(g.drawerRight);
  expect(g.scroll, `the drawer does not scroll sideways: ${width} ${label}`).toBeLessThanOrEqual(g.client);
}

const LONG = "the review gate cites an older round and every ruling and path it names is long enough to pass any drawer's width by a wide margin";
const answer = (id: string, over: Record<string, unknown>): string => JSON.stringify({ id, read: "ok", step: "merge", status: "named", actor: "producer", why: LONG, round: 2, health: "no step recorded", pr: { number: 901, url: "https://github.com/acme/widgets/pull/901" }, ...over });
const json = (body: string): { contentType: string; body: string } => ({ contentType: "application/json", body });

test("W-300-b3 behaviour 3: the drawer shows the step on one line under the title, amber only when the actor is the Patron", async ({ page }) => {
  test.setTimeout(300_000);
  served = await startServed("w300-b3", { subdir: "studio", prepareStudio: gitRepository });
  const capture = process.env["W300_CAPTURE_DIR"];
  const ladder = page.locator(".board-drawer__ladder");
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/ladder")) asked.push(new URL(r.url()).pathname);
  });

  for (const width of WIDTHS) {
    asked.length = 0;
    await openBoard(page, width);
    await page.waitForLoadState("networkidle");
    expect(asked, `a Board load reads no step: ${width}`).toEqual([]);

    // the real read: the Patron's rung, amber
    await openDrawer(page, "W-007");
    await expect(ladder, `the Patron's rung, from the real read: ${width}`).toContainText("Next: greenlight · patron · no step recorded · W-007 is in the backlog");
    expect(await color(page), `amber when the Patron acts: ${width}`).toBe(AMBER);
    await expectOneLine(page, width, "the Patron's rung");
    if (capture !== undefined) {
      mkdirSync(capture, { recursive: true });
      await page.screenshot({ path: join(capture, `drawer-patron-${width}.png`) });
    }
    await closeDrawer(page);

    // the real read: anyone else, never amber
    await openDrawer(page, "W-006");
    await expect(ladder, `another actor's rung, from the real read: ${width}`).toContainText("Next: spec · ");
    expect(await ladder.textContent(), `not the Patron: ${width}`).not.toContain("patron");
    expect(await color(page), `not amber when anyone else acts: ${width}`).not.toBe(AMBER);
    await expectOneLine(page, width, "another actor's rung");
    await closeDrawer(page);

    // a done opus: no line
    const doneRead = page.waitForResponse((r) => r.url().includes("/api/opus/W-001/ladder"));
    await openDrawer(page, "W-001");
    await doneRead;
    await expect(ladder, `a done opus shows no line: ${width}`).toHaveCount(0);
    await closeDrawer(page);

    // a long why, a round and a PR: still one line, and the link stays on it
    await page.route("**/api/opus/W-002/ladder", (route) => route.fulfill(json(answer("W-002", {}))));
    await openDrawer(page, "W-002");
    const pr = page.locator(".board-drawer__ladder-pr");
    await expect(pr, `the PR link: ${width}`).toHaveText("PR #901");
    await expect(pr).toHaveAttribute("href", "https://github.com/acme/widgets/pull/901");
    await expect(ladder).toContainText("Next: merge · producer · round 2 · no step recorded");
    expect(await ladder.getAttribute("title"), `the whole line in the title: ${width}`).toContain(LONG);
    const box = await pr.boundingBox();
    expect(box!.x + box!.width, `the PR link is in the viewport: ${width}`).toBeLessThanOrEqual(width);
    expect(box!.width, `the PR link is not cut: ${width}`).toBeGreaterThan(40);
    await expectOneLine(page, width, "a long why with a PR");
    if (capture !== undefined) await page.screenshot({ path: join(capture, `drawer-pr-${width}.png`) });
    await closeDrawer(page);

    // a hold names itself and is not amber by itself
    await page.route("**/api/opus/W-003/ladder", (route) => route.fulfill(json(answer("W-003", { status: "held", pr: null, round: null, why: "held" }))));
    await openDrawer(page, "W-003");
    await expect(ladder, `a hold names itself: ${width}`).toContainText("Next: merge (held) · producer · no step recorded · held");
    expect(await color(page), `a hold is not amber by itself: ${width}`).not.toBe(AMBER);
    await closeDrawer(page);

    // what cannot be read says so, plainly and quietly
    await page.route("**/api/opus/W-004/ladder", (route) => route.fulfill(json(JSON.stringify({ id: "W-004", read: "unavailable", why: "the step read took longer than 15 s" }))));
    await openDrawer(page, "W-004");
    await expect(ladder).toHaveText("Next step not read: the step read took longer than 15 s");
    expect(await color(page), `unavailable is not amber: ${width}`).not.toBe(AMBER);
    await closeDrawer(page);
    await page.route("**/api/opus/W-005/ladder", (route) => route.fulfill({ status: 500, body: "{}" }));
    await openDrawer(page, "W-005");
    await expect(ladder).toHaveText("Next step not read.");
    await closeDrawer(page);
    await page.unrouteAll();
  }

  // a frame on the open opus reads the line again: the Patron's greenlight, committed, moves the step and takes the amber away
  await openDrawer(page, "W-007");
  await expect(ladder).toContainText("greenlight");
  const record = join(served.studioDir, "opera", "W-007.md");
  writeFileSync(record, readFileSync(record, "utf8").replace("state: backlog", "state: greenlit"));
  commitAll(served.studioDir);
  const polled = await fetch(`${served.baseURL}/api/_poll`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  expect(polled.status, "the poll runs").toBe(200);
  await expect(ladder, "a frame on the opus reads the line again").toContainText("Next: spec · ", { timeout: 15_000 });
  expect(await color(page), "and the amber goes with the Patron's rung").not.toBe(AMBER);

  // another opus's late answer never shows under this title
  await closeDrawer(page);
  let settle: () => void = () => undefined;
  const held = new Promise<void>((r) => (settle = r));
  let lateFulfilled: () => void = () => undefined;
  const fulfilled = new Promise<void>((r) => (lateFulfilled = r));
  await page.route("**/api/opus/W-002/ladder", async (route) => {
    await held;
    await route.fulfill(json(answer("W-002", { why: "late" })));
    lateFulfilled();
  });
  await openDrawer(page, "W-007");
  await expect(ladder).toContainText("Next: spec · ");
  // from one opus straight to another, the drawer open: the first answer never shows under the second title
  await openDrawer(page, "W-002");
  await expect(ladder, "while it reads it says so").toHaveText("Reading the next step…");
  await openDrawer(page, "W-007");
  await expect(ladder).toContainText("Next: spec · ");
  const lateResponse = page.waitForResponse((r) => r.url().includes("/api/opus/W-002/ladder"));
  settle();
  await fulfilled;
  await lateResponse;
  // two frames: the late answer has reached React, if it was going to
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await ladder.textContent(), "a late answer for another opus does not replace this one").toContain("Next: spec · ");
});
