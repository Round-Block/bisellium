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
- **Update the dossier at every checkpoint** (after each cascade and each
  cleanup commit): Part V "Progress log" row + masthead status. Source:
  `docs/design/dossier/` (`build.sh`, then republish with the Artifact tool,
  `url` = the dossier link below).
- **Never relay a mid-turn Patron message into a running workflow**; answer
  between cascades. Agents given a relayed question refused their build (4b).
- Test-first with a recorded red; mechanical work is a script; evidence is
  produced, never backfilled. These are in the leges; they bind here too.

## Artifacts (Patron-visible)

- Dossier: https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
  (rebuild from `docs/design/dossier/head.html` + `body.html`; patch `body.html`
  with a script, never by hand-editing the built page).
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
  firewall, for fully contained cascade runs. Repo backup: bundle at
  C:\Users\edene\bisellium-backups\; GitHub remote pending a PAT with repo-create
  rights (gh is authed as edckt but the fine-grained token cannot createRepository).

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
- In the Patron's inbox: P-001 (Censor's rule proposals), P-002 (licence
  choice), P-003 (where per-behaviour recorded reds live — the class recurs
  across cascades 2/4/5; builder reds currently survive only in
  `~/.bisellium-evidence/cascade-5/`).
- Known gaps worth a cascade slot: no CLI writes an opus lifecycle transition
  (halted→building, building→done) or an agent-gate result — stopgaps
  `scripts/opus-ready.ts` and `scripts/opus-close.ts`, delete both when
  `bisellium ready`/`done` exist; `bisellium instructions --write` strips the
  docs-registry front matter W-019 put on `GLOSSARY.md` (generator vs registry
  seam); `retro`'s previous-retro matcher misses `-retro-4b.md` suffixes.
- W-017 and W-018 closed `done` in pass 5b (round-2 reviews passed on
  tree:272d2d3b; `.claude/worktrees/` gitignored so certificates mint clean).
  All four 4b opera are done.
- Then: web I (Inbox + Officina screens over `serve`), web II, web III, autonomy
  L2, adapters + desktop. Estimates and rationale are in the dossier.

## Naming

Roman civic/guild vocabulary; see GLOSSARY.md. Wire attributes (`workflow.*`)
and lifecycle state ids stay English. Earlier working names (Gantry, Backlot,
Atrium) appear only in history.
