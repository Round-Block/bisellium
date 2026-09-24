/**
 * apps/web/tests-serve/seats.spec.ts — W-065 behaviour 14: mounted
 * interaction against the built dist served by a real `bisellium serve`.
 * Same harness W-067's answer.spec.ts uses (tests-serve/harness.ts): a
 * fresh temp copy of examples/sample-studio, a real server, the printed
 * token pasted through the shared TokenPrompt.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { runDelegate } from "@bisellium/commands/delegate.js";
import { startServed, type ServedInstance } from "./harness.js";

function manifestOf(dir: string): { sellae: { id: string; model?: string }[]; munera: { id: string; tier: string }[] } {
  return parseYaml(readFileSync(join(dir, "bisellium.yml"), "utf8"));
}

test.describe("the decree surface, end to end (W-065 behaviour 14)", () => {
  let served: ServedInstance;

  test.afterEach(async () => {
    await served?.close();
  });

  test("draft-and-confirm: only Confirm ever writes, exactly once", async ({ page }) => {
    served = await startServed("seats-confirm");

    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    let delegateRequests = 0;
    await page.route("**/api/delegate", (route) => {
      delegateRequests++;
      route.continue();
    });

    const modelSelect = page.locator('select[aria-label="model for seat builder-1"]');
    const tierSelect = page.locator('select[aria-label="tier for munus audit"]');
    await expect(modelSelect).toBeVisible();

    // Typing (changing) a model select and a tier select drafts only — 0
    // requests.
    await modelSelect.selectOption("claude-opus-5");
    await tierSelect.selectOption("high");
    expect(delegateRequests).toBe(0);
    await expect(page.locator(".seats__confirm-bar")).toBeVisible();

    // Cancel -> 0 requests, displayed value returns to the record's.
    await page.locator(".seats__cancel-btn").click();
    await expect(page.locator(".seats__confirm-bar")).toBeHidden();
    expect(delegateRequests).toBe(0);
    await expect(modelSelect).toHaveValue("claude-sonnet-5");

    // Draft again, then Confirm -> exactly 1 request, body carries the
    // displayed draft and the displayed from.
    await modelSelect.selectOption("claude-opus-5");
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith("/api/delegate") && r.method() === "POST"),
      page.locator(".seats__confirm-btn").click(),
    ]);
    const body = request.postDataJSON() as { sella: string; model: string; from: string };
    expect(body.sella).toBe("builder-1");
    expect(body.model).toBe("claude-opus-5");
    expect(body.from).toBe("claude-sonnet-5");
    expect(delegateRequests).toBe(1);

    // After a real success: the page refetches, the row shows the new
    // value, and the manifest on disk carries it.
    await expect(page.locator(".seats__confirm-bar")).toBeHidden();
    await expect(modelSelect).toHaveValue("claude-opus-5");
    expect(manifestOf(served.studioDir).sellae.find((s) => s.id === "builder-1")?.model).toBe("claude-opus-5");
  });

  test("Confirm clicked three times overlapping still issues exactly 1 request; Enter submits identically", async ({ page }) => {
    served = await startServed("seats-overlap");
    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    let requestCount = 0;
    let releaseResponse: (() => void) | undefined;
    const barrier = new Promise<void>((resolvePromise) => {
      releaseResponse = resolvePromise;
    });
    await page.route("**/api/delegate", async (route) => {
      requestCount++;
      await barrier;
      await route.continue();
    });

    const modelSelect = page.locator('select[aria-label="model for seat builder-1"]');
    await modelSelect.selectOption("claude-opus-5");
    // Three native clicks dispatched in one synchronous pass — deliberately
    // NOT Playwright's own `.click()` three times over (which waits for
    // re-enablement between each, and would just hang against a button that
    // stays disabled behind the barrier). This is the actual overlap case:
    // three click events landing before React's first `busy` re-render can
    // possibly disable the button.
    await page.locator(".seats__confirm-btn").evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
      el.click();
    });
    releaseResponse?.();
    await expect(page.locator(".seats__confirm-bar")).toBeHidden({ timeout: 10_000 });
    expect(requestCount).toBe(1);
  });

  test("Enter from the confirm bar submits identically to a click", async ({ page }) => {
    served = await startServed("seats-enter");
    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    const modelSelect = page.locator('select[aria-label="model for seat builder-1"]');
    await modelSelect.selectOption("claude-opus-5");
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith("/api/delegate") && r.method() === "POST"),
      page.locator(".seats__confirm-bar").press("Enter"),
    ]);
    expect(request).toBeTruthy();
    await expect(page.locator(".seats__confirm-bar")).toBeHidden();
  });

  test("a real stale draft: the manifest changes under the console, Confirm reports the conflict and keeps the draft", async ({ page }) => {
    served = await startServed("seats-stale");
    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    const modelSelect = page.locator('select[aria-label="model for seat builder-1"]');
    await modelSelect.selectOption("claude-opus-5");
    await expect(page.locator(".seats__confirm-bar")).toBeVisible();

    // The fixture is changed on disk by a direct runDelegate call after the
    // page rendered — same studio dir the server already has open.
    const cliResult = runDelegate(["--sella", "builder-1", "--model", "gpt-5.6-sol", "--studio", served.studioDir]);
    expect(cliResult.exitCode).toBe(0);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/delegate") && r.request().method() === "POST"),
      page.locator(".seats__confirm-btn").click(),
    ]);
    // The server answers HTTP 200 with ok:false (a stale --from), never a
    // success and never a 4xx.
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);

    // The page shows a visible conflict, retains the draft, reports no
    // success.
    await expect(page.locator(".seats__confirm-bar")).toBeVisible();
    await expect(page.locator(".seats__confirm-error")).toBeVisible();
    await expect(modelSelect).toHaveValue("claude-opus-5"); // the draft, not reverted

    // The manifest on disk stays at the CLI's value.
    expect(manifestOf(served.studioDir).sellae.find((s) => s.id === "builder-1")?.model).toBe("gpt-5.6-sol");
  });

  test("a transport error re-opens the token prompt, draft retained", async ({ page }) => {
    served = await startServed("seats-transport-error");
    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    await page.route("**/api/delegate", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));

    const modelSelect = page.locator('select[aria-label="model for seat builder-1"]');
    await modelSelect.selectOption("claude-opus-5");
    await page.locator(".seats__confirm-btn").click();

    await expect(page.locator(".token-prompt")).toBeVisible();
    await expect(page.locator(".seats__confirm-bar")).toBeVisible();
    await expect(modelSelect).toHaveValue("claude-opus-5");
  });

  test("editing while a request is pending issues no second request", async ({ page }) => {
    served = await startServed("seats-pending-edit");
    await page.goto(`${served.baseURL}/#/seats`);
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    let requestCount = 0;
    let releaseResponse: (() => void) | undefined;
    const barrier = new Promise<void>((resolvePromise) => {
      releaseResponse = resolvePromise;
    });
    await page.route("**/api/delegate", async (route) => {
      requestCount++;
      await barrier;
      await route.continue();
    });

    const modelSelect = page.locator('select[aria-label="model for seat builder-1"]');
    const tierSelect = page.locator('select[aria-label="tier for munus audit"]');
    await modelSelect.selectOption("claude-opus-5");
    await page.locator(".seats__confirm-btn").click();

    // Every control disables while a write is in flight — editing here
    // cannot fire a second request through the UI at all.
    await expect(tierSelect).toBeDisabled();
    releaseResponse?.();
    await expect(page.locator(".seats__confirm-bar")).toBeHidden({ timeout: 10_000 });
    expect(requestCount).toBe(1);
  });
});
