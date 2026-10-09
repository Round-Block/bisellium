---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

What a fresh orchestrating session must know that the code does not say.
Read after CLAUDE.md. Durable rules live in `studio/leges/production.md`;
this file holds only current state. Keep it short; move anything durable
into a lex, a decision or a check rule and delete it here.

Rules, process and environment: studio/leges/production.md.

## Resume point (2026-10-10)

- W-168, W-197 and W-199 are done, with their retros filed (L-106 to
  L-115) and the Status, dossier and architecture pages republished.
  W-197's Patron setup is done (ruleset checked 2026-10-10: agents push as
  `bisellium-agent`; code-owner review and stale-approval dismissal are on).
- **Next:** W-186 is in spec review: the signed brief
  (`studio/briefs/W-186.md`) and its signature log
  (`studio/ci/W-186-spec-1.log`) sit uncommitted in the main checkout until
  `next` lands them; round 2 failed, the architect revises for round 3.
  Then W-204, as the Queue ranks them.
- Patron idea to explore, 2026-10-09: write specs ahead of the build. The
  producer's advice: Codex drafts ahead freely; sign and review ahead only
  where Files owned overlap nothing earlier in the queue; before a build,
  re-review only what changed in its Files owned since signing (could join
  W-169's overlap check). Not yet ruled; bring it to the Patron.
- `.git/worktrees/{W-167,loop-state,cascade-loop}` cannot be pruned
  (sandbox mounts); harmless.

## Concurrency readiness

Left before more than one lane (production lex §11): Queue's
multi-lane prep item (W-169 last) and W-093; work stays on
one lane until both land. Lex §11's range "W-178 to W-183" also covers
W-179 (see Open Patron choices).

## Artifacts

- Status: https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
- Architecture: https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN
- Design direction: https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- UI canvas (Patron-editable):
  https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f

## Queue

The ranked order, Patron 2026-10-09 (recorded in
`studio/acta/2026-10-09-queue-review.md`); W-186 moved to item 1 and W-203
added (Patron 2026-10-09); W-201 and W-200 were added after it (D-052),
slotted by the producer as a default the Patron may veto.

1. W-186 — a stale handoff is refused.
2. W-204 — next stops holding a build review after three failed rounds
   (D-053, review caps removed; slotted by the producer, veto-able).
3. W-203 — a records-only change takes the records-only CI path in the merge
   queue too (records PRs take 25-40 minutes today).
4. W-201 — the mutation check gates build review (D-052).
5. W-200 — set up the Chaos collegium (D-052; the architect specs it).
6. W-196 — spec reviews converge in fewer rounds.
7. W-185 — records checked once at load (D-049; the architect specs it).
8. W-172, W-171 — high-severity fixes.
9. Multi-lane prep: W-178, W-180, W-182, W-193, W-181, W-183, then W-169
   (switches lanes on, once W-093 has landed and the W-179 question in
   Open Patron choices is settled).
10. W-068 — task dependencies (signed brief to restore:
   `~/.bisellium-evidence/partial-specs/W-068.md` → `studio/briefs/W-068.md`,
   add `Red order: one at a time`, architect re-signs, then spec review).
11. W-081, W-099 — security fixes; W-093 (security review on every change).
12. W-173, W-174, W-184, W-195; then W-164, W-165, W-187, W-189, W-190,
    W-191, W-192, W-194, W-198.
13. W-158, W-133, W-115, W-117 then W-116, the Seats pass (W-154, W-091,
    W-090), W-143, W-144, W-157, W-145, W-136, W-146, W-160, W-135, then
    the medium and low fixes W-038, W-040, W-045, W-051, W-058, W-066,
    W-073, W-074, W-080, W-083, W-086, W-094, W-098.

Greenlit, not yet ranked (next queue review): W-070, W-078, W-113,
W-118 (split only, after W-160 and W-068; the Patron greenlights each
piece), W-147, W-149, W-150, W-151,
W-159, W-177.

## Open Patron choices

- Lex §11's prerequisite range "W-178 to W-183" includes W-179, but the queue
  review left it for later: greenlight W-179, or amend the lex to drop it.
- W-202 (backlog): the ledger opening page as the console's first view,
  with a phone view (scope and DIRECTION.md rulings 2026-10-10). The Patron
  slots it at the next queue review.
- W-138's rescope: usage is read only from harness logs (W-122 declined);
  it becomes W-202's cost data and depends on W-136. The producer drafts the
  new title and scope; the Patron approves or declines it.
