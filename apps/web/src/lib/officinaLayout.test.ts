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

// ---- Behaviour 10: W-408's Officina-detail sections are present ----------
{
  const sections = officinaSections();
  check(10, "officina layout: has workInFlight panel", sections.includes("workInFlight"), sections.join(","));
  check(10, "officina layout: has budget panel", sections.includes("budget"), sections.join(","));
  check(10, "officina layout: has health panel", sections.includes("health"), sections.join(","));
  check(10, "officina layout: follows the Patron's detail-page order", sections.join(",") === "workInFlight,budget,health", sections.join(","));
}

process.exit(failed ? 1 : 0);
