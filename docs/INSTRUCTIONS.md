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

So `.claude/settings.json` is hand-authored: four hook keys
(`SessionStart`, `PreToolUse`, `PostToolUse`, `SubagentStop`; W-242's cuts,
W-310's guard and W-369's sync), every `timeout: 2` but the sync's 60,
`--studio studio` on every command, no `--sella` anywhere, the guard on
`Bash|Write|Edit|NotebookEdit` and at `SubagentStop`, the sync at
`SessionStart` and, on `Bash`, at `PostToolUse` when a sync is requested, and
`permissions.allow` including `Workflow`.
Structurally tested in `instructions.test.ts` (behaviour 9), not compared
byte-for-byte against the real renderer.

**The guard (W-310).** `hook-event guard` is the one hook target that can
refuse: wired for `PreToolUse` on `Bash|Write|Edit|NotebookEdit` and for
`SubagentStop`, it exits 2 with one stderr line (Claude Code refuses the tool
call, or keeps the subagent running, and shows the line), and exits 0 on
anything else, an unreadable input or its own error included (deny-only,
fail-open). It refuses: a hand ladder record write (`branch`, `ready`, `done`,
`merge`, `review`, `verdict` but at `--phase handoff`, and `next --perform`
with `--chain`, with `--expect` naming one of them, `spec` or `review`, or with
no `--expect`), direct or in a script file the command runs (read up to 256 KiB), from the main thread, a
hook input without `agent_id`, so a dispatched ladder-runner runs them; a `run_in_background`
`while`/`until` loop outside `timeout <N>` (N above zero); in a git checkout,
the main thread's Write, Edit or NotebookEdit outside `studio/` and `docs/`,
and anyone's write to `studio/decisions/` or `docs/SESSION-HANDOFF.md` but a
dispatched clerk's (W-290); and, at `SubagentStop`, an agent whose own shell
or monitor task, named in its transcript, still runs (once per stop). The
command classifier is lexical: it recognises the CLI as `bisellium`,
`npx bisellium`, `npm run bisellium --` and `node …/bisellium.mjs`, behind
assignments, `env`, `command`, `exec`, `nice`, `xargs`, `timeout` and
`bash -c`, and reads `env -S`'s split string and a shell option's operand
before a script file (W-362); deliberate evasion (eval, aliases, functions, a
command or script path built from a variable) is not judged. `check --repo` blocks `hook.guard` when the repo's
`.claude/settings.json` exists and does not wire it. `hooks check --repo
<dir>` prints a `guard:` line each for wired, installed outside `<dir>`
(hooks run unsandboxed) and live (it refuses a main-thread `bisellium merge`),
and exits 1 when any fails. The Patron's own clone, `~/projects/bisellium` at
master, carries it: `scripts/agent-workspace.sh guard`, run by the Patron from
that clone's own copy after each merge that changes the guard, judges its
inputs before any change (the clone on master with no uncommitted tracked
change among them), fast-forwards the clone's master to origin/master, links
`~/.local/bin/bisellium` into it, merges the user settings (the sandbox on, and
denying writes to the agent clone's `packages/`, `apps/`, `adapters/` and
`scripts/`) and probes it (W-362, W-379). Last it removes W-362's old guard
worktree, `~/projects/bisellium-guard`, but only when `~/.local/bin/bisellium`
led into it as the run began, git lists it as a linked worktree of the clone
and git finds it clean; else it leaves it and prints why and the command.

**The sync (W-369).** `hook-event sync` runs `scripts/agent-workspace.sh sync`
beside the installed CLI's own file (never the agent clone's copy) and hands
its `sync:` lines to the model; it always exits 0. It runs at `SessionStart`
and after a Bash call when `<git dir>/bisellium/sync` exists, which the merge
rung writes when it holds on a path the session may not write (`next`'s merge
and done performs; the hold still prints the Patron's command). The sync
refuses, changing nothing, when the Patron's clone is off master or has an
uncommitted tracked change, when the agent clone's `.git/config` holds a key
other than git's clone keys, setup's remote and credential helper and a
branch's `remote`, `merge` or `vscode-merge-base`, or a value of
`core.repositoryformatversion`, `core.filemode`, `core.bare` or
`core.logallrefupdates` other than git's clone writes (0, true, false, true),
or when a git hook or `info/attributes` exists. It then prunes dead worktree
entries and fetches origin's master into the Patron's clone; it leaves master
unmoved when HEAD is not master, a tracked file is changed (also when master
is already current), master is not behind, or an untracked or ignored file
sits in an incoming path, and otherwise fast-forwards the agent clone's
master. Git in the agent clone runs with no global or system config, no
hooks and no fsmonitor.

**Close step CS-2** (integrator, after W-016 lands): re-render this file
from `claudeCodeHooksBlock({ studio: "studio" })` and append a deep-equal
assertion of the rendered `hooks` block to `instructions.test.ts`, so the
hand-authored window closes for good and any future drift between this file
and the shared renderer is caught by the same test.

`.claude/settings.local.json` is a per-machine override, gitignored
(repo `.gitignore`, this brief) — never shared, never rendered.

## `.claude/agents/*.md`

`builder.md`, `architect.md`, `clerk.md`, `ladder-runner.md` — Claude Code subagent
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
