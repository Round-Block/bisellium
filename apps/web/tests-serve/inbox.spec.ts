import { expect, test } from "@playwright/test";
import { startServed } from "./harness.js";

test("W-345-b1 typing shortcut characters in the reason keeps the petition and sends nothing", async ({ page }) => {
  const served = await startServed("w345-b1");
  let writes = 0;
  await page.route("**/api/answer", async (route) => {
    writes++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, output: "recorded" }) });
  });
  try {
    await page.goto(`${served.baseURL}/?demo=1#/inbox`);
    const first = page.locator(".inbox__row").first();
    await expect(first).toHaveAttribute("data-focused", "true");
    const reason = page.locator(".inbox__input-ratio");
    await reason.click();
    await page.keyboard.type("jk1234");
    await expect(reason).toHaveValue("jk1234");
    await expect(first).toHaveAttribute("data-focused", "true");
    expect(writes).toBe(0);
  } finally {
    await served.close();
  }
});

test("W-345-b2 two same-turn answers issue one request", async ({ page }) => {
  const served = await startServed("w345-b2");
  let writes = 0;
  let seenFirst = (): void => undefined;
  let release = (): void => undefined;
  const first = new Promise<void>((resolve) => (seenFirst = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/answer", async (route) => {
    writes++;
    seenFirst();
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, output: "recorded" }) });
  });
  try {
    await page.goto(`${served.baseURL}/?demo=1#/inbox`);
    await page.locator(".inbox__input-ratio").fill("one recorded reason");
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    });
    await first;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(writes).toBe(1);
  } finally {
    release();
    await served.close();
  }
});

test("W-345-b3 moving between petitions never carries one reason into another", async ({ page }) => {
  const served = await startServed("w345-b3");
  try {
    await page.goto(`${served.baseURL}/?demo=1#/inbox`);
    const rows = page.locator(".inbox__row");
    const reason = page.locator(".inbox__input-ratio");
    await reason.fill("reason for P-008 only");
    await rows.nth(1).click();
    await expect(reason).toHaveValue("");
    await expect(page.locator(".inbox__btn-action").first()).toBeDisabled();
    await reason.fill("reason for P-009 only");
    await rows.first().click();
    await expect(reason).toHaveValue("reason for P-008 only");
  } finally {
    await served.close();
  }
});
