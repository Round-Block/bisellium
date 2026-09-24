---
kind: contract
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the contract it documents is superseded by a new adoption doc
---

# Adopting Bisellium

## Vocabulary

Bisellium's product-facing contract uses Latin names. The wire-level
`workflow.*` / `gen_ai.* ` / `provider.*` attribute names and the lifecycle
state ids (`backlog`, `greenlit`, `building`, `verifying`, `review`, `done`,
`halted`) and gate/digest/provider status enums are the OTel-style wire
format, not product vocabulary — they stay English everywhere, including
inside Latin-named files.

| Latin | English |
|---|---|
| Patron | Owner |
| Collegium | Department |
| Magister | Lead |
| Sella | Seat / actor |
| Lex | Charter |
| Acta | Digest |
| Petitio | Ask / thread |
| Opus | Work item |
| Probatio | Gate |
| Traditio | Handoff |
| Aerarium | Budget |
| Stipendium | Allowance |

A Bisellium studio is a directory (usually a repo, or a folder in one) with the
files below. Agents and humans write these; the console reads them; `bisellium
check` validates them — every rule here is one `check` can fail. See
`examples/sample-studio` for a complete instance and `examples/fixtures` for
what failing looks like.

```
bisellium.yml              manifest: version, patron, collegia, sellae, probationes, wip_limit, defaults, integration
leges/<collegium>.md       one lex per collegium (LEX_TEMPLATE.md)
opera/<id>.md               one file per opus, YAML front matter + notes
briefs/<opus-id>.md        the spec an opus's `spec:` key points at (Intent · Files owned · Interfaces · Behaviours to test · Acceptance · Out of scope)
decisions/D-nnn.md         a decision with a kill condition — never a belief with no way to be wrong
lessons/L-nnn.md           one filed finding per distinct class, with non-empty, non-dead evidence
petitiones/<id>.md          questions to the Patron not about one opus; petitiones the Patron opened
acta/<date>-<slug>.md       inform-and-proceed entries
aerarium/<period>.yml       allowances per collegium — burn is derived, never written
usage.yml                observed provider limit telemetry
receipts/<sella>/<sessionId>.json  run receipts written by `bisellium run` (start + exit)
sessions/<sella>.json      talk session store, written by `bisellium talk` (gitignored, local like receipts/)
timeline/<sella>.jsonl     talk chatter, written by `bisellium talk` (gitignored, local like receipts/)
timeline/patron.jsonl      one line per Patron write (answer/greenlight/budget; gitignored, local like receipts/)
events.jsonl               live workflow telemetry (`bisellium emit`, snapshot diffing; gitignored, local like receipts/)
health.json                `bisellium tick`'s generated check + due-cadence snapshot (gitignored, local like receipts/)
PAUSED                     the manual-pause marker (`bisellium pause`/`bisellium resume`; gitignored, local like receipts/)
```

Receipts and ci logs are masked before they touch disk: a receipt's `cmd`
and every line `verify`'s local pipeline writes to `ci/*.log` (other than
its own `certifies`/header line) run through a `redact()` that masks
`token=`/`key=`/`secret=`/`password=` values, `Bearer <token>` headers, and
any standalone 32+ character hex/base64 run — a credential accidentally
passed on a command line should not become evidence sitting in the repo.
The same pipeline run also strips the child command's environment down to
an allowlist (`PATH`, `HOME`, `NODE_*`, `LANG`, `TZ`) plus anything that
doesn't look like a credential — any variable name matching
`TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL` (case-insensitive) is dropped unless
it's on that allowlist, so an untrusted probatio `command` can't read the
parent process's secrets out of its own environment.

Planned, not yet built: `memoria/sellae/`, `archive/`, and the docs registry.

## decisions/D-nnn.md and lessons/L-nnn.md

```yaml
---
id: D-001                                      # must equal the filename
title: Every active opus carries a spec before it enters building
at: 2026-09-18T19:00:00Z
provenance: stated                             # stated | observed | inferred | suggested
by: patron                                     # a sella, or the patron
kill_when: "two consecutive cascades show specs slowing more than they save"
supersedes: D-000                              # optional
---
```

```yaml
---
id: L-001                                      # must equal the filename
at: 2026-09-18T21:00:00Z
class: "tests×flaky"                           # "<probatio>×<kind>"
evidence: ["ci/retro-3.log"]                   # required, non-empty, no dead hrefs
cascade: 4                                     # optional
addressed_by: "opus.red_content"               # optional (W-035) — see below
---
```

`decision.shape` blocks a missing/ill-typed key, an id that doesn't match
its filename, or an unknown `provenance`. `decision.kill` blocks a missing
or empty `kill_when` — a decision with no kill condition is a belief, not a
decision. `lesson.shape` blocks the same class of shape errors; `lesson
.evidence` blocks an empty evidence list or a dead relative href (the same
contract `bisellium retro` refuses to violate — see below). `lesson
.recurrent` advises when a `class` shows up across two or more distinct
`cascade` values on two or more distinct lessons — the same mistake made
once is a lesson; made twice, it's a pattern the lex should probably name.

`addressed_by` (optional, W-035) names what closes the loop on a recurring
class — a lesson that reports a pattern is not, by itself, a record of
whether anything was done about it. It resolves to one of three id spaces,
tried in that fixed order (they're disjoint in practice: every rule id
contains a `.`, an opus/decision id never does):

```yaml
addressed_by: "opus.red_content"   # a rule id — a check now catches it
addressed_by: "W-035"              # an opus — work is open (state) or done
addressed_by: "D-016"              # a decision — formally accepted, unenforced
```

Absence means the class is simply ignored — the default, and every lesson on
disk before W-035 is absent-by-construction, so adopting the key costs no
migration. A decision target means "formally accepted, unenforced": since
`decision.kill` already refuses a decision with no `kill_when`, an
acceptance carries its own expiry for free — nothing new to invent. `lesson
.addressed_by` blocks when the key is present but isn't a non-empty string,
or when it's a non-empty string that names no opus, rule id, or decision.
Once *any* value resolves — a rule, a decision, or an opus whose `state` is
`done` — `lesson.recurrent` goes quiet for that class instead of reporting
it as unaddressed; a value naming an opus still `building` (or otherwise not
`done`) gets its own in-flight wording instead of silence. `bisellium retro`
reads the same key: a recurring class with an existing `addressed_by` files
no petitio (re-filing one for work already open, accepted or ruled-on is the
duplication this closes) and is instead listed, with its target and — for an
opus — its current state, under the retro's "## Addressed" section.

## bisellium retro

```bash
npm run bisellium -- retro --cascade <N> [--from <json>] [--studio <dir>] [--now <iso>]
```

Validates every `reviewFindings[].evidence` first (non-empty, no dead
relative href — the same contract `lesson.evidence` blocks) and writes
nothing at all if any of it fails, naming the offending class. Once
validated, it drafts `acta/<date>-retro-<N>.md`: numbers (verifier issues,
tests, fix rounds, mutations caught, agents), findings by class, one lesson
stub per distinct class (`lessons/L-nnn.md`), recurrence (the same
`lesson.recurrent` computation `check` runs, against history plus this
cascade), addressed (W-035: every recurrent class this cascade saw, its
`addressed_by` target if any existing lesson of that class names one, and —
for an opus target — its current state; unaddressed reads "nothing yet"),
proposals (a recurring, unaddressed class files a petitio to the Patron; an
addressed one files nothing — it already appears under "## Addressed"; a
one-off is adopted alone as an advisory rule), and pruning candidates
(decisions whose `kill_when` text matches a class this cascade actually
saw — listed, never edited).

`--from <json>`'s input can carry an optional `usage` (D-013, "usage is a
retrospectio input"):

```json
{
  "usage": {
    "agents": [{ "label": "builder-a", "role": "builder", "model": "claude-sonnet-5", "tokens": 12000, "minutes": 40 }],
    "totalTokens": 16500,
    "byModel": { "claude-sonnet-5": 12500, "claude-opus-5": 4000 },
    "byRole": { "builder": 12000, "reviewer": 4500 },
    "waste": { "reruns": 1, "refused": 0, "fixRounds": 1 }
  }
}
```

When `usage` is present, the acta gains a "## Usage" section: totals, a
by-model and by-role breakdown, the checking/building ratio (Opus
verify+review tokens ÷ builder tokens, split by each agent's `role`),
tokens per opus, a trend against the previous retro (reads the last one's
own "Total tokens:" line back out of its markdown), and posture read from
`aerarium/<current ISO week>.yml`. Absent `usage` entirely, no section is
added and nothing else about the draft changes — an existing caller that
never tracked usage sees byte-identical output. `scripts/
usage-from-workflow.mjs` builds this `usage` object (and the matching
`bisellium emit --usage` calls) straight from a Claude Code Workflow
tool's own output file — see `cascades/README.md`'s "Usage tracking"
section.

## bisellium.yml

```yaml
bisellium: 1                      # contract version; check refuses any other
studio: Sample Studio
patron: patron                    # the Patron's role id
timezone: Europe/London
collegia:
  - { id: engineering, name: Engineering, magister: eng-lead, fallback: producer, lex: leges/engineering.md, autonomy: L1 }
sellae:
  - { id: eng-lead, collegium: engineering, kind: agent, model: claude-opus-5, harness: claude-code }
probationes:
  - { id: tests,  name: Tests,        kind: automated, command: "npm test" }
  - { id: spec,   name: Spec,         kind: agent, since: 2026-09-18T19:00:00Z }
  - { id: review, name: Lead review,  kind: agent }
  - { id: patron, name: Patron call,  kind: human }
review_probatio: review           # probatio id that gates "review" state (default "review")
wip_limit: 3                      # items in building + verifying, studio-wide
defaults:                         # optional overrides of the dossier's Defaults table
  handoff_stale_days: 3
source_excludes: [examples/]      # optional; repo-root-relative paths also excluded from the SOURCE tree hash
integration:                      # optional (D-015); how an opus branch reaches the trunk — `bisellium merge` reads this
  strategy: rebase                # fast_forward (default) | rebase | merge_commit (declared, refused — not built)
  push: true                      # push the trunk (and, under pr.required, the opus branch) to origin. Default false
  pull_after_push: true           # `git pull` the trunk again after that push. Ignored when push is false
  pr:
    required: true                # merge stops after rebase+push, leaving the branch for a PR — never lands it locally
    reviewer: eng-lead             # advisory; nothing here opens the PR (W-028)
```

Ids must be unique within collegia, sellae and probationes, and each id must
be alphanumeric (`.`, `_`, `-` allowed) with no path separator or `..`
segment — every id can end up as a filename component (an acta or a daily
digest is named after one), so `check` blocks anything that isn't safe to
join into a path (`manifest.id.format`). Every magister and fallback must be
a declared sella. A lex, if declared, must exist and should contain "Decides
alone", "Digests" and "Asks" sections.

`collegia[].autonomy` (`L0`–`L3`, dossier §10) defaults to `L1` when absent;
`check` blocks any other value (`collegium.autonomy`). `bisellium tick`'s
cadence work (below) only acts on collegia at `L1` or above — `L0` is
manual and tick never touches it.

`integration:` (D-015) is optional; absent entirely it is today's only
behaviour — fast-forward only, no push, no PR. `bisellium merge <opus-id>`
reads it and, under `strategy: rebase`, replays the opus branch onto the
current trunk before landing it. A rebase changes the opus's SOURCE tree, so
any `tree:` certificate an automated probatio recorded before the rebase no
longer describes what is about to ship — `merge` does not re-run the gates
itself (that is `bisellium verify`'s job); it reads the opus record — both
its `state` and its certificates — from the opus branch itself (`git show
<branch>:<studio-rel>/opera/<id>.md`), falling back to the filesystem when
`--studio` resolves outside `--repo`, or on ANY other non-zero `git show`
(including the record simply not being tracked on that branch yet — that
case silently drops back to exactly the checkout-dependent read B5.1 fixed,
so it is not distinguished from "outside the repo" today). Where the record
IS read from the branch, `merge` checks a recorded `certifies: tree:<hash>`
against that same branch's current tree, on every call that would land or
push it (not only the call that happens to rebase, so a retry of the same
command can't defeat the refusal, and a branch that never needed a rebase at
all is still covered). Reading the branch's own copy — not whatever the
checkout `merge` happens to run from shows — matters because `merge` is
typically run from the trunk (that's the only checkout `git branch -D
<branch>` can succeed from): a disk read there can miss a certificate the
branch already has (round-5 B5.1(a): uncertified work lands) or refuse on a
stale certificate that survives only in the trunk's own copy (B5.1(b)).
Reading `state` the same way (round-6 B6.3) means `bisellium done <opus-id>`
— which has no branch flag and only ever writes wherever it's run — has to
be run, and committed, ON the opus branch for `merge` to ever see `state:
done` at all; a state mismatch names the branch explicitly ("not done on
opus/<id> (state: ...)"). The exclude set that DEFINES the tree hash a
certificate is compared against (the studio dir, `.bisellium/`, and any
`source_excludes` the manifest adds) is read the same way too (round-7
B7.1): an opus that declares its own `source_excludes` addition as part of
its own work is certified, by `verify` on the branch, under the branch's
manifest, and `merge` hashes against that same manifest rather than
whatever `--studio` shows on disk — a manifest read from the checkout would
compare the certificate to a hash it was never computed against, with no
achievable remedy (the certificate already IS the correct hash, so
re-verifying reproduces it byte-identical and the refusal repeats forever).
The remedy for a stale-certificate mismatch is to
check out the opus branch, re-run `bisellium verify` there, COMMIT the
result on that branch, then switch back to the trunk before retrying the
merge — the commit step is not optional: `verify`'s front-matter write only
ever lands on disk, and this read is from the branch's ref, so an
uncommitted write is invisible here and `git checkout <trunk>` afterwards
refuses ("commit your changes or stash them"). Running `verify` from a
trunk checkout instead (e.g. the studio's own default invocation) certifies
the trunk's tree, not the branch's, and can never produce a matching
certificate either way. A `certifies: dirty:<hash>` gate (an opus verified
with `--allow-dirty`) is never compared by `merge` at all — `merge` only
ever examines a `certifies` value that starts with `tree:`, so a gate that
certified `dirty:<hash>` and nothing else passes through unchecked; the
refusal for a dirty certificate comes from `bisellium done`, which demands a
`tree:` certificate for every `kind: automated` gate before `state: done`
can be written in the first place. An unrecognised
`strategy` value falls back to `fast_forward` rather than failing merge
outright (defensive reading, not a second validator — `bisellium check`
already blocks a typo'd `strategy` at `manifest.shape`, so this fallback is
merge's own defensive posture, never the only guard against one).
`pr.required: true` stops `merge` after the rebase/push, leaving the branch
for a PR to carry to the trunk (PR creation is W-028's territory); with
`pr.required: true`, `pull_after_push` never runs, since it lives only on the
landing path merge takes when no PR is required.

`command` (a shell command) is optional on a `kind: automated` probatio; it is
what `bisellium verify <opus-id>` runs to fill that gate's `status`/
`evidence`/`certifies` in the opus itself (see `## opera/<id>.md` and
`## Running check` below). An automated probatio with no `command` is never
touched by `verify` — its evidence has to come from elsewhere.

A probatio may carry `since: <ISO datetime>` — a non-string or unparseable
value is a manifest shape error. `since` exempts an opus from that gate
being *demanded* (not from ever being satisfiable) when the gate's `since`
is later than the opus's own `traditio.at`: the gate didn't exist yet when
that opus handed off, so it isn't retroactively required. An opus with a
missing or unparseable `traditio.at` gets no exemption from any gate — it
fails closed, the gate stays demanded, same as if `since` weren't declared
at all. This is what let W-018 add a `spec` probatio without turning every
already-`done` opus red: they all handed off before its `since`.

## Lifecycle (fixed)

`backlog → greenlit → building → verifying → review → done`, plus `halted`.
Greenlit is the Patron's slate decision; everything after it is the collegium's.
State is asserted by the magister, but `check` fails a state the evidence cannot
support: `review` needs every automated gate and every other agent gate passed;
`done` needs all non-human gates passed and any recorded human gate passed or
waived — **except** a gate exempted by `since` (above), which is dropped from
what's demanded entirely, for either state. `waived` needs a `reason` and is
never allowed on an automated or agent gate (`probatio.waived.automated`,
`probatio.waived.agent`). WIP counts `building` + `verifying`;
`review` waits on someone else.

Only a `kind: human` gate is waivable, and only `bisellium waive` writes
`status: waived` (W-034): it merges five keys into the gate's existing node —
`status: waived`, `reason`, `waived_by` (a decision id), `sella` and `at` —
never replacing the node, so any other key already on it survives. A waiver
is **honourable** only when `reason` is a non-blank string and `waived_by`
resolves (via `safeItemPath`, under `<studio>/decisions`) to a decision file
that exists, parses, and whose `by` equals `manifest.patron ?? "patron"`.
`done` accepts an honourable waiver on a human gate and names it permanently
on stdout (`done (waived: patron by D-900)`) and in the record itself — a
waiver is never rewritten into a `passed`. A waiver that isn't honourable, or
that sits on an automated or agent gate, is a `done` refusal, not a silent
pass.

`state.building.spec` (**block**) fires only when the manifest declares a
probatio with id `spec` — a studio that never opts in stays untouched. Where
it applies: `building`, `verifying` or `review` with no `spec:` front-matter
key, or whose `spec` gate isn't `passed`. `spec:` is an officina-relative
path to `briefs/<opus-id>.md` (`bisellium new --spec <path>`, or `--brief`
to also scaffold it); `done` and `halted` are never gated retroactively, and
`since` plays no part here — a spec is either on the opus or it isn't, there
is no "before the gate existed" case for a currently-active item.

## opera/<id>.md

```yaml
---
id: W-004
title: Inventory drag-and-drop
kind: feature
collegium: engineering
sella: builder-1
state: review
probationes:
  tests:  { status: passed, evidence: ci/812.log, certifies: a1b2c3d }
  review: { status: passed, evidence: reviews/W-004.md, certifies: a1b2c3d }
  patron: { status: pending }
tokens: 412000
traditio: { sella: builder-1, stage: review, next: await patron call, blocked_on: patron, at: 2026-09-17T09:58Z }
---
Free-form notes below the front matter.
```

Required keys: `id` (must equal the filename), `title`, `kind`, `collegium`,
`state` — all non-empty strings. `traditio` (`sella`, `stage`, `next`,
`blocked_on`, `at` as an ISO date) is required on every active item
(`building`, `verifying`, `review`) and validated wherever present; it is stale
past `handoff_stale_days`. `halted` items require `reason` and `resume_when`,
and `halted_at` so their age can be tracked. A `pending` gate of kind `human`
is what "needs you" means. Passed and failed gates need `evidence` that exists
(a dead link is blocking) and should carry `certifies` — the tree hash they
certify, quoted; a newer substantive change makes them `stale`, never silently
green.

## petitiones/<id>.md

Petitiones are for questions *not* about one opus (scope, aerarium, lex, routing); `opus` is optional. Item questions are gates.

```yaml
---
id: A-1               # must equal the filename
opus: W-004           # optional; must exist if given
from: eng-lead         # a sella, or the patron
to: patron
state: needs_you      # needs_you (to must be the patron) | awaiting_reply (from must be the patron) | resolved
opened: 2026-09-17T09:58:00Z
---
The question, in one paragraph. Only petitiones that change material direction.
```

## acta/<date>-<slug>.md

```yaml
---
author: art-lead      # a sella, or the patron
kind: consultation    # consultation | decision | daily
title: Status icons go flat, not skeuomorphic
at: 2026-09-17T09:10:00Z
evidence:
  - { label: contact sheet, href: art/sheets/icons-v2.md }   # must exist
---
The choice and the reason. Silence binds nothing.
```

Each magister owes one `daily` per day; a missing or old daily is an advisory.

## aerarium/<period>.yml and usage.yml

```yaml
# allowances only, Patron-written; burn is derived from item tokens / usage events
period: 2026-W38
collegia:
  engineering: { stipendium_tokens: 3000000 }
```

```yaml
providers:
  - { id: claude, usage_pct: 81, reset_at: 2026-09-18T14:00:00Z, status: conserve }
```

Posture per collegium is derived from burn/allowance (≥60% conserve,
≥85% closeout, ≥100% limited; no data → unknown). It is never self-declared.
Any `burn*` key in an aerarium file is blocking: burn is derived, never mirrored.

`bisellium providers [dir] --source auto|usage|quota-axi` prints this same
per-provider shape. `usage` reads `usage.yml` only, tolerating a malformed
entry the same way `quota-axi`'s own parsing does: an entry needs a
non-empty string `id` and a numeric `usage_pct` in 0–100, else that one
entry is skipped and reported as a `note` line (e.g. `- {}` prints nothing
for that entry, plus the note) — never a thrown error and never a silently
dropped row. `quota-axi` shells out to the live `quota-axi` CLI; when it's
explicitly requested this way and the tool is absent, unauthenticated, or
too slow, that's an honest failure — `bisellium providers --source
quota-axi` exits 1 with the one-line reason. `auto` (the default) composites
both, degrading to `usage.yml` silently (exit 0) whenever quota-axi is
unavailable, a live quota-axi reading for a provider id always taking
precedence over `usage.yml`'s for that same id. This asymmetry is
deliberate: `auto`/`check`/`run`/`verify` must never block on quota-axi
being present, but an operator who explicitly typed `--source quota-axi`
wants to know when it didn't work.

## Running check

```bash
npm run check -- examples/sample-studio
```

Exit 0 passes, 1 has blocking findings, 2 means not a studio (or a usage
error). `--json` gives machine-readable findings with stable rule ids;
`--level block` limits output to what blocks; `--now <iso>` pins the clock for
reproducible age checks; `--repo <dir>` additionally checks each automated
gate's `certifies` against that repo's current SOURCE tree (see "The SOURCE
tree hash" below), advising `probatio.certifies.stale` when a `tree:`
certificate no longer matches it — a staleness check is never a reason for
`check` itself to block. Independent of `--repo`, any gate certifying
`dirty:<hash>` (see `verify --allow-dirty` below) advises
`probatio.certifies.dirty`, and an automated gate whose evidence log doesn't
mention the tree/dirty hash it certifies advises `probatio.evidence.tree`
(the local pipeline writes that hash into the log's header, so this only
fires on a log that was hand-edited or came from elsewhere).
`probatio.certifies.mismatch` is a separate, `--repo`-independent check: a
`done` item whose gates certify different trees from each other. `npm test`
runs the sample and every fixture.

## The SOURCE tree hash

A `tree:<hash>` certificate is not `git rev-parse <ref>^{tree}`. That would
include the officina's own bookkeeping — opera front matter, `ci/*.log`,
receipts — everything under the studio dir and `.bisellium/`. If it were
used: (a) `bisellium verify` writing its own result back into an opus, once
committed, moves the hash, so every certificate a previous `verify` wrote
goes `stale` purely because `verify` (or a commit of its output) ran; and
(b) `verify`'s own writes, before they're even committed, would make the
working tree "dirty" and refuse to certify anything at all — a studio can
never verify itself twice in a row.

Instead, `sourceTreeHash(repo, excludeDirs, ref = "HEAD")`
(`@bisellium/shim`) hashes `git ls-tree -r <ref>` — one line per entry
(mode, type, blob sha, path), already path-sorted — with a sha1 over every
line whose path is *not* under one of `excludeDirs` (repo-root-relative;
`verify` and `check --repo` both pass the studio dir and `.bisellium`, plus
any `source_excludes` the manifest declares — below). Committing a change
that only touches an excluded path can't move this hash. The matching
working-tree check, `isDirtyOutside(repo, excludeDirs)`, is the same idea
applied to `git status --porcelain`: an uncommitted change only counts as
"dirty" when it's outside those same paths. `verify`'s `--repo` clean-tree
requirement (below) and `check --repo`'s staleness comparison both use this
pair, not the raw git plumbing.

`source_excludes` (`bisellium.yml`, above) extends the exclusion set beyond
the studio dir and `.bisellium/` with repo-root-relative paths of the
manifest's own choosing — a studio nested in a monorepo alongside unrelated
sibling studios or fixtures (e.g. `studio/`'s own `source_excludes:
[examples/]`, and `examples/sample-studio`'s `source_excludes: [studio/,
examples/fixtures/]`) so that sibling's churn never moves this studio's
certificates. `check` blocks a non-list-of-strings value (`manifest.shape`).

Certificate staleness/dirtiness/corroboration (`probatio.certifies.stale`,
`.dirty`, `.mismatch`, `.evidence.tree`) is judged only for opera in an
ACTIVE state — `building`, `verifying`, `review` — never for `done` or
`halted`: a done opus's certificate is history, and re-flagging it every
time the tree moves on afterward would be noise a done item can't act on.
`bisellium check --repo .` on a studio whose non-active opera carry old or
mismatched certifies shows no certifies advisories for them.

## Running run and verify

```bash
npm run bisellium -- run --sella <sella> --studio <dir> [--repo <dir>] -- <cmd…>
npm run bisellium -- run --reclaim --studio <dir>
npm run bisellium -- verify <opus-id> --studio <dir> --repo <dir> [--allow-dirty]
```

`run` executes `<cmd…>` as `<sella>`, in its own git worktree by default
(`--no-worktree` runs in place; `--base <ref>` sets the worktree's start
point; `--keep` keeps it even when clean), and always leaves a receipt under
`receipts/<sella>/` (gitignored — receipts are local liveness evidence, not
something to commit; `ci/*.log` stays tracked since opera link to it as
evidence). The worktree lives under `<repo>/.bisellium/worktrees/`, where
`<repo>` is the git repo root — resolved via `--repo`, or `git rev-parse
--show-toplevel` from the studio dir when the studio is a subdirectory of
the repo (never under the studio dir itself). `bisellium run --reclaim`
removes worktrees whose directory is gone or whose branch is fully merged
and clean, so that directory's growth is bounded; anything still in use
(unmerged branch, uncommitted changes, or not registered with `git worktree
list`) is left alone and reported as kept.

`verify` runs every `kind: automated` probatio's `command` against `--repo`
(defaulting to the studio's parent repo) and writes each one's
`status`/`evidence`/`certifies` back into that opus's front matter — it
touches only those three keys on each gate it runs, merged into the existing
probatio node so sibling keys (`waived_by`, a `note`, comments, …) and every
other gate survive untouched. `handoff`, `greenlight` and `waive` (below) are
the other tool-written changes to an opus, and go through the exact same
merge-not-replace seam (`editOpusFrontMatter`, packages/cli/src/frontmatter.ts):
each touches only the keys its own contract names — `traditio`'s five keys
for `handoff`, `state`/`declined` for `greenlight`, and `status`/`reason`/
`waived_by`/`sella`/`at` on one human gate for `waive` — never anything else.
A gate already `status: waived` is skipped entirely (not run, not
overwritten) and printed as `<id>: waived (untouched)`. Before running,
`verify` requires a clean SOURCE tree in `--repo` — `git status --porcelain`
entries under the studio dir or `.bisellium/` don't count (see "The SOURCE
tree hash" above) — a command's result only means something if it ran
against exactly the tree it's about to certify, and that tree is the source,
not the studio's own bookkeeping. A dirty tree exits 2 with "working tree is
dirty; commit or pass --allow-dirty"; with `--allow-dirty`, `verify` runs
anyway and certifies `dirty:<hash>` instead of `tree:<hash>`, an honest
admission that the certified hash isn't exactly what ran (see
`probatio.certifies.dirty` above). Because opera/ci/receipt writes are
excluded from both the hash and the dirty check, running `verify` again
right after itself — even without committing anything in between — needs no
`--allow-dirty` and certifies the same hash. Exit codes: 0 all automated
gates that ran passed, 1 at least one failed, 2 usage error / not a studio /
unparseable sibling opus / dirty source tree without `--allow-dirty`.

## Running ci

```bash
npm run bisellium -- ci [--ref <ref>] [--opus <id>] [--studio <dir>] [--repo <dir>] [--allow-dirty]
```

`ci` runs this repository's CI pipeline locally, without a runner: the
commands in `CI_STEPS` (`packages/commands/src/ci.ts`), in order, in
`--repo` (default the current directory), stopping at the first that
fails. Today those are `npm run -s typecheck`, `npm run -s lint`,
`npm run -s format:check`, `npm test`,
`npm run -s check -- studio --repo .` and
`npm run -s check -- examples/sample-studio --repo .`. The steps are fixed
in code and name this repository's two officinae; `ci` is not an adoption
feature. `.github/workflows/ci.yml` runs the same commands, each after
`npm ci`, split across two jobs: `gates` runs every step except the studio
check, in `CI_STEPS` order, and is the one a branch protection rule can
require; `officina` runs `npm run -s check -- studio --repo .` alone and is
deliberately not required, since it stays red on known officina debt
(W-028's ruling). So the runner does not reproduce `ci`'s single sequence,
and that divergence is deliberate. `scripts/ci-workflow.test.mjs`, part of
`npm test`, fails when they drift: when `gates` differs from `CI_STEPS`
minus the studio check, when `officina` is anything but that one check, or
when this section stops naming a `CI_STEPS` command or `ci`'s usage. The
workflow never runs `verify`, so no certificate is ever written from a
runner.

A failed studio check also prints that it is officina-wide and that
`bisellium verify <opus>` is the per-opus gate. `--ref <ref>` runs the
steps in a scratch worktree of `<ref>` instead, after a from-scratch
`npm ci` there against a throwaway cache (a worktree without its own
`node_modules` would resolve `@bisellium/*` through the parent checkout and
test the wrong code), and releases the worktree afterwards. `--opus <id>`
runs `bisellium verify <id>` against the same tree once every step has
passed, forwarding `--studio`, so the automated gates' certificates come
from `verify` itself; run it on the opus branch (D-021). `--allow-dirty` is
passed to that `verify`, and on the `--ref` path it always is, since the
scratch checkout is untouched. Exit codes: 0 every step passed (with
`--opus`, `verify`'s own exit code instead), 1 a step or `--ref`'s install
failed, 2 usage error, no git repo for `--ref`, or a ref that cannot be
checked out.

## Writing to a studio (handoff, emit, answer, greenlight, budget)

```bash
npm run bisellium -- handoff --opus <id> --sella <sella> [--stage <state>] --next <text> [--blocked-on <text>] [--studio <dir>] [--now <iso>]
npm run bisellium -- emit '{"name":"workflow.custom","attrs":{"k":"v"}}' [--studio <dir>] [--now <iso>]
npm run bisellium -- answer --petitio <id> <reply…> [--opus <id>] [--ask-back] [--charter-gap] [--studio <dir>] [--now <iso>]
npm run bisellium -- greenlight <opus> [--decline <reason>] [--studio <dir>] [--now <iso>]
npm run bisellium -- budget <period> --collegium <id> --tokens <n> [--hours <n>] [--studio <dir>] [--now <iso>]
```

`handoff` validates `--sella` is declared and, when `--stage` is given, that
it equals the opus's current `state` (omit `--stage` to just reuse the
current state) — a mismatch or an undeclared sella is a validation error
(exit 2). It writes `traditio: { sella, stage, next, blocked_on, at }` on the
opus, merged in via the same `editOpusFrontMatter` seam `verify` uses
(packages/cli/src/frontmatter.ts) — nothing else on the opus changes, byte
for byte. `--blocked-on` defaults to `none`.

`emit` validates a minimal event shape (`{name, attrs?}`, `attrs` values
string/number/boolean only) and appends one `GantryEvent` to
`<studio>/.bisellium/events.jsonl` (`EVENTS_LOG_REL`) via `@bisellium/core`'s
`appendEvents`, stamped `workflow.source: cli` and a `workflow.source.seq`
taken from the log's current length. `events.jsonl` is live/derived
telemetry, not the studio's committed record — gitignored, same reasoning as
`receipts/` and
`timeline/`.

`emit --usage <tokens> --opus <id> --sella <sella> --model <model>
[--studio <dir>] [--now <iso>]` is a shortcut over the same append: instead
of a `<json>` positional, it builds a `gen_ai.usage` event with
`gen_ai.usage.total_tokens: <tokens>`, `gen_ai.request.model: <model>`,
`workflow.item.id: <opus>`, `workflow.actor.role: <sella>` and, when the
named opus's own front matter declares a `collegium`, `workflow.department:
<that collegium>`. This is what makes `burn` (`packages/core/src/
index-db.ts`) derive a collegium's period spend from real recorded usage,
rather than nothing at all. `cascades/README.md`'s "Usage tracking" section
and `scripts/usage-from-workflow.mjs` are the documented bridge from a
Workflow-tool run's own output into a series of these calls.

`answer`, `greenlight` and `budget` are Patron writes: the CLI runs them
with `BISELLIUM_ROLE=patron`, and each one appends a line to
`<studio>/timeline/patron.jsonl` (also gitignored) recording what the Patron
just did. `answer --petitio <id> <reply…>` appends
`\n\n[stated] <now> <patron>: <reply>` to the petitio's body and resolves it
(`state: resolved`); `--ask-back` instead flips `from`/`to` so the Patron
becomes the asker and sets `state: awaiting_reply` (matching `check`'s
`petitio.direction` rule) — allowed only when the petitio is currently
`needs_you` (exit 2 otherwise, file untouched), so a second `--ask-back`
before the sella has replied can't flip `from`/`to` a second time and
corrupt the record; `--charter-gap` additionally files a `kind:
decision` acta proposing a lex amendment, titled `Lex gap: <first line of
the petitio>`. `--opus <id>` (W-035) records what work the Patron's reply
commissions: it sets `opus: <id>` on the petitio (the same key
`petitio.opus` validates) and on the Patron timeline entry, resolved against
`opera/` before anything is written — an unknown opus exits 2 with the
petitio byte-identical, same rollback contract as any other failure here.
Answering without `--opus` stays allowed (most answers aren't commissions);
resolving one without it prints one stderr note — `resolved without --opus —
nothing records what work this becomes` — exit code still 0. `greenlight <opus>` requires the opus be `state: backlog`
(exit 2 otherwise) and either sets `state: greenlit` or, with `--decline
<reason>`, leaves it in backlog and records `declined: <reason>` — either
way it emits a `workflow.greenlight` (`granted`/`declined`) event. `budget
<period> --collegium <id> --tokens <n> [--hours <n>]` creates or merges
`aerarium/<period>.yml`, writing only `stipendium_tokens`/`stipendium_hours`
under that collegium (`period` must match `^\d{4}-W\d{2}$`); like every
command here its flag parser is strict, so an unrecognized flag (e.g. a
`--burn-*` one, trying to write a derived key) is refused, not silently
ignored.

## The `.bisellium/` directory

Every derived/local artifact `@bisellium/core`'s `Store` (and anything built
on it — `apps/server`, `bisellium query --from-index`) owns lives under one
gitignored directory at the studio root, so cleaning a studio's local state
is always `rm -rf <studio>/.bisellium`:

```
<studio>/.bisellium/events.jsonl        the append-only event log (EVENTS_LOG_REL) —
                                         `emit`/`handoff`/`answer`/`greenlight`/`budget`
                                         (packages/cli/src/writes.ts), a Store's own
                                         ingest(), and `bisellium hook-event tool` all
                                         append here; nothing ever rewrites a line.
<studio>/.bisellium/snapshots/<source>.json   the last snapshot a Store ingested for
                                         one source (SNAPSHOTS_DIR_REL), so a restart
                                         diffs against what it actually last saw
                                         instead of replaying the whole studio as
                                         newly appeared. One file per source
                                         (`cli`, `server`, `query`, a sample studio's
                                         adapter id, …) — sources never share a
                                         sequence counter or a snapshot baseline.
<studio>/.bisellium/index/index.db      the SQLite index (INDEX_DB_REL, `node:sqlite`)
                                         every Store keeps fed from the log —
                                         `opera_state`/`petitiones_state`/
                                         `providers_state`/`events` tables, all
                                         derived: `Index.rebuild()` drops and replays
                                         them from `events.jsonl`, so a corrupt or
                                         missing index.db is recovered (deleted and
                                         recreated empty), never fatal.
```

A corrupt line in `events.jsonl` (fails to parse, or parses but isn't
event-shaped) is dropped and counted (`Store.corruptLines`), never thrown —
same "degrade, don't throw" discipline as every file-based reader in this
document. `.bisellium/` is gitignored at every depth (`.gitignore`'s
`.bisellium/` line, no leading slash) — under a studio dir, under
`examples/sample-studio`, anywhere.

## Running serve

```bash
npm run bisellium -- serve [--studio <dir>] [--port 4477] [--poll-ms 5000] [--now <iso>] [--once]
```

`apps/server`'s `startServer` (wrapped by the CLI as `bisellium serve`) is a
localhost-only HTTP + SSE surface over one studio: it binds `127.0.0.1`
only, ingests one snapshot at start, and (unless `--once`) polls again every
`--poll-ms`. It shares `EVENTS_LOG_REL`/`SNAPSHOTS_DIR_REL` with
`@bisellium/core`'s `Store` so the two read/append the exact same
`.bisellium/` files, though `apps/server` keeps its own small per-source
(`"server"`) ingest bookkeeping rather than depending on `Store`'s class
directly (see the file header comment on `apps/server/src/store.ts`). Reads:

```
GET  /api/officina                 the manifest: patron, collegia, sellae, probationes, wip_limit
GET  /api/opera?state=&collegium=  every opus, filterable
GET  /api/opus/:id                 one opus's front matter + body + probationes + traditio
GET  /api/inbox                    needs-you: pending human gates + petitiones needing a reply
GET  /api/acta?days=               digest entries within the last `days` (default 7)
GET  /api/aerarium?period=         allowance + derived burn + posture per collegium
GET  /api/providers?live=          provider status (usage.yml, or live quota-axi with live=1)
GET  /api/health                   health.json if `tick` wrote one, else a fresh check summary
GET  /api/timeline/:sella?limit=   that sella's (or the Patron's) timeline
GET  /api/events?since=&limit=     raw log events, with a stable `seq` a client can resume from
GET  /api/receipts?sella=          receipts, all sellae or one
GET  /api/live                     SSE: `data: <event>` for every newly-ingested event
```

Writes reuse `packages/cli/src/writes.ts`/`talk.ts`/`pause.ts` verbatim (same
validation, same exit codes, `stdout`/`stderr` captured into the JSON
response body) and are refused from anything but `127.0.0.1`:

```
POST /api/answer      {petitio, reply, askBack?, charterGap?}
POST /api/greenlight   {opus, decline?}
POST /api/budget       {period, collegium, tokens, hours?}
POST /api/handoff      {opus, sella, next, stage?, blockedOn?}
POST /api/talk         {sella, message, harness?}
POST /api/pause        {reason?}
POST /api/resume       {}
```

Every write route serializes through one per-server async lock, so two
overlapping writes (e.g. two `/api/talk` calls, which can each take minutes)
queue instead of interleaving through the shared `console.log`/`console.error`
capture. `POST /api/_poll` (manual re-ingest) only answers outside
`NODE_ENV=test` with a 404 — it exists for tests to force a poll
deterministically, never a route a real client should call. `close()` ends
every open `/api/live` connection before closing the HTTP server, so a
connected SSE client never makes shutdown hang.

## Running tick, pause and resume

```bash
npm run bisellium -- tick [--studio <dir>] [--now <iso>] [--dry-run] [--repo <dir>]
npm run bisellium -- pause [--studio <dir>] [--reason <text>]
npm run bisellium -- resume [--studio <dir>]
```

`tick` is L1 "scheduled" autonomy (dossier §10): it always runs `check` and
writes `<studio>/health.json` (`at`, `ok`, `blocks`, `advisories`,
`findingsByRule`, `autonomy`, `lastTick`, `due`) — even while paused, even
when `check` has blocking findings. It then computes the DUE cadence list
for collegia at `autonomy: L1` or above (the current ISO week is computed
tz-aware, in the manifest's `timezone` — a studio near a week boundary at
midnight UTC can be in a different ISO week locally): one `daily` per active
collegium's magister who hasn't filed one today — "already filed" is true
either from a parsed, valid `at` on today's date, or from the acta filename
alone (`<date>-<sella>-daily.md`) matching today, so a daily with a corrupt
`at` still counts and tick never spends a second harness turn re-filing it —
the current ISO week's `aerarium` file if it doesn't exist yet, and any opus
under an active collegium whose `traditio` is older than
`handoff_stale_days`. `--dry-run` only prints what's due; otherwise `daily`
items get a real acta written (talking to the magister's sella through
`bisellium talk`'s programmatic seam, no CLI subprocess), its title and body
passed through `redact()` first — a tracked, committed acta file must not
carry a credential the model happened to include, same reasoning as `talk`'s
own timeline entries — while `aerarium`/`traditio` items are reported only —
writing either is a Patron/sella act, not tick's. `tick` finishes by writing
a receipt under `receipts/tick/`. Exit codes: 0 `check` passed (or paused), 1
`check` had blocking findings, 2 usage error / not a studio.

`pause` writes `<studio>/PAUSED` (`{ at, reason }`); `resume` removes it.
While paused, `tick` runs only the `check` + `health.json` step above and
skips all cadence work — no acta, no receipt. The brake stops *starting*
autonomous work, not talking: `run` and `talk` both proceed regardless while
paused, each printing a one-line `warning: studio is paused …` first (the
Patron talking to a sella directly is how you find out why it's paused).

## Running talk

```bash
npm run bisellium -- talk --sella <sella> [--studio <dir>] [--harness <id>] [--model-only] [--now <iso>] <message…>
```

`talk` is the Patron's direct line to one sella, driving its vendor CLI
headless (docs/STUDIO.md §11: `claude -p --resume`, `codex exec --resume`)
through a `@bisellium/shim` `HarnessProfile` — `claude-code` (tier 1),
`codex` (tier 2), or `git-only` (tier 3: always "available", but talking to
it is a contradiction in terms — `start`/`resume` refuse). Which profile a
sella uses is its manifest entry's `harness` key (`sellae[].harness`,
default `claude-code`), overridable per call with `--harness`. The boot
bundle reaches `claude` via `--append-system-prompt-file <tmpfile>` (written
just before the call, deleted right after) rather than as an argv token —
an argv-sized prompt risks the platform's argv length limit and is visible
in `ps`, neither a problem for a file.

A vendor CLI reporting a real usage/rate limit (`Turn.exitCode ===
USAGE_LIMIT_EXIT_CODE`, mapped to `talk`'s exit 3 below) is detected only
from signals a sella's own conversation can't fake by talking ABOUT a
limit: for `claude-code`, the JSON envelope's own `is_error`/`subtype`/
`error` fields, or stderr; for `codex`, stderr or a dedicated `error`-kind
JSONL event. A reply's `result`/`agent_message` text (what the sella
actually said) is never inspected for this — a sella relaying "we hit a
rate limit yesterday" or mentioning "429" must be delivered normally, not
mistaken for the harness itself being limited. `codex`'s event parsing also
reads an `agent_message`/`assistant` reply wrapped in `item.completed`
(`{ type: "item.completed", item: { type: "agent_message", text } }`, a
shape some codex-cli releases use), not just a top-level event.

A question `bisellium query` already answers deterministically (`status
W-<id>`, `burn`, "what is blocked on me") is answered from the studio's
files — printed as `query · <answer>` — without starting or resuming a
harness session at all, unless `--model-only` forces the model path.
Otherwise `talk` builds the sella's boot bundle (the same one `bisellium
context` prints) as the system prompt, starts a session or resumes the last
one recorded for that sella *on the same harness* (`sessions/<sella>.json`:
`harness`, `sessionId`, `startedAt`, `lastAt`, `turns` — switching
`--harness` starts a fresh session rather than resuming under a mismatched
vendor), prints the reply, and appends both sides of the exchange to
`timeline/<sella>.jsonl` (`at`, `sella`, `direction: in|out`, `text`,
`sessionId`, `model`, `usage`). `talk` always runs in the studio root, never
inside a worktree — worktrees are for `run`, which actually changes files;
a conversation doesn't. Every vendor spawn a harness profile makes —
`claude-code`'s and `codex`'s `start`, `resume` and `available()` alike, so
the rule holds even for a bare `--version` probe — hands the child process
only ten env names (`PATH`, `HOME`, `SHELL`, `TMPDIR`, `HTTPS_PROXY`,
`https_proxy`, `HTTP_PROXY`, `http_proxy`, `NO_PROXY`, `no_proxy`), each
copied verbatim from the parent if set (`harnessEnv`,
`packages/shim/src/harness/env.ts` — not a `@bisellium/shim` export).
Everything else is dropped, an endpoint or auth override and a vendor
variable that doesn't exist yet included: a talked session authenticates
only with the vendor login stored under `HOME`, never an ambient
`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` or similar left in the
operator's shell. `run -- <cmd>` is not a harness spawn — it's the
operator's own command, attributed to a sella, and keeps the operator's
env unfiltered.

A harness turn that comes back with no usable `sessionId` (empty or
non-string) is never persisted or resumed against: it's recorded as a fresh
start (`sessions/<sella>.json`'s `sessionId: null`, with a `note` on both of
that turn's `timeline/<sella>.jsonl` entries), and `readSession` treats any
stored record whose `sessionId` isn't a non-empty string the same way — as
if there were no session file at all, so the next call starts fresh again
rather than ever resuming against `""` or `null`.

A conversation is chatter (dossier: STUDIO.md §5) unless it escalates: a
reply line starting `PETITIO: <text>` opens a petitio addressed to the
patron (the next `P-NNN` under `petitiones/`, `from` the sella, `state:
needs_you`) and `talk` prints `petitio P-NNN opened`; a line starting
`ACTUM: <text>` writes a `kind: decision` acta entry authored by the sella.
Everything else in the reply stays in the timeline only — silence (or an
ordinary reply) binds nothing, same as any other acta. Three guards apply
before a line counts as either: it must be **top-level** (`^PETITIO:`/
`^ACTUM:` with no leading whitespace — a line nested under a list or
blockquote never matches), **unfenced** (not inside a ` ``` … ``` ` block —
a sella quoting an example must not accidentally escalate), and **not an
echo**: a line whose trimmed text already appears verbatim in the boot
bundle sent as that turn's system prompt (e.g. a `PETITIO:`-looking line
inside another petitio's body, embedded as context) is content, not a fresh
instruction to escalate, and is skipped. Usage-limit detection itself never
looks at reply text either (below) — only a harness's own envelope/event/
stderr signal ever produces the exit-3 path this section's petitio/decision
logic runs after.

`talk` writes a run receipt exactly like `bisellium run` does
(`receipts/<sella>/<sessionId>.json`), with `harness` set to the profile id
that actually ran instead of `"run"`. Exit codes: 0 ok (including the
deterministic-query fast path) · 1 the harness exited 0 but the reply was
empty — refused as a failure, nothing persisted (session, timeline and
receipt alike; see below) · 2 usage error / not a studio / unknown sella /
unknown or unavailable harness (one-line reason) · 3 the harness reported a
usage/rate limit, printed as `<sella> is limited on <harness>; try again
after <reset if known>` · anything else is the harness's own exit code,
relayed as-is.

**The `claude-code` profile's talk boundary is deny-by-default (W-044).**
Both `start` and `resume` pass `--restricted` (ignores every user/project/
local settings file, confines file tools to the studio root), `--strict-mcp-
config` (no MCP servers), `--permission-mode dontAsk` (anything not
pre-approved is denied, never prompted for), `--tools Read,Grep,Glob,Bash`
(`WebFetch` is not admitted — paired with `Read` it would be the profile's
only egress), and an `--allowedTools` list admitting exactly `Read`, `Grep`,
`Glob`, and seven `Bash(bisellium …)` rules for `context`, `query`, `check`
and the bare `bisellium` usage banner. `providers` is not admitted either —
its default source spawns `npx --yes quota-axi`, a network fetch plus
third-party code that neither `talk` nor `tick`'s unattended daily needs; the
cached provider posture is already in the boot bundle. A `claude` binary
that doesn't recognize `--restricted`/`dontAsk` exits non-zero and `talk`
relays that failure closed, which is intended.

**The decreed model reaches both profiles, and codex gets its own command
policy (W-046).** The model `talk` uses is decreed by the manifest —
`sellae[].model` — and travels from there into whichever profile the sella's
harness resolves to; `talk` itself has no `--model` flag, and no `--model`
flag is ever accepted (models are decreed, per D-020; a per-call override
would be a route around that decree — `--harness` already exists for the
one axis an operator legitimately switches). Nothing is ever read from
`process.env`, a vendor config file, or a session being resumed. On
`claude-code` it is passed as `--model <id>` (ahead of the W-044 policy
flags above — `--allowedTools` is variadic and terminal, so anything added
after it would be silently eaten as a tool name); a `claude` binary that
doesn't recognize the requested model exits non-zero
(`[claude-code:unrecognized_model]`), and `talk` relays the exit code **and**
the vendor's own captured diagnostic in its failure message — bounded,
redacted, never parsed or branched on (behaviour 7) — and nothing stronger,
so a sella whose declared model doesn't belong to its harness stops silently
running on the wrong model and starts failing loudly and readably. On
`codex` it is
passed as `-m <id>`, alongside a module-local command policy applied
identically by `start` and `resume` (`codex exec resume` rejects
`-s`/`--sandbox` on codex-cli 0.153.4, so the sandbox mode travels as
`-c sandbox_mode=read-only` instead, which both spawns accept):
`--ignore-user-config`, `--ignore-rules`, `-c sandbox_mode=read-only`,
`-c model_provider=openai` (passed explicitly because
`--ignore-user-config` drops the config file that used to supply it), and
eight `--disable` feature pairs — `--disable browser_use`, `--disable
browser_use_external`, `--disable browser_use_full_cdp_access`, `--disable
in_app_browser`, `--disable apps`, `--disable plugins`, `--disable
remote_plugin`, `--disable plugin_sharing` — each measured stable and
enabled by default on codex-cli 0.153.4, flipped to `false` by `--disable`.
**That list is the whole achievement on the tool surface — those eight
names, not "no egress."**

**CORRECTED, round 2 (censor F-1): a live vendor-side web fetch/search
channel survives the whole policy, closed by none of the eight `--disable`
names.** Measured under the exact shipped argv, twice, with a hallucination
control: a talked codex session can fetch a live, moving value over the
network (`web.run`) and report it back. The fetch runs vendor-side, so
neither the studio's bubblewrap sandbox nor `sandbox_mode=read-only` touches
it. No egress-closing flag is specified here, because none was probed;
whether one exists is the follow-on's question.

**This is not W-044 parity, and the gap is signed, not hidden: codex's
policy here is not equivalent to the claude profile's.** Five residuals,
carried forward until a build-shaped follow-on opus can close them, egress
first because it is the largest: **egress is open, paired with unbounded
reads — the exact pairing W-044 refused.** `sandbox_mode=read-only` permits
every read the operator can perform, including `~/.codex/auth.json` (a
talked claude session cannot run `cat` at all), and a live web fetch/search
channel survives alongside it; W-044 dropped `WebFetch` from the claude
profile because, in its own words, "paired with `Read` it would be the
profile's only egress" — the codex profile ships with both halves of that
pairing. **No tool allowlist** — claude enumerates what may run; codex
offers only a denylist of eight named features, and a denylist goes stale
the day a new feature ships. **AGENTS.md still loads** — neither the user's
nor the project's is covered by any flag here. **Configuration channels
beyond the user config file are unmeasured** — project, managed, system and
cloud defaults are residual, not proven absent. Codex authenticates only
from the default login location,
`$HOME/.codex/auth.json`; `CODEX_HOME` and `OPENAI_API_KEY` are
deliberately not passed (off W-049's ten-name env allowlist by design), so
a custom config home or an API-key-only login does not work through a
bisellium-spawned codex.

## Harness hooks (Claude Code)

```bash
npm run bisellium -- hooks print --harness claude-code --sella <sella> [--studio <dir>]
npm run bisellium -- hooks check --harness claude-code [--studio <dir>]
npm run bisellium -- hook-event <start|stop|tool|compact> --sella <sella> [--studio <dir>]
```

Where `talk` drives a harness directly, hooks let the harness drive itself:
running a sella straight inside Claude Code (no `bisellium talk` subprocess)
while still leaving the same receipts and events a subprocess run would.
`hooks print` prints (never writes) the `.claude/settings.json` block to
paste in by hand: `SessionStart` runs TWO commands — `bisellium context`
(its stdout becomes the sella's injected boot bundle) and `hook-event start`
(opens the session's receipt) — `PreCompact` re-runs just `bisellium
context`, and `Stop`/`PostToolUse` (`Write`/`Edit` only) wire to `hook-event
stop`/`hook-event tool`. `SubagentStart` is intentionally left unwired — a
subagent has no sella of its own to hand a receipt or boot bundle to.

`hook-event` is the actual command each hook runs: it reads the hook's JSON
payload from stdin and always exits 0 (at most one line to stderr on any
failure) — a broken studio must never block the harness. `start`/`stop`
write and close a `receipts/<sella>/<sessionId>.json` receipt exactly like
`bisellium run`'s (`harness: "claude-code"`); `stop` also prints a one-line
reminder when that sella's active opus has a `traditio` older than 24h.
`start`/`stop` treat the payload's `session_id` (and `--sella`) as untrusted
input joined straight into that path: either one failing
`/^[A-Za-z0-9._-]{1,128}$/` (no separators, no bare `.`/`..`, bounded length)
is refused — one short stderr line, still exit 0 — rather than ever writing
outside the studio dir or letting an oversized value blow up the error text.
`tool` appends one `workflow.tool_used` event to `<studio>/.bisellium/events.jsonl`
(the same log `@bisellium/core`'s Store reads), with the touched file path
redacted the same way a run receipt's argv is. `compact` appends a note to
`timeline/<sella>.jsonl`.

`hooks check` reports each declared sella's most recent hook receipt and
flags `hook dead`: a sella whose harness is `claude-code` (the default) but
whose last few receipts (default 3) carry no `harness: "claude-code"` entry
— advisory, never a hard failure, and only once the studio has *some*
receipt history (a never-run studio isn't "dead", it's just new). `check`'s
own `hook.dead` rule reports the same thing for every studio check already
runs.
