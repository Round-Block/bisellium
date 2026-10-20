---
kind: guide
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the commands it describes are removed or fold back into docs/ADOPTION.md
---

# Reference: the record verbs

Contract: `docs/ADOPTION.md`; where they disagree, the contract wins.

## bisellium verdict

```bash
npm run bisellium -- verdict <opus> --round <n> --sella <id> --outcome <text> [--phase spec|build|handoff] [--model <id>] [--session <id> [--session-reason <text>]] [--from <path>] [--dispatch-prompt <ci-path>] [--ui-input <ci-path>] [--studio <dir>] [--now <iso>]
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

For a non-`ui` spec verdict by the design collegium's magister (W-306; no
design row means `architect`; a design row that is duplicated or whose
magister is not a nonblank string refuses every non-`ui` spec verdict), the
writer refuses a signature whose brief names a CLI verb in inline code unless
it cites a promise ledger. A promise line is a brief line holding an inline-code
span whose whole text is a verb of the usage text. The signature carries one
line above its `## Findings` heading, `Promise ledger: <absolute or ~/ path>`,
naming a regular file of at most 256 KiB. The coverage test is textual: for each
promise line and each verb on it, some ledger line holds the whole tokens
`brief:<n>` and `<file>:<line>` (not `brief:`, and not a range, a decimal or a
path continuing past the number), the verb as a whole word, and `holds` or
`scoped`. The ledger's reasoning is not checked, only its coverage, and the
word test for `check` is also met by an incidental "check". A caller named
outside inline code, as a full command (`bisellium next W-1`) or by function
name (`gateDispatch`), makes no promise line, nor does a sentence that names no
verb. The log names the ledger and does not copy or fingerprint it, so an edit
after signing is not seen. Only new signatures are judged: `next` reads
recorded signatures as before, so a log written before this is not re-read. A
reviewer's spec verdict, a build or handoff verdict and a `ui` opus's spec
input need no ledger.

The same ledger covers the brief's readers (W-319). Each row of the brief's
Input domain table, as brief admission reads it (the one `Input domain`
section's first table, after its header and delimiter lines), needs a ledger
line holding the whole token `brief:<n>` for the row's line, a `<file>:<line>`
and `holds` (the cited line rejects the row's out-of-domain input and fails
closed) or `scoped` (the row's stated limit), so a brief with an Input domain
row and no promise line needs the ledger too. The check is coverage only: it
cannot tell whether the cited line fails closed nor see an omitted reader;
`inputDomainRows` yields no rows for a missing or repeated section or a first
pipe run shorter than three lines, while other admission failures can still
yield rows; where `brief_behaviour_limit` is declared, `next` separately sends
every inadmissible signed brief back.

Each row also names the test that pins it (W-322): its line holds
`` pinned by `<test row>` "<assertion text>" `` (one or more), or the word
`unpinned`, and then a ledger line citing it says `scoped`. A row whose Valid
domain says "any text" or "any string" (D-085 D) also holds a forms clause:
"recognises", the forms it recognises as code spans or as `brief:<n>` or
`brief:<a>-<b>` citations of the lines that list them, then "every other form"
and "limit"; each cited line holds a pin of its own. The writer refuses the
signature otherwise, one problem per row or line. The check reads words, not
meaning: a row ruling text that does not say "any text" or "any string" needs no
forms clause, and a pin's row and assertion are not looked up at signing. The
build round's `facts.txt` (`scripts/review-packet.mjs`) then lists, under
`== ruled cases with no pinning assertion in the diff`, each row or cited line
none of whose pins is found in the source diff from the merge-base with master:
a pin is found when one changed file's added lines hold its row name and its
assertion text, anywhere in that file's added lines; an `unpinned` row and a
pin to an unchanged test are listed too.

For a build-phase, non-`ui` verdict (W-126) the writer reconciles each
`blocking` finding with the opus's declared brief. A blocking finding stays
blocking only when it cites a non-blank line of that brief, as `brief:<n>`,
`<spec>:<n>` or `<officina path from the git root>/<spec>:<n>`; any other
blocking finding is recorded as advisory, with its reason, in
`# converted: <finding> (<reason>); …`. A failed `--outcome` (`fail`/`failed`,
optionally after `VERDICT:`) whose every submitted blocker was converted is
recorded as `# outcome: passed`, with the raw text in `# submitted_outcome:`;
`# brief: <spec> blob:<git blob id>` pins the brief bytes the citations were
checked against. The body is never edited, a passed outcome is never turned
into a failure, and each conversion is also printed. `review --fail` refuses a
log carrying `# submitted_outcome:` (exit 2, nothing written).

In a studio that sets `step_tickets: required` (see "Step tickets" under "Running next"), the verdict
refuses without a matching `next` ticket and its log ends the header block with the
ticket's line as `# ticket: <json>`; `parseVerdictLog` accepts and ignores it.

`--phase handoff` writes `ci/<opus>-handoff-<n>.log` (the non-UI findings check on any
opus kind, no `# brief:` pin, no conversion). A review sequence is one opus, one phase
and one sella (W-215). `--session <id>`
records `# session:` (one token); once a round of a sequence records a session, the
writer refuses a later round with another session, or none, unless
`--session-reason <text>` states why it was replaced, and refuses a round at or below
it. A sessioned verdict's outcome is exactly `passed` or `failed` and agrees with
what stands: a blocking finding that is not converted and not withdrawn. From the
sequence's second sessioned round the body carries `## Earlier findings`, one line
`- ci/<opus>-<kind>-<m>.log #<k>: closed|open|reversed — <evidence>` for each standing
blocker of the previous round and no other (`open` only beside `failed`; `reversed`
holds a `file:line`). An author's dispute is `## Rebuttal` (`<k>. <evidence holding a
file:line>`) with the reviewer's `## Ruling` (`<k>. withdrawn — <why>` or
`<k>. upheld — <why holding a file:line>`): both sections together, ruling the same
findings, once each; a withdrawn finding no longer stands, and an `open` ruling is not
recordable (the dispute goes to the Patron, whose answer is recorded as the ruling).
These sections are read only in a log that carries `# session:`; any other log is read
as before, its headings plain prose.
The writer trusts the session id it is given and checks the grammar and the
accounting, not the judgment. `scripts/review-packet.mjs` builds a round's packet
(`delta.diff`, `facts.txt`, `prompt.md`); `scripts/review-rounds.mjs <studio>` prints
the round counts that each `retro --opus` acta carries under `## Review rounds`.

The command writes evidence only: it does not update `probationes`, state,
events, or timelines. A build orchestrator can follow it with
`review --evidence <path>`; spec verdicts are citable evidence for `retro`, not a second
spec gate.

## bisellium retro

```bash
npm run bisellium -- retro --cascade <N> [--from <json>] [--studio <dir>] [--now <iso>]
npm run bisellium -- retro --opus <id> --from <triage.json> [--studio <dir>] [--now <iso>]
```

`--opus` and `--cascade` exclude each other; `--opus` requires `--from`. The
`--cascade` form is described first, the `--opus` form (W-137, D-039) after it.

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

### retro --opus (W-137)

Once an opus is `done`, its retro is the next step, and no other opus starts
until it is filed. The retro reads the opus's recorded verdicts and reds, and
accounts for every finding exactly once: a lesson with a named fix, or "not a
lesson" with a reason. The `retro` manifest key turns it on:

```yaml
retro: { since: 2026-10-06T06:06:57Z, high_greenlit_by: D-039 }
```

`since` (an ISO date) is when retros start being owed: a `done` opus whose
`end` is at or after it owes one. A `done` opus with no `end` closed before
W-096 and owes none; an `end` that is present but not a date counts as owed
(fail closed). `high_greenlit_by` (optional) names a Patron decision; without
it a high-severity fix stays in `backlog` like the rest. Absent `retro`, nothing
is owed. A malformed `retro` (not a mapping, an unknown key, a bad `since`, a
`high_greenlit_by` that is no Patron decision) is a `manifest.shape` block at
`bisellium.yml#retro`. `owedRetros` (`packages/cli/src/retro.ts`) is the one
reader of the setting and of retro-filed status; `next` and `check` call it.

The triage (`--from`) has one entry per recorded finding and no other keys:

```json
{ "findings": [
  { "log": "ci/W-153-review-2.log", "n": 2, "class": "review×fail-open", "fix": "W-161" },
  { "log": "ci/W-153-review-3.log", "n": 1, "class": "tests×x", "fix": { "title": "add the x row", "collegium": "engineering" } },
  { "log": "ci/W-153-review-4.log", "n": 3, "not_a_lesson": "a repeat of review-2 #2" }
] }
```

Every record is judged at one boundary and the whole retro refuses (exit 2,
one line, nothing written) on anything outside its domain: verdict logs
(`ci/<id>-review-<n>.log` and `<id>-spec-<n>.log`, `# opus:` equal to the opus,
one `## Findings` heading holding `No findings` or lines
`<n>. blocking|advisory …`, `# converted:` naming recorded findings), reds
(`ci/reds/<id>/NN.log`), lessons (a mapping with a `class`), the setting, and
the triage (every recorded finding exactly once; `class` matches
`<area>×<name>`; one `fix` per class: an opus, a rule id or a decision, or an
object `{ title, collegium }` that is filed as a new opus in `backlog`). A
`fix` naming the opus itself is a ride-along. The opus must be `done` and its
retro not yet filed.

Writes, in the order that leaves a crash owing the retro: new fix opera, one
lesson per class (keys `id`, `at`, `class`, `evidence`, `opus`, `severity`,
`addressed_by`), the greenlight of each high lesson's `backlog` fix (state
`greenlit`, `greenlit_by`, a `workflow.greenlight` event; no Patron timeline
line), and last `acta/<date>-retro-<id>.md` (`opus: <id>`; sections `Sources`,
`Lessons`, `Not lessons`, `Fixes started`). Severity is a rule over recorded
facts, never a model: `high` when the class area (the text before `×`) is
`security` or `data-loss`, or a lesson of the same class already exists;
`medium` when any finding of the class is blocking (first word `blocking`, and
not listed in the log's `# converted:` header); otherwise `low`.

`next` names step `retro` (actor `producer`) once an opus is `done` and owes
one, before `checkpoint`, and holds at `branch` for any new opus while a retro
is owed (`retro owed: <ids>; file them before a new opus starts`). `check`
advises `retro.overdue` (`<id> is done (<end>) and its retro is not filed`) and
`lesson.unfixed` (`<id> names no fix (addressed_by)`).

## bisellium amend

```bash
npm run bisellium -- amend <opus> [--title <text>] [--spec <path>] [--arc <id>] [--parent <id>] [--ui-ruling <decision-id>] [--round-ruling <decision-id>] [--milestone <id> --value <n>] --reason <text> [--sella <id>] [--studio <dir>] [--now <iso>]
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
it never creates a decision or evidence.
`--round-ruling` (W-167) appends one Patron ruling to `round_rulings`: it
refuses, before any write, unless the build-review history and the review
configuration read cleanly and the list with the id appended is valid (see
"The build-review loop" below). A duplicate or a value identical to
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
(`state: resolved`; W-114: that `[stated]` reply is then shown in the boot
context of the petitio's `from`/`to` sella for two days when the other party is
the patron, newest three only); `--ask-back` instead flips `from`/`to` so the Patron
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
writing either is a Patron/sella act, not tick's.

`tick` also schedules the model probe cadence (W-071, the Patron's decreed
dynamic refresh — `models.json`'s own writer is `bisellium probe`/W-069's
battery, never tick itself). At most one `probe` due item per run, firing on
either of two per-`(model, harness)` pair triggers: **age** — no
`HarnessProbe` at all, an unparseable `at`, or an `at` older than
`defaults.model_probe_stale_days` (default 7) — or **version** — the vendor
CLI's live `--version` line differs from that *same pair's own*
`probes[].harnessVersion` (never the record's top-level `harnessVersions`
snapshot, which is a last-observed value, not a trigger). `undefined` on
either side never fires. `--dry-run` prints `due: probe — N pair(s)` and
spends nothing; otherwise tick runs the battery itself, capped at
`MAX_PROBE_TURNS_PER_RUN` (12) turns — a pair the cap skips keeps its old
evidence and heads the next run's queue, so a capped run never stalls a
pair forever. A failing battery is reported on stderr and never fails the
tick, the same posture a failing daily takes. `tick` finishes by writing
a receipt under `receipts/tick/`. Exit codes: 0 `check` passed (or paused), 1
`check` had blocking findings, 2 usage error / not a studio.

`pause` writes `<studio>/PAUSED` (`{ at, reason }`); `resume` removes it.
While paused, `tick` runs only the `check` + `health.json` step above and
skips all cadence work — no acta, no receipt. The brake stops *starting*
autonomous work, not talking: `run` and `talk` both proceed regardless while
paused, each printing a one-line `warning: studio is paused …` first (the
Patron talking to a sella directly is how you find out why it's paused).

