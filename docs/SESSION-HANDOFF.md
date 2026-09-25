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
- Backlog (W-041; generated from the officina's own front matter — opera,
  petitiones, decisions, never from prose; source
  `docs/design/dossier/backlog-body.html`, built into
  `bisellium-backlog.html` by the same `build.sh`):
  https://claude.ai/artifact/BaVL3xfRg2gbERoLukDLqV — republish at every
  checkpoint. The page links, and never writes, the current ranking:
  `studio/acta/2026-09-24-ranking.md` is the source of record for order.

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
  trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` — or
  whichever session model actually ran (Fable 5 or Opus 5.5).
- The Workflow tool is allowed without a prompt (`.claude/settings.json`).
- **Codex operational** (cascade 24): sandbox allows `~/.codex` writes +
  OpenAI domains in `.claude/settings.local.json`; `codex exec -c
  model_provider=openai -m gpt-5.6-luna` works — provider is OpenAI direct,
  not tokenharbor (tokenharbor is key storage convenience only). Luna does
  bounded clerk-shaped work; review still gates through the Opus-tier censor
  (D-014).
- Two officinae share this repo (`studio/`, `examples/sample-studio`); each lists
  the other in `source_excludes`.

## Where things stand (2026-09-25, cascade 34 in flight)

Cascades 1–32 are in the dossier progress log. PRs through #71 are merged,
plus #77 (spec). Read the review logs in `studio/ci/` before touching any
of this work.

**Cascade 34 (2026-09-25, in flight): W-062 specced through four Sol
rounds; the console diagnosed.** **PR #77 MERGED** (spec-only): the
W-062 brief at revision 4 — Sol's red-team went AMEND-FIRST → 7 LANDS
closed → 2 narrow finds closed → finding 14 REFUTED by measurement
(YAML 1.2: `<<` is an ordinary key; the directive route can't reach
`readFront`). The design change that mattered: re-pointing `spec:` on
an active opus could erase `opus.red_evidence` blocks behind a stale
passed gate — closed as an equality condition in `state.building.spec`
(catches every writer AND hand edits). Also on #77: the 2026-09-25
ranking acta (29 opera; W-060 recovered — `classifyAddressedTarget`
falls through to `rule`; top five W-072, W-059, W-062, W-060, W-057),
W-072 greenlit (standing continue), W-076/W-077 filed. **The live
console's four "anomalies" diagnosed**: 34 pending = real due debt
(29 traditiones + 4 dailies + 1 aerarium); 5 blocking/73 advisory =
STALE health.json from the 09-23 tick (tick re-run; now 0/126 — the
as-of stamp is W-077); empty System status = no W39 aerarium (Patron's
desk); inbox no-context = P-012 has no subject key, raw body-line
fallback (W-076). **W-062 MERGED** (PR #80,
round-1 PASS, zero blocking — the amend verb; the censor ran twelve
mutations, ten bite; advisories filed as W-079 (two unpinned guards,
test-only) and W-080 (`spec-gate×self-signed`, rule candidate at
`process.ts:245`); the `--spec`-accepts-a-directory hole is
pre-existing in `ready` and goes to W-040's successor). **W-064**:
round-1 FAIL (8 blocking), all fixed with mutation-kill proofs,
Terra-censused clean; **round 2 held at the red gate for P-013** —
D-024's kill arm fired on the builder's skeleton re-record, the
Patron must rule (new waiver decision, or refuse + remedy). Worktree
`.worktrees/W-064` alive, branch at 7ea3413. Also filed: P-013,
W-078 (human-kind probatio missing from studio's manifest — censor
A5, architect's call). CLI gap recorded: `new --kind petitio` writes
a mis-shaped opus. Patron's desk: P-013, P-012, the W39 aerarium,
and the Board's three visual checks (390px composition, raw-ISO
liveness label, empty drawer record section).

**Cascade 33 (2026-09-25): the probe arc completes.** **W-069 MERGED**
(PR #68, 2 rounds — the battery ran live: five codex models proven
available, the control rule proved on a real 401; the stranding class
closed BY CONSTRUCTION, preservation proven on the live record). **W-071
MERGED** (PR #71, 2 rounds — the cadence; pause/L0 gates measured at
zero vendor spawns; the attended acceptance passed fully). **D-024
decreed** (the Patron's waiver of W-071's red-gate ORDER — the builder's
implement-stub-record-restore sequence ruled backfill-in-mechanism;
the act recorded plainly, candour credited, kill_when = P-012).
**P-012 filed, `needs_you`**: bisellium red records a working-tree
identity; the tree-ancestry proposal REFUTED by this case (the
backfilled reds passed it). **retro-32 MERGED** (PR #69: six lesson
classes, the first complete D-013 usage section since the rule existed;
W-072 filed — the vendor-spend sentinel, prototype = the censor's
PATH-shadow runs). Orchestrator's own recorded class: two
cleanup-outside-the-merge-gate slips (closed PRs 68/70); the fix is the
zero-pending gated merge script — use it for every merge. **Claude auth
rhythm**: access tokens age out between the Patron's interactive
sessions; headless -p does NOT refresh; `auth status` stays truthfully
positive; the control rule absorbs it ($0). Awaiting the Patron:
**P-012's grant**, the W39 aerarium (`aerarium.missing` is live), and
the old tree-ancestry petitio's formal closure (fold into P-012's
answer). Queue: **W-064** (Board) → W-070 (remote/tailnet) on UI;
W-072, W-059, W-066, W-068, W-038, W-052 non-UI. Retro-33 owes: C3
true-by-construction (recurrent), C4 network-dependent probatio, the
watcher-reaping class, the orchestrator's gate class.

**Cascade 32 (2026-09-24/25): the console became an actor.** **W-067
MERGED** (PR #64, round-1 pass — the write path: origin tuple, pasted
token, ok:false contract, required web-e2e CI gate; the Inbox answer
button lives; reds accepted on tree-hash ancestry — a red-ordering CHECK
RULE is raised as a petitio, awaiting the Patron's grant). **W-065
MERGED** (PR #65, 2 rounds — the decree surface: Seats & Delegation, all
five Patron decrees shipped as decreed; review logs
`studio/ci/W-065-review-{1,2}.log` — round 1 measured a phantom index row
from the spec's own event-reuse instruction; the architect overturned one
censor finding with a counter-fixture). **W-070 filed + D-023 amended**
(remote via Tailscale Serve, no public port, PWA shell — after W-067).
Carried advisories for the next UI round: the dropped-emit regression
guard (one line in behaviour 7's home), the `listingTtlMs` seam for the
5.2s TTL sleep in server.test.ts, censor F-2's `.spec.ts` census
exclusion gap, F-3's fixture fragility (own opus candidate). **O-14
retracted**: claude auth measured working (a transient access-token
expiry; `auth status` true was correct). UI track: **W-064** (Board)
next, then W-070; **W-069** (probe battery) unblocked and feeds the
Seats dropdown real data. Non-UI queue: W-038, W-052, W-059, W-066,
W-068.

**Cascade 31 (2026-09-24): W-046 MERGED** (PR #61, 3 rounds, each catching
something real — review logs `studio/ci/W-046-review-{1,2,3}.log`; the
opus's lesson is in its brief: a claim enters a shipped document only with
an assertion that fails when it stops being true). **W-066 filed** (the
smoke's pre-existing claude-resume defect). **The Web II stack**: D-022
(ui-lead seat — gpt-6-astra, medium effort; dispatch carries
`-c model_reasoning_effort=medium`), D-023 (munera/tiers as records,
PATRON-5 same-origin write auth, the dropdown decree, dynamic
probe-verified models), W-067 carved from W-065 (write path vs decree
surface; the shipped Inbox answer button is DEAD in the served console —
W-067 revives it), W-064/W-065/W-067 greenlit, W-068 + W-069 filed. The
**Seats & Delegation preview artifact**
(https://claude.ai/artifact/1W7rzHu4dD2iGnTHmrqxhP) is the Patron's live
decree surface — republish it whenever UI specs/builds move (standing
instruction, in memory and here). **The operator's claude OAuth expired
mid-session (W-046 O-14)** — live claude turns are inconclusive until
re-auth. Build order: W-067 (building) → W-065 → W-064; W-069 after
W-046's machinery, W-068 anytime. Next non-UI per ranking: W-038, W-052.

**Cascade 30 (2026-09-24): W-047 MERGED** (PR #51, 2 rounds) — the
traversal class closed once: contract table, collision sentinels, 33-mutant
harness (28/5), AST census pinning all 29 id-to-path joins with signed
dispositions. Round 1's F-1 (an unspecced `endsWith("Id")` filter narrowed
the census; 17 sites dropped) was upheld by the architect, spelling filters
are now prohibited in the brief, and the widened scan surfaced a **ninth**
raw-join bypass (`tick.ts:writeDailyActum`) — W-059's scope is nine sites.
Two mid-build brief amendments, both signed with provenance; the censor
ruled the builder's red re-record honest (review logs:
`studio/ci/W-047-review-{1,2}.log`). **Herdr landscape memo MERGED** (PR
#52, `docs/research/herdr-landscape.md`, Sol): watch the platform, adapt
the multiplexer's socket API as a W-046 transport experiment, integrate
neither; fleet-view UI named as the console's real gap (human-only).
**W-060 filed** (retro's silent `rule` fallback — a typo'd `addressed_by`
reads as addressed). Claude spend this cascade ~890k (builder ~490k,
architect ~210k, censor ~190k) — the code-opus cost floor under
slow-serial; codex lanes carried build-trial, red-team, memo, pre-reviews
free. Next per the ranking acta: **W-046** (the memo's adapter envelope +
codex transport lessons are its spec inputs), then W-038, W-052.

**Cascade 29 (2026-09-24): two round-1 passes.** **W-039 MERGED** (PR #47)
— `red` refuses a fallback sella (exit 2 before any write), nine-row
matrix, `opus.red_sella` advisory (rule 127). Terra's 2 FALSE claims were
both verification-method artifacts, overturned by the censor (overlay
method for red repro; call-site classification for `--sella` coverage) —
the pre-review layer filters, the censor decides. **W-050 MERGED** (PR
#48) — **D-020's codex-build trial PASSED in 1 round of a ≤2 benchmark**:
gpt-5.6-sol (seat `builder-sol`) built the docs-only opus end-to-end with
honest staged reds and a correct stop at a D-021 refusal; censor found
zero build defects (only cosmetic commit trailers, traced to the
orchestrator's dispatch text — fix the dispatch template next codex
build). Review logs: `studio/ci/W-039-review-1.log`,
`studio/ci/W-050-review-1.log` (the latter's O1: a builder-reported
provenance transcript can't discriminate renderer output from a matching
hand edit — brief-design gap for the retro, not a build defect). Next per
the ranking acta: **W-047**, then W-046, W-038, W-052.

**Cascade 25 (2026-09-23/24):** D-021 ruled (one writer per opus record —
the Opus architect and gpt-6-astra converged independently; Astra's take in
`docs/research/w033-provenance-astra.md`). **W-033 built and MERGED** (PR
#32, round-2 pass after a fail-open-on-git-errors round 1 — the guard now
fails closed; the censor recorded both verdicts from the branch checkout
because the guard under review refused it anywhere else). The manual
reconcile recipe is dead; no `reconcile` command will exist (D-016 clause
settled). **W-044 MERGED** (PR #31) after FOUR rounds — untested traversal
guards, multi-value flag widening, a copied-slot regression, and a
mislabelled red, each caught and fixed red-first; the attended smoke's
deny-half was Patron-attended and accepted; rounds 3–4 ran the new
Terra-verified pipeline and the censor's cost fell 117k→92k→84k tokens.
Round-4 advisories A1/A2 (test hardening: sysprompt temp-dir pin, fixed
fake session id) and the smoke's 127 allow-half residue fold into
**W-049** (env base-URL leak, filed) — its spec should take all three. **D-020 amended twice** (gpt-6-astra escalation tier;
Terra pre-review verification + Sol brief red-team as standing pipeline
slots — Patron decrees). Patron-interface & cost-model direction captured
in `docs/design/DIRECTION.md`. Tokenharbor is fully dormant: codex default
provider flipped to `openai`, zshrc auto-sourcing removed by the Patron,
no repo references. **Claude spend was heavy (~1.5M subagent tokens in a
day; throttle order stands)** — shift bounded work to codex tiers per
D-020; the W-048 codex-build trial (one opus, Sonnet→Sol, censor gate
unchanged as the benchmark) is proposed, not yet decreed.

**Resume order:** see the [backlog page](design/dossier/bisellium-backlog.html)
(W-041) and the source-of-record
[ranking acta](../studio/acta/2026-09-24-ranking.md). W-046 carries the codex transport lessons: stdin closed
with </dev/null, output non-empty check, no nested sandbox, no -C after
exec, full capture never tailed. The codex-build trial was decreed into
D-020 and executed as W-050 — PASSED (see cascade 29). Mode: slow-serial —
one Claude stream, tokens tallied per dispatch and reported; codex lanes
free in parallel.

### The flow, as actually operated

`bisellium branch` → builder in an isolated worktree → commit → rebase onto
master → **lifecycle before the PR** (greenlight, ready, verify on the
branch) → push → `gh pr create` → `censor` reviews → fix rounds → `done` on
the branch → `gh pr merge --rebase`.

Every step has now been executed at least once for real. Deviating from it
has cost a round each time.

### Open PRs

None. PRs #1–#20 all merged or closed. Cascade 23 (PR #20) executed the
Patron's decrees of 2026-09-20: **P-008 answered (b)** — specs signed by
the architect, `process.cascade` stands, QA lex first-hour clause
amended; **P-009 and P-010 accepted** — their lex amendments landed
verbatim in qa.md and production.md with §9 rows; **D-017** (W-023/W-027
evidence accepted as historical, kill_when resurrection) and **D-018**
(pre-W-026 identity-less gates/models grandfathered) written; **W-022
finished** after a genuine round-3 PASS (the censor mutation-tested all
six reds; `done` initially refused on the failed round-2 gate — the CLI
failed closed, round 3 cleared it); **W-028's `close` refused** (no
abandon verb — see W-042); `traditio.stage` swept 10→0 via the kept
script `scripts/sweep-traditio-stage.mjs`; three lesson classes stamped
to genuine pre-existing decisions (L-009→D-005, L-013→D-009,
L-014→D-010); first retro with the `## Addressed` section
(`studio/acta/2026-09-20-retro-23.md`).

W-035 (improvement loop) merged as PR #17 after two rounds — round 1's
path traversal (the very class L-022 stamps) and the `link.dead`
registry gap, both fixed red-first; its drift guard made its first live
catch during the final rebase (`process.history` unregistered). Review
logs: `studio/ci/W-035-review-{1,2}.log`, `cascade-23-cleanup-review.log`,
`W-022-review-3.log`.

**Cascade 24 closed the officina-debt era.** W-042 (halt verb) shipped as
PR #25 after 2 rounds — decision-anchored, no new state id, probationes
survive; round 1 failed on untested traversal guards (mutation-survivable),
fixed red-first. Class finding filed as **W-047** (safeItemPath contract
tests).

**The halts executed** (PR #28): W-023/W-027 halted on **D-017**, W-028
abandoned on **D-019** (`close` refused as designed — abandonment recorded,
not closed). `check studio`: **PASS, 0 blocking, 75 advisory — first ever**.
The `officina` job ran green and is now a **required status check**
alongside `gates` (ruleset 23720000). Full GitHub CI reliance achieved; the
interim "orchestrator reads around known-red officina" practice is retired.

**D-014 amended again** (Patron, PR #27): the opus-tier pin reads as the
TIER, not a frozen model id — the censor honestly recorded
`claude-opus-5-5`, surfacing model drift instead of hiding it.

**Research** (PR #23): Laya reviewed, not integrated (memo in
`docs/research/`); Mast persistence audit filed **W-044** (talk profile is
a permission boundary — SECURITY: the read-only profile admits
`Bash(bisellium *)`, reaching arbitrary execution) and **W-045** (record
resilience); **W-046** (provider portability) filed from the landscape doc;
**P-011** decreed (c) — deferred until first playable is scheduled.

**Resume point for the next funded session (in order):**

1. See the [backlog page](design/dossier/bisellium-backlog.html) and the
   [ranking acta](../studio/acta/2026-09-24-ranking.md).
2. Lesson/rule candidate: W-042 round 2's advisory A-1 found 12 scratch-path
   reds sharing one class — worth a stamped `lesson.recurrent` or check
   rule, not left as a one-off advisory.
3. Progress page still owes rows for cascades 23–24; masthead updated this
   checkpoint.

**Dropped from this handoff, not filed (Patron's call, W-041 PR):** the
Settings screen (surface officina and harness config) and Web II (Board
screen, drawer, live SSE) are UI/UX, decided by humans only — not opera,
and not represented on the generated backlog page. See the ranking acta's
"Not ranked" section. They get filed when the Patron schedules them.

**Patron's standing order (2026-09-20): before starting any task, judge
whether the credit balance can finish it; if not, pause and write the
handover instead.** Two dispatches died mid-flight on spend limits this
session (a builder and a censor); a dead censor left stray verify
bookkeeping that the re-run had to revert. Weekly limit resets Wed 2pm
(Asia/Singapore). Also still registered: scratch worktree
`/tmp/claude-1000/w037r2-rep/verdict` (stale, W-037 already landed —
safe to `git worktree remove --force` from an unsandboxed shell).

### W-031 and W-030 — resolved

Both merged. Round-by-round findings (the spec-gate backfill scare, the
`--allow-dirty` gap, the drift-guard pin) are recorded in
`studio/ci/W-031-review-3.log` and `studio/ci/W-030-review-3.log` — not
repeated here.

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
**code_quality** (errors severity). **As of 2026-09-20 (Patron decree)
`gates` is a required status check** with the strict up-to-date policy —
PRs must rebase onto current master (`gh pr update-branch --rebase`) and
pass `gates` before merging; GitHub now enforces what was previously
orchestrator discipline. **As of cascade 24 the `officina` job is also
required** — the stale-opera debt cleared via the halt verb (D-017/D-019),
and the job was flipped to required the same way as `gates` (`gh api` PUT
on ruleset 23720000). Consequences:

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

**CI split + hardening (2026-09-20, Patron decree "make the gate live"):**
the workflow is two jobs — `gates` (required: typecheck, lint,
format:check, test, sample-studio check — `bisellium ci` minus the studio
debt; the drift guard `scripts/ci-workflow.test.mjs` asserts the parity
gap explicitly) and `officina` (`check studio` alone — red until cascade
24, now green and required too, see "Where things stand"). Same day:
`GITHUB_TOKEN` scoped `contents: read` (PR #16, cleared CodeQL actions
alert 4); `fetch-depth: 2` + checkout/setup-node v4→v5 (PR #18) after the
Patron spotted a `HEAD~1` fatal in a job log — shallow clones had
silently skipped `process.tdd`/`process.checkpoint` on every runner ever;
the silent catch now emits a `process.history` advisory instead.

**Retro material from cascade 22** (cite the review logs):
- A red's `# tree:` header is computed by the code under test
  (W-037 round 2's self-retraction — `W-037-review-2.log`).
- A `--allow-dirty` verify at the same HEAD silently overwrites the clean
  certificate in place — filename carries only the source hash
  (`pipeline/src/index.ts:99`; W-035 round 2 advisory A1).
- An expected-red CI job hides real anomalies inside it: the `HEAD~1`
  fatal sat unread in the officina job's log because the job was "known
  red". Silence inside an expected failure is a class.
- The stamped rule for `review×path-traversal-from-ids` did not cover the
  instance the censor found in the same diff (`collectIdRefs` walks only
  sella/collegium/probationes keys) — "a rule exists" ≠ "the rule covers
  the class".
- W-035's drift guard and the required `gates` check each caught a real
  drift within hours of existing — every gate added this cascade fired.

The cascade-22 progress-page row covers up to the gap filings; a follow-up
row for the CI-gate work + W-035's rounds + cascades 23–24 is **deferred
on the Patron's conserve-credits order** — write it at the next funded
checkpoint.

### Also on disk

- `docs/research/jev-typesafe-ai.md` — non-autoregressive model for
  structured decisions; possible fit for the `talk`/posture path.
- `.claude/.claude/` holds `/dev/null` character devices, a sandbox
  artifact of config-path masking. Not real files; do not commit.

## Naming

Roman civic/guild vocabulary; see GLOSSARY.md. Wire attributes (`workflow.*`)
and lifecycle state ids stay English. Earlier working names (Gantry, Backlot,
Atrium) appear only in history.
