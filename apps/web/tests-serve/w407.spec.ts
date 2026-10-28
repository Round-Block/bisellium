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

test("W-407-b2 reading strips Markdown syntax, separates evidence, and rows stay neutral and divided", async ({ page }) => {
  const longSubject = "S".repeat(180);
  const petitiones = [
    { id: "P-long", opus: "W-407", from: "ui-lead", opened: Date.UTC(2026, 9, 27, 8), subject: longSubject, body: "" },
    { id: "P-links", opus: "W-406", from: "architect", opened: Date.UTC(2026, 9, 25, 8), subject: "Evidence forms", body: "Read [https](https://example.test/e) and [http](http://example.test/e). Compare [hash](#evidence), [dot](./evidence.md), [parent](../evidence.md), [docs](docs/evidence.md), [studio](studio/evidence.md), [ci](ci/evidence.log), [opus](opera/W-407.md), and [petition](petitiones/P-1.md).\n\n- Alpha\n- Beta\n\n1. First\n2) Second\n\n<script>window.bad = true</script>" },
    { id: "P-old", opus: "W-415", from: "producer", opened: Date.UTC(2026, 9, 20, 8), subject: "Old decision", body: "Age escalates by weight only." },
  ];
  await page.route("**/api/inbox", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones }) }));
  await openInbox(page, 1280, "w407-b2", false);

  for (const width of [1280, 640, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    const items = page.locator(".inbox__item");
    await expect(items).toHaveCount(3);
    for (const item of await items.all()) {
      expect((await item.boundingBox())!.height, `${width}: every row has two Outlook lines, padding and divider`).toBeCloseTo(68, 0);
      await expect(item).toHaveCSS("border-bottom-width", "1px");
      await expect(item).toHaveCSS("border-left-width", "2px");
    }
    const dates = page.locator(".inbox__item .inbox__date");
    expect(new Set(await dates.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color))).size, "date never changes colour").toBe(1);
    await expect(dates).toHaveText(["27 Oct", "25 Oct", "20 Oct"]);
    const collapsedSubject = items.first().locator(".inbox__subject");
    expect(await collapsedSubject.evaluate((node) => getComputedStyle(node).webkitLineClamp), `${width}: collapsed subject is capped at two lines`).toBe("2");
    expect((await collapsedSubject.boundingBox())!.height, `${width}: collapsed subject never exceeds two text lines`).toBeLessThanOrEqual(36);
    if (width < 840) await items.first().click();
    await expect(page.locator(".inbox__expanded-subject")).toHaveText(longSubject);
    await expect(page.locator(".inbox__ask")).toHaveText("No content provided.");
    const fullSubject = await page.locator(".inbox__expanded-subject").evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }));
    expect(fullSubject.scrollWidth, `${width}: full subject is not clipped horizontally`).toBeLessThanOrEqual(fullSubject.clientWidth + 1);
    expect(fullSubject.scrollHeight, `${width}: full subject is not clipped vertically`).toBeLessThanOrEqual(fullSubject.clientHeight + 1);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole("option").nth(1).click();
  const ask = page.locator(".inbox__ask");
  await expect(ask).not.toContainText("[https](");
  await expect(ask).toContainText("Read https and http.");
  await expect(ask.locator("a")).toHaveCount(0);
  await expect(ask.locator("ul > li")).toHaveText(["Alpha", "Beta"]);
  await expect(ask.locator("ol > li")).toHaveText(["First", "Second"]);
  await expect(ask.locator("script")).toHaveCount(0);
  await expect(ask).toContainText("<script>window.bad = true</script>");
  const anchors = page.locator(".inbox__evidence a");
  await expect(anchors).toHaveCount(2);
  expect(await anchors.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).toEqual(["https://example.test/e", "http://example.test/e"]);
  const unavailable = page.locator(".inbox__evidence-unavailable");
  await expect(unavailable).toHaveCount(8);
  await expect(unavailable.first()).toContainText("#evidence — Not available in this console");
});

test("W-407-b3 roving selection reveals nearest, reconciles answers, and phone Back or Escape restores focus", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions): void {
      (window as unknown as { __w407Reveal?: ScrollIntoViewOptions }).__w407Reveal = typeof options === "object" ? options : undefined;
      nativeScrollIntoView.call(this, options);
    };
  });
  await page.clock.setFixedTime(new Date(FIXED_NOW));

  for (const width of [1280, 390]) {
    const writes: { petitio: string; reply: string }[] = [];
    let remaining = [...MANY_RESPONSE];
    await page.unroute("**/api/inbox");
    await page.route("**/api/inbox", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones: remaining }) }));
    await page.unroute("**/api/answer");
    await page.route("**/api/answer", (route) => {
      const body = route.request().postDataJSON() as { petitio: string; reply: string };
      writes.push(body);
      remaining = remaining.filter(({ id }) => id !== body.petitio);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, output: "recorded" }) });
    });
    await openInbox(page, width, `w407-b3-${width}`, false);
    const items = page.locator(".inbox__item");
    const list = page.locator(".inbox__list-pane");
    await expect(items).toHaveCount(14);
    await expect(page.locator(".inbox__item--unread")).toHaveCount(width === 1280 ? 13 : 14);
    await items.first().focus();
    await expect(items.first()).toHaveCSS("outline-width", "0px");
    expect(await items.first().evaluate((node) => getComputedStyle(node).boxShadow), `${width}: focus adds neither underline nor row box`).toBe("none");
    await expect(items.locator(".inbox__subject")).toHaveText(MANY_ORDER.map((id) => `Decision ${id}`));
    await expect(items.locator(".inbox__date")).toHaveText(MANY_DATES);
    await expect(page.locator(".inbox__position")).toHaveCount(0);
    const before = await list.evaluate((node) => node.scrollTop);
    for (let step = 0; step < 6; step++) await page.keyboard.press("j");
    await expect(items.nth(6)).toBeFocused();
    await expect(items.nth(6).locator(".inbox__subject")).toHaveText("Decision P-09");
    expect(await page.evaluate(() => (window as unknown as { __w407Reveal?: ScrollIntoViewOptions }).__w407Reveal)).toEqual({ block: "nearest" });
    const selectedInsideList = await items.nth(6).evaluate((node) => {
      const row = node.getBoundingClientRect();
      const pane = node.closest(".inbox__list-pane")!.getBoundingClientRect();
      return row.top >= pane.top && row.bottom <= pane.bottom;
    });
    expect(selectedInsideList, `${width}: nearest reveal keeps the selected row visible`).toBe(true);
    expect(await list.evaluate((node) => node.scrollTop), `${width}: j×6 does not slide a queue whose selected row was already visible`).toBe(before);

    if (width === 390) {
      await expect(page.locator(".inbox__reading-pane")).toBeHidden();
      await page.keyboard.press("Enter");
      await expect(page.locator(".inbox__reading-pane")).toBeVisible();
    }
    await expect(items.nth(6)).not.toHaveClass(/inbox__item--unread/);
    await expect(page.locator(".inbox__expanded-subject")).toHaveText("Decision P-09");
    const ratio = page.locator(".inbox__input-ratio");
    await ratio.fill("middle reason");
    await page.getByRole("button", { name: /approve/i }).click();
    await expect(items).toHaveCount(13);
    await expect(items.nth(6)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".inbox__expanded-subject")).toHaveText("Decision P-14");
    await expect(ratio).toHaveValue("");

    if (width === 390) {
      await page.keyboard.press("Escape");
      await expect(list).toBeVisible();
      await expect(items.nth(6)).toBeFocused();
      await items.nth(6).click();
      await expect(page.getByRole("button", { name: "Back to Inbox" })).toBeVisible();
      await page.getByRole("button", { name: "Back to Inbox" }).click();
      await expect(items.nth(6)).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await ratio.fill("next reason");
    if (width === 390) await page.getByRole("button", { name: "Back to Inbox" }).focus();
    else await items.nth(6).focus();
    await page.keyboard.press("1");
    await expect.poll(() => writes.length).toBe(2);
    expect(writes).toEqual([
      { petitio: "P-09", reply: "approve: middle reason" },
      { petitio: "P-14", reply: "approve: next reason" },
    ]);
    await served!.close(); served = undefined;
  }

  for (const width of [640, 390]) {
    await openInbox(page, width, `w407-b3-overlay-${width}`);
    await page.getByRole("option").first().click();
    const subject = await page.locator(".inbox__expanded-subject").textContent();
    const toggle = page.locator(".sidebar__toggle");
    await toggle.click();
    await expect(page.locator('.sidebar__link[href="#/inbox"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(page.locator(".inbox__expanded-subject"), `${width}: sidebar Escape does not close Inbox detail`).toHaveText(subject ?? "");
    await served!.close(); served = undefined;
  }

  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("denied"); };
    Storage.prototype.setItem = () => { throw new DOMException("denied"); };
  });
  await openInbox(page, 1280, "w407-b3-storage-denied");
  await expect(page.locator(".inbox__item--unread")).toHaveCount(3);
});

test("W-407-b4 keys 1/2/3 keep approve, defer and decline answer bodies while delegate stays honest", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/api/answer", async (route) => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, output: "recorded" }) });
  });
  await openInbox(page, 1280, "w407-b4");
  await expect(page.getByText("Ratio decidendi", { exact: true })).toBeVisible();
  const ratio = page.locator(".inbox__input-ratio");
  for (const [index, verb] of (["approve", "defer", "decline"] as const).entries()) {
    await ratio.fill(`${verb} because`);
    await page.getByRole("option").first().focus();
    await page.keyboard.press(String(index + 1));
    await expect.poll(() => writes.length).toBe(index + 1);
    await expect(ratio).toHaveValue("");
  }
  expect(writes).toEqual([
    { petitio: "P-008", reply: "approve: approve because" },
    { petitio: "P-008", reply: "defer: defer because", askBack: true },
    { petitio: "P-008", reply: "decline: decline because" },
  ]);
  const delegate = page.getByRole("button", { name: "delegate" });
  await expect(delegate).toBeDisabled();
  const note = page.getByText("Delegation is not available yet", { exact: true });
  await expect(note).toBeVisible();
  await expect(delegate).toHaveAttribute("aria-describedby", await note.getAttribute("id") ?? "missing-description");
});

test("W-407-b5 secondary groups are non-interactive labels and empty Inbox has no generated stamp", async ({ page }) => {
  await openInbox(page, 1280, "w407-b5-groups");
  const groups = page.locator(".inbox__secondary p");
  await expect(groups).toHaveText(["You asked Not available yet", "For information Not available yet"]);
  await expect(page.locator(".inbox__secondary details, .inbox__secondary button")).toHaveCount(0);
  await served!.close(); served = undefined;

  await page.route("**/api/inbox", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones: [] }) }));
  await openInbox(page, 1280, "w407-b5-empty", false);
  await expect(page.locator(".inbox__empty")).toHaveText("Nothing waiting on you");
  await expect(page.locator(".inbox__queue, .inbox__secondary, .inbox__position")).toHaveCount(0);
  await expect(page.locator(".inbox > footer")).toHaveCount(0);
  await expect(page.locator(".inbox")).not.toContainText("/tmp/studio");
  await expect(page.locator(".inbox")).not.toContainText(/as of|generated/i);
});

test("W-407-b6 refresh failure and removed selection preserve the decision in progress", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __w407Visible: boolean }).__w407Visible = true;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (window as unknown as { __w407Visible: boolean }).__w407Visible ? "visible" : "hidden",
    });
  });
  await page.clock.install({ time: new Date(FIXED_NOW) });
  for (const width of [1280, 390]) {
    let reads = 0;
    let failNext = false;
    let response = [...MANY_RESPONSE];
    await page.unroute("**/api/inbox");
    await page.route("**/api/inbox", (route) => {
      reads += 1;
      if (failNext) {
        failNext = false;
        return route.abort("failed");
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opera: [], petitiones: response }) });
    });
    await openInbox(page, width, `w407-b6-${width}`, false);
    await expect.poll(() => reads).toBe(1);
    const items = page.locator(".inbox__item");
    const list = page.locator(".inbox__list-pane");
    await items.nth(6).click();
    const target = await list.evaluate((node) => {
      node.scrollTop = Math.min(220, node.scrollHeight - node.clientHeight - 40);
      return node.scrollTop;
    });
    // below 840px the list is hidden behind the detail, so only the wide layout has a reader position to keep
    if (width === 1280) expect(target, `${width}: the list scrolls without a notice`).toBeGreaterThan(0);
    const ratio = page.locator(".inbox__input-ratio");
    await ratio.fill("half-typed ratio");
    const scrollBefore = await list.evaluate((node) => node.scrollTop);
    expect(scrollBefore, `${width}: the position is the one set`).toBe(target);
    // what the reader sees: the selected row's top within the list pane (null while the list is hidden behind the detail)
    const rowTop = async (): Promise<number | null> => {
      const [row, pane] = await Promise.all([items.nth(6).boundingBox(), list.boundingBox()]);
      return row === null || pane === null ? null : row.y - pane.y;
    };
    const topBefore = await rowTop();
    const sameTop = async (when: string): Promise<void> => {
      const top = await rowTop();
      if (topBefore === null || top === null) return;
      expect(Math.abs(top - topBefore), `${width}: ${when} keeps the selected row where the reader sees it`).toBeLessThanOrEqual(1);
    };
    failNext = true;
    await page.clock.fastForward(30_000);
    await expect.poll(() => reads).toBe(2);
    const selectedSubject = await page.locator(".inbox__expanded-subject").textContent();

    await expect(page.locator(".inbox__list-pane .screen-notice")).toHaveText("Could not load the inbox.");
    await expect(page.locator(".inbox__reading-pane .screen-notice")).toHaveText("Could not load the inbox.");
    await expect(items).toHaveCount(14);
    await expect(items.nth(6)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".inbox__expanded-subject")).toHaveText(selectedSubject ?? "");
    await expect(ratio).toHaveValue("half-typed ratio");
    await expect(ratio).toBeFocused();
    await sameTop("failure");

    await page.clock.fastForward(30_000);
    await expect.poll(() => reads).toBe(3);
    await expect(page.locator(".screen-notice")).toHaveCount(0);
    await expect(items.nth(6)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".inbox__expanded-subject")).toHaveText(selectedSubject ?? "");
    await expect(ratio).toHaveValue("half-typed ratio");
    await expect(ratio).toBeFocused();
    await sameTop("recovery");

    response = response.filter(({ id }) => id !== "P-09").concat({ id: "P-new", opus: "W-408", from: "architect", opened: Date.UTC(2026, 9, 28, 9), subject: "Newly arrived decision", body: "New work." });
    await page.clock.fastForward(30_000);
    await expect.poll(() => reads).toBe(4);
    await expect(items).toHaveCount(14);
    await expect(items.filter({ hasText: "Newly arrived decision" })).toHaveClass(/inbox__item--unread/);
    await expect(page.locator('.inbox__item[aria-selected="true"]')).toHaveCount(0);
    await expect(page.locator(".inbox__expanded-subject")).toHaveText("Decision P-09");
    await expect(page.locator(".inbox__withdrawn")).toHaveText("This petitio no longer needs a decision.");
    await expect(ratio).toHaveValue("half-typed ratio");
    await expect(ratio).toBeFocused();
    for (const name of ["approve", "defer", "decline"]) await expect(page.getByRole("button", { name: new RegExp(name, "i") })).toBeDisabled();
    expect(await list.evaluate((node) => node.scrollTop), `${width}: removal preserves list scroll`).toBe(scrollBefore);

    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => reads).toBe(5);
    expect(reads, `${width}: simultaneous tab-return events coalesce`).toBe(5);

    if (width === 390) await page.getByRole("button", { name: "Back to Inbox" }).click();
    await items.first().click();
    await expect(page.locator(".inbox__expanded-subject")).toHaveText("Decision P-03");
    await ratio.fill("sole draft");
    response = response.filter(({ id }) => id === "P-03");
    await page.clock.fastForward(30_000);
    await expect.poll(() => reads).toBe(6);
    response = [];
    await page.clock.fastForward(30_000);
    await expect.poll(() => reads).toBe(7);
    await expect(page.locator(".inbox__empty")).toHaveText("Nothing waiting on you");
    await expect(page.locator(".inbox__expanded-subject, .inbox__withdrawn")).toHaveCount(0);
    response = [{ id: "P-03", opus: "W-407", from: "builder-a", opened: Date.UTC(2026, 9, 17, 10, 30), subject: "Decision P-03", body: "Ask for P-03." }];
    await page.clock.fastForward(30_000);
    await expect.poll(() => reads).toBe(8);
    await expect(page.locator(".inbox__expanded-subject")).toHaveText("Decision P-03");
    await expect(ratio).toHaveValue("sole draft");

    await served!.close(); served = undefined;
  }
});
