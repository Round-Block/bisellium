/**
 * packages/cli/src/rules/design.ts — structural design checks.
 * `design.screen-map`: DIRECTION.md has a screen map section.
 * `design.review-prompt`: the officina carries a review prompt.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding, RuleOpts } from "../check.js";

const SCREEN_MAP_RE = /^##\s+(?:\d+\.\s+)?screen\s+map/im;

export function hasScreenMap(text: string): boolean {
  return SCREEN_MAP_RE.test(text);
}

export function hasReviewPrompt(files: string[]): boolean {
  return files.some((f) => /^prompts\/.*\.md$/i.test(f));
}

export function checkDesign(root: string, opts: RuleOpts): Finding[] {
  const findings: Finding[] = [];

  if (opts.repo) {
    const directionPath = join(opts.repo, "docs/design/DIRECTION.md");
    if (existsSync(directionPath)) {
      const text = readFileSync(directionPath, "utf8");
      if (!hasScreenMap(text)) {
        findings.push({ rule: "design.screen-map", level: "advise", where: "docs/design/DIRECTION.md", message: "missing '## Screen map' section — touchpoint-to-screen mapping required" });
      }
    }
  }

  // Only advise on review prompt when the officina has a design collegium
  if (existsSync(join(root, "leges/design.md"))) {
    const promptsDir = join(root, "prompts");
    let promptFiles: string[] = [];
    try {
      promptFiles = readdirSync(promptsDir).filter((f) => f.endsWith(".md")).map((f) => `prompts/${f}`);
    } catch { /* no prompts dir */ }
    if (!hasReviewPrompt(promptFiles)) {
      findings.push({ rule: "design.review-prompt", level: "advise", where: "prompts/", message: "no review prompt found — persist the Gemini review prompt in prompts/*.md" });
    }
  }

  return findings;
}
