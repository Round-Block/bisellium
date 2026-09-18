/**
 * cascades/cascade.js — W-018 (5/4): the cascade as a committed template,
 * not a one-off prompt someone reconstructs from memory every time. Plain
 * JS for the Workflow tool (see the `workflow-authoring` skill): four
 * phases, run in order, parameterized by `{ opera, now, repo }`.
 *
 * `opera` is the list of opus ids this cascade carries (e.g.
 * ["W-016","W-017","W-018","W-019"]); `now` is an ISO datetime (pinned for
 * a reproducible run, real for a live one); `repo` is the repo root the
 * whole cascade operates against.
 *
 * This module exports data (the phase list, and each phase's builder) — it
 * does not itself call any Workflow-tool API, so it stays a plain, testable
 * ESM module: `import("./cascade.js")` and read `phases` back out.
 */

/** Fixed order: Spec → Build → Verify → Close-with-Retro. */
export const phases = ["spec", "build", "verify", "close"];

/**
 * The architect phase reads each opus's brief straight from the repo
 * (`studio/briefs/<opus>.md`) — there is no separate spec store, the brief
 * *is* the spec, same file `--spec`/`--brief` point an opus at.
 */
function specPrompt({ opera, repo }) {
  return [
    `Read CLAUDE.md at ${repo}.`,
    `Run "bisellium context --sella architect studio".`,
    `For each opus in [${opera.join(", ")}], write or confirm its spec at studio/briefs/<opus>.md`,
    `(Intent · Files owned · Interfaces · Behaviours to test · Acceptance · Out of scope),`,
    `then set spec: studio/briefs/<opus>.md on the opus and move it to building`,
    `only once its spec is ready (Design lex §1, "definition of ready").`,
  ].join(" ");
}

/**
 * Every builder's prompt is the same three steps in the same order: read
 * the studio-wide contract, boot your own context, then your own brief.
 * Nothing opus-specific belongs here beyond which brief to read — the
 * brief itself carries the rest.
 */
function builderPrompt({ sella, opus }) {
  return [`Read CLAUDE.md.`, `Run "bisellium context --sella ${sella} studio".`, `Then read your brief at studio/briefs/${opus}.md and implement it exactly.`].join(
    " ",
  );
}

function verifyPrompt({ opera, repo }) {
  return [
    `For each opus in [${opera.join(", ")}], run "bisellium verify <opus> --studio studio --repo ${repo}"`,
    `and "npm run -s check -- studio --repo ${repo}" — a cascade does not close with a blocking finding outstanding.`,
  ].join(" ");
}

/**
 * The Censor closes the cascade: drafts the retro (which files lessons and
 * any petitiones a recurring finding needs), and reports the cascade's
 * numbers to the Patron.
 */
function closePrompt({ opera, repo, now, cascadeNumber }) {
  return [
    `Run "bisellium retro --cascade ${cascadeNumber} --studio studio --now ${now}".`,
    `Confirm "npm run -s check -- studio --repo ${repo}" reports zero new blocking findings for [${opera.join(", ")}].`,
  ].join(" ");
}

/**
 * Builds the ordered list of phase descriptors a Workflow-tool script runs
 * through. Each descriptor names its phase (from `phases`, in order) and
 * the prompt(s) it hands out — the Workflow tool itself decides how those
 * prompts are dispatched (single agent, one per sella, etc.); this module
 * only describes the cascade's shape.
 */
export function buildCascade({ opera, now, repo, cascadeNumber = 1, builders = [] }) {
  if (!Array.isArray(opera) || opera.length === 0) throw new Error("buildCascade: opera must be a non-empty array of opus ids");
  if (typeof now !== "string" || !now) throw new Error("buildCascade: now must be an ISO datetime string");
  if (typeof repo !== "string" || !repo) throw new Error("buildCascade: repo must be a path");

  return phases.map((phase) => {
    if (phase === "spec") return { phase, prompt: specPrompt({ opera, repo }) };
    if (phase === "build")
      return {
        phase,
        prompts: builders.length ? builders.map((b) => builderPrompt(b)) : opera.map((opus) => builderPrompt({ sella: "builder", opus })),
      };
    if (phase === "verify") return { phase, prompt: verifyPrompt({ opera, repo }) };
    return { phase, prompt: closePrompt({ opera, repo, now, cascadeNumber }) };
  });
}

export default { phases, buildCascade };
