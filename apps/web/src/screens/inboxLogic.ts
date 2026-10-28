/** apps/web/src/screens/inboxLogic.ts — the Inbox's keyboard/submission
 * model (DIRECTION.md §5, brief behaviours 5-8), kept free of React so it
 * is unit-testable without a DOM. `Inbox.tsx` is the only caller. */

export type Verb = "approve" | "defer" | "decline" | "delegate";

/** Approve and decline resolve an answer. Defer reuses the endpoint's
 * ask-back form, records its verdict prefix and leaves the thread awaiting
 * the asker's reply. Delegate has no key or write until a record route exists. */
export const VERB_KEYS: Readonly<Record<string, Verb>> = {
  "1": "approve",
  "2": "defer",
  "3": "decline",
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

/** Resolve actions carry their verdict as a fixed reply prefix. Defer's
 * distinct open-thread effect is carried by `askBack: true`. */
export function buildReply(verb: Verb, reason: string): string {
  return `${verb}: ${reason.trim()}`;
}

export function answerOptions(verb: Verb): { askBack: true } | undefined {
  return verb === "defer" ? { askBack: true } : undefined;
}

export function recordedEffect(verb: Verb, petitioId: string): string {
  if (verb === "defer") return `Recorded defer answer for ${petitioId}; the petition remains open awaiting the asker's reply.`;
  return `Recorded ${verb} answer for ${petitioId}; the petition is resolved.`;
}

const INBOX_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Stable notification date shared by the Inbox and its W-408 consumer. */
export function datePresentation(opened: number | undefined): string {
  if (opened === undefined || !Number.isFinite(opened)) return "Date unavailable";
  return INBOX_DATE_FORMAT.format(new Date(opened));
}

export interface EvidenceLink { label: string; href: string; actionable: boolean }

export type AskBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "unordered"; items: string[] }
  | { kind: "ordered"; items: string[] };

export const INBOX_READ_STORAGE_KEY = "bisellium.inbox.read";

const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Reading prose shows a Markdown link once, as its human label. The target is
 * represented separately on the Evidence line when its form is recognised. */
export function askText(body: string): string {
  return body.replace(MARKDOWN_LINK, (_whole, label: string) => label.trim());
}

/** The Inbox intentionally supports only prose and the two Markdown list
 * forms needed for a long decision ask. React escapes every value, so raw
 * HTML and all other Markdown stay inert text. */
export function askBlocks(body: string): AskBlock[] {
  const blocks: AskBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<AskBlock, { items: string[] }> | undefined;
  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: askText(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list === undefined) return;
    blocks.push(list);
    list = undefined;
  };

  for (const line of body.split(/\r?\n/)) {
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered !== null) {
      flushParagraph();
      if (list?.kind !== "unordered") {
        flushList();
        list = { kind: "unordered", items: [] };
      }
      list.items.push(askText(unordered[1] ?? ""));
      continue;
    }
    if (ordered !== null) {
      flushParagraph();
      if (list?.kind !== "ordered") {
        flushList();
        list = { kind: "ordered", items: [] };
      }
      list.items.push(askText(ordered[1] ?? ""));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** A malformed or unfamiliar local value is rejected as an empty read set.
 * Storage access itself is wrapped by Inbox.tsx because browsers may deny it. */
export function decodeInboxReadSet(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || id.length === 0)) return new Set();
    return new Set(value);
  } catch {
    return new Set();
  }
}

export function encodeInboxReadSet(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}

/** Explicit HTTP(S) evidence remains actionable. Anchor and repository-relative
 * evidence is classified for a visible unavailable reference, never an anchor. */
export function evidenceLinks(body: string): EvidenceLink[] {
  const links: EvidenceLink[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(MARKDOWN_LINK)) {
    const label = match[1]?.trim() ?? "";
    const href = match[2]?.trim() ?? "";
    if (!label || !/^(?:https?:\/\/|#|\.\.\/|\.\/|(?:docs|studio|ci|opera|petitiones)\/)/.test(href) || seen.has(href)) continue;
    seen.add(href);
    links.push({ label, href, actionable: /^https?:\/\//.test(href) });
  }
  return links;
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
