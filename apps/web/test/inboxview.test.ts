/**
 * apps/web/test/inboxview.test.ts — W-024 behaviours 4, 8 and 9: the
 * Inbox's presentational half, static-rendered against plain props with
 * `react-dom/server` (no fetch, no DOM, no keyboard simulation needed —
 * the keyboard/submit model itself is covered by inboxLogic.test.ts).
 *
 * An optional behaviour number as `process.argv[2]` (`bisellium red`'s
 * one-behaviour-per-log contract) restricts which behaviour's checks run;
 * omitted, all of this file's behaviours run.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { InboxView, type InboxViewProps } from "../src/screens/InboxView.js";

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
    studioPath: "studio",
    onReasonChange: () => undefined,
    onSubmit: () => undefined,
    ...overrides,
  };
}

// behaviour 9: empty state is one line, then the colophon, no other content.
{
  const html = renderToStaticMarkup(InboxView(baseProps()));
  check(9, "empty state shows 'Nothing waiting on you'", html.includes("Nothing waiting on you"), html);
  check(9, "empty state renders the colophon", html.includes("<footer"), html);
  check(9, "empty state renders nothing else", !html.includes("<button"), html);
}

// behaviour 4: a petitio row is 40px, subject at 13/18, sella id in mono
// 12, with a 2px amber left rule.
{
  const petitiones = [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask for a decision" }];
  const html = renderToStaticMarkup(InboxView(baseProps({ petitiones })));
  check(4, "petitio row is 40px", /height:40px/.test(html), html);
  check(4, "petitio row has a 2px amber left rule", /border-left:2px solid var\(--amber\)/.test(html), html);
  check(4, "subject renders at 13/18", /font-size:13px;line-height:18px/.test(html), html);
  check(4, "sella id renders in mono 12", /font-family:var\(--font-mono\);font-size:12px/.test(html), html);
  check(4, "subject text is present", html.includes("ask for a decision"), html);
  check(4, "sella id text is present", html.includes("builder-a"), html);
}

// behaviour 8: verb buttons are disabled until a non-empty reason exists.
{
  const petitiones = [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask" }];
  const collapsedHtml = renderToStaticMarkup(InboxView(baseProps({ petitiones, expandedId: null })));
  check(8, "collapsed row has no verb buttons", !collapsedHtml.includes("<button"), collapsedHtml);

  const noReason = renderToStaticMarkup(InboxView(baseProps({ petitiones, expandedId: "P-1", reason: "" })));
  check(8, "expanded with no reason: all four verb buttons disabled", (noReason.match(/<button[^>]*disabled/g) ?? []).length === 4, noReason);

  const withReason = renderToStaticMarkup(InboxView(baseProps({ petitiones, expandedId: "P-1", reason: "looks good" })));
  check(8, "expanded with a reason: no verb button is disabled", !withReason.includes("disabled"), withReason);
  check(8, "all four verbs are offered", ["approve", "defer", "decline", "delegate"].every((v) => withReason.includes(`>${v}<`)), withReason);
}

process.exit(failed ? 1 : 0);
