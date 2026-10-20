---
kind: guide
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the commands it describes are removed or fold back into docs/ADOPTION.md
---

# Reference: run, verify, ci and the merge queue

Contract: `docs/ADOPTION.md`; where they disagree, the contract wins.

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
npm run bisellium -- ci [--ref <ref>] [--opus <id>] [--studio <dir>] [--repo <dir>] [--allow-dirty] [--offline]
```

`ci` runs this repository's CI pipeline locally, without a runner: the
commands in `CI_STEPS` (`packages/commands/src/ci.ts`), in order, in
`--repo` (default the current directory), stopping at the first that
fails; with `--opus`, the steps handed to `verify` (below) are left out of
that loop. Today those are `npm run -s audit` (`npm audit --audit-level=moderate`:
a moderate, high or critical npm advisory fails it, and so does a registry
failure), `npm run -s typecheck`, `npm run -s lint`,
`npm run -s format:check`, `npm test`,
`npm run -s check -- studio --repo .` and
`npm run -s check -- examples/sample-studio --repo .`. The steps are fixed
in code and name this repository's two officinae; `ci` is not an adoption
feature. `--offline` skips the audit step, the only one that needs the
registry; the receipt host passes it in its network-isolated recomputation,
and no other caller does. `.github/workflows/ci.yml` runs the same commands on a `push` and on a
source-change `merge_group`, each after `npm ci`, split across two jobs: `gates`
runs every step except the studio check, in `CI_STEPS` order; `officina` runs
`npm run -s check -- studio --repo .` alone. A records-only `merge_group` takes
W-203's short path: `gates` skips six `CI_STEPS` and runs the studio check and
`test:record`, `officina` is unchanged, and `web-e2e` skips its build and
browser steps. A pull request runs less (Merge queue, W-205). All four jobs,
`gates`, `officina`, `web-e2e` and `certify`, are required checks (ruleset
`master_protection`); W-028 once kept `officina` out of the set while the studio
check stayed red on known officina debt, and that debt has cleared. So the
runner does not reproduce `ci`'s single sequence, and that divergence is
deliberate. `scripts/ci-workflow.test.mjs`, part of `npm test`, fails when they
drift: when `gates` differs from `CI_STEPS` minus the studio check, when
`officina` is anything but that one check, or when this section stops naming a
`CI_STEPS` command or `ci`'s usage. The workflow's own steps never run
`verify`; only the `certify` job's mint does, on a merge group, and it uploads
its receipt as a run artifact rather than committing it, so no certificate is
ever written from a runner into the repository.

A failed studio check also prints that it is officina-wide and that
`bisellium verify <opus>` is the per-opus gate. `--ref <ref>` runs the
steps in a scratch worktree of `<ref>` instead, after a from-scratch
`npm ci` there against a throwaway cache (a worktree without its own
`node_modules` would resolve `@bisellium/*` through the parent checkout and
test the wrong code), and releases the worktree afterwards. `--opus <id>`
runs `bisellium verify <id>` against the same tree once every step the loop
kept has passed, forwarding `--studio`, so the automated gates' certificates come
from `verify` itself; run it on the opus branch (D-021). `--allow-dirty` is
passed to that `verify`, and on the `--ref` path it always is, since the
scratch checkout is untouched.

`--opus` first asks `verify` which gates it will run (a plan that runs and
writes nothing). A refusal (an unknown opus, a record owned by another
branch, a dirty tree without `--allow-dirty`) ends `ci` with `verify`'s exit
code before any step. A step whose command `verify` will run is left to it,
so each check runs once: its output goes to the gate's log under `ci/`, not
the terminal. A waived gate, or a gate whose command differs from the step,
keeps its step in the loop. For this officina the handed-over steps are
`npm run -s typecheck`, `npm run -s lint` and `npm test`. A failing gate
prints its log to stderr after its `failed` line, cut to its last 200 lines
when longer. Exit codes: 0 every step passed (with `--opus`, `verify`'s own
exit code instead), 1 a step or `--ref`'s install failed, 2 usage error, no
git repo for `--ref`, or a ref that cannot be checked out; with `--opus`, the
plan's refusal code before any step.

## Merge queue

W-168. `next`'s `pr` and `merge` steps run in one of two modes, read from
master's active rules on GitHub (`gh api repos/<slug>/rules/branches/master?per_page=100`,
which the agents' non-admin token can read) and printed as the first line of
the step's result, `mode: merge-queue` or `mode: direct`.

The mode is `merge-queue` only when that read succeeds and its reply is
exactly the queue the Patron sets up: one `merge_queue` rule (squash, one PR
per group, build concurrency 1, minimum and maximum group size 1, wait time 0,
all queue entries must pass, status check timeout 120 minutes), and
required status checks `gates`, `officina`, `web-e2e` and `certify`, each
from GitHub Actions (integration 15368), with "require branches to be up to
date" off. Any other reply, a `gh` error or a malformed or truncated one
included, is `direct`, even when the setup is in fact active.

In `merge-queue` mode:

- `pr` pushes the reviewed head as it is, without a rebase, and records that
  head in the file `<git common dir>/bisellium/queue/opus%2F<id>` before the
  push.
  The gate logs and the review stay current on that head, so master moving costs
  no second gate run of the builder's `ci --opus`.
- `merge` enqueues the PR with one `gh pr merge --squash --auto
  --match-head-commit <head>`, never updates the branch and never merges
  directly. It reads the rules again just before that call and holds if they
  changed.
- The queue's merge-group run of the `certify` job (`.github/workflows/ci.yml`,
  `scripts/ci-certify.mjs`) rebases the PR head onto the group's base inside
  the job, checks its whole tree against the merge-group commit, and runs the
  existing mint (`bisellium run --sella builder --opus <id> -- true`) from
  master's tooling. GitHub merges only the commit that the required `certify`
  check passed on. The receipt is uploaded as the run's artifact; `bisellium`
  never reads it. W-243: a head not named `opus/<id>` is judged by what its
  merge group changes (`git diff --name-only --no-renames -z`, read raw): it
  passes with nothing to mint only when every path is an officina record
  (`recordOnly`), and an empty diff, any other path or a failed diff does not
  (exit 1 or 2, no mint). Source reaches master only on `opus/<id>` with its
  mint. `pr` refuses an opus branch carrying a merge commit before it pushes:
  rebase it onto master instead.

In `direct` mode `pr` and `merge` make today's writes and remote calls plus
the rules read, one local `git rev-parse` and one `lstat` of the queue file and
the `mode: direct` line. A PR whose file is present was pushed for the queue
without a rebase, so `merge` holds it (`master no longer enforces the queue`),
and a direct-mode `pr` removes the file after its push. A file that cannot be
read holds too.

The conflict path. A PR that conflicts with master (`DIRTY`) holds with
`state=CONFLICT` in queue mode, and the merge group's rebase conflict fails
`certify`. The remedy is the same in both: rebase `opus/<id>` onto master
locally and resolve it there. That fix is new source, so the builder's `ci --opus` and
review follow, exactly as before the queue.

Records-only merge groups. W-203. In a merge group, the `gates` and `web-e2e`
jobs run `scripts/ci-scope.mjs` on the group commit against the group's base
(`github.event.merge_group.base_sha`). A group whose delta touches only
`studio/`, `docs/SESSION-HANDOFF.md` and, W-209, the HTML pages directly in
`docs/design/dossier/` takes the records-only path: `gates`
runs the studio check and `test:record`, and `web-e2e` skips its build and
browser steps. Any source path, an empty delta or an unreadable comparison
takes the full path. `officina` and `certify` are unchanged, and the post-merge
`push` run still runs the full suite on master.

The pull request run. W-205. The heavy steps run once before merge, in the
`merge_group` run on the merge-group commit, not on the pull request. A pull
request still reports the four required contexts (`gates`, `officina`,
`web-e2e`, `certify`) so it can be enqueued: `gates` runs checkout, setup,
`npm ci`, typecheck and lint as an early signal; every step of `officina` and
`web-e2e` is skipped, so those jobs conclude success without work (a job
skipped by its own `if` would not count toward `next`'s `MIN_CHECKS`);
`certify` is skipped, as it has been since W-168. The `merge_group` and `push`
runs are step for step what they were. For a source change, five `gates` steps
(checkout, setup, `npm ci`, typecheck, lint) still run in both runs. For a
records-only change, three do (checkout, setup, `npm ci`), and typecheck and
lint then run on the pull request alone, because the records-only merge group
skips them. `certify` reruns the `CI_STEPS` and `verify` for an opus head as before. A pull
request that is never enqueued loses its run on its head: for a source change,
the format check, the tests, the read guard, the sample-officina check, the
studio check, and the build and served E2E; for a records-only change, the
studio check and `test:record`. It keeps typecheck and lint. It makes no merge
result and cannot reach master, no certificate reads that run, and for an opus
head the builder's `ci --opus` already ran `CI_STEPS` and `verify` on its head (its gate logs prove only the automated
gates: the audit, `format:check`, both officina checks and the red replays are first proven by the merge queue's
`certify` and `gates` jobs, and a failure there drops the PR from the queue). The
`push` run is unchanged: for either change kind it runs the full `gates` and
`web-e2e` paths and `officina`, and `certify` is skipped. This holds only while ruleset `master_protection`
requires the merge queue: without it GitHub would merge on the light pull
request checks, so removing the queue reverts these conditions in the same
change.

