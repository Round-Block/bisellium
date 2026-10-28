import { expect, test, type Page } from "@playwright/test";
import { startServed, type ServedInstance } from "./harness.js";

test.setTimeout(120_000);
let served: ServedInstance | undefined;
test.afterEach(async () => { await served?.close(); served = undefined; });
const FIXED_NOW = "2026-10-27T10:30:00.000Z";

async function openInbox(page: Page, width: number, tag: string, demo = true): Promise<void> {
  served = await startServed(tag, { now: FIXED_NOW });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${served.baseURL}/${demo ? "?demo" : ""}#/inbox`);
  await page.locator("#token-prompt-input").fill(served.token);
  await page.locator(".token-prompt__submit").click();
  await expect(page.locator(".token-prompt")).toBeHidden();
}

const LONG_ASK = [
  "The Inbox currently asks the Patron to understand a decision while the list, reading text and controls compete for one vertical flow. This revision follows Outlook: the needs-you queue remains visible beside a dedicated reading pane on a wide screen, while a narrow screen begins with the list and opens one decision into a full-screen view. Please judge whether that model makes the waiting work easier to scan without weakening the requirement to record a reason.",
  "The wide view gives the list a stable 320-pixel home and lets the reading pane use the remaining width. Each pane owns its vertical scrollbar, so reading this request cannot move the selected row or erase its neighbours from view. At 640 and 390 pixels there is not enough room for two legible panes. Those widths therefore show the queue first; click or Enter opens the selected decision, and Back or Escape returns to the same focused row.",
  ["Review checklist:", "- confirm the oldest item remains first", "- verify the selected tint and keyboard focus are distinct", "- scroll this reading pane and confirm the list stays still", "- inspect Back and Escape at 640 and 390", "- record the ratio decidendi before choosing a verb", "", "Decision order:", "1. read the complete ask", "2. inspect the evidence", "3. record the ratio decidendi"].join("\n"),
  "Rows deliberately carry no amber. Every row in this queue already waits on the Patron, so repeating the sidebar's amber attention cue on fourteen identical rows communicates no extra fact. Ages stay neutral and become heavier after three days. Severity colours are not inferred from age, author or wording; they need an authoritative field and a separate opus. Hairline dividers and measured padding provide the visual separation instead.",
  "The evidence is split between the [served review](https://example.test/W-407/review) and the [repository notes](docs/design/DIRECTION.md). The served review must remain an actionable link. The repository path must remain selectable and show its literal target with “Not available in this console”, because this console has no repository-file route. In the ask itself, both Markdown forms should read only as “served review” and “repository notes”; raw brackets and targets must not be duplicated in the prose.",
  "Approval keeps the existing answer record shape and accepts the 840-pixel boundary, independent scroll panes, neutral rows and mobile Back model. Deferral uses the existing ask-back record if more evidence is needed. Decline should name the specific interaction that fails. Delegate remains visible but disabled because the current delegate route changes seat configuration rather than this petitio. Whatever the verdict, the ratio decidendi is the durable review output.",
  "Also inspect the end of this text rather than judging only the first screenful. The ratio field, approve/defer/decline controls, unavailable delegate note and printed keyboard hint must remain reachable after scrolling. Returning to the list must preserve selection and draft ownership. Answering this item must reconcile to the next row at the same index and must never reuse this item's draft for that neighbour.",
].join("\n\n");

const MANY_ORDER = ["P-03", "P-11", "P-12", "P-06", "P-07", "P-13", "P-09", "P-14", "P-08", "P-05", "P-10", "P-01", "P-02", "P-04"];
const MANY_DATES = ["17 Oct", "19 Oct", "21 Oct", "22 Oct", "22 Oct", "23 Oct", "24 Oct", "25 Oct", "26 Oct", "27 Oct", "27 Oct", "27 Oct", "Date unavailable", "Date unavailable"];
const MANY_RESPONSE = [
  { id: "P-03", from: "builder-a", opened: Date.UTC(2026, 9, 17, 10, 30) },
  { id: "P-11", from: "censor", opened: Date.UTC(2026, 9, 19, 10, 30) },
  { id: "P-12", from: "producer", opened: Date.UTC(2026, 9, 21, 10, 30) },
  { id: "P-06", from: "qa-lead", opened: Date.UTC(2026, 9, 22, 10, 30) },
  { id: "P-07", from: "eng-lead", opened: Date.UTC(2026, 9, 22, 10, 30) },
  { id: "P-13", from: "qa-lead", opened: Date.UTC(2026, 9, 23, 10, 30) },
  { id: "P-09", from: "architect", opened: Date.UTC(2026, 9, 24, 10, 30) },
  { id: "P-14", from: "eng-lead", opened: Date.UTC(2026, 9, 25, 10, 30) },
  { id: "P-08", from: "ui-lead", opened: Date.UTC(2026, 9, 26, 10, 30) },
  { id: "P-05", from: "producer", opened: Date.UTC(2026, 9, 27, 8, 30) },
  { id: "P-10", from: "builder-a", opened: Date.UTC(2026, 9, 27, 9, 47) },
  { id: "P-01", from: "ui-lead", opened: Date.UTC(2026, 9, 27, 10, 18) },
  { id: "P-02", from: "architect" },
  { id: "P-04", from: "censor" },
].map((petitio) => ({
  ...petitio,
  opus: "W-407",
  subject: `Decision ${petitio.id}`,
  body: petitio.id === "P-08" ? LONG_ASK : `Ask for ${petitio.id}.`,
}));

test("W-407-b1 Outlook split keeps independent panes wide and replaces list with detail below 840px", async ({ page }) => {
  const petitiones = [{ id: "P-long", opus: "W-407", from: "ui-lead", opened: Date.UTC(2026, 9, 20), subject: "Long decision", body: LONG_ASK }];
  await page.route("**/api/inbox", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones }) }));
  await openInbox(page, 1280, "w407-b1", false);
  expect(LONG_ASK.length).toBeGreaterThanOrEqual(2_400);
  expect(LONG_ASK.length).toBeLessThanOrEqual(3_200);

  for (const width of [1280, 640, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(page.locator(".inbox__queue")).toBeVisible();
    const list = page.locator(".inbox__list-pane");
    const reading = page.locator(".inbox__reading-pane");
    const readingScroll = page.locator(".inbox__reading-scroll");
    await expect(list).toHaveCSS("overflow-y", "scroll");
    if (width === 1280) {
      await expect(reading).toBeVisible();
      await expect(reading).toHaveCSS("overflow-y", "hidden");
      await expect(readingScroll).toHaveCSS("overflow-y", "scroll");
      await expect(readingScroll).toHaveCSS("scrollbar-width", "auto");
      expect(await readingScroll.evaluate((node) => getComputedStyle(node, "::-webkit-scrollbar").width)).toBe("10px");
      const [listBox, readingBox] = await Promise.all([list.boundingBox(), reading.boundingBox()]);
      expect(listBox!.x + listBox!.width, "wide list ends where reading begins").toBeCloseTo(readingBox!.x, 0);
      expect(listBox!.width, "wide decision list retains the ruled Outlook width").toBeCloseTo(320, 0);
      const listBefore = await list.evaluate((node) => node.scrollTop);
      const action = page.locator(".inbox__action-bar");
      const actionBefore = await action.boundingBox();
      await readingScroll.evaluate((node) => node.scrollTo({ top: node.scrollHeight / 2, behavior: "instant" }));
      expect(await readingScroll.evaluate((node) => node.scrollTop), "long reading content scrolls above its action bar").toBeGreaterThan(0);
      const actionAfter = await action.boundingBox();
      expect(actionAfter!.y, "action bar remains pinned while prose scrolls").toBeCloseTo(actionBefore!.y, 0);
      expect(actionAfter!.y + actionAfter!.height, "action bar remains visible at the pane bottom").toBeLessThanOrEqual(900);
      expect(await list.evaluate((node) => node.scrollTop), "reading scroll leaves the list still").toBe(listBefore);
    } else {
      await expect(reading).toBeHidden();
      await page.getByRole("option").first().click();
      await expect(reading, `${width}: opening replaces the list with a full-screen reading view`).toBeVisible();
      await expect(readingScroll).toHaveCSS("overflow-y", "scroll");
      const action = page.locator(".inbox__action-bar");
      const actionBefore = await action.boundingBox();
      await readingScroll.evaluate((node) => node.scrollTo({ top: node.scrollHeight / 2, behavior: "instant" }));
      expect((await action.boundingBox())!.y, `${width}: the mobile action bar stays pinned`).toBeCloseTo(actionBefore!.y, 0);
      await expect(list).toBeHidden();
      await expect(page.getByRole("button", { name: "Back to Inbox" })).toBeVisible();
      await page.getByRole("button", { name: "Back to Inbox" }).click();
      await expect(list).toBeVisible();
      await expect(page.getByRole("option").first()).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}: no horizontal overflow`).toBeLessThanOrEqual(0);
  }
});
