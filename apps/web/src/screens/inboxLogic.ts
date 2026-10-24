/** apps/web/src/screens/inboxLogic.ts — the Inbox's keyboard/submission
 * model (DIRECTION.md §5, brief behaviours 5-8), kept free of React so it
 * is unit-testable without a DOM. `Inbox.tsx` is the only caller. */

export type Verb = "approve" | "decline" | "followup";

/** Approve and decline resolve an answer. Follow up uses the endpoint's
 * ask-back form: it records the Patron's unprefixed text, changes the petition
 * to awaiting_reply and returns direction to the original asker. */
export const VERB_KEYS: Readonly<Record<string, Verb>> = {
  "1": "approve",
  "2": "decline",
  "3": "followup",
};

/** Window shortcuts never consume keystrokes intended for a form control or
 * an editable region. Kept structural so the classifier is testable in node
 * without constructing browser DOM globals. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const node = target as { tagName?: unknown; isContentEditable?: unknown };
  const tagName = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || node.isContentEditable === true;
}

/** Petition-keyed drafts prevent a selection change from reusing another
 * petition's reason, while preserving each unfinished draft when navigating. */
export function reasonForPetition(reasons: Readonly<Record<string, string>>, petitioId: string | undefined): string {
  return petitioId === undefined ? "" : (reasons[petitioId] ?? "");
}

export function withReasonForPetition(reasons: Readonly<Record<string, string>>, petitioId: string, value: string): Record<string, string> {
  return { ...reasons, [petitioId]: value };
}

/** j/k move focus one item at a time, clamped so the first item stays put
 * on `k` and the last stays put on `j` (behaviour 5). */
export function moveFocus(index: number, count: number, key: "j" | "k"): number {
  if (count <= 0) return 0;
  const next = key === "j" ? index + 1 : index - 1;
  return Math.max(0, Math.min(count - 1, next));
}

/** A refreshed list may remove the selected petition. Keep the nearest
 * remaining petition selected so its answer controls stay reachable. */
export function reconcileFocusIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

/** `Enter` expands the focused item, `Esc` collapses whatever is expanded
 * (behaviour 6); any other key leaves the expanded id unchanged. */
export function nextExpanded(current: string | null, focusedId: string | undefined, key: string): string | null {
  if (key === "Enter") return focusedId ?? current;
  if (key === "Escape") return null;
  return current;
}

/** A reason is required before a decision can be submitted (DIRECTION.md
 * §4.4: "A decision without a reason cannot be submitted"). Whitespace
 * alone does not count. */
export function canSubmit(reason: string, sending = false): boolean {
  return !sending && reason.trim().length > 0;
}

/** Resolve actions carry their verdict as a fixed reply prefix. Follow up is
 * open text with no verdict; its distinct record effect is carried by
 * `askBack: true` in `answerOptions`. */
export function buildReply(verb: Verb, reason: string): string {
  if (verb === "followup") return reason.trim();
  return `${verb}: ${reason.trim()}`;
}

export function answerOptions(verb: Verb): { askBack: true } | undefined {
  return verb === "followup" ? { askBack: true } : undefined;
}

export function recordedEffect(verb: Verb, petitioId: string): string {
  if (verb === "followup") return `Recorded follow-up reply for ${petitioId}; the petition remains open awaiting the asker's reply.`;
  return `Recorded ${verb} answer for ${petitioId}; the petition is resolved.`;
}

export interface VerbAction {
  petitioId: string;
  verb: Verb;
}

/** Resolves a `1`/`2`/`3` keypress into a submit action: only when the
 * key's verb exists, the focused item is the one currently expanded, and
 * a reason has been entered (behaviour 7 + 8 — no submission is possible
 * without a reason). */
export function resolveVerbAction(
  key: string,
  expandedId: string | null,
  focusedId: string | undefined,
  reason: string,
): VerbAction | null {
  if (focusedId === undefined || expandedId !== focusedId) return null;
  const verb = VERB_KEYS[key];
  if (!verb) return null;
  if (!canSubmit(reason)) return null;
  return { petitioId: focusedId, verb };
}
