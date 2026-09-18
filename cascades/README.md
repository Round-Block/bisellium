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
