# Adopting Bisellium

An Bisellium-compliant project is a directory (usually a repo, or a folder in one)
with the files below. Agents and humans write these; Gantry reads them. Nothing
else is required. See `examples/sample-studio` for a complete instance.

```
bisellium.yml            manifest: departments, seats, gates, paths
charters/<dept>.md    one charter per department (CHARTER_TEMPLATE.md)
work/<id>.md          one file per work item, YAML front matter + notes
asks/<id>.md          questions to the Owner and threads the Owner opened
digest/<date>-<slug>.md   inform-and-proceed entries
budgets/<period>.yml  allowance and burn per department
usage.yml             observed provider limit telemetry
```

## bisellium.yml

```yaml
bisellium: 1
studio: Sample Studio
departments:
  - { id: engineering, name: Engineering, lead: eng-lead, charter: charters/engineering.md }
seats:
  - { id: eng-lead, department: engineering, kind: agent, model: claude-opus-5 }
gates:
  - { id: tests,  name: Tests,        kind: automated }
  - { id: review, name: Lead review,  kind: agent }
  - { id: owner,  name: Owner call,   kind: human }
wip_limit: 3
```

## Lifecycle (fixed)

`backlog → greenlit → building → verifying → review → done`, plus `halted`.
Greenlit is the Owner's slate decision; everything after it is the department's.

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
---
Free-form notes below the front matter.
```

A `pending` gate of kind `human` is what "needs you" means. Gate results
name the commit or hash they certify; a newer substantive change makes them
`stale`, never silently green.

## asks/<id>.md

```yaml
---
id: A-1
work: W-004
from: eng-lead        # or "owner"
to: owner
state: needs_you      # needs_you | awaiting_reply | resolved
---
The question, in one paragraph. Only asks that change material direction.
```

## digest/<date>-<slug>.md

```yaml
---
author: art-lead
kind: consultation    # consultation | decision | daily
title: Status icons go flat, not skeuomorphic
evidence:
  - { label: contact sheet, href: art/sheets/icons-v2.png }
---
The choice and the reason. Silence binds nothing.
```

## budgets/<period>.yml and usage.yml

```yaml
period: 2026-W38
departments:
  engineering: { allowance_tokens: 3000000, burn_tokens: 1900000 }
```

```yaml
providers:
  - { id: claude, usage_pct: 81, reset_at: 2026-09-18T14:00:00Z, status: conserve }
```

Posture per department is derived from burn/allowance (≥60% conserve,
≥85% closeout, ≥100% limited; no data → unknown). It is never self-declared.
