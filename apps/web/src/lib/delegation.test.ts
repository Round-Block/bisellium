/**
 * apps/web/src/lib/delegation.test.ts — W-065 behaviour 3: the resolver
 * reads from records (see delegation.ts's own header for what's pure vs.
 * what's merged upstream by GET /api/models).
 */
import { availableModels, munusRows, seatRows, tierRows } from "./delegation.js";
import type { OfficinaResponse } from "../api.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(78)} ${detail}`);
  if (!ok) failed++;
}

type Picked = Pick<OfficinaResponse, "sellae" | "tiers" | "munera" | "models">;

// ---- Behaviour 3 --------------------------------------------------------

// seatRows carries kind/model/harness.
{
  const rows = seatRows({ sellae: [{ id: "builder-a", collegium: "engineering", kind: "agent", model: "claude-sonnet-5", harness: "claude-code" }] });
  check(3, "seatRows: carries kind/model/harness", rows.length === 1 && rows[0]?.kind === "agent" && rows[0]?.model === "claude-sonnet-5" && rows[0]?.harness === "claude-code", JSON.stringify(rows));
}

// tierRows returns every declared tier, including one referenced by no munus.
{
  const o: Picked = { sellae: [], tiers: [{ id: "fast", model: "gpt-5.6-luna" }, { id: "orphan", model: "gpt-x" }], munera: [{ id: "aggregation", tier: "fast" }] };
  const rows = tierRows(o);
  check(3, "tierRows: returns every declared tier, including an unused one", rows.length === 2 && rows.some((r) => r.id === "orphan"), JSON.stringify(rows));
}

// munusRows resolves through tiers; an undeclared tier yields tierKnown:
// false, model: undefined, no throw.
{
  const o: Picked = { sellae: [], tiers: [{ id: "fast", model: "gpt-5.6-luna" }], munera: [{ id: "aggregation", tier: "fast" }, { id: "ghost", tier: "nonexistent" }] };
  let rows: ReturnType<typeof munusRows> = [];
  let threw = false;
  try {
    rows = munusRows(o);
  } catch {
    threw = true;
  }
  check(3, "munusRows: does not throw on an undeclared tier", !threw);
  const resolved = rows.find((r) => r.id === "aggregation");
  const unresolved = rows.find((r) => r.id === "ghost");
  check(3, "munusRows: resolves a declared tier's model", resolved?.model === "gpt-5.6-luna" && resolved.tierKnown === true, JSON.stringify(resolved));
  check(3, "munusRows: an undeclared tier yields tierKnown:false, model:undefined", unresolved?.tierKnown === false && unresolved.model === undefined, JSON.stringify(unresolved));
}

// availableModels: a record entry keeps its state/harness/vendorDiagnostic.
{
  const o: Picked = {
    sellae: [],
    tiers: [],
    munera: [],
    models: [{ id: "claude-fable-5", harness: "claude", state: "unavailable", vendorDiagnostic: "[claude-code:unrecognized_model]" }],
  };
  const rows = availableModels(o);
  const row = rows.find((r) => r.id === "claude-fable-5");
  check(3, "availableModels: a record entry keeps state/harness/vendorDiagnostic", row?.state === "unavailable" && row.harness === "claude" && row.vendorDiagnostic === "[claude-code:unrecognized_model]", JSON.stringify(row));
}

// availableModels: every seated model is present with seated:true whatever
// the record says, and a seated model absent from the record is unverified.
{
  const o: Picked = {
    sellae: [{ id: "builder-a", collegium: "engineering", kind: "agent", model: "claude-opus-5" }],
    tiers: [],
    munera: [],
    models: [{ id: "claude-opus-5", harness: "claude", state: "unavailable" }],
  };
  const rows = availableModels(o);
  const seated = rows.find((r) => r.id === "claude-opus-5");
  check(3, "availableModels: a seated model is always seated:true, whatever the record says", seated?.seated === true, JSON.stringify(seated));

  const o2: Picked = { sellae: [{ id: "x", collegium: "c", kind: "agent", model: "brand-new" }], tiers: [], munera: [], models: [] };
  const rows2 = availableModels(o2);
  const unrecorded = rows2.find((r) => r.id === "brand-new");
  check(3, "availableModels: a seated model absent from the record is unverified", unrecorded?.state === "unverified" && unrecorded.seated === true, JSON.stringify(unrecorded));
}

// availableModels: with the record absent or unparseable (undefined/empty),
// the result is the floor — every row unverified — and nothing throws.
{
  const o: Picked = { sellae: [{ id: "a", collegium: "c", kind: "agent", model: "m1" }], tiers: [{ id: "fast", model: "m2" }], munera: [] };
  let rows: ReturnType<typeof availableModels> = [];
  let threw = false;
  try {
    rows = availableModels(o);
  } catch {
    threw = true;
  }
  check(3, "availableModels: absent record does not throw", !threw);
  check(3, "availableModels: absent record — every row unverified", rows.every((r) => r.state === "unverified"), JSON.stringify(rows));
  check(3, "availableModels: absent record — seated model present", rows.some((r) => r.id === "m1" && r.seated), JSON.stringify(rows));
}

// availableModels: a listing entry alone (no seated/manifest backing) never
// yields "available" on its own say-so — it only carries whatever state the
// (already-merged, upstream) record entry says.
{
  const o: Picked = { sellae: [], tiers: [], munera: [], models: [{ id: "gpt-listed-only", harness: "codex", state: "unverified" }] };
  const rows = availableModels(o);
  const row = rows.find((r) => r.id === "gpt-listed-only");
  check(3, 'availableModels: a listed-but-unprobed candidate stays "unverified"', row?.state === "unverified" && row.seated === false, JSON.stringify(row));
}

// availableModels: dedup + sorted by id.
{
  const o: Picked = {
    sellae: [{ id: "a", collegium: "c", kind: "agent", model: "zeta" }],
    tiers: [{ id: "fast", model: "alpha" }],
    munera: [],
    models: [{ id: "alpha", harness: "codex", state: "available" }],
  };
  const rows = availableModels(o);
  const ids = rows.map((r) => r.id);
  check(3, "availableModels: deduplicated (alpha appears once)", ids.filter((id) => id === "alpha").length === 1, JSON.stringify(ids));
  check(3, "availableModels: sorted by id", JSON.stringify(ids) === JSON.stringify([...ids].sort()), JSON.stringify(ids));
}

process.exit(failed ? 1 : 0);
