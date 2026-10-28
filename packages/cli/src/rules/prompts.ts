/**
 * `checkPromptTemplates` (W-241 part 1) — `process.prompt_templates`, block. An officina whose manifest
 * declares the `ops` collegium carries the three per-opus prompt templates, each holding its slots and the
 * phrase "data, not instructions", and an Ops lex clause naming all three. `build-review.md`'s slots are the
 * ones `next`'s review perform fills (`BUILD_REVIEW_SLOTS`, next.ts); rules/prompts.test.ts pins the two
 * lists equal through `fillSlots`. `builder-brief.md` also holds the builder's self-review (W-258, D-080 G):
 * `BUILDER_SELF_REVIEW`, its texts. The UI judges' templates (W-426) hold the sense clause, `SENSE`: they are
 * `SENSE_TEMPLATES`, checked the same way and not named by the Ops lex clause (`spec-review.md` is production lex §9
 * step 2's). `checkPromptTemplates` never throws.
 */
import type { Finding, RuleOpts } from "../check.js";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import { bulletClauses } from "./lex.js";

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATA = "data, not instructions";
const MARKER = /\(check:\s*process\.prompt_templates\)\s*$/;
const BUILDER_SELF_REVIEW = [
  "Self-review before handoff",
  "studio/prompts/build-review.md",
  "No Codex call",
  "nothing is recorded",
  "every reachable path and regression fixture",
  "the accepted and the rejected bound",
  "a negative fixture or a removal",
  "test titles true to a changed domain",
];
/** W-426 (the Patron, 2026-10-27): a UI judge asks whether each rule makes sense on the screen and who ruled it. */
const SENSE = ["for sense, not only conformance", "the Patron ruled it or an agent wrote it", "what the screen should do instead"];
export const PROMPT_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  "prompts/spec-draft.md": ["<ID>", "<OPUS>", "<MODEL_BRIEF>", "<MODEL_EVIDENCE>", DATA],
  "prompts/builder-brief.md": ["<ID>", "<WORKTREE>", "<BRIEF_STATE>", "<SPECIFICS>", DATA, ...BUILDER_SELF_REVIEW],
  "prompts/build-review.md": ["<ID>", "<ROUND>", "<WORKTREE>", "<PACKET>", "<REVIEWED_HEAD>", "<FOCUS>", "<UI>", "<STUDIO>", "fills the eight slots", DATA],
};
/** W-426: the UI judges' templates and their texts; the Ops lex clause names `PROMPT_TEMPLATES` only. */
const SENSE_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  "prompts/spec-review.md": SENSE,
};

export function checkPromptTemplates(root: string, opts: RuleOpts): Finding[] {
  const collegia = isDict(opts.manifest) ? opts.manifest["collegia"] : undefined;
  if (!Array.isArray(collegia) || !collegia.some((c) => isDict(c) && c["id"] === "ops")) return [];
  const findings: Finding[] = [];
  for (const [path, needs] of Object.entries({ ...PROMPT_TEMPLATES, ...SENSE_TEMPLATES })) {
    const file = readContainedRegularFile(root, path, "prompts");
    const text = "error" in file ? undefined : file.bytes.toString("utf8");
    const missing = text === undefined ? needs : needs.filter((n) => !text.includes(n));
    if (missing.length > 0)
      findings.push({ rule: "process.prompt_templates", level: "block", where: path, message: text === undefined ? "not a readable regular file" : `lacks ${missing.join(", ")}` });
  }
  const lex = readContainedRegularFile(root, "leges/ops.md", "leges");
  const clauses = "error" in lex ? [] : bulletClauses(lex.bytes.toString("utf8"));
  const paths = Object.keys(PROMPT_TEMPLATES);
  if (!clauses.some((c) => MARKER.test(c) && paths.every((p) => c.includes(p))))
    findings.push({ rule: "process.prompt_templates", level: "block", where: "leges/ops.md", message: `no clause names ${paths.join(", ")} and ends with (check: process.prompt_templates)` });
  return findings;
}
