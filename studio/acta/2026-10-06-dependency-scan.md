---
id: "2026-10-06-dependency-scan"
title: Dependency scan of the open opera — producer, 2026-10-06
kind: daily
author: producer
at: 2026-10-06T06:19:14Z
---

# Dependency scan, 2026-10-06

Run by Codex `gpt-5.6-terra` (medium) over every open opus, its brief, the
2026-10-05 ranking and the milestone acta, at the Patron's request. Packet
and prompt: `~/.bisellium-evidence/deps-scan/`. Checked by the producer:
the "outside" dependencies are all on done opera (satisfied); the W-068 /
W-156 overlap was real and is resolved by D-040. Nothing below needs
immediate attention. The hard dependencies are recorded on the opera once
W-068 builds the field.

## Dependencies
| needs (B) | on (A) | evidence (file:line or quote, short) | confidence high/medium/low |
|---|---|---|---|
| W-073 | W-078 | open-opera.md:22: without W-078, “W-073’s premise is dead” | high |
| W-116 | W-117 | 2026-10-05-ranking.md:85-87: W-117 makes the seat model the record W-116 reads | high |
| W-135 | W-136 | 2026-10-05-ranking.md:94-95: W-135 “inherits W-136’s registry” | high |
| W-138 | W-136 | briefs/W-138.md:5: explicit dependency for activity and usage logs | high |
| W-138 | W-137 | briefs/W-138.md:5; Patron ruling: W-138 depends on W-137’s remedy/fix record | high |

## Depends on something outside the open list
| item | on | evidence |
|---|---|---|
| W-038 | W-035 | briefs/W-038.md:119-120: “Land this after W-035” |
| W-054 | W-049 | briefs/W-054.md:27-29: W-049 supplies the PATH-pass-through baseline |
| W-073 | W-067 | open-opera.md:20: “writes through W-067’s postWrite” |
| W-074 | W-064 | open-opera.md:21: touchpoint lands on the shipped Board; milestones:147 identifies W-064 as Board |
| W-092 | W-089 | open-opera.md:29: “W-089 follow-on its brief mandates” |
| W-112 | W-064 | open-opera.md:36 and milestones:147: Board refinement requires the shipped Board |
| W-113 | W-024 | open-opera.md:37 and milestones:143: Inbox rendering requires the shipped Inbox |
| W-135 | unfiled Patron rulings | briefs/W-135.md:3-6,54-59: no build authorised; architecture choices unresolved |
| W-136 | unfiled Patron UI/UX ruling | briefs/W-136.md:3-6: UI needs Patron ruling at spec time |
| W-138 | W-085 | briefs/W-138.md:5: explicit dependency for boot context carrying open lessons |
| W-153 | W-152 | open-opera.md:58: adds estimate to the Status page; milestones:161 identifies W-152 as that page |

## Cycles or conflicts
No cycle.

- W-116 → W-117 conflicts with the ranking’s listed order (W-116 before W-117), while the ranking’s rationale says W-117 creates the model record W-116 must read (2026-10-05-ranking.md:83-87).
- W-068 and W-156 overlapped; resolved by D-040 (W-156 merged into W-068).
- W-122 and W-138 prescribe competing usage-measurement paths; the ranking explicitly says to choose so both are not built (2026-10-05-ranking.md:113-116).

## Independent
W-040, W-043, W-045, W-048, W-051, W-052, W-053, W-055, W-058, W-059, W-060, W-061, W-066, W-068, W-070, W-080, W-081, W-083, W-086, W-090, W-091, W-093, W-094, W-097, W-098, W-099, W-100, W-115, W-118, W-120, W-122, W-133, W-143, W-144, W-145, W-146, W-147, W-148, W-149, W-150, W-151, W-154, W-155, W-156
## Follow-ups (logged, not urgent)

- Ranking order: W-117 before W-116 (W-116 reads the seat record W-117
  makes). Neither is greenlit; fix the order at the next ranking.
- W-122 and W-138 measure usage two ways; choose one when W-138 is rescoped
  after W-137 (W-138 is held on W-137, Patron 2026-10-06).
