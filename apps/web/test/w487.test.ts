import assert from "node:assert/strict";
import test from "node:test";
import { boardModel } from "../src/lib/board.js";
import type { InboxResponse, OfficinaResponse, OpusEntry } from "../src/api.js";

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
