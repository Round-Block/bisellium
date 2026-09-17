/**
 * Tests for `bisellium init` and `bisellium new` (W-001). `now` is pinned so
 * the aerarium period and age-based advisories never drift the results.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkStudio } from "./check.js";
import { initStudio } from "./init.js";
import { newItem } from "./new.js";

const NOW = new Date("2026-09-17T13:00:00Z");
let failed = 0;
const report = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
  if (!ok) failed++;
};
const blockIds = (dir: string) =>
  [...new Set(checkStudio(dir, NOW).findings.filter((f) => f.level === "block").map((f) => f.rule))].sort();

const dir = mkdtempSync(join(tmpdir(), "bisellium-init-"));

try {
  const init = initStudio(dir, { now: NOW });
  report("init.ok", init.ok, init.ok ? "created" : init.message);

  const afterInit = checkStudio(dir, NOW);
  report("init.check", afterInit.ok, afterInit.ok ? `0 blocking, ${afterInit.advisories} advisory` : `blocked by ${blockIds(dir).join(", ")}`);

  const first = newItem(dir, { kind: "task", collegium: "production", title: "First item" });
  report("new.first.id", first.ok && first.id === "W-001", `got ${first.id ?? first.message}`);

  const second = newItem(dir, { kind: "task", collegium: "production", title: "Second item" });
  report("new.second.id", second.ok && second.id === "W-002", `got ${second.id ?? second.message}`);

  const afterNew = checkStudio(dir, NOW);
  report("new.check", afterNew.ok, afterNew.ok ? `0 blocking, ${afterNew.advisories} advisory` : `blocked by ${blockIds(dir).join(", ")}`);

  const reinit = initStudio(dir, { now: NOW });
  report("init.refuses.existing", !reinit.ok, reinit.message);

  const badCollegium = newItem(dir, { kind: "task", collegium: "no-such-collegium", title: "Bad" });
  report("new.refuses.unknown.collegium", !badCollegium.ok, badCollegium.message);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
