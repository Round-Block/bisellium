import { readFileSync, writeFileSync } from "node:fs";

const path = "docs/SESSION-HANDOFF.md";
const text = readFileSync(path, "utf8");
const slashEscape = String.fromCharCode(92);

const w108Pattern = /This is a harness\/preflight failure, not evidence of live usability,[\s\S]*?The broader read-reduction objective remains active\./;
const w108Replacement = "This is a harness/preflight failure, not evidence of live usability, adoption or savings. The W-108 implementation is recorded in branch history at commit 5352a79; its proposed canary continuation is superseded by the W-109 checkpoint above. W-107's NO adoption decision remains. The broader read-reduction objective remains active.";

const badContinuation = "The 12-run mechanical audits are now retained in research" + slashEscape + "/read-efficiency-next-2026-09-29/. Eight runs received every answer-key anchor, but five of those answers were incomplete. Exact repeated source lines were only 2.31% of baseline and 1.77% of candidate response bytes. All 12 candidate production calls returned INVALID_INPUT through a permissive trial MCP schema; 17 fallback calls supplied 178,866 bytes. The proposed typed-adapter canary is superseded by the W-109 checkpoint above. Defer receipts until a repeated-read workload demonstrates meaningful headroom; the current pivot is evidence selection and answer completeness through Bisellium's deterministic context/query seam. W-107 NO adoption stands.";
const goodContinuation = "The 12-run mechanical audits are now retained in research/read-efficiency-next-2026-09-29/. Eight runs received every answer-key anchor, but five of those answers were incomplete. Exact repeated source lines were only 2.31% of baseline and 1.77% of candidate response bytes. All 12 candidate production calls returned INVALID_INPUT through a permissive trial MCP schema; 17 fallback calls supplied 178,866 bytes. The proposed typed-adapter canary is superseded by the W-109 checkpoint above. Defer receipts until a repeated-read workload demonstrates meaningful headroom; the current pivot is evidence selection and answer completeness through Bisellium's deterministic context/query seam. W-107 NO adoption stands.";

if (!w108Pattern.test(text)) {
  throw new Error("W-108 stale paragraph not found");
}
if (!text.includes(badContinuation)) {
  throw new Error("escaped read-consumption continuation not found");
}

writeFileSync(path, text.replace(w108Pattern, w108Replacement).replace(badContinuation, goodContinuation));
