/**
 * packages/cli/src/rules/design.test.ts — design structural checks:
 * screen map in DIRECTION.md and review prompt in the officina.
 * Pure function tests — no filesystem.
 */

import { hasScreenMap, hasReviewPrompt } from "./design.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
}

// ---- hasScreenMap -----------------------------------------------------------

// behaviour 1: text with a "## Screen map" or "## 8. Screen map" heading passes
{
  const text = "## 6. Per-screen notes\n\n## 8. Screen map\n\n| Screen | Touchpoints |\n";
  check(1, "heading '## 8. Screen map' detected", hasScreenMap(text) === true);
}

// behaviour 2: text with no screen map heading fails
{
  const text = "## 6. Per-screen notes\n\nInbox — a queue.\n\n## 7. Rejects\n";
  check(2, "no screen-map heading detected", hasScreenMap(text) === false);
}

// behaviour 3: case-insensitive match
{
  const text = "## screen map\n\n| Screen | Touchpoints |\n";
  check(3, "case-insensitive match", hasScreenMap(text) === true);
}

// behaviour 4: numbered heading variant
{
  const text = "## 8. screen map\n\nContent here.\n";
  check(4, "numbered heading '## 8. screen map'", hasScreenMap(text) === true);
}

// ---- hasReviewPrompt --------------------------------------------------------

// behaviour 5: returns true when prompts/review.md exists in file list
{
  check(5, "prompts/review.md in file list", hasReviewPrompt(["prompts/review.md", "leges/design.md"]) === true);
}

// behaviour 6: returns false when no review prompt
{
  check(6, "no review prompt in file list", hasReviewPrompt(["leges/design.md", "leges/qa.md"]) === false);
}

// behaviour 7: returns false for empty list
{
  check(7, "empty file list", hasReviewPrompt([]) === false);
}

process.exit(failed ? 1 : 0);
