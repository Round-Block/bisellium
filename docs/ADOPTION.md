---
kind: contract
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the contract it documents is superseded by a new adoption doc
---

# Adopting Bisellium

Per-command reference: `docs/CHECK.md`, `docs/NEXT.md`, `docs/PIPELINE.md`, `docs/VERBS.md`, `docs/SERVE.md` and `docs/TALK.md`; where one disagrees with this contract, the contract wins.

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
parent process's secrets out of its own environment. Two names are added
after that filter, for one gate only: `BISELLIUM_OPUS` (the opus id) and
`BISELLIUM_STUDIO_DIR` (the absolute studio path) reach the reserved
`served-e2e` command and no other probatio, so it can name the opus whose
screenshots it writes; a parent value of either name never wins, and no
other gate's command (nor an out-of-repo adopter's studio path) is handed
them. A gate log holds the last 200 lines of the command's `stdout` and
`stderr` concatenated, stderr last, so a gate must not rely on where in that
tail its own output lands; the screenshot manifest below is a file for that
reason.

Planned, not yet built: `memoria/sellae/`, `archive/`, and the docs registry.

`ci/` evidence has four command-owned writers. `verify` records automated
gate runs, `red` records a failing command per behaviour (and warns on stderr
when it records a `dirty:` tree identity), `verdict` records a review
transcript without evaluating or changing any gate, and the reserved
`served-e2e` gate command (`scripts/served-e2e.mjs`) clears and rewrites
`ci/shots/<opus>/` on every run: the walk's screenshots and `manifest.txt`.

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

A fired kill clause is recorded on the decision by hand (W-120), with two
optional keys that are written together:

```yaml
killed_at: 2026-09-25T07:22:38.951Z   # when its kill_when was observed to have fired
killed_by: petitiones/P-013.md        # the record that saw it; officina-relative, under acta, ci, decisions, lessons, opera or petitiones
```

`decision.shape` blocks a missing/ill-typed key, an id that doesn't match
its filename, an unknown `provenance`, one of `killed_at`/`killed_by`
without the other, a `killed_at` that is not a date or is earlier than the
decision's `at`, or a `killed_by` that does not open as a regular file under
the allowed directories. `decision.invoked_after_kill` blocks an opus whose
`halted_by` (time `halted_at`) or gate `waived_by` (time `at`) names a
decision at or after its `killed_at`, or with no readable time: a fired
clause is never a retroactive excuse. Records dated before the kill are
history. `decision.kill` blocks a missing
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

Two further optional lesson keys are written by `bisellium retro --opus`
(W-137): `opus` (the opus whose verdicts the lesson came from) and `severity`
(`high`, `medium` or `low`, by rule: see "bisellium retro"). A lesson carrying
no `addressed_by` raises the advisory `lesson.unfixed` (`<id> names no fix
(addressed_by)`); every lesson `retro --opus` files names its fix.

**Open lessons (W-085).** A class is *open* until some lesson of it carries an
`addressed_by` that names a rule id, a decision on disk, or an opus whose
`state` is `done`. A value naming a not-done opus leaves it open, marked
fix-in-flight; a value naming nothing on disk leaves it open too, so a typo
cannot quiet a class. `openLessons` (`@bisellium/commands/lessons.js`) is the
one reader of that rule. It ranks classes by distinct cascades, then lesson
count, then newest `at`, and attributes each to the collegia that pay for it:
the collegium of every opus its evidence cites, plus the collegium of each gate
sella recorded on that opus (every collegium when the evidence cites no
existing opus). `bisellium context` carries them as `## Open lessons`, the
classes of the sella's collegium (the Patron sees all), at priority 2. The
`context_open_lessons` default (10) caps how many are shown; `0` turns the
section off. `bisellium next` names the boot command on every dispatch order
(`boot: bisellium context --sella <sella> --studio <studio>`), so the
orchestrator can hand the bundle to a harness that cannot run it.

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
brief_behaviour_limit: 6          # optional (W-127); turns on brief admission: most numbered behaviours a brief may carry
retro: { since: 2026-10-06T06:06:57Z, high_greenlit_by: D-039 }  # optional (W-137); see "bisellium retro"
spec_reviewer: spec-reviewer      # optional (W-162, D-046); see "The spec review gate" under "Running next"
ui_spec_signer: ui-architect      # optional only as a pair: kind: ui signer, live Codex gpt-5.6-sol
ui_spec_reviewer: ui-spec-reviewer # optional only as a pair: kind: ui reviewer, live Claude claude-opus-5-5
defaults:                         # optional overrides of the dossier's Defaults table
  handoff_stale_days: 3
  model_probe_stale_days: 7       # optional; code default 7 — tick's probe-cadence age trigger (W-071)
  context_open_lessons: 10        # optional; code default 10 — classes in context's "## Open lessons" (0 = off, W-085)
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
`pr.required: true` makes `merge` refuse before it runs any git command and
name `bisellium next <opus>`, which walks the PR road (push, PR, merge, fetch)
(W-141); `pull_after_push` lives only on the landing path `merge` takes when no
PR is required.

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

A UI opus uses the atomic UI signer/reviewer pair described below and requires a live `ui-lead` seat in the
design collegium with current, substantive input (its newest spec log, W-338) before `ready`; active and done
records are checked for the same evidence. The input's `design_digest` binds the exact decoded title and the
raw bytes of the current brief, so either kind of edit
makes it stale. The substantive check uses NFKC followed by Unicode 17 full
default C/F case folding, four-word distinct shingles, at most 30% overlap
with the retained dispatch prompt, and at least 12 novel shingles. These are
mechanical minima, not a judgment of the recommendation.

UI's effective probationes always include reserved automated gate
`served-e2e`, command `node scripts/served-e2e.mjs`, even when the manifest
does not declare it. A same-id declaration must have exactly that automated
shape. `verify` runs the served-browser suite (whose Playwright `globalSetup`
builds the web application first), recording a timestamp, log and SOURCE
certificate. The same run leaves one screenshot per console screen in
`ci/shots/<opus>/` and a `manifest.txt` beside them (`shots: <n>
ci/shots/<opus>`, then one `shot: <name>.png <width>x<height> <bytes>` line
per file). `check` re-reads the manifest and every PNG it names through the
containment helper and refuses a `review` or `done` UI opus when the manifest
is missing, malformed or disagrees with the files on disk (a PNG that is
absent, not a PNG, of a different size, or under 800x600; more than 64
entries; a PNG over 4 MiB; a manifest over 8 KiB), under `opus.ui.e2e`. An
opus id longer than 22 characters cannot carry screenshots (the manifest echo
would be masked by `redact`). A passed review and
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

The two middle states are written by verbs, never by hand (W-129, D-034):
`bisellium verify` moves an opus on its own branch to `verifying` before the
pipeline runs, then to `building` (an automated gate failed) or `review` (this
run's evidence is all green and `check` would accept `review`); `review --fail`
returns `verifying`, `review` or `done` to `building`. A `review` whose failed
review gate is of an older tree than the automated gates now certify is the
honest "awaiting a new round", not a defect (`state.review.failed` blocks only
a failure it cannot prove stale), and a handoff `stage` that trails the state
(`building` against `review`) is not advised.

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
to also scaffold it, with the standard diff promise under `## Acceptance`, W-303); `done` and `halted` are never gated retroactively, and
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

## The build-review loop (W-167, W-246, D-053)

Build review has no cap: `bisellium next` names a fix and the next round for as long as the censor fails; the old
round-ruling records are not read (D-061 §4). A round is a strictly parsed `ci/<id>-review-<n>.log` whose outcome
agrees with its standing findings (converted blockers are advisory). Before review, a UI packet admits exactly eight bounded served screenshots: Inbox, Board, Seats and Officina at 1280×900, then the same order at 390×900. The packet's
`ui.txt` names that fixed attachment order and what the censor judges in each; other kinds receive an explicit
not-applicable line. A missing, unreadable, symlinked, over-limit, misnamed or dimensionally wrong shot refuses packet
construction. `next --perform --expect review` passes those paths to Codex as ordered `-i` arguments, passes the
authoritative UI input to `verdict`, and requires the censor's nonblank UI-input disposition. When a failed current
round has a standing class blocker, the fix order carries a `boundary:`
line: fix the class at the Input-domain boundary, not only the cited site (L-069). `next` also holds on an unreadable
or out-of-domain review record, review-key manifest drift, or an uncomputable source tree. The tool cannot judge
whether a finding truly is a class; that word is the censor's claim (D-045).

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

## Test row counts

`check --repo <dir>` runs `test.rows` (block, W-178, beside `test.sleep`): each
file that is a test file at the base keeps at least its base row count in the
working tree, or the change adds one record to `test/row-drops.yml` naming the
path and the exact number dropped. It is how a speed-up or a refactor of a
test file cannot remove rows unnoticed (production lex §11). A reason makes a
drop visible; review still refuses a speed-only deletion.

**The base** is the single merge-base of `HEAD` with `refs/heads/master`, or with
`refs/remotes/origin/master` when there is no local master. A stale local master
gives an older base (rows added since are simply new). On master itself the base
is `HEAD` and nothing is compared. The merge group, whose `HEAD` holds current
master, compares against master as merged; `gates` and `officina` check out with
`fetch-depth: 0`, so `origin/master` exists. The host mint's single-branch
candidate clone fetches `refs/remotes/origin/master` from the host repository
(`scripts/run-builder-host.mjs`), so its `ci` gate has a base too. Test files are
classified at the base with the base's `package.json` (the same classification as
`test.sleep`, above), and in the working tree with the working tree's. A file
deleted, renamed or no longer a test file counts 0 under its base path.

**Fails closed.** With `--repo`, an unresolvable base (no master ref, an unborn
`HEAD`, no or several merge-bases), an unreadable base or working-tree test file
(a symlink, over 1 MiB), a `package.json` that does not parse at the base or in
the working tree, or a malformed `test/row-drops.yml` is a `test.rows` block.
Without `--repo` the rule does not run, as `test.sleep` does not. The
pull-request path runs no check; the merge group is where the rule binds before
merge.

**How rows are counted** (`countTestRows`, lexical, no parser): on the file's
code with comments and string and template contents blanked, a registration is
`test(` or `it(` (and their `.skip`, `.only`, `.todo` forms, not preceded by `.`
or an identifier character) in a file that imports `node:test` or
`@playwright/test`: a static `import ... from`, a side-effect `import`, a dynamic
`import(...)` or a `require(...)` whose one literal is exactly that module name,
where `import` and `require` are free identifiers (not `x.require(`, `x?.import(`,
`x.#require(` or `new require(`; an escaped spelling such as `r\u0065quire` is not
recognised). A type-only `import type`, an `export ... from`, a call
inside a comment, string or template, and a longer name such as `node:testing`
do not count. A PASS/FAIL reporter is a function whose body holds `PASS`,
`FAIL` and a `console.log`, `console.error` or `process.stdout.write`; it weighs
1. A wrapper is a function whose body calls registrations or weighted functions;
it weighs their sum (resolved over up to four rounds). A body runs from its
definition line to the first later line indented at or left of it
(prettier-formatted source). The count is the registrations and weighted calls
outside every weighted function's body, each call times its weight.

Limit: rows are counted statically, so a weakened row, a row traded for another,
a row inside a loop (one site) and data removed behind one registration do not
lower the count. `t.test` subtests, `describe` and reflective or generated
registrations are not counted. Scopes are not tracked: a local binding named
`require` is taken for the module system's. A hand-formatted body can be measured wrong, in
the base and the working tree alike.

**The record.** `test/row-drops.yml` is absent until a drop needs it; W-178 does
not create it. Its only key is `drops`, a list of records with exactly these keys:

```yaml
drops:
  - path: packages/cli/src/test.ts
    drop: 5
    opus: W-193
    reason: renamed to packages/cli/src/acceptance.test.ts with the same rows
```

`path` is repo-relative with no `..` segment (compared as a string, never
opened), `drop` an integer of at least 1, `opus` is `W-<digits>`, and `reason`
has at least 15 non-whitespace characters in at least three words. A record is
new when no identical record is in the base's file, so an old record never
admits anything. Each dropping path needs exactly one new record whose `drop`
equals its base count minus its working-tree count; each new record must match a
dropping path. A record names how many rows were dropped, not before and after
counts, so it still matches in the merge group after other opera moved master's
count.

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
sibling studios or fixtures (e.g. `studio/`'s own `source_excludes`:
`examples/` and, W-209, each HTML page directly in `docs/design/dossier/`; and `examples/sample-studio`'s `source_excludes: [studio/,
examples/fixtures/]`) so that sibling's churn never moves this studio's
certificates. `check` blocks a non-list-of-strings value (`manifest.shape`).
An entry is a path, never a pattern: a directory with everything under it,
or one file. The dossier pages are listed by name, and `recordOnly`
(`scripts/ci-scope.mjs`) treats the same pages as records, so a change to
them alone moves no certificate and takes the records-only CI path. A new
page stays in the SOURCE tree until a records PR adds it to the list, and
W-211's row in `scripts/ci-scope.test.mjs` (also in `test:record`) fails
until it does: the list must be exactly `examples/` and those pages.

Certificate staleness/dirtiness/corroboration (`probatio.certifies.stale`,
`.dirty`, `.mismatch`, `.evidence.tree`) is judged only for opera in an
ACTIVE state — `building`, `verifying`, `review` — never for `done` or
`halted`: a done opus's certificate is history, and re-flagging it every
time the tree moves on afterward would be noise a done item can't act on.
`bisellium check --repo .` on a studio whose non-active opera carry old or
mismatched certifies shows no certifies advisories for them.

## The spec review gate

With `spec_reviewer: <sella>` in `bisellium.yml`, `next` names no `branch` until one recorded review by that seat
has passed after the design magister's newest signature (W-162, D-046). The seat is a declared, live Codex
`kind: agent` on `gpt-5.6-sol`, not the magister. Optional `ui_spec_signer` and `ui_spec_reviewer` are atomic:
both absent keep that pair for `kind: ui`; present, they name distinct live agents, Codex `gpt-5.6-sol` on `codex`
and Claude `claude-opus-5-5` on `claude-code` (D-091, W-348). An absent key keeps the ladder; malformed settings
hold `spec`. The gate applies while trunk is `greenlit`; past `ready`, today's signature check applies.

Signer signatures and reviews are both `bisellium verdict <opus> --phase spec`
logs, `ci/<opus>-spec-<n>.log`, ordered by round, and each records
`# brief: briefs/<opus>.md blob:<sha1>` (a spec verdict is refused, exit 2, when the
brief is unreadable); a `ui-lead` log there is a `kind: ui` opus's UI input, read only as
that (W-338). With the setting present `next` reads every other such log strictly. The
newest valid signature naming the current brief's blob anchors the sequence; at most one
valid review of the configured seat, with exact model, may follow it, and every log above the anchor must be that review:

- no review: the configured reviewer is ordered at the next round, with the packet and dispute lines and `--session` in the record command. A fresh one-shot dispatch (`resume: false`) when the reviewer has no recorded session; otherwise `resume <seat>'s session <id>` and a `session:` line (W-215);
- `passed`: for a `kind: ui` opus with no current UI input, the `ui-lead` at the next round, its prompt kept as `ci/<opus>-ui-prompt-<n>.md`; then `branch`, which commits the brief, every round and that prompt;
- `failed`: the configured signer is ordered to revise and sign again; a newer signature needs a newer review;
- two failed reviews since the newest re-spec (the count starts above the newer of the newest passed review and a signature that stood by the split; W-246, D-061 §4, D-063 §7): the signer is ordered with a `split:` line naming `bisellium new … --parent <opus>`; the producer files the remainder, the signer cuts the brief and signs, and that signature stands without a third review (the commit carries the brief, the signature and the failed logs);
- an edited brief, or no valid signature: the configured signer is ordered at the next round;
- any malformed log, unreadable log, second reviewer verdict or log of another seat above the anchor: held. Logs at or below the anchor are history, so signing again recovers from a bad log.

A review's outcome must agree with its findings (`passed` has no blocking finding,
`failed` has at least one) and every numbered finding ends `check: <value>`. A blocking
finding that cites no line of the pinned brief is recorded advisory, as in build, and a
review submitted `failed` with no standing blocker is recorded `passed` with
`# submitted_outcome: failed` (W-246). Limit: the `# model:` header is the recorder's claim,
and the gate cannot judge whether the review reasoned well.

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

## Writing from a browser (W-067)

A write also requires an acceptable `Origin`. `checkWriteAuth` computes
exactly two accepted strings once at startup, from the socket's own bound
port (`server.address().port` — never `opts.port`, which is `0`/undefined
in exactly the cases that matter):

```
http://127.0.0.1:<boundPort>
http://localhost:<boundPort>
```

Both hosts are accepted deliberately: the server binds `127.0.0.1` only, but
a browser's `Origin` follows the URL the page was loaded from, and
`http://localhost:<port>/` reaches the same socket on every platform this
runs on — accepting both admits nothing the other doesn't. An **absent**
`Origin` is still accepted (curl, the CLI, every non-browser caller) — the
token is what authorizes those, unchanged. A **present** `Origin` refuses
with 403 unless it equals one of the two strings exactly: the literal
`Origin: null` (a sandboxed iframe, `file://`, a redirect chain — a value,
never confused with an absence), the right host on the wrong port,
`https://` instead of `http://`, `http://[::1]:<port>`, and any foreign host
all refuse the same way. No trust is ever derived from `Host` or any
`X-Forwarded-*` header. **Reverse-proxy access is unsupported**: a proxy's
`Origin` won't match either accepted string, and the remedy is to reach
`serve` directly, never a header allowlist. Order is unchanged — Origin
(403), then token (401), then Content-Type (415) — and the token is still
required and still what authorizes: loopback plus a matching Origin alone
authorizes nothing (W-016 behaviour 5, unbroken).

The served console (`apps/web`) never has the token baked in. It reads
`sessionStorage.getItem("bisellium.token")` only — `serve` prints a fresh
random token to stdout at every start, and pasting it into the console's
one-field prompt (mounted once in `App.tsx`, above the routed screen) is
the only way the page learns it. The prompt reopens on any write's 401, not
on the field merely being empty, so a stale or wrong token re-prompts
instead of looping silent 401s. Nothing ever writes the token to
`localStorage`, to disk, or into a URL.

`POST /api/*`'s response is always HTTP 200 with `{ ok, exitCode, output }`
for a *completed* command, success or refusal alike — a refused command
(unknown record, a failed validation, any nonzero exit) is never a 4xx. A
client's `res.ok` therefore means only "the HTTP call completed"; telling
success from refusal means reading the body's own `ok` field, which is what
`apps/web/src/api.ts`'s `postWrite` does (`WriteResult`: `"ok"`,
`"refused"` for a 200/`ok:false`, `"unauthorized"` for a 401, `"error"` for
anything else, including a thrown network failure).

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
## Disposable builder execution and review admission

Builder-class `bisellium run` dispatches are different from the generic
runner. A builder needs an effective opus from `--opus` or its instance
suffix; a mismatch, `--base`, or `--no-worktree` is refused. `--keep` keeps
host diagnostics and published commits only. It never keeps the runtime.

The producer pins `opus/<id>` and `master`, takes an exclusive publication
lease, and makes a `git clone --no-local --no-hardlinks --dissociate` with no
remote or alternates. The clone is mounted into a bubblewrap PID/user/mount/
network namespace. Raw `.git` is read-only. The only `git` on `PATH` is a
client for a host broker, reached over two named pipes (`git-request`,
`git-reply`) the producer creates in the read-only `/control` mount; there is
no socket, so a `git` run from any depth of the builder's process tree reaches
it. The broker allows reads, staging and ordinary commits on the owning
branch, fixes identity/config/hooks, and rejects ref/config/reset/stash/
remote/destructive operations. The child starts from an empty environment
with only the runtime allowlist, private home/temp/npm paths, no credentials
or proxy variables, private loopback, and no external tool-runtime egress.
If this outer boundary, the broker, dependency preparation, or the retained
child/grandchild/index/temp/loopback probe is unavailable, dispatch fails
closed before source work.

After the builder exits, only clean commits descending from the pinned tip
and touching the brief's `Files owned` are eligible for export. Protected
officina/evidence paths, extra refs, working files and dependency directories
are never imported. Publication is compare-and-swap. The producer kills the
whole process group, closes the broker's pipe channel and deletes all private
runtime paths, the pipes included, on every exit path. Cleanup failure is failure.

Only after disposal does the producer use the pinned host-master controller
to replay clean committed reds and run the fixed CI, verify and check gates
in fresh candidate checkouts. A successful existing run receipt gains a
`completion` object with `origin: host-producer`, opus/branch/builder/producer,
base and final commits, final SOURCE tree, tooling commit, red replay claims,
all three gate outcomes, teardown completion and final exit zero. The opus's
`run_receipt` is a contained repository-relative pointer written only after
all of those conditions succeed.

Both `review --pass` and `review --fail` run the same admission check (`admitCurrentGates`, W-312) before
reading evidence or changing a gate/event, as does the `review` rung of `next`. A marked record's gate selectors
(its kind and `probationes`, the manifest's `probationes` rows and `source_excludes`) are validated whole first: a
malformed one refuses (`the gate configuration is malformed: <problem>`) and never narrows the set. The source tree
must be clean, and each automated gate of the record's kind (the manifest's, plus a `ui` opus's `served-e2e`) must be
`waived` or `passed` certifying the tree of `HEAD`, with `evidence` exactly `ci/<opus>-<gate>-<8 hex>.log`, a contained
regular file under `ci/` whose first line is `certifies: <tree>` and third `exit code: 0` (what `bisellium ci --opus`
and `verify` write); each log must be tracked by git and unchanged from `HEAD` (`a gate log is not committed`). A
legacy (unmarked) record is admitted. The logs prove the automated gates at the tree, not which command wrote them;
the rest of `CI_STEPS` and the red replays are first proven by the merge queue's `certify` and `gates` jobs. The
older host receipt (`admitCurrentRunReceipt`) remains as history and admits nothing. `verdict` remains transcript-only and grants no admission.
