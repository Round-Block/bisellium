/**
 * apps/web/src/lib/burn.test.ts — W-025 behaviour 6.
 */
import { burnColor, burnFraction } from "./burn.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---- Behaviour 6: two mono numerals + a 4px rule filled to the spent
// fraction; ink under allowance, amber at/past it ------------------------
{
  check(6, "burn: fraction(50, 200) === 0.25", burnFraction(50, 200) === 0.25, `${burnFraction(50, 200)}`);
  check(6, "burn: fraction clamps at 1 when over allowance", burnFraction(250, 200) === 1, `${burnFraction(250, 200)}`);
  check(6, "burn: fraction floors at 0 for a negative spend", burnFraction(-10, 200) === 0, `${burnFraction(-10, 200)}`);
  check(6, "burn: color is ink under allowance", burnColor(50, 200) === "ink", burnColor(50, 200));
  check(6, "burn: color is amber at allowance", burnColor(200, 200) === "amber", burnColor(200, 200));
  check(6, "burn: color is amber past allowance", burnColor(250, 200) === "amber", burnColor(250, 200));
}

process.exit(failed ? 1 : 0);
