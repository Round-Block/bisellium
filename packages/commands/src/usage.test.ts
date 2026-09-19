/**
 * packages/commands/src/usage.test.ts — behaviour 5 (W-030): every
 * per-command `*_USAGE` constant across packages/cli/src and
 * packages/commands/src must appear, line for line, inside the `USAGE`
 * banner. The banner is not generated from these constants (see usage.ts's
 * own comment); this test is what keeps the ~33 of them from drifting away
 * from it instead. It reads source text rather than importing each constant
 * (most are module-private, and exporting ~20 of them just for a test would
 * be its own kind of drift-magnet) — each declaration's string literals are
 * concatenated in source order, which reproduces the exact runtime value for
 * both banner-style multi-line constants (joined by embedded "\n") and
 * single-line constants split across two literals (joined with none).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { USAGE } from "./usage.js";

const repo = resolve(process.argv[2] ?? ".");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
};

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const unescape = (raw: string): string => raw.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");

/** Every `const XXX_USAGE = <string literal(s) joined by +>;` (or `const
 *  USAGE = ...;`) in `src`, as its reconstructed runtime string value. */
function extractUsageConstants(src: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const declRe = /const\s+([A-Z][A-Z0-9_]*)\s*=([\s\S]*?);/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src))) {
    const name = m[1]!;
    // pause.ts names its two constants USAGE_PAUSE / USAGE_RESUME — prefix,
    // not suffix, the one file that bucks the `*_USAGE` convention.
    if (name !== "USAGE" && !name.endsWith("_USAGE") && !name.startsWith("USAGE_")) continue;
    const litRe = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
    let value = "";
    let lm: RegExpExecArray | null;
    while ((lm = litRe.exec(m[2]!))) value += unescape(lm[1] ?? lm[2] ?? "");
    if (value.startsWith("usage: bisellium") || value.startsWith("       bisellium")) out.push({ name, value });
  }
  return out;
}

// Both `"usage: "` (the banner's and every standalone constant's own first
// line) and the banner's `"       "` continuation-line indent are exactly 7
// characters — stripping it normalizes a per-command constant's own
// "usage: bisellium X ..." to the same "bisellium X ..." the banner carries
// for every command after its first.
const normalize = (line: string): string => (line.startsWith("usage: ") || line.startsWith("       ") ? line.slice(7) : line);
const bannerLines = new Set(USAGE.split("\n").map(normalize));
const bannerFile = join(repo, "packages", "commands", "src", "usage.ts");
const files = [join(repo, "packages", "cli", "src"), join(repo, "packages", "commands", "src")]
  .flatMap(listTsFiles)
  .filter((f) => f !== bannerFile);

let sawAny = false;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const { name, value } of extractUsageConstants(src)) {
    for (const line of value.split("\n")) {
      sawAny = true;
      check(`${file.slice(repo.length + 1)}:${name} line in USAGE`, bannerLines.has(normalize(line)), JSON.stringify(line));
    }
  }
}
check("scan found at least one per-command usage constant", sawAny);

process.exit(failed ? 1 : 0);
