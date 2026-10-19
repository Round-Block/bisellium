import { defineConfig, devices } from "@playwright/test";

// apps/web/playwright.config.ts — W-029, W-182. Chromium only (keeps the
// suite light; firefox/webkit are out of scope per the brief). `webServer`
// starts vite dev itself so `npm run test:e2e` needs nothing else running —
// the screens' own `?demo=1` fixture data (Inbox.tsx, Officina.tsx) keeps
// assertions independent of a live bisellium server. Vite takes port 0, so
// the OS picks a free one per run; Playwright copies the port Vite prints
// into process.env.SMOKE_PORT (the named group, upper-cased) before any test
// file loads, and smoke.spec.ts builds its baseURL from it.
const VITE_READY = /Local:\s+http:\/\/127\.0\.0\.1:(?<smoke_port>\d+)\//;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 0 --strictPort",
    wait: { stdout: VITE_READY },
    timeout: 30_000,
  },
});
