/**
 * `checkPromptTemplates` (W-241 part 1) — `process.prompt_templates`, block. An officina whose manifest
 * declares the `ops` collegium carries the three per-opus prompt templates, each holding its slots and the
 * phrase "data, not instructions", and an Ops lex clause naming all three. `build-review.md`'s slots are the
 * ones `next`'s review perform fills (`BUILD_REVIEW_SLOTS`, next.ts); rules/prompts.test.ts pins the two
 * lists equal through `fillSlots`. `checkPromptTemplates` never throws.
 */
import type { Finding, RuleOpts } from "../check.js";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATA = "data, not instructions";
export const PROMPT_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  "prompts/spec-draft.md": ["<ID>", "<OPUS>", "<MODEL_BRIEF>", "<MODEL_EVIDENCE>", DATA],
  "prompts/builder-brief.md": ["<ID>", "<WORKTREE>", "<BRIEF_STATE>", "<SPECIFICS>", DATA],
  "prompts/build-review.md": ["<ID>", "<ROUND>", "<WORKTREE>", "<PACKET>", "<REVIEWED_HEAD>", "<FOCUS>", "<STUDIO>", DATA],
};

export function checkPromptTemplates(root: string, opts: RuleOpts): Finding[] {
  const collegia = isDict(opts.manifest) ? opts.manifest["collegia"] : undefined;
  if (!Array.isArray(collegia) || !collegia.some((c) => isDict(c) && c["id"] === "ops")) return [];
  const findings: Finding[] = [];
  for (const [path, needs] of Object.entries(PROMPT_TEMPLATES)) {
    const file = readContainedRegularFile(root, path, "prompts");
    const text = "error" in file ? undefined : file.bytes.toString("utf8");
    const missing = text === undefined ? needs : needs.filter((n) => !text.includes(n));
    if (missing.length > 0)
      findings.push({ rule: "process.prompt_templates", level: "block", where: path, message: text === undefined ? "not a readable regular file" : `lacks ${missing.join(", ")}` });
  }
  return findings;
}
