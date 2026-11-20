process.env["NODE_ENV"] = "test";

import { expect, test } from "@playwright/test";
import { seedToken, startServed, type ServedInstance } from "./harness.js";

let served: ServedInstance | undefined;

test.afterEach(async () => {
  await served?.close();
  served = undefined;
});

const MANY = {
  meter: {
    overall: 60,
    rows: [
      { id: "M1", title: "Build process", weight: 10, done: 2, planned: 3, met: false, pct: 66.67 },
      { id: "M2", title: "Records you can trust", weight: 15, done: 1, planned: 2, met: true, pct: 100 },
    ],
  },
  estimate: { kind: "none", line: "No estimate" },
};

test("W-504-b1 Completion renders exact milestone units and labels", async ({ page }) => {
  served = await startServed("w504-b1");
  await seedToken(page, served);
  await page.route("**/api/completion", (route) => route.fulfill({ json: MANY }));
  await page.goto(`${served.baseURL}/#/home`);
  await expect(page, "b1 opens the canonical Home route").toHaveURL(`${served.baseURL}/#/home`);
  await expect(page.getByRole("heading", { name: "Home", exact: true }), "b1 reaches Home before checking Completion").toBeVisible();
  await expect(page.getByRole("heading", { name: "Completion", exact: true }), "Completion joins Home after the existing W-503 rows").toBeVisible();
  await expect(page.locator(".home-completion__overall"), "the served overall value is named").toHaveText("60%");
  await expect(page.locator(".home-completion__group"), "every served milestone has one labelled group").toHaveCount(2);
  await expect(page.locator(".home-completion__group h3"), "milestone titles remain plain English").toHaveText(["Build process", "Records you can trust"]);
  await expect(page.locator(".home-completion__unit"), "one unit renders for every planned item").toHaveCount(5);
  await expect(page.locator(".home-completion__unit--done"), "only done items use the filled unit").toHaveCount(3);
  await expect(page.locator(".home-completion__count"), "exact done and planned labels remain visible").toHaveText(["2 of 3 done", "1 of 2 done"]);
});
