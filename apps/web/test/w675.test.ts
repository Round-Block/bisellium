import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, "..", "src", "themes", "dracula.css");
const TOKENS = resolve(HERE, "..", "src", "tokens.css");

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

const LEGACY_ALIASES = {
  ink: "color-text-primary",
  "ink-2": "color-text-secondary",
  "ink-3": "color-text-muted",
  rule: "color-surface-selected",
  wash: "color-surface-panel",
  verdigris: "color-action-primary",
  amber: "color-state-warning-indicator",
  ok: "color-state-success-indicator",
  bad: "color-state-error-indicator",
  "severity-blocking": "color-severity-blocking-indicator",
  "severity-blocking-text": "color-severity-blocking-text",
  "severity-high": "color-severity-high-indicator",
  "severity-low": "color-severity-low-indicator",
  "accent-cyan": "color-link",
  "accent-pink": "color-category",
  "accent-purple": "color-heading",
  "accent-yellow": "color-project",
  surface: "color-surface-page",
  transparent: "color-surface-transparent",
  "shadow-drawer": "color-shadow-overlay",
} as const;

const HEX = /#[0-9a-f]{3,8}(?![\p{ID_Continue}-])/giu;
const COLOR_FUNCTION = /(?<![\p{ID_Continue}-])(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|light-dark)\s*\([^;{}]*\)/giu;

test("W-675-b2 behaviour 2: compatibility aliases retain values while colour authorship stays in themes", () => {
  const tokens = readFileSync(TOKENS, "utf8");
  const declared = declarations(tokens);
  for (const [legacy, role] of Object.entries(LEGACY_ALIASES)) {
    assert.equal(declared.get(legacy), `var(--${role})`, `--${legacy} aliases --${role}`);
  }

  const src = resolve(HERE, "..", "src");
  const violations: string[] = [];
  const paletteLeaks: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".css")) {
        const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        const sourcePath = path.slice(src.length + 1);
        const theme = sourcePath.startsWith("themes/");
        if (!theme) {
          for (const match of [...text.matchAll(HEX), ...text.matchAll(COLOR_FUNCTION)]) {
            violations.push(`${sourcePath}: ${match[0]}`);
          }
          for (const match of text.matchAll(/var\(--dracula-[a-z0-9-]+\)/gi)) paletteLeaks.push(`${sourcePath}: ${match[0]}`);
        }
      }
    }
  };
  walk(src);
  assert.deepEqual(violations, [], "no authored colour literal exists outside themes/*.css");
  assert.deepEqual(paletteLeaks, [], "no Dracula palette variable is consumed outside its theme");
});
