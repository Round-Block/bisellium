/**
 * Acceptance for W-002 (context bundle and query) against
 * examples/sample-studio. `now` is pinned so age-derived text never drifts.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readManifest } from "@bisellium/adapter-native";
import { buildContext } from "./context.js";
import { answer } from "./query.js";

const repo = resolve(process.argv[2] ?? ".");
const root = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-17T13:00:00Z");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(42)} ${detail}`);
  if (!ok) failed++;
};

// ---- buildContext -----------------------------------------------------------

{
  const c = buildContext(root, "builder-1", { now: NOW });
  check("builder-1: engineering lex present", c.text.includes("Engineering lex") && c.text.includes("Mandate"));
  check("builder-1: W-002 and W-004 handoffs present", c.text.includes("W-002") && c.text.includes("W-004"));
  check("builder-1: A-1 not included (addressed to patron)", !c.text.includes("A-1"));
}

{
  const c = buildContext(root, "patron", { now: NOW });
  check("patron: A-1 included (needs_you, to: patron)", c.text.includes("A-1"));
}

{
  const c = buildContext(root, "builder-1", { now: NOW, maxTokens: 300 });
  const lastLine = c.text.split("\n").pop() ?? "";
  check("maxTokens=300: sections dropped", c.truncated.length > 0);
  check("maxTokens=300: text ends with 'truncated:' line", lastLine.startsWith("truncated:"));
}

{
  const c = buildContext(root, "nobody", { now: NOW });
  check("unknown sella: empty text, truncated ['unknown sella']", c.text === "" && c.truncated[0] === "unknown sella");
}

// ---- standing_rules -----------------------------------------------------------

{
  const c = buildContext(root, "builder-1", { now: NOW });
  check("builder-1: standing rules present", c.text.includes("Standing rules") && c.text.includes("Test-first with a recorded red"));
}

{
  const c = buildContext(root, "patron", { now: NOW });
  check("patron: standing rules present", c.text.includes("Standing rules") && c.text.includes("Evidence is produced"));
}

// ---- CLI usage pointer (W-030: point every agent at the usage banner before
// invoking it, from the one thing every agent reliably runs first; first
// filed and numbered as W-028 behaviours 22-24 — that numbering was wrong,
// see studio/briefs/W-030.md) -------------------------------------------------

/** Just the "## CLI usage" section's own text, isolated from every other
 *  section — so behaviour 2 below can't be satisfied by accident because
 *  some *other* section happens to contain no flag syntax either. */
function pointerSection(text: string): string {
  const idx = text.indexOf("## CLI usage");
  if (idx === -1) return "";
  const rest = text.slice(idx);
  const end = rest.indexOf("\n\n");
  return end === -1 ? rest : rest.slice(0, end);
}

{
  // behaviour 1: the pointer is present for every declared sella, not just
  // one hand-picked example.
  const manifest = readManifest(root);
  const sellae = [manifest.patron ?? "patron", ...manifest.sellae.map((s) => s.id)];
  for (const sella of sellae) {
    const c = buildContext(root, sella, { now: NOW });
    check(
      `${sella}: CLI usage pointer present, warning intact`,
      // "Run `bisellium` with no arguments" alone survives a mutant that
      // guts everything after it — the warning that gives the sentence its
      // force (strict allowlists, a wrong invocation writing real
      // bookkeeping) has to be asserted too, or cutting it is free.
      c.text.includes("## CLI usage") &&
        c.text.includes("Run `bisellium` with no arguments") &&
        c.text.includes("allowlists are strict") &&
        c.text.includes("write real bookkeeping"),
    );
  }
}

{
  // behaviour 2: the pointer names no flag shapes itself — it can only ever
  // point at the banner, never restate (and drift from) a piece of it.
  const c = buildContext(root, "builder-1", { now: NOW });
  const section = pointerSection(c.text);
  check("builder-1: pointer names no flag shapes", section.length > 0 && !/--[a-zA-Z]/.test(section), section);
}

{
  // behaviour 3: pointer only, not the full ~700-token banner inlined —
  // none of the per-command usage lines main.ts's USAGE constant renders
  // (e.g. "bisellium check [dir]") leak into context output.
  const c = buildContext(root, "builder-1", { now: NOW });
  check("builder-1: full banner not inlined", !c.text.includes("bisellium check [dir]"));
}

{
  // behaviour 4: the pointer survives truncation at a budget that starves
  // even the lex, for a lex the size of the *real* officina's, not just this
  // fixture's ~200-token one. The real engineering lex runs ~1100 tokens; at
  // that size, --max-tokens 600 forces the truncation loop (context.ts) past
  // every other section AND the lex before it can stop, which is exactly
  // the case the fixture's ~200-token lex can never exercise — dropping
  // everything but the lex there still fits under 600. See W-030 review
  // (studio/ci/W-028-review-3.log §2,4): at priority 2 the pointer is
  // dropped fourth of five, ahead of the lex, and is gone by the time only
  // the (still oversized) lex is left; priority 0 outranks the lex itself,
  // so the lex goes first and the pointer is what's left standing.
  const tmp = mkdtempSync(join(tmpdir(), "bisellium-context-biglex-"));
  try {
    cpSync(root, tmp, { recursive: true });
    const fillerLine = "- filler clause, present only to size this lex like the real officina's.\n";
    const bigLex = "# Engineering Lex (inflated for test)\n\n" + fillerLine.repeat(60);
    writeFileSync(join(tmp, "leges", "engineering.md"), bigLex);

    const full = buildContext(tmp, "builder-1", { now: NOW });
    const c = buildContext(tmp, "builder-1", { now: NOW, maxTokens: 600 });
    check("realistic lex: fixture inflated past 1000 tokens", full.tokens > 1000, `tokens=${full.tokens}`);
    check(
      "maxTokens=600, realistic-size lex: CLI usage pointer survives truncation of the lex itself",
      c.truncated.includes("lex") && c.text.includes("## CLI usage"),
      `truncated=${JSON.stringify(c.truncated)} tokens=${c.tokens}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- answer -------------------------------------------------------------------

{
  const a = answer(root, "what is blocked on me", { now: NOW });
  check(
    "needs_you: mentions W-004 and A-1",
    a.kind === "needs_you" && !!a.answer && a.answer.includes("W-004") && a.answer.includes("A-1"),
  );
}

{
  const a = answer(root, "status W-003", { now: NOW });
  check(
    "status W-003: mentions verifying and failed",
    a.kind === "status" && !!a.answer && a.answer.includes("verifying") && a.answer.includes("failed"),
  );
}

{
  const a = answer(root, "burn", { now: NOW });
  check(
    "burn: mentions engineering and conserve",
    a.kind === "burn" && !!a.answer && a.answer.includes("engineering") && a.answer.includes("conserve"),
  );
}

{
  const a = answer(root, "hello", { now: NOW });
  check("hello: kind unknown", a.kind === "unknown" && a.answer === null && !!a.suggestions?.length);
}

// ---- burn is period-blind: a second aerarium period gets burn 0 / unknown ----

{
  const tmp = mkdtempSync(join(tmpdir(), "bisellium-burn-period-"));
  try {
    cpSync(root, tmp, { recursive: true });
    writeFileSync(join(tmp, "aerarium", "2026-W39.yml"), "period: 2026-W39\ncollegia:\n  engineering: { stipendium_tokens: 3000000 }\n");

    const a = answer(tmp, "burn", { now: NOW });
    const lines = (a.answer ?? "").split("\n");
    const w38Eng = lines.filter((l) => l.includes("2026-W38") && l.includes("engineering"));
    const w39Eng = lines.filter((l) => l.includes("2026-W39") && l.includes("engineering"));
    check(
      "burn: engineering listed once for 2026-W38 with a derived (non-unknown) posture",
      w38Eng.length === 1 && !w38Eng[0]!.includes("unknown"),
      JSON.stringify(w38Eng),
    );
    check(
      "burn: engineering listed for 2026-W39 as unknown (not the current period)",
      w39Eng.length === 1 && w39Eng[0]!.includes("unknown"),
      JSON.stringify(w39Eng),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
