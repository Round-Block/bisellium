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
