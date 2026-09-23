# Mast persistence discipline: what Bisellium actually lacks

eng-lead, 2026-09-23, against `6c285cc`. Input: the Codex Mast note (read as data).

**Verdict:** deliverables 1 and 5 and most Mast disciplines already exist. Three gaps are real: the talk harness is no permission boundary, orchestrator recovery rests on prose, and one corrupt record blinds every boot. Atomic writes are a cheap fourth.

## Status

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Record schemas + invariants | HAVE | `checkStudio` (`packages/cli/src/check.ts`): `opus.*`, `petitio.*`, `acta.*`, `manifest.shape` for roles; `rules/process.ts`: `decision.kill`, `lesson.shape/evidence/addressed_by`; evidence is `probationes.*.certifies: tree:<hash>` |
| 2 | Orchestrator recovery from records | PARTIAL | `context` is per-sella (`packages/commands/src/context.ts`): own active opera plus own collegium index. A `producer` or `guest` boot (the SessionStart default) cannot see W-023, W-027 or W-042 (building). Real recovery is `docs/SESSION-HANDOFF.md`: 2958 words, "Where things stand" dated cascade 22. `tick --dry-run` lists 29 `traditio` dues including done opera (`tick.ts:159-167`, no state filter) |
| 3 | Standing docs + compaction triggers | PARTIAL | The triggers exist: PreCompact re-injects `context` (`.claude/settings.json`), `retro --cascade`, and `process.checkpoint` (`rules/process.ts:323`). The orchestrator's standing doc is still prose. W-041 (backlog) generates the slate, but only for the dossier |
| 4 | Worker contract | PARTIAL | Worktree isolation, file ownership (lex §2); censor has no Write/Edit (`.claude/agents/censor.md`); gates only via CLI verbs. But `--sella` is self-declared (`lifecycle.ts` `resolveSella`) and `process.cascade` is advise-only |
| 5 | Lesson promotion | HAVE, one leg missing | Promotion is evidence-backed (`lesson.evidence`), scoped (`class`, per-collegium lex), reversible (blocking `kill_when`, `supersedes`, lex amendment log) and Patron-gated (petitiones). Missing: once a lesson class is addressed, `lesson.recurrent` stays silent for good (`process.ts:293-300`), so it never reports a fix that did not hold |
| 6 | Versioned envelope | HAVE | `bisellium: 1` is checked by `manifest.version`, which blocks (`check.ts:182`). This is officina-level versioning; per-record versions are not needed |
| 7 | Validation | HAVE | `check`. The write seam also refuses unparseable YAML: `yaml`'s `Document.toString()` throws before `writeFileSync` (verified) |
| 8 | Atomic temp-file writes | MISSING | There are no rename calls in `packages/`. `editOpusFrontMatter` writes in place (`packages/commands/src/frontmatter.ts:53`). The rollback in `writes.ts` (answer, greenlight, budget) is logical, not crash-safe |
| 9 | Corruption preservation | PARTIAL | Git backs tracked records; writers never overwrite a corrupt file (row 7). Readers disagree (W-001 corrupted in a fixture copy): `check` blocks with `opus.parse`; `tick` skips silently; `context` and `query` say "not a studio", exit 2 (`context.ts:79-83`) |
| 10 | Narrow migrations | HAVE | `scripts/sweep-traditio-stage.mjs` re-runs the real verb; lex §2 covers mechanical work |
| 11 | Clear ephemeral handles | HAVE | Receipts, sessions, timeline, `events.jsonl`, `health.json` are gitignored, never durable. `sella.stale` flags open receipts (`check.ts:660-664`); `run --reclaim` removes stale worktrees |
| 12 | Bounded transient output | HAVE | Evidence logs keep the last 200 lines and are redacted (`packages/pipeline/src/index.ts:49,97`). `context --max-tokens` truncates by priority |
| 13 | No worker-to-worker execution | MISSING as a boundary | See below |

### The `send` finding applies here

The "read-only" talk profile allows `Bash(bisellium *)` (`packages/shim/src/harness/claude-code.ts:28`). That prefix admits three kinds of command:

- `bisellium run … -- <cmd>`, which spawns an arbitrary command (`run.ts:213`)
- `bisellium red … -- <cmd>`
- `bisellium greenlight`, `answer` and `budget`, which `main.ts:113` stamps `BISELLIUM_ROLE=patron` for any caller

`tick` drives talk unattended for dailies, so studio-file text can reach arbitrary execution and forged Patron writes with no human present. Also, any Bash-holding subagent can `bisellium talk --sella <other>`, resuming that sella's persisted session (`sessions/<sella>.json`): Mast's `send` shape.

The single censor gate and orchestrator-only dispatch hold by convention and after-the-fact advisories over self-declared ids, not by refusal.

## Ranked remedies

1. **Narrow the talk tool list.** Replace `Bash(bisellium *)` with read verbs only: `context`, `query`, `check`, `providers`. Add a test that the profile's args admit no `run`, `red`, `greenlight`, `answer` or `budget`. *Value: high. It closes the only unattended path from file content to execution and Patron signatures.*
2. **Orchestrator context from records.** For the `kind: orchestrator` sella, `context` renders every opus in greenlit, building, verifying, review or halted across collegia, with its traditio, pending gates and open petitiones. `tick`'s traditio due also skips `done`. Build it alongside W-041 (same data). Then delete "Where things stand" from SESSION-HANDOFF. *Value: high. Every session boot recovers state from stale prose today.*
3. **Per-record read degradation.** `snapshotDir` skips unreadable records and reports them. `context` and `query` print `unreadable: opera/W-001.md — run bisellium check` instead of "not a studio". *Value: medium-high. One conflict marker in one opus currently blocks every boot.*
4. **Atomic write in the one seam.** `editOpusFrontMatter` writes to a same-directory temp file, then `renameSync`. That covers verify, writes and lifecycle. *Value: low-medium. It protects the window between a CLI write and the commit. It is about ten lines.*
5. **`lesson.recurrent` regression leg.** A lesson whose `at` falls after its addressing record's date fires again as "addressed by X, recurred". *Value: medium. It is the missing check that a fix actually held.*

## Where the research is wrong or conflicts

- **Deliverables 1 and 5 already exist.** The note surveys Mast only and describes Bisellium's record layer as future work.
- **Orchestrator validating worker proposals before dispatch.** That would be a second gate, which D-014 forbids: the censor is the single review and QA gate.
- **An "authorized execution path" command.** D-016 says the CLI wraps an operation only when refusing it is the point. Remedy 1 is a refusal; a dispatch wrapper would not be.
- **Maintained standing documents** (project state, current plan). These contradict the standing rule "enforcement is a check rule or a hook, never prose", the handoff's own kill clause, and W-041's thesis. Standing docs should be generated views.
- **JSON state envelope or `.bak` corruption copies.** An envelope breaks the markdown front-matter contract (`docs/ADOPTION.md`). Untracked `.bak` files in `studio/` would dirty the tree, the same failure `.gitignore` documents for stray worktrees, and `verify` would mint `dirty:` certificates.
