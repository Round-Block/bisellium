/**
 * apps/web/tests-serve/auth.spec.ts — W-067 behaviour 2, the browser half
 * of token delivery. Each test spawns its own `bisellium serve` (harness.ts)
 * against a fresh temp copy of examples/sample-studio and drives the built
 * `apps/web/dist`. Titles are what `bisellium red`'s `-g` selects — never
 * argv (playwright.serve.config.ts has no per-behaviour argv filter).
 */
import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { seedToken, startServed, WEB_DIST, type ServedInstance } from "./harness.js";

const TOKEN_KEY = "bisellium.token";

async function approveFirstPetitio(page: import("@playwright/test").Page, reason: string): Promise<void> {
  await page.locator(".inbox__row").first().click();
  await page.locator(".inbox__input-ratio").fill(reason);
  // The button's accessible name carries its hotkey digit too ("1 approve").
  await page.getByRole("button", { name: /approve/i }).click();
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

test.describe("token delivery, mounted (W-067 behaviour 2)", () => {
  let served: ServedInstance;

  test.afterEach(async () => {
    await served?.close();
  });

  test("prompts for a token when sessionStorage is empty", async ({ page }) => {
    served = await startServed("auth-empty");
    await page.goto(served.baseURL);
    await expect(page.locator(".token-prompt")).toBeVisible();
  });

  test("the entered token is used on the next write and survives a reload without re-prompting", async ({ page }) => {
    served = await startServed("auth-survive");
    await page.goto(served.baseURL);
    await expect(page.locator(".token-prompt")).toBeVisible();

    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    // One replyable question joins the sample's Board-owned attention item.
    await expect(page.locator(".inbox__row")).toHaveCount(2);
    const answeredSubject = await page.locator(".inbox__subject").first().textContent();
    await approveFirstPetitio(page, "approve: token survives reload");

    // A successful write never re-opens the prompt, and the Inbox refetches
    // (the answered question drops out, while Board-owned attention remains).
    await expect(page.locator(".token-prompt")).toBeHidden();
    await expect(page.locator(".inbox__row")).toHaveCount(2);
    await expect(page.locator(".inbox__subject", { hasText: answeredSubject ?? "" })).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".token-prompt")).toBeHidden();
  });

  test("a wrong token in sessionStorage produces a 401 that reopens the prompt, and the replacement then succeeds", async ({ page }) => {
    served = await startServed("auth-wrong-token");
    // W-501: the reads need the token, so the screen loads, and the reason is typed, with the right one; the stored token
    // goes wrong just before the write, so only the write is refused.
    await seedToken(page, served);
    await page.goto(served.baseURL);
    await expect(page.locator(".token-prompt")).toBeHidden();
    await page.locator(".inbox__row").first().click();
    await page.locator(".inbox__input-ratio").fill("approve: wrong token first");
    await page.evaluate(([key, value]) => window.sessionStorage.setItem(key, value), [TOKEN_KEY, "definitely-the-wrong-token"]);
    await page.getByRole("button", { name: /approve/i }).click();

    await expect(page.locator(".token-prompt")).toBeVisible();

    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    // The reason typed before the 401 is untouched (no local Inbox handling
    // of "unauthorized") — the same click, now authorized, succeeds.
    await page.getByRole("button", { name: /approve/i }).click();
    await expect(page.locator(".inbox__row")).toHaveCount(2);
  });

  test("the built dist carries no copy of the live write-auth token", async () => {
    served = await startServed("auth-bundle-grep");
    const files = listFiles(WEB_DIST);
    expect(files.length).toBeGreaterThan(0);
    const hit = files.find((f) => {
      try {
        return readFileSync(f, "utf8").includes(served.token);
      } catch {
        return false; // a binary asset — can't carry a hex token substring meaningfully
      }
    });
    expect(hit).toBeUndefined();
  });
});
