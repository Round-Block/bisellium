# Yan Mo — Development Workflow

*How we build. Companion to `roadmap-epics.md` (what, in what order) and `CLAUDE.md` (the laws). The guiding idea: **determinism makes this game unusually testable and de-riskable** — lean into that.*

---

## 1 · The build sequence (de-risking gates)

```
E0 tech foundation
E1 combat vertical slice ─────────► [ GATE: VALIDATE FUN ]   is the reading-combat fun?  (you + 2–3 fresh players)
                                    only pass this before spending on anything below
[ TONE PROBE ]  a thin E6 slice ──► does the melancholy reading-descent land emotionally?
E2 enemies · E3 progression
E5 Biome 1 end-to-end ────────────► [ GATE: MEASURE COST ]   what does ONE full biome actually cost to build?
                                    → informed go/no-go on the other ten
then: E10 content · E7 Avici · E8 meta · E9 art/audio (in parallel)
```

**Never build content ahead of the fun-gate.** The gates exist because the real risk is *content scope*, not feasibility — measure before committing.

## 2 · The per-feature loop (how any piece gets built)

> **Journal tasks: any multi-session front, now** (design and writing included — proven practice), **each on its own branch + worktree via `start-task`**, closed via `finish-task` → PR (§5). Single-sitting discussion stays ad-hoc (the direct-to-main case).

0. **Ground** *(added 2026-07-27, from a real miss)* — **before authoring content in a domain that has a reference doc, read it.** A Feinter attack was authored as invented sword motion while `jian-reference.md` sat in the doc map with the answer (and with the fact that the Tang soldier's weapon is the dāo, not the jiàn). Domains with references: combat technique (`jian-reference`, `dao-reference`) · bosses (`boss-compendium`) · cosmology (`mythology-reference`) · prose (`prose-voice-bible`) · camera (`camera-registers`) · kit (`player-kit-glossary`). *(main loop)*
1. **Spec** — if it isn't already specced, `superpowers:brainstorming` → a design doc. (Most systems are *already* specced in the docs; skip to plan.) *(main loop — Fable/Opus)*
2. **Plan** — `superpowers:writing-plans` → an ordered, reviewable task list, **saved as `docs/plans/YYYY-MM-DD-<slug>.md`** and linked from the journal task's `notes.md` (plans are durable artifacts, not chat). *(main loop — Fable/Opus)*
3. **Implement** — `superpowers:executing-plans` + `superpowers:subagent-driven-development`: **Sonnet subagents** do the writing, **with the `ponytail` discipline in every brief** (laziest solution that works: YAGNI → reuse → stdlib → native → one line → minimum; never cutting validation/safety — our Law #3 as an implementation stance, and less code = less surface to keep deterministic). Inside each unit: `superpowers:test-driven-development` — the golden test first, then the code (§3). The main loop reviews every diff.
4. **Verify** — `superpowers:verification-before-completion`: actually run it and observe behavior — **via the godot MCP** (run_project · game_screenshot · game_eval asserts); green tests are not proof it works. *(main loop)*
   > **SILENT VISUAL FAILURE is the dominant failure mode in presentation work** *(named 2026-07-27, after a session of them)*. Scripts ran clean, exports succeeded, 277 tests passed — and the blade was upside down with the guard at the tip, the torso leaned instead of twisting, the mesh normals were inverted, and the texture bake was solid black. **No automated gate we have covers any of that.** Therefore: (a) anything visual gets **eyes on the actual frame** before it is called done; (b) **measure instead of eyeballing wherever a number exists** — the inverted blade was caught by computing guard-to-hand distance (0.34 m, should be 0), not by squinting; (c) when appearance and a hypothesis disagree, **run the A/B** (the "shadow" artifact was diagnosed by killing the light and seeing the blotches survive — proving normals, not shadows).
5. **Review** — two lenses, both before merge: `superpowers:requesting-code-review` (correctness) **+ `ponytail-review` (over-engineering — what to delete)**. *(main loop — Fable/Opus)*
6. **Commit** — small, focused commits on a feature branch; PR for anything non-trivial.

Also in the kit: `superpowers:systematic-debugging` for any bug (reproduce as a replay trace first); `superpowers:dispatching-parallel-agents` for genuinely independent tracks only; `superpowers:using-git-worktrees` to isolate parallel work; `superpowers:writing-skills` when authoring our own repo skills. **Deferral hygiene:** deliberate shortcuts are marked `ponytail:` in code and **harvested at epic boundaries** into `open-questions.md` — deferrals tracked, never rotted. *(Reality check, 2026-08-13 repo review: in practice deferrals live in prose docstrings ("DEFERRED to E7", "authored placeholder", "not yet code") and ⚙ tuning markers, with only 2 `ponytail:` markers in the tree — so the harvest is a **manual grep of that vocabulary** (`deferred|placeholder|not yet|⚙`), not `ponytail-debt` alone.)* *(Adopted pieces only — the rest of both plugins is deliberately unused: ponytail-gain/audit/mcp, nothing else bolted on.)*

## 3 · Determinism is the test strategy

Because there is **no RNG**, every system is **golden-testable**: a fixed input sequence produces the exact same output, every time.

- **Combat** — record an input trace → assert the enemy's exact actions, Poise values, tally counters.
- **`perceive()`** — a (tell, sights) pair → assert exactly which fields are revealed.
- **Endings** — a Decision Board state → assert the resolved attractor.
- **Puzzles** — a solve sequence → assert the gate opens / the record reads.

This is the primary test approach. Determinism isn't only a design choice — it's what makes the game *provable*. Any non-determinism sneaking in (a stray `random()`, wall-clock timing, unordered iteration) is a **bug**, caught by a golden test failing to reproduce.

## 4 · Collaboration model (Edene ↔ Claude)

- **Edene** — design authority · sign-off gates · **playtesting (the fun judgment)** · repo & infra.
- **Claude** — specs · plans · implementation · tests · verification · keeping the docs in sync with reality.
- **The review channel (2026-07-27):** Edene frequently reviews **from a phone, over remote control**. `SendUserFile` attachments **do not render on their clients** — do not use it. What works: **images read inline in the conversation**, and — for anything Edene must *judge* — a **published Artifact page**: self-contained, phone-native, and interactive where interaction helps the judgment (drag-to-orbit turntables, rest/posed toggles, frame scrubbers, before/after pairs). Look-deliverables ship as Artifact pages; the desktop build is a fallback, not the primary. *Corollary:* the Blender and Godot bridges now launch unattended from WSL, so **nothing technical requires Edene at the desk — only judgment does.**
- **Sign-off gates:** per-biome content (design) · validate-fun (after E1) · measure-cost (after E5) · per-epic before merge. *Process approval ≠ content approval — get the explicit yes.*

**Model tiers — who does what (locked):**
```
PLAN · SPEC · REVIEW · ARCHITECTURE · NARRATIVE   Fable / Opus (the main loop) — never delegated down
IMPLEMENTATION                                     Sonnet subagents, ponytail discipline in every brief,
                                                   via subagent-driven-development; main loop reviews the diff
RESEARCH                                           Haiku (lookups, surveys) or Sonnet (multi-source judgment) —
                                                   picked by complexity; Haiku findings always spot-verified
MECHANICAL EDITS                                   Haiku, with exact strings; verified after
```
**The delegation axis — refined 2026-07-27 (the tier table alone was mis-cutting the work).** The question is **not** code-vs-art. It is: **is the acceptance test assertable, or is it taste?**
- **Assertable** (tests pass · the image is non-black · every vertex is weighted · the export exits 0) → **Sonnet subagent**, and it works *better* than the main loop: a fresh reader with no attachment to my hypotheses root-caused the black bake to `Metallic = 1.0` after I had walked past the evidence three times.
- **Taste** (does the lie *read*? does it look carved rather than cheap? is this fair?) → **main loop, inline** — the judgment loop *is* the work, and dispatching it just adds a round-trip to every pose.
- Long mechanical grinds hidden inside a taste task (parameter sweeps, export plumbing, bake debugging) should be **carved out and delegated** even when the surrounding task is taste-led. Cost of not doing so, measured: main-loop context burned on iteration, and slower diagnosis because I was reading my own results as the author rather than as a reviewer.

## 5 · Git conventions

**The branch-per-task rule (locked 2026-07-23; supersedes the same-day two-track split — Edene: one machine, N tasks in flight).** The discriminator: **if it has a journal task, it has a branch** — docs and code alike. `main` holds only completed, merged work.

```
START   git worktree add .worktrees/<slug> -b <type>/<slug>     type: docs/ · feature/ · chore/
        the journal task dir + Active row are created ON the branch (the journal rides the branch);
        tasks touching game/: one godot --headless --path game --import in the fresh worktree
WORK    commits on the branch; push the branch (in-flight work gets remote backup too);
        in-conversation review before each commit stays the review — the PR is the MERGE point.
        Messages: the docs prefixes (Narrative:/Design:/Docs:/Journal:/Tooling:/Workflow:) or
        type(scope): for code (feat(sim): · fix(perceive): · test(combat): …)
FINISH  close-out note + Completed flip committed on the branch → PR → **EDENE MERGES** (the merge
        is the acceptance act — Claude opens PRs and stops, never merges; squash-vs-merge is
        Edene's per-PR choice) → teardown after. Code PRs additionally need green CI (from E0).
        Pre-merge guard: git log main..HEAD | grep "chore(journal): close"  — never a separate journal PR
DIRECT-TO-MAIN — the one remaining case: single-commit conversational edits made and signed
        off live in-session. Everything task-shaped goes through a branch.
```

The `start-task` / `finish-task` skills run this flow end-to-end. Enforcement: **the agent-merge ban hook** (`check-agent-merge.sh` blocks any agent-run `gh pr merge` — Claude cannot merge, by construction) + the worktree-edit guard hook + **branch protection on `main`** (PR required; owner bypass covers the direct-to-main case — pending Edene's token/UI, see §7).

- **Commit the design docs** (the whole `*.md` corpus) alongside code — the bible travels with the repo.
- Suggested layout once the Godot project exists:
```
/docs        the design corpus (canonical, biome-playthroughs, epic specs, …)
/game        the Godot project
  /data      Tell / Archetype / BiomeSkin  (.tres Resources)
  /systems   perceive, poise, tally, Decision Board (autoloads)
  /scenes    arenas, enemies, the player
  /tests     golden tests
```

## 5.5 · Estimation discipline (added 2026-07-27, after three upward corrections in one session)

A single honest measurement was extrapolated across tiers that do not behave like the thing measured — one enemy tell-cycle became a whole-game animation figure that was wrong by a large factor. The corrections only came because Edene stress-tested it. Rules, so the next estimate is honest the first time:

1. **State the tiers explicitly before multiplying.** Standard enemies, elites, the player, bosses, set-pieces and narrative beats are *different kinds of work*, not different quantities of one kind. A boss that glides with no walk cycle and needs a formation of ranks is not "more attack cycles".
2. **Mark every line measured / inferred / unmeasured.** Publish the measured one; label the rest as what it is.
3. **Name what the measurement does NOT cover** in the same breath as the number — the probe legitimately proved that filling biomes with readable *enemies* is affordable; it proved nothing about the nine bosses or the finale.
4. **Multipliers hide in the taste loop, not the keyframes.** The blockout was ~8 minutes; making the same tell both readable *and* grounded took four passes with a human eye on each. Budget difficult/deceptive work at several passes.
5. **Expect estimates to rise under scrutiny, and treat that as the process working** — but do the tiering up front so the rise happens before a plan depends on it.

## 6 · Scope management (the content mountain)

The systems are weeks each and heavily reused (`Archetype ⊗ Skin ⊗ Tier` — 7 behaviors dress the whole underworld). The **bespoke content** is the years: 11 biomes × (geometry + a unique puzzle + a boss + a soul scene) + 5 endings + writing + art + audio.

**Levers, if the E5 cost measurement comes back scary:** fewer biomes · more shared boss tech · simpler puzzles · ink-wash-minimal art (low-poly + shaders, not photoreal) · text-first, voice only the pivotal scenes.

Decide scope *from the measurement*, not from optimism.

## 7 · E0 adoption checklist (from the epoch0 audit, 2026-07-23)

*Practices proven in epoch0, recorded here so they don't evaporate before code starts. Execute at E0 (or the noted epic); each is a small, known-shape task. The full audit lives in the workflow-refinement journal task.*

- [x] **CI, the 3-job shape** — **COMPLETE, local-first** (2026-07-24): `scripts/ci-local.sh` + the `.githooks/pre-push` gate; `tests.yml` = the dormant hosted mirror (dispatch-only). All three jobs real: (a) GUT ✅ (b) the no-RNG lint ✅ (c) replay-scenario ✅ — 3× byte-identical re-runs + the negative control, both proven non-vacuous by deliberately breaking each failure path once. The screenshot-artifact job stays hosted-only (needs a display), E4/E8/E9.
- [ ] **CI ↔ local parity** — tag slow/replay-heavy GUT tests; fast subset locally by default; document the exact CI-equivalent command here in this doc.
- [x] **`start-task` / `finish-task` skills** — ~~at E0~~ **pulled forward 2026-07-23** (the branch-per-task rule made them immediate): ported docs-adapted, Docker stripped; the Godot `--import` step is conditional on the task touching `game/`. At E0: only revisit the verify step to add the GUT/replay commands.
- [x] **Branch protection on `main`** — ~~at E0~~ **pulled forward 2026-07-23** (PR required, owner bypass). At E0: add required status checks once CI jobs exist.
- [x] **Source-of-truth ordering, code > docs** — LIVE 2026-07-24 (the first `.tres` landed, E1 item 8); the line is in CLAUDE.md's coding conventions. Flag drift, never silently follow either side.
- [ ] **Sync-derived-docs rule** — `boss-compendium.md` / `jian-reference.md` track live data; sync immediately after every Resource change (a named checklist step in the authoring skills, not a habit).
- [ ] **The redundancy gate** — before any new Tell/Archetype/technique: cite which cataloged gap (`jian-reference` / `boss-compendium`) it fills. Prevents silent identity-overlap across the nine bosses. Bake into a `new-enemy`/`new-tell` skill (model: epoch0's `new-character`).
- [ ] **Small-batch tuning** — one Poise/tell-window parameter per golden-run, so every replay diff is attributable.
- [ ] **Differential-test pattern** (situational) — if two independent constructors of combat/board state ever exist (game vs. test harness), write the differential test *and* leave the incident note in CLAUDE.md.
- [ ] **Sim-interpretation skill** (E1+) — fixed run commands + "tests AND full golden-replay suite both green" as the completion gate (model: epoch0's `combat-balance`).
- [ ] **`ui-verify` fork** (E4/E8/E9) — the checklist-audit → MCP-screenshot → per-screen sign-off loop (the `godot-verify` skill is its foundation).
