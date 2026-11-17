import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));

function source(path: string): string {
  try {
    return readFileSync(resolve(HERE, "..", "src", path), "utf8");
  } catch {
    return "";
  }
}

const palette = source("screens/officina-palette.css");
const css = `${source("components/w025.css")}\n${palette}`;

function servedRow(behaviour: number): void {
  const result = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      "--config=apps/web/playwright.serve.config.ts",
      "--grep",
      `W-467-b${behaviour}\\s`,
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 280_000 },
  );
  assert.equal(
    result.status,
    0,
    `served Officina palette behaviour ${behaviour} holds: ${result.stdout}${result.stderr}`,
  );
}

test(
  "W-467-b1 behaviour 1: Work in flight takes Home's content palette roles",
  { timeout: 300_000 },
  () => {
    assert.match(
      css,
      /\.officina__title,\s*\.panel--work \.officina__panel-heading\s*{[^}]*color:\s*var\(--color-heading\)/s,
      "Work in flight takes the purple heading, pink category and cyan fact roles",
    );
    assert.match(
      css,
      /\.panel--work \.officina__work-group h3\s*{[^}]*color:\s*var\(--color-category\)/s,
      "phase labels use the pink category role",
    );
    assert.match(
      css,
      /\.panel--work \.officina__value-mono,\s*\.panel--work \.officina__work-group h3 span\s*{[^}]*color:\s*var\(--color-fact\)/s,
      "work identifiers and counts use the cyan fact role",
    );
    assert.match(
      css,
      /\.panel--work \.officina__work-row > span:nth-child\(2\)\s*{[^}]*color:\s*var\(--color-text-secondary\)/s,
      "work titles use the secondary text role",
    );
    assert.doesNotMatch(
      palette,
      /var\(--(?:ink(?:-[23])?|accent-|dracula-)/,
      "the Officina assignment layer consumes meaning-based roles only",
    );
    servedRow(1);
  },
);

test(
  "W-467-b2 behaviour 2: Budget takes Home roles without changing severity",
  { timeout: 300_000 },
  () => {
    assert.match(
      css,
      /\.panel--budget \.officina__panel-heading\s*{[^}]*color:\s*var\(--color-heading\)/s,
      "Budget takes the purple heading, pink category and cyan fact roles",
    );
    assert.match(
      css,
      /\.panel--budget \.officina__collegium-name\s*{[^}]*color:\s*var\(--color-category\)/s,
      "Budget collegia use the pink category role",
    );
    assert.match(
      css,
      /\.panel--budget \.budget-meter__numerals\s*{[^}]*color:\s*var\(--color-fact\)/s,
      "Budget numerals use the cyan fact role",
    );
    assert.match(
      css,
      /\.officina__row--link,\s*\.officina__row--link:visited\s*{[^}]*color:\s*var\(--color-link\)[^}]*text-decoration:\s*underline/s,
      "Officina content links and visited links use the underlined link role",
    );
    assert.doesNotMatch(palette, /\.sidebar/, "the Officina layer does not restyle navigation");
    assert.match(
      css,
      /\.severity-cue--blocking\s*{[^}]*var\(--severity-blocking\)[^}]*}[^]*\.severity-cue--normal\s*{[^}]*border-radius:\s*50%/s,
      "Budget keeps W-427's blocking square and normal hollow circle",
    );
    servedRow(2);
  },
);
