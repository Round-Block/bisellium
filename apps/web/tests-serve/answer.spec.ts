/**
 * apps/web/tests-serve/answer.spec.ts — the proof of W-067: W-024's Inbox
 * answer button, a shipped, reviewed, `done` feature, works end to end
 * against a served build. Exact flow from the brief's Acceptance section:
 *
 *   1. open the console, paste the token `serve` printed
 *   2. open a pending petitio, type a reply, submit
 *   3. the request returns 200 with ok:true
 *   4. <tmp>/petitiones/<id>.md carries the reply, and
 *      <tmp>/timeline/patron.jsonl has one new role:"patron" line
 *   5. the Inbox refetches and the petitio is gone from the needs-you list
 *
 * If this test does not pass, the opus has not landed, whatever behaviours
 * 1-4 say.
 */
import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startServed, type ServedInstance } from "./harness.js";

function jsonlLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
}

test.describe("the answer button, end to end (W-067 acceptance)", () => {
  let served: ServedInstance;

  test.afterEach(async () => {
    await served?.close();
  });

  test("W-024's Inbox answer button writes through the served console", async ({ page }) => {
    served = await startServed("answer-acceptance");
    const timelinePath = join(served.studioDir, "timeline", "patron.jsonl");
    const linesBefore = jsonlLines(timelinePath).length;

    // 1. open the console, paste the token `serve` printed.
    await page.goto(served.baseURL);
    await expect(page.locator(".token-prompt")).toBeVisible();
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
    await expect(page.locator(".token-prompt")).toBeHidden();

    // examples/sample-studio has exactly one needs_you petitio (A-1) — A-2
    // is awaiting_reply, the Patron's own side, and stays off this list.
    await expect(page.locator(".inbox__row")).toHaveCount(1);
    const inboxBefore: { petitiones: { id: string; subject: string }[] } = await page.evaluate(() =>
      fetch("/api/inbox").then((r) => r.json()),
    );
    const target = inboxBefore.petitiones[0]!;

    // 2. open a pending petitio, type a reply, submit.
    await page.locator(".inbox__row").first().click();
    const reply = "approve: W-067 acceptance smoke";
    await page.locator(".inbox__input-ratio").fill(reply);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/answer") && r.request().method() === "POST"),
      // The button's accessible name carries its hotkey digit too ("1 approve").
      page.getByRole("button", { name: /approve/i }).click(),
    ]);

    // 3. the request returns 200 with ok:true.
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);

    // 4. the record and the timeline both carry the write.
    const petitioPath = join(served.studioDir, "petitiones", `${target.id}.md`);
    const petitioRaw = readFileSync(petitioPath, "utf8");
    expect(petitioRaw).toContain(reply);

    const linesAfter = jsonlLines(timelinePath);
    expect(linesAfter.length).toBe(linesBefore + 1);
    const newLine = JSON.parse(linesAfter[linesAfter.length - 1]!);
    expect(newLine.role).toBe("patron");
    expect(newLine.petitio).toBe(target.id);

    // 5. the Inbox refetches and the petitio is gone from the needs-you list.
    await expect(page.locator(".inbox__row")).toHaveCount(0);
    await expect(page.locator(".inbox__subject", { hasText: target.subject })).toHaveCount(0);
  });
});
