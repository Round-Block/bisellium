import { readFileSync, writeFileSync } from "node:fs";

const handoffPath = "docs/SESSION-HANDOFF.md";
const researchPath = "docs/research/read-efficiency-next-2026-09-29/README.md";
const progressPath = "docs/design/dossier/progress-body.html";
const bodyPath = "docs/design/dossier/body.html";
const dossierDir = "docs/design/dossier";

const handoff = readFileSync(handoffPath, "utf8");
const research = readFileSync(researchPath, "utf8");
const progress = readFileSync(progressPath, "utf8");
const body = readFileSync(bodyPath, "utf8");

if (handoff.includes("## W-109 checkpoint (2026-09-29)")) {
  throw new Error("W-109 handoff checkpoint already present");
}
if (research.includes("## W-109 public source canary (2026-09-29)")) {
  throw new Error("W-109 research checkpoint already present");
}
if (progress.includes("<strong>W-109</strong>")) {
  throw new Error("W-109 progress row already present");
}

const handoffInsert = `
## W-109 checkpoint (2026-09-29)

W-109's one public Luna-low source canary failed with
\`TRANSCRIPT_MISSING\`: one model spawn produced no verified tool calls or
usage. The independent Sol-high censor also returned FAIL, citing terminal
reason-order, the pipe-grandchild test, and incomplete failure metadata. There
was no retry, adoption, or wider evaluation. The worktree remains on
\`.worktrees/maps-lookup-experiment\`, branch \`codex/public-source-canary\`,
commit \`66c0f00\`. W-108 remains FAIL/REFUSED and W-107 remains NO.

A cross-run audit at \`0d995ca\` found optimistic exact-source-line reuse of
7,581/237,951 baseline bytes (3.19%) and 1,419/243,194 candidate bytes
(0.58%), versus the within-run 2.31%/1.77% figures. Receipt suppression cannot
reach the prior 30% target on these tasks. The broader read-reduction goal
remains active; the next pivot is evidence selection and answer completeness
through Bisellium's deterministic context/query seam, with no implementation
success claim.
`;

const researchInsert = `
\n## W-109 public source canary (2026-09-29)

The one public Luna-low canary failed with \`TRANSCRIPT_MISSING\`: one model
spawn occurred, but no production tool calls or usage were verified. The
independent Sol-high censor returned FAIL, citing terminal reason-order, the
pipe-grandchild test, and incomplete failure metadata. There was no retry,
adoption, or wider evaluation. W-108 remains FAIL/REFUSED and W-107 remains
NO.

## Cross-run repeat-body audit (2026-09-29)

The retained audit at commit \`0d995ca\` found 7,581 exact source-line bytes
reused across baseline runs, or 3.19% of 237,951 bytes, and 1,419 bytes
reused across candidate runs, or 0.58% of 243,194 bytes. These are optimistic
ceilings; the existing within-run figures were 2.31% and 1.77%. Receipt
suppression cannot reach the prior 30% target on these tasks, so receipt work
is deferred.

The broader goal remains active. The cheapest useful pivot is evidence
selection and answer completeness through Bisellium's deterministic
context/query seam. This is a direction for a fresh signed scope, not an
implementation-success claim.
`;

const progressMarker = "        <tr><td><strong>W-108</strong>";
const progressRow = `        <tr><td><strong>W-109</strong> &middot; 2026-09-29</td><td><strong>Public-source canary</strong> &mdash; one Luna-low attempt on <code>codex/public-source-canary</code> at <code>66c0f00</code> failed <code>TRANSCRIPT_MISSING</code>; cross-run audit <code>0d995ca</code> measured only 3.19% baseline and 0.58% candidate optimistic exact-source-line reuse.</td><td>Codex Luna canary / Sol-high censor / clerk audit</td><td>FAIL: one spawn, no verified tool calls or usage; censor cited terminal reason-order, pipe-grandchild testing and incomplete failure metadata. No retry, adoption or wider evaluation; pivot to evidence selection and answer completeness.</td></tr>\n`;

const statusLine = "    <span>status <b>W-109 public-source canary FAIL; TRANSCRIPT_MISSING; W-108 REFUSED; W-107 NO; pivot to evidence selection and answer completeness</b></span>";
const statusPattern = /    <span>status <b>W-108 preflight refused;.*?<\/b><\/span>/;
if (!progress.includes(progressMarker)) {
  throw new Error("Unexpected progress source shape");
}
if (!statusPattern.test(body)) {
  throw new Error("Unexpected dossier masthead status shape");
}

writeFileSync(handoffPath, handoff.replace("## W-108 checkpoint (2026-09-29)", `${handoffInsert}\n## W-108 checkpoint (2026-09-29)`));
writeFileSync(researchPath, research + researchInsert);
writeFileSync(progressPath, progress.replace(progressMarker, `${progressRow}${progressMarker}`));
writeFileSync(bodyPath, body.replace(statusPattern, statusLine));

const head = readFileSync(`${dossierDir}/head.html`, "utf8");
writeFileSync(`${dossierDir}/bisellium-dossier.html`, head + body.replace(statusPattern, statusLine));
writeFileSync(`${dossierDir}/bisellium-progress.html`, head.replace("<title>Bisellium Dossier</title>", "<title>Bisellium Progress</title>") + progress.replace(progressMarker, `${progressRow}${progressMarker}`));
