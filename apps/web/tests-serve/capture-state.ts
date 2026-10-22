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
