# Cascades

A cascade is Bisellium's own multi-agent workflow, run through the Claude
Code Workflow tool against `cascade.js`. It has four phases, always in this
order:

1. **Spec** — the architect (Design collegium) reads or confirms each
   opus's brief at `studio/briefs/<opus>.md`, and only moves an opus to
   `building` once its spec is ready (Design lex §1). `bisellium new
   --brief` scaffolds a brief's six sections (Intent · Files owned ·
   Interfaces · Behaviours to test · Acceptance · Out of scope) if one
   doesn't exist yet.
2. **Build** — each sella gets the same three-step prompt: read
   `CLAUDE.md`, run `bisellium context --sella <you> studio` to boot its
   own context, then read and implement its own brief. Nothing
   opus-specific belongs in the prompt beyond which brief to read.
3. **Verify** — `bisellium verify <opus> --studio studio --repo <repo>`
   for every opus the cascade touched, then `npm run -s check -- studio
   --repo <repo>`. A cascade does not close with a blocking finding
   outstanding.
4. **Close-with-Retro** — the Censor (`qa-lead`) runs `bisellium retro
   --cascade <N> --studio studio`, which drafts the cascade's acta entry,
   files one lesson per distinct finding class (refusing to write anything
   if any finding's evidence is empty or dead), proposes adopting advisory
   rules alone or escalating recurring ones to the Patron via a petitio, and
   lists (never edits) any decision whose `kill_when` the cascade's own
   findings suggest has been met.

## Launching a cascade

```js
import { buildCascade, phases } from "./cascade.js";

const steps = buildCascade({
  opera: ["W-016", "W-017", "W-018", "W-019"],
  now: "2026-09-18T20:00:00Z",
  repo: "/home/edckt/projects/bisellium",
  cascadeNumber: 4,
  builders: [
    { sella: "builder-a", opus: "W-016" },
    { sella: "builder-b", opus: "W-017" },
    { sella: "builder-c", opus: "W-018" },
    { sella: "builder-d", opus: "W-019" },
  ],
});
```

`phases` is `["spec", "build", "verify", "close"]`, fixed. `buildCascade`
returns one descriptor per phase — `{ phase, prompt }` for spec/verify/close,
`{ phase, prompts }` (one per builder) for build — which the Workflow tool
script dispatches to the sellae named in `builders`; this module only
describes the cascade's shape, it never calls the Workflow tool itself.

## Usage tracking

`cascade.js` itself cannot see tokens — it only describes prompts for the
Workflow tool to run; the orchestrator driving that tool is the only thing
that ever sees each agent's real spend, in the Workflow output it gets back
once a run finishes.

That's why usage is recorded from the outside, after the fact, not from
inside `cascade.js`:

1. The orchestrator records each agent's usage into the officina as it
   happens (or in a batch at Close), one `bisellium emit --usage <tokens>
   --opus <id> --sella <id> --model <model> --studio studio` call per
   agent — this is what makes a `gen_ai.usage` event real, attributable
   evidence in `events.jsonl` rather than a number someone remembers, and
   is what `burn` (packages/core/src/index-db.ts) sums to derive a
   collegium's spend against its aerarium.
2. Before Close, the orchestrator builds the same numbers into a retro
   usage JSON (`RetroInput["usage"]`, packages/cli/src/retro.ts) and
   passes it to `bisellium retro --cascade <N> --from <usage.json>
   --studio studio` — the Censor's retro then carries a "Usage" section:
   totals, checking/building ratio (Opus verify+review tokens ÷ builder
   tokens), tokens per opus, the trend against the previous retro, and
   posture read from the current aerarium.

`scripts/usage-from-workflow.mjs` is the documented bridge for both steps:
it reads a Workflow output file's `workflowProgress.agents` array
(`{ label, model, tokens, durationMs }`), maps each label to a
`{ sella, opus, role }` via a `--builders <path>` file (the same
`builders` list `buildCascade` was called with), and prints the `emit
--usage` commands plus the retro usage JSON in one pass:

```sh
node scripts/usage-from-workflow.mjs <workflow-output.json> \
  --builders builders.json --studio studio --cascade 4 \
  --out usage-cascade-4.json
```

`builders.json` is `[{ "label": "...", "sella": "...", "opus": "...",
"role": "..." }]` — `role` is free text matched by substring against
/build/ and /review|verify|censor/ for the retro's checking/building
ratio (`role: "builder"`, `"reviewer"`, `"verifier"`, …, not a manifest
sella `kind`). An agent label with no matching `--builders` entry is
skipped from the `emit` commands (there's nothing to attribute it to) but
still counted in the usage JSON's totals — see the script's own header
comment for the full contract.

## What each role does

- **Design** (architect): owns readiness. Nothing enters `building`
  without a spec (`state.building.spec`).
- **Engineering** (Fabri, eng-lead + builders): test-first with a recorded
  red; mechanical work is a script; one opus owns its declared files.
- **QA** (the Censor, qa-lead): drives the first hour, closes the last one,
  owns the retrospectio, and may adopt an advisory rule alone — a
  blocking-rule or lex-wording proposal always goes to the Patron as a
  petitio.
- **Production** (the Aedile, producer): the WIP cap and the slate; refuses
  a `done` claim the recorded gates don't support.
