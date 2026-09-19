/**
 * apps/web/src/lib/officinaLayout.test.ts — W-025 behaviour 10.
 */
import { officinaSections } from "./officinaLayout.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---- Behaviour 10: the three data panels are present --------------------
{
  const sections = officinaSections();
  check(10, "officina layout: has postureAndBurn panel", sections.includes("postureAndBurn"), sections.join(","));
  check(10, "officina layout: has processHealth panel", sections.includes("processHealth"), sections.join(","));
  check(10, "officina layout: has lexStatus panel", sections.includes("lexStatus"), sections.join(","));
}

process.exit(failed ? 1 : 0);
