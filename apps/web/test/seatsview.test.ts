/**
 * apps/web/test/seatsview.test.ts — W-065 behaviours 10-13: the roster
 * (10), the Delegation card (11), the honesty line (12) and the confirm bar
 * (13). Static markup via `react-dom/server`, same recipe as
 * inboxview.test.ts.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { SeatsView, type SeatsViewProps } from "../src/screens/SeatsView.js";

const only = process.argv[2] ? Number(process.argv[2]) : undefined;

let failed = 0;
const check = (behaviour: number, name: string, ok: boolean, detail = "") => {
  if (only !== undefined && behaviour !== only) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
};

function baseProps(overrides: Partial<SeatsViewProps> = {}): SeatsViewProps {
  return {
    seats: [],
    tiers: [],
    munera: [],
    availableModels: [],
    onDraft: () => undefined,
    onConfirm: () => undefined,
    onCancel: () => undefined,
    ...overrides,
  };
}

const HONESTY = "Changes are recorded only. They do not yet affect model dispatch or task routing.";
const HOSTILE = '<img src=x onerror=alert(1)>';

// ---------------------------------------------------------------------------
// Behaviour 10: seats render from the manifest, hostile strings stay literal.
// ---------------------------------------------------------------------------
{
  const html = renderToStaticMarkup(
    SeatsView(
      baseProps({
        seats: [{ id: "builder-a", collegium: "engineering", kind: "agent", model: "claude-sonnet-5" }],
        availableModels: [
          { id: "claude-sonnet-5", state: "available", seated: true },
          { id: "gpt-5.6-sol", state: "unverified", seated: false },
          { id: "claude-fable-5", state: "unavailable", seated: false, vendorDiagnostic: "[claude-code:unrecognized_model]" },
        ],
      }),
    ),
  );
  check(10, "roster: one row with sella id", html.includes("builder-a"), html);
  check(10, "roster: collegium shown", html.includes("engineering"), html);
  check(10, "roster: kind rendered as static text", html.includes("agent"), html);
  check(10, "roster: a <select> with an accessible name is present", /<select[^>]*aria-label="[^"]*builder-a[^"]*"/.test(html), html);
  check(10, "roster: exactly availableModels' three ids appear as <option> values", ["claude-sonnet-5", "gpt-5.6-sol", "claude-fable-5"].every((id) => html.includes(`value="${id}"`)), html);
  check(10, "roster: no free-text <input> anywhere", !html.includes("<input"), html);
  check(10, "roster: no <datalist> anywhere", !html.includes("<datalist"), html);
  check(10, "roster: available option has no disabled attribute", /<option value="claude-sonnet-5"[^>]*>/.test(html) && !/<option value="claude-sonnet-5"[^>]*disabled/.test(html), html);
  check(10, "roster: unverified option is disabled (rendered, not omitted)", /<option value="gpt-5.6-sol"[^>]*disabled/.test(html), html);
  check(10, "roster: unavailable option is disabled and carries its vendorDiagnostic", /<option value="claude-fable-5"[^>]*disabled/.test(html) && html.includes("claude-code:unrecognized_model"), html);
}

{
  // A seated:true option is enabled whatever its state.
  const html = renderToStaticMarkup(
    SeatsView(
      baseProps({
        seats: [{ id: "builder-a", collegium: "engineering", kind: "agent", model: "claude-fable-5" }],
        availableModels: [{ id: "claude-fable-5", state: "unavailable", seated: true, vendorDiagnostic: "nope" }],
      }),
    ),
  );
  check(10, "roster: a seated option is enabled whatever its state", !/<option value="claude-fable-5"[^>]*disabled/.test(html), html);
}

{
  // A kind:human seat emits no model control.
  const html = renderToStaticMarkup(SeatsView(baseProps({ seats: [{ id: "patron", collegium: "production", kind: "human" }] })));
  check(10, "roster: a human seat emits no <select>", !html.includes("<select"), html);
  check(10, "roster: a human seat's id still renders", html.includes("patron"), html);
}

{
  // Hostile strings as both a model id and a vendorDiagnostic.
  const html = renderToStaticMarkup(
    SeatsView(
      baseProps({
        seats: [{ id: "builder-a", collegium: "engineering", kind: "agent", model: "claude-sonnet-5" }],
        availableModels: [
          { id: "claude-sonnet-5", state: "available", seated: true },
          { id: HOSTILE, state: "unavailable", seated: false, vendorDiagnostic: HOSTILE },
        ],
      }),
    ),
  );
  check(10, "roster: hostile model id/vendorDiagnostic — no <img tag reaches the markup", !html.includes("<img"), html);
  check(10, "roster: hostile model id/vendorDiagnostic — the escaped text is present", html.includes("&lt;img") || html.includes("&amp;lt;img"), html);
}

// ---------------------------------------------------------------------------
// Behaviour 11: Delegation renders from the manifest.
// ---------------------------------------------------------------------------
{
  const html = renderToStaticMarkup(
    SeatsView(
      baseProps({
        tiers: [
          { id: "mid", model: "gpt-5.6-terra" },
          { id: "orphan", model: "gpt-x" },
        ],
        munera: [{ id: "audit", tier: "mid", model: "gpt-5.6-terra", tierKnown: true }],
      }),
    ),
  );
  const delegationIdx = html.indexOf("Delegation");
  const rosterIdx = html.indexOf("Roster");
  check(11, "delegation: the card precedes the roster card in document order", delegationIdx !== -1 && rosterIdx !== -1 && delegationIdx < rosterIdx, `${delegationIdx} < ${rosterIdx}`);
  check(11, "delegation: one row with the munus id", html.includes("audit"), html);
  check(11, "delegation: the tier <select> contains every declared tier, including an unused one", html.includes('value="mid"') && html.includes('value="orphan"'), html);
  check(11, "delegation: each option's text is formatted `<tier> · <holder>`", html.includes("mid · gpt-5.6-terra") && html.includes("orphan · gpt-x"), html);
  check(11, "delegation: no resolved-model column (a bare cell of just the holder)", !/<td>gpt-5\.6-terra<\/td>/.test(html), html);
  check(11, "delegation: the tier legend below the card lists every declared tier, including the unused one", html.includes("seats__tier-legend") && html.includes("orphan · gpt-x"), html);
}

{
  // A munus whose tier is undeclared renders that value as an additional
  // selected disabled option marked unresolved.
  const html = renderToStaticMarkup(
    SeatsView(
      baseProps({
        tiers: [{ id: "mid", model: "gpt-5.6-terra" }],
        munera: [{ id: "ghost", tier: "nonexistent", model: undefined, tierKnown: false }],
      }),
    ),
  );
  const ghostOption = /<option value="nonexistent"([^>]*)>/.exec(html)?.[1] ?? "";
  check(11, "delegation: an undeclared tier renders as an additional selected disabled option marked unresolved", ghostOption.includes("selected") && ghostOption.includes("disabled") && html.includes("unresolved"), html);
  check(11, "delegation: the undeclared-tier munus still offers the declared tier as a normal option too", html.includes('value="mid"'), html);
}

// ---------------------------------------------------------------------------
// Behaviour 12: the honesty line, exact wording, on populated AND seat-only
// screens.
// ---------------------------------------------------------------------------
{
  const populated = renderToStaticMarkup(
    SeatsView(
      baseProps({
        seats: [{ id: "builder-a", collegium: "engineering", kind: "agent", model: "claude-sonnet-5" }],
        tiers: [{ id: "mid", model: "gpt-5.6-terra" }],
        munera: [{ id: "audit", tier: "mid", model: "gpt-5.6-terra", tierKnown: true }],
      }),
    ),
  );
  check(12, "honesty line: exact wording on a populated screen", populated.includes(HONESTY), populated);

  const seatOnly = renderToStaticMarkup(SeatsView(baseProps({ seats: [{ id: "builder-a", collegium: "engineering", kind: "agent", model: "claude-sonnet-5" }], tiers: [], munera: [] })));
  check(12, "honesty line: exact wording on a seat-only screen (tiers: [], munera: [])", seatOnly.includes(HONESTY), seatOnly);

  const headingIdx = populated.indexOf("Seats</h1>");
  const honestyIdx = populated.indexOf(HONESTY);
  const cardIdx = populated.indexOf("seats__card");
  check(12, "honesty line: appears beneath the screen heading and above both cards", headingIdx < honestyIdx && honestyIdx < cardIdx, `${headingIdx} < ${honestyIdx} < ${cardIdx}`);
}

// ---------------------------------------------------------------------------
// Behaviour 13: the confirm bar.
// ---------------------------------------------------------------------------
{
  const html = renderToStaticMarkup(SeatsView(baseProps({ pending: undefined })));
  check(13, "confirm bar: absent with pending undefined", !html.includes("seats__confirm-bar"), html);
}
{
  const html = renderToStaticMarkup(SeatsView(baseProps({ pending: { kind: "seat", id: "builder-a", from: "claude-sonnet-5", to: "gpt-5.6-sol" } })));
  check(13, "confirm bar: present with a pending prop", html.includes("seats__confirm-bar"), html);
  check(13, "confirm bar: names the target", html.includes("builder-a"), html);
  check(13, "confirm bar: names the exact from", html.includes("claude-sonnet-5"), html);
  check(13, "confirm bar: names the exact to", html.includes("gpt-5.6-sol"), html);
  check(13, "confirm bar: names the destination record", html.includes("bisellium.yml"), html);
}
{
  const html = renderToStaticMarkup(SeatsView(baseProps({ pending: { kind: "seat", id: "builder-a", from: "x", to: "y" }, busy: true })));
  check(13, "confirm bar: disabled under busy:true", /<button[^>]*seats__confirm-btn[^>]*disabled/.test(html), html);
}
{
  const html = renderToStaticMarkup(SeatsView(baseProps({ pending: { kind: "seat", id: "builder-a", from: "x", to: "y" }, error: "manifest changed under you" })));
  check(13, "confirm bar: an error prop renders visibly", html.includes("manifest changed under you"), html);
  check(13, "confirm bar: an error prop does not clear the pending draft", html.includes("seats__confirm-bar") && html.includes(">y<"), html);
}
{
  // Hostile strings in pending.to and in error stay literal.
  const html = renderToStaticMarkup(SeatsView(baseProps({ pending: { kind: "seat", id: "builder-a", from: "x", to: HOSTILE }, error: HOSTILE })));
  check(13, "confirm bar: hostile pending.to/error — no <img tag reaches the markup", !html.includes("<img"), html);
  check(13, "confirm bar: hostile pending.to/error — escaped text present", (html.match(/&lt;img/g) ?? []).length >= 2, html);
}

process.exit(failed ? 1 : 0);
