import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (fileName: string): string => readFileSync(resolve(ROOT, fileName), "utf8");
const readOptional = (fileName: string): string => existsSync(resolve(ROOT, fileName)) ? read(fileName) : "";

test("W-407-b1 behaviour 1: Inbox follows Outlook split and mobile layouts", () => {
  const view = read("apps/web/src/screens/InboxView.tsx");
  const css = read("apps/web/src/components/w025.css");
  const direction = read("docs/design/DIRECTION.md");
  const served = read("apps/web/tests-serve/w407.spec.ts");
  assert.match(view, /inbox__workspace[\s\S]*inbox__list-pane[\s\S]*inbox__reading-pane/, "the renderer has separate list and reading panes");
  assert.match(view, /className="inbox__mobile-header"[\s\S]*className="inbox__back"[\s\S]*Back[\s\S]*<h1 className="inbox__mobile-title">Inbox/, "the narrow reading view has visible Back and level-one title chrome");
  assert.match(css, /\.inbox__workspace\s*\{[^}]*grid-template-columns:\s*320px minmax\(0, 1fr\)/s, "the wide Inbox uses a fixed decision list beside a fluid reading pane");
  assert.match(css, /@media \(max-width: 839px\)[\s\S]*\.inbox__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s, "the 840px boundary changes to one full-width mobile pane");
  assert.match(view, /inbox__reading-scroll[\s\S]*inbox__action-bar[\s\S]*inbox__ratio-label[\s\S]*inbox__decision-panel/, "scrolling prose ends before the pinned decision action bar");
  assert.match(css, /\.inbox__list-pane,[\s\S]*\.inbox__reading-scroll\s*\{[^}]*overflow-y:\s*scroll;[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*auto;/s, "both scroll containers reserve visible vertical scrollbars");
  assert.match(css, /\.inbox__expansion\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto;/s, "the action bar owns the fixed bottom row");
  assert.match(direction, /Outlook is the interaction reference[\s\S]*Patron rulings, 2026-10-27 and 2026-10-28/s, "DIRECTION records both Patron rulings");
  assert.match(served, /for \(const width of \[1280, 640, 390\]\)/, "served geometry pins desktop and both narrow widths");
});

test("W-407-b2 behaviour 2: selected reading, neutral divided rows, evidence and oldest-first order", async () => {
  const view = read("apps/web/src/screens/InboxView.tsx");
  const inbox = read("apps/web/src/screens/Inbox.tsx");
  const css = read("apps/web/src/components/w025.css");
  const server = read("apps/server/src/store.ts");
  assert.match(view, /detachedPetition \?\? petitiones\.find\(\(petitio\) => petitio\.id === expandedId\) \?\? focusedPetition/, "the reading pane follows the selected or refresh-detached petition");
  assert.match(view, /selectedPetition\.body \? askBlocks\(selectedPetition\.body\)/, "the ask uses the constrained safe-Markdown block renderer");
  assert.match(view, /block\.kind === "unordered"[\s\S]*<ul[\s\S]*block\.kind === "ordered"[\s\S]*<ol/, "bulleted and numbered Markdown lists render as semantic lists");
  assert.match(view, /link\.actionable[\s\S]*<a[\s\S]*inbox__evidence-unavailable[\s\S]*Not available in this console/, "only HTTP evidence is actionable");
  assert.match(css, /\.inbox__reading\s*\{[^}]*max-width:\s*72ch;/s, "reading content remains capped at a readable measure");
  assert.match(view, /inbox__row-meta[\s\S]*inbox__sella[\s\S]*inbox__date[\s\S]*inbox__subject/, "each row renders sella and notification date above its subject");
  assert.match(css, /\.inbox__item\s*\{[^}]*grid-template-rows:\s*18px minmax\(0, 36px\);[^}]*height:\s*68px;[^}]*padding:\s*6px 12px 7px 14px;[^}]*border-bottom:\s*1px solid var\(--rule\)/s, "two-line rows have adequate padding and a hairline divider");
  assert.match(css, /\.inbox__subject\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*overflow-wrap:\s*anywhere;/s, "arbitrary subjects wrap safely and stop after two lines");
  assert.match(css, /\.inbox__item--focused\s*\{[^}]*background:\s*var\(--wash\)/s, "selection uses a quiet tint");
  assert.match(css, /\.inbox__item:focus,[\s\S]*?\.inbox__item:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*none/s, "keyboard focus adds no underline or box to the selected wash");
  assert.match(css, /\.inbox__item--unread\s*\{[^}]*border-left-color:\s*var\(--verdigris\)/s, "the verdigris left mark means unread");
  assert.doesNotMatch(view, /inbox__(?:item|row)--attention/, "Inbox rows carry no amber attention class");
  assert.doesNotMatch(css, /\.inbox__(?:item|row|date)[^{]*\{[^}]*var\(--amber\)/s, "Inbox rows and dates use no amber");
  assert.match(server, /opened: instant\(p\.openedAt\)\?\.getTime\(\)/, "the server normalises notification time through the shared strict instant helper");
  assert.match(server, /return \{ opera, petitiones \};/, "the Inbox response adds opened only and does not expose the studio path");
  assert.match(server, /\.sort\(\(a, b\) => \{[\s\S]*a\.opened === undefined[\s\S]*b\.opened === undefined[\s\S]*a\.opened - b\.opened \|\| a\.sourceOrder - b\.sourceOrder/, "the Inbox response orders dated petitiones oldest first and preserves filename order for ties and undated records");
  assert.doesNotMatch(`${inbox}\n${view}`, /petitiones\.sort\(/, "the client preserves the server's Inbox order without a second sort");
  const logic = await import("../src/screens/inboxLogic.js");
  assert.equal(logic.datePresentation(Date.UTC(2026, 9, 27, 8)), "27 Oct");
  assert.equal(logic.datePresentation(Date.UTC(2026, 0, 2, 23, 59)), "2 Jan");
  assert.equal(logic.datePresentation(undefined), "Date unavailable");
  assert.equal(logic.datePresentation(Number.NaN), "Date unavailable");
  assert.equal(logic.askText("Read [the brief](docs/W.md) and [the web](https://example.test/x)."), "Read the brief and the web.");
  assert.deepEqual(logic.askBlocks("Intro [brief](docs/W.md).\n\n- alpha\n- beta\n\n1. one\n2) two\n\n<b>literal</b>"), [
    { kind: "paragraph", text: "Intro brief." },
    { kind: "unordered", items: ["alpha", "beta"] },
    { kind: "ordered", items: ["one", "two"] },
    { kind: "paragraph", text: "<b>literal</b>" },
  ]);
  assert.deepEqual(logic.evidenceLinks("See [log](ci/W-1.log), [web](https://example.test/x), [bad](javascript:alert(1))."), [
    { label: "log", href: "ci/W-1.log", actionable: false },
    { label: "web", href: "https://example.test/x", actionable: true },
  ]);
});

test("W-407-b3 behaviour 3: roving selection, read state and narrow detail returns", async () => {
  const inbox = read("apps/web/src/screens/Inbox.tsx");
  const view = read("apps/web/src/screens/InboxView.tsx");
  const css = read("apps/web/src/components/w025.css");
  assert.match(view, /className=\{\["inbox__item", "inbox__row"[\s\S]*role="option"[\s\S]*aria-selected=\{hasFocus && !decisionUnavailable\}[\s\S]*tabIndex=\{hasFocus \? 0 : -1\}/, "rows use roving listbox semantics and no stale row claims selection");
  assert.match(inbox, /e\.key === "j" \|\| e\.key === "k"/, "j and k move");
  assert.match(inbox, /e\.key === "Enter"[\s\S]*setExpandedId\(focusedId\)/, "Enter opens the selected narrow item");
  assert.match(inbox, /e\.key === "Escape"[\s\S]*target\.closest\("\.sidebar"\)[\s\S]*expandedId === null[\s\S]*setExpandedId\(null\)[\s\S]*setFocusRequest/, "Inbox Escape returns to the selected row without stealing sidebar Escape");
  assert.match(view, /scrollIntoView\(\{ block: "nearest" \}\)/, "selection reveal scrolls only as far as needed");
  assert.doesNotMatch(view, /behavior:\s*"smooth"|block:\s*"start"|inbox__position/, "selection has no smooth stable-offset reveal or position marker");
  assert.match(inbox, /const reason = reasonForPetition\(reasons, (?:focusedId|decisionId)\)/, "the ratio is keyed to the decision rather than the expansion container");
  assert.match(inbox, /refreshIntentRef\.current = \{ preferredIndex: focusIndex, reopenDetail: expandedId !== null, reveal: true \}[\s\S]*refreshInbox\(\)/, "post-answer reconciliation keeps narrow detail state and reveals nearest");
  assert.match(css, /\.inbox__workspace--detail \.inbox__list-pane\s*\{[^}]*display:\s*none;[\s\S]*\.inbox__workspace--detail \.inbox__reading-pane\s*\{[^}]*display:\s*grid;/s, "narrow detail replaces rather than stacks below the list");
  assert.match(inbox, /localStorage\.getItem\(INBOX_READ_STORAGE_KEY\)[\s\S]*catch \{ return new Set\(\); \}/, "denied read storage renders every row unread");
  assert.match(inbox, /localStorage\.setItem\(INBOX_READ_STORAGE_KEY, encodeInboxReadSet\(next\)\)[\s\S]*catch \{[\s\S]*return new Set\(\);/, "denied write storage falls back to every row unread");
  const logic = await import("../src/screens/inboxLogic.js");
  assert.equal(logic.INBOX_READ_STORAGE_KEY, "bisellium.inbox.read");
  assert.deepEqual([...logic.decodeInboxReadSet('["P-2","P-1","P-2"]')], ["P-2", "P-1"]);
  for (const rejected of [null, "not json", "{}", '["P-1",2]', '[""]']) assert.deepEqual([...logic.decodeInboxReadSet(rejected)], []);
  assert.equal(logic.encodeInboxReadSet(new Set(["P-2", "P-1"])), '["P-1","P-2"]');
});

test("W-407-b4 behaviour 4: verdicts keep the answer route and every visible verb requires a ratio", () => {
  const api = read("apps/web/src/api.ts");
  const inbox = read("apps/web/src/screens/Inbox.tsx");
  const view = read("apps/web/src/screens/InboxView.tsx");
  const logic = read("apps/web/src/screens/inboxLogic.ts");
  assert.match(api, /postWrite\("\/api\/answer", body\)/, "the existing answer route remains the one write mechanism");
  assert.match(inbox, /submitAnswer\(petitioId, buildReply\(verb, reason\), answerOptions\(verb\)\)/, "all enabled verbs keep the existing body constructor");
  assert.match(logic, /"1": "approve"[\s\S]*"2": "defer"[\s\S]*"3": "decline"/, "1, 2 and 3 have the ruled mapping");
  for (const verb of ["approve", "defer", "decline", "delegate"]) assert.match(view, new RegExp(`verb: "${verb}"`), `${verb} is visible`);
  assert.match(view, />Ratio decidendi</, "the ruled reason is named");
  assert.match(view, /verb === "delegate"[\s\S]*disabled=\{decisionUnavailable \|\| unavailable \|\| !canSubmit/, "delegate is honestly disabled and a refresh-detached decision cannot be submitted");
  assert.match(view, /aria-describedby=\{unavailable \? delegateDescriptionId : undefined\}/, "delegate points to its visible explanation");
  assert.match(view, /Delegation is not available yet/, "delegate's unavailable state is visible text");
});

test("W-407-b5 behaviour 5: secondary groups are honest labels and empty has no generated stamp", () => {
  const view = read("apps/web/src/screens/InboxView.tsx");
  assert.match(view, /<p>You asked <span>Not available yet<\/span><\/p>/, "You asked is an honest non-interactive label without a count");
  assert.match(view, /<p>For information <span>Not available yet<\/span><\/p>/, "For information is an honest non-interactive label without a count");
  assert.doesNotMatch(view, /<details|<summary|You asked <span>\d/, "secondary groups imply neither interaction nor invented counts");
  assert.match(view, /Nothing waiting on you/, "the ruled empty line remains exact");
  assert.doesNotMatch(view, /Colophon|generatedAt|as of/i, "Inbox renders no colophon timestamp, generated-at or as-of text");
});

test("W-407-b6 behaviour 6: visible refresh is shared, current and non-disruptive", () => {
  const hook = readOptional("apps/web/src/lib/useVisibleRefresh.ts");
  const inbox = read("apps/web/src/screens/Inbox.tsx");
  const view = read("apps/web/src/screens/InboxView.tsx");
  assert.match(hook, /useVisibleRefresh\(refresh: \(\) => void, intervalMs = DEFAULT_VISIBLE_REFRESH_INTERVAL_MS\): void/, "the shared hook has the promised API and default");
  assert.match(hook, /DEFAULT_VISIBLE_REFRESH_INTERVAL_MS = 30_000/, "the default interval is thirty seconds");
  assert.match(hook, /document\.visibilityState === "visible"[\s\S]*refreshRef\.current\(\)/, "every read is visibility guarded");
  assert.match(hook, new RegExp('refreshWhenVisible\\(\\);[\\s\\S]*' + "set" + 'Interval\\(refreshWhenVisible, intervalMs\\)[\\s\\S]*addEventListener\\("focus", refreshWhenVisible\\)[\\s\\S]*addEventListener\\("visibilitychange", refreshWhenVisible\\)'), "visible mount, interval, focus and visibility change share one read function");
  assert.match(hook, /clearInterval\(interval\)[\s\S]*removeEventListener\("focus", refreshWhenVisible\)[\s\S]*removeEventListener\("visibilitychange", refreshWhenVisible\)/, "unmount removes interval and listeners");
  assert.match(inbox, /const refreshInbox = useCallback\(\(\): void =>/, "Inbox passes one stable refresh callback");
  assert.match(inbox, /useVisibleRefresh\(refreshInbox\)/, "Inbox consumes the shared mechanism");
  assert.match(inbox, /if \(refreshingRef\.current\) \{[\s\S]*if \(refreshIntentRef\.current !== null\) pendingRefreshRef\.current = true;[\s\S]*return;/, "overlapping focus and visibility reads coalesce while an explicit answer refresh is queued");
  assert.match(inbox, /if \(!hasSuccessfulLoadRef\.current\) setData\(EMPTY\);[\s\S]*setReadFailed\(true\)/, "only a failed first load replaces the response with the empty failure state");
  assert.match(inbox, /findIndex\(\(petitio\) => petitio\.id === currentId\)[\s\S]*retainedIndex >= 0/, "refresh reconciles selection by petitio id");
  assert.match(inbox, /const keepDetached = intent === null && refreshIntentRef\.current === null[\s\S]*setDetachedPetition\(keepDetached \? currentPetition : null\)/, "an ordinary settle cannot detach an answered decision while its explicit reconciliation is queued");
  assert.match(view, /<section className="inbox__list-pane"[\s\S]*notice !== undefined && <p className="screen-notice">\{notice\}<\/p>[\s\S]*inbox__queue/, "a background read failure is visible above the list in every layout");
  assert.match(view, /if \(petitiones\.length === 0\)[\s\S]*Nothing waiting on you/, "an empty ordinary refresh replaces a retained reading while its draft remains state-owned");
  assert.match(view, /This petitio no longer needs a decision\./, "a removed selected decision explains why its controls are disabled");
});
