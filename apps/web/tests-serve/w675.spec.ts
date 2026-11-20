import { expect, test } from "@playwright/test";
import { NAV_ENTRIES } from "../src/lib/nav.js";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

const ROWS = [
  { width: 1280, sidebar: "expanded" },
  { width: 1280, sidebar: "collapsed" },
  { width: 640, sidebar: "expanded" },
  { width: 390, sidebar: "expanded" },
] as const;

const EXPECTED = {
  "color-surface-page": "#282a36",
  "color-surface-panel": "#343746",
  "color-surface-selected": "#44475a",
  "color-text-primary": "#f8f8f2",
  "color-text-secondary": "#c6c9d8",
  "color-text-muted": "#9ea4c4",
  "color-heading": "#bd93f9",
  "color-link": "#8be9fd",
  "color-category": "#ff79c6",
  "color-project": "#f1fa8c",
  "color-action-primary": "#3fb9a3",
  "color-state-success-indicator": "#50fa7b",
  "color-state-warning-indicator": "#ffb86c",
  "color-state-error-indicator": "#ff5555",
  "color-severity-low-indicator": "#6272a4",
} as const;

const ALIASES = {
  ink: "color-text-primary",
  "ink-2": "color-text-secondary",
  "ink-3": "color-text-muted",
  rule: "color-surface-selected",
  wash: "color-surface-panel",
  verdigris: "color-action-primary",
  amber: "color-state-warning-indicator",
  ok: "color-state-success-indicator",
  bad: "color-state-error-indicator",
  "severity-blocking": "color-severity-blocking-indicator",
  "severity-blocking-text": "color-severity-blocking-text",
  "severity-high": "color-severity-high-indicator",
  "severity-low": "color-severity-low-indicator",
  "accent-cyan": "color-link",
  "accent-pink": "color-category",
  "accent-purple": "color-heading",
  "accent-yellow": "color-project",
  surface: "color-surface-page",
  transparent: "color-surface-transparent",
  "shadow-drawer": "color-shadow-overlay",
} as const;

const READY_SELECTORS = {
  home: '.home[data-completion-settled="true"]',
  inbox: ".inbox__row",
  board: "[data-card-id]",
  seats: ".seats__table",
  officina: ".officina__panel-heading",
} as const;

let served: ServedInstance | undefined;
test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-675-b3 every shipped screen resolves legacy aliases through Dracula at every capture row", async ({ page }) => {
  served = await startServed("w675-b3", { now: "2026-09-25T09:35:43.947Z" });
  await seedToken(page, served);

  for (const entry of NAV_ENTRIES) {
    for (const row of ROWS) {
      await page.setViewportSize({ width: row.width, height: 900 });
      await page.goto(`${served.baseURL}/?w675=prime`);
      await page.evaluate((sidebar) => localStorage.setItem("bisellium.sidebar", sidebar), row.sidebar);
      await page.goto(`${served.baseURL}/?w675=${entry.route}-${row.width}-${row.sidebar}#/${entry.route}`);
      await expect(page.locator(READY_SELECTORS[entry.route]).first(), `${entry.route} ${row.width} ${row.sidebar} is ready`).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const names = [...Object.keys(EXPECTED), ...Object.keys(ALIASES), ...Object.values(ALIASES)];
      const values = await page.evaluate((properties) => {
        const style = getComputedStyle(document.documentElement);
        const normalize = (value: string): string => {
          const text = value.trim().toLowerCase();
          const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
          return short === null ? text : `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
        };
        return Object.fromEntries(properties.map((name) => [name, normalize(style.getPropertyValue(`--${name}`))]));
      }, [...new Set(names)]);
      for (const [role, value] of Object.entries(EXPECTED)) {
        expect(values[role], `${entry.route} ${row.width} ${row.sidebar}: --${role}`).toBe(value);
      }
      for (const [legacy, role] of Object.entries(ALIASES)) {
        expect(values[legacy], `${entry.route} ${row.width} ${row.sidebar}: --${legacy} resolves like --${role}`).toBe(values[role]);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        `${entry.route} ${row.width} ${row.sidebar}: no horizontal overflow`,
      ).toBeLessThanOrEqual(0);
      expect((await page.screenshot({ animations: "disabled", caret: "hide", fullPage: true })).byteLength).toBeGreaterThan(0);
    }
  }
});
