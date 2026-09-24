/**
 * apps/web/test/sidebar.test.ts — W-065 behaviour 2: the side panel carries
 * D-023 §1's four entries (Inbox, Board, Seats, Officina) in that order;
 * exactly one carries the active class per route, the one whose href
 * matches; the needs-you badge rule (W-025 behaviour 8) is unchanged.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "../src/components/Sidebar.js";

const only = process.argv[2] ? Number(process.argv[2]) : undefined;

let failed = 0;
const check = (behaviour: number, name: string, ok: boolean, detail = "") => {
  if (only !== undefined && behaviour !== only) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
};

const ROUTES = ["inbox", "board", "seats", "officina"] as const;
const HREFS = ["#/inbox", "#/board", "#/seats", "#/officina"];

// behaviour 2: the four entries, in D-023 §1's order.
{
  const html = renderToStaticMarkup(Sidebar({ route: "inbox", needsYouCount: 0 }));
  const order = HREFS.filter((h) => html.includes(`href="${h}"`)).map((h) => html.indexOf(`href="${h}"`));
  const sorted = [...order].sort((a, b) => a - b);
  check(2, "sidebar: all four hrefs present", HREFS.every((h) => html.includes(`href="${h}"`)), html);
  check(2, "sidebar: entries appear in D-023 §1's order (Inbox, Board, Seats, Officina)", JSON.stringify(order) === JSON.stringify(sorted), JSON.stringify(order));
}

// behaviour 2: exactly one active entry per route, the one whose href matches.
for (const route of ROUTES) {
  const html = renderToStaticMarkup(Sidebar({ route, needsYouCount: 0 }));
  const activeHrefs = HREFS.filter((h) => {
    const re = new RegExp(`<a[^>]*href="${h}"[^>]*class="[^"]*sidebar__link--active[^"]*"|class="[^"]*sidebar__link--active[^"]*"[^>]*href="${h}"`);
    return re.test(html);
  });
  check(2, `sidebar: route "${route}" — exactly one active entry`, activeHrefs.length === 1, JSON.stringify(activeHrefs));
  check(2, `sidebar: route "${route}" — the active entry is #/${route}`, activeHrefs[0] === `#/${route}`, activeHrefs[0]);
}

// W-025 behaviour 8 (unchanged): needs-you badge visible only when count > 0.
{
  const withBadge = renderToStaticMarkup(Sidebar({ route: "inbox", needsYouCount: 3 }));
  const withoutBadge = renderToStaticMarkup(Sidebar({ route: "inbox", needsYouCount: 0 }));
  check(2, "sidebar: needs-you badge shown when count > 0", withBadge.includes("sidebar__badge"), withBadge);
  check(2, "sidebar: needs-you badge hidden when count is 0", !withoutBadge.includes("sidebar__badge"), withoutBadge);
}

process.exit(failed ? 1 : 0);
