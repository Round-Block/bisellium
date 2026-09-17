# Bisellium — Studio Model

Status: proposal, 2026-09-17. Generic; project-specific instances live in each
project's own repo.

## 1. Vocabulary

| Term | Meaning |
|---|---|
| Owner | The human. Studio head. Four touchpoints (§4), nothing else. |
| Department | A discipline with a Lead, a charter, a budget, a digest stream. |
| Lead | The agent seat holding a department's authority. |
| Seat | Any agent role (lead, worker, reviewer). |
| Charter | What a Lead decides alone / digests / escalates. See CHARTER_TEMPLATE. |
| Budget | Token + time allowance per department per period. |
| Digest | Inform-and-proceed report. Never needs a reply; silence binds nothing. |
| Ask | A question that changes material direction. The only thing that reaches the Owner's inbox. |
| Slate | The ranked set of work the studio has committed to. |
| Greenlight | Owner decision moving an item from backlog onto the slate. |

## 2. The unit of delegation

Department = **charter + budget + digest**. A pipeline stage becomes a
department the moment all three exist. Remove any one and it is back to being
a tool the Owner has to drive.

## 3. Departments

Core (every product team):

| Department | Owns | Typical Lead authority |
|---|---|---|
| Production | slate, WIP caps, dependencies, collision detection, cadence | schedule, sequence, halt |
| Design | specs, rules, balance, "what it should feel like" | spec changes within greenlit scope |
| Engineering | code, contracts, migrations | refactors, tests, deps; digest architecture choices |
| Art | assets, style, pipeline | style within bible; digest taste choices |
| QA | verdicts, evidence, regression | reject autonomously; digest failure patterns |

Business functions map onto existing mechanisms, not new seats:

| Function | Is actually |
|---|---|
| Finance | budgets per department per period; cost per work item = COGS; postures on burn |
| Staffing | roster + charters; model routing = seniority; charter widening = promotion; receipts/heartbeats = performance |
| Comms | digest feed (all-hands) · inbox (open door) · timelines (firehose) |
| Operations | provider limits as supply; surge lanes; reset windows |
| Governance | gates + charters + amendment logs |

## 4. Owner touchpoints

1. **Greenlight** — backlog → slate. A portfolio decision, not a queue pop.
2. **Budget allocation** — per department per period.
3. **Taste calls** — the human gates a charter names.
4. **Charter changes** — widen or narrow delegation.

Anything else arriving as a question is a charter defect: fix the charter.

## 5. Communication classes

| Class | Goes to | Reply |
|---|---|---|
| Ask | Owner inbox | required; blocks the asker |
| Digest | digest feed | never; Owner may redirect |
| Chatter | timelines | n/a |

Strict admission to the inbox is what keeps the Owner's answers findable.

## 6. Budgets

- Allocated per department per period by the Owner; unspent does not roll over.
- Each department reports observed burn; posture `ok / conserve / closeout /
  limited / unknown` is derived, never self-declared as `ok` without telemetry.
- Cost attribution: sum usage over spans sharing a work item; split by seat.
- A department over budget drops to `conserve` automatically and digests why.

## 7. Cadence

| Ritual | Who | Output |
|---|---|---|
| Daily | each Lead | one digest entry |
| Greenlight review | Owner + Production | slate changes |
| Budget review | Owner + Production | next period's allocations |
| Postmortem | Lead of the failing department | digest + charter amendment proposal |

## 8. Adding a department

Only when one class of decision is escalating to the Owner repeatedly. Never
speculatively. Start with Production + Engineering + Art + QA; fold Design into
Production until it hurts.

## 9. Relationship to other projects

- **Gantry** renders the studio: Board = floor, Agents = org chart + payroll,
  Digest = comms, Inbox = Owner's desk, **Studio** (new screen) = slate, budget
  burn, charter status, greenlight queue.
- **epoch0** is the reference instance. Its WORKFLOW.md / ART_WORKFLOW.md
  already implement most of this for Art; Bisellium generalizes it. Bisellium does
  not write to epoch0.

## 10. Decisions and open questions

**Decided 2026-09-17: conventions first, plus a reference harness for leads.**
The studio state is files; any toolchain can produce them; the console renders
them through adapters. Bisellium also hosts department leads' conversations
(`bisellium talk`) by driving the vendor CLIs headless (`claude -p --resume`,
`codex exec --resume`) in the seat's worktree, so the Owner can talk to a lead
from the console on subscription billing. Builders run wherever they run;
nothing is locked in. A full runtime that owns the agents (AllHands/OpenHands
style) remains out of scope.

Open:

- Multi-project: one studio per project, or one studio with a portfolio across
  projects?
- Charter amendment authority: Owner only, or can Production propose and
  auto-adopt after N days without objection?
