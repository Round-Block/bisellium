# Yan Mo — Vertical Slice Spec (E1: Combat Core)

*The first buildable target. It answers exactly one question: is the reading-combat fun? Builds on `combat-architecture.md`; scoped by `roadmap-epics.md`; enemies reference `game-design-canonical.md` → The Enemy Roster. Next step after approval: an implementation plan (writing-plans).*

---

## The one question

**Does the core loop feel good — read an attack → deflect/dodge → break Poise → *choose* mercy?** Nothing else. If yes, the game is worth building. If no, we learned it for the price of one grey-box arena — not one biome.

---

## In scope

```
ARENA       one grey-box plate (pure grey-box, no art)

PLAYER KIT  jiàn verbs 点 / 刺 / 格 / 截  ·  dodge-read (the perfect-read flurry)  ·  击 (tap / hold)
            HP + 1 heal charge  ·  qi meter (earned-by-reading)  ·  2 abilities: Shout (space) + Displacement (an opener)
            ONE soul-sight, PASSIVE — surface-penetration possessed from spawn (canon correction 2026-07-25: sights are never toggled; the fairness floor — is the raw feint fair without it? — is validated via sim-state config + tests, not a player toggle)

ENEMIES     3 archetypes — REGULAR (base timing/direction) · FEINTER (the read-that-lies) · CONSCRIPT (fearful → mercy)
            + 1 Sergeant boss (a Poise + HP duel; renamed from "Captain" at A8 — it is a BossTemplate, not the CAPTAIN archetype).  All fought individually — no guard crowds in the slice.

SYSTEMS     Tell/read  ·  deterministic BehaviorPolicy  ·  Poise (势, poise-only for standard enemies)
            击 gate (tap/hold) + mercy tally  ·  fearful gesture-resolution (the Conscript)  ·
            qi earn/spend  ·  perceive() (one filter)

DIFFICULTY  Normal only

HARNESS     debug overlay — live tells, Poise, qi, HP, tally counters — and a "reveal all reads" toggle
```

---

## Out of scope (hard — resist creep)

traversal / platforming · puzzles · soul-encounter narrative · other biomes · animation & art polish · cutscenes · save/load · menus · the full 9 abilities · difficulty tiers · Assist Mode · **阵势 guard-crowds / crowd-击 (→ E2)** · progression / leveling · the ending-matrix UI.

---

## Deliberately faked / stubbed

- **Art / animation** — grey-box capsules. **The one exception: tell *legibility*.** Fidelity is faked everywhere except the clarity of the tell telegraph — that's literally what's being tested, so it gets real attention (a legible windup, not a pretty one).
- **Soul-sight** — surface-penetration as a PASSIVE possession seeded at spawn (no progression; canon correction 2026-07-25 — wén sights are possessed, never toggled) — proves `perceive()` changes the reading problem; the fairness floor (the feint must be readable *without* the sight) is checked by test/sim-state config, not a toggle.
- **Tally** — raw debug counters, not the real (hidden) Decision Board.
- **Boss** — one Sergeant with Poise+HP and 2–4 readable attacks (task item A appended a 4th, an honest JIE, to complete the GE/JIE-feint/DODGE/honest-JIE read set); not a themed biome boss.

---

## Success criteria (how we judge "fun")

1. A new player learns to **deflect (格) on the tell**, and it feels satisfying, not twitchy.
2. The **perfect-read dodge** (flurry) reads as *clarity*, not reflex — the time-slow lands, the opening feels *earned*.
3. Breaking **Poise → 击** is a clear, weighty beat; **tap vs. hold** (subdue vs. kill) feels like a real choice.
4. The **Feinter** teaches "don't react to the surface" without feeling *unfair*.
5. The **Conscript** makes not-killing feel like the natural, low-friction path.
6. **Qi-earned-by-reading** is *felt* — playing well visibly funds your abilities.
7. Determinism is invisible-but-trusted — the same attack always reads the same way; nothing feels random.
8. **Hesitation feels like a choice** — letting the 击 window pass (enemy recovers partial Poise) reads as a real, weighted decision, not a punish.

---

## Definition of done

All eight criteria demonstrably true in a playable Normal build (judged by you + 2–3 fresh players), with the debug harness confirming **deterministic behavior** (same inputs → same enemy actions).

**Decision triage — the point of the slice:** for any criterion that *fails*, ask **"tuning or fundamental?"** A tuning failure (numbers/windows) is fixable and does *not* kill the design; only a **fundamental** failure (the idea itself isn't fun) does. Record which.

Then capture the tuning numbers the slice revealed (Poise / qi / HP / window values) back into `open-questions.md`.

---

## Next step

An implementation plan (writing-plans) that turns this spec + `combat-architecture.md` into an ordered set of Godot build tasks.
