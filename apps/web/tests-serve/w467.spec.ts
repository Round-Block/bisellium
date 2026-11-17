process.env["NODE_ENV"] = "test";

import { expect, test, type Page, type Route } from "@playwright/test";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

const WIDTHS = [1280, 640, 390] as const;
const NOW = "2026-10-28T12:00:00.000Z";

type Opus = {
  id: string;
  title: string;
  body: string;
  kind: string;
  collegium: string;
  sella: string;
  state: string;
  tokens: number;
  probationes: Record<string, { status: string }>;
  traditio: undefined;
};

type Budget = {
  collegium: string;
  period: string;
  allowance: { tokens: number };
  burn: { tokens: number };
  posture: string;
};

type Health = {
  at: string;
  ok: boolean;
  blocks: number;
  advisories: number;
  findingsByRule: Record<string, number>;
  autonomy: { paused: boolean };
  lastTick: string;
  due: { kind: string; id: string }[];
};

type Outcome<T> = T | "failed" | "pending";
type Fixtures = {
  budgets: Outcome<Budget[]>;
  health: Outcome<Health>;
  officina: Outcome<typeof OFFICINA>;
  opera: Outcome<Opus[]>;
};

const OFFICINA = {
  studio: "studio",
  patron: "patron",
  collegia: [],
  sellae: [],
  probationes: [
    { id: "patron", kind: "human" },
    { id: "ci", kind: "automated" },
  ],
  wip_limit: 8,
  lifecycle: {
    id: "opus",
    states: [
      { id: "building", name: "Building", phase: "in_progress" },
      { id: "review", name: "Review", phase: "awaiting_review" },
      { id: "blocked", name: "Blocked", phase: "halted" },
      { id: "done", name: "Done", phase: "done" },
    ],
  },
};

const healthy = (): Health => ({
  at: NOW,
  ok: true,
  blocks: 0,
  advisories: 0,
  findingsByRule: {},
  autonomy: { paused: false },
  lastTick: NOW,
  due: [],
});

const opus = (
  id: string,
  state: string,
  probationes: Opus["probationes"] = {},
): Opus => ({
  id,
  title: `A plain title for ${id}`,
  body: "",
  kind: "ui",
  collegium: "engineering",
  sella: "builder",
  state,
  tokens: 0,
  probationes,
  traditio: undefined,
});

const base = (): Fixtures => ({
  budgets: [],
  health: healthy(),
  officina: OFFICINA,
  opera: [],
});

let served: ServedInstance | undefined;
let sequence = 0;

function answer<T>(route: Route, outcome: Outcome<T>): Promise<void> {
  if (outcome === "pending") return new Promise(() => undefined);
  if (outcome === "failed") return route.fulfill({ status: 503, body: "{}" });
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(outcome),
  });
}

async function installRoutes(page: Page, fixtures: Fixtures): Promise<void> {
  await page.route("**/api/aerarium*", (route) => answer(route, fixtures.budgets));
  await page.route("**/api/health", (route) => answer(route, fixtures.health));
  await page.route("**/api/officina", (route) => answer(route, fixtures.officina));
  await page.route("**/api/opera*", (route) => answer(route, fixtures.opera));
}

async function open(
  page: Page,
  width: (typeof WIDTHS)[number],
  sidebar: "expanded" | "collapsed",
  waitForSettled = true,
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  sequence += 1;
  await page.goto(`${served!.baseURL}/?w467=${sequence}#/officina`);
  await page.evaluate((value) => localStorage.setItem("bisellium.sidebar", value), sidebar);
  await page.reload();
  await expect(page.locator(".officina__panel-heading")).toHaveCount(3);
  if (waitForSettled) await expect(page.locator(".officina__loading")).toHaveCount(0);
}

async function tokenColour(
  page: Page,
  token:
    | "--color-heading"
    | "--color-text-primary"
    | "--color-text-secondary"
    | "--color-text-muted"
    | "--color-fact"
    | "--color-category"
    | "--color-severity-blocking-indicator"
    | "--color-severity-high-indicator"
    | "--color-severity-low-indicator",
): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

async function expectContained(page: Page, label: string): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    `${label}: no horizontal page overflow`,
  ).toBeLessThanOrEqual(0);
}

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

test("W-467-b1 Work in flight uses Home roles for empty, one and many work at every ruled width", async ({
  page,
}) => {
  served = await startServed("w467-b1", { now: NOW });
  await seedToken(page, served);
  const fixtures = base();
  await installRoutes(page, fixtures);

  fixtures.opera = [];
  await open(page, 1280, "expanded");
  await expect(page.locator(".panel--work")).toContainText("Nothing in flight.");

  fixtures.opera = [opus("W-1", "building")];
  await open(page, 1280, "expanded");
  await expect(page.locator(".officina__work-row")).toHaveCount(1);

  fixtures.opera = [
    opus("W-1", "building", { patron: { status: "pending" } }),
    opus("W-2", "review"),
    opus("W-3", "building", { ci: { status: "pending" } }),
    opus("W-4", "blocked"),
  ];
  for (const [width, sidebar] of [
    [1280, "expanded"],
    [1280, "collapsed"],
    [640, "expanded"],
    [390, "expanded"],
  ] as const) {
    await open(page, width, sidebar);
    const [heading, ink2, ink3, cyan, pink] = await Promise.all([
      tokenColour(page, "--color-heading"),
      tokenColour(page, "--color-text-secondary"),
      tokenColour(page, "--color-text-muted"),
      tokenColour(page, "--color-fact"),
      tokenColour(page, "--color-category"),
    ]);
    const label = `${width} ${sidebar}`;
    const buildingGroup = page.locator(
      '.panel--work .officina__work-group[data-group="building"]',
    );
    const w1Row = page.locator(".panel--work .officina__work-row").filter({
      has: page.getByText("W-1", { exact: true }),
    });
    await expect(page.locator(".officina__title"), `${label}: page heading uses Dracula Purple`).toHaveCSS(
      "color",
      heading,
    );
    await expect(
      page.locator(".panel--work .officina__panel-heading"),
      `${label}: Work heading uses Dracula Purple`,
    ).toHaveCSS("color", heading);
    await expect(
      buildingGroup.locator(":scope > h3"),
      `${label}: phase label is pink`,
    ).toHaveCSS("color", pink);
    await expect(
      buildingGroup.locator(":scope > h3 > span"),
      `${label}: phase count is cyan`,
    ).toHaveCSS("color", cyan);
    await expect(
      w1Row.locator(".officina__value-mono"),
      `${label}: opus id is cyan`,
    ).toHaveCSS("color", cyan);
    await expect(
      w1Row.locator(":scope > span:nth-child(2)"),
      `${label}: title is secondary neutral`,
    ).toHaveCSS("color", ink2);
    await expect(
      w1Row.locator(".officina__work-note"),
      `${label}: mover note is tertiary neutral`,
    ).toHaveCSS("color", ink3);
    await expect(page.locator(".officina__work-row")).toHaveCount(4);
    await expectContained(page, label);
  }

  const slow = await page.context().newPage();
  await seedToken(slow, served);
  const slowFixtures = base();
  slowFixtures.opera = "pending";
  await installRoutes(slow, slowFixtures);
  await open(slow, 1280, "expanded", false);
  await expect(slow.locator(".panel--work")).toContainText("Loading work in flight…");
  await expect(slow.locator(".panel--work .officina__panel-heading")).toHaveCSS(
    "color",
    await tokenColour(slow, "--color-heading"),
  );
  await slow.close();

  const failed = await page.context().newPage();
  await seedToken(failed, served);
  const failedFixtures = base();
  failedFixtures.opera = "failed";
  await installRoutes(failed, failedFixtures);
  await open(failed, 1280, "expanded", false);
  await expect(failed.locator(".panel--work")).toContainText("Could not load work in flight.");
  await failed.close();
});
