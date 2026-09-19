/**
 * apps/web/src/lib/gateLadder.test.ts — W-025 behaviours 4-5.
 */
import { gateLadderWidth, gateTitle, markKind, type Gate } from "./gateLadder.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---- Behaviour 4: one 6x6 mark per gate on a 1px rail; width = f(gate
// count); status -> fill mapping ---------------------------------------
{
  // DIRECTION.md §4.1: "Four gates = 33px".
  check(4, "gateLadder: width(4) === 33 (DIRECTION.md §4.1)", gateLadderWidth(4) === 33, `${gateLadderWidth(4)}`);
  check(4, "gateLadder: width(1) === 6 (one mark, no trailing gap)", gateLadderWidth(1) === 6, `${gateLadderWidth(1)}`);
  check(4, "gateLadder: width(0) === 0", gateLadderWidth(0) === 0, `${gateLadderWidth(0)}`);

  const cases: [Gate["status"], ReturnType<typeof markKind>][] = [
    ["passed", "filled"],
    ["pending", "hollow"],
    ["failed", "bad-diagonal"],
    ["human_passed", "ok-filled"],
    ["waived", "half-height"],
  ];
  for (const [status, expected] of cases) {
    check(4, `gateLadder: markKind(${status}) === ${expected}`, markKind(status) === expected, markKind(status));
  }
}

// ---- Behaviour 5: hover title names the gate id and its blocker --------
{
  check(5, "gateLadder: title with a blocker names id and blocker", gateTitle({ id: "spec", status: "failed", blocker: "review" }) === "spec: review");
  check(5, "gateLadder: title with no blocker is just the gate id", gateTitle({ id: "spec", status: "passed" }) === "spec");
}

process.exit(failed ? 1 : 0);
