# Four agent tools, read against bisellium (2026-10-10)

Method: GitHub API (stars, dates, license, file tree), each README, and a
sample of files per repo (docs, specs, workflow files, a few source files).
Nothing was cloned or run. "Verified in tree" means a file of that name exists
or I read the text; I did not run any of it or read most source bodies.
All four were reachable. All four had a commit on 2026-10-08/09.

## 1. Whq02/MercuryCLI

What it is: a terminal coding agent ("harness") that runs many sessions at
once, each in its own worktree, with many providers (OpenAI, Claude, Gemini,
Kimi, GLM, xAI, local). The author builds Mercury with Mercury.

How it works:
- Node 24 + bun build to one `dist/mercury.mjs`; ships its own Node runtime.
- Each session has its own conversation, model, permission mode, workspace.
  A "session concourse" board lists running and crashed sessions
  ("NEEDS YOU" with the reason). Sub-agents are "crewmates", with per-session
  on/off switches and a stated inactivity watchdog (15 min default).
- Edits are guarded by content anchors: every read prints a hash
  (`fa:` whole file, `ra:` line range, `N#hhhh` per line). An edit that
  carries a stale anchor is refused with the smallest re-read that repairs it
  (docs/CHANGE-TRANSACTIONS.md).
- Durability doc: atomic file publication, a journal with idempotency keys for
  multi-record operations, a boot-time reconciliation pass, damaged stores
  copied to quarantine and logged, never silently reset (docs/DURABILITY.md).
- Hooks (command, prompt, agent, HTTP), headless `mercury run --format rows`
  (one JSON row per event), a scheduler ("Saturn"), a Python/JS eval tool,
  voice, Unity/Blender/Godot bridges, computer use.

Maturity: 11 stars, 1 fork, created 2026-09-04 (about 5 weeks old), 0 open
issues. License is Business Source License 1.1 plus a community production
grant: source-available, not open source. About 8,500 files, about 6,000 .ts.
Tests: only 4 files match `*.test.*`; the real checks look like about 250
`prove-*.ts` / "drive" scripts run by `run-all.sh`. The `gate.yml` workflow I
read triggers on `workflow_dispatch` only (manual); I did not read the other
seven workflows, so I cannot say what runs on every push.

README vs code: the README is candid (it says source-available, lists the
provider caveats). The feature claims have matching directories (native/voice,
assets/unity, blender-bridge, docs for each). Breadth this large in five weeks
is a warning sign for depth, but I did not test any feature. Treat as: a very
big single-author product with strong written contracts, unproven outside it.

## 2. S1gil0/lookingglass

What it is: a local coding CLI (`glass`) where one model coordinates and
parallel worker agents use another model; sessions live in SQLite and a
scheduler can wake the same session later.

How it works:
- Primary and worker models are chosen independently (provider, model,
  reasoning level), stored with the session. Main model calls `run_agents`
  with up to 8 self-contained tasks; each worker gets a fresh child session
  with no parent transcript, cannot spawn agents, schedule, or ask the user
  (src/agents/coordinator.ts, the leaf prompt, read).
- Scheduler runs as a user service (systemd, launchd, Windows Task Scheduler);
  jobs have leases, claims, retry budgets and timeouts (src/scheduler/).
  A scheduled turn resumes the saved session, approvals included.
- Approval modes `review | code | unrestricted`, per session, remembered by
  command family. README says plainly it is not a sandbox.
- Bounded retention/cleanup of old sessions and artifacts (src/maintenance.ts).

Maturity: 22 stars, 1 fork, MIT, created 2026-07-21, release v0.14.2 on
2026-10-09, 1 open issue. About 22 source files, 50 test files. Some very big
single files (`ui/tui.ts` 145 KB, `model/codex-lb.ts` 106 KB, `scheduler/store.ts`
87 KB, `engine/engine.ts` 88 KB).

README vs code: layout matches the README closely (scheduler per OS, storage,
agents, tools, safety). I did not read the engine or scheduler bodies. Small,
honest, one-operator tool. Relevance to bisellium is low (see below).

## 3. cdknorow/coral

What it is: a Go server (one binary, web dashboard on :8420) that wraps the
Claude Code, Codex, Gemini and Pi CLIs, each in its own tmux session, as one
team with a shared message board and task queue. Includes a phone client.

How it works:
- Agents are real vendor CLIs in tmux; optional git worktree per team or per
  scheduled run. Coral calls no model API itself.
- Board: messages with cursor-based delivery, @mentions. Task queue with
  statuses draft/blocked/pending/in_progress/completed/skipped. Dependencies
  are conditioned on an outcome (`success`, `failure`, `termination`) plus
  required artifact names. Claim is atomic, one active task per agent, and
  records upstream outcomes and artifacts into the claimed task. A
  `review_pending` hold lets a checker gate a result. (Read
  coral-go/specs/BOARD_TASKS/task-queue-behavior.md, which is dated
  2026-09-26 and calls itself the implemented contract.)
- `coral-board wait` ends the agent's turn and wakes it on a message, instead
  of polling.
- Background services (file names verified in internal/background/):
  board_health, idle_detector, token_poller, webhook, reconciler,
  workflow_runner, scheduler, summarizer. Board-health flags blocked tasks
  whose prerequisites are done, idle assignees, load imbalance; reminds at 30
  min, escalates to the orchestrator at 60 (README claim).
- Cost per agent / session / team / branch / task from hooks and transcripts,
  plus an optional local LLM proxy (README claim; token_poller exists).
- Permissions written once in Coral terms and translated to each CLI's format.

Maturity: 41 stars, 7 forks, Apache 2.0, created 2026-02-18, Go with 226
source files and 195 `_test.go` files, a Python predecessor kept as legacy
reference, specs folder (81 files). 1 open issue. Sells an optional $49.99
"supporter" license; I read the license middleware and it lets every request
through ("no routes are gated"), which matches the README's "free to use".

README vs code: README's comparison table is fair about weaknesses (team
worktree is shared and opt-in; no merging or conflict handling). Task-queue
and monitor claims have matching code files; I did not read their bodies. The
most mature of the four on tests per source file.

## 4. Nightbr/factorai

What it is: a desktop app (Tauri 2 / Rust + React) that hosts real `claude` /
`codex` CLIs in embedded terminals, one per session, with project grouping,
cron "routines", transcript search and git changes/graph views. It calls
itself an "Agentic Development Environment".

How it works (from README, AGENTS.md, ADR titles and two ADRs read):
- Each session is the vendor CLI in a PTY; closing the app kills every agent
  it started (ADR-0005).
- Transcripts are read in place from `~/.claude` and `~/.codex` and indexed
  with SQLite FTS5; factorai treats the Claude directory as read-only
  (ADR-0004, ADR-0039).
- Session status (working / waiting / stopped) comes from the terminal title
  escape sequence the CLI writes (ADR-0015); the ADR admits this depends on a
  black box that changes often and describes how it fails safe.
- A routine fire is claimed in the DB before it is recorded, after a bug where
  a "fired" row existed with no process behind it (ADR-0030).
- Repo process: spec first, ADR for each decision (73 files under specs/adr),
  a documented quality gate (format, lint, typecheck, test, e2e, deps checks,
  cargo clippy -D warnings) with the reason each check was added and the date
  it broke main, nine project skills under `.claude/skills`, AGENTS.md with
  CLAUDE.md as a symlink.

Maturity: 28 stars, 7 forks, MIT, created 2026-08-14, v0.54 stable and 0.55
alpha channel, 41 open issues, about 227 .ts, 113 .tsx, 72 .rs files, 134
test-ish files. README says "alpha" and "point it at work your version control
can recover".

README vs code: README is short and makes few claims. The repo process
documents are the interesting part, and they look real (dated, with failures
named). I did not verify "no telemetry".

## Relevance to bisellium

Overlap, plainly:
- All four are single-person cockpits: start, watch, and steer agent CLIs.
  None has signed specs, an independent review gate, a merge queue, lessons,
  or retros. Bisellium already does that part better, and Coral's reviewer is
  only a `review_pending` hold with no evidence trail.
- Coral and Mercury touch the multi-lane problem (W-169, W-178 to W-183):
  Coral by atomic task claim and one active task per agent; Mercury by
  per-session worktrees and a session board.
- Coral's cost tracking and Mercury's `rows` output touch W-138 / W-202.
- Looking Glass and factorai add little: Looking Glass is a model-mixing CLI
  (bisellium already mixes providers by seat); factorai is a GUI shell. Their
  value is in the process documents (factorai) and the scheduler lease
  pattern (Looking Glass), both already covered by bisellium's tick and
  decision records.
- I read bisellium's CLAUDE.md, the handoff Queue, production lex section 11,
  ARCHITECTURE headings and the W-068/W-138/W-169/W-201/W-202 records. I did
  not read the CLI source, so "bisellium already does X" below is from docs.

What bisellium already does better: spec signing, independent review gate,
recorded reds, certificates, a merge queue with records-only handling being
added (W-203), lessons/retros, one-direction truth from files to console,
exclusive-create ids (`createNextRecord`). None of the four checks its own
process by rule; Mercury and factorai rely on written contracts and manual
gates.

### Ranked ideas (at most 5)

1. Outcome-and-artifact dependencies with an atomic claim.
   From Coral's task queue. An opus declares what it waits on and which named
   evidence must exist (a signed brief, a recorded red, a Chaos finding), not
   only "dependency is done". Claiming an opus is one exclusive-create step, so
   two lanes cannot take the same one.
   Effort: small to medium (a field plus a check rule plus a claim guard).
   Extends: W-068 (task dependencies), with the claim part in W-169.
   Open question: do you want dependencies on evidence ("needs a passing
   mutation run") or is "done" enough? Evidence-based ones also let a failed
   dependency open a fix opus, which "done" cannot express.

2. Compare-and-swap on shared records and the handoff.
   From Mercury's content anchors (edit refused if the file changed since it
   was read, with the smallest re-read named) and factorai ADR-0030 (claim
   before record). With several lanes, two verbs or two sessions can edit
   the same opera file or handoff. `createNextRecord` covers new ids only;
   I did not check whether verbs that edit existing records guard against a
   concurrent change.
   Effort: small if the verbs funnel through one writer, medium if not.
   Extends: W-186 (stale handoff refused) and W-169 (one handoff section per
   lane).
   Open question: has a lost update on an opus record or the handoff ever
   happened? If never, this waits until the second lane is on.

3. A board-health pass in the tick: flag stuck work and say who owns it.
   From Coral's board_health: an opus whose dependency is already done but
   has not started; an in-flight opus with no new output; lane load
   imbalance; remind at one threshold, escalate at a second.
   Effort: small (check rules and a tick step; the staleness rule for
   in-flight claims already exists as a lex standing rule).
   Extends: W-202's "needs you" strip (the strip is where it shows), and
   W-068 once dependencies exist.
   Open question: should the escalation go to the Patron's inbox or only into
   the producer's digest?

4. Attribute usage to opus and step at dispatch time.
   From Coral: cost per task and branch, from hooks plus transcripts. The
   joining key is the session id; a receipt line "session S worked opus W,
   step X" at dispatch lets W-138 read harness logs and split tokens by opus,
   step and provider without guessing.
   Effort: small to medium (receipt field, then the metrics join).
   Extends: W-138 (rescoped to W-202's cost data) and W-202's cost sector.
   Open question: is the receipt the right home, or does the existing hook
   event log already carry the session id?

5. Journaled multi-record verbs and a boot reconciliation pass.
   From Mercury's durability doc: a verb that writes several records (state
   change, receipt, log) writes an intent first and finishes or rolls back at
   next start; a damaged record is quarantined and logged, never replaced by
   a default.
   Effort: medium to large; only worth it if half-written verbs have
   happened. Extends: W-185 (records checked once at load), otherwise new.
   Open question: do you have an incident of a half-written verb? If not, skip.

### Not worth adopting
- Phone client, QR pairing, web terminals, voice, computer use (Coral,
  Mercury): UI scope the Patron decides, and none fits the records-first
  design. W-202 already covers the dashboard.
- Status from the terminal title (factorai ADR-0015): fragile by its own
  account.
- Worker agents that cannot spawn or ask the operator (Looking Glass): the
  builder and censor agent files already enforce narrower roles.
- Mutation checking (W-201): none of the four does it; nothing to borrow.
