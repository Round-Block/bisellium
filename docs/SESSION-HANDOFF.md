---
kind: guide
owner: producer
tier: reference
review: 2026-12-01
kill: when every item here is enforced by a lex clause or a check rule
---

# Session handoff

What a fresh orchestrating session must know that is not derivable from the
code. Read after CLAUDE.md. Keep this file short; move anything durable into a
lex, a decision, or a check rule and delete it here.

## The Patron's standing instructions

- **Fewer words.** Lead with the proposal or the outcome; drop rationale that
  does not change a decision.
- **Not epoch0-centric.** epoch0 (`~/projects/epoch0`, WSL) is a reference
  instance only. Never modify it; never frame designs around it.
- **Keep going unless a judgment is needed.** Mechanical findings are fixed and
  re-verified without asking; judgment (names, scope, lex boundaries, what a
  collegium may decide, licences) goes to the Patron as a petitio. This is the
  no-mistakes auto-fix-versus-escalate split, one level up.
- **Update the progress page and dossier masthead at every checkpoint**
  (after each cascade and each cleanup commit): a row on the Progress page
  + the dossier's masthead status line. Source: `docs/design/dossier/`
  (`build.sh` builds both pages; republish each with the Artifact tool at
  the links below).
- **Never relay a mid-turn Patron message into a running workflow**; answer
  between cascades. Agents given a relayed question refused their build (4b).
- Test-first with a recorded red; mechanical work is a script; evidence is
  produced, never backfilled. These are in the leges; they bind here too.

## Artifacts (Patron-visible)

- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
  (rebuild from `docs/design/dossier/head.html` + `body.html`; patch `body.html`
  with a script, never by hand-editing the built page).
- Design direction (what web I builds to; source docs/design/DIRECTION.md,
  rendered by build-arch.mjs via build.sh):
  https://claude.ai/artifact/J6LGxy2T7V7M1x3F3CrT15
- Architecture (Mermaid system map, rendered from docs/ARCHITECTURE.md by
  docs/design/dossier/build-arch.mjs via build.sh):
  https://claude.ai/artifact/WUBAJ9JceMAX5qEhgjoyuN — republish after any
  cascade that touched ARCHITECTURE.md (the design lex obliges the update).
- Progress log (per-cascade rows, split out of the dossier 2026-09-19):
  https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e — source
  `docs/design/dossier/progress-body.html`, built by the same `build.sh`.
  Checkpoints now update the PROGRESS page's row + the dossier masthead.
- UI design canvas (six screens, Patron-editable; check for external saves
  before republishing): https://claude.ai/code/artifact/a2f1b828-4648-423b-bda8-f0bc2c77fb7f
  — sources in `docs/design/canvas/` (`*.dc.html`, `canvas.json`). Re-seeding
  needs the Claude Code `design` skill's `seed-canvas.mjs` (node in WSL only).
- Design tokens: ink #16211E, accent #0B6E5F, amber #B7791F = waiting on a human
  only, ok #2E9E64, bad #C64A3A; Bricolage Grotesque / Instrument Sans /
  IBM Plex Mono.

## Environment facts

- Containment (Patron, 2026-09-19): `.claude/settings.local.json` carries the
  Bash sandbox config (bubblewrap; writes confined to repo + evidence dir,
  epoch0 and /mnt/c deny-listed) — it hard-fails until
  `sudo apt-get install bubblewrap socat` has been run in the distro.
  `.devcontainer/` is Anthropic's reference config on node:25 with the egress
  firewall, for fully contained cascade runs. Under the sandbox the tsx CLI
  cannot run (its IPC unix-socket listen is denied; docker.sock exists in this
  distro so sockets stay blocked) — the bisellium bin and every package.json
  script use `node --import tsx` instead; agents should too, never `npx tsx`.
  The sandbox also masks shell/tool config paths in the repo root as /dev/null
  devices; both ignore files carry the block so verify stays clean-tree. Repo backup: bundle at
  C:\Users\edene\bisellium-backups\; private remote github.com/edckt/bisellium (origin). Sandbox deps
  (bubblewrap, socat) installed 2026-09-19.

- Node, npm, git, `claude`, `codex`, Go, treehouse, no-mistakes exist only inside
  WSL. From a Windows-hosted session run `wsl -e bash -lc "cd ~/projects/bisellium && …"`.
  From a session whose project directory is this repo, run commands directly.
- Commit with `-c user.name=edckt -c user.email=edene.chankt@gmail.com` and the
  trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The Workflow tool is allowed without a prompt (`.claude/settings.json`).
- Codex weekly quota was exhausted until 2026-09-21; quota-axi cannot read the
  Claude Code login (`auth_required`), so Claude posture is observed/unknown.
- Two officinae share this repo (`studio/`, `examples/sample-studio`); each lists
  the other in `source_excludes`.

## Where things stand (2026-09-20, cascade 22)

Cascades 1–21 are in the dossier progress log. The branch → PR → QA → merge
flow (D-015) has now landed six PRs. Read the review logs in `studio/ci/`
before touching any of this work; they are far more precise than this
summary.

### The flow, as actually operated

`bisellium branch` → builder in an isolated worktree → commit → rebase onto
master → **lifecycle before the PR** (greenlight, ready, verify on the
branch) → push → `gh pr create` → `censor` reviews → fix rounds → `done` on
the branch → `gh pr merge --rebase`.

Every step has now been executed at least once for real. Deviating from it
has cost a round each time.

### Open PRs

None open — every PR to date has merged.

| PR | Opus | State |
|----|------|-------|
| [#2](https://github.com/edckt/bisellium/pull/2) | W-026 | MERGED (round 8) |
| [#3](https://github.com/edckt/bisellium/pull/3) | W-030 | MERGED (round 3) |
| [#4](https://github.com/edckt/bisellium/pull/4) | W-031 | MERGED (rebase + re-verify on the post-W-037 tree) |
| [#7](https://github.com/edckt/bisellium/pull/7) | W-036 | MERGED |
| [#12](https://github.com/edckt/bisellium/pull/12) | W-037 | MERGED (round 2; retracted round 1's tree-hash false positive) |
| [#13](https://github.com/edckt/bisellium/pull/13) | gap filings | MERGED (W-038–041, D-016, P-010) |
| [#1](https://github.com/edckt/bisellium/pull/1) | — | closed, superseded by #3 |

W-035 (improvement loop) is **building** — two Sonnet builders in parallel
worktrees. Three petitiones await the Patron: **P-008** (`process.cascade`
vs the QA lex), **P-009** (QA-lex amendment, architect-corrected wording),
**P-010** (production-lex amendment: rank by long-term gain, a found gap
owes a lesson or opus).

### W-031 and W-030 — resolved

Both merged. Round-by-round findings (the spec-gate backfill scare, the
`--allow-dirty` gap, the drift-guard pin) are recorded in
`studio/ci/W-031-review-3.log` and `studio/ci/W-030-review-3.log` — not
repeated here.

### New opera opened, none started

- **W-032** — the PR gate. `gh pr create` bypasses the CLI, so unlike
  `close` nothing can refuse an ungated opus. Behaviour 5 is pointed
  deliberately: a refusal must hold on *every* run.
- **W-033** — bookkeeping provenance. Three blocking findings in one day
  from the same class; poses the question rather than answering it.
  **Architect's call before any code.**
- **W-034** — `done` cannot honour a Patron waiver, and writes to whichever
  ref it is run from. Defect 1 is independent; **defect 2 is blocked on
  W-033.**

### Decisions

- **D-014 amended twice.** Opus-tier roles on `claude-opus-5`; the
  cross-generation clause struck. **One review gate**: `censor`, Opus 5,
  boots as `qa-lead`, read-only by design. `reviewer46` deleted.
- **D-015** — integration strategy is configuration. Its original claim
  that rebase forces re-verification "for free" was **disproved** and is
  struck with the finding cited; `merge` now does the check itself.
- **D-016** — the CLI wraps a git operation only when refusing it is the
  point; `branch`/`merge`/`close`/`pr` stay in, raw git/gh stays out.
  `kill_when` names W-033 as the trigger to revisit.

### Why W-026 took eight rounds

Worth reading before assuming a fix round is cheap.

1. **A brief caused an entire round.** The absence rule was added as "free
   defence in depth" on the orchestrator's instruction. It was a new
   refusal path that rejected legitimate waived gates with no remedy.
   Round 7 removed it.
2. **Nobody did an inventory.** Round 5 established the rule — everything
   `merge` compares comes from the branch's ref. The right next move was to
   enumerate every read in the compare path. Instead round 5 fixed the opus
   record, round 6 found `state` in the same read, round 7 found the
   exclude set. One bug, three locations, three rounds. **When a review
   establishes a class, enumerate the class.**
3. **Tests were written where the bug cannot appear.** Every certificate
   test but one put `studio/` outside the repo, where branch and trunk
   copies collapse into one file. Same shape as W-030's truncation test
   (toy fixture lex) and W-031's certificate tests. Three opera, three
   authors, one blind spot.
4. The work genuinely sits where git refs, filesystem state and the
   evidence model intersect.

The rounds were not waste. Merging at round 3 would have shipped a `merge`
that silently landed on whatever branch was checked out and reported
success against master.

### Traps that cost real time

- **A fresh worktree resolves `@bisellium/*` through the parent checkout.**
  Edits to `packages/` are then invisible to `node --import tsx` and tests
  pass against the wrong source. Caught three builders and a reviewer; one
  misdiagnosed it as `TS2339`. **Always `readlink -f
  node_modules/@bisellium/shim` before trusting a result.** `npm install`
  needs `--cache "$TMPDIR/..."`; `~/.npm/_cacache` is read-only here.
- **Worktree isolation does not isolate `$TMPDIR`.** A builder lost work to
  a collision on a shared `$TMPDIR/mut`. Use uniquely-named scratch paths.
- **Every branch conflicts on its own opus record.** Reviews write to the
  reviewer's checkout, lifecycle commands to the branch. Recipe that worked
  three times: take master's copy (`git checkout --ours` during rebase),
  then re-run greenlight/ready/verify/handoff on the branch through the
  CLI. Never hand-edit front matter. W-033 exists to end this.
- **Run `bisellium` with no arguments for flag shapes.** Three reviewers
  had to correct invocations written from memory, and one wrote a real gate
  citing a brief as its evidence while probing for syntax.

### GitHub ruleset `master_protection` (Patron, 2026-09-20)

Active on `master`: no deletion, no force-push, **all changes via PR**
(required approvals set to 0 after the initial 1 deadlocked — authors
cannot approve their own PRs and every PR here is authored by `edckt`).
Two more rules were added after this section was first written:
**code_scanning** (CodeQL, errors threshold, high+ security alerts) and
**code_quality** (errors severity). No required status checks (so a red
CI check does not block merges). Consequences:

- **Direct pushes to master are rejected — verified empirically.** A real
  push to master was rejected with "push declined due to repository rule
  violations"; that rejected commit became this very branch. All
  bookkeeping — verdicts, petitiones, checkpoints, handoffs — now rides
  short-lived branches merged via `gh pr merge --rebase`. This answers
  W-033's provenance question by force: everything lands via branches.
- The ruleset is the mechanical twin of D-015's `pr.required: true` —
  GitHub now refuses what the officina config already stopped short of.
- **The repo went public 2026-09-20.** GitHub Actions is now free (the CI
  billing block is gone); CodeQL default setup was enabled and its first
  analysis run started. A history scan for secrets ran before/at
  publication: `.env` was never committed, no key-shaped strings anywhere
  in history — clean.
- **CodeQL's first analysis found a real high-severity alert**: polynomial
  ReDoS in `packages/shim/src/sourceTree.ts`. Filed and fixed as **W-037**
  (regex-free `normalizeExclude`); merged PR #12, alert cleared. It had
  blocked PR #4's merge under the `code_scanning` gate; #4 (W-031) is now
  merged too.
- **The API now reports the repo under the `Round-Block` org**
  (`Round-Block/bisellium`). The local remote still says `edckt/bisellium`
  and works via redirect — flagged for a deliberate remote update, not
  yet done.

### CI

`.github/workflows/ci.yml` **never executed while the repo was private** —
GitHub Actions was billing-blocked, so every run died in ~3s with an empty
`steps: []` and an annotation visible only through the API; the red check
on every PR from that period means nothing. **As of 2026-09-20 the repo is
public, Actions is free, and CodeQL default setup is enabled** — the first
real runs executed. CI's first real run failed honestly on two counts:
`format:check` (a file committed unformatted with W-030, fixed as
**W-036**, merged as PR #7 after a one-round pass) and `check studio`
(real officina debt, stays red until it burns down — not a CI defect).
The architect separately proved `npm test` never failed on any runner.
The red-check-means-nothing caveat no longer applies to new runs.

`bisellium ci` (W-031, PR #4) is the local replacement. Its first real run
found the repo had been failing its own `format:check` since `6e84979`.

### Backlog

1. **W-035** in flight (two Sonnet builders, parallel worktrees) → censor →
   merge.
2. Then **W-033** (architect's decision on bookkeeping provenance; blocks
   W-034's defect 2), per the architect's ranking: W-033 → W-041 → W-039 →
   W-038 → W-032 → W-040 → W-028 → prettierignore.
3. **W-034** — `done` cannot honour a Patron waiver, and writes to whichever
   ref it is run from. Defect 1 is independent; defect 2 is blocked on W-033.
4. **Settings screen** (Patron): surface officina and harness config.
   UI/UX is Patron-only; needs design input before a brief.
5. Web II (Board screen, drawer, SSE live) — needs Patron UI/arch input.
6. **CLI/process gaps** — filed as **W-038** (petitio command), **W-039**
   (guest-sella red rule), **W-040** (gate correction, append-only),
   **W-041** (generated backlog page); **D-016** records why git stays raw
   where the CLI has nothing to refuse. The prose that used to describe
   these gaps here is rot — read those records instead.
7. `bisellium ci` appears in no documentation. CLAUDE.md is generated from
   `packages/cli/src/instructions.template.md` — edit the template.
8. Old item, still open: `branch.ts:172` hardcoded "into master" — fixed
   in W-026; a repo on `main` merges into main and reports master.
9. **`run --opus` → `merge` is a broken chain** (found by dogfooding).
   `run --opus W-026` forks the worktree from `opus/W-026`'s commit
   correctly, then puts the work on `bisellium/<sella>/<n>`, while
   `mergeOpusBranch` only ever reads `opus/<id>`. A builder's commits never
   reach the branch `merge` merges, and nothing moves one to the other.
10. `run --reclaim` and `prune` only know `.bisellium/worktrees/`. The
    harness's own worktrees under `.claude/worktrees/` are invisible to
    them, and several stale ones are on disk. `git worktree prune`
    deregisters them but cannot unlink the admin dirs under the sandbox
    ("Device or resource busy") — needs a shell outside it.

### Also on disk

- `docs/research/jev-typesafe-ai.md` — non-autoregressive model for
  structured decisions; possible fit for the `talk`/posture path.
- `.claude/.claude/` holds `/dev/null` character devices, a sandbox
  artifact of config-path masking. Not real files; do not commit.

## Naming

Roman civic/guild vocabulary; see GLOSSARY.md. Wire attributes (`workflow.*`)
and lifecycle state ids stay English. Earlier working names (Gantry, Backlot,
Atrium) appear only in history.
