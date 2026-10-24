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
