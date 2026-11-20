/**
 * packages/commands/src/brief-contract.ts — W-699 (D-245 item 3, F3b): the contract digests of a brief. One sha256 (16 hex)
 * per contract section: Promise/Intent, Behaviours, Input domain, Interfaces, Limits/Defaults, the Files owned path set, and
 * `other`, everything the map below does not name. A spec signature log pins them (`# contract:`, written by `verdict` from
 * the brief it pins); `next` recomputes them from the current brief and compares them with the signature a review read.
 * Free text, never digested: the `# ` title and `Status:` lines before the first `## ` heading, the Files owned prose outside
 * its bullets' backticked spans (every span on a bullet, the path slot and any after it, is in `files`), `## Acceptance` and
 * `## Out of scope`. Text only.
 */
import { createHash } from "node:crypto";
import { ownedFiles, realLines } from "./brief-admission.js";

export const CONTRACT_KEYS = ["intent", "behaviours", "domain", "interfaces", "limits", "files", "other"] as const;
export type ContractKey = (typeof CONTRACT_KEYS)[number];
type Slot = ContractKey | "free";

/** A real `## ` heading's trimmed, lower-cased name and the section it opens; a name not here opens `other`. */
const SECTIONS: Readonly<Record<string, Slot>> = {
  intent: "intent",
  promises: "intent",
  promise: "intent",
  "behaviours to test": "behaviours",
  "input domain": "domain",
  interfaces: "interfaces",
  limits: "limits",
  "stated limits": "limits",
  defaults: "limits",
  "defaults for the patron": "limits",
  "files owned": "free",
  acceptance: "free",
  "out of scope": "free",
};

const digest = (lines: readonly string[]): string => createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);

/**
 * The seven digests of `briefText`. Headings are read from `realLines` (a heading in a fence or comment opens nothing); the
 * text digested is the raw line, end-trimmed, blank lines dropped, so a respaced blank line or trailing space changes nothing.
 * A `### Input domain` heading opens `domain` up to the next real `## ` or `### ` heading; any other `###` stays in its `## `
 * section. A heading line belongs to the section it opens. `files` is the sorted, de-duplicated `ownedFiles` set.
 */
export function contractDigests(briefText: string): Record<ContractKey, string> {
  const raw = briefText.split(/\r?\n/);
  const real = realLines(briefText);
  const parts: Record<Slot, string[]> = { intent: [], behaviours: [], domain: [], interfaces: [], limits: [], files: [], other: [], free: [] };
  let top: Slot | undefined;
  let slot: Slot = "other";
  raw.forEach((line, i) => {
    const r = real[i] ?? "";
    const h = /^(##|###) +(.*\S)\s*$/.exec(r);
    if (h !== null && h[1] === "##") slot = top = SECTIONS[h[2]!.toLowerCase()] ?? "other";
    else if (h !== null) slot = h[2]!.toLowerCase() === "input domain" ? "domain" : (top ?? "other");
    const text = line.trimEnd();
    if (text === "") return;
    // before the first `## `: the `# ` title and `Status:` lines are free, every other line is `other`
    const free = top === undefined && (/^# /.test(r) || /^Status:/.test(r));
    parts[free ? "free" : slot].push(text);
  });
  parts.files = [...new Set(ownedFiles(briefText))].sort();
  return Object.fromEntries(CONTRACT_KEYS.map((k) => [k, digest(parts[k])])) as Record<ContractKey, string>;
}

/** The `# contract:` header value: `intent:<16 hex> behaviours:<16 hex> … other:<16 hex>`, in CONTRACT_KEYS order. */
export function contractHeader(briefText: string): string {
  const d = contractDigests(briefText);
  return CONTRACT_KEYS.map((k) => `${k}:${d[k]}`).join(" ");
}

/** Whether a header value is exactly `contractHeader`'s grammar. */
export const isContractHeader = (value: string): boolean =>
  new RegExp(`^${CONTRACT_KEYS.map((k) => `${k}:[0-9a-f]{16}`).join(" ")}$`).test(value);

/**
 * W-699 (D-246 item 2, handoff-transparent-meet-1119 item 5): the delta rule's switch, `spec: { delta_review: on|off }` in
 * bisellium.yml. `next` lets a re-signature stand only on `on`; a missing or malformed key is no delta (every re-signature
 * orders its review, master's ladder), and `problem` says which, for the `spec.delta_review` check rule to name.
 */
export function readDeltaReview(manifest: unknown): { on: boolean; problem?: string } {
  const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const spec = isDict(manifest) ? manifest["spec"] : undefined;
  if (spec === undefined || (isDict(spec) && spec["delta_review"] === undefined)) return { on: false, problem: "spec.delta_review is missing (on or off)" };
  const v = isDict(spec) ? spec["delta_review"] : undefined;
  if (v === "on" || v === "off") return { on: v === "on" };
  return { on: false, problem: `spec.delta_review must be exactly on or off, not ${JSON.stringify(isDict(spec) ? v : spec) ?? String(v)}` };
}
