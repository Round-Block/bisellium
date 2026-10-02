import { readFileSync, writeFileSync } from "node:fs";

const handoffPath = "docs/SESSION-HANDOFF.md";
const progressPath = "docs/design/dossier/progress-body.html";
const bodyPath = "docs/design/dossier/body.html";

const handoff = readFileSync(handoffPath, "utf8");
const progress = readFileSync(progressPath, "utf8");
const body = readFileSync(bodyPath, "utf8");

const handoffMarker = "## W-108 checkpoint (2026-09-29)";
if (handoff.includes(handoffMarker)) {
  throw new Error("W-108 handoff checkpoint already present");
}

const handoffInsert = `
## W-108 checkpoint (2026-09-29)

W-108's deterministic typed-adapter preflight passed behaviours B1-B5, but the
live canary was refused before spawn: the effective Codex tool inventory was
unproven, so model spawns, production tool calls and result bytes were all
zero. The independent Sol-high censor returned FAIL because the executable
live-canary acceptance was missing and the synchronous-hang timeout was not
enforced. This is a harness/preflight failure, not evidence of live usability,
adoption or savings. The implementation remains on
\`.worktrees/maps-lookup-experiment\`, branch \`codex/source-adapter-canary\`,
commit \`5352a79\`. W-107's NO adoption decision remains. The next bounded
step needs a fresh signed scope for a small public-fixture canary that proves
the effective tool inventory and enforces the timeout before any broader trial.
The broader read-reduction objective remains active.
`;

const progressMarker = "        <tr><td><strong>W-107</strong>";
const progressRow = `        <tr><td><strong>W-108</strong> &middot; 2026-09-29</td><td><strong>Typed-adapter preflight</strong> &mdash; deterministic B1-B5 checks passed on <code>codex/source-adapter-canary</code> at <code>5352a79</code>; the live canary was refused before spawn because the effective Codex tool inventory was unproven.</td><td>Codex Sol builder / Terra pre-review / Sol-high censor</td><td>FAIL: the executable live-canary acceptance was missing and the synchronous-hang timeout was unenforced; 0 model spawns, production calls and result bytes. No live usability, adoption or savings claim.</td></tr>\n`;

if (!progress.includes(progressMarker) || progress.includes("<strong>W-108</strong>")) {
  throw new Error("Unexpected progress source shape");
}

const statusLine = "    <span>status <b>W-108 preflight refused; deterministic B1-B5 passed; live canary unproven; Sol-high censor FAIL; no adoption or savings claim; W-107 NO remains</b></span>";
const statusPattern = /    <span>status <b>W-107 no-go;.*?<\/b><\/span>/;
if (!statusPattern.test(body)) {
  throw new Error("Unexpected dossier masthead status shape");
}

writeFileSync(handoffPath, handoff.replace("## W-107 conclusion (2026-09-29)", `${handoffInsert}\n## W-107 conclusion (2026-09-29)`));
writeFileSync(progressPath, progress.replace(progressMarker, `${progressRow}${progressMarker}`));
writeFileSync(bodyPath, body.replace(statusPattern, statusLine));
