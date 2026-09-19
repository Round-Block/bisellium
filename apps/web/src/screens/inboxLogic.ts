/** apps/web/src/screens/inboxLogic.ts — the Inbox's keyboard/submission
 * model (DIRECTION.md §5, brief behaviours 5-8), kept free of React so it
 * is unit-testable without a DOM. `Inbox.tsx` is the only caller. */

export type Verb = "approve" | "defer" | "decline" | "delegate";

/** `1`/`2`/`3` map to approve/defer/decline; delegate has no shortcut
 * (studio/briefs/W-024.md, behaviour 7). */
export const VERB_KEYS: Readonly<Record<string, Verb>> = {
  "1": "approve",
  "2": "defer",
  "3": "decline",
};

/** j/k move focus one item at a time, clamped so the first item stays put
 * on `k` and the last stays put on `j` (behaviour 5). */
export function moveFocus(index: number, count: number, key: "j" | "k"): number {
  if (count <= 0) return 0;
  const next = key === "j" ? index + 1 : index - 1;
  return Math.max(0, Math.min(count - 1, next));
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
export function canSubmit(reason: string): boolean {
  return reason.trim().length > 0;
}

/** `submitAnswer` has no verb field (`{ petitio, reply }` only) — the verb
 * rides as a fixed prefix on `reply` so the Patron's answer log still
 * reads as approve/defer/decline/delegate plus the reason. */
export function buildReply(verb: Verb, reason: string): string {
  return `${verb}: ${reason.trim()}`;
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
