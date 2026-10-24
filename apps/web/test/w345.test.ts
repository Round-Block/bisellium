/**
 * W-345: Inbox truth and safety. Each row is added before its implementation
 * so the ordered prototype records one assertion-level red per behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(resolve(WEB, rel), "utf8");

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
