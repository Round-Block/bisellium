/**
 * apps/web/test/inboxview.test.ts — W-024 behaviours 4, 8 and 9: the
 * Inbox's presentational half, static-rendered against plain props with
 * `react-dom/server` (no fetch, no DOM, no keyboard simulation needed —
 * the keyboard/submit model itself is covered by inboxLogic.test.ts).
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InboxView, type InboxViewProps } from "../src/screens/InboxView.js";

(globalThis as { React?: unknown }).React = React;

const only = process.argv[2] ? Number(process.argv[2]) : undefined;

let failed = 0;
const check = (behaviour: number, name: string, ok: boolean, detail = "") => {
  if (only !== undefined && behaviour !== only) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
};

function baseProps(overrides: Partial<InboxViewProps> = {}): InboxViewProps {
  return {
    petitiones: [],
    opera: [],
    focusIndex: 0,
    expandedId: null,
    reason: "",
    onReasonChange: () => undefined,
    onFocusChange: () => undefined,
    onExpandChange: () => undefined,
    onSubmit: () => undefined,
    ...overrides,
  };
}

const render = (props: InboxViewProps): string => renderToStaticMarkup(createElement(InboxView, props));

// behaviour 9: empty state is one line, no other content.
{
  const html = render(baseProps());
  check(9, "empty state shows 'Nothing waiting on you'", html.includes("Nothing waiting on you"), html);
  check(9, "empty state renders nothing else", !html.includes("<button"), html);
}

// behaviour 4: a petitio row has subject at 13/18 and sella id in mono 12,
// with neutral selection and a separate reading pane.
{
  const petitiones = [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask for a decision", body: "Full proposal content here." }];
  const html = render(baseProps({ petitiones, expandedId: "P-1" }));
  check(4, "petitio row renders", html.includes("inbox__row"), html);
  check(4, "petitio row carries no amber attention class", !html.includes("inbox__item--attention") && !html.includes("inbox__row--attention"), html);
  check(4, "subject renders at 13/18", html.includes('class="inbox__subject"'), html);
  check(4, "sella id renders in mono 12", html.includes('class="inbox__sella"'), html);
  check(4, "subject text is present", html.includes("ask for a decision"), html);
  check(4, "sella id text is present", html.includes("builder-a"), html);
  check(4, "expanded subject repeats in full before the ask", html.indexOf('class="inbox__expanded-subject"') < html.indexOf('class="inbox__ask"') && html.includes('class="inbox__expanded-subject">ask for a decision</h2>'), html);
  check(4, "selected reading pane shows body content", html.includes('class="inbox__reading-pane"') && html.includes("Full proposal content here."), html);

  // W-076 behaviour 4: the placeholder branch still renders on body: ""
  // (land 4 makes `body` required — the server now always sends it, but
  // an empty string, not undefined, must still fall through to the
  // placeholder). Already correct — InboxView.tsx is not owned by W-076 —
  // so this is a regression-safety assertion, not a red: it holds today.
  const emptyBodyPetitiones = [{ id: "P-2", opus: "W-024", from: "builder-a", subject: "ask", body: "" }];
  const emptyBodyHtml = render(baseProps({ petitiones: emptyBodyPetitiones, focusIndex: 0, expandedId: "P-2" }));
  check(4, "the placeholder still renders for body: \"\" (W-076)", emptyBodyHtml.includes("No content provided."), emptyBodyHtml);
}

// behaviour 10: rows have onClick for focus change
{
  const petitiones = [
    { id: "P-1", opus: "W-024", from: "builder-a", subject: "first", body: "" },
    { id: "P-2", opus: "W-025", from: "censor", subject: "second", body: "" },
  ];
  const html = render(baseProps({ petitiones, onFocusChange: () => undefined }));
  check(10, "rows are clickable (have onClick via native buttons)", (html.match(/<button[^>]*inbox__row/g) ?? []).length === 2, html);
}

// behaviour 8: detail pane shows verb buttons; disabled until a non-empty reason.
{
  const petitiones = [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask", body: "" }];
  const noReason = render(baseProps({ petitiones, expandedId: "P-1", reason: "" }));
  check(8, "expansion shows the four ruled verb buttons", (noReason.match(/class="inbox__btn-action"/g) ?? []).length === 4, noReason);
  check(8, "with no reason: all verb buttons disabled", (noReason.match(/class="inbox__btn-action" disabled/g) ?? []).length === 4, noReason);

  const withReason = render(baseProps({ petitiones, expandedId: "P-1", reason: "looks good" }));
  check(8, "with a reason: only delegate remains disabled", (withReason.match(/disabled/g) ?? []).length === 1, withReason);
  check(8, "approve, defer, decline and delegate are offered", ["approve", "defer", "decline", "delegate"].every((v) => withReason.includes(`>${v}<`)), withReason);
  check(8, "delegate has a visible associated explanation", /aria-describedby="delegate-unavailable-P-1"[^>]*>delegate<\/button><\/div><p id="delegate-unavailable-P-1" class="inbox__delegate-note">Delegation is not available yet<\/p>/.test(withReason), withReason);
  check(8, "navigation shortcuts are printed below the controls", withReason.includes('class="inbox__nav-hint">j/k move · Esc back</p>'), withReason);
}

process.exit(failed ? 1 : 0);
