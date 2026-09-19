/**
 * apps/web/test/inboxview.test.ts — W-024 behaviours 4, 8 and 9: the
 * Inbox's presentational half, static-rendered against plain props with
 * `react-dom/server` (no fetch, no DOM, no keyboard simulation needed —
 * the keyboard/submit model itself is covered by inboxLogic.test.ts).
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
    reason: "",
    onReasonChange: () => undefined,
    onSubmit: () => undefined,
    ...overrides,
  };
}

// behaviour 9: empty state is one line, no other content.
{
  const html = renderToStaticMarkup(InboxView(baseProps()));
  check(9, "empty state shows 'Nothing waiting on you'", html.includes("Nothing waiting on you"), html);
  check(9, "empty state renders nothing else", !html.includes("<button"), html);
}

// behaviour 4: a petitio row has subject at 13/18, sella id in mono 12,
// with a 2px amber left rule.
{
  const petitiones = [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask for a decision", body: "Full proposal content here." }];
  const html = renderToStaticMarkup(InboxView(baseProps({ petitiones })));
  check(4, "petitio row renders", html.includes('class="inbox__row'), html);
  check(4, "petitio row has a 2px amber left rule", html.includes("inbox__row--attention"), html);
  check(4, "subject renders at 13/18", html.includes('class="inbox__subject"'), html);
  check(4, "sella id renders in mono 12", html.includes('class="inbox__sella"'), html);
  check(4, "subject text is present", html.includes("ask for a decision"), html);
  check(4, "sella id text is present", html.includes("builder-a"), html);
  check(4, "detail pane shows body content", html.includes("Full proposal content here."), html);
}

// behaviour 8: detail pane shows verb buttons; disabled until a non-empty reason.
{
  const petitiones = [{ id: "P-1", opus: "W-024", from: "builder-a", subject: "ask" }];
  const noReason = renderToStaticMarkup(InboxView(baseProps({ petitiones, reason: "" })));
  check(8, "detail pane shows all four verb buttons", (noReason.match(/<button/g) ?? []).length === 4, noReason);
  check(8, "with no reason: all four verb buttons disabled", (noReason.match(/<button[^>]*disabled/g) ?? []).length === 4, noReason);

  const withReason = renderToStaticMarkup(InboxView(baseProps({ petitiones, reason: "looks good" })));
  check(8, "with a reason: no verb button is disabled", !withReason.includes("disabled"), withReason);
  check(8, "all four verbs are offered", ["approve", "defer", "decline", "delegate"].every((v) => withReason.includes(`>${v}<`)), withReason);
}

process.exit(failed ? 1 : 0);
