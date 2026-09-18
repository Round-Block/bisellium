/**
 * packages/cli/src/writes.test.ts — W-012 (handoff, emit, answer,
 * greenlight, budget), against temp copies of examples/sample-studio.
 * `now` is pinned to 2026-09-18T14:00:00Z so every timestamp written here
 * is reproducible.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { WF } from "@bisellium/schema";
import { checkStudio } from "./check.js";
import { splitFront } from "./frontmatter.js";
import { runHandoff, runEmit, runAnswer, runGreenlight, runBudget } from "./writes.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T14:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-writes-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

function blockIds(dir: string): string[] {
  return [...new Set(checkStudio(dir, NOW).findings.filter((f) => f.level === "block").map((f) => f.rule))].sort();
}

function readEventLines(dir: string): Record<string, unknown>[] {
  const path = join(dir, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

try {
  // ---- handoff: touches only traditio, everything else round-trips ------
  {
    const dir = freshStudio("handoff");
    const opusPath = join(dir, "opera", "W-002.md");
    const before = readFileSync(opusPath, "utf8");
    const beforeSplit = splitFront(before)!;
    const beforeFront = parseYaml(beforeSplit.front) as Record<string, unknown>;

    const r = runHandoff(
      ["--opus", "W-002", "--sella", "builder-1", "--stage", "building", "--next", "ship the filter", "--blocked-on", "none", "--studio", dir],
      { now: NOW },
    );
    check("handoff: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const after = readFileSync(opusPath, "utf8");
    const afterSplit = splitFront(after)!;
    const afterFront = parseYaml(afterSplit.front) as Record<string, unknown>;

    check("handoff: body byte-for-byte unchanged", afterSplit.body === beforeSplit.body, JSON.stringify({ before: beforeSplit.body, after: afterSplit.body }));

    const { traditio: _beforeTraditio, ...beforeRest } = beforeFront;
    const { traditio: afterTraditio, ...afterRest } = afterFront;
    check("handoff: keys other than traditio unchanged", JSON.stringify(beforeRest) === JSON.stringify(afterRest), JSON.stringify({ beforeRest, afterRest }));

    check(
      "handoff: traditio updated as requested",
      JSON.stringify(afterTraditio) ===
        JSON.stringify({ sella: "builder-1", stage: "building", next: "ship the filter", blocked_on: "none", at: NOW.toISOString() }),
      JSON.stringify(afterTraditio),
    );

    // --stage mismatch is a validation error
    const mismatch = runHandoff(
      ["--opus", "W-002", "--sella", "builder-1", "--stage", "review", "--next", "x", "--studio", dir],
      { now: NOW },
    );
    check("handoff: --stage mismatching opus state exits 2", mismatch.exitCode === 2, String(mismatch.exitCode));

    // unknown sella is a validation error
    const unknownSella = runHandoff(
      ["--opus", "W-002", "--sella", "nobody", "--next", "x", "--studio", dir],
      { now: NOW },
    );
    check("handoff: unknown sella exits 2", unknownSella.exitCode === 2, String(unknownSella.exitCode));
  }

  // ---- emit: appends a parseable event -----------------------------------
  {
    const dir = freshStudio("emit");
    const r = runEmit(['{"name":"workflow.custom","attrs":{"foo":"bar"}}', "--studio", dir], { now: NOW });
    check("emit: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const events = readEventLines(dir);
    check("emit: exactly one event on disk", events.length === 1, String(events.length));
    const e = events[0] as { name?: unknown; ts?: unknown; attrs?: Record<string, unknown> };
    check("emit: event name preserved", e.name === "workflow.custom", JSON.stringify(e));
    check("emit: event ts is pinned now", e.ts === NOW.toISOString(), String(e.ts));
    check("emit: attrs carried through", e.attrs?.["foo"] === "bar", JSON.stringify(e.attrs));
    check("emit: attrs stamped with source=cli", e.attrs?.[WF.SOURCE] === "cli", JSON.stringify(e.attrs));
    check("emit: attrs stamped with seq 0", e.attrs?.[WF.SOURCE_SEQ] === 0, JSON.stringify(e.attrs));

    const second = runEmit(['{"name":"workflow.custom"}', "--studio", dir], { now: NOW });
    check("emit: second event exitCode 0", second.exitCode === 0, String(second.exitCode));
    const secondSeq = (readEventLines(dir)[1] as { attrs?: Record<string, unknown> }).attrs?.[WF.SOURCE_SEQ];
    check("emit: seq increments off the log length", secondSeq === 1, String(secondSeq));

    check("emit: invalid JSON exits 2", runEmit(["not json", "--studio", dir], { now: NOW }).exitCode === 2);
    check("emit: missing name exits 2", runEmit(["{}", "--studio", dir], { now: NOW }).exitCode === 2);
  }

  // ---- answer: resolves A-1 with a [stated] line, passes check ----------
  {
    const dir = freshStudio("answer");
    const r = runAnswer(["--petitio", "A-1", "Ship", "both", "screens.", "--studio", dir], { now: NOW });
    check("answer: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const petitioPath = join(dir, "petitiones", "A-1.md");
    const raw = readFileSync(petitioPath, "utf8");
    const split = splitFront(raw)!;
    check(
      "answer: appends a [stated] line to the body",
      split.body.includes(`[stated] ${NOW.toISOString()} patron: Ship both screens.`),
      split.body,
    );
    const front = parseYaml(split.front) as Record<string, unknown>;
    check("answer: state -> resolved", front["state"] === "resolved", JSON.stringify(front));

    const result = checkStudio(dir, NOW);
    check("answer: studio passes check", result.ok, result.ok ? "" : `blocked by ${blockIds(dir).join(", ")}`);
  }

  // ---- answer --ask-back: flips direction to awaiting_reply --------------
  {
    const dir = freshStudio("answer-ask-back");
    const beforeFront = readFront<{ from: string; to: string }>(join(dir, "petitiones", "A-1.md")).data;
    const r = runAnswer(["--petitio", "A-1", "What", "about", "QA?", "--ask-back", "--studio", dir], { now: NOW });
    check("answer --ask-back: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const front = readFront<{ state: string; from: string; to: string }>(join(dir, "petitiones", "A-1.md")).data;
    check("answer --ask-back: state -> awaiting_reply", front.state === "awaiting_reply", front.state);
    check("answer --ask-back: from is now the patron", front.from === "patron", JSON.stringify(front));
    check("answer --ask-back: to is the original asker", front.to === beforeFront.from, JSON.stringify(front));

    const result = checkStudio(dir, NOW);
    check("answer --ask-back: studio passes check", result.ok, result.ok ? "" : `blocked by ${blockIds(dir).join(", ")}`);
  }

  // ---- answer --charter-gap: proposes an amendment via a new acta -------
  {
    const dir = freshStudio("answer-charter-gap");
    const before = new Set(readdirSync(join(dir, "acta")));
    const r = runAnswer(["--petitio", "A-1", "Cutting", "split", "stacks.", "--charter-gap", "--studio", dir], { now: NOW });
    check("answer --charter-gap: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const after = readdirSync(join(dir, "acta")).filter((f) => !before.has(f));
    check("answer --charter-gap: one new acta file", after.length === 1, JSON.stringify(after));
    if (after[0]) {
      const front = readFront<{ author: string; kind: string; title: string }>(join(dir, "acta", after[0])).data;
      check("answer --charter-gap: author is the patron", front.author === "patron", front.author);
      check("answer --charter-gap: kind is decision", front.kind === "decision", front.kind);
      check("answer --charter-gap: title proposes a lex gap", front.title.startsWith("Lex gap:"), front.title);
    }

    const result = checkStudio(dir, NOW);
    check("answer --charter-gap: studio passes check", result.ok, result.ok ? "" : `blocked by ${blockIds(dir).join(", ")}`);
  }

  // ---- greenlight: W-007 backlog -> greenlit, second call exits 2 -------
  {
    const dir = freshStudio("greenlight");
    const first = runGreenlight(["W-007", "--studio", dir], { now: NOW });
    check("greenlight: first call exitCode 0", first.exitCode === 0, String(first.exitCode));

    const front = readFront<{ state: string }>(join(dir, "opera", "W-007.md")).data;
    check("greenlight: W-007 is now greenlit", front.state === "greenlit", front.state);

    const events = readEventLines(dir);
    check("greenlight: exactly one greenlight event", events.length === 1, String(events.length));
    const e = events[0] as { name?: unknown; attrs?: Record<string, unknown> };
    check("greenlight: event name is workflow.greenlight", e.name === "workflow.greenlight", JSON.stringify(e));
    check("greenlight: event records granted", e.attrs?.[WF.GREENLIGHT] === "granted", JSON.stringify(e.attrs));

    const second = runGreenlight(["W-007", "--studio", dir], { now: NOW });
    check("greenlight: second call exits 2 (no longer in backlog)", second.exitCode === 2, String(second.exitCode));

    const result = checkStudio(dir, NOW);
    check("greenlight: studio passes check", result.ok, result.ok ? "" : `blocked by ${blockIds(dir).join(", ")}`);
  }

  // ---- greenlight --decline: stays in backlog, records why ---------------
  {
    const dir = freshStudio("greenlight-decline");
    const r = runGreenlight(["W-007", "--decline", "not this sprint", "--studio", dir], { now: NOW });
    check("greenlight --decline: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const front = readFront<{ state: string; declined: string }>(join(dir, "opera", "W-007.md")).data;
    check("greenlight --decline: stays in backlog", front.state === "backlog", front.state);
    check("greenlight --decline: records the reason", front.declined === "not this sprint", front.declined);

    const e = readEventLines(dir)[0] as { attrs?: Record<string, unknown> };
    check("greenlight --decline: event records declined", e.attrs?.[WF.GREENLIGHT] === "declined", JSON.stringify(e.attrs));
  }

  // ---- budget: creates 2026-W39.yml, check accepts, refuses --burn-* -----
  {
    const dir = freshStudio("budget");
    const r = runBudget(["2026-W39", "--collegium", "engineering", "--tokens", "2500000", "--studio", dir], { now: NOW });
    check("budget: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const path = join(dir, "aerarium", "2026-W39.yml");
    check("budget: creates 2026-W39.yml", existsSync(path));
    const parsed = parseYaml(readFileSync(path, "utf8")) as { period: string; collegia: Record<string, { stipendium_tokens: number }> };
    check("budget: period matches", parsed.period === "2026-W39", parsed.period);
    check("budget: tokens recorded", parsed.collegia["engineering"]?.stipendium_tokens === 2500000, JSON.stringify(parsed.collegia));

    const result = checkStudio(dir, NOW);
    check("budget: studio passes check", result.ok, result.ok ? "" : `blocked by ${blockIds(dir).join(", ")}`);

    const bad = runBudget(["2026-W39", "--collegium", "engineering", "--tokens", "1", "--burn-anything", "9", "--studio", dir], { now: NOW });
    check("budget: refuses --burn-anything", bad.exitCode === 2, String(bad.exitCode));
    const unchanged = parseYaml(readFileSync(path, "utf8")) as { collegia: Record<string, { stipendium_tokens: number }> };
    check("budget: file untouched after the refused call", unchanged.collegia["engineering"]?.stipendium_tokens === 2500000, JSON.stringify(unchanged.collegia));

    const badPeriod = runBudget(["2026-39", "--collegium", "engineering", "--tokens", "1", "--studio", dir], { now: NOW });
    check("budget: malformed period exits 2", badPeriod.exitCode === 2, String(badPeriod.exitCode));

    const badCollegium = runBudget(["2026-W40", "--collegium", "no-such", "--tokens", "1", "--studio", dir], { now: NOW });
    check("budget: unknown collegium exits 2", badCollegium.exitCode === 2, String(badCollegium.exitCode));

    const withHours = runBudget(["2026-W39", "--collegium", "art", "--tokens", "100000", "--hours", "40", "--studio", dir], { now: NOW });
    check("budget: --hours accepted", withHours.exitCode === 0, String(withHours.exitCode));
    const withHoursParsed = parseYaml(readFileSync(path, "utf8")) as { collegia: Record<string, { stipendium_tokens: number; stipendium_hours: number }> };
    check("budget: --hours recorded, engineering untouched", withHoursParsed.collegia["art"]?.stipendium_hours === 40 && withHoursParsed.collegia["engineering"]?.stipendium_tokens === 2500000, JSON.stringify(withHoursParsed.collegia));
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
