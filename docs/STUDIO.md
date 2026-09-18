---
kind: model
owner: architect
tier: reference
review: 2026-12-01
kill: when the studio model it describes ships as the real officina and this proposal is archived
---

# Bisellium — Studio Model

Status: proposal, 2026-09-17. Generic; project-specific instances live in each
project's own repo.

## 1. Vocabulary

| Term | Meaning |
|---|---|
| Patron | The human. Studio head. Four touchpoints (§4), nothing else. |
| Collegium | A discipline with a Magister, a lex, an aerarium, an acta stream. |
| Magister | The agent sella holding a collegium's authority. |
| Sella | Any agent role (magister, worker, reviewer). |
| Lex | What a Magister decides alone / digests / escalates. See LEX_TEMPLATE. |
| Aerarium | Token + time stipendium per collegium per period. |
| Acta | Inform-and-proceed report. Never needs a reply; silence binds nothing. |
| Petitio | A question that changes material direction. The only thing that reaches the Patron's inbox. |
| Fasti | The ranked set of work the studio has committed to. |
| Decretum | Patron decision moving an item from backlog onto the fasti. |

## 2. The unit of delegation

Collegium = **lex + aerarium + acta**. A pipeline stage becomes a
collegium the moment all three exist. Remove any one and it is back to being
a tool the Patron has to drive.

## 3. Collegia

Core (every product team):

| Collegium | Owns | Typical Magister authority |
|---|---|---|
| Production | fasti, WIP caps, dependencies, collision detection, cadence | schedule, sequence, halt |
| Design | specs, rules, balance, "what it should feel like" | spec changes within greenlit scope |
| Engineering | code, contracts, migrations | refactors, tests, deps; digest architecture choices |
| Art | assets, style, pipeline | style within bible; digest taste choices |
| QA | verdicts, evidence, regression | reject autonomously; digest failure patterns |

Business functions map onto existing mechanisms, not new sellae:

| Function | Is actually |
|---|---|
| Finance | aerarium per collegium per period; cost per opus = COGS; postures on burn |
| Staffing | roster + leges; model routing = seniority; lex widening = promotion; receipts/heartbeats = performance |
| Comms | acta feed (all-hands) · inbox (open door) · timelines (firehose) |
| Operations | provider limits as supply; surge lanes; reset windows |
| Governance | probationes + leges + amendment logs |

## 4. Patron touchpoints

1. **Decretum** — backlog → fasti. A portfolio decision, not a queue pop.
2. **Budget allocation** — per collegium per period.
3. **Arbitria** — the human gates a lex names.
4. **Lex changes** — widen or narrow delegation.

Anything else arriving as a question is a lex defect: fix the lex.

## 5. Communication classes

| Class | Goes to | Reply |
|---|---|---|
| Petitio | Patron inbox | required; blocks the asker |
| Acta | acta feed | never; Patron may redirect |
| Chatter | timelines | n/a |

Strict admission to the inbox is what keeps the Patron's answers findable.

## 6. Aerarium

- Allocated per collegium per period by the Patron; unspent does not roll over.
- Each collegium reports observed burn; posture `ok / conserve / closeout /
  limited / unknown` is derived, never self-declared as `ok` without telemetry.
- Cost attribution: sum usage over spans sharing an opus; split by sella.
- A collegium over budget drops to `conserve` automatically and digests why.

## 7. Cadence

| Ritual | Who | Output |
|---|---|---|
| Daily | each Magister | one acta entry |
| Decretum review | Patron + Production | fasti changes |
| Budget review | Patron + Production | next period's allocations |
| Postmortem | Magister of the failing collegium | acta + lex amendment proposal |

## 8. Adding a collegium

Only when one class of decision is escalating to the Patron repeatedly. Never
speculatively. Start with Production + Engineering + Art + QA; fold Design into
Production until it hurts.

## 9. Relationship to other projects

- **Gantry** renders the studio: Board = floor, Agents = org chart + payroll,
  Acta = comms, Inbox = Patron's desk, **Studio** (new screen) = fasti, budget
  burn, lex status, decretum queue.
- **epoch0** is the reference instance. Its WORKFLOW.md / ART_WORKFLOW.md
  already implement most of this for Art; Bisellium generalizes it. Bisellium does
  not write to epoch0.

## 10. Autonomy

Declared per collegium in its lex, driven by one scheduler:

| Level | Behaviour |
|---|---|
| L0 manual | sellae act only when talked to |
| L1 scheduled | `bisellium tick` runs cadence work: dailies, repo review, check, consolidation |
| L2 dispatching | Production's loop walks the fasti: starts greenlit items within WIP and posture, advances items whose gates passed |
| L3 continuous | magistri self-assign follow-ups inside "decides alone" |

The edge is the fasti: autonomy never crosses a Patron touchpoint; the studio runs to the
end of the greenlit work and idles visibly. Brakes: per-item halt, `bisellium pause`
(stop starting), posture `limited` per collegium, no autonomous starts at `closeout`.

## 11. Decisions and open questions

**Decided 2026-09-17: conventions first, plus a reference harness for magistri.**
The studio state is files; any toolchain can produce them; the console renders
them through adapters. Bisellium also hosts collegium magistri' conversations
(`bisellium talk`) by driving the vendor CLIs headless (`claude -p --resume`,
`codex exec --resume`) in the sella's worktree, so the Patron can talk to a magister
from the console on subscription billing. Builders run wherever they run;
nothing is locked in. A full runtime that owns the agents (AllHands/OpenHands
style) remains out of scope.

Open:

- Multi-project: one studio per project, or one studio with a portfolio across
  projects?
- Lex amendment authority: Patron only, or can Production propose and
  auto-adopt after N days without objection?
