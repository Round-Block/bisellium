import { expect, test } from "@playwright/test";
import { startServed } from "./harness.js";

async function signIn(page: import("@playwright/test").Page, baseURL: string, token: string): Promise<void> {
  await page.goto(`${baseURL}/#/inbox`);
  await page.locator("#token-prompt-input").fill(token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
}

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

test("W-345-b4 a failed refresh shows failure and no stale petition", async ({ page }) => {
  const served = await startServed("w345-b4");
  let reads = 0;
  await page.route("**/api/inbox", async (route) => {
    reads++;
    if (reads === 1) await route.continue();
    else await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  try {
    await signIn(page, served.baseURL, served.token);
    await expect(page.locator(".inbox__row")).toHaveCount(1);
    await page.locator(".inbox__input-ratio").fill("record this answer");
    await page.getByRole("button", { name: /approve/i }).click();
    await expect(page.locator('.shell__status[data-state="error"]')).toHaveText("Could not load the inbox.");
    await expect(page.locator(".inbox__row")).toHaveCount(0);
    await expect(page.locator(".inbox__empty")).toHaveText("Could not load the inbox.");
    await expect(page.locator(".inbox__confirmation")).toHaveText("Recorded approve answer for A-1; the petition is resolved.");
  } finally {
    await served.close();
  }
});

test("W-345-b5 the reason and answer controls are reachable at 390px", async ({ page }) => {
  const served = await startServed("w345-b5");
  const petitiones = Array.from({ length: 14 }, (_, index) => ({
    id: `P-${String(index + 1).padStart(2, "0")}`,
    opus: "W-345",
    from: "ui-lead",
    subject: `Phone decision ${index + 1}`,
    body: `Evidence for decision ${index + 1}`,
  }));
  await page.route("**/api/inbox", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones }) }));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, served.baseURL, served.token);
    const detail = page.locator(".inbox__detail");
    const rows = page.locator(".inbox__row");
    const reason = page.locator(".inbox__input-ratio");
    await expect(detail).toBeVisible();
    await expect(reason).toBeVisible();
    const first = rows.first();
    await first.focus();
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    const focusStyle = await first.evaluate((node) => {
      const style = getComputedStyle(node);
      return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset };
    });
    expect(focusStyle).toEqual({ width: "2px", style: "solid", offset: "2px" });
    for (let index = 1; index < petitiones.length; index++) await page.keyboard.press("j");
    const last = rows.last();
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute("aria-pressed", "true");
    const listBox = await page.locator(".inbox__list").boundingBox();
    const lastBox = await last.boundingBox();
    expect(listBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
    const listHeight = await page.locator(".inbox__list").evaluate((node) => node.getBoundingClientRect().height);
    expect(listHeight).toBeLessThanOrEqual(844 * 0.4);
    expect(lastBox!.y).toBeGreaterThanOrEqual(listBox!.y);
    expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(listBox!.y + listBox!.height + 1);
    expect(await page.locator(".inbox__list").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    await expect(reason).toBeFocused();
    await reason.scrollIntoViewIfNeeded();
    await expect(reason).toBeInViewport();
    await reason.fill("phone answer reason");
    const approve = page.getByRole("button", { name: /approve/i });
    await approve.scrollIntoViewIfNeeded();
    await expect(approve).toBeInViewport();
    await expect(approve).toBeEnabled();
    await page.keyboard.press("Tab");
    await expect(approve).toBeFocused();
    const decline = page.getByRole("button", { name: /decline/i });
    const followup = page.getByRole("button", { name: /follow up/i });
    await page.keyboard.press("Tab");
    await expect(decline).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(followup).toBeFocused();
    for (const target of [last, reason, approve, decline, followup]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await served.close();
  }
});

test("W-345-b6 Follow up sends ask-back open text and success names the open record", async ({ page }) => {
  const served = await startServed("w345-b6");
  let answered = false;
  const all = [
    { id: "P-1", opus: "W-345", from: "architect", subject: "First", body: "First evidence" },
    { id: "P-2", opus: "W-345", from: "ui-lead", subject: "Second", body: "Second evidence" },
  ];
  await page.route("**/api/inbox", (route) => {
    const petitiones = answered ? all.slice(0, 1) : all;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones }) });
  });
  let answerBody: unknown;
  await page.route("**/api/answer", (route) => {
    answerBody = route.request().postDataJSON();
    answered = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, output: "recorded" }) });
  });
  try {
    await signIn(page, served.baseURL, served.token);
    const badge = page.locator(".sidebar__badge");
    await expect(badge).toHaveText("2");
    const buttons = page.locator(".inbox__btn-action");
    await expect(buttons).toHaveCount(3);
    await expect(page.getByRole("button", { name: /defer|delegate/i })).toHaveCount(0);
    await expect(page.locator(".inbox__action-effect")).toContainText("Follow up records the text without a verdict");
    await page.locator(".inbox__row").nth(1).click();
    await page.locator(".inbox__input-ratio").fill("Could you test ‘理由’?");
    await page.getByRole("button", { name: /follow up/i }).click();
    expect(answerBody).toEqual({ petitio: "P-2", reply: "Could you test ‘理由’?", askBack: true });
    await expect(page.locator(".inbox__row")).toHaveCount(1);
    await expect(badge).toHaveText("1");
    await expect(page.locator(".inbox__detail-subject")).toHaveText("First");
    await expect(page.locator(".inbox__input-ratio")).toBeVisible();
    const confirmation = page.locator(".inbox__confirmation");
    await expect(confirmation).toHaveText("Recorded follow-up reply for P-2; the petition remains open awaiting the asker's reply.");
    const [confirmationInset, titleInset] = await Promise.all([
      confirmation.evaluate((node) => getComputedStyle(node).paddingLeft),
      page.locator(".inbox__list .inbox__title").evaluate((node) => getComputedStyle(node).paddingLeft),
    ]);
    expect(confirmationInset).toBe(titleInset);
    await expect(page.locator('.shell__status[data-state="ready"]')).toHaveText("Recorded follow-up reply for P-2; the petition remains open awaiting the asker's reply.");
  } finally {
    await served.close();
  }
});
