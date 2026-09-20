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

## Where things stand (2026-09-20, first PR merged)

Cascades 1–17 are in the dossier progress log. The session of 2026-09-19/20
moved the project onto D-015's branch → PR → QA → merge flow and put four
opera through it. Read the four review logs named below before touching any
of this work; they are far more precise than this summary.

### The flow, as actually operated

`bisellium branch` → builder in an isolated worktree → commit → rebase onto
master → **lifecycle before the PR** (greenlight, ready, verify on the
branch) → push → `gh pr create` → `censor` reviews → fix rounds → `done` on
the branch → `gh pr merge --rebase`.

Every step has now been executed at least once for real. Deviating from it
has cost a round each time.

### Open PRs

| PR | Opus | State |
|----|------|-------|
| [#2](https://github.com/edckt/bisellium/pull/2) | W-026 | **MERGED** at round 8 |
| [#3](https://github.com/edckt/bisellium/pull/3) | W-030 | round 2 FAIL — fix pushed, round 3 not dispatched |
| [#4](https://github.com/edckt/bisellium/pull/4) | W-031 | round 2 FAIL — **not yet fixed** |
| [#1](https://github.com/edckt/bisellium/pull/1) | — | closed, superseded by #3 |

### What W-031 owes (PR #4, round 2, `ci/W-031-review-2.log`)

1. **The spec gate was re-signed, and that is backfilled evidence.** The
   orchestrating session changed `spec: { sella: qa-lead }` to `eng-lead`
   one minute after the fix commit, to stop `process.cascade` firing, with
   a commit message naming the rule as the reason. Nothing shows an
   eng-lead context ever read that brief. Clear it by *producing* the
   eng-lead gate, or restore `qa-lead` and file a petitio — the QA lex has
   the Censor drive the first hour and close the last, so qa-lead on both
   spec and review may be the designed shape and `process.cascade` may be
   the thing that is wrong. **Do not re-attribute a signature to satisfy a
   rule.**
2. `--allow-dirty`'s split is correct and **completely unenforced** — both
   ways of undoing it survive the full 1066-assertion suite.
3. `packages/cli/src/main.ts:60`'s usage line lacks `--allow-dirty`, which
   `ci.ts`'s own USAGE has. One line, and it is the drift class behaviour 7
   guards, one layer up.

### What W-030 owes (PR #3, round 2, `ci/W-030-review-2.log`)

Round 2's blocking finding (the drift guard could be made to scan almost
nothing) is fixed and pushed — the count is pinned at 30. Round 3 has not
been dispatched. Advisories A2/A3 were folded in; the opus record conflict
and the missing handoff were reconciled.

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

### CI

`.github/workflows/ci.yml` **has never executed once** — GitHub Actions is
billing-blocked on this account, so every run dies in ~3s with an empty
`steps: []` and an annotation visible only through the API. **The red check
on every PR means nothing.** Unblocking it is the Patron's, in GitHub's
Billing & plans.

`bisellium ci` (W-031, PR #4) is the local replacement. Its first real run
found the repo had been failing its own `format:check` since `6e84979`.

### Backlog

1. W-031 round-2 fixes, then round 3.
2. W-030 round 3 (fix already pushed).
3. W-033 — architect's decision, blocks W-034's defect 2.
4. W-032 — the PR gate.
5. **Settings screen** (Patron): surface officina and harness config.
   UI/UX is Patron-only; needs design input before a brief.
6. Web II (Board screen, drawer, SSE live) — needs Patron UI/arch input.
7. `bisellium ci` appears in no documentation. CLAUDE.md is generated from
   `packages/cli/src/instructions.template.md` — edit the template.
8. Old item, still open: `branch.ts:172` hardcoded "into master" — **fixed**
   in W-026; this line retained only to note it landed. A repo on `main` now
     repo on `main` merges into main and reports master — same family as
   reports `main`.
9. **`run --opus` → `merge` is a broken chain** (found by dogfooding).
   `run --opus W-026` forks the worktree from `opus/W-026`'s commit
   correctly, then puts the work on `bisellium/<sella>/<n>`, while
   `mergeOpusBranch` only ever reads `opus/<id>`. A builder's commits never
   reach the branch `merge` merges, and nothing moves one to the other.
   This is why W-026's behaviour 7 "has no test coverage" mattered — the
   wiring was verified by inspection, never run. Round 5 noted behaviour
   7's test asserts where the worktree forked *from* and nothing about
   where work lands, and its `finally` deletes the very branch it lands on.
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
