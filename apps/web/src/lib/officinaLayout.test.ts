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

// ---- Behaviour 10: colophon appears at scroll-bottom of the Officina
// screen, after the four panels -------------------------------------------
{
  const sections = officinaSections();
  check(10, "officina layout: colophon is the last section", sections[sections.length - 1] === "colophon", sections.join(","));
  check(
    10,
    "officina layout: the four data panels all precede the colophon",
    ["decreta", "postureAndBurn", "lexStatus", "processHealth"].every((s) => sections.includes(s as never) && sections.indexOf(s as never) < sections.indexOf("colophon")),
    sections.join(","),
  );
}

process.exit(failed ? 1 : 0);
