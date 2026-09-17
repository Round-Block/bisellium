# Adopting Bisellium

A Bisellium studio is a directory (usually a repo, or a folder in one) with the
files below. Agents and humans write these; the console reads them; `bisellium
check` validates them — every rule here is one `check` can fail. See
`examples/sample-studio` for a complete instance and `examples/fixtures` for
what failing looks like.

```
bisellium.yml            manifest: version, owner, departments, seats, gates, wip_limit, defaults
charters/<dept>.md       one charter per department (CHARTER_TEMPLATE.md)
work/<id>.md             one file per work item, YAML front matter + notes
asks/<id>.md             questions to the Owner not about one item; threads the Owner opened
digest/<date>-<slug>.md  inform-and-proceed entries
budgets/<period>.yml     allowances per department — burn is derived, never written
usage.yml                observed provider limit telemetry
```

Planned, not yet built: `bisellium init` (empty studio that passes check),
`bisellium new` (allocates work-item ids), `memory/seats/`, `decisions/`,
`archive/`, and the docs registry.

## bisellium.yml

```yaml
bisellium: 1                      # contract version; check refuses any other
studio: Sample Studio
owner: owner                      # the Owner's role id
timezone: Europe/London
departments:
  - { id: engineering, name: Engineering, lead: eng-lead, fallback: producer, charter: charters/engineering.md }
seats:
  - { id: eng-lead, department: engineering, kind: agent, model: claude-opus-5 }
gates:
  - { id: tests,  name: Tests,        kind: automated }
  - { id: review, name: Lead review,  kind: agent }
  - { id: owner,  name: Owner call,   kind: human }
wip_limit: 3                      # items in building + verifying, studio-wide
defaults:                         # optional overrides of the dossier's Defaults table
  handoff_stale_days: 3
```

Ids must be unique within departments, seats and gates. Every lead and
fallback must be a declared seat. A charter, if declared, must exist and
should contain "Decides alone", "Digests" and "Asks" sections.

## Lifecycle (fixed)

`backlog → greenlit → building → verifying → review → done`, plus `halted`.
Greenlit is the Owner's slate decision; everything after it is the department's.
State is asserted by the lead, but `check` fails a state the evidence cannot
support: `review` needs every automated gate and every other agent gate passed;
`done` needs all non-human gates passed and any recorded human gate passed or
waived. `waived` needs a `reason` and is never allowed on an automated gate.
WIP counts `building` + `verifying`; `review` waits on someone else.

## work/<id>.md

```yaml
---
id: W-004
title: Inventory drag-and-drop
kind: feature
department: engineering
owner: builder-1
state: review
gates:
  tests:  { status: passed, evidence: ci/812.log, certifies: a1b2c3d }
  review: { status: passed, evidence: reviews/W-004.md, certifies: a1b2c3d }
  owner:  { status: pending }
tokens: 412000
handoff: { seat: builder-1, stage: review, next: await owner call, blocked_on: owner, at: 2026-09-17T09:58Z }
---
Free-form notes below the front matter.
```

Required keys: `id` (must equal the filename), `title`, `kind`, `department`,
`state` — all non-empty strings. `handoff` (`seat`, `stage`, `next`,
`blocked_on`, `at` as an ISO date) is required on every active item
(`building`, `verifying`, `review`) and validated wherever present; it is stale
past `handoff_stale_days`. `halted` items require `reason` and `resume_when`,
and `halted_at` so their age can be tracked. A `pending` gate of kind `human`
is what "needs you" means. Passed and failed gates need `evidence` that exists
(a dead link is blocking) and should carry `certifies` — the tree hash they
certify, quoted; a newer substantive change makes them `stale`, never silently
green.

## asks/<id>.md

Asks are for questions *not* about one work item (scope, budget, charter, routing); `work` is optional. Item questions are gates.

```yaml
---
id: A-1               # must equal the filename
work: W-004           # optional; must exist if given
from: eng-lead        # a seat, or the owner
to: owner
state: needs_you      # needs_you (to must be the owner) | awaiting_reply (from must be the owner) | resolved
opened: 2026-09-17T09:58:00Z
---
The question, in one paragraph. Only asks that change material direction.
```

## digest/<date>-<slug>.md

```yaml
---
author: art-lead      # a seat, or the owner
kind: consultation    # consultation | decision | daily
title: Status icons go flat, not skeuomorphic
at: 2026-09-17T09:10:00Z
evidence:
  - { label: contact sheet, href: art/sheets/icons-v2.md }   # must exist
---
The choice and the reason. Silence binds nothing.
```

Each lead owes one `daily` per day; a missing or old daily is an advisory.

## budgets/<period>.yml and usage.yml

```yaml
# allowances only, Owner-written; burn is derived from item tokens / usage events
period: 2026-W38
departments:
  engineering: { allowance_tokens: 3000000 }
```

```yaml
providers:
  - { id: claude, usage_pct: 81, reset_at: 2026-09-18T14:00:00Z, status: conserve }
```

Posture per department is derived from burn/allowance (≥60% conserve,
≥85% closeout, ≥100% limited; no data → unknown). It is never self-declared.
Any `burn*` key in a budgets file is blocking: burn is derived, never mirrored.

## Running check

```bash
npm run check -- examples/sample-studio
```

Exit 0 passes, 1 has blocking findings, 2 means not a studio (or a usage
error). `--json` gives machine-readable findings with stable rule ids;
`--level block` limits output to what blocks; `--now <iso>` pins the clock for
reproducible age checks. `npm test` runs the sample and every fixture.
