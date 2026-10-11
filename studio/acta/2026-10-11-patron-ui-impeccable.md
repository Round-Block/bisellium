---
id: "2026-10-11-patron-ui-impeccable"
title: Patron direction — UI/UX takes its cue from impeccable
kind: decision
author: producer
at: 2026-10-11T11:30:00Z
---
# Patron direction: UI/UX takes its cue from impeccable

The Patron, 2026-10-11: "take cue from https://github.com/pbakaus/impeccable for UIUX".

impeccable (Apache-2.0, pinned at commit c63b8dd7dd5a) is a design skill for coding agents: 24 commands (`shape`, `critique`, `audit`, `polish`, `typeset`, `layout`, `colorize`, `harden`, `clarify`, `adapt`, ...), an anti-pattern list aimed at generic AI-generated UI (overused fonts, gray text on colour, pure black or gray, cards nested in cards, bounce easing), and 59 deterministic detector rules (`npx impeccable detect`).

Applied, producer's defaults (veto-able):
- Every `ui-lead` dispatch prompt for a UI opus cites impeccable at the pinned commit. The spec input follows its `shape` step and checks the anti-pattern list. The UI build review runs its `critique`, `audit` and `polish` passes as the checklist.
- UI direction stays the Patron's, and the ui-lead seat (`gpt-6-astra`) still drafts layouts at spec. impeccable shapes how that seat works, not who decides.
- Not done without the Patron's word: installing its plugin or design hook. The hook runs third-party npm code after each UI edit, and hooks run outside the sandbox. Running its detector in CI is pipeline work: the Patron asked for it to be filed, as W-230 (backlog, M4). Its spec waits for the Patron's approval of design and Defaults before `branch`.
