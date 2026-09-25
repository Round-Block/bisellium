/**
 * apps/web/test/boardview.test.ts — W-064 behaviours 5-6: the Board renders
 * from records (5) and the drawer renders the canvas's sections in order,
 * from its real sources (6). Behaviour at argv[2], house convention for
 * apps/web/test/*.test.ts (no repo path — no filesystem access needed for
 * the render assertions; the two source-text checks read this repo's own
 * checked-out files directly).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BoardView, type BoardViewProps } from "../src/screens/BoardView.js";
import { BoardDrawer } from "../src/screens/BoardDrawer.js";
import { GateLadder } from "../src/components/GateLadder.js";
import type { Gate } from "../src/lib/gateLadder.js";
import type { BoardModel, CardRow, DrawerDetail } from "../src/lib/board.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

const only = process.argv[2] ? Number(process.argv[2]) : undefined;
let failed = 0;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
}

const HOSTILE = "<img src=x onerror=alert(1)>";
const SAMPLE_GATES: Gate[] = [
  { id: "spec", status: "passed" },
  { id: "review", status: "pending" },
];

function card(overrides: Partial<CardRow> = {}): CardRow {
  return { id: "W-1", title: "a train build", sella: "builder-a", state: "building", gates: SAMPLE_GATES, needsYou: false, blocked: false, ...overrides };
}

function column(overrides: Partial<BoardModel["columns"][number]> = {}): BoardModel["columns"][number] {
  return { id: "in_progress", name: "In progress", pinned: false, cards: [], atCap: false, membership: false, ...overrides };
}

function baseProps(overrides: Partial<BoardViewProps> = {}): BoardViewProps {
  return {
    studio: "epoch0",
    model: { columns: [], unplaced: [] },
    focusedByColumn: {},
    onSelectCard: () => undefined,
    ...overrides,
  };
}

// ===========================================================================
// Behaviour 5
// ===========================================================================

// Column heads render in order, each with its count as text.
{
  const model: BoardModel = {
    columns: [
      column({ id: "needs_you", name: "Needs you", pinned: true, membership: true, cards: [] }),
      column({ id: "planned", name: "Planned", cards: [card({ id: "W-1" }), card({ id: "W-2" })], backlogCount: 3 }),
      column({ id: "in_progress", name: "In progress", cards: [card({ id: "W-3" })], cap: 2 }),
    ],
    unplaced: [],
  };
  const html = renderToStaticMarkup(BoardView(baseProps({ model })));
  // Column-head blocks specifically (the strip repeats the same names+counts
  // earlier in the markup, so a bare html.indexOf(name) would find the strip
  // instead — this regex anchors on the column-head wrapper).
  const headCount = (name: string): number | undefined => {
    const re = new RegExp(`<div class="board__column-head"[^>]*><span class="board__column-name">${name}</span><span class="board__column-count">(\\d+)</span>`);
    const m = re.exec(html);
    return m ? Number(m[1]) : undefined;
  };
  const headPos = (name: string): number => html.indexOf(`<span class="board__column-name">${name}</span>`);
  const positions = ["Needs you", "Planned", "In progress"].map(headPos);
  check(5, "BoardView: every column head present, in order", positions.every((p) => p >= 0) && positions[1]! > positions[0]! && positions[2]! > positions[1]!, JSON.stringify(positions));
  check(5, 'BoardView: Needs you count is "0"', headCount("Needs you") === 0, String(headCount("Needs you")));
  check(5, 'BoardView: Planned count is "2"', headCount("Planned") === 2, String(headCount("Planned")));
  check(5, 'BoardView: In progress count is "1"', headCount("In progress") === 1, String(headCount("In progress")));
}

// One card per opus: title, sella, native state — state on the SAME LINE as
// the sella, title occupies at most two lines' worth of markup (no third
// text row).
{
  const model: BoardModel = { columns: [column({ cards: [card({ id: "W-1", title: "a train build", sella: "builder-a", state: "building" })] })], unplaced: [] };
  const html = renderToStaticMarkup(BoardView(baseProps({ model })));
  check(5, "BoardView: card title present", html.includes("a train build"));
  check(5, "BoardView: card sella present", html.includes("builder-a"));
  check(5, "BoardView: card native state present", html.includes(">building<"), html);
  const metaMatch = /<span class="board__card-meta">(.*?)<\/span>\s*<\/(?:div|span)>/.exec(html);
  check(5, "BoardView: sella and state share one meta line", !!metaMatch && metaMatch[1]!.includes("builder-a") && metaMatch[1]!.includes("building"), html);
  const rows = (html.match(/class="board__card-title"/g) ?? []).length + (html.match(/class="board__card-meta"/g) ?? []).length;
  check(5, "BoardView: no fourth text row on a card (title + one meta line only)", rows === 2, String(rows));
}

// Amber left-rule only on a needs-you card; bad only on a blocked one; both
// -> only bad.
{
  const model: BoardModel = {
    columns: [
      column({
        id: "in_progress",
        cards: [card({ id: "W-1", needsYou: true, blocked: false }), card({ id: "W-2", needsYou: false, blocked: true }), card({ id: "W-3", needsYou: true, blocked: true }), card({ id: "W-4", needsYou: false, blocked: false })],
      }),
    ],
    unplaced: [],
  };
  const html = renderToStaticMarkup(BoardView(baseProps({ model })));
  const cardHtml = (id: string): string => {
    const m = new RegExp(`data-card-id="${id}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-card-id="${id}"`).exec(html);
    return m ? (m[1] ?? m[2] ?? "") : "";
  };
  check(5, "BoardView: needs-you-only card carries the amber class", cardHtml("W-1").includes("board__card--amber"), cardHtml("W-1"));
  check(5, "BoardView: blocked-only card carries the bad class", cardHtml("W-2").includes("board__card--bad"), cardHtml("W-2"));
  check(5, "BoardView: both needsYou and blocked -> only bad", cardHtml("W-3").includes("board__card--bad") && !cardHtml("W-3").includes("board__card--amber"), cardHtml("W-3"));
  check(5, "BoardView: neither -> no state class", !cardHtml("W-4").includes("board__card--amber") && !cardHtml("W-4").includes("board__card--bad"), cardHtml("W-4"));
}

// Planned's backlog footer present with its count, absent at zero.
{
  const withBacklog = renderToStaticMarkup(BoardView(baseProps({ model: { columns: [column({ id: "planned", name: "Planned", backlogCount: 5 })], unplaced: [] } })));
  const noBacklog = renderToStaticMarkup(BoardView(baseProps({ model: { columns: [column({ id: "planned", name: "Planned", backlogCount: 0 })], unplaced: [] } })));
  check(5, "BoardView: Planned's backlog footer shows the count", withBacklog.includes("5 backlogged"), withBacklog);
  check(5, "BoardView: Planned's backlog footer absent at zero", !noBacklog.includes("backlogged"), noBacklog);
}

// Empty officina renders every column plus the colophon.
{
  const model: BoardModel = { columns: [column({ id: "needs_you", name: "Needs you" }), column({ id: "planned", name: "Planned" }), column({ id: "done", name: "Done" })], unplaced: [] };
  const html = renderToStaticMarkup(BoardView(baseProps({ model, studio: "epoch0" })));
  check(5, "BoardView: an empty officina still renders every column", html.includes("Needs you") && html.includes("Planned") && html.includes("Done"), html);
  check(5, "BoardView: an empty officina still renders the colophon", html.includes("epoch0") && /<footer/.test(html), html);
}

// No forbidden visual patterns.
{
  const model: BoardModel = { columns: [column({ cards: [card()] })], unplaced: [] };
  const html = renderToStaticMarkup(BoardView(baseProps({ model })));
  check(5, "BoardView: no border-radius: 999px anywhere", !html.includes("999px"), html);
  check(5, "BoardView: no box-shadow anywhere (flat layer)", !html.includes("box-shadow"), html);
  check(5, "BoardView: no per-project dot class", !/\bpdot\b|project-dot/.test(html), html);
  check(5, "BoardView: no emoji", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), html);
}

// The project selector: disabled, exactly one option = officina.studio, the
// unavailability reason is TEXT, never a title attribute.
{
  const html = renderToStaticMarkup(BoardView(baseProps({ studio: "epoch0", model: { columns: [], unplaced: [] } })));
  const selectMatch = /<select[^>]*class="board__project-select"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  check(5, "BoardView: the project select is present", !!selectMatch, html);
  check(5, "BoardView: the project select is disabled", /<select[^>]*disabled/.test(html), html);
  const options = selectMatch ? [...selectMatch[1]!.matchAll(/<option[^>]*>([^<]*)<\/option>/g)] : [];
  check(5, "BoardView: exactly one option, equal to officina.studio", options.length === 1 && options[0]![1] === "epoch0", JSON.stringify(options));
  check(5, "BoardView: the unavailability reason is visible text", html.includes("one officina per"), html);
  check(5, "BoardView: the reason is never carried only in a title attribute", !/<select[^>]*title="[^"]*officina per/.test(html), html);
}

// role="option" per card; exactly one card per column carries tabIndex={0}.
{
  const model: BoardModel = {
    columns: [
      column({ id: "planned", cards: [card({ id: "W-1" }), card({ id: "W-2" })] }),
      column({ id: "in_progress", cards: [card({ id: "W-3" })] }),
    ],
    unplaced: [],
  };
  const html = renderToStaticMarkup(BoardView(baseProps({ model, focusedByColumn: { planned: "W-1", in_progress: "W-3" } })));
  const optionCount = (html.match(/role="option"/g) ?? []).length;
  check(5, "BoardView: every card carries role=option", optionCount === 3, String(optionCount));
  const zeroTabIndex = (html.match(/tabindex="0"/g) ?? []).length;
  check(5, "BoardView: exactly one tabIndex=0 per column (2 columns -> 2)", zeroTabIndex === 2, String(zeroTabIndex));
}

// Hostile strings stay literal.
{
  const model: BoardModel = { columns: [column({ cards: [card({ id: "W-1", title: HOSTILE, sella: HOSTILE })] })], unplaced: [] };
  const html = renderToStaticMarkup(BoardView(baseProps({ model })));
  check(5, "BoardView: hostile title/sella — no <img tag reaches the markup", !html.includes("<img"), html);
  check(5, "BoardView: hostile title/sella — escaped text is present", html.includes("&lt;img"), html);
}

// (a) Ladder byte-identity + the import that proves reuse.
{
  const standalone = renderToStaticMarkup(GateLadder({ gates: SAMPLE_GATES }));
  const model: BoardModel = { columns: [column({ cards: [card({ gates: SAMPLE_GATES })] })], unplaced: [] };
  const html = renderToStaticMarkup(BoardView(baseProps({ model })));
  check(5, "BoardView: a card's ladder markup equals GateLadder's own output for the same gates", html.includes(standalone), `${standalone}\n---\n${html}`);
  const boardViewSrc = readFileSync(join(SRC, "screens", "BoardView.tsx"), "utf8");
  check(5, "BoardView: source imports GateLadder from ../components/GateLadder.js", /from ["']\.\.\/components\/GateLadder\.js["']/.test(boardViewSrc), boardViewSrc);
}

// (b) Board.tsx's import allowlist + forbidden-identifier set (the
// structural half of TARGET-9's pair — behaviour 7-9's counter is the other).
{
  const boardTsxSrc = readFileSync(join(SRC, "screens", "Board.tsx"), "utf8");
  const boardViewSrc = readFileSync(join(SRC, "screens", "BoardView.tsx"), "utf8");
  const boardDrawerSrc = readFileSync(join(SRC, "screens", "BoardDrawer.tsx"), "utf8");
  const libBoardSrc = readFileSync(join(SRC, "lib", "board.ts"), "utf8");

  const apiImportLine = boardTsxSrc.split("\n").find((l) => l.includes('from "../api.js"') && !l.trim().startsWith("import type"));
  const clause = apiImportLine ? /\{([^}]*)\}/.exec(apiImportLine)?.[1] ?? "" : "";
  const names = clause
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  const expected = ["fetchEvents", "fetchInbox", "fetchOfficina", "fetchOpera", "subscribeLive"].sort();
  check(5, "Board.tsx: imports exactly the five read-only fetchers from ../api.js", JSON.stringify(names) === JSON.stringify(expected), JSON.stringify(names));

  const forbidden = ["postWrite", "submitAnswer", "submitDelegate", "getToken", "setToken", "method:"];
  for (const name of forbidden) {
    check(
      5,
      `Board.tsx/BoardView.tsx/BoardDrawer.tsx/board.ts: none mentions "${name}"`,
      !boardTsxSrc.includes(name) && !boardViewSrc.includes(name) && !boardDrawerSrc.includes(name) && !libBoardSrc.includes(name),
    );
  }
}

// ===========================================================================
// Behaviour 6 — the drawer renders the canvas's sections, in order.
// ===========================================================================

function detail(overrides: Partial<DrawerDetail> = {}): DrawerDetail {
  return {
    id: "W-1",
    title: "pvp-band-fix",
    state: "verifying",
    sella: "builder-a",
    collegium: "engineering",
    gates: [{ id: "sim", name: "Balance sim", status: "failed", human: false }],
    record: [],
    tokensBySella: [],
    events: [],
    ...overrides,
  };
}

// No selection -> no drawer element.
{
  const html = renderToStaticMarkup(BoardDrawer({ detail: undefined, onClose: () => undefined }));
  check(6, "BoardDrawer: no selection -> no drawer element", html === "");
}

// Sections in order: header, banner, gates, events, record.
{
  const d = detail({
    waitingOn: { gate: "owner", name: "Owner decision", petitio: { id: "P-1", from: "builder-a", subject: "accept drift?" } },
    gates: [{ id: "sim", name: "Balance sim", status: "failed", human: false }],
    events: [{ at: "2026-09-25T00:00:00Z", name: "workflow.gate_evaluated", summary: "gate sim failed" }],
    record: [{ label: "blocked_on", value: "owner decision" }],
    tokensDeclared: 1200,
  });
  const html = renderToStaticMarkup(BoardDrawer({ detail: d, onClose: () => undefined }));
  const positions = ["board-drawer__header", "board-drawer__banner", "board-drawer__gates", "board-drawer__events", "board-drawer__record"].map((c) => html.indexOf(c));
  check(6, "BoardDrawer: header, banner, gates, events, record — all present", positions.every((p) => p >= 0), JSON.stringify(positions));
  check(6, "BoardDrawer: sections appear in document order", positions.every((p, i) => i === 0 || p > positions[i - 1]!), JSON.stringify(positions));
}

// The banner appears ONLY when a human gate is pending.
{
  const withBanner = renderToStaticMarkup(BoardDrawer({ detail: detail({ waitingOn: { gate: "owner", name: "Owner decision" } }), onClose: () => undefined }));
  const withoutBanner = renderToStaticMarkup(BoardDrawer({ detail: detail(), onClose: () => undefined }));
  check(6, "BoardDrawer: banner shown when waitingOn is set", withBanner.includes("board-drawer__banner"), withBanner);
  check(6, "BoardDrawer: banner absent when waitingOn is unset", !withoutBanner.includes("board-drawer__banner"), withoutBanner);
}

// With a joined petitio: subject + from, linked. With no petitio: names the
// gate, states no question was asked — never an invented one.
{
  const withPetitio = renderToStaticMarkup(BoardDrawer({ detail: detail({ waitingOn: { gate: "owner", name: "Owner decision", petitio: { id: "P-1", from: "builder-a", subject: "accept drift?" } } }), onClose: () => undefined }));
  check(6, "BoardDrawer: with a petitio — shows its subject", withPetitio.includes("accept drift?"), withPetitio);
  check(6, "BoardDrawer: with a petitio — shows its from", withPetitio.includes("builder-a"), withPetitio);

  const withoutPetitio = renderToStaticMarkup(BoardDrawer({ detail: detail({ waitingOn: { gate: "owner", name: "Owner decision" } }), onClose: () => undefined }));
  check(6, "BoardDrawer: no petitio — names the gate", withoutPetitio.includes("Owner decision"), withoutPetitio);
  check(6, "BoardDrawer: no petitio — states no question was asked", /no question/i.test(withoutPetitio), withoutPetitio);
}

// One gate row per DECLARED probatio; status is a literal WORD in the text
// (stale asserted explicitly); evidence path shown; human gate labelled; a
// gate with no evidence renders no empty link.
{
  const d = detail({
    gates: [
      { id: "sim", name: "Balance sim", status: "stale", human: false, evidence: "ci/sim.log" },
      { id: "owner", name: "Owner decision", status: "pending", human: true },
    ],
  });
  const html = renderToStaticMarkup(BoardDrawer({ detail: d, onClose: () => undefined }));
  check(6, "BoardDrawer: gate row shows the literal status word (stale)", />stale</.test(html) || html.includes(">stale<") || html.includes("stale"), html);
  check(6, "BoardDrawer: gate row shows the evidence path", html.includes("ci/sim.log"), html);
  check(6, "BoardDrawer: a human gate is labelled", /human gate/i.test(html), html);
  check(6, "BoardDrawer: a gate with no evidence renders no empty link", !/<a[^>]*href=""/.test(html), html);
}

// Events render newest-first (detail.events is already reversed upstream;
// BoardDrawer renders in the order given).
{
  const d = detail({
    events: [
      { at: "2026-09-25T00:02:00Z", name: "workflow.gate_evaluated", summary: "newest" },
      { at: "2026-09-25T00:01:00Z", name: "workflow.gate_evaluated", summary: "oldest" },
    ],
  });
  const html = renderToStaticMarkup(BoardDrawer({ detail: d, onClose: () => undefined }));
  check(6, "BoardDrawer: events render in the order given (newest-first upstream)", html.indexOf("newest") < html.indexOf("oldest"), html);
}

// Token split labelled event-derived, beside tokensDeclared; both shown with
// sources named when they disagree; absent with no usage events; declared
// total still shows.
{
  const both = renderToStaticMarkup(BoardDrawer({ detail: detail({ tokensDeclared: 500, tokensBySella: [{ sella: "builder-a", tokens: 300 }] }), onClose: () => undefined }));
  check(6, "BoardDrawer: shows the declared total", both.includes("500"), both);
  check(6, "BoardDrawer: shows the event-derived split, labelled", /event-derived/i.test(both) && both.includes("300"), both);

  const noEvents = renderToStaticMarkup(BoardDrawer({ detail: detail({ tokensDeclared: 500, tokensBySella: [] }), onClose: () => undefined }));
  check(6, "BoardDrawer: with no usage events — split absent, declared total still shows", !/event-derived/i.test(noEvents) && noEvents.includes("500"), noEvents);
}

// An absent record field renders nothing — no undefined, no NaN.
{
  const html = renderToStaticMarkup(BoardDrawer({ detail: detail({ record: [], tokensDeclared: undefined }), onClose: () => undefined }));
  check(6, "BoardDrawer: no undefined/NaN leaks into the markup", !html.includes("undefined") && !html.includes("NaN"), html);
}

// Hostile strings stay literal across title, sella, evidence href, petitio
// subject, record value, event summary.
{
  const d = detail({
    title: HOSTILE,
    sella: HOSTILE,
    gates: [{ id: "sim", name: HOSTILE, status: "failed", human: false, evidence: HOSTILE }],
    waitingOn: { gate: "owner", name: "Owner", petitio: { id: "P-1", from: HOSTILE, subject: HOSTILE } },
    record: [{ label: "note", value: HOSTILE }],
    events: [{ at: "2026-09-25T00:00:00Z", name: "x", summary: HOSTILE }],
  });
  const html = renderToStaticMarkup(BoardDrawer({ detail: d, onClose: () => undefined }));
  check(6, "BoardDrawer: hostile strings everywhere — no <img tag reaches the markup", !html.includes("<img"));
  check(6, "BoardDrawer: hostile strings everywhere — escaped text is present", (html.match(/&lt;img/g) ?? []).length >= 5, html);
}

process.exit(failed ? 1 : 0);
