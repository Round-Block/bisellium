/**
 * apps/web/tests-serve/w280.spec.ts — W-280. The console the Patron is served (the built apps/web/dist behind
 * `bisellium serve`) never shows the Inbox's demo petitions (P-008..P-010, invented): `?demo` reads the studio
 * like any other visit, and a failed read under it invents nothing (W-077, W-341). The demo fixtures stay a
 * vite-dev aid (`npm run dev`, apps/web/tests/smoke.spec.ts) and leave the production bundle.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startServed, WEB_DIST, type ServedInstance } from "./harness.js";

/** Strings only the Inbox's demo fixtures carry: their ids and subjects. */
const DEMO_MARKERS = [
  "P-008", "P-009", "P-010",
  "Approve the Outlook-style Inbox decision layout",
  "Review inbox keyboard navigation edge case",
  "Confirm gate-ladder mark alignment at 3px gaps",
];

let served: ServedInstance | undefined;
test.afterEach(async () => { await served?.close(); served = undefined; });

async function signIn(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator("#token-prompt-input").fill(served!.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
}

async function rowTexts(page: Page): Promise<string[]> {
  await expect(page.locator(".inbox__row").first()).toBeVisible();
  return page.locator(".inbox__row").allInnerTexts();
}

function bundleFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? bundleFiles(join(dir, entry.name)) : [join(dir, entry.name)]);
}

test("W-280-b1 behaviour 1: the served Inbox under ?demo shows the studio's own petitions, and a failed read under it invents none", async ({ page }) => {
  served = await startServed("w280-b1");
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, `${served.baseURL}/#/inbox`);
  const own = await rowTexts(page);
  expect(own.length, "the sample studio's own Inbox has rows").toBeGreaterThan(0);

  await page.goto(`${served.baseURL}/?demo#/inbox`);
  expect(await rowTexts(page), "?demo shows the same petitions as the plain Inbox").toEqual(own);
  const shown = await page.locator(".inbox").innerText();
  for (const marker of DEMO_MARKERS) expect(shown, `no demo petition is shown: ${marker}`).not.toContain(marker);

  await page.route("**/api/inbox*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.reload();
  await expect(page.locator('.shell__status[data-state="error"]'), "a failed read under ?demo is the error state").toHaveText("Could not load the inbox.");
  await expect(page.locator(".inbox__row"), "a failed read under ?demo invents no petition").toHaveCount(0);
});

test("W-280-b2 behaviour 2: the production bundle carries none of the Inbox's demo fixtures", () => {
  const files = bundleFiles(WEB_DIST);
  expect(files.some((file) => file.endsWith(".js")), "the served bundle is built (global-setup)").toBe(true);
  const carrying = DEMO_MARKERS.flatMap((marker) =>
    files.filter((file) => readFileSync(file, "latin1").includes(marker)).map((file) => `${marker} in ${file.slice(WEB_DIST.length + 1)}`));
  expect(carrying, "no bundle file carries a demo fixture").toEqual([]);
});
