# Auto-handoff: plan

Plan only, 2026-10-12. Not built, not filed. Modelled on obie/auto-handoff
(a function-hooks plugin: an idle timer armed at `turn.complete`, cancelled at
`turn.start`, that submits a handoff command).

## What triggers it

1. **Context at 350k.** On `turn.complete`, read `$.session.usage()` →
   `context` (tokens in use, the same figure `/context` shows). At or past
   350,000, fire once per session.
2. **Idle before the cache expires.** On `turn.complete`, arm
   `$.clock.after(minutes)`; cancel on `turn.start`. Default 50 minutes (the
   one-hour prompt cache; much shorter on the five-minute cache). Skip if the
   timer fires late (laptop sleep), as obie does.

Both use the function-hooks plugin API, which is early access and may change
between Claude Code releases.

## What it does when it fires

`$.prompt.submit({ text })` queues one turn that runs once the session is
idle. The text runs the studio's own handoff, not a free-form note.

The studio's handoff is heavy: edit `docs/SESSION-HANDOFF.md`, pass
`handoff-check`, an independent Codex review (network), a recorded verdict, a
records PR, the merge queue. Unattended, any permission prompt stalls it, and
the classifier has refused merges before. So two tiers:

- **Tier 1, every trigger (cheap, local, nothing to approve):** write
  `~/.bisellium-evidence/handoff-drafts/<timestamp>.md`: running agents
  (`$.agent.list()`), uncommitted files, each in-flight opus's `next` step,
  what the session was doing. Commit nothing.
- **Tier 2, at 350k only:** the full handoff ladder, ending in the records
  PR, then the refresh signal (below). If anything needs a permission, it
  stops at Tier 1 and says so.

## Guards

- **Never mid-work.** If `$.agent.list()` shows a running subagent, defer:
  re-check on each `turn.complete` and fire once nothing runs (lex §7: never
  refresh while a session is working; never cut off an agent).
- **Once per absence**, as obie: quiet until the Patron types again.
- **Owned by the Patron.** The plugin lives in the Patron's folder and is
  installed by the Patron, like the dispatch hook: the agent cannot edit the
  thing that decides when it hands off.

## The refresh after the handoff

Handing off is half of it; something must start the fresh session. That is
W-231 (interactive self-refresh: a loop in the Patron's folder runs each
session in tmux and swaps it on a REFRESH status word). Tier 2 ends by
printing that word. Without W-231, the Patron starts the new session.

## What is needed

1. Patron decisions: 350k replaces the lex's "refresh before 500k"
   (production lex §7, a Patron amendment); idle minutes; Tier 2 at 350k
   only or at idle too.
2. Fold into W-231 (same purpose: the session refreshes itself) rather than
   a new opus; pipeline work, so the architect specs it and the Patron
   approves its design and Defaults before build.
3. Built as a plugin (manifest, `hooks/register.ts`, a contract for its
   `$.state`), with `claude plugin test` rows on a mocked clock and a mocked
   `$.session.usage`.
4. The Patron installs it from their folder.

## Open questions

- Can `$.prompt.submit` run while a permission prompt is open? (Assumed no:
  Tier 1 must need none.)
- Does the idle trigger matter for remote or desktop sessions whose own idle
  timeout differs from the cache TTL? Which "idle session timeout" is meant?

## Patron decisions (2026-10-12)

- Orchestrator session only.
- Fire at 350k or 70% of the model's window, whichever is lower; idle 50 minutes;
  both configurable. 350k replaces the lex's 500k (a Patron amendment).
- Folds into W-231's spec as Defaults. Held for the next handoff: no new PR now.
