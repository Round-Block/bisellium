---
kind: guide
owner: eng-lead
tier: reference
review: 2026-12-01
kill: when the instructions layer it documents (W-017) ships and this doc folds into ADOPTION.md
---

# The instructions layer (W-017)

The ROM tier — what a builder knows before it reads anything else — is a
**generated, committed** artifact, so it cannot drift from the manifest or
from itself. Regenerating it after any manifest change is mechanical, not a
hand edit.

## Files

- `CLAUDE.md`, `AGENTS.md`, `GLOSSARY.md` (repo root, committed, generated).
- `packages/cli/src/instructions.ts` — `renderInstructions` (pure) and
  `runInstructions` (self-parsing argv, Seam S1).
- `packages/cli/src/instructions.template.md` — the one template both
  `CLAUDE.md` and `AGENTS.md` render from; the only difference between them
  is which harness paragraph (`{{HARNESS}}`) is substituted in — one
  template, one conditional, never two templates that can drift apart.
- `packages/cli/src/rules/instructions.ts` — `checkInstructions`: three
  advisory rules, `instructions.present` / `cap.instructions` /
  `instructions.stale`. See the seam note below on `RuleOpts`.

## Regenerating

```bash
# print all three to stdout, write nothing
bisellium instructions --studio studio

# write CLAUDE.md/AGENTS.md/GLOSSARY.md at --repo (defaults to --studio's git toplevel)
bisellium instructions --studio studio --repo . --write
```

`bisellium init <dir>` also writes `CLAUDE.md`/`AGENTS.md` into the studio it
scaffolds (a freshly initialized studio is its own repo root).

Until the integrator wires the `instructions` dispatch line into
`packages/cli/src/main.ts` (Seam S1), invoke it by importing
`runInstructions` directly, or run `packages/cli/src/instructions.test.ts`
for the same effect under test.

## The `hooks.default_sella` manifest key

New optional top-level `bisellium.yml` key, introduced by this brief and
owned by W-018 in the manifest itself:

```yaml
hooks: { default_sella: guest }
```

The resolution order a hook command falls back through when no `--sella` is
on its own argv (W-016): `--sella` flag → `$BISELLIUM_SELLA` → this manifest
key → `"guest"`. `.claude/settings.json`'s commands deliberately carry no
`--sella` at all (see below), so in this repo the effective value is
whatever `$BISELLIUM_SELLA` is set to in the shell Claude Code runs in, or
`guest` if it's unset.

## `.claude/settings.json` — hand-authored, not yet rendered

`claudeCodeHooksBlock({ studio: "studio" })` (the shared hooks-profile
renderer, `@bisellium/shim`) is not legal to call this way yet:
`ClaudeCodeHooksOpts.sella` is required today, and the template it fills
substitutes `__SELLA__` into every command — exactly what this file must
*not* do (a sella baked into a committed hook command can never be someone
else's). W-016 is what makes an optional `sella` legal.

So `.claude/settings.json` is hand-authored for this cascade: four hook keys
(`SessionStart`, `PreCompact`, `Stop`, `PostToolUse`), every `timeout: 2`,
`--studio studio` on every command, no `--sella` anywhere, `PostToolUse`
matching `Write|Edit`, and `permissions.allow` including `Workflow`.
Structurally tested in `instructions.test.ts` (behaviour 9), not compared
byte-for-byte against the real renderer.

**Close step CS-2** (integrator, after W-016 lands): re-render this file
from `claudeCodeHooksBlock({ studio: "studio" })` and append a deep-equal
assertion of the rendered `hooks` block to `instructions.test.ts`, so the
hand-authored window closes for good and any future drift between this file
and the shared renderer is caught by the same test.

`.claude/settings.local.json` is a per-machine override, gitignored
(repo `.gitignore`, this brief) — never shared, never rendered.

## `.claude/agents/*.md`

`builder.md`, `censor.md`, `architect.md`, `clerk.md` — Claude Code subagent
front matter (`name`, `description`, `tools`, `model`) only. There is no
`context:` include key in Claude Code's own contract; these files do not
invent one. Each body names its collegium's lex with an `@studio/leges/<id>.md`
reference and a `run: bisellium context --sella <id> studio` line, so a
subagent boots the same way any sella does.

## `.claude/commands/*.md`

Exact invocations (the CLI's flag allowlists are strict — Seam S1 is what
makes `--write`/`--brief`/`--spec` and friends parse at all, and a slash
command that got a flag order wrong would silently swallow the next flag as
that one's value):

| command | invocation |
|---|---|
| check | `bisellium check studio --repo .` |
| verify | `bisellium verify <opus> --studio studio --repo .` |
| talk | `bisellium talk --sella <id> --studio studio <message>` |
| tick | `bisellium tick --studio studio` |
| retro | `bisellium retro --cascade <N> --studio studio` |

`retro` does not exist until W-018 lands, so `.claude/commands/retro.md` is
not part of this brief's acceptance; `instructions.test.ts` exempts it by
name. **Close step CS-3** (integrator): re-run this table against the merged
CLI once `retro` exists, and add `retro.md`.

## `RuleOpts` — a temporary local copy (Seam S2)

`checkInstructions(root, opts: RuleOpts)` uses a local `RuleOpts` interface
(`{ now: Date; repo?: string; manifest?: unknown }`) declared in
`packages/cli/src/rules/instructions.ts`, structurally identical to the
cascade-wide signature W-018 introduces in `check.ts`. It does not import
from `check.ts` because that export doesn't exist yet in this worktree.
**Integrator**: once W-018 lands, delete the local copy and import the
shared `RuleOpts` instead — no other change to `checkInstructions` is
needed.

`checkInstructions` is exported but not yet wired into `checkStudio`; the
integrator adds the one call alongside `checkProcess`/`checkLex`/`checkDocs`.

## Advisory rules

- `instructions.present` — neither `CLAUDE.md` nor `AGENTS.md` exists at the
  repo root. Clears once either exists.
- `cap.instructions` — a generated file (`CLAUDE.md`/`AGENTS.md`/`GLOSSARY.md`)
  is over 6,000 characters. Names the file and the count.
- `instructions.stale` — a committed generated file no longer matches
  `renderInstructions`'s current output. Clears after `bisellium instructions --write`.

All three are advisory only; a stale or oversized doc never blocks a build.
`checkInstructions` returns `[]` when `opts.repo` is absent — it never
infers the repo root from the officina's own parent directory, which for
`examples/sample-studio` is `examples/`, not this repo's root.
