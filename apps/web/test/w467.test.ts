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

const css = `${source("components/w025.css")}\n${source("screens/officina-palette.css")}`;

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
    servedRow(1);
  },
);
