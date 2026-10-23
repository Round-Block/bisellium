import { expect, type Page } from "@playwright/test";

export const CAPTURE_NOW = "2026-09-25T09:35:43.947Z";
export const CAPTURE_VIEWPORTS = [1280, 390] as const;

export type CaptureRoute = "inbox" | "board" | "seats" | "officina";

const SCREEN_ROOT: Readonly<Record<CaptureRoute, string>> = {
  inbox: ".inbox",
  board: ".board",
  seats: ".seats",
  officina: ".officina",
};

const LOADING_COPY = /Loading[^\r\n]*(?:\u2026|\.{3})/u;

/** Keep browser-owned dates fixed while requests, fonts and rendering continue normally. */
export async function freezeCaptureClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(CAPTURE_NOW));
}

/**
 * A mounted screen is not necessarily a settled screen. Wait on each screen's
 * own successful-data evidence and reject every visible loading placeholder.
 */
export async function expectCapturedScreenSettled(page: Page, route: CaptureRoute): Promise<void> {
  if (!Object.hasOwn(SCREEN_ROOT, route)) throw new Error(`unknown capture route: ${String(route)}`);
  const root = page.locator(SCREEN_ROOT[route]);
  await expect(root, `${route}: screen mounted`).toHaveCount(1);

  if (route === "inbox") {
    await expect(page.locator('.shell__status[data-state="ready"]'), "inbox: its read has settled").toHaveCount(1);
    await expect(page.locator(".inbox__row").first(), "inbox: a served row is focused").toHaveAttribute("data-focused", "true");
  } else if (route === "board") {
    await expect(page.locator('.shell__status[data-state="live"]'), "board: its complete reconciliation is live").toHaveCount(1);
    await expect.poll(() => page.locator("[data-card-id]").count(), "board: served cards have landed").toBeGreaterThan(0);
    await expect.poll(() => page.locator(".gate-ladder").count(), "board: gate evidence has landed").toBeGreaterThan(0);
  } else if (route === "seats") {
    await expect(page.locator('.shell__status[data-state="ready"]'), "seats: its roster and model reads have settled").toHaveCount(1);
    const selects = page.locator('select[aria-label^="model for seat "]');
    await expect.poll(() => selects.count(), "seats: the served roster has landed").toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          selects.evaluateAll((nodes) =>
            nodes.every((node) => {
              const select = node as HTMLSelectElement;
              const option = select.selectedOptions[0];
              return select.value !== "" && option?.value === select.value && (option.textContent ?? "").includes(select.value);
            }),
          ),
        "seats: every selected model identity has rendered",
      )
      .toBe(true);
  } else {
    await expect(page.locator('.shell__status[data-state="ready"]'), "officina: every panel read has settled").toHaveCount(1);
    await expect(page.locator(".officina__panel-heading"), "officina: every settled panel is mounted").toHaveCount(4);
    await expect(page.locator(".officina__loading"), "officina: no section remains loading").toHaveCount(0);
  }

  await expect(page.locator("body"), `${route}: no loading copy remains`).not.toContainText(LOADING_COPY);
}
