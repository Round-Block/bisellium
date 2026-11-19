---
author: qa-lead
kind: decision
title: "Retro input, sessions 54-60"
at: 2026-11-19T12:35:00Z
---

Purpose: the daily retro's input of owed retro points (sessions 54-60), so they need not be carried in session notes again.

## Session 54

Retro points s54 (lessons, D-234): (a) ui-verify-1104/run.sh is not executable: run it via bash (kit 601 exit 126); (b) a checkpoint row takes {{figures}}, never typed figures (kit 604, W-495); (c) a decision's at is the ruling's real time (D-241 first had a future time from my brief); (d) the dry run caught (b) and W-467's master UI ruling before any real write.

## Session 55

Retro s55 (f): never edit a kit script while a runner executes it (kit 618 syntax error); (g) a host red log header must be bare argv (W-503 r13 b6, kit 619). Then Opus ui-spec-reviewer + ui-lead input after the Claude reset (14:00 SGT).

Retro s55 points (lessons at next DR; with s54 a-d): (h) W-503 spec churn (see above); (i) a review run whose packet step fails must stop before the reviewer (run-r21.sh lacks the guard rn-run.sh-style; kit 631 void); (e) a done commit does not carry an untracked ruling decision; land the decision first (kit 616 dry caught it).

## Session 56

Mistakes this session (retro, lessons): (j) took a lead's round number without checking next (kit 636); (k) routed W-531 fixes to the architect without the causal lead (D-241) twice; (l) proposed W-667 without reading its W-666 dependency; (m) missed W-504's spec-ahead for UI2.

## Session 57

Retro points s57: (n) kit 640 prompt asked Earlier findings for an unrecorded round; (o) kit 640 guard -d on a file; (p) kit 644 ran the CLI inside a clone without node_modules; (q) kit 638 shipped a signature over verdict's 8192 cap (no pre-check of size).

## Session 58

Retro points s58: (r) kit 649 omitted --session-reason for a fresh ui-lead session; (s) W-531 brief spelled Files owned short, W-498 hold after build; (t) kit 652 symlinked node_modules in a dry clone dirties the tree; (u) my sign brief asked for r3d's verdict line verbatim (stale revision).

Retro points s58 (r)-(u) above, plus (v): I estimated the collation time wrong in collated.md (fixed).

## Session 59

Retro (x): kit 661 shipped a queue says over the 200-char cap (no pre-check); (y): the clerk collapsed the greenlit lists that handoff-check requires.

Retro points s59: (w) kit 657 runner reported an advisory brief.stale line as the blocking finding; kit 658's baseline diff found the real one (opus.milestone): a new opus needs amend --milestone in the same kit.

## Session 60

Retro (z): kit 663 handoff studio path; (aa): builder brief's next shape.

Retro points s60: (z) kit 663 handoff --studio was the clone's main studio (D-021 needs the worktree's); (aa) my builder brief gave next a worktree --repo (correct: main's --studio/--repo); (bb) W-531 brief did not own the RULE_IDS registry its new check rules require (spec error, eng-lead).

Owner: qa-lead files each as a lesson or folds it per D-234 at the next daily retro; then this file's points are closed.
