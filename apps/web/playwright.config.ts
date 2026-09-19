import { defineConfig, devices } from "@playwright/test";

// apps/web/playwright.config.ts — W-029. Chromium only (keeps the suite
// light; firefox/webkit are out of scope per the brief). `webServer` starts
// vite dev itself so `npm run test:e2e` needs nothing else running — the
// screens' own `?demo=1` fixture data (Inbox.tsx, Officina.tsx) keeps
// assertions independent of a live bisellium server.
const PORT = 5199;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
});
