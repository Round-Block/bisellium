/**
 * apps/web/src/lib/nav.test.ts — W-025 behaviour 8.
 */
import { NAV_HEIGHT_PX, needsYouVisible } from "./nav.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---- Behaviour 8: nav within 44px height; needs-you badge visible only
// when count > 0 ---------------------------------------------------------
{
  check(8, "nav: chrome budget height is 44px (DIRECTION.md §3)", NAV_HEIGHT_PX === 44, `${NAV_HEIGHT_PX}`);
  check(8, "nav: badge hidden when needs-you count is 0", needsYouVisible(0) === false);
  check(8, "nav: badge visible when needs-you count > 0", needsYouVisible(3) === true);
}

process.exit(failed ? 1 : 0);
