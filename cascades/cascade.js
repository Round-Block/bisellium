/**
 * cascades/cascade.js — W-018 (5/4): the cascade as a committed template,
 * not a one-off prompt someone reconstructs from memory every time. Plain
 * JS for the Workflow tool (see the `workflow-authoring` skill): four
 * phases, run in order, parameterized by `{ opera, now, repo }`.
 *
 * `opera` is the list of opus ids this cascade carries; `now` is an ISO
 * datetime (pinned for a reproducible run, real for a live one); `repo`
 * is the repo root the whole cascade operates against.
 *
 * Sizing (how many opera, how many reviewers per opus, which model drives
 * the first hour, …) is data too — D-012 ("Cascade sizing") points at
 * `cascades/sizing.json`, and `loadSizing`/`buildCascade` read it from
 * there rather than hardcoding the numbers a second time here.
 *
 * This module exports data (the phase list, and each phase's builder) — it
 * does not itself call any Workflow-tool API, so it stays a plain, testable
 * ESM module: `import("./cascade.js")` and read `phases` back out.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZING_PATH = join(dirname(fileURLToPath(import.meta.url)), "sizing.json");

/** Reads cascades/sizing.json — the numbers D-012 names, as data. Never
 *  caches: this file is small, rarely read (once per cascade build), and
 *  a hand-edit to it should take effect on the very next call. */
export function loadSizing() {
  return JSON.parse(readFileSync(SIZING_PATH, "utf8"));
}

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
function builderPrompt({ sella, opus }, sizing) {
  const firstHour = sizing?.firstHourBuilderModel
    ? ` Your first hour on this opus runs on ${sizing.firstHourBuilderModel} (D-012, cascade sizing) — escalate to a heavier model only once that hour's actually spent, not pre-emptively.`
    : "";
  return [
    `Read CLAUDE.md.`,
    `Run "bisellium context --sella ${sella} studio".`,
    `Then read your brief at studio/briefs/${opus}.md and implement it exactly.${firstHour}`,
  ].join(" ");
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
function closePrompt({ opera, repo, now, cascadeNumber, sizing }) {
  const mutation = sizing?.mutationOpusPerCascade
    ? ` Run the mutation-testing step (D-010) against ${sizing.mutationOpusPerCascade} opus this cascade, per D-012's sizing — not every opus, not zero.`
    : "";
  return [
    `Run "bisellium retro --cascade ${cascadeNumber} --studio studio --now ${now}".${mutation}`,
    `Confirm "npm run -s check -- studio --repo ${repo}" reports zero new blocking findings for [${opera.join(", ")}].`,
    `Confirm docs/ARCHITECTURE.md reflects any dependency-edge, seam, lifecycle or route change this cascade made`,
    `(Design lex §2; regenerate the module-graph block with "node scripts/arch-graph.mjs", never by hand) — a stale`,
    `architecture doc is a finding for the retro, not a silent omission.`,
  ].join(" ");
}

/**
 * Builds the ordered list of phase descriptors a Workflow-tool script runs
 * through. Each descriptor names its phase (from `phases`, in order) and
 * the prompt(s) it hands out — the Workflow tool itself decides how those
 * prompts are dispatched (single agent, one per sella, etc.); this module
 * only describes the cascade's shape.
 */
export function buildCascade({ opera, now, repo, cascadeNumber = 1, builders = [], sizing = loadSizing() }) {
  if (!Array.isArray(opera) || opera.length === 0) throw new Error("buildCascade: opera must be a non-empty array of opus ids");
  if (typeof now !== "string" || !now) throw new Error("buildCascade: now must be an ISO datetime string");
  if (typeof repo !== "string" || !repo) throw new Error("buildCascade: repo must be a path");
  if (typeof sizing?.operaPerCascade === "number" && opera.length !== sizing.operaPerCascade) {
    throw new Error(
      `buildCascade: cascades/sizing.json (D-012) calls for ${sizing.operaPerCascade} opera per cascade, got ${opera.length}: [${opera.join(", ")}] — pass a different sizing to override deliberately`,
    );
  }

  return phases.map((phase) => {
    if (phase === "spec") return { phase, prompt: specPrompt({ opera, repo }) };
    if (phase === "build")
      return {
        phase,
        prompts: builders.length
          ? builders.map((b) => builderPrompt(b, sizing))
          : opera.map((opus) => builderPrompt({ sella: "builder", opus }, sizing)),
      };
    if (phase === "verify") return { phase, prompt: verifyPrompt({ opera, repo }) };
    return { phase, prompt: closePrompt({ opera, repo, now, cascadeNumber, sizing }) };
  });
}

export default { phases, buildCascade, loadSizing };
