/**
 * Acceptance: the sample studio passes `check`; every negative fixture under
 * examples/fixtures fails it with the rule its name promises.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkStudio } from "./check.js";

const repo = resolve(process.argv[2] ?? ".");
let failed = 0;
const report = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(32)} ${detail}`);
  if (!ok) failed++;
};

const sample = checkStudio(join(repo, "examples/sample-studio"));
report("sample-studio", sample.ok, `${sample.blocks} blocking, ${sample.advisories} advisory`);

const fixtures = join(repo, "examples/fixtures");
for (const name of existsSync(fixtures) ? readdirSync(fixtures).sort() : []) {
  const dir = join(fixtures, name);
  const expectPath = join(dir, "EXPECT");
  const expected = existsSync(expectPath) ? readFileSync(expectPath, "utf8").trim() : "";
  const r = checkStudio(dir);
  const hit = r.findings.some((f) => f.level === "block" && f.rule === expected);
  report(name, !r.ok && hit, hit ? `blocked by ${expected}` : `expected block "${expected}", got: ${r.findings.filter((f) => f.level === "block").map((f) => f.rule).join(", ") || "none"}`);
}

process.exit(failed ? 1 : 0);
