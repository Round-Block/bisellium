/**
 * Acceptance (dossier Part V): the sample studio passes `check` with zero
 * blocking findings; every fixture under examples/fixtures produces EXACTLY
 * the blocking rule set listed in its EXPECT file (one rule id per line; an
 * empty EXPECT means the fixture must pass). `now` is pinned so age-based
 * advisories never drift the results.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkStudio } from "./check.js";

const repo = resolve(process.argv[2] ?? ".");
const NOW = new Date("2026-09-17T12:00:00Z");
let failed = 0;
const report = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
  if (!ok) failed++;
};
const blockSet = (dir: string) => {
  const r = checkStudio(dir, NOW);
  return { r, ids: [...new Set(r.findings.filter((f) => f.level === "block").map((f) => f.rule))].sort() };
};

{
  const { r, ids } = blockSet(join(repo, "examples/sample-studio"));
  report("sample-studio", r.ok, r.ok ? `0 blocking, ${r.advisories} advisory` : `blocked by ${ids.join(", ")}`);
}

const fixtures = join(repo, "examples/fixtures");
for (const name of existsSync(fixtures) ? readdirSync(fixtures).sort() : []) {
  const dir = join(fixtures, name);
  const expectPath = join(dir, "EXPECT");
  if (!existsSync(expectPath)) { report(name, false, "no EXPECT file"); continue; }
  const expected = readFileSync(expectPath, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).sort();
  const { ids } = blockSet(dir);
  const same = ids.length === expected.length && ids.every((x, i) => x === expected[i]);
  report(name, same, same ? (ids.length ? `blocked by ${ids.join(", ")}` : "passes, as expected") : `expected [${expected.join(", ")}] got [${ids.join(", ")}]`);
}

// checkStudio must be total: a non-studio directory yields a result, not a throw
try {
  const r = checkStudio(join(repo, "packages"), NOW);
  report("not-a-studio", r.notAStudio && !r.ok, "manifest.present, no throw");
} catch (e) {
  report("not-a-studio", false, `threw: ${(e as Error).message}`);
}

process.exit(failed ? 1 : 0);
