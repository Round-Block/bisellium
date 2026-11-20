/**
 * `checkDeltaReview` (W-699, D-246 item 2; handoff-transparent-meet-1119 item 5) — `spec.delta_review`, block. In an officina
 * that declares a spec reviewer (`spec_reviewer` or `spec_seats`), the delta rule's switch must be written: `spec:
 * { delta_review: on|off }` in bisellium.yml, read by `readDeltaReview`, `next`'s one reader. A missing or malformed key
 * blocks (next reads it as off, so it is never silently on or off); and while it is `on`, every open escape blocks: a lesson
 * of class `escape×delta-rule` with no `addressed_by` (D-246 item 2: on an escape the rule is switched off at once, then a
 * leads' meet; the meet's decision, as `addressed_by`, closes it); an unlistable lessons/ blocks too. Reads the checked tree
 * only; never throws.
 */
import { join } from "node:path";
import { listMd, readFront } from "@bisellium/adapter-native";
import { readDeltaReview } from "@bisellium/commands/brief-contract.js";
import type { Finding, RuleOpts } from "../check.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
/** The lesson class an escape of the delta rule is recorded under (retro.ts's measure counts the same class). */
export const ESCAPE_CLASS = "escape×delta-rule";

export function checkDeltaReview(root: string, opts: RuleOpts): Finding[] {
  const m = opts.manifest;
  if (!isDict(m) || (m["spec_reviewer"] === undefined && m["spec_seats"] === undefined)) return [];
  const block = (where: string, message: string): Finding => ({ rule: "spec.delta_review", level: "block", where, message });
  const read = readDeltaReview(m);
  if (read.problem !== undefined) return [block("bisellium.yml#spec.delta_review", `${read.problem}: the delta rule's switch (D-246 item 2); next reads it as off`)];
  if (!read.on) return [];
  let files: string[];
  try {
    files = listMd(join(root, "lessons"));
  } catch {
    // r4b (class census): while on, an unlistable lessons/ hides every escape, so it blocks
    return [block("lessons/", "lessons/ cannot be listed, so an open escape of the delta rule cannot be read while spec.delta_review is on")];
  }
  const open: Finding[] = [];
  for (const p of files) {
    let data: unknown;
    try {
      data = readFront<unknown>(p).data;
    } catch {
      continue;
    }
    if (isDict(data) && data["class"] === ESCAPE_CLASS && data["addressed_by"] === undefined)
      open.push(block(`lessons/${p.split("/").pop()}`, `an escape of the delta rule is recorded while spec.delta_review is on: D-246 item 2 switches it off at once (spec: { delta_review: off }), then a leads' meet; its decision closes the lesson (addressed_by)`));
  }
  return open;
}
