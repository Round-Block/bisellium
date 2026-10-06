---
id: "2026-10-06-backlog-triage"
title: Triage of the older backlog (W-038..W-112) — architect, 2026-10-06 (proposal)
kind: daily
author: architect
at: 2026-10-06T08:46:33Z
---

# Older backlog triage, 2026-10-06

This is a proposal. The producer applies it through the verbs; no opus
record was changed. Every item was checked against master at `0ded9ef`
(the code, the records and `bisellium check studio`), not against its
filing note. W-092 is excluded because the Patron has already ruled on it.
Severity follows D-039: **high** means security, data loss, or a class
recorded twice (`lesson.recurrent`). **Medium** means the item came from a
blocking finding or a measured defect. **Low** means advisory or hygiene.
None of the 30 matches a class that `check` reports as recurrent today, so
the only high items are security items.

Counts: 15 fix now (2 high, 6 medium, 7 low), 9 merge, 3 close, 3 Patron.

## Triage
| id | plain description | bucket | severity or target | evidence |
|---|---|---|---|---|
| W-038 | file a question to the Patron by command | fix now | medium | No `petitio` verb exists (`usage.ts` has only `answer --petitio`). Its prerequisite W-035 is done. The filing case was a blocking `petitio.opened` finding on a hand-written P-009. |
| W-040 | correct a wrongly signed gate without erasing the old signature | fix now | medium | `ready` still refuses a `building` opus. `amend` refuses `--probationes` by name (`lifecycle.ts:1287`), so a correction can still only be made by hand. Source: blocking finding 1 in `ci/W-031-review-2.log`. |
| W-043 | a lesson's fix is recorded by command | merge | → W-137 | The greenlit W-137 (D-039 §3) has the retro step name and file each lesson's fix. That is this opus's scope. |
| W-045 | one broken record damages only itself; record writes are atomic | fix now | medium | Measured: one malformed opus in a copy of the sample officina makes the snapshot (`adapters/native/src/cli.ts`) throw `YAMLParseError`, while `check` degrades to a single `opus.parse` finding. `editOpusFrontMatter` still does a plain `writeFileSync` with no temp file and rename (`frontmatter.ts:143`). The snapshot half touches the same loop as W-115, so land it after W-115. |
| W-048 | a red's command must be runnable from the repo | close | W-125 | Superseded by `c3a1fc6` (W-125). The producer re-runs every red in a fresh clone inside the sandbox (`run-builder-host.mjs:736-770`), and `ready` stamps `builder_runtime` on every opus. A scratch-path operand fails that replay with `ENOENT`/`Cannot find module`, which `classifyReplay` refuses. |
| W-051 | support repos whose main branch is not "master" | fix now | low; land before W-149 | This has grown since it was filed. `master` is hardcoded in `next.ts:975`, `integrate.ts:179,426,546,695`, `branch.ts:296` and `rules/docs.ts:108`. It only bites an adopter on `main`, and none exists yet. |
| W-052 | builder commits reach the opus branch | close | W-125 | Fixed by `c3a1fc6` (W-125). A builder-class `run` always owns `opus/<id>` (`run.ts:203`), and the host publishes the result with `update-ref refs/heads/opus/<id>` (`run-builder-host.mjs:655`). |
| W-053 | cleanup sees every worktree | merge | → W-083 | Still real. `reclaimWorktrees` scans only `.bisellium/worktrees` (`shim/src/worktree.ts:164`), but this repo has 8 stale session worktrees under `.worktrees/` and `.kilo/`. Those worktrees are the ones W-083 creates, so cleaning them belongs to the same opus. |
| W-054 | a talked agent session can run the bisellium command | merge | → W-135 | Still real: `bisellium` is not on PATH inside the sandboxed Bash (measured this session: `command not found`). The brief prefers putting it on PATH at install time, and that is per-project agent setup, which is W-135's scope. |
| W-055 | talk records which model actually replied | merge | → W-066 | Still real. The model is read from `parsed.model` (`claude-code.ts:157`), but the claude envelope carries `modelUsage`, so the recorded value falls back to the requested model (`talk.ts:476`). It is the same parser in the same file as W-066. |
| W-058 | `red` refuses opera that are not active | fix now | low | `runRed` (`lifecycle.ts:802`) still checks neither that the opus exists nor its state or owner. Source: a should-fix from a red-team, so advisory. |
| W-059 | eight id-to-path joins skip the safety check | merge | → W-099 | Still real: raw joins at `close.ts:18`, `branch.ts:132,430,574,592`, `prune.ts:41`, `builder-run.ts:115,172,276` and `writes.ts:258`. The fix is the same shared containment helper W-099 builds, so W-099 carries both. |
| W-060 | a typo cannot count as a lesson's fix | merge | → W-137 | `classifyAddressedTarget` still falls back to `rule` (`retro.ts:154`). The blocking check `lesson.addressed_by` already catches a typo or a dangling id (`rules/process.ts:345`), so what is left is the retro's own reading, which W-137 rewrites. |
| W-061 | the tool dispatches a build on either vendor | merge | → W-118 (split) | Still real. bisellium dispatches no harness itself: `run` executes whatever command it is given, and `next` only names the actor. Having the tool dispatch agents is the core of W-118, so this should become one of its child opera. It also links to W-154's change of a seat's harness. |
| W-066 | talk cannot resume a conversation | fix now | medium; W-146 depends on it | The error message half is fixed: `vendorDiagnostic` (`talk.ts:420`, W-046 `604534d`) now shows the vendor's error. The resume itself failed on master in `ci/W-046-review-1.log:210-219`, and `claude-code.ts` has not changed since. Not re-run live, because that would spend vendor tokens. W-146's talk from the console needs a working resume. |
| W-070 | the console from your phone, on your private network only | Patron | — | Not built: no Tailscale or PWA code exists. The threat model (`acta/2026-09-25-w070-threat-model.md`) needs three Patron decisions before merge, and the desktop app (W-151) is now planned for the same milestone. |
| W-073 | answer from the Board's detail drawer | fix now | low; waits on W-078's ruling | Still real: the drawer only links to the Inbox (`BoardDrawer.tsx:35-41`). The drawer shows the "waiting on you" banner only while a human gate is pending (`lib/board.ts:338`), and none is declared. |
| W-074 | approve work from the Board | fix now | medium | `/api/greenlight` exists (`http.ts:773`), but nothing on the Board calls it. Under D-041, approving work is the Patron's main action and needs a console path. |
| W-078 | add a step that waits on the Patron, so "Needs you" can fill | Patron | — | Still real: `bisellium.yml` declares no gate of kind `human`, so the "Needs you" column cannot fill (`lib/board.ts:91`). Its title marks it as an architecture call. |
| W-080 | `check` flags a spec gate signed by the opus's own builder | fix now | low | No such rule exists (only `process.cascade`, `rules/process.ts:295`). `next` now sends spec work to the architect and reds to the builder (`next.ts:636`), so only a hand-run path is left. L-042 sits in one cascade, so it is not recurrent. |
| W-081 | provider status runs an unpinned package from the internet | fix now | high (security) | `quotaAxiSource` defaults to `npx --yes quota-axi` (`providers/src/index.ts:228`). `runProviders` calls it with no command (`providers.ts:51`), so plain `bisellium providers` (a talk-allowed command) downloads and runs whatever is published under that name. W-072's spend sentinel covers only claude and codex. |
| W-083 | orchestrating sessions work in their own copies | fix now | medium | Still real: no hook or rule refuses a commit made in the shared checkout. Two architect runs share this checkout today. `next` isolates only opus work (`.worktrees/<id>`, `integrate.ts:152`). W-160's memo on running leads at the same time should cite it. |
| W-086 | finished tasks stop showing as needing a handoff update | fix now | low | Measured: `tick --dry-run` lists `traditio` as due for done opera W-001..W-031+, because `computeDue` has no state filter (`tick.ts:200-208`). `check` already limits this to active opera (`check.ts:480`). |
| W-093 | a security review on every PR | Patron | — | D-026 scopes the security seat to opera that touch logins, network or secrets, and only as input to the single review. Running it on every PR widens that scope and its cost. |
| W-094 | the test spend sentinel refuses symlinks | fix now | medium | Still real: the `mkdirSync` of the lock's directory and the `writeFileSync` of the log in `scripts/no-vendor.mjs:111,155` follow a symlinked `.bisellium/`. The security lead filed it as "hardening, not escalation", and the path is local and untracked. |
| W-097 | old evidence archived by command | close | W-131 | Superseded by W-131 (done). `prune` removes uncited gate logs of done opera through a verb, never deleting a cited log (`prune.ts`, `briefs/W-131.md:111-133`). `ci/` went from 1216 files to 535. |
| W-098 | the failed-import detector reads only failing test rows | fix now | low | Still real: `isModuleLoadFailure` scans the whole log (`rules/evidence.ts:192`) at advisory level. The replay's `POISON` scan has the same whole-output shape (`replay-accept.mjs:10`), and that one refuses; include it in this fix. |
| W-099 | every write stays anchored inside the studio | fix now | high (security); carries W-059 | Still real: the reds, verdict and handoff writers resolve paths textually, with no realpath check (`lifecycle.ts:779`, `verdict.ts:399`). `readContainedRegularFile` guards reads only. Class L-063 (`security×symlink-parent-write-escape`). |
| W-100 | a fix round's red never erases round one's | merge | → W-058 | Still real: `runRed` writes `NN.log` with no refusal to overwrite (`lifecycle.ts:928`), unlike verdict's `wx`. It is the same writer and guard site as W-058. |
| W-112 | the Board shows one bottom timestamp | merge | → W-136 | Still real: `BoardView.tsx:145-146` shows both the liveness label and the colophon. W-136 redesigns that liveness surface (last-seen age per seat), and its UI ruling decides which timestamp stays. |

## Questions for the Patron

1. W-070: Now that a desktop app is planned, do you still want the console reachable from your phone over your private Tailscale network?
2. W-078: Should some work stop and wait for your approval at a named step (for example, signing off a screen before it merges), so the Board's "Needs you" column fills?
3. W-093: Should every change get a separate security review next to the main review, or only changes that touch logins, network or secrets, as now?
