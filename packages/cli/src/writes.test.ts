/**
 * packages/cli/src/writes.test.ts — W-012 (handoff, emit, answer,
 * greenlight, budget), against temp copies of examples/sample-studio.
 * `now` is pinned to 2026-09-18T14:00:00Z so every timestamp written here
 * is reproducible.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { readFront } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL } from "@bisellium/core";
import { WF } from "@bisellium/schema";
import { checkStudio } from "./check.js";
import { splitFront } from "./frontmatter.js";
import { runHandoff, runEmit, runAnswer, runGreenlight, runBudget, safeItemPath } from "./writes.js";

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
  const path = join(dir, EVENTS_LOG_REL);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

try {
  // ---- behaviour 1 (W-047): safeItemPath's contract, over every row of one
  //      hostile-id table in one loop — a refusal is never a sanitize, and
  //      no id is ever rewritten. `base` is a temp dir, not a studio: no row
  //      depends on anything existing on disk. -----------------------------
  {
    const base = mkdtempSync(join(tmpdir(), "bisellium-safeitempath-"));
    dirs.push(base);

    const rows: { id: string; expected: "accepted" | "refused" }[] = [
      { id: "W-001", expected: "accepted" },
      { id: "", expected: "refused" },
      { id: ".", expected: "refused" },
      { id: "..", expected: "refused" },
      { id: "../W-001", expected: "refused" },
      { id: "../../etc/passwd", expected: "refused" },
      { id: "/etc/passwd", expected: "refused" },
      { id: "a/b", expected: "refused" },
      { id: "opera/../../x", expected: "refused" },
      { id: "..\\..\\win.ini", expected: "refused" },
      { id: "C:\\Windows\\win.ini", expected: "refused" },
      { id: "..W-001", expected: "accepted" }, // ".." is not a segment here
      { id: "%2e%2e%2fW-001", expected: "accepted" }, // contained, never decoded
      { id: "\u2215W-001", expected: "accepted" }, // U+2215 division slash, not a path separator
      { id: "W-001\u0000x", expected: "accepted" }, // embedded NUL; existsSync on the result must not throw
    ];

    for (const { id, expected } of rows) {
      const r = safeItemPath(base, id);
      const label = `1. safeItemPath(${JSON.stringify(id)})`;
      if (expected === "refused") {
        check(`${label}: refused`, typeof r !== "string", JSON.stringify(r));
        if (typeof r !== "string") check(`${label}: error names the id`, r.error.includes(id), r.error);
      } else {
        check(`${label}: accepted`, typeof r === "string", JSON.stringify(r));
        if (typeof r === "string") {
          check(`${label}: dirname is exactly resolve(base)`, dirname(r) === resolve(base), r);
          check(`${label}: basename is id + ".md" — never sanitized`, basename(r) === `${id}.md`, r);
          check(`${label}: contained under resolve(base)`, r.startsWith(resolve(base) + sep), r);
          let existsThrew = false;
          try {
            existsSync(r);
          } catch {
            existsThrew = true;
          }
          check(`${label}: existsSync on the result does not throw`, !existsThrew);
        }
      }
    }

    // Two base-shape assertions, outside the table: the same id answers
    // identically whether `base` carries a trailing separator, and whether
    // `base` is relative to process.cwd() — resolve() happens inside the
    // helper, not at the call site.
    check(
      "1. base with a trailing separator answers identically",
      JSON.stringify(safeItemPath(base + sep, "W-001")) === JSON.stringify(safeItemPath(base, "W-001")),
    );
    const relBase = relative(process.cwd(), base) || ".";
    check(
      "1. a base relative to process.cwd() answers identically",
      JSON.stringify(safeItemPath(relBase, "W-001")) === JSON.stringify(safeItemPath(base, "W-001")),
    );
  }

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

  // ---- emit --usage: a shortcut that appends a gen_ai.usage event --------
  // so `burn` (packages/core/src/index-db.ts) derives collegium spend from
  // real recorded usage instead of nothing at all. No <json> positional is
  // needed for this form.
  {
    const dir = freshStudio("emit-usage");
    const r = runEmit(["--usage", "1234", "--opus", "W-002", "--sella", "builder-1", "--model", "claude-sonnet-5", "--studio", dir], { now: NOW });
    check("emit --usage: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const events = readEventLines(dir);
    check("emit --usage: exactly one event on disk", events.length === 1, JSON.stringify(events));
    const e = events[0] as { name?: unknown; attrs?: Record<string, unknown> };
    check("emit --usage: event name is gen_ai.usage", e.name === "gen_ai.usage", JSON.stringify(e));
    check("emit --usage: gen_ai.usage.total_tokens carried", e.attrs?.["gen_ai.usage.total_tokens"] === 1234, JSON.stringify(e.attrs));
    check("emit --usage: workflow.item.id is the opus", e.attrs?.[WF.ITEM_ID] === "W-002", JSON.stringify(e.attrs));
    check("emit --usage: workflow.actor.role is the sella", e.attrs?.[WF.ACTOR_ROLE] === "builder-1", JSON.stringify(e.attrs));
    check("emit --usage: gen_ai.request.model carried", e.attrs?.["gen_ai.request.model"] === "claude-sonnet-5", JSON.stringify(e.attrs));
    // W-002's collegium (examples/sample-studio/opera/W-002.md) — burn's
    // WF.DEPARTMENT filter is what makes this a real per-collegium spend
    // signal rather than just a token count nobody can attribute.
    check("emit --usage: workflow.department is the opus's collegium", e.attrs?.[WF.DEPARTMENT] === "engineering", JSON.stringify(e.attrs));

    check("emit --usage: missing --sella exits 2", runEmit(["--usage", "10", "--opus", "W-002", "--model", "m", "--studio", dir], { now: NOW }).exitCode === 2);
    check("emit --usage: non-numeric --usage exits 2", runEmit(["--usage", "nope", "--opus", "W-002", "--sella", "builder-1", "--model", "m", "--studio", dir], { now: NOW }).exitCode === 2);
    check("emit --usage: unknown --opus exits 2", runEmit(["--usage", "10", "--opus", "W-999", "--sella", "builder-1", "--model", "m", "--studio", dir], { now: NOW }).exitCode === 2);
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

  // ---- answer --ask-back: refused once state is no longer needs_you ------
  {
    const dir = freshStudio("answer-double-ask-back");
    const first = runAnswer(["--petitio", "A-1", "What", "about", "QA?", "--ask-back", "--studio", dir], { now: NOW });
    check("double ask-back: first call exitCode 0", first.exitCode === 0, String(first.exitCode));

    const petitioPath = join(dir, "petitiones", "A-1.md");
    const before = readFileSync(petitioPath, "utf8");

    const second = runAnswer(["--petitio", "A-1", "Again?", "--ask-back", "--studio", dir], { now: NOW });
    check("double ask-back: second call exits 2", second.exitCode === 2, String(second.exitCode));

    const after = readFileSync(petitioPath, "utf8");
    check("double ask-back: file unchanged by the refused second call", after === before, JSON.stringify({ before, after }));
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

  // ---- answer --opus: sets opus: on the petitio, records it in the Patron
  // timeline (behaviour 16, W-035) -----------------------------------------
  {
    const dir = freshStudio("answer-opus");
    const r = runAnswer(["--petitio", "A-1", "Ship", "it.", "--opus", "W-002", "--studio", dir], { now: NOW });
    check("16. answer --opus: exitCode 0", r.exitCode === 0, String(r.exitCode));

    const front = readFront<{ opus: string; state: string }>(join(dir, "petitiones", "A-1.md")).data;
    check("16. answer --opus: opus set on the petitio", front.opus === "W-002", JSON.stringify(front));

    const timelinePath = join(dir, "timeline", "patron.jsonl");
    const timelineLines = existsSync(timelinePath)
      ? readFileSync(timelinePath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : [];
    const last = timelineLines[timelineLines.length - 1];
    check("16. answer --opus: recorded in the Patron timeline", last?.["opus"] === "W-002", JSON.stringify(last));

    const result = checkStudio(dir, NOW);
    check("16. answer --opus: studio passes check", result.ok, result.ok ? "" : `blocked by ${blockIds(dir).join(", ")}`);
  }

  // ---- answer --opus <unknown>: exits 2, petitio byte-identical
  // (behaviour 17, W-035) ---------------------------------------------------
  {
    const dir = freshStudio("answer-opus-unknown");
    const petitioPath = join(dir, "petitiones", "A-1.md");
    const before = readFileSync(petitioPath, "utf8");

    const r = runAnswer(["--petitio", "A-1", "Ship", "it.", "--opus", "W-999", "--studio", dir], { now: NOW });
    check("17. answer --opus <unknown>: exits 2", r.exitCode === 2, String(r.exitCode));

    const after = readFileSync(petitioPath, "utf8");
    check("17. answer --opus <unknown>: petitio byte-identical", after === before, JSON.stringify({ before, after }));
  }

  // ---- answer resolved without --opus: allowed, one stderr note (W-035
  // acceptance 6 — not a numbered behaviour, demonstrated alongside 16/17) --
  {
    const dir = freshStudio("answer-no-opus-note");
    const origError = console.error;
    let stderr = "";
    console.error = (...parts: unknown[]) => {
      stderr += parts.map(String).join(" ") + "\n";
    };
    let r: { exitCode: number };
    try {
      r = runAnswer(["--petitio", "A-1", "Ship", "it.", "--studio", dir], { now: NOW });
    } finally {
      console.error = origError;
    }
    check("answer without --opus: exitCode 0", r.exitCode === 0, String(r.exitCode));
    check("answer without --opus: stderr note on resolve", stderr.includes("resolved without --opus"), stderr);
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
