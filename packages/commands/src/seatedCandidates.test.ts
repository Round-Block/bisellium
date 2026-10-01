/**
 * packages/commands/src/seatedCandidates.test.ts — W-089 behaviour 3:
 * `seatedCandidatesFor` (probe.ts) skips a retired row outright — its model
 * is not probed on the strength of a tombstone alone, while a live seat
 * sharing the same model still gets it. Exported the same way
 * `readModelsRecord`/`gatherCandidates` already are, so this needs no
 * `probeBattery` call (no harness, no turns) to exercise the contract.
 */
import { seatedCandidatesFor } from "./probe.js";
import type { Manifest } from "@bisellium/adapter-native";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  [W-089 b3] ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
};

function manifestWith(sellae: Manifest["sellae"]): Manifest {
  return { bisellium: 1, studio: "s", collegia: [], sellae, probationes: [] };
}

{
  const manifest = manifestWith([
    { id: "builder", collegium: "engineering", model: "claude-sonnet-5" },
    { id: "builder-a", collegium: "engineering", model: "claude-sonnet-5", retired: true },
  ]);
  const out = seatedCandidatesFor(manifest);
  check("a retired row contributes no candidate of its own", out.length === 1, JSON.stringify(out));
  check("the live row's model is still a candidate", out.some((c) => c.id === "claude-sonnet-5" && c.harness === "claude-code"), JSON.stringify(out));
}

{
  const manifest = manifestWith([{ id: "builder-a", collegium: "engineering", model: "claude-sonnet-5", retired: true }]);
  const out = seatedCandidatesFor(manifest);
  check("a manifest with only a retired seat yields no candidates at all", out.length === 0, JSON.stringify(out));
}

process.exit(failed ? 1 : 0);
