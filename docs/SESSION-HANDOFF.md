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
  trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- The Workflow tool is allowed without a prompt (`.claude/settings.json`).
- Codex weekly quota was exhausted until 2026-09-21; quota-axi cannot read the
  Claude Code login (`auth_required`), so Claude posture is observed/unknown.
- Two officinae share this repo (`studio/`, `examples/sample-studio`); each lists
  the other in `source_excludes`.

## Where things stand (2026-09-19, cascade 9 complete)

- Cascades 1–7 in the dossier progress log. Suite green; both
  officinae 0 blocking.
- **Cascade 8** (6 commits): visual pass, process fixes (`standing_rules`,
  check rules, screen map, review prompt, inbox click-to-select).
- **Cascade 9** (3 commits): W-026 complete — per-opus branching,
  `bisellium branch`/`merge`, `run --opus`.
- **Cascade 10**: W-028 checkpoint rule + `bisellium close` command.
- **Cascade 11**: W-022 evidence content rules (P-005 resolved).
- **Cascade 12**: W-023 containment scoping (P-004 resolved).
- **Cascade 13**: W-027 prune command.
- **Cascade 14**: W-028 close automation.
- **Cascade 15**: process.cascade rule + hook enforcement.
- **Cascade 16**: W-029 Playwright smoke suite (Sonnet builder, 118k).
- **Cascade 17**: FastiStrip regression fixed (Sonnet builder, 35k).
- **Cascade 18**: Review gate pass for all six opera. Results:
  - W-029: **PASS** — only opus with reds, closeable.
  - W-022: FAIL — no reds (6 behaviours).
  - W-023: FAIL — no reds, undocumented `lessons/` containment removal.
  - W-026: FAIL — no reds, brief behaviour 4 missing (merge without state
    check), no push/gate check, mutation test dead on behaviour 5.
  - W-027: FAIL — no reds, behaviour 5 (`runPrune` wrapper) untested.
  - W-028: FAIL — two bugs: `CLOSEABLE` set has wrong state names
    (`reviewing`/`greenlit` instead of `verifying`/`review`), and
    `rebuildDossier` failure silently swallowed.
  - **NOTE**: these reviews ran on `censor` while it was still Sonnet 5,
    so they were recorded below the D-014 tier. The findings are valid and
    worth acting on, but each verdict should be re-confirmed now that
    `censor` is Opus 5 — W-029's pass especially, since it closes an opus.
- **In-flight builders** (may have completed by session start):
  - W-028 bug fix builder (Sonnet): fixing CLOSEABLE states + dossier
    failure handling.
  - `process.review_tier` check rule builder (Sonnet): new rule to flag
    reviews done by non-Opus sellae — mechanical prevention of the
    wrong-model dispatch mistake.
- **Backlog (priority order)**:
  1. Close W-029 (`bisellium done`) — review passed.
  2. Re-confirm all six review verdicts with `censor` (now Opus 5).
  3. Round-2 fixes for W-022/W-023/W-026/W-027/W-028 (reds + code bugs).
  4. Web II (Board screen, drawer, SSE live) — needs Patron UI/arch input.
- D-014 (amended twice on 2026-09-19): Sonnet 5 builders, **Opus 5** for
  opus-tier roles *and* for review. The cross-generation clause is struck —
  review independence rests on role separation, not model generation.
- **One review gate**: `censor` (Opus 5, boots as `qa-lead`, read-only by
  design) is the only reviewing agent. `reviewer46` is deleted. Agent set is
  now architect, builder, censor, clerk — matching the rendered harness list.
- Research note added: `docs/research/jev-typesafe-ai.md` — System One
  model for structured decisions, evaluate for talk/posture path.

## Naming

Roman civic/guild vocabulary; see GLOSSARY.md. Wire attributes (`workflow.*`)
and lifecycle state ids stay English. Earlier working names (Gantry, Backlot,
Atrium) appear only in history.
