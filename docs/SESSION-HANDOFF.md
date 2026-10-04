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

- **Session hygiene.** One cascade per orchestrator context: after the
  checkpoint merges, `/clear` (or end the session) and boot fresh from this
  file. Never park a fat context across an idle gap. The Patron may run
  `~/projects/bisellium/scripts/cascade-loop.sh` to automate the fresh
  sessions; each session then ends by writing one status word (CONTINUE,
  NEEDS_PATRON, LOW_CREDIT or QUEUE_EMPTY) to the file named in its prompt.
  Logs and the lock live in `~/.cascade-loop` (agent sessions cannot write
  it); per session the loop enforces `CASCADE_RUN_TIMEOUT` (4h) and
  `CASCADE_MAX_USD` (20), over `CASCADE_MAX_RUNS` (5) sessions. One-time
  Patron step: the loop runs `claude --restricted`, which loads no user,
  project or local settings, hooks, plugins or MCP servers. It gets only
  `~/.cascade-loop/settings.json` (an object with just `sandbox`, enabled, and
  `permissions`, copied from your own settings; recipe in the script header;
  checked before every run) and the agent definitions in the `.claude/agents`
  beside the script, and refuses to run without either.
  Small reversible decisions ship as veto-able defaults reported at the
  checkpoint; only irreversible or ruling-contradicting calls wait for the
  Patron.
- **Plain words to the Patron.** Status lines translate the vocabulary;
  jargon stays in commits and records.
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
  C:\Users\edene\bisellium-backups\; remote github.com/Round-Block/bisellium, **public by Patron choice** (free Actions) — everything pushed is world-readable. Sandbox deps
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

- `test:serve` does NOT rebuild the web bundle. Run `npm --workspace @bisellium/web run build` first, or e2e tests stale code (cost one false failure here).
- `scripts/no-vendor.test.mjs` row 3 (lock race) flakes under full-suite load; it passes alone 3/3.
- Write logs to `~/.bisellium-evidence/`, not `$TMPDIR` (it differs per call). Run multi-step git/red sequences as bash scripts (zsh word-splitting).
- Codex: `< /dev/null`, `--skip-git-repo-check` outside its trust list; sandboxes can't run git, node servers or Chromium, so the orchestrator commits verbatim with the builder's trailer.
- Reds: `--grep` without a `^` anchor; confirm "N failed" with an assertion error, not "No tests found".
- The orchestrator trailer names the model that actually ran the session (Fable usage caps may force Opus 5.5): `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.
- Permissions (cascade 43, Patron-set, in `.claude/settings.local.json`): allow `Bash(gh pr merge*)` and `Bash(npm run -s bisellium*)`. **No unsandboxed path exists** (the `bisellium -- run` exclusion was removed 2026-10-03, Patron: "all inside the sandbox"). The orchestrator merges on the Patron's behalf. The auto-mode classifier blocks the orchestrator editing sandbox config (correct; route to the Patron).
- **Agent workspace (2026-10-03, Patron: "as secure as possible"):** agents work in `~/agents/bisellium` only; `~/projects/bisellium` is the Patron's and write-denied to every session; personal credentials (`~/.ssh`, `~/.git-credentials`, `~/.config/gh`) are read-denied; GitHub goes through a fine-grained, non-admin, repo-only token (`GH_CONFIG_DIR=~/.config/agent-gh`) over HTTPS. Boot check: `bash scripts/agent-workspace.sh verify --inside`. Hooks run unsandboxed — never point one at agent-clone code. The repo's `bisellium` hooks are currently inert (`bisellium` is not on PATH); if ever installed, link it to the Patron's folder (reviewed master), never the agent clone.
- Record-only commits: branch protection forces PR+CI per commit (use `gh pr merge --auto`); `opus.red_evidence` blocks `state: building` on master — `ready`/handoff happen on the opus branch after the branch rung (D-021). The ladder's six-section check exact-matches `## <Section>` headings (next.ts:62).
- Replay-safe reds (W-130 brief + measured): record so the logs land in the HOST studio (or `git restore --source opus/<id>` them across); no whitespace inside any single command argument (the replay cell splits on whitespace — `--grep behaviour.2:` not `--grep "… behaviour 2: "`); the W-125 Git broker no longer needs a socket (W-132: host-created named pipes in `/control`), so its live rows run, record and replay under confinement. After a rebase (W-134) a log whose `# tree:` header matches no commit is re-identified as the unique commit that introduced the log's bytes, which must carry no source of its own: **commit each red log in a studio-only commit directly on its pre-change commit** (a log committed with source, twice, or after the implementation is refused), and the log needs a `not ok <n> - <title>` line (a TAP reporter) for that path.

- The Codex builder sandbox cannot spawn git or child Node processes, so the
  pre-existing amend, close, review, census, W-089 and W-101-row suites run
  only at the producer's gate. This caused most W-096 rounds; W-125 addresses
  it. CI gates/officina jobs check out full history and the PR-head branch
  (W-096 revisions 9–10).

- W-125 replaces that proxy path for builder-class `bisellium run`: dispatch
  now needs the owning opus branch and launches `scripts/run-builder-host.mjs`.
  The producer host must provide bubblewrap user/PID/mount/network namespaces
  and a separable model control plane; otherwise the run intentionally fails
  closed. Builder work is committed in the disposable clone. The producer
  exports only validated owned commits, destroys the runtime, recomputes with
  pinned master tooling, and then attaches the current-tree run receipt.
  Neither `review --pass` nor `review --fail` may be dispatched until that
  receipt exists and remains current.

## Where things stand (2026-10-03, security track done; cascade 43 resumes at W-130)

**Security first (Patron: sorted before any new work).** In order:
1. Done: agent workspace script + rules merged (#187).
2. Done: the Patron created the agent token and ran `scripts/agent-workspace.sh setup`; sessions open in `~/agents/bisellium`.
3. Done: **W-132** merged (#191). The broker talks over named pipes in `/control`; `bisellium run`, red replays and all 16 live rows work inside the sandbox. Gotchas: the ladder's `pr` step rebases onto master, which makes the receipt's final commit unreachable — re-mint (`bisellium run --sella builder --opus <id> --studio studio --repo . -- true` from the opus worktree, ~12 min) and push again; so merge nothing else to master while an opus PR is open. The `merge` step reads code-scanning alerts: the agent token needs "Code scanning alerts: read" (granted 2026-10-03). Follow-on **W-133** (backlog): cap the broker's reply frame (git maxBuffer 256 MiB) and correct W-132's brief. **W-134** merged (#194): a red whose tree left the branch after a rebase is replayed at the commit that introduced its log bytes, so rebases no longer void reds (a rebase still needs a receipt re-mint). W-134 follow-on: its `titles.length === 0` guard has no row (censor F1a). Done-step gotcha: if `done` holds on missing tests/lint/types, run `bisellium verify <id>` on master (same tree) and commit the certificates with the done record.

**W-130: done (#196).** Rebased over W-132/W-134; its receipt was the first real W-134 rebased replay (5/5). Censor advisories, minor: `host-cells.mjs:64-65` re-derives tools/control paths (pass the runner's own); replay prep leaves `~/.npm/_logs` in the private HOME.

**W-110: code complete** (`origin/opus/W-110` @ d5631f1). Runs after W-131. Make a local branch from the remote (`git branch --no-track opus/W-110 origin/opus/W-110` + `git worktree add .worktrees/W-110 opus/W-110`; the ladder's branch step would cut a fresh one from master), builder rebases onto master and resolves, mint the receipt from its worktree (W-134 re-identifies its reds), censor, merge.

**Patron rulings this cascade (standing):** more code, less tracking — **W-131** (findings-only verdict logs, ci/ retention, cheaper record commits) is greenlit and runs right after W-110. Public repo is intended.

**Spend:** cascade 43 through W-130 all on Claude (Opus 5.5 orchestrator, Opus 5 architect/censor, Sonnet 5.5 builder). **Model mapping from W-131 (Patron, 2026-10-04, "pivot back to codex"):** censor + security review = Codex `gpt-5.6-sol` high (`codex exec`, verdict recorded via `bisellium verdict --from`); builds = Claude Sonnet; clerk = Claude Haiku; spec = Claude Opus architect; ui-lead = `gpt-6-astra` medium (D-022). Sol also owns improving the automated checks: each review names the check that would have caught each finding; Sol specs check-improvement opera, Sonnet builds, Claude Opus censor reviews those. D-014/D-022 still say "Opus-tier censor" — the Patron amends them (agent-written Patron decisions are classifier-blocked). Spend line per provider at every checkpoint.

## Queue

**Finish `origin/chore/cascade-loop` first** (the restart loop the Patron asked for; Codex Sol round 3 FAIL: one blocking B1 — `--setting-sources user` still loads `~/.claude/settings.json`, whose hooks/apiKeyHelper/plugins could target clone-writable paths; fix by a customization-free launch mode (check `claude --help`: `--safe-mode`/`--bare`/`--restricted`) or a startup refusal when user settings reference the clone, plus Sol's advisory rows; reviews in `~/.bisellium-evidence/cascade-loop/sol-review-{1,2,3}.log`; then Sol round 4, merge, and the Patron creates `~/.cascade-loop/settings.json` once) → **W-131** (Patron, 2026-10-03: ahead of W-110, to cut log/record overhead) → W-110 → close cascade 43 → W-115, W-077, W-116–W-119, W-122, W-123, W-120, W-126, W-127; W-113 needs the Patron's UI/UX ruling at spec time. The 2026-09-24 ranking acta predates the W-130/W-131/runner insertions.

## Research lane (on the side)

The methodology audit found none of the MAPS/read-efficiency/W-107 numbers stand as stated (re-run designs exist).
The codex research branches (`codex/maps-lookup-experiment`, `codex/public-source-canary`, `codex/persistent-workflow`) stay off master until finalized.
The Patron is owed a decision on recording two narrow research decisions.
