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

- `test:serve` does NOT rebuild the web bundle. Run `npm --workspace @bisellium/web run build` first, or e2e tests stale code (cost one false failure here).
- `scripts/no-vendor.test.mjs` row 3 (lock race) flakes under full-suite load; it passes alone 3/3.
- Write logs to `~/.bisellium-evidence/`, not `$TMPDIR` (it differs per call). Run multi-step git/red sequences as bash scripts (zsh word-splitting).
- Codex: `< /dev/null`, `--skip-git-repo-check` outside its trust list; sandboxes can't run git, node servers or Chromium, so the orchestrator commits verbatim with the builder's trailer.
- Reds: `--grep` without a `^` anchor; confirm "N failed" with an assertion error, not "No tests found".
- The orchestrator model is now Claude Fable 5.1; use the commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

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

## Where things stand (2026-10-02 night)

W-121 merged PR 159 and done — the blocking test.sleep rule (tokenizer scan, hardened annotation grammar, parser-counted waiver caps: 6 seams, 18 waivers) plus the repairs: the no-vendor lock-race root-caused (the result signal was ordered after the lock release it guarded) and fixed through a beforeRelease seam with a kernel deadline, 50/50 under CPU load — the flake had cost three PR round-trips; 12 sleeps repaired, 24 annotated; censor PASS on ROUND 1 (first all week) and sec CLEAR with a 50-vector fuzz, Claude substitutes. W-125's receipt gate caught a real Prettier miss before granting the receipt; the verb walked cleanup and done (PR 160). LADDER NOTES to record: two tensions queued into W-128's scope — the checkpoint rung's bare-heading regex, and the spec-log bootstrap (D-021 blocks writing the spec verdict off the opus branch once it exists, so the verdict MUST ride the spec PR; the scripts-retirement live proof via next --perform pr moves to W-114, whose close-out will be ordered correctly). Codex resets Oct 4 09:01.

## Queue

Next is W-114 (reply carry-through e2e; its spec PR carries verdict --phase spec from the start and its pr/merge rungs run through bisellium next as the retirement proof), then W-110, W-115, W-077, W-116–W-119, W-122, W-123, W-120, W-126, W-127. W-113 needs the Patron's UI/UX ruling at spec time.

## Research lane (on the side)

The methodology audit found none of the MAPS/read-efficiency/W-107 numbers stand as stated (re-run designs exist).
The codex research branches (`codex/maps-lookup-experiment`, `codex/public-source-canary`, `codex/persistent-workflow`) stay off master until finalized.
The Patron is owed a decision on recording two narrow research decisions.
