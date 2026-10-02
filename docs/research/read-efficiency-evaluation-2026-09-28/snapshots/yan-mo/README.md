# Yan Mo (研墨)

*"Grind ink."* A **deterministic, mercy-driven action-adventure descent through Diyu** — the Chinese underworld — set in the Tang dynasty during the An Lushan rebellion. A timid scholar, **Gù Míngyuǎn**, is cast **alive** into Diyu by the fiend **Qiongqi** and descends through it, discovering hell by hell what the war did to his two brothers. Contemplative, melancholy, and built on a single idea: **reading is the whole game — *not speed, clarity.***

Engine: **Godot 4**. Solo dev, AI-assisted.

> **Status: design-complete, pre-build.** The whole descent (B0→B11) is played out and the systems are specced. Next step is the **E1 combat vertical slice** — proving the reading-combat is fun before committing to content.

---

## Where things are

| Path | What |
|---|---|
| **`CLAUDE.md`** | **Read first** — the project guide: the thematic spine, the four design laws, the doc map, working style |
| **`docs/`** | The full design corpus (see below) |
| **`game/`** | The Godot project (`data/` · `systems/` · `scenes/` · `tests/` · `assets/`) |

## The design corpus (`docs/`)

| Doc | What it is |
|---|---|
| `game-design-canonical.md` | The committed design — **authoritative** |
| `biome-playthroughs.md` | **B0→B11 played out end-to-end** — the content spine |
| `combat-architecture.md` | The buildable data model (`Tell` / `Archetype` / `perceive()` / poise / tally) + Godot mapping |
| `roadmap-epics.md` | The E0–E10 build roadmap (slice-first) |
| `vertical-slice-spec.md` | **The first build (E1)** — the go/no-go bar |
| `epic-e2…e9-*.md` | Detailed epic specs (e2 enemies · e3 progression · e4 traversal/puzzle · e5 content-pipeline + Biome 1 · e6 narrative · e7 Avici finale · e8 meta · e9 art/audio) |
| `story-spine.md` · `open-questions.md` · `ideation-log.md` · `handoff.md` · `jian-reference.md` | Narrative, work list, reasoning, continuity, weapon research |
| `dev-workflow.md` | How we build — the per-feature loop, de-risking gates, testing, git |
| `ui-workflow.md` | How UI is designed & built — anti-chrome philosophy, UI inventory, the ink-wash Theme, mock→build→wire→test |
| `testing.md` | How we test — GUT + the determinism replay harness, golden tests, CI |

## The four design laws (full detail in `CLAUDE.md`)

1. **No RNG / fully deterministic** — enemy behavior is a pure function of state; difficulty scales the read-window, never randomness.
2. **Reading is the win condition, everywhere** — combat, traversal, puzzles, the ending; one `perceive()` engine.
3. **Spend complexity on the read** — a low managed-resource count (HP · Poise · heal charges · one qi meter).
4. **Mercy is deliberate** — no accidental kills; ink = witness, blood = force, and the ratio is the record.

## Building

See `docs/roadmap-epics.md` (what, in order) and `docs/dev-workflow.md` (how). Slice-first:

```
E0 tech → E1 slice → [VALIDATE FUN] → [TONE PROBE] → E2/E3 → E5 (Biome 1, measure cost) → then content
```

Determinism is a code property and the test strategy: fixed-timestep, frame counters not wall-clock, no `random()` — every system golden-testable (same input → exact output).
