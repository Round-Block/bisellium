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
// W-065 behaviour 17: this file gained a selector because it had none — a
// red recorded against it before had no way to isolate the new delegate
// lines from the ~33 pre-existing ones. Every check here is this file's own
// single concern (does every *_USAGE constant, delegate's included, appear
// in the banner) so the whole file IS behaviour 17's territory; `only`
// simply lets `--behaviour 17` be named explicitly rather than implied.
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (only !== undefined && only !== 17) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
};

// W-064 behaviour 11: the ADOPTION.md sentences this opus adds (`lifecycle`
// on /api/officina, `item=` on /api/events, the limit/since semantics) —
// its own concern, gated the same way behaviour 17's `check` above gates
// itself, so `--behaviour 11` runs only these.
const check11 = (name: string, ok: boolean, detail = "") => {
  if (only !== undefined && only !== 11) return;
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

// A count, not a boolean: `sawAny` only proved the scan wasn't a total
// no-op, so a constant made unparseable (a template literal, a `: string`
// annotation) silently dropped out of coverage instead of failing anything
// — up to 21 of 30 lines, verified by mutation (see the opus's evidence
// log). W-042's new `HALT_USAGE` constant moved it from 31 (which W-031's
// `ci.ts` USAGE constant had moved from 30); more single-line constants
// landed after that without this comment's history being kept current, and
// W-062's new `AMEND_USAGE` constant (`lifecycle.ts`) moves it once more,
// 36 -> 37 in that commit; W-082's verdict writer moves it 37 -> 38. It is
// meant to move only when a deliberate edit
// to a *_USAGE constant's line count — or a whole new constant — moves it,
// in the same commit — the assertion is the thing forcing that edit to be
// conscious.
let seen = 0;
for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const { name, value } of extractUsageConstants(src)) {
    for (const line of value.split("\n")) {
      seen++;
      check(`${file.slice(repo.length + 1)}:${name} line in USAGE`, bannerLines.has(normalize(line)), JSON.stringify(line));
    }
  }
}
check("scanned every known usage constant", seen === 38, `${seen}`);

// W-065 behaviour 17: the contract is documented — this opus's half of it.
// Asserts nothing about the origin tuple, the token-paste flow or the proxy
// statement — those are W-067's paragraphs and W-067's behaviour.
{
  const adoption = readFileSync(join(repo, "docs", "ADOPTION.md"), "utf8");
  const biselliumYmlSection = adoption.slice(adoption.indexOf("\n## bisellium.yml"), adoption.indexOf("\n## ", adoption.indexOf("\n## bisellium.yml") + 1));
  check("ADOPTION.md §bisellium.yml contains tiers:", biselliumYmlSection.includes("tiers:"));
  check("ADOPTION.md §bisellium.yml contains munera:", biselliumYmlSection.includes("munera:"));

  const runningServeSection = adoption.slice(adoption.indexOf("\n## Running serve"), adoption.indexOf("\n## ", adoption.indexOf("\n## Running serve") + 1));
  check("ADOPTION.md §Running serve's write-route list contains POST /api/delegate", runningServeSection.includes("POST /api/delegate"));
}

// W-064 behaviour 11: §Running serve names `lifecycle` on the /api/officina
// line, `item=` on the /api/events line, and states the real limit/since
// semantics — three things the repo had never written down (and revisions 1
// and 2 of the brief each got wrong in a different direction).
{
  const adoption = readFileSync(join(repo, "docs", "ADOPTION.md"), "utf8");
  const runningServeSection = adoption.slice(adoption.indexOf("\n## Running serve"), adoption.indexOf("\n## ", adoption.indexOf("\n## Running serve") + 1));

  const officinaLine = runningServeSection.split("\n").find((l) => l.includes("GET  /api/officina"));
  check11("ADOPTION.md §Running serve's /api/officina line names lifecycle", officinaLine?.includes("lifecycle") === true, officinaLine ?? "(line not found)");

  const eventsLine = runningServeSection.split("\n").find((l) => l.includes("GET  /api/events"));
  check11("ADOPTION.md §Running serve's /api/events line names item=", eventsLine?.includes("item=") === true, eventsLine ?? "(line not found)");

  check11(
    "ADOPTION.md §Running serve states an omitted limit is unlimited",
    /omitted.{0,20}limit.{0,40}unlimited/is.test(runningServeSection),
    "(sentence not found)",
  );
  check11(
    "ADOPTION.md §Running serve states a supplied limit returns the earliest",
    /supplied.{0,80}earliest/is.test(runningServeSection),
    "(sentence not found)",
  );
  check11(
    "ADOPTION.md §Running serve states since is a numeric seq only",
    /since.{0,30}numeric/is.test(runningServeSection),
    "(sentence not found)",
  );
}

process.exit(failed ? 1 : 0);
