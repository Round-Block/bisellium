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
  file. Never park a fat context across an idle gap. Small reversible
  decisions ship as veto-able defaults reported at the checkpoint; only
  irreversible or ruling-contradicting calls wait for the Patron.
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
- Replay-safe reds (W-130 brief + measured): record so the logs land in the HOST studio (or `git restore --source opus/<id>` them across); no whitespace inside any single command argument (the replay cell splits on whitespace — `--grep behaviour.2:` not `--grep "… behaviour 2: "`); live rows needing a socket LISTEN cannot record or replay under confinement.

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

## Where things stand (2026-10-03, cascade 43 PAUSED for the security track)

**Security first (Patron: sorted before any new work).** In order:
1. Done: agent workspace script + rules merged (#187).
2. Done: the Patron created the agent token and ran `scripts/agent-workspace.sh setup`; sessions open in `~/agents/bisellium`.
3. `verify --inside` all ok (2026-10-03). **W-132, the socket-free runner, is filed and greenlit (Patron's nod given); build it next:** the W-125 Git broker talks to the cell over inherited pipes, not a unix socket, so `bisellium run`, its live rows and every replay work inside the sandbox. Its receipt comes from its own runner, in the sandbox.

**W-130: code complete, blocked on (3).** `origin/opus/W-130` @ 3a56d40. Brief rev 5 (round 8: the probe admits `PLAYWRIGHT_BROWSERS_PATH=/browsers` as the 19th name, rows 2(g)/2(h); prettier-only reformat of the red-04 file permitted). Reds 01–05 recorded assertion-level; full suite, lint, format, typecheck, both checks green; measurement 22/0 against the module (`~/.bisellium-evidence/W-130-spec/*against-implementation*`). Still owed: the receipt (`bisellium run` refused the worktree's symlinked node_modules — W-125's escaping-link rule; use a real `npm ci`), the 7 acceptance live rows run (not skipped), then censor (trust-boundary standard, D-035), merge.

**W-110: code complete, blocked on W-130** (`origin/opus/W-110` @ d5631f1). Then its receipt, censor, merge, done.

**Patron rulings this cascade (standing):** more code, less tracking — **W-131** (findings-only verdict logs, ci/ retention, cheaper record commits) is greenlit and runs right after W-110. Public repo is intended.

**Spend:** cascade 43 all on Claude (Fable 5, then Opus 5.5 orchestrator; Opus censor/architect; Sonnet builder). Codex rejoins 2026-10-04 09:01.

## Queue

Security track (above) → W-130 → W-110 → close cascade 43 → **W-131** → W-115, W-077, W-116–W-119, W-122, W-123, W-120, W-126, W-127; W-113 needs the Patron's UI/UX ruling at spec time. The 2026-09-24 ranking acta predates the W-130/W-131/runner insertions.

## Research lane (on the side)

The methodology audit found none of the MAPS/read-efficiency/W-107 numbers stand as stated (re-run designs exist).
The codex research branches (`codex/maps-lookup-experiment`, `codex/public-source-canary`, `codex/persistent-workflow`) stay off master until finalized.
The Patron is owed a decision on recording two narrow research decisions.
