/**
 * apps/web/test/inboxLogic.test.ts — W-024 behaviours 5, 6, 7 and 8: the
 * Inbox's keyboard/submission model, tested as pure functions (no DOM).
 *
 * An optional behaviour number as `process.argv[2]` (`bisellium red`'s
 * one-behaviour-per-log contract) restricts which behaviour's checks run;
 * omitted, all of this file's behaviours run.
 */
import { answerOptions, buildReply, canSubmit, moveFocus, nextExpanded, resolveVerbAction } from "../src/screens/inboxLogic.js";

const only = process.argv[2] ? Number(process.argv[2]) : undefined;

let failed = 0;
const check = (behaviour: number, name: string, ok: boolean, detail = "") => {
  if (only !== undefined && behaviour !== only) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
};

// behaviour 5: j/k move focus, clamped at the list boundaries.
check(5, "moveFocus: j advances", moveFocus(0, 3, "j") === 1);
check(5, "moveFocus: k retreats", moveFocus(1, 3, "k") === 0);
check(5, "moveFocus: k on first item stays on first", moveFocus(0, 3, "k") === 0);
check(5, "moveFocus: j on last item stays on last", moveFocus(2, 3, "j") === 2);
check(5, "moveFocus: empty list stays at 0", moveFocus(0, 0, "j") === 0);

// behaviour 6: Enter expands the focused item, Esc collapses.
check(6, "nextExpanded: Enter expands the focused item", nextExpanded(null, "P-1", "Enter") === "P-1");
check(6, "nextExpanded: Esc collapses back to a row", nextExpanded("P-1", "P-1", "Escape") === null);
check(6, "nextExpanded: an unrelated key leaves state unchanged", nextExpanded("P-1", "P-2", "x") === "P-1");

// behaviour 8: verb buttons are disabled until a non-empty reason exists.
check(8, "canSubmit: empty reason cannot submit", canSubmit("") === false);
check(8, "canSubmit: whitespace-only reason cannot submit", canSubmit("   ") === false);
check(8, "canSubmit: a real reason can submit", canSubmit("looks fine") === true);

// behaviour 7, migrated by W-345: 1/2/3 resolve to approve/decline/followup.
check(7, "resolveVerbAction: '1' on the expanded item resolves to approve", JSON.stringify(resolveVerbAction("1", "P-1", "P-1", "ok")) === JSON.stringify({ petitioId: "P-1", verb: "approve" }));
check(7, "resolveVerbAction: '2' resolves to decline", resolveVerbAction("2", "P-1", "P-1", "ok")?.verb === "decline");
check(7, "resolveVerbAction: '3' resolves to followup", resolveVerbAction("3", "P-1", "P-1", "more detail")?.verb === "followup");
check(7, "resolveVerbAction: ignored when the item isn't expanded", resolveVerbAction("1", null, "P-1", "ok") === null);
check(7, "resolveVerbAction: ignored without a reason (behaviour 8)", resolveVerbAction("1", "P-1", "P-1", "") === null);
check(7, "resolveVerbAction: ignored for a key with no verb", resolveVerbAction("4", "P-1", "P-1", "ok") === null);

// the constructed reply text a verb submission sends.
check(7, "buildReply: verb prefix plus trimmed reason", buildReply("approve", "  looks good  ") === "approve: looks good");
check(7, "buildReply: followup is trimmed open text without a verdict prefix", buildReply("followup", "  What about QA?  ") === "What about QA?");
check(7, "answerOptions: followup selects the existing ask-back record form", answerOptions("followup")?.askBack === true);

process.exit(failed ? 1 : 0);
