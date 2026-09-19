/**
 * apps/web/src/lib/posture.test.ts — W-025 behaviour 7.
 */
import { formatPosture, type AerariumEntry } from "./posture.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---- Behaviour 7: posture panel shows the posture word, with its reason
// beneath it -------------------------------------------------------------
{
  const entry: AerariumEntry = {
    collegium: "engineering",
    period: "2026-W38",
    allowance: { tokens: 3_000_000 },
    burn: { tokens: 1_084_475 },
    posture: "ok",
  };
  const { word, reason } = formatPosture(entry);
  check(7, "posture: word is the posture itself", word === "ok", word);
  check(
    7,
    "posture: reason names burn, allowance and period",
    reason === "1084475 / 3000000 tokens this 2026-W38",
    reason,
  );
}

process.exit(failed ? 1 : 0);
