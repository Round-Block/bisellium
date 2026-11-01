import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { boardModel } from "../src/lib/board.js";
import type { AttentionRow } from "../src/lib/board.js";
import { InboxView } from "../src/screens/InboxView.js";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";

(globalThis as { React?: unknown }).React = React;

const officina: Pick<OfficinaResponse, "lifecycle" | "probationes" | "wip_limit"> = {
  lifecycle: {
    id: "opus",
    states: [
      { id: "backlog", name: "Backlog", phase: "backlog" },
      { id: "greenlit", name: "Greenlit", phase: "planned" },
      { id: "building", name: "Building", phase: "in_progress" },
    ],
  },
  probationes: [{ id: "human", kind: "human" }],
};

function opus(id: string, state: string, probationes: OpusEntry["probationes"] = {}): OpusEntry {
  return { id, title: `${id} title`, body: "", kind: "ui", collegium: "design", sella: "builder", state, tokens: 0, probationes, traditio: undefined };
}

test("W-487-b1 behaviour 1: one attention collection combines every ask once per opus plus standalone questions", () => {
  const opera = [
    opus("W-1", "backlog"),
    opus("W-2", "building", { human: { status: "pending" } }),
    opus("W-3", "greenlit"),
  ];
  const inbox: InboxResponse = {
    opera: [{ id: "W-2", title: "W-2 title", collegium: "design", sella: "builder", traditio: undefined }],
    petitiones: [
      { id: "P-1", opus: "W-1", from: "producer", subject: "First", body: "First question" },
      { id: "P-2", opus: "W-1", from: "producer", subject: "Second", body: "Second question" },
      { id: "P-orphan", opus: "W-404", from: "producer", subject: "Orphan", body: "Orphan question" },
      { id: "P-solo", from: "producer", subject: "Standalone", body: "Standalone question" },
    ],
  };
  const attention = boardModel(officina, opera, inbox).waiting;

  assert.deepEqual(attention.map((item) => item.attentionKey), ["opus:W-1", "opus:W-2", "opus:W-404", "petitio:P-solo"], "greenlight, human gate, linked orphan and standalone question form one ordered collection");
  assert.deepEqual(attention[0]?.asks, [{ kind: "greenlight", count: 1 }, { kind: "inbox", count: 2 }], "two linked questions combine with Greenlight once under their opus");
  assert.equal(attention[0]?.destination, "inbox", "an opus with a question keeps its reply in Inbox");
  assert.equal(attention[1]?.destination, "board", "a Board-only human gate routes to the Board drawer");
  assert.equal(attention[2]?.boardEntry, false, "a linked question without a Board entry remains attention without inventing a Board card");
  assert.equal(attention[3]?.petitio?.id, "P-solo", "an unlinked question remains its own replyable attention item");
  assert.equal(new Set(attention.map((item) => item.attentionKey)).size, attention.length, "the collection has no duplicate attention keys");
});

test("W-487-b2 behaviour 2: Inbox distinguishes replyable questions from Board-owned routes", () => {
  const inbox = readFileSync(resolve("apps/web/src/screens/Inbox.tsx"), "utf8");
  const view = readFileSync(resolve("apps/web/src/screens/InboxView.tsx"), "utf8");

  assert.match(inbox, /attentionCollection\(officina, opera, d\)/, "Inbox refresh consumes the shared attention collection instead of petition rows");
  assert.match(inbox, /Promise\.all\(\[fetchOfficina\(\), fetchOpera\(\), fetchInbox\(\)\]\)/, "Inbox reconciles the collection from the same three reads as Board");
  assert.match(view, /item\.destination === "board"[\s\S]*Opens Board drawer/, "a Board-owned Inbox row names its route instead of imitating a replyable question");
  assert.match(view, /item\.destination === "inbox"[\s\S]*inbox__action-bar/, "an Inbox decision keeps the existing reply controls");
  assert.match(view, /Open Board actions/, "a combined question exposes its additional Board-owned route without duplicating the row");

  const boardItem = (id: string, title: string, waitingSince?: number): AttentionRow => ({
    attentionKey: `opus:${id}`,
    destination: "board",
    boardEntry: true,
    id,
    title,
    sella: "assigned-opus-owner",
    state: "building",
    gates: [],
    needsYou: true,
    asks: [{ kind: "human_gate", count: 1 }],
    nextActor: "patron",
    waitingSince,
    blocked: false,
  });
  const html = renderToStaticMarkup(createElement(InboxView, {
    items: [boardItem("W-known", "Known Board ask", Date.UTC(2026, 9, 27)), boardItem("W-absent", "Undated Board ask")],
    focusIndex: 0,
    reason: "",
    onReasonChange: () => undefined,
    onFocusChange: () => undefined,
    onSubmit: () => undefined,
  }));
  assert.match(html, /inbox__sella">Board<\/span><span class="inbox__date">27 Oct<\/span>[\s\S]*inbox__subject">Known Board ask/, "a Board-owned row shows Board and its known waiting date");
  assert.match(html, /inbox__sella">Board<\/span><span class="inbox__date">–<\/span>[\s\S]*inbox__subject">Undated Board ask/, "a Board-owned row shows an en dash when its waiting date is absent");
  assert.doesNotMatch(html, />assigned-opus-owner</, "a Board-owned row never misidentifies the assigned opus owner as its asker");
});
