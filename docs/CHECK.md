---
kind: guide
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the commands it describes are removed or fold back into docs/ADOPTION.md
---

# Reference: check

Contract: `docs/ADOPTION.md`; where they disagree, the contract wins.

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

**Session handoff (W-186).** Only for the repository's own `studio/` (`check` run
with `--repo <repo>` on `<repo>/studio`; any other officina is outside the rule).
Every `opera/*.md` record is loaded first and must have a lifecycle `state`; then
`docs/SESSION-HANDOFF.md` is read, and an absent file is no finding. Unreadable
records or handoff (`process.handoff.input`), a handoff with other than one
`## Queue` line, a Queue id that names no record, a Queue that omits a `greenlit`
opus (`process.handoff.queue`; W-299: a `done` or `halted` id in it is no finding),
any line starting `## Resume point` (`process.handoff.resume`; W-299, D-077 B: work
state is the opus records, read by `next --all`), the phrases
`this one`, `this PR` and `above)` (`process.handoff.reference`), and more than 100
split lines (`process.handoff.lines`) all block.

**Hidden pipe exits (W-221).** `process.pipe_exit` blocks a pipe that hides a
command's exit. `check` blocks, on every officina, an automated probatio `command`
that is not a string or holds a pipeline (it runs with `/bin/sh`, so wrap it as
`bash -o pipefail -c '…'`). Only for the repository's own `studio/` (`check` run
with `--repo <repo>` on `<repo>/studio`) it also reads three repository surfaces:
every top-level `scripts/*.sh` must have `set -euo pipefail` as its first command
line and name `+o pipefail` nowhere; a workflow step `run:` holding a pipeline
needs the effective `shell` (the step's, else the job's or the workflow's
`defaults.run.shell`) to be exactly `bash`; a root `package.json` script holding a
pipeline blocks. An unreadable or unparseable file blocks at its path, and an absent
`scripts/`, `.github/workflows/` or `package.json` is no finding. A pipeline is
found lexically: every unquoted `|` outside a comment that is not half of `||`
counts, so a redirection such as `>|`, `<>|` or `&>|`, a `case` pattern `a|b)`, a
`[[ … =~ a|b ]]` pattern, arithmetic or a heredoc body is read as one (a false
alarm: rewrite that line); a pipe inside a quoted string handed to another shell
is not seen, `$'…'` is read as `'…'`, and a nested `scripts/` directory, a child
shell or a sourced file is not read. `set -e` does
not act inside `if`, `while`, `!` or a non-final `&&`/`||` member, so a pipeline
there still hides its status from the script.

**Brief admission (W-127).** Where `bisellium.yml` declares
`brief_behaviour_limit` (a positive integer, else `manifest.shape` blocks), and,
with none declared (W-264), for an exact light brief by every rule except the
upper count: an exception line on it is ignored, `ready` and `next` still require
Red order, `ready` and `check` run a refused `Brief:` marker through admission
while `next` rejects its form error, and `check` blocks an active opus whose
named `spec:` it cannot read. With none declared, a full brief may be read and
classified but is not passed to full-brief admission.
A brief carries `Decree family: <slug>` on exactly one line, at most that many
numbered behaviours under `## Behaviours to test`, and exactly one
`**Genuine red:**` per numbered behaviour. A brief over the limit is admitted
only with one `Behaviour limit exception: <decision-id>` line naming a
decision `by` the design collegium's magister (the architect) whose text
names the opus. A brief also has one `## Input domain` section (W-161): a
table with `Record`, `Valid domain` and `Rejected by` columns, each row naming
one rejecting function in backticks, and the words "fails closed"; or one
`None: <reason>` line when it reads no officina records. `check` also blocks
an active opus whose `spec:` is missing or unreadable. `ready` refuses a brief
that fails (`<id>: brief.admission: <spec> <problem>`, exit 1, nothing
written), and `check` blocks `brief.admission` on an active opus
(`building`, `verifying`, `review`) whose brief fails, through one shared
predicate. Fenced blocks and HTML comments are ignored, and `## Behaviours to test`
appears once. Done briefs are never re-read, so history needs no migration.
Three more forms (W-196, D-056) catch form problems before the spec review.
A brief cites its read enumeration on exactly one line,
``Read enumeration: `<script>` -> `<output>` `` (two backticked paths without
spaces), or `Read enumeration: none: <reason>`; the cited files are not read.
From `## Intent` up to `## Out of scope` (else the top and the end), with inline
code removed, the closed list `always`, `in every case`, `in all cases`,
`exactly as before`, `exactly as on master` and `exactly as today` (whole words,
any case) appears only on a promise line,
`Promise <slug>: <claim> — limit: <what does not hold>` (optionally a list
item); each slug and each normalised claim appears once. A `Rejected by` cell
opens with a backticked function name, or with ``runner: `job` …``,
``exit: `call` …`` or `limit: …` (D-050). `next` applies the same predicate to
the signed brief before it names the spec reviewer: with a declared
`brief_behaviour_limit`, a brief that fails admission gets an architect order
for the next round (`why` starting `brief.admission:`, no reviewer named), an
admissible one the reviewer's, and a malformed limit holds at `spec`. That
holds when `next` reaches the review gate; promise next-review-gate's limit is
that each unchanged earlier or later step that fires prints its own result
instead: refused arguments, a non-repository or linked worktree, an unloadable
studio, an unsafe id, malformed `source_excludes`, an unknown opus, a
`deriveNext` return before the review order (done, declined, halted, stateless
or backlog record; a malformed or UI reviewer setting; a signed, reviewed spec
on the trunk or the main checkout), `--track`, the
dispatch gate (no `--budget`, or a stale or absent handover on a resumed
order), `--expect`, a running, dead or invalid step marker, and an exception.

**Whole-diff promises (W-303, D-070 C).** Where `brief_behaviour_limit` is
declared, `readBriefAdmission` also refuses a line that promises the whole diff
is the Files owned or one folder, because the verbs write the officina's
evidence into the same history: the opus record, `studio/ci/` logs,
`studio/ci/reds/<id>/` and receipts, none of it owned. A line is read once,
after fences and comments are blanked. It is skipped when its raw text holds a
scope phrase (any case): `source diff`, `source change`, `outside studio` or
`outside the studio` (with or without a backtick before `studio`), `officina
evidence` or `officina's evidence`. Otherwise it is split into sentences after
`.`, `!`, `?` or `;` and at every `|`, and each sentence has its inline code
removed. A sentence that holds a subject and a confinement is one problem, at
most one per line. Subjects (whole words, any case): `the diff`, `the whole
diff`, `the entire diff`, `the full diff`, `the whole change`, `the entire
change`, `the full change`, `every file`, `every changed file`, `all files`,
`all changed files`, `all the files`, `all the changed files`. Confinements:
`Files owned`, the word `only`, or `is`, `are`, `lies` or `stays`, optionally
followed by `all` or `entirely`, then `under`, `inside` or `within`. The
problem reads `line <n> confines "<subject>" to Files owned or one folder, but
the verbs also write officina evidence; scope it to the source diff or name
that evidence as not owned: "<standard line>"`, and the standard line is: "The
source diff (every path outside `studio/`) touches only the files in Files
owned. The officina's evidence is written by the verbs and is not owned: the
opus record, `studio/ci/` logs, `studio/ci/reds/<id>/` and receipts." Not
seen (false negatives): a promise wrapped across two lines; subjects outside
the list (`the change`, `the PR`, `this opus touches`); confinements outside it
(`is limited to`, `is confined to`); a line that holds a scope phrase for
another reason; and a promise in inline code, a fence or a comment. Refused
though true (false positives): a promise that covers the evidence in other
words (`the diff touches only Files owned and studio/`), and a sentence that
names the diff and uses `only` for something else; scope either with the
standard line. The scope list names the literal `studio`, so a brief in an
officina with another directory name scopes itself with `source diff`. Where
the key is absent, no full-brief admission runs, but this rule runs on a light
brief.

**Red order (W-166).** A brief that carries the one real line
`Red order: one at a time` (outside fences and comments; any other spelling of
that prefix, or a repeat, is an error) opts in to D-036's order. For such a
brief, `bisellium red <id> --behaviour <n>` first runs every earlier
behaviour's recorded `# command:` at the repository root, on the same clean
`tree:` identity, and refuses unless each exits 0 having passed at least one
test (progress on stderr); it then runs its own command, which must fail and
leave the tree unchanged outside the studio, `.bisellium` and `source_excludes`.
The command must run from the repository's root, with `HEAD` reachable from
`opus/<id>`, and no argument may be empty or contain whitespace, the shape the
host replay re-splits. `check` blocks (`opus.red_evidence`) an active opted-in
opus whose reds for two behaviours name one `tree:`. `next` orders one
behaviour at a time: commit its test, record its red from the worktree, commit
the log alone, implement, then the next behaviour. Where `bisellium.yml`
declares `brief_behaviour_limit`, and with none for a light brief (W-264),
`ready` refuses a new brief without the line (after brief admission passes).
Briefs without the line behave as before.

**Light brief (W-255, D-063 §4).** A brief the architect marks with the one real
line `Brief: light` (outside fences and comments; any other spelling of that
prefix, or a repeat, is an error that is never read as light) needs only
`## Intent`, `## Files owned`, `## Behaviours to test` and `## Acceptance`.
Admission (`ready`, `check`'s `brief.admission`) then skips the Input domain and
Read enumeration checks and asks each numbered behaviour for exactly one
`bisellium red <opus> --behaviour <n> …` command whose `--behaviour` token is
its ordinal; the decree family, behaviour limit, one genuine red per behaviour,
promise lines and Red order line still apply. `next`'s signature gates take the
four sections, brief admission under the declared `brief_behaviour_limit` (with
none, every rule but the count) and the Red order line. A
light brief is refused for security, sandbox, branch-protection and pipeline
work: a decree family token (`security`, `secret`, `auth`, `sandbox`,
`protection`, `pipeline`, `ci`, `certify`) or a backticked `## Files owned` path
on a fixed list. Limit: the list is the whole of the check; other work rests on
the signing architect and the build review. Without the marker a brief is full.

For every red, `--repo` may only confirm the repository the command runs in (a
different Git root is refused; a non-Git `--repo` keeps `# tree: unknown`); a
red recorded in any worktree of the studio's own repository is hashed with the
officina's exclusions, so its `tree:` names a commit of the opus branch; a
malformed `source_excludes` and a command that never starts are refused (exit
2) with nothing written. A red recorded on the wrong tree is corrected by
re-recording it with `--cwd` in a detached worktree at the commit it belongs
on, after the branch's last rebase, and committing its log at the tip; history
is never rewritten.

