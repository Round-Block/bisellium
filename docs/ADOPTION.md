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

Agent studio — the category Bisellium occupies: not where you build an agent, the organization that employs them; models and harnesses plug in, the studio runs the work.

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
models.json                `bisellium probe`'s generated (model, harness) availability record (gitignored, local like receipts/)
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

`ci/` evidence has three command-owned writers. `verify` records automated
gate runs, `red` records a failing command per behaviour (and warns on stderr
when it records a `dirty:` tree identity), and `verdict` records a review
transcript without evaluating or changing any gate.

## bisellium verdict

```bash
npm run bisellium -- verdict <opus> --round <n> --sella <id> --outcome <text> [--phase spec|build] [--model <id>] [--from <path>] [--dispatch-prompt <ci-path>] [--ui-input <ci-path>] [--studio <dir>] [--now <iso>]
```

`verdict` copies a transcript from `--from` (or stdin when omitted) into
`ci/<opus>-spec-<n>.log` for `--phase spec`, or
`ci/<opus>-review-<n>.log` for `--phase build` (the default). A `--from`
path is a read source and may be outside the officina; it must name a regular
file. The header records the opus, phase, positive-integer round, non-blank
sella and free-text outcome, optional model, timestamp, and the capture-time
state of the repository containing `--studio`. Header values cannot contain
CR or LF. An existing target is never overwritten.

For a native `kind: ui` opus, a spec verdict is the required `ui-lead`
design input. Its outcome is exactly `passed`, `failed`, or `revise`; none of
those values itself signs or vetoes a gate. `--dispatch-prompt` must name a
contained regular file under `ci/`. The writer validates the Findings and
Recommendation structure and records both that prompt and a `design_digest`
of the exact title plus raw current brief. A UI build verdict instead requires
`--ui-input` naming the current highest-round UI input and a nonblank
`## UI input disposition`; it records the citation and the same digest. These
references reject symlinks, non-regular files, traversal and stale design
bytes. Non-UI verdict behavior is unchanged.

The command writes evidence only: it does not update `probationes`, state,
events, or timelines. A build orchestrator can follow it with
`review --evidence <path>`; spec verdicts are citable evidence for `retro`, not a second
spec gate.

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
  - { id: builder,  collegium: engineering, kind: agent, model: claude-sonnet-5 }
  - { id: builder-a, collegium: engineering, kind: agent, model: claude-sonnet-5, retired: true }  # tombstone — see "Seats and instances"
tiers:                             # optional (D-023 §2); rung id -> current holder model
  - { id: fast,       model: gpt-5.6-luna }
  - { id: mid,        model: gpt-5.6-terra }
  - { id: high,       model: gpt-5.6-sol }
  - { id: escalation, model: gpt-6-astra }
  - { id: build,      model: claude-sonnet-5 }
  - { id: review,     model: claude-opus-5 }
munera:                            # optional (D-023 §2); task-type id -> tier id
  - { id: aggregation, tier: fast }
  - { id: audit,       tier: mid }
  - { id: build,       tier: build }
  - { id: review,      tier: review }
probationes:
  - { id: tests,  name: Tests,        kind: automated, command: "npm test" }
  - { id: spec,   name: Spec,         kind: agent, since: 2026-09-18T19:00:00Z }
  - { id: review, name: Lead review,  kind: agent }
  - { id: patron, name: Patron call,  kind: human }
review_probatio: review           # probatio id that gates "review" state (default "review")
wip_limit: 3                      # items in building + verifying, studio-wide
defaults:                         # optional overrides of the dossier's Defaults table
  handoff_stale_days: 3
  model_probe_stale_days: 7       # optional; code default 7 — tick's probe-cadence age trigger (W-071)
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

## Seats and instances

A **seat** is a template: one row per build tier, declared in `sellae`
(`builder`, `builder-codex`). It names a collegium, a kind and a model/
harness — never a concurrency slot. An **instance** is `<seat>.<opus-id>`,
minted at dispatch — every dispatch boundary calls the one minter
(`seatInstance`), never string concatenation — and it carries no state of
its own beyond the seat it names and the opus it's working. The opus id is
the identity: D-021's one-writer discipline is
already keyed on the opus branch (`opus/<id>`), so the instance name and the
ownership rule agree by construction. A **retired** seat (`retired: true`)
stays declared forever so every record naming it — `traditio.sella`,
`opus.sella`, a `ci/*.log`, a receipt directory — stays readable; it is
refused as a live dispatch target (`run`, `handoff`, `emit --usage`,
`talk`, `delegate`, `context`) with a pointer at its live replacement, if
one exists.

`tiers`/`munera` (D-023 §2, W-065) are both optional and independent of each
other's presence: a manifest declaring neither parses, checks and serves
exactly as before. `munera[].tier` must name a declared `tiers[].id`
(`munus.tier`); both keys' ids go through the same `manifest.id.format`
validation every other id does, and a duplicate id in either list blocks
(`manifest.unique`). `bisellium delegate` is the only writer of either key's
values; the Web console renders both — recorded and attributed, per D-023 —
but nothing in this repo dispatches on them yet.

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

## Native opus model

The native officina accepts exactly these case-sensitive opus kinds: `opus`,
`task`, `subtask`, `bug`, `research`, `feature`, `hygiene`, `art-batch`, `ui`,
and `arc`. This is native file policy; the cross-adapter `Opus.kind` wire
field remains an open string. `bisellium check` reports `opus.kind` for every
native record that is missing, ill-typed or outside this vocabulary, and both
creation entry points reject it before allocating a record or brief.

`title` is the sole summary. It is a nonblank decoded YAML string on one
logical line: C0/C1 controls, line/paragraph separators and the format/bidi
controls enumerated by the implementation contract are forbidden. Everything
after the front-matter delimiter is the description, may be empty, and is
preserved byte-for-byte by metadata writers. There are no duplicate
`summary:` or `description:` fields.

An `arc` is an ordinary `kind: arc` opus. A non-arc record may carry
`arc: W-n`; the target must exist locally and have kind `arc`. An arc cannot
itself carry `arc` or `parent`. `kind: subtask` requires `parent: W-n`, whose
target must be neither an arc nor a subtask; no other kind may carry
`parent`. A subtask inherits its parent's arc in the model. If it writes an
explicit arc, it must equal the parent's; it cannot introduce one when the
parent has none. These references add no dependency or roll-up semantics.

`start` and `end` are optional actual transition timestamps in the exact
profile `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DDTHH:MM:SS.sssZ`, years
0001–9999 and real Gregorian dates only. Writers emit milliseconds. `ready`
sets `start` once, `done` sets `end`, and a failed review reopening a done
opus clears `end` while retaining `start`; refused commands write neither
dates nor events. `end` is legal only in `done` and cannot precede `start`.
Legacy absence is valid and is never reconstructed from mtime or event logs.

Creation accepts hierarchy fields directly:

```bash
npm run bisellium -- new --kind <kind> --collegium <id> --title <title> [--arc <W-id>] [--parent <W-id>] [--spec <path>] [--brief] [studio]
```

Every W-096 reference read—opus, arc/parent, brief, UI log and decision—is a
contained regular-file read beneath its expected officina directory. A
symlink leaf or intervening symlink directory, escape, dangling path or
non-regular target fails closed as `opus.reference` plus the relevant
field-specific rule.

While W-096 is active, `opus.red_assertion` also requires each of its seven
selected red logs to contain a completed Node TAP plan and at least one
`ERR_ASSERTION` failure whose test name begins `W-096 behaviour N:` for that
log's behavior. A module-load/syntax/tool/sandbox failure, skipped or zero-test
plan, plain `FAIL` text, aggregate wrong selector, or arbitrary nonzero exit is
not assertion-level evidence.

### UI policy

A UI opus requires a live `ui-lead` seat in the design collegium and current,
substantive spec input from that seat before `ready`; active and done records
are checked for the same evidence. The input's `design_digest` binds the exact
decoded title and the raw bytes of the current brief, so either kind of edit
makes it stale. The substantive check uses NFKC followed by Unicode 17 full
default C/F case folding, four-word distinct shingles, at most 30% overlap
with the retained dispatch prompt, and at least 12 novel shingles. These are
mechanical minima, not a judgment of the recommendation.

UI's effective probationes always include reserved automated gate
`served-e2e`, command `node scripts/served-e2e.mjs`, even when the manifest
does not declare it. A same-id declaration must have exactly that automated
shape. `verify` builds the web application and then runs its served-browser
suite, recording a timestamp, log and SOURCE certificate. A passed review and
done both require a corroborating successful result bound to the current clean
SOURCE tree. Non-UI opera retain the manifest's ordinary gate list.

The censor remains the sole review signer. A passed UI review cites the
authoritative UI input and current design digest in its verdict header and
contains a nonblank `## UI input disposition`. Completion also requires at
least one distinct `ui_rulings` decision reference whose structured Patron
front matter binds this opus, the current design digest and served SOURCE
tree, at or after both inputs. Supplied stale rulings advise before done and
block at done; prose or a generic human-gate waiver is not a ruling.

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
is no "before the gate existed" case for a currently-active item. The same
rule (W-062) also blocks an ACTIVE opus whose `spec:` and its passed gate's
`evidence` resolve to different documents — `resolve()`-compared, never a
filesystem check, since this is a blocking rule that runs on every `check`
and a false positive here would stop every cascade. This closes the
laundering path a bare `spec:` re-point would otherwise open: without it,
re-pointing a `building` opus at a shorter brief could erase an
`opus.red_evidence` finding while the old passed gate — certifying a
document the opus is no longer built against — survived untouched.

## bisellium amend

```bash
npm run bisellium -- amend <opus> [--title <text>] [--spec <path>] [--arc <id>] [--parent <id>] [--ui-ruling <decision-id>] --reason <text> [--sella <id>] [--studio <dir>] [--now <iso>]
```

`amend` is the one CLI path for an opus's descriptive/reference fields:
`title`, `spec`, `arc`, `parent`, and an appended `ui_rulings` reference.
These are fields no other verb owns once set (`new --spec`/`--brief` and
`ready` write `spec:`'s *first* value only; nothing ever writes `title`
again). It carries no state gate — it works in any state, `done` and
`halted` included, since retitling or re-pointing a record is never a
lifecycle transition. `--reason` is mandatory and non-empty. Each changed
field appends one entry to the record's own `amendments:` list — append-only,
the same `{at, sella, field, reason, superseded}` shape W-040's gate
corrections use — in stable field order when several are given in one call,
regardless of flag order. `--ui-ruling` validates and appends one decision id;
it never creates a decision or evidence. A duplicate or a value identical to
the current one is
refused as a no-op: `title` compared as an exact scalar (leading/trailing
whitespace is a real change), `spec` by canonical resolved target (a path
alias like `./briefs/x.md` names the same document, not a change). `--spec`
must be officina-relative, must resolve inside the officina (D-008), must
name a path that exists, and must reach its target without crossing a
symlink at any component (`realpath` must equal the resolved path); it also
cannot be set for the first time this way — a record with no `spec:` key
at all is a job for `new --spec`/`--brief` or `ready`, never `amend`.
`--state`, `--probationes`, `--traditio` and `--id` are refused by name,
before argv is even parsed, each naming the verb that actually owns the
field (`greenlight`/`ready`/`done`/`halt`/`review --fail`, `verify`/`review`/
`waive`, `handoff`, and "that's a rename" respectively) — the refusal is the
feature (D-016), not an incidental error.

Re-pointing an ACTIVE opus's `spec:` away from its passed gate's evidence
trips `state.building.spec` (above) until the gate is re-signed: `halt` then
`ready --spec <new>` today, or W-040's `ready --correct` once it lands.
After amending a pointer away from its default, always pass `--spec`
explicitly to a later `ready` — its own default (`briefs/<id>.md`) would
otherwise silently revert the amendment. `amend` emits one
`workflow.item_amended` event per amended field and never a
`workflow.state_changed` (nothing changed state); it does not append to the
Patron timeline — an architect retitling an opus is not a Patron act, and
the record's own `amendments:` list, which travels with the opus and
survives `git clone`, is the permanent home.

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
The description below the front matter.
```

Required keys: `id` (must equal the filename), `title`, `kind`, `collegium`,
`state` — all non-empty strings, with native `kind` and `title` narrowed as
described above. Optional native fields are `arc`, `parent`, `start`, `end`,
and `ui_rulings`; their kind-, hierarchy-, time- and UI-specific constraints
are enforced by `check` and by affected writers. `traditio` (`sella`, `stage`, `next`,
`blocked_on`, `at` as an ISO date) is required on every active item
(`building`, `verifying`, `review`) and validated wherever present; it is stale
past `handoff_stale_days`. `halted` items require `reason` and `resume_when`,
and `halted_at` so their age can be tracked. A `pending` gate of kind `human`
is what "needs you" means. Passed and failed gates need `evidence` that exists
(a dead link is blocking) and should carry `certifies` — the tree hash they
certify, quoted; a newer substantive change makes them `stale`, never silently
green. `amendments` (optional; written only by `bisellium amend`) is an
append-only list of `{at, sella, field, reason, superseded}` entries, one per
changed amendable field (`title`, `spec`, `arc`, `parent`, or `ui_rulings`) — nothing else touches it, and
nothing removes an entry once appended.

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
subject: "Split stacks: accept the scope drift, or cut to a new item?"  # required for new petitiones; advisory until W-038's writer stamps it — see below
---
The question, however many paragraphs it takes. Every paragraph travels to
the Patron's inbox verbatim — no truncation. A subject is a row label, not a
summary; anything it drops, the detail pane still has.
```

`subject:` is required for new petitiones (the CLI writer stamps it once
W-038 lands) and is checked, when present, as a non-blank string
(`petitio.subject`, blocking on a present-but-invalid value — blank,
whitespace-only, or a non-string — advisory when the key is absent
entirely). Absent, the inbox falls back to a legacy derivation from the
body's first paragraph (unwrapped, markdown stripped, capped at 120
characters including any ellipsis) — a wrap-artifact-free label good enough
for the petitiones written before this key existed, but not a substitute for
writing one: a derived subject can still say less than the body means.

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

## Sleeps in tests

`check --repo <dir>` runs `test.sleep` (block): a wall-clock wait in a tracked
test file needs a named seam or an annotated waiver. Scanned: tracked
`.ts .tsx .mts .cts .js .mjs .cjs` files that are test files by name
(`*.test.*`, `*.spec.*`), sit under a `test`, `tests`, `tests-serve`,
`__tests__` or `e2e` directory, or are named by a root `package.json` `test*`
script. Flagged, in code (comments are skipped, string and template contents
are not): `setTimeout` and `setInterval` however spelled (a member call is
flagged unless its receiver is `test`, `sock`, `socket`, `req`, `res` or
`server`), any `sleep(`, `waitForTimeout`, `Atomics.wait`/`waitAsync`, an
import of `timers/promises`, and computed forms. An unreadable tree (no
`git ls-files`, an unparseable `package.json`, a symlinked or over-1-MiB test
file) is itself a block finding, because a rule that cannot observe would pass
every sleep.

A site is covered by a `//` comment on its own line or on the comment-only line
directly above it (a `//` line inside a multi-line template-literal fixture
counts; a block comment or `//` text inside a string never does):

```text
// sleep-seam: <name> -- <what the wait exits on>
// sleep-waiver: <kind> -- <why no seam can exist here>
```

- `sleep-seam`: the wait polls a named observable (a barrier, marker, event or
  predicate) and the sleep is only the cadence. `<name>` is at least three
  characters, not a primitive's own name, and must occur as a whole word in the
  code within 40 lines of the site.
- `sleep-waiver`: `<kind>` is exactly one of `guard` (a deadline that fails the
  test or kills a fixture), `subject` (the elapsed time is the property under
  test), `fixture` (a keep-alive or injected-latency fixture) or
  `no-observable` (an ordering or absence window with no observable; the reason
  names what is missing). **`settle` is not a kind**: "let it settle" is the
  class the rule exists to stop.
- The reason after ` -- ` has at least 15 non-whitespace characters in at least
  three words. The rule checks that a declaration is present and well formed;
  whether it is honest is the reviewer's judgement.

`packages/cli/src/rules/tests.test.ts` pins waiver caps over the rule's own
parsed output; raising a cap needs an architect ruling.

## The SOURCE tree hash

W-096 has an additional, opus-scoped preservation boundary. Its producer-run
`bisellium branch W-096 --studio studio --repo .` must begin on a clean
`master` exactly equal to `origin/master`, create and check out
`opus/W-096` at that resolved commit, then write that full commit id once as
`baseline_commit` on the owning branch. The trunk copy is never changed by
the writer, and the pin is never inferred or repinned later.

For ordinary `check`, the owning branch is Git's current symbolic branch and
must equal the canonical owner ref `opus/W-096`; other branches do not replay
this boundary after merge. When that owning branch is active, omitted or
unresolvable repository identity fails closed rather than disabling the rule.
Verification explicitly targeting W-096 applies the boundary independently of
the current branch. In either applicable context,
`opus.records_unchanged` enumerates the direct `studio/opera/*.md` and
`examples/sample-studio/opera/*.md` blobs at that immutable baseline, except
W-096 itself. It compares raw bytes and regular-file mode at both HEAD and the
working tree. Deletion, rename, a symlink leaf or intervening symlink directory,
mode/byte changes, shallow/incomplete history, untrusted ancestry or unavailable
Git identity fail closed. New records are
outside the pinned set; they cannot replace or exempt an old one. `check` and
`verify` call the same comparison helper.

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
npm run bisellium -- run --sella <sella> --studio <dir> [--repo <dir>] [--no-worktree] [--base <ref>] [--keep] -- <cmd…>
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
other gate survive untouched. `handoff`, `greenlight`, `waive` and `amend`
(above) are the other tool-written changes to an opus, and go through the
exact same merge-not-replace seam (`editOpusFrontMatter`,
packages/cli/src/frontmatter.ts): each touches only the keys its own
contract names — `traditio`'s five keys for `handoff`, `state`/`declined` for
`greenlight`, `status`/`reason`/`waived_by`/`sella`/`at` on one human gate
for `waive`, and `title`/`spec` plus an appended `amendments` entry for
`amend` — never anything else.
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

## Running next

```bash
npm run bisellium -- next <opus> [--perform] [--expect <step>] [--budget <tokens>] [--title <text> --body-file <path>] [--poll-ms <n>] [--max-polls <n>] [--studio <dir>] [--repo <dir>] [--now <iso>]
npm run bisellium -- next <opus> --track <step> --pid <n> --output <path> [--studio <dir>] [--repo <dir>] [--now <iso>]
```

`next` is the cascade order as a verb (`packages/cli/src/next.ts`). From the
record and its evidence alone it derives the one legal next step of the
twelve-rung ladder `STEPS` (`greenlight`, `spec`, `branch`, `ready`, `reds`,
`build`, `review`, `pr`, `merge`, `cleanup`, `done`, `checkpoint`), names it,
and refuses to skip. A rung is met by evidence, never by memory: the committed
trunk (`refs/heads/master`, read with `git show`, never a working tree) carries
the signed spec, and, once it carries the opus's `done` record, settles every
rung up to `done`. The opus branch's own evidence (record, `ci/`, reds, run
receipt) is read from its worktree `<repo>/.worktrees/<id>`. A MERGED PR settles
the rungs up to `merge` only by reachability (its merge commit is in the local
trunk by `trunkContainsMerge`, `@bisellium/commands/trunk.js`, and a
still-present local branch tip is the PR's head or an ancestor of it); a merged
opus whose trunk is behind is `merge`, never `branch`. `done` is therefore
reported and performed only from a fresh MERGED read AND a trunk that contains
the merge ("complete means merged and fetched").

Run it from the repository's **main checkout** (`--repo` names it; a linked
worktree exits 2). Without `--perform` it only reports and writes nothing, and
the only network use is `gh` read calls for the PR rungs. "Dirty" means tracked
changes only (staged or unstaged); an untracked file never makes a tree dirty.

Output: the first stdout line is `next: <opus> <step> <named|performed|held|running|dead|complete>`,
then `key: value` lines (`actor:`, `why:`, `command:`, `head:`, `health:`;
`attributed:` for `ready`, which `next` runs with the sella of the passed spec
log; `state=<X>` lines for performed PR steps, using the scripts' vocabulary
`CONFLICT`, `CHECKS_FAILED`, `GHAS_STOP`, `MERGE_FAILED`, `QUEUE_REJECTED`,
`QUEUE_TIMEOUT`, `HEAD_MOVED`, `MERGED`, plus `WAITING` when the checks never
turned green and `MERGED_NOT_FETCHED` when the merge landed but the trunk could
not be fetched or does not yet contain it; after a performed step `next-step:`
names the re-derived rung and `next-why:` says why when it is held). Every
printed line is stripped of control characters (C0 and C1, newline included) and
each element clipped, so a check name or a `gh` reply cannot start a `state=`
line. A MERGED PR whose head this clone cannot resolve stays at `merge`; its
perform fetches `refs/remotes/origin/opus/<id>` and holds, naming the oid, if
the head is still unknown. A BEHIND PR is updated only while its head is the
reviewed one, and a head that appears afterwards is adopted only if it descends
from it (else `HEAD_MOVED`). Exit 0: a step named or performed, a
live step reported running, or the ladder complete. Exit 1: refused, held, dead,
or a performed step failed. Exit 2: usage, unknown opus, not a studio, not the
main checkout. **`running` is a header word at exit 0, not an exit code: an
orchestrator must read the word.**

`--expect <step>` exits 1 with `refusing: next step for <opus> is <A>, not <B>`
whenever `<B>` is not the derived step. `--perform` executes only the derived
rung (`branch`, `ready`, `pr`, `merge`, `cleanup`, `done`) and then re-derives;
it never runs a second rung in one call and stops at the first named-only rung
(every named rung is legal to stop at; a held or running rung cannot be
performed). Every `--perform` write stays in the current checkout (or the
worktree). Commits are authored with the sella's identity when known from the
session; otherwise, the current git user.name/user.email are left untouched,
and the author falls back to defaults or to the explicit `-c user.*` flags in
the session's environment. A pre-existing `opus/<id>` branch is not an error; a
branch on the wrong commit or containing uncommitted changes triggers a verb
refusal. `--base <ref>` is passed to the inner `bisellium branch`, so it is an
error to provide it when the branch already exists and is not on `<ref>`.
`--budget <tokens>` warns at the 85% mark (closeout) before doing the dispatch
and exits 2 when the studio's total posture is `limited` (≥100% budgets broken).
When given, it also records the budget constraint in the run receipt for
orchestrator replay.

`--title` and `--body-file` are PR-rung specific: they set a PR's title and body
(read fresh, not cached). Body text is never truncated or modified.

`--poll-ms <n>` and `--max-polls <n>` govern the wait for `pr` to be ready
(the GitHub PR API requires a brief wait for CI checks to appear; the defaults
are fine for this repo's latencies). `--track <step> --pid <n> --output <path>`
starts a long-running watch (usually in a subshell) that fires whenever the
step's status materializes or changes, and appends JSON { timestamp, status,
statusKeys, head, …} lines to the output file; `--pid` names the caller's PID
for a SIGTERM-on-exit safeguard. Only one tracker per step can run; a second
call blocks until the first ends. This supports a workflow UI that wants to
stream `next`'s results to a client without holding an HTTP connection open.

## Tracing command execution

The CLI logs structured `{eventType, timestamp, args, [result]}` lines (JSON)
to stderr when `BISELLIUM_EVENTS=1` is set. `cascade.js` sets it by default.
Events capture every file read, write, git command and external command
invocation; they're useful for reasoning about performance or reproducing a
run-time oddity. Logs do not include the content of read/written files or
command standard output — only metadata, exit codes and timing.

## Running amend, ready, done and halt

```bash
npm run bisellium -- amend <opus> [--title <text>] [--spec <path>] [--arc <id>] [--parent <id>] [--ui-ruling <decision-id>] --reason <text> [--sella <id>] [--studio <dir>] [--now <iso>]
npm run bisellium -- ready <opus> [--sella <id>] [--spec <path>] [--studio <dir>] [--now <iso>]
npm run bisellium -- done <opus> [--sella <id>] [--studio <dir>] [--now <iso>]
npm run bisellium -- halt <opus> --reason <text> --resume_when <text> [--sella <id>] [--studio <dir>] [--now <iso>]
```

`ready` transitions an opus from backlog/halted to building. It requires a
spec gate passed on the current tree when the manifest declares a probatio
with id `spec`. `spec:` on the opus must resolve to an existing brief; ready
does not create or modify a brief. `done` transitions a building/verifying/
review opus into `done` and sets an `end` timestamp. Every automated and agent
gate must be passed (or skipped by `since`), and every human gate must be
passed or honourably waived. `halt` transitions an active opus to `halted`
with required `reason` and `resume_when` fields; `halted` blocks the WIP cap.
The four commands validate their input and write their own field(s) back into
the opus front matter as a commit. See "## opera/<id>.md" for front-matter
structure, and the leges (e.g. `leges/engineering.md`) for state-transition
authority. `--sella` defaults to an environment-derived ID (`BISELLIUM_SELLA`,
then git user.name); `--studio` defaults to the one containing a nested
`.bisellium` directory; `--now` pins the timestamp (ISO 8601, default current
time).

## Running waive

```bash
npm run bisellium -- waive <opus> --gate <gate-id> --reason <text> --waived-by <decision-id> [--sella <id>] [--studio <dir>] [--now <iso>]
```

`waive` marks a `kind: human` gate as waived by a Patron decision. `reason`
is required, non-empty prose; `waived-by` must name a decision that exists,
parses and whose `by` equals the manifest's `patron` id (default "patron").
The command merges these five keys into the gate node and commits: `status:
waived`, `reason`, `waived_by`, `sella`, `at`. Any sibling keys on the gate
survive; nothing else on the opus is touched.

## Running audit and close

```bash
npm run bisellium -- audit <opus> [--sella <id>] [--studio <dir>] [--now <iso>]
npm run bisellium -- close <opus> [--reason <text>] [--sella <id>] [--studio <dir>] [--now <iso>]
```

`audit` reads the gates and state of an opus and outputs a text report of what
blocks it, what waits on what, and what would be needed to move it forward
(D-028: the audit chain is immutable; a later `close` or `done` accepts or
refuses each gate/state as-is). `close` asks the same gates: every automated
and agent gate must be passed (or exempted by `since`), and every human gate
must be passed or honourably waived — same contract as `done`. If all pass,
`close` transitions the opus to `done`, sets `end`, and commits. If any gate
or state refuses, `close` exits 1 naming the first refusal and writing nothing
(`audit` can see what it was). `reason` is recorded in the actum when the
close succeeds; absent, a default is used. Because `close` is the produced
gate, a producer or magister never runs it directly: a brief says "done when
all gates pass", and `audit` surfaces obstacles. The producer reads the
`audit` output, verifies prerequisites are met, and the building opus does the
close itself (`bisellium done`) — only the closed opus commits and pushes
(`git push origin <branch>`).

## Running green

```bash
npm run bisellium -- green <opus> [--audit] [--sella <id>] [--studio <dir>] [--repo <dir>] [--now <iso>]
```

`green` prints the state at which an opus would pass its gates if the given
opus's `--repo` gate evidence were considered current, for diagnosis purposes
(useful when a gate's evidence file was deleted externally and the opus's own
record is ambiguous). With `--audit`, gates are also audited (see `audit`
above) to understand blocking conditions. No gates are changed; the output is
a report only. It exits 0 unless a usage error occurs.

## Running review

```bash
npm run bisellium -- review --opus <opus> --round <n> --outcome <pass|fail> [--phase spec|build] [--sella <id>] [--model <id>] [--evidence <path>] [--studio <dir>] [--now <iso>]
```

`review` marks a gate as passed or failed, records the gate's round number,
authoring sella, optional model, and timestamp in the opus front matter. Like
`verdict`, it merges into the gate node and leaves siblings untouched. On a
`fail`, it reopens the opus (`state: building`), clears `end` if one is set,
and sets a `failed_round` marker that prevents `done` from succeeding until
the gate is re-run and re-passed in a higher round number. On a `pass`, a
passed gate is left alone (re-passing the same round number is silently
accepted); a failed gate is unmarked and the `status` is updated to passed.
If `--evidence <path>` is given, it is recorded as the gate's `evidence`; if
omitted, the gate's existing evidence is left untouched.

## Running talk

```bash
npm run bisellium -- talk [--sella <id>] [--studio <dir>]
```

`talk` opens an REPL conversation loop (read-eval-print) that dispatches
`query` messages to a per-sella agent model, stores the session state locally
(gitignored), and echoes the agent's reply to stdout. The sella's model,
harness and collegium are read from the manifest. See `bisellium context`
(above) for how to boot a session with a sella's full context and examples
of `query` shapes.

## Running emit and providers

```bash
npm run bisellium -- emit [--usage <json>] [--studio <dir>] [--now <iso>]
npm run bisellium -- providers [dir] [--source auto|usage|quota-axi]
```

`emit` records a timestamped workflow event (one line, newline-terminated)
in the studio's `events.jsonl` file (not committed). `--usage` reads a JSON
object from stdin and records its summary for telemetry; see `bisellium
retro` for the schema. `providers` queries the current provider status from
`usage.yml` and/or the quota-axi live API (when available), reporting one
JSON row per provider with id, usage percentage, reset timestamp and status
(`ok` | `conserve` | `closeout` | `limited`). Default source is `auto` (both
quota-axi and usage.yml, quota-axi wins). `usage` and `quota-axi` read one
source each. The resulting status is not a decision, only a reading from
which the orchestrator can reason about dispatch.

## Running tick

```bash
npm run bisellium -- tick [--studio <dir>] [--repo <dir>]
```

`tick` runs cadence work for the studio: evaluates every `L1+` collegium's
own magisters' daily cadence entitlements and invokes their `lex` rules in
order, with a memo of today's earliest cadence call. Cadence (D-024) is
scheduled work by a magister — answering petitiones, closing daily digests,
reviewing queued items — that must happen once per calendar day and is
separately scoped from operatic work. Rules are drawn from the magister's
lex (see "LEX_TEMPLATE.md"); each rules receives an invocation context with
the current officina state, today's date, and the magister's collegium
settings. A rule must return a truthy result (string description or object
field) to mark the day as done and bar further rules for that magister;
falsiness (empty string, false, empty array/object, etc.) is treated as
"not yet done; continue to the next rule". Rules are author-responsible for
error-handling; a thrown exception stops execution and is reported with a
brief diagnosis.

Optionally pass `--repo <dir>` to check locking down the studio's own
records to a clean sourced state before invoking a rule (that is, the
working-tree and index must be clean relative to the tree the rule is
about to read, as in `verify` above). This is not enforced by default — a
rule may deliberately read a dirty state — but setting it will refuse any
dirty working tree and help catch accidental edits or partial commits.

`tick` exits 0 if every collegium's cadence completed or was skipped
(not due yet), 1 if a rule returned an error, or 2 if a magister's lex
could not be read or parsed. The output is a JSON snapshot of today's
`health.json` file — cadence dues, tick results, model probe results,
etc. — and each digest entry the run produced is timestamped and appended
to that magister's `acta/<date>-<role>-daily.md`.

## Running pause and resume

```bash
npm run bisellium -- pause [--studio <dir>]
npm run bisellium -- resume [--studio <dir>]
```

`pause` writes a gitignored marker file (`PAUSED`) in the studio directory.
`tick` checks for it and refuses to run any cadence when present. `resume`
removes it. The pause is manual — the only way to set or clear it is through
these two verbs. It is useful as a blocker when orchestration is interrupted
(a session crashed mid-cascade, a provider became unavailable, etc.) and the
studio needs a human judgment before automation resumes.

## Running retro

```bash
npm run bisellium -- retro --cascade <N> [--from <json>] [--studio <dir>] [--now <iso>]
```

Drafts a retrospective acta for a cascade: findings, lessons, addressed
patterns, recurring classes that became petitiones or rules, and pruning
candidates for decisions. Every lesson's evidence must exist and be
reachable. Validates and exits 2 if any evidence path is a dead href, a
symlink, a non-regular file or outside the officina. Exits 1 if findings
validation fails (e.g., a review's findings list is empty or malformed).
Exits 0 and drafts an acta file in `studio/acta/<date>-retro-<cascade>.md`
when validations pass. The draft is not committed — the producer reviews it
and commits/amends it manually. May be run multiple times for one cascade;
an existing retro is never overwritten.

## The pattern language and `decision.kill_when`

A decision's `kill_when` is a plain-English description of an observable
that would let it go stale. The retrospectio reads it when fitting (every
retro names decisions whose kill conditions are satisfied, as candidates
for pruning), but nothing *enforces* a kill — an expired decision stays
decided until someone explicitly supersedes or deletes it (that is, by
hand, or by a curator verb that does not exist yet). The language is prose,
not a DSL: it names what the evidence would look like (`two consecutive
cascades with no red in the tests gate`) or when the decision's intent is
clearly obsolete (`W-X is shipped`). Lessons record `evidence` paths that
must exist; decisions record `kill_when` text that is matched against retro
findings and cited when the decision looks ready. Both support the
retrospectio's reading and neither is executable.

## Running branch, merge and prune

```bash
npm run bisellium -- branch <opus> [--base <ref>] [--studio <dir>] [--repo <dir>] [--now <iso>]
npm run bisellium -- merge <opus-id> [--force-with-lease] [--studio <dir>] [--repo <dir>] [--now <iso>]
npm run bisellium -- prune [--aggressively] [--studio <dir>] [--repo <dir>]
```

`branch` creates a git branch `opus/<id>` and checks it out in a new worktree,
pinning a `baseline_commit` for W-096's museum (an immutable record of
records' byte-for-byte form at that commit). The worktree lives under
`<repo>/.bisellium/worktrees/`, is registered with `git worktree list`, and
is ready for work (`git checkout opus/<id>` in the main checkout to switch to
it; `git worktree remove` to remove it, both after `git branch -D opus/<id>`
locally and/or `git push origin :opus/<id>` to remote). The branch is tied to
one opus; deleting the branch does not remove the worktree. `bisellium branch
<X> --base Y` overrides the branch point (default `HEAD`).

`merge` lands an opus branch onto the current trunk, fast-forward if possible.
Requires the opus to be `done` on its branch (read from the branch's own
record), every gate passed and — under the manifest's `integration:` strategy
— observing that strategy (default: fast-forward, no push). A passed
automated gate's tree certificate is re-verified against the merged result
(post-rebase, if rebasing) and refused if stale. Every file read during
`merge` that involves the opus record, tree hashing, or certificate matching
comes from the opus branch's own committed state, not a working-tree read.
`--force-with-lease` passes `--force-with-lease` to the underlying git push
(only relevant when `integration: { push: true }`). Exit 1 if the opus is not
done or a gate failed; exit 2 if not a studio or repo, or the opus is not
found; exit 0 otherwise.

`prune` removes merged `opus/*` branches for `done` opera locally, and
reclaims stale `.bisellium/worktrees/` directories (unmerged, abandoned, or
whose branch is fully merged). Useful to keep the repo tidy; `--aggressively`
includes more heuristics for stale detection (useful after a filter-branch or
history rewrite). A branch not yet merged is left alone.

## Design constraints (read once)

These are structural constraints on work planning, not requests to implement
specific features. They are here because they bind orchestration and testing
and are visible to every reader of the studio's records. Violations are not
bugs — they are renegotiations. "This constraint is wrong for our project"
is a judgment for the Patron, not a memo to leave for future cascade runs.

1. **Operatic work is bounded.** WIP count is studio-wide, fixed in the
   manifest (`wip_limit`), enforced by the checks. A magister who hits the
   cap must prioritize, not wait for space. Estimating a long cascade at 12
   rungs (today: greenlight, spec, branch, ready, reds, build, review, pr,
   merge, cleanup, done, checkpoint) ≈ 72 hours of calendar time at 6h/rung.

2. **State is minted once.** An opus's `state`, `start` and `end` are
   written by exactly one verb in exactly one mode. `ready` → `start`,
   `done` → `end`, `review --fail` → reopen/clear `end`. No other writer,
   no inference from gates, no reset or re-inference after the fact. The
   one-writer rule is enforced by the CLI signature only — no locking,
   only by calling convention.

3. **Evidence is produced, not backfilled.** A gate's `evidence` path and
   `certifies` hash are written by the command that produced the evidence,
   never by a later command reading what that command left. An `audit` or
   `done` gate-check that finds evidence missing is not a permission to fill
   it in later. Missing evidence is a gate refusal. Evidence integrity (e.g.,
   timestamp, tree hash) is the authoring command's responsibility.

4. **Decisions are prophecies.** A `decision.kill_when` is a prediction about
   the future that the studio can verify. It is not a memory ("we decided
   this because...") — rationale goes in the decision's body. It is not a
   rule ("do this to stay compliant") — rules are rules. A decision with no
   falsifiability constraint is a belief, not a decision, and is refused.

5. **Scope is explicit.** Every opus has a spec that names files owned, API
   behaviour under test, and acceptance criteria. A spec lives in the
   officina and is passed as a gate before building. A gate that is missed
   or corrupted is visible in the audit trail (record, evidence, round
   number, gate history). No building without a spec.

6. **Provenance is minted at the boundary.** Every opus record change,
   gate, digest and decision is authored (`sella`, `at` timestamp,
   optional `model`). The git commit is one of many records inside one
   officina instance; provenance names the record's writer and when. Every
   git commit is authored (`git config user.name`, `git config user.email`)
   and may carry a `Co-Authored-By:` trailer naming the team member (sella)
   or model (agent) that did the work.

7. **Rules are checked, not read.** Process is enforced by a validation rule
   (`check` rule, test assertion, gate) or a verb's own refusal contract,
   never by a memo, email or shared understanding. If something must
   happen, it is a rule that can fail the build or an audit check. If it is
   only a note, it is advisory prose and belongs in a decision's body or a
   lesson, not in the Patron's handoff.

## Running handoff

```bash
npm run bisellium -- handoff <opus> [--stage <name>] [--next <name>] [--blocked-on <name>] [--sella <id>] [--studio <dir>] [--now <iso>]
```

`handoff` records `traditio` (handed-off state) in the opus front matter,
one of `opus.sella`, `opus.traditio` or both. A gate-level handoff would be
recorded by `verify` or `review` — this is the opus-level one, a checkpoint.
`stage` names where the work currently lives (e.g. building, review, waiting
on architect input); `next` names what is expected next (`await spec`, `await
review`, `await Patron decision`, etc.); `blocked-on` names a collegium
whose decision is needed. Expect to see `traditio` records at every cascade
checkpoint, roughly hourly during active work. `traditio.at` is the
handoff's timestamp; `traditio.sella` is the recording sella; `traditio.stage`
and `traditio.next` are free text. They are advisory — the source of truth
is each gate and its own evidence.

## Deploying the console

The console (`apps/web`) is a React app built by Vite and served from the
studio by `bisellium serve <port>` (default 3000, `--studio studio`). The
console is not a build artifact, not a versioned release and not blessed by
any gate; it is what the studio's current code builds from the current state
and serves. It is useful as a Patron dashboard and as a demonstration to
stakeholders, but the real state lives in the officina's files, not in the
console's cache.

The studio's Patron writes directly through the console (decisions,
greenlights, budget allocation). The console reads work state from the local
officina, the serve process's SQLite index of gate evidence, and from
GitHub (milestones, issue state, PR status, Advanced Security findings) via
`gh`. It does not write to GitHub — the CLI owns the commits, the Patron
owns the work state. The console is therefore "read-mostly" (Patron writes
only), and "read-through" (it caches nothing, queries the current tree and
index on every view).

Deploying to the public internet would require: authentication (the console
currently trusts its localhost loopback), TLS, and credentials isolation
(the serve process's `gh` agent runs in the deployment namespace and must
not leak secrets or carry unvetted access). Those are future work — `bisellium
serve` is a local tool, not a production service.
