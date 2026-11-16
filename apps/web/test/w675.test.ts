import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, "..", "src", "themes", "dracula.css");

const ROLE_NAMES = [
  "color-surface-page",
  "color-surface-panel",
  "color-surface-selected",
  "color-surface-transparent",
  "color-text-primary",
  "color-text-secondary",
  "color-text-muted",
  "color-heading",
  "color-link",
  "color-fact",
  "color-category",
  "color-project",
  "color-border-decorative",
  "color-border-interactive",
  "color-focus",
  "color-selection-background",
  "color-selection-text",
  "color-action-primary",
  "color-action-primary-text",
  "color-state-success-indicator",
  "color-state-warning-indicator",
  "color-state-error-indicator",
  "color-severity-blocking-indicator",
  "color-severity-blocking-text",
  "color-severity-high-indicator",
  "color-severity-low-indicator",
  "color-shadow-overlay",
] as const;

function declarations(css: string): Map<string, string> {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const root = /:root\s*{([^}]*)}/s.exec(uncommented)?.[1] ?? "";
  return new Map(
    [...root.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [match[1]!, match[2]!.trim().toLowerCase()]),
  );
}

test("W-675-b1 behaviour 1: Dracula defines the complete meaning-based role set", () => {
  assert.equal(existsSync(THEME), true, "apps/web/src/themes/dracula.css exists");
  const theme = readFileSync(THEME, "utf8");
  const declared = declarations(theme);
  const actualRoles = [...declared.keys()].filter((name) => name.startsWith("color-")).sort();
  assert.deepEqual(actualRoles, [...ROLE_NAMES].sort(), "Dracula declares every role once and no undeclared role");
  assert.match(theme, /--dracula-background\s*:\s*#282a36\s*;/i, "the current page colour stays exact");
  assert.match(theme, /--dracula-foreground\s*:\s*#f8f8f2\s*;/i, "the current primary text stays exact");
  assert.match(theme, /--dracula-product\s*:\s*#3fb9a3\s*;/i, "the recorded product colour stays exact");
  assert.match(
    declared.get("color-severity-blocking-text") ?? "",
    /^color-mix\(in srgb, var\(--color-severity-blocking-indicator\) 75%, var\(--color-text-primary\)\)$/,
    "blocking text remains the recorded derived shade",
  );
});
