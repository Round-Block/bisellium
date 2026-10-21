import { defineConfig, devices } from "@playwright/test";

export function readRefreshScreenshots(value = process.env["BISELLIUM_UPDATE_SCREENSHOTS"], githubActions = process.env["GITHUB_ACTIONS"]): boolean {
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("BISELLIUM_UPDATE_SCREENSHOTS must be absent, 0 or 1");
  if (githubActions !== "true") throw new Error("screenshot baselines may be written only by GitHub Actions");
  return true;
}

const refreshScreenshots = readRefreshScreenshots();

/**
 * apps/web/playwright.serve.config.ts — W-067. Unlike playwright.config.ts
 * (vite dev + the screens' own `?demo=1` fixtures, which never issues a
 * POST), these specs drive the BUILT `apps/web/dist`, served by a real
 * `bisellium serve` against a throwaway studio — the only place in the repo
 * that proves a browser write actually works.
 *
 * Deliberately no `webServer` block: each spec spawns its own `bisellium
 * serve` (tests-serve/harness.ts), because the write-auth token only ever
 * exists in that process's own stdout — a shared `webServer` has no way to
 * hand it to a spec — and each spec picks its own free port (`--port 0`),
 * so nothing here needs to coordinate a shared one. Every spec's studio is
 * always a fresh temp copy of examples/sample-studio; nothing ever points
 * these at studio/.
 *
 * `globalSetup` builds the bundle first (W-110): nothing else in the served
 * path ever builds it, so a bare run drove whatever dist an earlier commit left.
 */
export default defineConfig({
  testDir: "./tests-serve",
  globalSetup: "./tests-serve/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  updateSnapshots: refreshScreenshots ? "all" : "none",
  expect: {
    toHaveScreenshot: {
      threshold: 0,
      maxDiffPixels: 0,
      pathTemplate: "{snapshotDir}/{testFilePath}-snapshots/{arg}{ext}",
    },
  },
  timeout: 30_000,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], locale: "en-GB", timezoneId: "UTC", deviceScaleFactor: 1 } }],
});
