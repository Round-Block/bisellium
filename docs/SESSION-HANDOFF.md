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
  trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The Workflow tool is allowed without a prompt (`.claude/settings.json`).
- Codex weekly quota was exhausted until 2026-09-21; quota-axi cannot read the
  Claude Code login (`auth_required`), so Claude posture is observed/unknown.
- Two officinae share this repo (`studio/`, `examples/sample-studio`); each lists
  the other in `source_excludes`.

## Where things stand (2026-09-19, after cascade 5)

- Cascades 1–5 are in the dossier progress log. Suite green (731 tests, lint
  and format:check now real); both officinae 0 blocking. W-016 and W-019 are
  `done` with the studio's first `tree:` certificates; retro 5 filed
  (acta/2026-09-19-retro-5.md, L-015–L-017).
- P-001/P-002/P-003 all decreed 2026-09-19: builder-isolation clause in the
  engineering lex; opus.untracked blocks; red store at `studio/ci/reds/` via a
  new `bisellium red` command with `opus.red_evidence` blocking after it lands;
  D-008 promotes to blocking (probation served by cascade 5); licence
  Apache-2.0 (LICENSE at root). Implementation = W-020 + W-021, backlog,
  awaiting decretum.
- Closed in cascade 6 (W-020): `bisellium ready`, `done`, `review` and `red`
  write the lifecycle transitions, the review verdict (pass *and* fail) and the
  per-behaviour red store; the `scripts/opus-ready.ts` / `scripts/opus-close.ts`
  stopgaps are deleted.
- Known gaps worth a cascade slot: `bisellium instructions --write` strips the
  docs-registry front matter W-019 put on `GLOSSARY.md` (generator vs registry
  seam); `retro`'s previous-retro matcher misses `-retro-4b.md` suffixes.
- W-017 and W-018 closed `done` in pass 5b (round-2 reviews passed on
  tree:272d2d3b; `.claude/worktrees/` gitignored so certificates mint clean).
  All four 4b opera are done.
- Cascade 6 (2026-09-19) landed the P-001 decrees as machinery: `bisellium
  ready/review/done/red`, the `ci/reds/` store, `opus.untracked` +
  `opus.red_evidence` blocking, D-008's containment rules (advisory pending
  P-004). Both opera closed through their own lifecycle after six honest
  review rounds. Retro 6: L-018–L-025.
- P-004/P-005/P-007 decreed 2026-09-19: path.escapes.officina scoped to opus
  spec:/gate evidence: paths, then both D-008 rules re-promote to blocking;
  opus.red_evidence gains content checks (identical bodies block, load-failure
  bodies advise) with the assertion-level-reds lex clause; isContained hoists
  as the only sanctioned officina-path join with its lex clause. Implementation
  = W-022 + W-023 (backlog). retro.ts P-006 numbering fix rides W-023.
- Inbox empty. Engineering posture CLOSEOUT for 2026-W38 (2.89M/3.0M): the
  fasti holds until W39 (Mon 2026-09-21), then greenlight web I and W-022/W-023
  per the Patron's timing decree — no budget write.
- Web I builds to docs/design/DIRECTION.md (ledger identity, signature
  elements, bans) and updates docs/ARCHITECTURE.md per the design lex.
- D-014 (2026-09-19): Opus 4.6 + Sonnet 4.6 alongside the 5 family —
  builder-c/d on claude-sonnet-4-6 (manifest), review split per cascade
  between claude-opus-5 and claude-opus-4-6 (.claude/agents/builder46.md,
  reviewer46.md; sizing.json reviewer.models). Bought for cross-generation
  review diversity, not cost (Sonnet 4.6 is pricier than Sonnet 5).
- Then: web I (Inbox + Officina screens over `serve`), web II, web III, autonomy
  L2, adapters + desktop. Estimates and rationale are in the dossier.

## Naming

Roman civic/guild vocabulary; see GLOSSARY.md. Wire attributes (`workflow.*`)
and lifecycle state ids stay English. Earlier working names (Gantry, Backlot,
Atrium) appear only in history.
