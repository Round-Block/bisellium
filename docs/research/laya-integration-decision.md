---
kind: research
date: 2026-09-23
status: decided
---

# Laya integration decision

**Do not integrate Laya with Bisellium.** Every seam the handoff names —
model selection, readiness assessment, failure triage — is already a
deterministic mechanism or a standing human decision in Bisellium, and
Laya's own local evaluation shows it losing to a five-line keyword rule on
the exact classification task (category / review-routing) that would be the
integration point.

## What Laya actually is, verified

`work/task_eval/policy.py`'s `assess()` and the fixtures in
`work/task_eval/fixtures.json` show the shape precisely: Laya's "heads" are
a local classifier producing two labels per task — `category`
(narrative/economy/validation) and `review` (automated/human/independent) —
compared against a handwritten keyword-matching function of the same shape.
On the frozen 12-task set (`docs/TASK_ROUTING_EVAL_REPORT.md`,
`outputs/task_eval/summary.json`): rules scored 7/8 dev + 3/4 holdout
(10/12 joint); Laya scored 3/8 dev + 1/4 holdout (4/12 joint), CPU mean
454.82 ms/task. The gap is partly taxonomy noise (Laya's `category` head
offers `routing` where the fixture's Q-tasks expect the underlying studio
job), but even generously read this is a small, uncalibrated, single-batch
result with authors overlapping rules and labels — not evidence Laya adds
classification value anywhere. `docs/FREE_ROUTE_FAILURE_DIAGNOSIS.md` and
the `coverage.json` route ledger are provider-plumbing diagnostics (timeouts,
HTTP 429/400), not evidence about Laya's heads at all — irrelevant to this
decision.

## Where the three candidate seams actually live in Bisellium

**Model selection.** Not a runtime decision anywhere in the code. Each
sella's model is a static field in `studio/bisellium.yml`
(`{ id: builder-a, ..., model: claude-sonnet-5 }`), set by `D-014`
("Model pair: Sonnet 5 builds, Opus 5 for opus-tier roles"), a Patron
decision with its own `kill_when` clause ("retro usage sections show one
generation consistently underperforming ... for 2 consecutive cascades").
`packages/commands/src/talk.ts`'s `performTalk` resolves a harness from
`sellaRow.harness ?? "claude-code"` — config lookup, no classification.
There is no per-task router for a head to out-perform; the studio has
already decided that model choice is a role-tier decision revisited by
retro evidence, not an automated one.

**Gate kind / review routing** (Laya's `Q01–Q03`, the
mechanical/human/stronger-review fixtures). This is exactly
`studio/bisellium.yml`'s `probationes: [{kind: automated,...}, {kind: agent,...}, {kind: human,...}]`,
fixed at manifest-authoring time, enforced by `packages/cli/src/rules/*.ts`
and `check.ts`. `packages/commands/src/query.ts`'s `needsYouAnswer` reads
`kind: human` gates straight from the manifest. Nothing classifies a task
into a review lane at runtime — the lane is declared once, per gate, and a
check rule (not a model) enforces it.

**Readiness assessment.** `packages/commands/src/verify.ts`'s `runVerify`
runs each automated probatio's actual command (`npm test`, lint, typecheck)
against the real tree and writes `status/evidence/certifies` back into the
opus's front matter — ground truth from execution, not a prediction. Human
gates (`review`, `spec`) are closed by `censor`, the studio's single review
and QA gate (D-014), an Opus-tier agent already doing the judgment call —
verdicts recorded in `studio/ci/*-review-*.log` and mirrored into the
opus's `probationes.review` front matter (e.g. `W-026`: 8 review rounds,
final `status: passed`, `model: claude-opus-5`).

## Could review-round history train a triage head anyway?

Checked concretely, since the handoff asks for it. 52 review logs cover 19
distinct opera; round counts run 1–8 (`W-026` highest). Only ~31 of 43
opera are `done` with a recorded final verdict — the usable label set caps
around 19–31 examples, single-studio, single-domain. Verdict formatting is
inconsistent across logs (`verdict: FAIL`, `VERDICT: failed`,
`# verdict: PASS`, prose verdicts embedded mid-log) — no clean schema to
train or score against without a normalization pass first. That is too
small and too unclean to support any predeclared threshold, and Laya's own
4/12-vs-10/12 result gives no reason to expect a model head would beat a
rule read directly off this same data. This does not clear the bar for
"defer for a named evidence gap" either — there's no plausible experiment
design here worth budgeting for.

## Conclusion

No seam is unaddressed. Model selection is a human decision with a written
kill condition; gate routing is a manifest-declared, rule-enforced
constant; readiness is measured by running the real commands; failure
triage is a standing reviewing agent, not a gap. Laya adds a slower,
less-accurate classifier in front of mechanisms that are already either
deterministic or intentionally human. Recommendation stands until a future
retro shows the *current* mechanisms failing on their own terms (e.g. D-014's
kill_when firing, or review-round counts climbing without cause) — that
would motivate re-examining automation there, but it would not, on this
evidence, point back at Laya.

## Task ledger (per `docs/HANDOFF_CLAUDE_FABLE.md`)

| # | Item | Status |
|---|---|---|
| — | Decision memo: do-not-integrate / defer / narrow integration | **verified** — this document, produced from direct reads of both codebases, no new eval runs |
| 1 | Audit pending git instructions/repo state (Laya side) | not attempted — Laya is not a git repo; out of this memo's scope |
| 2 | Clarify Laya taxonomy on a fresh dev set + untouched holdout | not started — would be a new evaluation run, out of scope here |
| 3 | Design harder project-native Epoch0/Yan Mo tasks | not started — design work, no new eval authorized |
| 4 | Evaluate integration question against Bisellium's real baseline | **verified** — read `CLAUDE.md`, `docs/ADOPTION.md`, `bisellium.yml`, `verify.ts`, `talk.ts`, `query.ts`, `context.ts`, `D-014`, 52 review logs, 43 opera files |
| 5 | Keep readiness/failure-triage candidates in shadow mode | **verified** — confirmed no change; Laya remains untouched, unwired |
| 6 | Fix capability-profile representation (mandatory-reasoning control) | not started — implementation task on Laya, excluded by this task's read-only/no-modification constraint |
| 7 | Paired orchestrator comparison (Astra vs rules+worker) | not started — no authorization, no new calls permitted |
| 8 | CPU/GPU stress revisit | not started — explicitly deferred by the handoff itself |

Laya, Epoch0, Yan Mo and Bisellium source were read only; no files under
any of those trees were modified, and no model/API calls were made while
producing this memo.
