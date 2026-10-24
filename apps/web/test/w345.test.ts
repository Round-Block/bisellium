/**
 * W-345: Inbox truth and safety. Each row is added before its implementation
 * so the ordered prototype records one assertion-level red per behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(resolve(WEB, rel), "utf8");
(globalThis as { React?: unknown }).React = React;

async function logic(): Promise<Record<string, unknown>> {
  return (await import("../src/screens/inboxLogic.js")) as Record<string, unknown>;
}

test("W-345-b1 behaviour 1: Inbox shortcuts ignore text-entry targets", async () => {
  const m = await logic();
  assert.equal(typeof m["isTextEntryTarget"], "function", "inboxLogic exports the text-entry target classifier");
  const classify = m["isTextEntryTarget"] as (target: unknown) => boolean;
  for (const tagName of ["INPUT", "textarea", "Select"]) {
    assert.equal(classify({ tagName }), true, `${tagName} is a text-entry target`);
  }
  assert.equal(classify({ tagName: "DIV", isContentEditable: true }), true, "a contenteditable node is a text-entry target");
  assert.equal(classify({ tagName: "BUTTON", isContentEditable: false }), false, "a button remains eligible for Inbox shortcuts");
  assert.equal(classify(null), false, "a missing target remains eligible for Inbox shortcuts");
  assert.match(read("src/screens/Inbox.tsx"), /if \(isTextEntryTarget\(e\.target\)\) return;/, "the window key handler applies the classifier before j, k or verb keys");
});

test("W-345-b2 behaviour 2: one answer at a time", async () => {
  const m = await logic();
  const canSubmit = m["canSubmit"] as (reason: string, sending?: boolean) => boolean;
  assert.equal(canSubmit("a reason", true), false, "an in-flight answer disables another submission");
  const source = read("src/screens/Inbox.tsx");
  assert.match(source, /const sendingRef = useRef\(false\);/, "the synchronous submission lock does not wait for a React render");
  assert.match(source, /if \(sendingRef\.current\) return;/, "a second submission is refused before another request is made");
  assert.match(source, /sendingRef\.current = true;/, "the first submission takes the lock before calling submitAnswer");
  assert.match(source, /sendingRef\.current = false;/, "the settled submission releases the lock");
});

test("W-345-b3 behaviour 3: each reason belongs to one petition", async () => {
  const m = await logic();
  assert.equal(typeof m["reasonForPetition"], "function", "inboxLogic exports keyed reason lookup");
  assert.equal(typeof m["withReasonForPetition"], "function", "inboxLogic exports keyed reason update");
  const readReason = m["reasonForPetition"] as (drafts: Readonly<Record<string, string>>, id: string | undefined) => string;
  const writeReason = m["withReasonForPetition"] as (drafts: Readonly<Record<string, string>>, id: string, value: string) => Record<string, string>;
  const first = writeReason({}, "P-1", "reason one");
  const both = writeReason(first, "P-2", "reason two");
  assert.equal(readReason(both, "P-1"), "reason one", "P-1 retains only its own reason");
  assert.equal(readReason(both, "P-2"), "reason two", "P-2 retains only its own reason");
  assert.equal(readReason(both, undefined), "", "no selected petition exposes no reason");
  const source = read("src/screens/Inbox.tsx");
  assert.match(source, /const \[reasons, setReasons\] = useState<Record<string, string>>\(\{\}\);/, "Inbox stores reasons by petition id");
  assert.match(source, /const reason = reasonForPetition\(reasons, focusedId\);/, "the visible reason follows the selected petition id");
});

test("W-345-b4 behaviour 4: a failed Inbox read clears records before showing the failure", () => {
  const source = read("src/screens/Inbox.tsx");
  assert.match(
    source,
    /\.catch\(\(\) => \{\s*setData\(EMPTY\);\s*setLoaded\(true\);\s*setReadFailed\(true\);\s*\}\);/,
    "every failed read replaces prior data with EMPTY, settles loading and enters the failure state",
  );
});

test("W-345-b5 behaviour 5: the answer pane remains reachable at phone width", () => {
  const css = read("src/components/w025.css");
  const inboxAt = css.indexOf("/* ── Inbox");
  const phoneAt = css.indexOf("@media (max-width: 899px)", inboxAt);
  const phone = css.slice(phoneAt, css.indexOf(".inbox__title", phoneAt));
  assert.doesNotMatch(phone, /\.inbox__detail\s*\{[^}]*display:\s*none;/, "the phone rule never hides the answer pane");
  assert.match(phone, /\.inbox--split\s*\{[^}]*height:\s*auto;/, "the stacked phone Inbox grows to fit its answer pane");
  assert.match(phone, /\.inbox__list\s*\{[^}]*max-height:\s*40vh;/, "the petition list leaves room for the phone answer pane");
  for (const [selector, property] of [
    ["inbox__row", "min-height"],
    ["inbox__input-ratio", "min-height"],
    ["inbox__btn-action", "min-height"],
  ]) {
    assert.match(phone, new RegExp(`\\.${selector}\\s*\\{[^}]*${property}:\\s*44px;`), `${selector} has a 44px phone touch target`);
  }
  const view = read("src/screens/InboxView.tsx");
  assert.match(view, /<button[\s\S]*?className=\{rowClasses\}[\s\S]*?aria-pressed=\{focused\}[\s\S]*?tabIndex=\{focused \? 0 : -1\}/, "petition selectors expose button and roving-tab semantics");
  assert.match(view, /selectedRowRef\.current\?\.focus\(\{ preventScroll: true \}\);[\s\S]*?selectedRowRef\.current\?\.scrollIntoView\(\{ block: "nearest" \}\);/, "selection movement focuses and reveals the selected petition");
  assert.match(css, /\.inbox__row:focus-visible[\s\S]*?outline:\s*2px solid var\(--verdigris\);[\s\S]*?outline-offset:\s*2px;/, "petition selectors have the visible two-pixel focus ring");
  const policy = read("tests-serve/states-policy.ts");
  assert.doesNotMatch(policy, /inbox:(?:refused|pending)/, "W-341 has no phone exception for answer states");
  const screenshots = read("tests-serve/screenshots.spec.ts");
  assert.match(screenshots, /await expect\(page\.locator\("\.inbox__detail"\)\)\.toBeVisible\(\);/, "screenshot readiness requires the phone answer pane");
  assert.doesNotMatch(screenshots, /page\.locator\("\.inbox__detail"\)\)\.toBeHidden\(\)/, "screenshot readiness never expects a hidden phone answer pane");
});

test("W-345-b6 behaviour 6: Inbox offers the ruled verbs and records Follow up as ask-back", async () => {
  const m = await logic();
  assert.deepEqual(m["VERB_KEYS"], { "1": "approve", "2": "decline", "3": "followup" }, "approve, decline and follow up have drawn, working shortcuts");
  const buildReply = m["buildReply"] as (verb: string, text: string) => string;
  const answerOptions = m["answerOptions"] as (verb: string) => { askBack?: boolean } | undefined;
  const resolveAction = m["resolveVerbAction"] as (key: string, expanded: string | null, focused: string | undefined, text: string) => unknown;
  assert.equal(buildReply("followup", "  Could you test ‘理由’?  "), "Could you test ‘理由’?", "Follow up records trimmed open text without a verdict prefix");
  assert.deepEqual(answerOptions("followup"), { askBack: true }, "Follow up selects the endpoint's ask-back record form");
  assert.equal(resolveAction("3", "P-1", "P-1", "   "), null, "Follow up refuses whitespace-only text");
  assert.deepEqual(resolveAction("3", "P-1", "P-1", "Could you test ‘理由’?"), { petitioId: "P-1", verb: "followup" }, "Follow up accepts non-empty Unicode and quoted text");
  assert.equal(typeof m["reconcileFocusIndex"], "function", "inboxLogic exports selection reconciliation");
  const reconcile = m["reconcileFocusIndex"] as (index: number, count: number) => number;
  assert.equal(reconcile(2, 2), 1, "selection reconciles to a remaining petition after removal");
  assert.equal(reconcile(0, 0), 0, "an empty list retains the inert zero index");
  const view = (await import("../src/screens/InboxView.js")) as Record<string, unknown>;
  const html = renderToStaticMarkup(
    React.createElement(view["InboxView"] as ComponentType<Record<string, unknown>>, {
      petitiones: [{ id: "P-1", opus: "W-1", from: "architect", subject: "A decision", body: "Evidence" }],
      opera: [],
      focusIndex: 0,
      reason: "because",
      confirmation: "Recorded follow-up reply for P-1; the petition remains open awaiting the asker's reply.",
      onReasonChange: () => undefined,
      onFocusChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );
  assert.equal((html.match(/class="inbox__btn-action"/g) ?? []).length, 3, "the answer pane offers exactly three truthful verbs");
  assert.match(html, />approve</, "approve is offered");
  assert.match(html, />decline</, "decline is offered");
  assert.match(html, />follow up</, "follow up is offered");
  assert.doesNotMatch(html, />defer<|>delegate</, "defer and delegate are absent");
  assert.match(html, /Approve and Decline record this text as a verdict and resolve the petition\. Follow up records the text without a verdict, returns it to the asker and keeps it open\./, "all three consequences are visible before submission");
  assert.match(html, /Recorded follow-up reply for P-1; the petition remains open awaiting the asker&#x27;s reply\./, "the exact Follow up record effect is visible after success");
  const withoutSelection = renderToStaticMarkup(
    React.createElement(view["InboxView"] as ComponentType<Record<string, unknown>>, {
      petitiones: [{ id: "P-1", opus: "W-1", from: "architect", subject: "A decision", body: "Evidence" }],
      opera: [],
      focusIndex: 9,
      reason: "",
      confirmation: "Recorded decline answer for P-2; the petition is resolved.",
      onReasonChange: () => undefined,
      onFocusChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );
  assert.match(withoutSelection, /Recorded decline answer for P-2; the petition is resolved\./, "confirmation renders without a selected petition");
  const inbox = read("src/screens/Inbox.tsx");
  assert.match(inbox, /setFocusIndex\(\(index\) => reconcileFocusIndex\(index, petitiones\.length\)\);/, "a refreshed list reconciles selection after removal");
  assert.match(inbox, /onNeedsYouCount\?\.\(d\.petitiones\.length\);/, "a successful refresh reports the remaining needs-you count to the shell");
  const app = read("src/App.tsx");
  assert.match(app, /<Inbox onStatus=\{setStatus\} onNeedsYouCount=\{setNeedsYouCount\} \/>/, "the shell badge follows the Inbox's refreshed needs-you count");
  assert.match(inbox, /const reportedStatus = confirmation !== undefined[\s\S]*?status\.state === "ready"[\s\S]*?text: confirmation/, "the existing shell live region receives the recorded effect");
  const css = read("src/components/w025.css");
  const confirmationRule = /\.inbox__confirmation\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(confirmationRule, /padding:\s*0 var\(--sp-4\);/, "confirmation prose uses the list's existing horizontal inset token");
  assert.match(confirmationRule, /color:\s*var\(--ink-2\);/, "confirmation prose uses ink-2 rather than a gate colour");
  assert.doesNotMatch(confirmationRule, /var\(--ok\)/, "confirmation prose never uses the ok gate colour");
  const screenshots = read("tests-serve/screenshots.spec.ts");
  assert.match(screenshots, /toHaveText\(\[\/approve\/, \/decline\/, \/follow up\/\]\)/, "screenshot readiness requires the three ruled actions");
});
