/**
 * apps/web/tests-serve/inbox-demo.ts — W-280. The served console never honours `?demo` (a vite-dev aid), so a served
 * spec that needs the Inbox's demo petitions gets them from this route fixture: the same records
 * (src/screens/inboxDemo.ts) answered for `/api/opera` and `/api/inbox`, while `/api/officina` stays the served
 * studio's. Not a spec. Call it before the page's first read.
 */
import type { Page } from "@playwright/test";
import { DEV_DATA, DEV_OPERA } from "../src/screens/inboxDemo.js";

export async function routeInboxDemo(page: Page): Promise<void> {
  await page.route("**/api/opera", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DEV_OPERA) }));
  await page.route("**/api/inbox*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DEV_DATA) }));
}
