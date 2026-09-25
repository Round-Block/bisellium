/**
 * adapters/native/src/seatInstance.test.ts — W-089 behaviour 4: the
 * `seatInstance` minter, seam S2 — the single authority that joins a
 * resolved live builder template to an opus id. Kept in its own file (see
 * resolveSeat.test.ts's header) so a module-load failure here is never
 * conflated with resolveSeat's own red.
 */
import { resolveSeat, seatInstance, type SeatLike } from "./index.js";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  [W-089 b4] ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
};

interface Row extends SeatLike {
  collegium: string;
}
const manifest = {
  sellae: [
    { id: "builder", collegium: "engineering" },
    { id: "builder-codex", collegium: "engineering" },
    { id: "builder-a", collegium: "engineering", retired: true },
  ] as Row[],
};

check("mints <seat>.<opus> exactly", seatInstance("builder", "W-089") === "builder.W-089");
check("refuses an empty seat id", seatInstance("", "W-089") === undefined);
check("refuses an empty opus id", seatInstance("builder", "") === undefined);
check("refuses a doubled dot", seatInstance("builder.", ".W-089") === undefined);
check("refuses an id that would fail ID_RE (a raw '@')", seatInstance("builder", "W@89") === undefined);

for (const seat of manifest.sellae) {
  for (const opus of ["W-089", "W-1", "w-legacy_1.2"]) {
    const minted = seatInstance(seat.id, opus);
    const round = minted !== undefined ? resolveSeat(manifest, minted) : undefined;
    check(`round-trip: seatInstance("${seat.id}", "${opus}") resolves back to the same seat`, round?.seat.id === seat.id && round.instance === opus, JSON.stringify({ minted, round }));
  }
}

process.exit(failed ? 1 : 0);
