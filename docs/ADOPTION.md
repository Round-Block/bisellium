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
bisellium.yml              manifest: version, patron, collegia, sellae, probationes, wip_limit, defaults
leges/<collegium>.md       one lex per collegium (LEX_TEMPLATE.md)
opera/<id>.md               one file per opus, YAML front matter + notes
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

Planned, not yet built: `memoria/sellae/`, `decisions/`, `archive/`, and the
docs registry.

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
  - { id: review, name: Lead review,  kind: agent }
  - { id: patron, name: Patron call,  kind: human }
review_probatio: review           # probatio id that gates "review" state (default "review")
wip_limit: 3                      # items in building + verifying, studio-wide
defaults:                         # optional overrides of the dossier's Defaults table
  handoff_stale_days: 3
source_excludes: [examples/]      # optional; repo-root-relative paths also excluded from the SOURCE tree hash
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

`command` (a shell command) is optional on a `kind: automated` probatio; it is
what `bisellium verify <opus-id>` runs to fill that gate's `status`/
`evidence`/`certifies` in the opus itself (see `## opera/<id>.md` and
`## Running check` below). An automated probatio with no `command` is never
touched by `verify` — its evidence has to come from elsewhere.

## Lifecycle (fixed)

`backlog → greenlit → building → verifying → review → done`, plus `halted`.
Greenlit is the Patron's slate decision; everything after it is the collegium's.
State is asserted by the magister, but `check` fails a state the evidence cannot
support: `review` needs every automated gate and every other agent gate passed;
`done` needs all non-human gates passed and any recorded human gate passed or
waived. `waived` needs a `reason` and is never allowed on an automated gate.
WIP counts `building` + `verifying`; `review` waits on someone else.

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
other gate survive untouched. `handoff` and `greenlight` (below) are the
other tool-written changes to an opus, and go through the exact same
merge-not-replace seam (`editOpusFrontMatter`, packages/cli/src/frontmatter.ts):
each touches only the keys its own contract names — `traditio`'s five keys
for `handoff`, `state`/`declined` for `greenlight` — never anything else.
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

## Writing to a studio (handoff, emit, answer, greenlight, budget)

```bash
npm run bisellium -- handoff --opus <id> --sella <sella> [--stage <state>] --next <text> [--blocked-on <text>] [--studio <dir>] [--now <iso>]
npm run bisellium -- emit '{"name":"workflow.custom","attrs":{"k":"v"}}' [--studio <dir>] [--now <iso>]
npm run bisellium -- answer --petitio <id> <reply…> [--ask-back] [--charter-gap] [--studio <dir>] [--now <iso>]
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
`<studio>/events.jsonl` via `@bisellium/core`'s `appendEvents`, stamped
`workflow.source: cli` and a `workflow.source.seq` taken from the log's
current length. `events.jsonl` is live/derived telemetry, not the studio's
committed record — gitignored, same reasoning as `receipts/` and
`timeline/`.

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
the petitio>`. `greenlight <opus>` requires the opus be `state: backlog`
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
a conversation doesn't. The subprocess environment is filtered the same way
an untrusted probatio command's is (`filterEnv`, `@bisellium/shim`): a
secret-shaped variable name is dropped before the harness sees it.

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
deterministic-query fast path) · 2 usage error / not a studio / unknown
sella / unknown or unavailable harness (one-line reason) · 3 the harness
reported a usage/rate limit, printed as `<sella> is limited on <harness>;
try again after <reset if known>` · anything else is the harness's own exit
code, relayed as-is.
