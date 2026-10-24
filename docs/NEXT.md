---
kind: guide
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the commands it describes are removed or fold back into docs/ADOPTION.md
---

# Reference: next

Contract: `docs/ADOPTION.md`; where they disagree, the contract wins.

## Running next

```bash
npm run bisellium -- next <opus> [--perform [--chain]] [--expect <step>] [--budget <tokens>] [--title <text> --body-file <path>] [--poll-ms <n>] [--max-polls <n>] [--studio <dir>] [--repo <dir>] [--now <iso>]
npm run bisellium -- next <opus> --track <step> --pid <n> --output <path> [--studio <dir>] [--repo <dir>] [--now <iso>]
npm run bisellium -- next --all [--studio <dir>] [--repo <dir>]
```

**`--all` (W-299, D-077 B).** Read-only: for every record in the main checkout's `opera/` whose state is `greenlit`,
`building`, `verifying` or `review`, in id order (numeric within the id), one line `next: <opus> <step> <status> · actor:
<actor> · why: <why> · traditio: <sella> at <at>: <next>[; blocked on <what>]` (or `traditio: none`), the step derived
as `next <opus>` derives it before the dispatch gate (so no budget or handover hold and no step health) and the traditio
read from the record that gate reads, then `open: <n>`. It writes no ticket, marker or step log. A record that cannot be read or carries no
lifecycle state prints `next: <opus> unreadable`; a record in neither `master` nor `opus/<opus>` (which `next <opus>`
refuses as unknown), a present traditio without string `sella`, `stage`, `next` and `blocked_on` and an ISO `at`, and a
derivation that throws each print `next: <opus> failed`; a held derivation prints its line as is. Any of these exits 1
after every line is printed (a traditio `blocked_on` other than `none` is reported on its line and does not itself fail the run);
otherwise (no derivation held) it exits 0. It takes no `<opus>` and no flag but `--studio` and `--repo` (exit 2), and
refuses a linked worktree as `next <opus>` does. A fresh session reads it, with the handoff's Queue, instead of a
Resume point.

`next` is the cascade order as a verb (`packages/cli/src/next.ts`). From the
record and its evidence alone it derives the one legal next step of the
thirteen-rung ladder `STEPS` (`greenlight`, `spec`, `branch`, `ready`, `reds`,
`build`, `review`, `pr`, `merge`, `cleanup`, `done`, `retro`, `checkpoint`), names it,
and refuses to skip. A rung is met by evidence, never by memory: the committed
trunk (`refs/heads/master`, read with `git show`, never a working tree) carries
the signed spec, and, once it carries the opus's `done` record, settles every
rung up to `done`. The opus branch's own evidence (record, `ci/`, reds, gate
logs) is read from its worktree `<repo>/.worktrees/<id>`. A MERGED PR settles
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
from it (else `HEAD_MOVED`). A `gh pr merge` call that fails (arming auto-merge,
or disabling or re-enabling it) is followed by one fresh `pr view` a poll
interval later: only a PR that then reads MERGED, under the same identity and on
its pinned head, is landed (W-384); any other read keeps `MERGE_FAILED`. Exit 0: a step named or performed, a
live step reported running, or the ladder complete. Exit 1: refused, held, dead,
or a performed step failed. Exit 2: usage, unknown opus, not a studio, not the
main checkout. **`running` is a header word at exit 0, not an exit code: an
orchestrator must read the word.**

`--expect <step>` exits 1 with `refusing: next step for <opus> is <A>, not <B>`
whenever `<B>` is not the derived step. `--perform` executes only the derived
rung (`branch`, `ready`, `review`, `pr`, `merge`, `cleanup`, `done`) and then re-derives;
it never runs a second rung in one call and stops at the first named-only rung
(a dispatch, `greenlight`, `checkpoint`), running nothing. It takes the step
marker first, derives again, checks `--expect` against that second derivation,
then acts; it never sets `BISELLIUM_ROLE` (a `greenlight` rung is the Patron's
alone) and relays any refusal from `ready` (D-021) or `done` unchanged as
`held`. `branch` refuses unless HEAD is the `master` branch at the `master` tip
and the tree is not dirty, except the brief, the new spec rounds and the
opus record, which ride the first commit (an ignored spec file is refused). `pr` rebases onto the fetched trunk, stops before
push and PR if the rebase changes the SOURCE tree, pushes `--force-with-lease`,
and creates the PR from `--title` and `--body-file` (without them it only names
the command; an existing OPEN PR is reused). `merge` updates a BEHIND branch,
refuses on a failing check, on fewer than `MIN_CHECKS` (5) checks in bucket
`pass`, and on any open GHAS alert, then queues `--squash --auto` and, only when
`CLEAN` with every check passing, asks directly; `BLOCKED` is never merged
directly. `cleanup` deletes the worktree, the local branch and the remote branch
in that order, each after a fresh MERGED re-read, idempotently (an absent piece
is `skipped (absent)`). Before `opus/<opus>` exists the spec is judged in the main
checkout, and `branch` commits the brief, every new spec round and the modified
record as the branch's first commit (a spec landed earlier adds none);
`chore/done-<opus>` is landed as before, the way it lands an opus: push
`--force-with-lease`, reuse or
create the PR (title and body from the head commit), the `merge` rules, a trunk
fetch, then delete the head locally and on origin. A head that changes anything
outside the officina records (`recordOnly`: the officina, the handoff, the dossier pages) is refused before the push. While an automated probatio
has no `tree:` certificate the `done` rung of a non-`ui` opus names `bisellium next <opus> --perform --expect done`
(W-259, part 1: the perform records the merge queue's certify certificate, below) and that of a `ui` opus, on either
record, names `bisellium verify <opus> --studio <dir> --repo .`; performed `done` then creates `chore/done-<opus>` from the
`master` tip, runs `done`, and commits the record, verify's
`ci/<opus>-<probatio>-<hash>.log` files and the tracked handoff and dossier-page changes together
(W-299: a handoff change may ride and none is required, and the checkpoint rung reads complete once the trunk
record is `done` and its retro is filed or not owed; it refuses, while `master` keeps `docs/design/dossier/progress-body.html`, unless the working tree adds a line to that page naming the opus id, the history row), and returns to `master`. Before `done` runs, performed `done` holds (`handoff: <rule> <where>: <message>` lines) when the real `studio/`'s working-tree handoff, read as if the opus were `done` now, would block `check` (see "Session handoff" under "Running check"); only `performDone` is held, and the step marker and log are written as for any perform. A path
under `.claude/` or `.github/` (the Patron's) is never moved in the main checkout: `fetchTrunk`
stops before the tree and prints `patron: git -C <repo> merge --ff-only <oid>`; a
dirty tracked Patron path prints `patron: git -C <repo> checkout -- <path>`.

**`done` certify (W-259, part 1).** An uncertified `done` perform of a non-`ui` opus records the certificate the merge
queue's `certify` job produced for the merge commit, instead of rerunning `verify` on this host. After `dirtyHold` and
before the handoff, history-row and merge refusals, it reads the settled PR's merge commit and finds the one `merge_group`
run of `ci.yml` whose head is that commit (`gh run list`), completed and successful, with exactly one successful `certify`
job (`gh run view`); it downloads that run's `certify-<run>` artifact into a fresh directory under
`<repo>/.bisellium/certify/` (removed afterwards; `gh run download`) and requires exactly one receipt under a `receipts`
path segment and one `certify.log`. The receipt must be a successful host-produced `run` completion for `<opus>` on
`opus/<opus>` with `ci`, `verify` and `check` passed, complete teardown, and a `finalSourceTree` equal to the merge
commit's source tree; `certify.log` must show `certify: merge group for PR #<n>` and `certify: the mint exited 0`. It then
writes, for each automated probatio of the working and trunk records, `ci/<opus>-<probatio>-<40-hex tree>.log`
(`certifies: tree:<hash>`, a `command:` line naming the run, the PR, the merge commit and the receipt's sha256, `exit code:
0`, the receipt and the log's last 200 lines through `redact`) and records the probatio's `passed`, `evidence` and
`certifies` on the opus record, prints `certificate: certify run <run>, PR #<n>, merge commit <oid12>, tree:<hash>` and
one `certificate: <probatio> ci/<file>` line per probatio, and carries on as above; the done commit stages those logs.

The certificate names the merge commit's tree, not master's tip. Records-only commits after the merge (`recordOnly`: the
officina, the handoff, the dossier pages) keep it, so every probatio then certifies the merge commit's own tree, which
`certificate` accepts as the one `want` when the first gate certifies it. That acceptance is diff-bound and goes through
one function, `mergedTree`, which both `certificate` and the certify perform call: a source change on master after the
merge, an unreadable diff, a change to `<studio>/bisellium.yml` (a gate may have been added) or a change to
`<studio>/opera/<opus>.md` (its `kind` decides the gates) refuses it, and the perform holds. Any other failure (no run, a
failed run or job, an expired artifact, a receipt of another tree or opus, a log whose mint did not exit 0, a symlink in
the artifact) holds too, exit 1, with `why: refusing: the merge queue's certify certificate cannot be recorded: <reason>;
run: bisellium verify <opus> --studio <dir> --repo .`, before `chore/done-<opus>` is cut and with no log or record
written. A hold after the record is written (a stale handoff, say) leaves the certificate in the working tree, as a
`verify` run does, and the next perform finds it certified. Limits: the fallback `verify` is unchanged and keeps its
30-minute limit per gate; GitHub keeps the artifact for 90 days, and a later `done` falls back to `verify`; a records-only
change after the merge was checked by CI's records-only path (`test:record` and the studio check), not the full suite;
the perform trusts what `gh` reports for the repository's own Actions run and reads no signature; the step marker's
silence limit for `done` is 120 s, so a download slower than that reads stalled to a concurrent `next` (nothing kills it),
and each `gh` call has `sh`'s 120 s timeout and 16 MiB buffer; a hold after the logs are written but before the record
write leaves untracked logs that the next perform overwrites; `runDone` still accepts any `tree:` certificate, `check`'s
`probatio.certifies.stale` judges active opera only, and a failed review's tree is compared with the gates' tree as before.

**`review` (W-274, part 1).** `next <opus> --perform --expect review --budget <tokens>` runs one build-review round
end to end, in the foreground (the orchestrator launches it in its own background call and waits for its exit). It
holds, before either reading, on a UI opus (dispatch it as the order names) and on a worktree that is unusable or has a
tracked change. For the censor's order of round `n` it builds the packet under `<repo>/.bisellium/reviews/<opus>/r<n>/`
(local, not committed; `.bisellium`, `reviews` and the packet are proven real directories outside both studio trees
before anything is made, removed or written), fills the seven slots of `prompts/build-review.md` read from the main checkout's studio, never the opus branch (`<ID>`, `<ROUND>`, `<WORKTREE>`, `<PACKET>`, `<REVIEWED_HEAD>`, `<FOCUS>`, and `<STUDIO>`, that studio's path, where the reviewer reads the charter and the lessons; a later round of a sessioned
sequence resumes the reviewer's session with the packet's later-round prompt, from the main checkout's `prompts/later-round.md`, whose `delta.diff` is the source change since the previous round's log, then the officina's), calls Codex `gpt-5.6-sol` at reasoning
effort `high` through the harness adapter with a 25-minute timeout, and records the reply with `verdict`, then `review`,
then one commit on `opus/<opus>` of exactly the log and the record. A reply is accepted only after Codex closes
normally with exit code 0 (a signal, a non-zero exit, a usage limit, a timeout, no session id, a changed session, or a
last nonblank line other than exactly `VERDICT: PASS` or `VERDICT: FAIL` holds), and any failed step holds, exit 1,
the step marker released, nothing recorded after it. A verdict already recorded for the round but not yet cited by the
gate is finished without another Codex call, when its log records exactly one model header `gpt-5.6-sol`, exactly one
valid session header and, for a later round, the sequence's session; otherwise the perform holds. Limits: a failed
commit after `review` leaves the log and the record staged and uncommitted (committing them is a hand step, and `pr`
holds on the dirty record until then); a log the second reading refuses stays uncommitted until it is recorded by hand
or removed; `facts.txt`'s `next` block exits 2 in a worktree packet; a verdict `verdict` refuses for its shape is not
reissued in the same session. Both templates are read from the main checkout's studio (W-314), so an opus's prompt edit lands with its code and governs from the next opus; the charter and lessons the prompts name through `<STUDIO>` are the main checkout's too (W-315). Codex runs with the main checkout as its working directory, never the opus worktree, in a fresh and a resumed round, so the `AGENTS.md` it loads is the main checkout's, and the prompt names the opus's brief, logs and reds by absolute path under `<WORKTREE>` (W-316). A close by signal is a failure of the codex
profile for every caller, `talk` included.

**`--chain` (W-292, W-312).** `next <opus> --perform --chain --budget <tokens> --title <text> --body-file <path>`
performs, in turn and in one foreground call (the orchestrator launches it in its own background call and waits for
its exit), each rung the ladder derives while that rung is `review` or `pr`; `--chain` without `--perform`,
or with `--expect`, is a usage error (exit 2). No host mint runs before review (W-312, D-071 E: the merge queue's
`certify` is the one mint): review is ordered once the builder's `bisellium ci --opus <opus>` has passed the record's
automated gates at the branch's source tree and their logs are committed. Each
rung runs under its own step marker and is performed at most once per call, so the call ends after `pr` at the latest;
the one derivation after each rung is trusted for both the final `next-step:` line and the decision to go on. It prints
each rung's `next: <opus> <step> performed|held` line and its lines, then one `next-step:` line, and exits 0 when every
rung it ran was performed (a failed review round is performed: `next-step: build` is the builder's fix) and 1 at the
first hold, including a later rung that derives held after an earlier one was performed (`gh` failing at PR discovery,
say). A first rung outside the two holds before anything is performed (`refusing: --chain performs only the review and
pr rungs`). Without `--title` and `--body-file` the call ends where `pr` is only named. A re-run after a hold
starts at the rung the ladder derives, so nothing is performed twice. Limits: a throw outside the review perform (the
`pr`'s) ends the call as `next: <opus> failed`, without the earlier rungs' lines, their commits standing; the `pr` rung
in mode direct rebases onto a moved master and holds when the source tree changes, after which the ladder orders the
build rung again. `docs/ADOPTION.md` is code-owned, so the Patron reviews a change to this paragraph.

`gh` and `git` are spawned by bare name through `PATH` with argument arrays (no
shell). Every `gh` read asks for a fixed `--json` field list, is bounded to
1 MiB, is pinned `-R <owner/repo>` where `gh` accepts it, and fails closed: a
non-zero exit, empty or non-JSON output, a missing field or an unknown `state`,
`mergeStateStatus` or check `bucket` is a hold with nothing mutated. A PR counts
only if its head is `opus/<id>`, its base `master`, it is not from a fork, and
its head repository is this repository; `gh pr merge` is pinned
`--match-head-commit <headRefOid>`. `--body-file` must be a regular file of at
most 64 KiB under the repository or the temp directory; `--title` at most 256
characters on one line.

Dispatch rungs (`spec`, `reds`, `build`, `review`) print an order (`role:`,
`sella:`, `budget_tokens:`, `phase:`, `inputs:`, `command:`; the brief and the
record's `traditio` block are the inputs). They need `--budget <tokens>` (ten
digits at most, a syntax error on any step): absent is `held`
(`dispatch budget undeclared`), more than `DISPATCH_TOKEN_CAP` (500000) is
`held`, and a dispatch that resumes existing evidence is `held` unless the
record's `traditio.at` is not older than the newest red or review log
(`stale handover: run bisellium handoff first`). `--budget` is the
orchestrator's attestation of the dispatch's context allowance: nothing measures
the subagent and enforcement is the harness's.

Step health comes from evidence only. `next --perform` writes
`<repo>/.bisellium/steps/<opus>.json` (`pid`, `start_ticks`, `output`,
`writer`) and appends to `steps/<opus>.log`; `--track` registers a step the
orchestrator launched itself (an unverified attestation: pid greater than 1, not
`next` or its parent, `/proc` start time read by `next`, `<step>` equal to the
derived rung, `--output` a plain file already under `.bisellium/steps/`). A
marker is live only if `/proc/<pid>/stat` exists, is not a zombie and field 22
equals `start_ticks` (a reused pid reads dead) and the output file's mtime is
inside the step's silence budget; otherwise it reports `dead` (or `stalled`, the
pid named and never killed) with the last output line as a JSON-quoted
`last-output:`, its age and a `resume:` line. An unreadable or unparseable
`/proc` entry is `unknown`, which is `held`, never `dead`. No marker is
`health: no step recorded`, never "running" or "healthy". A dispatch order (the
architect's signature, a spec review, the reds, the build, a review dispatched
rather than performed) with no marker reads `health: stalled (no step recorded;
newest file <path> changed <n>s ago, past 900s)` when no regular file under
`<repo>/.worktrees/<id>` or `<id>-*` or `~/.bisellium-evidence/<id>` or `<id>-*`
(`node_modules` and `.git` skipped, no symlink below them followed) has changed for more
than `DISPATCH_SILENCE_SECONDS` (900); the opus's producer lease
(`<repo>/.bisellium/leases/<id>/pid`) no older than the host run's 60-minute
timeout is a `bisellium run` in flight, never a stall. The step named and the
exit status are unchanged (W-316). A counted directory, file or the lease that
exists but cannot be read is never skipped: it reads `next: <id> <step> held`,
`health: unknown (dispatch activity cannot be read: <reason>)`, exit 1 (W-316).
Linux only.

Test seams, honoured only with `BISELLIUM_TEST_CLOCK=1`: `--now <iso>` (otherwise
a usage error) and `BISELLIUM_TEST_PROC=<dir>` replacing `/proc` for every
health read, including the verb's own `/proc/self/stat`.

**Step tickets (W-233).** With `step_tickets: required` in `bisellium.yml`
(the only value; absent keeps the ladder as it was, anything else holds `next`
naming the cause), a report-mode `next <opus>` writes one ticket for the action
the rung it names allows, to `<git common dir>/bisellium/tickets/<opus>.json`,
replacing any earlier one, and ends its output with one `ticket: <action> round
<n>` line; a hold, a Patron rung, a halted record and a rung no covered verb
performs delete the pending ticket, by its path in the git common directory and
without reading the facts, and print `ticket: none`; a deletion that fails prints
`ticket: held, <why>` instead, never `none` with the file left. The ticket binds
the opus, step, action, round, actor, the studio the action writes in, that
checkout's HEAD, the brief's blob and the time. `verdict` (spec and build
phases), `review`, `red`, `ready`, `done`, `branch` and `merge` then refuse, exit
2 with two lines, unless the pending ticket names their action and round and its
studio, head and brief equal what the verb reads at that moment; the refusal
comes after the verb's argument checks and before its first write; `branch` and
`merge` also refuse when `--repo` is not the checkout their `--studio` belongs to. A covered write claims the ticket by renaming it to
`<opus>.claimed` immediately before writing and copies its line into what it
writes (a `# ticket:` header in a verdict or red log; one `tickets:` entry on the
record for `ready`, `review` and `done`; `branch` and `merge` print it only), so
each ticket admits at most one write and a failure after the claim costs a fresh
`next`. A recorded build verdict that the review gate does not cite yet makes
`next` name `review` for that round (actor `producer`) instead of a new round;
`next --perform` issues the ticket for the rung it performs, so `ready` and
`done` consume it, and leaves the ticket the next derivation names. Limit: the
file is local and agent-writable (mistakes, not adversaries, D-045); `handoff`,
`verify`, `run`, `amend`, `halt`, `waive`, `greenlight` and the other verbs stay
unticketed, `pr`, `cleanup` and the spec commit run only inside
`next --perform`, and dispatch preconditions (budget, stale handover) gate
launching a session, not the ticket.

