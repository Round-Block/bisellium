import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";
import { boardModel } from "../src/lib/board.js";

const read = (path: string): string => readFileSync(resolve("apps/web", path), "utf8");

const officina: Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit"> = {
  wip_limit: 4,
  probationes: [{ id: "patron", name: "Patron call", kind: "human" }],
  lifecycle: { id: "opus", states: [
    { id: "backlog", name: "Backlog", phase: "backlog" },
    { id: "greenlit", name: "Greenlit", phase: "planned" },
    { id: "building", name: "Building", phase: "in_progress" },
    { id: "verifying", name: "Verifying", phase: "verifying" },
    { id: "review", name: "Review", phase: "awaiting_review" },
    { id: "done", name: "Done", phase: "done" },
    { id: "halted", name: "Halted", phase: "halted" },
  ] },
};

const opus = (id: string, state: string, probationes: OpusEntry["probationes"] = {}): OpusEntry => ({
  id, title: `${id} title`, body: "", kind: "task", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined,
});

test("W-463-b1 behaviour 1: variant C replaces the membership column with one waiting strip model", () => {
  const opera = [
    opus("W-1", "backlog"),
    opus("W-2", "greenlit"),
    opus("W-3", "building", { patron: { status: "pending" } }),
    opus("W-4", "verifying"),
    opus("W-5", "review"),
    opus("W-6", "done"),
    opus("W-7", "halted"),
    opus("W-8", "unknown", { patron: { status: "pending" } }),
  ];
  const inbox: Pick<InboxResponse, "opera" | "petitiones"> = {
    opera: [{ id: "W-1", title: "W-1 title", collegium: "design", sella: "builder" }, { id: "W-3", title: "W-3 title", collegium: "design", sella: "builder" }],
    petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First" },
      { id: "P-2", opus: "W-1", from: "architect", subject: "Second", body: "Second" },
      { id: "P-3", opus: "W-4", from: "producer", subject: "Verify", body: "Verify" },
      { id: "P-orphan", opus: "W-404", from: "producer", subject: "Orphan", body: "Orphan" },
    ],
  };
  const model = boardModel(officina, opera, inbox);

  assert.deepEqual(model.columns.map(({ id }) => id), ["planned", "in_progress", "verifying", "awaiting_review", "done", "halted"], "Needs-you is no longer a lifecycle column");
  assert.deepEqual(model.waiting.map(({ id }) => id), ["W-1", "W-3", "W-4", "W-8"], "zero, one and many asks count each waiting opus once in the strip");
  assert.deepEqual(model.waiting[0]?.asks, [{ kind: "greenlight", count: 1 }, { kind: "inbox", count: 2 }], "the strip retains Greenlight and counted Inbox decision words");
  assert.deepEqual(model.waiting[1]?.asks, [{ kind: "human_gate", count: 1 }], "the strip retains the Human gate word");
  assert.deepEqual(model.waiting[2]?.asks, [{ kind: "inbox", count: 1 }], "a lone Inbox decision remains a Board wait");

  const phaseCards = model.columns.flatMap(({ cards }) => cards.map(({ id }) => id));
  assert.deepEqual(phaseCards, ["W-2", "W-1", "W-3", "W-4", "W-5", "W-6", "W-7"], "every opus remains exactly once in its lifecycle phase");
  assert.equal(phaseCards.filter((id) => id === "W-1").length, 1, "a waiting opus has no duplicate card");
  assert.equal(model.waiting.some(({ id }) => id === "W-404"), false, "an ask with no Board entry creates no strip item");
  assert.deepEqual(model.unplaced, ["W-8"], "an unplaced waiting opus keeps its strip entry outside lifecycle columns");
  assert.equal(boardModel(officina, [opus("W-8", "done")], { opera: [], petitiones: [] }).waiting.length, 0, "an opus with no ask leaves the strip empty");
});

test("W-463-b2 behaviour 2: the pinned strip and in-place highlights stay legible at the ruled widths", () => {
  const view = read("src/screens/BoardView.tsx");
  const css = read("src/components/w025.css");
  const served = read("tests-serve/w463.spec.ts");

  assert.doesNotMatch(view, /Nothing waiting on you/, "the Board owns no empty-state phrase");
  assert.match(view, /board__waiting--empty[\s\S]*<strong>\{waiting\.length\}<\/strong>[\s\S]*waiting\.length > 0 && <div className=\{`board__waiting-rail\$\{canScrollRight/, "the mounted empty strip collapses to its label and zero count");
  assert.match(view, /<WaitingStrip waiting=\{model\.waiting\}[\s\S]*<div className="board__strip">/, "the waiting strip always precedes phase navigation");
  assert.match(view, /Greenlight[\s\S]*Inbox decision[\s\S]*Human gate/, "strip and cards share W-409's ask words");
  assert.match(css, /\.board__waiting\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*112px minmax\(0, 1fr\);[^}]*flex-shrink:\s*0;/s, "the strip is pinned above the flexible columns");
  assert.match(css, /\.board__waiting\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*96px;/s, "populated strips keep the reference whole-strip height");
  assert.match(css, /\.board__waiting\.board__waiting--empty\s*\{[^}]*height:\s*20px;[^}]*padding:\s*0;[^}]*border-top:\s*0;[^}]*border-bottom:\s*0;/s, "the zero strip collapses to one label line without an entry row");
  assert.match(css, /\.board__waiting-label\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-end;[^}]*width:\s*fit-content;[^}]*\}[\s\S]*?\.board__waiting-label span\s*\{[^}]*white-space:\s*nowrap;/s, "count sits below the label and shares its right edge");
  assert.match(css, /@media \(max-width:\s*899px\)[\s\S]*?\.board__waiting-label\s*\{[^}]*flex-direction:\s*row;[^}]*align-items:\s*baseline;[^}]*gap:\s*4px;/s, "640 and 390 put the count just right of the label");
  assert.match(css, /\.board__waiting-item\s*\{[^}]*border-left:\s*2px solid var\(--amber\);[^}]*background:\s*var\(--wash\);/s, "strip entries use an amber rule and neutral highlight");
  assert.match(css, /\.board__waiting-title\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s, "long strip titles use one-line ellipsis");
  assert.match(css, /\.board__waiting-item \.board__card-asks\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;[^}]*white-space:\s*normal;/s, "strip ask labels wrap without sharing the title ellipsis");
  assert.match(css, /\.board__waiting-item \.board__card-ask\s*\{[^}]*white-space:\s*nowrap;/s, "strip asks wrap only at ask-kind boundaries");
  assert.match(css, /\.board__card-ask:not\(:last-child\)::after\s*\{[^}]*content:\s*",\\00a0";[^}]*\}/s, "ask separators end the previous kind without indenting a continuation line");
  assert.match(css, /\.board__card--amber\s*\{[^}]*border-left-color:\s*var\(--amber\);[^}]*background:\s*var\(--wash\);/s, "waiting lifecycle cards are highlighted in place without an accent state");
  assert.match(css, /\.board__waiting-items\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;/s, "every width uses one independently scrolling horizontal waiting row");
  assert.match(css, /\.board__waiting-item\s*\{[^}]*flex:\s*0 0 calc\(\(100% - \(3 \* var\(--sp-2\)\)\) \/ 4\);/s, "desktop exposes four entries before horizontal overflow");
  assert.match(css, /\.board__waiting-item\s*\{[^}]*height:\s*66px;/s, "entries fill the reference row with one title and three ask lines");
  assert.match(css, /@media \(max-width:\s*899px\)[\s\S]*?\.board__waiting-item\s*\{[^}]*flex-basis:\s*calc\(\(100% - var\(--sp-2\)\) \/ 2\);/s, "640 and 390 expose two entries before horizontal overflow");
  assert.match(css, /\.board__waiting-rail--more \.board__waiting-items\s*\{[^}]*scroll-padding-inline-end:\s*44px;/s, "a visible chevron reserves its overlay width when focused entries scroll");
  assert.match(view, /revealFocusedWaitingItem[\s\S]*itemRight > chevronLeft[\s\S]*items\.scrollBy\(\{ left: itemRight - chevronLeft \+ 2, behavior: "auto" \}\)/, "keyboard focus reveals each entry clear of the visible chevron");
  assert.match(view, /canScrollRight && <button ref=\{moreRef\} type="button" className="board__waiting-more" aria-label="Show more waiting asks" onClick=\{showMore\}/, "overflow owns a named native right-arrow button");
  assert.match(view, /const distance = items\.clientWidth \* 0\.9;[\s\S]*items\.scrollBy\(\{ left: distance, behavior: "auto" \}\)/, "the right arrow advances by about one visible width");
  assert.match(view, /reachesEnd && document\.activeElement === moreButton[\s\S]*requestAnimationFrame[\s\S]*board__waiting-item:last-child/, "removing a focused chevron returns focus to the last waiting entry");
  assert.match(css, /\.board__waiting-more\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*border-radius:\s*50%;[^}]*background:\s*#080b0d;[^}]*color:\s*#fff;/s, "the overflow arrow follows the round dark chevron reference");
  assert.match(served, /\[1280, 640, 390\]/, "the served row covers desktop, zoom and phone widths");
  assert.match(served, /strip stays above the lifecycle columns/, "the served row pins strip geometry");
  assert.match(served, /empty strip contains only its inline label and zero/, "the served row pins the ruled empty strip at every width");
  assert.match(served, /1280: populated count sits below the label[\s\S]*populated count sits just right of the label/, "the served row pins stacked desktop and inline narrow counts");
  assert.match(served, /no continuation line begins with a separator on strip or card copy/, "the served row pins separator placement after wrapping");
  assert.match(served, /every waiting entry stays in one horizontal row[\s\S]*horizontal waiting row opens at its first entry[\s\S]*overflow arrow appears while entries continue right[\s\S]*right arrow advances the waiting row[\s\S]*right arrow hides at the end[\s\S]*keyboard focus reaches horizontal entry/, "the served row pins one horizontal row, initial scroll, its arrow cue and keyboard reachability");
  assert.match(served, /focused entry \$\{index \+ 1\} stays clear of the visible chevron/, "the served row pins chevron-clear keyboard focus");
  assert.match(served, /transfers focus from the removed arrow to the last waiting entry/, "the served row pins chevron-end focus transfer");
  assert.match(served, /1280 collapsed shell: waiting entries still overflow their rail[\s\S]*1280 collapsed shell: overflow keeps the waiting chevron visible/, "the served row pins collapsed desktop chevron visibility under overflow");
  assert.match(served, /twelve waiting entries remain in the strip[\s\S]*twelve waiting entries overflow their rail[\s\S]*twelve waiting entries keep the chevron visible/, "the served row covers the twelve-entry collapsed desktop shell");
  assert.match(served, /many-entry strip keeps the reference whole-strip height[\s\S]*empty strip collapses to exactly its label line[\s\S]*one-entry strip keeps the reference whole-strip height/, "the served row pins collapsed zero and reference-height populated strips");
});

test("W-463-b3 behaviour 3: the Board badge reuses strip membership while Inbox keeps D-135", () => {
  const app = read("src/App.tsx");
  const sidebar = read("src/components/Sidebar.tsx");
  const css = read("src/components/w025.css");
  const served = read("tests-serve/w463.spec.ts");

  assert.match(app, /if \(route === "board"\) return;[\s\S]*if \(active\) setBoardWaitingCount\(boardModel\(officina, opera, inbox\)\.waiting\.length\)/, "the mounted Board ignores obsolete shell snapshots and supplies its live badge count");
  assert.match(app, /fetchInbox\(\)[\s\S]*active && route !== "inbox"[\s\S]*setNeedsYouCount\(needsYouTotal\(inbox\)\)/, "the Inbox badge refreshes independently of Officina and opera reads");
  assert.match(sidebar, /e\.route === "board"[\s\S]*Board, \$\{boardWaitingCount\} waiting on you/, "the Board link owns a labelled nonzero badge");
  assert.match(sidebar, /collapsed && boardWaitingCount > 9 \? "9\+" : boardWaitingCount/, "the collapsed Board dot caps only its visible count");
  assert.match(sidebar, /overlay && collapsed[\s\S]*sidebar__badge--toggle/, "the closed narrow shell keeps the chosen mock's Board alert on its toggle");
  assert.match(sidebar, /aria-describedby=\{toggleBoardDescriptionId\}[\s\S]*Board, \{boardWaitingCount\} waiting on you/, "the ruled toggle name gains a full-count waiting description");
  assert.match(css, /\.shell--sidebar-collapsed \.sidebar__link\[href="#\/board"\]/, "the collapsed Board icon anchors its dot");
  assert.match(served, /Inbox badge stays question-only/, "served geometry distinguishes both navigation totals");
});

test("W-463-b4 behaviour 4: strip entries reuse the lifecycle-card drawer handler", () => {
  const view = read("src/screens/BoardView.tsx");
  const board = read("src/screens/Board.tsx");
  const css = read("src/components/w025.css");
  const served = read("tests-serve/w463.spec.ts");

  assert.match(view, /<button[\s\S]*type="button"[\s\S]*className="board__waiting-item"[\s\S]*aria-label=\{`Open \$\{card\.id\} \$\{card\.title\}: \$\{asks\}`\}[\s\S]*onClick=\{\(\) => onSelectCard\(card\.id, columnId \?\? "unplaced"\)\}/, "a waiting entry is a named button wired to the shared card selection callback");
  assert.match(served, /unplaced waiting entry opens the existing drawer/, "an unplaced strip entry has an explicit drawer outcome");
  assert.match(view, /<Card[\s\S]*onSelect=\{onSelectCard\}/, "lifecycle cards retain the same selection callback");
  assert.match(board, /sel\.columnId === "unplaced"[\s\S]*model\.unplaced\.includes\(sel\.id\)[\s\S]*model\.waiting\.some/, "an unplaced waiting selection stays open in the existing drawer");
  assert.match(css, /\.board__waiting-item:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--verdigris\);[^}]*outline-offset:\s*2px;/s, "waiting entry keyboard focus is visibly outlined");
  assert.match(served, /\[1280, 390\]/, "drawer reuse is served at desktop and phone widths");
  assert.match(served, /keyboard of \["Enter", "Space"\]/, "native button activation is pinned for Enter and Space");
});
