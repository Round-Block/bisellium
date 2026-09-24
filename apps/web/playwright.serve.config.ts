import { defineConfig, devices } from "@playwright/test";

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
 */
export default defineConfig({
  testDir: "./tests-serve",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  timeout: 30_000,
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
