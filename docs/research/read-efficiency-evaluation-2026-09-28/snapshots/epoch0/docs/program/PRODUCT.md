# Epoch 0 — Product Canon: The Playable Ladder

**Status: OPERATIVE ORDERING**, ratified by the owner's 2026-09-11
priority ruling ("all these should be next on the list... reconcile
all conflicts and differences") and absorbed into program canon by
this train (TR-program-canon). Source: "The Road to Playable" artifact
(Controller, 2026-09-11, published at
`https://claude.ai/code/artifact/a1147613-3a34-490c-a8f4-5cd75d4f96e9`)
+ the same-day product audit + the engineering-blocker review
(`/home/edckt/pending-briefs/engineering_blockers_review.md`) + Lead
Sync 1's joint disposition (`/home/edckt/pending-briefs/
lead_sync_1_disposition.md`). Reproduced here self-contained per this
train's brief — this file, not the artifact, is the durable record;
the artifact is evidence/presentation, not canon.

This document sits alongside (not above) `docs/superpowers/specs/
2026-08-25-prod-ready-program-design.md` (the program's charter —
finish line, hard stops) and `docs/program/WORKFLOW.md` (process).
PRODUCT.md is the operative ORDERING; the spec's finish line is
unchanged (see its own dated amendment note, added by this train).

---

## 1. The objective (owner's words, verbatim — now the program charter)

> "end to end dev to give me a playable game similar to SW based on our
> own lore and whatever in docs."

Process exists to serve this. Process work that doesn't trace to it is
waste (see §5 Process resets, rule 1).

## 2. Where the game actually stands (2026-09-11 audit)

One line: **the systems game is built; the sensory game is not.** Every
SW-like pillar — collect, teams, campaign, gacha with pity, energy,
dungeons, tower, arena, dailies/weeklies, FTUE, even a supporter pass —
exists, is server-authoritative, tested (3,400+ backend tests, 61
real-input client scenarios), and reachable from Home on a real build.

| Measured | Value |
|---|---|
| Characters live with kits | 174 |
| Stages (campaign+dungeon+tower) | 235 |
| SW-pillar systems wired | 10/10 |
| Particles/VFX in combat | 0 |
| Characters with bespoke 3D models | 8 |
| Characters with portraits | 10 |
| UI for skill-ups (fully built backend) | none |
| Enemy models wearing 132 names | 17 |

The sharpest finding: the genre's core depth loop — ability upgrades /
dupe consumption, ~2,500 lines of per-character ladders, already
returned by the API — has **zero client UI**. Dupes currently have no
purpose. Second sharpest: no Repeat or Sweep in a farming genre. Third:
a fire ultimate and a water ultimate are visually identical, because
combat has no VFX layer at all.

## 3. The Playable Ladder

The existing M-ladder (`docs/program/PROGRAM.md`) stays as the phase
map underneath — see §4's M-ladder mapping. P1-P5 are the product
milestones that reorder the work by what the owner would feel first.
P1 and P2 are deliberately cheap relative to M3 — they make the
existing game legible before the expensive art scales.

### Build stage definitions

The owner challenged a loose use of "alpha" for today's build (2026-09-12,
verbatim: *"are we really at alpha apk with only 1 alpha character
ready?"*) — "alpha" had been used for the local/debug build in §6 below
when only Cala exists as a production-quality character. Corrected here;
every milestone-APK reference in this doc uses these names consistently
going forward (the P2 APK **is** the alpha):

- **BASELINE** — systems-complete, placeholder-honest debug build.
  Deliverable now; certified by the Godot harness + gate. This is what
  §6(a) below calls "local/debug APKs" — not alpha.
- **ALPHA** — the P1+P2 exit APK: genre feel (combat VFX, skill-up UI,
  repeat/sweep) plus identity (portraits at scale, the first production
  character in-game, gacha reveal art).
- **BETA** — the P4 exit: content at scale + live systems (banner
  rotation, event content, live-ops authoring, endgame counter-teaming).

### P1 — It feels like a game
**APK: campaign ch. 1-3 with real combat feel and the full depth loop.**

- **Combat VFX stack**: element-tinted ability effects, hit reactions,
  screen shake/flash, per-element cast+impact — the godot-vfx spec,
  finally built. Named constraints from the engineering-blocker review
  (`engineering_blockers_review.md` §1), for the train brief that
  builds this: the event-seam (Phase 0) must land before any visual
  work; `ElementPalette.gd` must be a derivation off
  `GameState.ELEMENT_COLOURS` (the LOCKED UI-LANGUAGE tokens), not a
  second hand-tuned palette — amend `.claude/skills/godot-vfx/
  SKILL.md`'s conflicting palette table when that train starts; VFX
  lives in `BattleScreenBase.gd`, never in `Battle.gd`/`AgonBattle.gd`
  subclasses; every VFX duration divides by `_speed_mult`; fix the
  battle `SubViewport`'s always-on render mode while doing this work.
- **Ability-upgrade UI** in Roster: skill-up screen + dupe consumption
  — highest value-per-hour in the repo (backend complete, zero client
  UI). Both spend paths (`upgrade_ability`, `consume_dupe`) stay
  **RANDOM** as coded (owner ruling, 2026-09-11 engineering-blocker
  review) — UI ships as spend-and-reveal, not a slot-picker. The stale
  docstring at `characters.py:169` claiming "targeted upgrades use the
  dupe-consumption endpoint instead" gets corrected by the same train
  that builds the upgrade UI.
- **Repeat battle + stage sweep**. **SWEEP GATING (owner ruling,
  2026-09-11 engineering-blocker review): 3-star clear only** — sweep
  requires a prior 3★ clear of that exact stage+difficulty. Goes into
  `docs/game/GAME_MECHANICS.md`'s new §19 when this train builds.
- **Status icons merge** (PR #199 — MERGED as of this reconciliation
  pass, verified via `gh pr view 199`; carried here as already-landed
  P1 scope, not open work).
- Roster capacity: wire expand-roster + a release/sell flow.
- FTUE escape-spam soft-brick fix (already shipped — `BackNav.gd:39-56`,
  BOARD.md `QA-007` done 2026-09-04, per the engineering-blocker
  review §4.2 — carried here as landed P1 scope); Settings: audio
  sliders + mute.
- **Near-term size lever, folds into P1/P2 housekeeping**: the
  placeholder/reference-model purge (Meshy reference models under
  `client/assets/characters` that are candidates for deletion, not
  partition) — cheap, no code change, cuts tens of MB immediately. See
  §6 Delivery architecture.

### P2 — It looks like our world
**APK: every character visually distinct; the world has a face.**

- **Portraits at scale (2D, astra batch)**: the cheapest identity fix —
  164 missing portraits before any 3D. Sequencing (Lead Sync 1, agreed,
  zero disagreements): first representative portrait → an 8-portrait
  calibration series covering different species/regions/genders/crops/
  corruption states, measuring accepted images per dispatch and per
  Art Lead review hour → volume waves only after that measurement.
  Family cards + individual deltas, not all 164 briefs finished
  up-front (S2 amendment).
- **Gacha reveal art**: the pull shows the character, not a text row.
- World map art (region plates exist, unused there); per-region battle
  environments.
- Enemy visual variety: region-boss set first (per the ASSET_PRIORITY
  successor's P2 lane — astra-authored, see `docs/art/
  ASSET_PRIORITY.md`).
- **Cala in-game** (BOARD.md `TJ-A-021`): first bespoke character live
  as the 3D template. Continues on her existing owner-accepted
  VRoid-convention rig (see §7 Cala amendment). Integration route:
  **plain GLB retaining VRoid names** (Lead Sync 1, S7) — the first
  route to prove against the final package; spring behavior explicitly
  handled or recorded as visible debt if the route fails to preserve
  it.
- **Delivery-architecture design item** (owner ruling, 2026-09-11
  engineering-blocker review, "delivery architecture" — see §6): a
  P2-era study, before P3 scale, designing the AAB + Play Asset
  Delivery partition against the REAL asset profile (Cala-pipeline
  outputs, not the Meshy reference models — which are purge, not
  partition, candidates) and the loading-path changes
  (`BattleStage3D.gd`'s synchronous `preload`/`load` → async-tolerant)
  that VFX/scale work would otherwise make expensive to retrofit.
- **Cala rig/acceptance-matrix conflict** (docs_reconciliation
  manifest REAL CONFLICT #6): named here explicitly as P2 engineering
  scope so it can't get lost again — the shipped rig (184 skin joints,
  VRoid bone names, ~183MB decoded texture payload) stands per the
  owner's ruling (§7); the P2 obligation is import route, clip/event
  mapping, weapon-socket reparent, cel-shader activation, and texture-
  payload optimization, NOT bone-count/naming retargeting.

### P3 — Characters at scale
**APK: main cast + featured units bespoke; roster feels collected.**

The real M3: astra-led batch production over the proven Cala pipeline —
main cast (10), region bosses (8), then rarity-weighted coverage.
Volume plan and per-batch cadence proposed by the Art Lead against
measured pilot costs.

- **Entry precondition — second-character repeatability spike** (Lead
  Sync 1, S21, agreed): prove reuse of body/rig/animation/material/
  export tooling on a second humanoid, and measure a species adaptation
  separately, before authorizing the ten-character production batch.
  Cala alone cannot establish P3 cost credibility.
- **Taste Gate 2** (Lead Sync 1, agreed exact annotation): a
  consultation milestone at P3 entry, not a blocking approval. The Art
  Lead publishes the selected direction, representative in-engine
  evidence, production-family and cost evidence, scoped exceptions,
  unresolved debt, and proposed first wave. The Art Lead determines art
  readiness; engineering validates consuming-system requirements. Owner
  feedback can redirect the work at any time, but **silence neither
  blocks otherwise valid production nor constitutes endorsement** — an
  owner verdict is not required to proceed to P3 batch production. P2
  portrait production does not wait for it.

### P4 — It's a live game
**APK: a week of play has a schedule.**

Banner rotation with real end-dates, featured/limited units (mechanics
exist, unused), event content beyond the single seeded event, the
live-ops authoring layer (no more SQL-migration-as-admin-panel),
endgame counter-teaming (BOARD.md `TJ-M-004`, grounded in
`docs/sim/ORACLE_MATCHUP_CEILING.md`), achievements.

### P5 — It's in your hands anywhere
**APK that survives a reboot.**

- Deploy beyond the hand-typed LAN IP (`docs/program/
  LOCAL-HOSTING.md`'s cloud deferral, revisited here — see that doc's
  own amended wording).
- **APK size cut** (363MB measured, per the engineering-blocker review
  §4.1) — the AAB + Play Asset Delivery partition designed in P2 gets
  built here; interim mitigation is the P1/P2 reference-model purge.
- **Device performance validation — including Cala's** (owner ruling,
  "Cala contradiction," §7 below): the acceptance matrix's ≤30-joint
  budget was partly a device-perf guard; that obligation moves
  explicitly here. Record as `NOT RUN — deferred to P5`, never silently
  passed.
- Final QA sweeps, final balance pass (the archetype-rebuild design's
  M6-deferred numbers land here).

### Audio (M4 / Taste Gate 3) — not yet placed on this ladder
**[FLAGGED, not inferred.]** Nothing in the Road to Playable artifact,
the engineering-blocker review, or Lead Sync 1 assigns Audio/Taste
Gate 3 a P-slot. It is not silently dropped — `docs/superpowers/
specs/2026-08-25-prod-ready-program-design.md`'s M4 row still names it
— but this train will not invent an ordering for it without a ruling.
Until placed, treat it as unscheduled relative to P1-P5, not as P5-last
by default.

## 4. M-ladder mapping (P reorders M2-M6; spec finish-line unchanged)

| M-milestone | P-milestone(s) it maps to | Note |
|---|---|---|
| M0 — Audit & Baseline | pre-ladder, DONE | Unaffected. |
| M1 — Legible Core | pre-ladder, DONE, with one re-scope | The VFX-foundation promise (`2026-08-26-m1-legible-core.md:52`) never shipped and was never logged in DECISIONS (docs_reconciliation STALE FIND #5) — that work is now P1's combat VFX stack. This train records the retroactive DECISIONS entry (see DECISIONS.md). |
| M2 — World & Story | folds into P1 (FTUE build) + already-shipped | Every M2-plan task row is `done` on BOARD.md (see PROGRAM.md's corrected status). FTUE art coverage explicitly deferred to P2 (`2026-08-27-m2-n2-narrative-ftue-design.md`, re-tagged by this train). |
| M3 — Art at Scale | splits: P2 (2D portraits, environments, enemy variety, Cala-in-game) then P3 (3D main-cast batch, bosses, Taste Gate 2 entry) | The old "nothing batch-produced before Taste Gate 2" reading (REAL CONFLICT #5) is superseded — P2 is not gated on it. |
| M4 — Audio | **unplaced** (see above) | Not yet resequenced by any ruling this train found. |
| M5 — Live Service | P4 | Retention-loop's "seasonal — events, M5" re-tagged P4 in its own spec; `LIVEOPS_AND_RETENTION.md` feeds P4. |
| M6 — Prod-Ready | P5 | Device perf, QA sweeps, final balance, deploy-beyond-LAN all land here; the archetype-rebuild design's M6-deferred final numbers re-tagged P5-era. |

The program's finish line (`docs/superpowers/specs/
2026-08-25-prod-ready-program-design.md` §1) is **unchanged** — this is
a reordering of how the milestones between here and that finish line
are sequenced and named, not a redefinition of what "done" means.

## 5. Process resets that make the ladder real

1. **Milestone tracing.** Every train names the P-milestone it advances
   in its BOARD.md row. Process/tooling work must state the product-
   velocity justification, and is capped at one stream-slot's minority
   share (see `docs/program/WORKFLOW.md` §3, amended by this train).
2. **Review proportionality.** Non-product tooling never gets deeper
   review than product code. Record-class findings batch into one fix
   round; `scripts/pre_review_check.py` (PR #204) enforces the records
   so sol rounds stop relitigating them. (`docs/program/WORKFLOW.md`,
   amended by this train.)
3. **APK cadence.** The owner's interface is the milestone APK. Each
   P-milestone closes with a build delivered to the owner + a one-page
   evidence report — no milestone is "done" in records only.
4. **Streams map to the ladder.** Engineering slot works P1 top-down
   starting now; art-UI/env stream = P2 surfaces; art-characters stream
   = P2→P3 pipeline (see `scripts/finish_train.sh`'s 3-way composition,
   this train).

## 6. Delivery architecture (owner ruling, 2026-09-11 engineering-blocker review)

Owner, verbatim: *"the existing 9 characters are not exactly ready yet.
cala is the first that is almost there, pending the outstanding items
to count towards completion. so while we can do alpha for local
testing, we should start looking at how the full package can be
delivered."*

Interpretation:
- (a) **Baseline continues on local/debug APKs** (see §3 "Build stage
  definitions" — this is the owner's "alpha" quoted above, renamed for
  consistency; the true alpha is the P2 exit) — no change to today's
  distribution.
- (b) A **delivery-architecture design item** enters the ladder at
  P2 (before P3 scales production further): AAB + Play Asset Delivery
  partition designed against the REAL asset profile (Cala-pipeline
  outputs), not the Meshy reference models (purge candidates, not
  partition candidates); loading-path changes to `BattleStage3D.gd`
  (synchronous `preload`/`load` → async-tolerant) designed before
  VFX/scale work makes them expensive to retrofit.
- (c) The **placeholder/reference-model purge** is the near-term size
  lever — cheap, no code change, available in P1/P2.

## 7. Cala acceptance-matrix amendment (owner ruling, "Cala contradiction")

Owner, verbatim: *"The Cala contradiction - continue with what we
have, so this needs updating."*

Ruling: the shipped rig **stands** — 184 joints, VRoid bone names, the
texture payload per the closeout plan — the owner-approved acceptance
matrix is amended to match reality, not the reverse. This train amends
`docs/superpowers/specs/2026-08-30-cala-pilot-acceptance-matrix.md`
directly (dated amendment note, historical text preserved — see that
file). The consequence transfer: the ≤30-joint budget was partly a
device-perf guard, so the perf-validation obligation moves explicitly
to **P5 device-perf testing** (§3, P5 section above). No retarget is
funded.

## 8. Character canon-sweep convention (owner-driven, 2026-09-11 Marek cross-doc sweep)

The owner surfaced (via a repo-wide "marek" search across 30 doc files)
that character work must verify the character's CROSS-DOC references,
not just the doc in hand. The Controller's sweep found Marek consistent
everywhere (only the two already-tracked defects, both fixed by this
train — see DECISIONS.md).

**Convention:** every character commission's closing checklist includes
a cross-doc reference sweep — grep the character's key and display name
across `docs/` — with findings classified consistent / stale /
conflict and routed to the appropriate owner (engineering fixes
program-canon docs directly; art-lane docs route through the Art Lead
per the standard Lead Sync protocol). Cheap: one grep plus a read per
hit. Catches identity drift before it ships, the way this reconciliation
pass caught Marek/Drev/Sova's stale "no lore entry" claims (docs_
reconciliation STALE FIND #2) after the fact instead of before.

This convention is recorded here as program canon; propagating it into
`docs/art/ART_WORKFLOW.md`'s own commission checklist (astra's document)
is Art-Lane work, routed through the next Lead Sync touchpoint — not
built here (this train does not edit ART_WORKFLOW.md's substantive
process content, per CN-16's scope boundary).
