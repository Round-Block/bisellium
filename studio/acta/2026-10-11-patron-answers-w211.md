---
id: "2026-10-11-patron-answers-w211"
title: Patron answers — W-211 Defaults
kind: decision
author: producer
at: 2026-10-10T23:27:50Z
---
# Patron answers, W-211 (the source_excludes list is pinned)

Asked after spec review round 2 passed (pipeline work: the Patron answers Defaults before `branch`, production lex §7).

1. A dossier page is what `recordOnly` already calls one (a regular file directly in `docs/design/dossier/` ending `.html`); no second definition.
2. The whole CI-scope test file joins `test:record` (about 14 s more on the records-only path).
3. A PR that adds, renames or deletes a dossier page fails until the same PR updates `source_excludes`; the list edit lands while no opus is between `branch` and `done`.
