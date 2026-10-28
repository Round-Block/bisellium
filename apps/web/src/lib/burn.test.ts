/**
 * apps/web/src/lib/burn.test.ts — W-025 behaviour 6.
 */
import { burnMeasure } from "./burn.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---- Behaviour 6, superseded by W-408 revision f: a clamped, classified pie
// plus exact overage, with visible numerals and shape as its equivalents. ---
{
  check(6, "burn: under allowance uses the normal uncoloured state below the approaching threshold", burnMeasure(50, 200)?.fraction === 0.25 && burnMeasure(50, 200)?.state === "normal" && burnMeasure(50, 200)?.severity === "normal", JSON.stringify(burnMeasure(50, 200)));
  check(6, "burn: approaching uses high/Orange from 80 percent", burnMeasure(160, 200)?.state === "approaching" && burnMeasure(160, 200)?.severity === "high", JSON.stringify(burnMeasure(160, 200)));
  check(6, "burn: exactly at allowance is full high/Orange but not over", burnMeasure(200, 200)?.fraction === 1 && burnMeasure(200, 200)?.over === false && burnMeasure(200, 200)?.state === "spent" && burnMeasure(200, 200)?.severity === "high");
  check(6, "burn: past allowance is full blocking/Red and names exact overage", burnMeasure(250, 200)?.fraction === 1 && burnMeasure(250, 200)?.over === true && burnMeasure(250, 200)?.overBy === 50 && burnMeasure(250, 200)?.state === "over" && burnMeasure(250, 200)?.severity === "blocking");
  for (const [spent, allowance] of [[-10, 200], [10, 0], [null, 200], [10, "200"], [Number.NaN, 200]] as const) {
    check(6, `burn: malformed ${String(spent)} / ${String(allowance)} is unavailable`, burnMeasure(spent, allowance) === undefined);
  }
}

process.exit(failed ? 1 : 0);
