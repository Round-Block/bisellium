# Yan Mo (研墨) — Project Guide

*Read this first. It's the map + the laws. Detailed design lives in the docs it points to — this file stays high-signal, not a duplicate.*

**What it is:** Yan Mo (研墨, "grind ink") — a linear, PSP-God-of-War-templated **action-adventure descent through Diyu** (the Chinese underworld), set in the Tang dynasty / An Lushan rebellion. A **timid scholar**, Gù Míngyuǎn (顾明远) — *not a warrior* — cast **alive** into Diyu by the fiend **Qiongqi** (never killed), descending through it to discover, hell by hell, what the war did to his two brothers. Contemplative, melancholy, mercy-driven. **Engine: Godot.** Solo dev, AI-assisted.

---

## The thematic spine — protect this; push back when design drifts

- **David vs. Goliath** — a small, gentle person against vast forces, winning by *clarity*, not power.
- **Kindness is the source of growth**; **war feeds on the kind** (his kindness is what Qiongqi exploits).
- **Human greed is the true author of catastrophe** — the Four Fiends are opportunistic **amplifiers, NOT masterminds.**
- **You cannot beat war with war** — force feeds Qiongqi; only clarity and redirection deny him.
- **Choice by choice, he becomes who he is** — the ending is the honest sum of the descent.
- **Reading is the whole game** — *"not speed. clarity."*

## Core design laws — non-negotiable

1. **No RNG in anything read or answered.** Required by the perfect-reading fantasy. No crit/dodge/damage variance; enemy behavior, tells, and outcomes are **pure functions of state**; difficulty scales the *read-window*, never randomness. **Configurational variety** — selection among *challenge-equivalent* options (e.g., which arena fixture activates) — may draw from a **seeded deterministic stream** in sim state (same seed → same fight; goldens hold). *The enemy never rolls dice; the hell may deal the room.* In code: fixed-timestep (`_physics_process`), frame counters not wall-clock, **no bare `random()`** — the seeded stream only.
2. **Reading is the win condition, everywhere.** Combat = break Poise by reading tells; traversal = read the space; puzzles = read the buried truth (研墨·拓); the ending = read who you became. All run through **one `perceive()` engine**. Sights *assist* reads, never *gate* them (fairness floor).
3. **Spend complexity on the read.** Keep the managed-resource count low — **HP · enemy Poise (势) · heal charges · one qi meter.** Every new tracked resource taxes the attention the game is about. This vetoes feature creep.
4. **Mercy is deliberate.** Standard enemies have **no HP** — every kill is a held 击 (tap = subdue / hold = kill). No accidental kills. **Ink = witness/mercy, blood = force; the ratio on the page is the record** (and the Mercy axis of the ending).

## The doc map

*All design docs live under **`docs/`**; code under **`game/`** (`data` · `systems` · `scenes` · `tests` · `assets`). `CLAUDE.md` + `README.md` are the root **LAWS**. The map below is tagged by **kind** — **CANON** (what's true / what good is) · **CONTENT** (the produced deliverable) · **METHOD** (how we work) · **PLAN** (what to build, in what order) · **LOG** (where we are / why).*

| Kind | Doc (`docs/`) | What it is |
|---|---|---|
| **CANON** | `game-design-canonical.md` | The committed design — **authoritative** |
| **CANON** | `story-spine.md` | High-level narrative (frame, acts, endings) |
| **CANON** | `mythology-reference.md` | **The pinned Diyu cosmology** — the lore ground truth; every scene checks against it |
| **CANON** | `biome-playthroughs.md` | **B0→B11 played out end-to-end** — the content spine + the connective-spine (transitions, memory, ink/blood) |
| **CANON** | `combat-architecture.md` | The **buildable** data model: `Tell` / `Archetype` / `perceive()` / poise / tally, with the Godot mapping |
| **CANON** | `jian-reference.md` | The **jiàn (劍) technique vocabulary** — authentic 剑法, kept spare and read-driven; feeds combat |
| **CANON** | `boss-compendium.md` | **The nine biome bosses, per-boss to depth** — identity/grounding · fight/AI · exam · art · audio · staging; instantiates the boss doctrine (per-boss review COMPLETE, B1–B9) |
| **CANON** | `prose-voice-bible.md` | **The locked prose voice** — the 意境 register, the two-axis character model, the pitfalls + scene gate; every scene checks against it |
| **CANON** | `camera-registers.md` | **The camera quick-reference** — the ~6-register vocabulary + rules + the focal-击 PULL-IN rule + the implemented numbers (code = truth) |
| **CANON** | `player-kit-glossary.md` | **The player-kit quick-reference** — the 5 verbs · 击 · resources · actives · lock/movement, slice-current (code = truth) + the full-game canon pointers |
| **CANON** | `wu-ability-ladders.md` | **The nine wǔ ability ladders, per-tier** (A10) — every tier a new capability + the kit-wide laws; the 5/4 offense/defense accounting; E2/E5 tuning flags |
| **CONTENT** | `script-pivotal-scenes.md` | Verbatim drafts of the load-bearing scenes — **all 17 drafted** (B0→B11: the opening, nine hells, Threshold, Avici, the five endings); the beat-ledger tracks sign-offs (Scene 10 ✅, rest 🔷) + the arc-ledger + tiered dialogue — see `narrative-workflow.md` |
| **CONTENT** | `soul-journal-entries.md` | **The 11 soul-journal entries, all ✅ locked** — Míngyuǎn's own hand (the 研墨 record); the signed state model (enum states · depth inks paragraphs · dimming pales them); consumed by E6/E8 |
| **CONTENT** | `reload-tips.md` | **The reload-tip pool** — S×5 + G×13 + T×3, context-tagged, availability-guarded, deterministic selector (amends canonical:714); carries the pause ruling (bosses unpausable · blur-pause elsewhere); consumed by E8 |
| **METHOD** | `dev-workflow.md` | **How we build** — the per-feature loop, gates, testing, git |
| **METHOD** | `narrative-workflow.md` | **How we write** — the scene-drafting loop, the 意境 prose register, the tiered dialogue, the locked narrative calibrations |
| **METHOD** | `ui-workflow.md` | **How UI is designed & built** — the anti-chrome philosophy, the UI inventory, the ink-wash Theme, the mock→build→wire→test loop |
| **METHOD** | `art-pipeline-3d.md` | **The 3D toolchain** — godot-mcp (wired ✓), Blender→glTF, the ink-wash NPR recipe, AI-asset trial policy; per-item ADOPTED/TRIAL/SKIP statuses |
| **METHOD** | `testing.md` | **How we test** — GUT + the determinism replay harness (`sim(state, trace) → event_log`); golden tests; coverage priorities; CI |
| **PLAN** | `roadmap-epics.md` | The **E0–E10 build roadmap** — slice-first |
| **PLAN** | `vertical-slice-spec.md` | **The first build (E1)** — one arena, 3 enemies, 1 boss; the go/no-go bar |
| **PLAN** | `epic-e2…e9-*.md` | Detailed epic specs — e2 enemies · e3 progression · e4 traversal/puzzle · e5 content-pipeline + Biome 1 · e6 narrative systems · e7 Avici finale · e8 meta · e9 art/audio |
| **LOG** | `open-questions.md` | Active work list / residuals |
| **LOG** | `ideation-log.md` | Reasoning & rejected alternatives |
| **LOG** | `handoff.md` | Session continuity |

## Build approach (see `roadmap-epics.md`)

**Slice-first.** Prove the one thing that can sink the game — *is the reading-combat fun?* — with the E1 slice, **before** pouring months into content.
```
E0 tech → E1 slice → [VALIDATE FUN] → [TONE PROBE] → E2/E3 → E5 (Biome 1, MEASURE per-biome cost) → then E10/E7/E8/E9
```
Godot, **data-driven**: `Tell`/`Archetype`/`BiomeSkin` as Resources; the Decision Board as an autoload. The 11-biome content is the real scope risk (not the tech) — the gates above exist to measure it before committing.

## Working style (how Edene wants work done)

- **Quality over speed (stated 2026-07-27): Edene is NOT rushed — "I want to make it good first."** Do not optimise proposals for shipping velocity or frame findings as "cheap/affordable" when the real question is *what does good require*. Probe-grade answers (a decimate instead of a real retopo, a 1024 glossy bake, a tell that "reads marginally") are acceptable **only while probing**; once a thing is being built for real, the quality version becomes a task, not a deferred debt. The counterweight to remember: time protects quality only if **scope** holds still — the project's standing risk is eleven biomes, not craft.
- **Plain language, no coined jargon (added 2026-08-19).** Describe mechanics as what happens on screen, moment by moment. Don't invent labels ("the array", "the lane") and then reason in them — show the thing in play first; if a shorthand is needed after that, define it once. When Edene asks how something works, the answer is a played-out scenario, not a definition.
- **Never move on without an explicit OK (added 2026-08-19).** An item is closed only when Edene says so in so many words. Don't declare something settled, don't advance to the next item, don't present "what's remaining" — finish the current item and wait for the OK.
- **Suggest, then commit** — recommend and decide; don't hold open indefinite menus.
- **Concrete over prose** — mechanics, numbers, pseudo-code. "It would feel like X" gets rejected.
- **Explicit sign-off per item** before advancing — don't treat process approval as content approval.
- **Check integration & cascades before adding anything** — ride existing systems, don't bolt on; prefer operationalizing an existing metric over inventing a currency.
- **Model feedback-loop systems** (Monte-Carlo), don't hand-trace them.
- **Capture decisions into the docs as you go.**

## Agent operations (tiers + tooling)

- **Model tiers (locked):** plan / spec / review / architecture / narrative → **Fable/Opus** (the main loop, never delegated down) · implementation → **Sonnet** subagents with the **`ponytail` discipline** in every brief (laziest solution that works; Law #3 as code stance) · research → **Haiku or Sonnet** by complexity (Haiku always spot-verified) · mechanical edits → **Haiku** with exact strings. Full loop + adopted plugin pieces (superpowers ×12, ponytail ×3 — the rest deliberately unused): `dev-workflow.md` §2/§4.
- **Godot MCP** wired via `.mcp.json` (the local 154-tool fork; `GODOT_PATH` → Godot 4.7.1-stable): **headless** authoring (`.tscn`/`.tres`/project settings as JSON) + **runtime verification** (run · screenshot · `game_eval` · shader params). Gotcha, pre-learned: *a fresh worktree needs one `godot --headless --path game --import` before first run.*

## Coding conventions

**Language: GDScript** (not C#) — confirmed by the scaffold (`game/project.godot` has no C# solution; CI runs GUT with `use-dotnet: false`). Chosen for solo-dev iteration speed, the GUT test ecosystem, and Godot-native determinism control; C# considered and not adopted. **Style:** Godot's official GDScript guide — `snake_case` funcs/vars, `PascalCase` classes/nodes/Resources, `ALL_CAPS` consts, static types where they aid clarity. **Data** in `.tres` **Resources** (`Tell`/`Archetype`/`BiomeSkin` etc.); **global state** in **autoloads** (the Decision Board and friends). **Determinism is a code property:** fixed-timestep (`_physics_process`), **frame counters not wall-clock**, **no bare `random()`/`randi()`** — the seeded `DealStream` (see `combat-architecture.md`) is the sole entropy source; ordered/deterministic iteration; **movement is kinematic own-math** (`move_and_collide` with our arithmetic — solver-driven bodies are render-dressing only, never read back; the full physics policy: `combat-architecture.md`, E0 build specs). **Everything golden-testable** (same input → same output). **Source of truth, code > docs (live since the first `.tres`, 2026-07-24):** the shipped implementation (`game/` code + `.tres` data) outranks the design docs on divergence — **flag the drift, never silently follow either side**, then sync the doc. See `dev-workflow.md` + `testing.md`. *(E0 delivered these anchors as code — see `feature/e0-foundation`.)*
