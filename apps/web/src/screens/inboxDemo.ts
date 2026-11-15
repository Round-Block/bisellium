/**
 * apps/web/src/screens/inboxDemo.ts — W-280. The Inbox's `?demo` fixtures, invented petitions: a vite-dev aid
 * (`npm run dev`, apps/web/tests/smoke.spec.ts) and the served specs' route fixture (tests-serve/inbox-demo.ts).
 * The console `bisellium serve` serves (a production build) never shows them.
 */
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../api.js";

export const DEV_DATA: InboxResponse = {
  opera: [],
  petitiones: [
    {
      id: "P-008", opus: "W-026", from: "architect",
      opened: Date.UTC(2026, 9, 27, 8),
      subject: "Approve the Outlook-style Inbox decision layout",
      body: "The Inbox now keeps the needs-you list beside an independently scrolling reading pane on wide screens, then changes to list and full-screen detail navigation below 840px. Review the [design direction](docs/design/DIRECTION.md) and [served evidence](https://example.test/W-407). Recommend approval.",
    },
    {
      id: "P-009", opus: "W-024", from: "builder-a",
      opened: Date.UTC(2026, 9, 25, 8),
      subject: "Review inbox keyboard navigation edge case",
      body: "When the inbox has exactly one petitio and the user presses 'k' (move up), focusIndex wraps to -1 on the next render before the clamp in moveFocus catches it. This causes a brief flash of no-selection state. Proposed fix: clamp focusIndex to [0, length-1] inside the state setter callback rather than in moveFocus. The fix is two lines in Inbox.tsx. No test changes needed — the existing inboxLogic tests already cover the boundary, but the React state update order wasn't exercised.",
    },
    {
      id: "P-010", opus: "W-025", from: "censor",
      opened: Date.UTC(2026, 9, 20, 8),
      subject: "Confirm gate-ladder mark alignment at 3px gaps",
      body: "QA found that gate-ladder marks render at 3px height with a 2px border-radius, which on non-retina displays can produce a visible rounding artifact — the bottom-left pixel appears clipped. This only affects the half-height variant (waived gates). Options: (A) reduce border-radius to 1px for half-height marks only, (B) increase mark height to 4px, or (C) accept the artifact as imperceptible at normal zoom. Recommending option A — smallest change, no layout shift.",
    },
  ],
};

export const DEV_OFFICINA: Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit"> = {
  lifecycle: { id: "opus", states: [{ id: "greenlit", name: "Greenlit", phase: "planned" }] },
  probationes: [],
};
export const DEV_OPERA: OpusEntry[] = DEV_DATA.petitiones.map((petitio) => ({
  id: petitio.opus!, title: petitio.subject, body: "", kind: "ui", collegium: "design", sella: petitio.from,
  state: "greenlit", tokens: 0, probationes: {}, traditio: undefined,
}));
