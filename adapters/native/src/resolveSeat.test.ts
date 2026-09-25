/**
 * adapters/native/src/resolveSeat.test.ts — W-089 behaviour 3 (core
 * contract): `resolveSeat`, seam S1 — the single authority on what a sella
 * id means against a manifest's `sellae` roster. Kept in its own file (not
 * alongside `seatInstance.test.ts`) so a module-load failure for one
 * function's export is never conflated with the other's — an import or
 * module-load failure is one failure, not a per-behaviour red (engineering
 * lex §2), and this opus's two minting/resolving behaviours must never
 * share one.
 *
 * The seven class-B consumers named in the brief's census
 * (context/talk/tick/delegate/probe/hooks/store) each get their own
 * assertions where they're wired to call this helper — this file pins only
 * the shared authority they all route through.
 */
import { resolveSeat, type SeatLike } from "./index.js";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  [W-089 b3] ${name.padEnd(70)} ${detail}`);
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
    { id: "eng-lead", collegium: "engineering" },
  ] as Row[],
};

const exact = resolveSeat(manifest, "builder");
check("an exact declared template resolves with no instance", exact?.seat.id === "builder" && exact.instance === undefined, JSON.stringify(exact));

const instance = resolveSeat(manifest, "builder.W-089");
check("<seat>.<instance> resolves the seat row and carries the instance", instance?.seat.id === "builder" && instance.instance === "W-089", JSON.stringify(instance));

const hyphenatedSeat = resolveSeat(manifest, "builder-codex.W-100");
check("a hyphenated seat id is matched whole, never split on '-'", hyphenatedSeat?.seat.id === "builder-codex" && hyphenatedSeat.instance === "W-100", JSON.stringify(hyphenatedSeat));

const retired = resolveSeat(manifest, "builder-a");
check("a retired row still resolves by exact id (reads must work forever)", retired?.seat.id === "builder-a" && retired.seat.retired === true, JSON.stringify(retired));

const retiredInstance = resolveSeat(manifest, "builder-a.W-200");
check("a retired seat's own instance form also resolves (caller decides policy)", retiredInstance?.seat.id === "builder-a" && retiredInstance.instance === "W-200", JSON.stringify(retiredInstance));

check("an unknown bare id refuses", resolveSeat(manifest, "ghost") === undefined);
check("an unknown seat prefix before the dot refuses", resolveSeat(manifest, "ghost.W-089") === undefined);
check("a misspelled seat prefix refuses", resolveSeat(manifest, "bulider.W-089") === undefined);
check("an empty instance ('builder.') refuses", resolveSeat(manifest, "builder.") === undefined);
check("an empty id refuses", resolveSeat(manifest, "") === undefined);
check("a leading-dot id (empty seat prefix) refuses", resolveSeat(manifest, ".W-089") === undefined);

process.exit(failed ? 1 : 0);
