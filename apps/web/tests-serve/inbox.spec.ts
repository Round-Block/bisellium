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
    const first = page.locator(".inbox__item").first();
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

test("W-345-b4 a failed first read shows the empty failure state", async ({ page }) => {
  const served = await startServed("w345-b4");
  await page.route("**/api/inbox", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  try {
    await signIn(page, served.baseURL, served.token);
    await expect(page.locator('.shell__status[data-state="error"]')).toHaveText("Could not load the inbox.");
    await expect(page.locator(".inbox__row")).toHaveCount(0);
    await expect(page.locator(".inbox__empty")).toHaveText("Could not load the inbox.");
  } finally {
    await served.close();
  }
});

test("W-345-b5 Outlook mobile opens full-screen controls and returns to its selected row at 390px", async ({ page }) => {
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
    const items = page.getByRole("option");
    const list = page.locator(".inbox__list-pane");
    const reading = page.locator(".inbox__reading-pane");
    const reason = page.locator(".inbox__input-ratio");
    await expect(list).toBeVisible();
    await expect(reading).toBeHidden();
    const first = items.first();
    await first.focus();
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("j");
    const second = items.nth(1);
    await expect(second).toBeFocused();
    const focusStyle = await second.evaluate((node) => {
      const style = getComputedStyle(node);
      return { width: style.outlineWidth, shadow: style.boxShadow };
    });
    expect(focusStyle.width).toBe("0px");
    expect(focusStyle.shadow).toBe("none");
    await expect(second).toHaveCSS("background-color", "rgb(52, 55, 70)");
    for (let index = 2; index < petitiones.length; index++) await page.keyboard.press("j");
    const last = items.last();
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute("aria-selected", "true");
    const listBox = await list.boundingBox();
    const lastBox = await last.boundingBox();
    expect(listBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
    expect(lastBox!.y).toBeGreaterThanOrEqual(listBox!.y);
    expect(lastBox!.y + lastBox!.height, "nearest reveal makes the complete taller row visible").toBeLessThanOrEqual(listBox!.y + listBox!.height);
    expect(await list.evaluate((node) => node.scrollTop), "taller two-line rows scroll only when the selected row needs revealing").toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(reading).toBeVisible();
    await expect(list).toBeHidden();
    await expect(page.getByRole("button", { name: "Back to Inbox" })).toBeVisible();
    await reason.focus();
    await expect(reason).toBeInViewport();
    await reason.fill("phone answer reason");
    const approve = page.getByRole("button", { name: /approve/i });
    await approve.scrollIntoViewIfNeeded();
    await expect(approve).toBeInViewport();
    await expect(approve).toBeEnabled();
    await page.keyboard.press("Tab");
    await expect(approve).toBeFocused();
    const defer = page.getByRole("button", { name: /defer/i });
    const decline = page.getByRole("button", { name: /decline/i });
    await page.keyboard.press("Tab");
    await expect(defer).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(decline).toBeFocused();
    for (const target of [reason, approve, defer, decline]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "Back to Inbox" }).click();
    await expect(list).toBeVisible();
    await expect(last).toBeFocused();
    expect((await last.boundingBox())!.height).toBeCloseTo(68, 0);
  } finally {
    await served.close();
  }
});

test("W-345-b6 Defer sends ask-back verdict text and success names the open record", async ({ page }) => {
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
    await expect(badge).toHaveText("1");
    const buttons = page.locator(".inbox__btn-action");
    await expect(buttons).toHaveCount(4);
    await expect(page.getByRole("button", { name: "delegate" })).toBeDisabled();
    await expect(page.getByText("Ratio decidendi", { exact: true })).toBeVisible();
    await page.locator(".inbox__row").nth(1).click();
    await page.locator(".inbox__input-ratio").fill("Could you test ‘理由’?");
    await page.getByRole("button", { name: /defer/i }).click();
    expect(answerBody).toEqual({ petitio: "P-2", reply: "defer: Could you test ‘理由’?", askBack: true });
    await expect(page.locator(".inbox__row")).toHaveCount(1);
    await expect(badge).toHaveText("1");
    await expect(page.locator(".inbox__subject").first()).toHaveText("First");
    await expect(page.locator(".inbox__input-ratio")).toBeVisible();
    const confirmation = page.locator(".inbox__confirmation");
    await expect(confirmation).toHaveText("Recorded defer answer for P-2; the petition remains open awaiting the asker's reply.");
    await expect(page.locator('.shell__status[data-state="ready"]')).toHaveText("Recorded defer answer for P-2; the petition remains open awaiting the asker's reply.");
  } finally {
    await served.close();
  }
});
