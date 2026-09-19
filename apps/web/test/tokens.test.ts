/**
 * apps/web/test/tokens.test.ts — W-024 behaviour 1: tokens.css declares
 * all nine colour custom properties and all seven space properties on
 * `:root`, with exact values (DIRECTION.md §3).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(HERE, "..", "src", "tokens.css"), "utf8");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
};

const rootMatch = /:root\s*{([^}]*)}/.exec(css);
const root = rootMatch?.[1] ?? "";

function hasVar(name: string, value: string): boolean {
  const re = new RegExp(`--${name}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*;`, "i");
  return re.test(root);
}

const colors: [string, string][] = [
  ["ink", "#16211E"],
  ["ink-2", "#4A5654"],
  ["ink-3", "#788582"],
  ["rule", "#DDE3E1"],
  ["wash", "#F4F7F6"],
  ["verdigris", "#0B6E5F"],
  ["amber", "#B7791F"],
  ["ok", "#2E9E64"],
  ["bad", "#C64A3A"],
];

for (const [name, value] of colors) {
  check(`tokens.css --${name} is ${value}`, hasVar(name, value));
}

const spaces: [string, string][] = [
  ["sp-1", "4px"],
  ["sp-2", "8px"],
  ["sp-3", "12px"],
  ["sp-4", "16px"],
  ["sp-6", "24px"],
  ["sp-8", "32px"],
  ["sp-12", "48px"],
];

for (const [name, value] of spaces) {
  check(`tokens.css --${name} is ${value}`, hasVar(name, value));
}

process.exit(failed ? 1 : 0);
