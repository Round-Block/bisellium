/**
 * packages/cli/src/retro.ts — W-018 (4/4): `bisellium retro`. A cascade
 * ends with a retrospective that files lessons, not a hallway conversation
 * that evaporates. `draftRetro` is the pure(-ish) core: it validates the
 * input FIRST — `lesson.evidence` is a block rule, so evidence is required
 * and non-empty on every finding here too — and writes nothing at all if
 * that fails. Only once every finding's evidence is real does it write the
 * acta entry, one lesson stub per distinct finding class, and a petitio for
 * any class serious enough to need the Patron's attention.
 *
 * `runRetro` (Seam S1) is the self-parsing CLI entry point the integrator
 * wires in main.ts before the generic flag parser, same as
 * run/verify/talk/tick/new today.
 */
import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { isoWeek, parseFrontMatter, readManifest } from "@bisellium/adapter-native";
import { EVENTS_LOG_REL } from "@bisellium/core";
import { WF, instant } from "@bisellium/schema";
import { createNextRecord, ensureRealDirectory, requireRealDirectory } from "@bisellium/commands/ids.js";
import { editOpusFrontMatter } from "@bisellium/commands/frontmatter.js";
import { patronDecisionProblem } from "@bisellium/commands/lifecycle.js";
import { readContainedRegularFile, titleProblem, utcTimestampProblem } from "@bisellium/commands/opus-model.js";
import { LOG_MAX_BYTES, parseVerdictLog, type RecordedFinding } from "@bisellium/commands/verdict.js";
import { emitEvent, recordOwnerRefusal, safeItemPath } from "@bisellium/commands/writes.js";
import { newItem } from "./new.js";
import { RULE_IDS } from "./rules/ids.js";

export interface RetroFinding {
  class: string;
  where: string;
  /** Required, non-empty — same contract lesson.evidence enforces. */
  evidence: string[];
}
export interface RetroUsageAgent {
  label: string;
  /** Free-text role, e.g. "builder", "reviewer", "verifier" — matched by
   *  substring (case-insensitive) against /build/ and /review|verify|censor/
   *  to split "checking" tokens from "building" tokens. Not one of the
   *  manifest's fixed sella `kind`s on purpose: a retro's usage input comes
   *  from the cascade orchestrator, not from re-deriving it off the
   *  manifest. */
  role: string;
  model: string;
  tokens: number;
  minutes: number;
}
export interface RetroUsage {
  agents: RetroUsageAgent[];
  totalTokens: number;
  byModel: Record<string, number>;
  byRole: Record<string, number>;
  waste: { reruns: number; refused: number; fixRounds: number };
  /** Provider quota snapshot, passed straight through if given (W-007's
   *  provider status shape) — informational only, no computation depends
   *  on it today. */
  quota?: { id: string; usagePct?: number | null; status?: string }[];
}
export interface RetroInput {
  verifierIssues: number;
  reviewFindings: RetroFinding[];
  agents: { label: string; model: string; tokens: number; minutes: number }[];
  tests: number;
  fixRounds: number;
  mutationsCaught: number;
  /** Optional: when present, draftRetro adds a "## Usage" section (totals,
   *  checking/building ratio, tokens per opus, trend vs the previous
   *  retro, posture from the current aerarium). Absent entirely for a
   *  caller that doesn't track usage — no section, no behaviour change. */
  usage?: RetroUsage;
}
export interface RetroDraft {
  path: string;
  markdown: string;
  lessons: { path: string; markdown: string }[];
  /** Officina-relative paths of any petitiones filed to the Patron. */
  petitiones: string[];
}

const isExternal = (href: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(href);

/** All existing lessons on disk, keyed by class, mapping to the (cascade,
 *  lesson-id, addressedBy) entries already filed — used for the recurrence
 *  computation so it sees history, not just this run's new lessons, and for
 *  the "## Addressed" section's target lookup. Never throws. */
function existingLessonsByClass(studioRoot: string): Map<string, { cascade: number; id: string; addressedBy?: string }[]> {
  const out = new Map<string, { cascade: number; id: string; addressedBy?: string }[]>();
  const dir = join(studioRoot, "lessons");
  let files: string[] = [];
  try {
    files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
  } catch {
    files = [];
  }
  for (const f of files) {
    const lessonFile = readContainedRegularFile(studioRoot, `lessons/${f}`, "lessons");
    if ("error" in lessonFile) continue;
    const raw = lessonFile.bytes.toString("utf8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!m) continue;
    const classMatch = /^class:\s*"?([^"\n]+)"?\s*$/m.exec(m[1]!);
    const idMatch = /^id:\s*"?([^"\n]+)"?\s*$/m.exec(m[1]!);
    const cascadeMatch = /^cascade:\s*(\d+)\s*$/m.exec(m[1]!);
    const addressedByMatch = /^addressed_by:\s*"?([^"\n]+)"?\s*$/m.exec(m[1]!);
    if (!classMatch || !cascadeMatch) continue;
    const cls = classMatch[1]!.trim();
    const cascade = Number(cascadeMatch[1]);
    const id = idMatch ? idMatch[1]!.trim() : f.replace(/\.md$/, "");
    const addressedBy = addressedByMatch ? addressedByMatch[1]!.trim() : undefined;
    if (!out.has(cls)) out.set(cls, []);
    out.get(cls)!.push({ cascade, id, ...(addressedBy ? { addressedBy } : {}) });
  }
  return out;
}

/** The first non-empty `addressedBy` among a class's existing (on-disk)
 *  lessons, in `existingLessonsByClass` insertion order — undefined when no
 *  existing lesson of that class names one. Never validates the value: a
 *  typo or a dangling id is `lesson.addressed_by`'s job (rules/process.ts),
 *  which blocks before a retro would ever read it. */
function addressedTarget(existingByClass: Map<string, { cascade: number; id: string; addressedBy?: string }[]>, cls: string): string | undefined {
  for (const entry of existingByClass.get(cls) ?? []) if (entry.addressedBy) return entry.addressedBy;
  return undefined;
}

/** Classifies an `addressed_by` target: an opus or a decision by what exists
 *  on disk, a rule by `RULE_IDS` (W-060: a typo or a deleted opus is no rule,
 *  it is `"unresolvable"`), and, for an opus target, reads its `state:` with
 *  the same regex style `existingLessonsByClass` already uses.
 *
 *  `target` is a raw front-matter capture (`[^"\n]+`), never validated —
 *  P-007's containment-helper decree applies: both lookups go through
 *  `safeItemPath` (packages/commands/src/writes.ts), so a `../` (or any
 *  other id `safeItemPath` rejects) never reaches a filesystem read outside
 *  `studioRoot` and classifies as `"unresolvable"` — the caller treats that
 *  exactly like "no target at all" (still unaddressed, still files its
 *  petitio). Never throws. */
function classifyAddressedTarget(studioRoot: string, target: string): { kind: "opus" | "decision" | "rule" | "unresolvable"; state?: string } {
  const opusPath = safeItemPath(join(studioRoot, "opera"), target);
  const decisionPath = safeItemPath(join(studioRoot, "decisions"), target);
  if (typeof opusPath !== "string" || typeof decisionPath !== "string") return { kind: "unresolvable" };
  // physical containment too (W-137 round 1): a symlinked record is no record, so it is read through the contained reader
  const opus = readContainedRegularFile(studioRoot, relative(studioRoot, opusPath).split(sep).join("/"), "opera");
  if (!("error" in opus)) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(opus.bytes.toString("utf8"));
    const stateMatch = m ? /^state:\s*"?([^"\n]+)"?\s*$/m.exec(m[1]!) : null;
    return { kind: "opus", state: stateMatch ? stateMatch[1]!.trim() : "unknown" };
  }
  if (!("error" in readContainedRegularFile(studioRoot, relative(studioRoot, decisionPath).split(sep).join("/"), "decisions"))) return { kind: "decision" };
  return RULE_IDS.has(target) ? { kind: "rule" } : { kind: "unresolvable" };
}

/** Case-insensitive substring match of a finding class inside a decision's
 *  `kill_when` text — the pruning-candidate heuristic documented in
 *  docs/ADOPTION.md next to draftRetro. Decisions are read only, never
 *  edited: pruning candidates are listed for the Patron to act on. */
function pruningCandidates(studioRoot: string, classes: string[]): { id: string; path: string; killWhen: string }[] {
  const out: { id: string; path: string; killWhen: string }[] = [];
  const dir = join(studioRoot, "decisions");
  let files: string[] = [];
  try {
    files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
  } catch {
    files = [];
  }
  for (const f of files) {
    const decisionFile = readContainedRegularFile(studioRoot, `decisions/${f}`, "decisions");
    if ("error" in decisionFile) continue;
    const raw = decisionFile.bytes.toString("utf8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!m) continue;
    const idMatch = /^id:\s*"?([^"\n]+)"?\s*$/m.exec(m[1]!);
    const killMatch = /^kill_when:\s*"?([^\n]*?)"?\s*$/m.exec(m[1]!);
    if (!idMatch || !killMatch) continue;
    const killWhen = killMatch[1]!.trim();
    if (!killWhen) continue;
    const lower = killWhen.toLowerCase();
    if (classes.some((c) => lower.includes(c.toLowerCase())))
      out.push({ id: idMatch[1]!.trim(), path: `decisions/${f}`, killWhen });
  }
  return out;
}

/** Same 4-band thresholds adapters/native/src/index.ts's own (unexported)
 *  `posture()` uses — duplicated here rather than importing a private
 *  helper across a package boundary; kept in sync by inspection since both
 *  are tiny and stable. */
function posture(allowance: number | undefined, burn: number | undefined): "ok" | "conserve" | "closeout" | "limited" | "unknown" {
  if (allowance === undefined || burn === undefined) return "unknown";
  const r = burn / allowance;
  if (r >= 1) return "limited";
  if (r >= 0.85) return "closeout";
  if (r >= 0.6) return "conserve";
  return "ok";
}

/** Reads aerarium/<isoWeek(now)>.yml (never throws) and reports, for every
 *  collegium it declares an allowance for, this cascade's own usage.totalTokens
 *  against that allowance — a simple, honestly-labelled approximation (this
 *  cascade's spend vs. the period's per-collegium allowance), not the
 *  cumulative all-time burn `bisellium budget`/adapters/native compute from
 *  the full event log, which draftRetro has no index/store handle to query. */
function posturesFromCurrentAerarium(studioRoot: string, now: Date, totalTokens: number): { collegium: string; posture: string; allowance: number; period: string }[] {
  const period = isoWeek(now);
  const path = join(studioRoot, "aerarium", `${period}.yml`);
  let doc: unknown;
  try {
    if (!existsSync(path)) return [];
    const aerariumFile = readContainedRegularFile(studioRoot, `aerarium/${period}.yml`, "aerarium");
    if ("error" in aerariumFile) return [];
    doc = parseYaml(aerariumFile.bytes.toString("utf8"));
  } catch {
    return [];
  }
  if (typeof doc !== "object" || doc === null) return [];
  const collegia = (doc as Record<string, unknown>)["collegia"];
  if (typeof collegia !== "object" || collegia === null) return [];
  const out: { collegium: string; posture: string; allowance: number; period: string }[] = [];
  for (const [id, v] of Object.entries(collegia as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    const allowance = (v as Record<string, unknown>)["stipendium_tokens"];
    if (typeof allowance !== "number") continue;
    out.push({ collegium: id, posture: posture(allowance, totalTokens), allowance, period });
  }
  return out.sort((a, b) => a.collegium.localeCompare(b.collegium));
}

/** Finds the highest-numbered retro acta strictly before `cascade` (by
 *  filename, `acta/<date>-retro-<N>.md`) and pulls its "Total tokens: N"
 *  line back out of its own Usage section — the only signal a prior
 *  retro's markdown carries forward, deliberately not a second data store. */
function previousRetroTotalTokens(studioRoot: string, cascade: number): { cascadeNumber: number; totalTokens: number } | undefined {
  const dir = join(studioRoot, "acta");
  let files: string[] = [];
  try {
    files = existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    files = [];
  }
  let best: { cascadeNumber: number; file: string } | undefined;
  const re = /-retro-(\d+)\.md$/;
  for (const f of files) {
    const m = re.exec(f);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < cascade && (best === undefined || n > best.cascadeNumber)) best = { cascadeNumber: n, file: f };
  }
  if (!best) return undefined;
  const retroFile = readContainedRegularFile(studioRoot, `acta/${best.file}`, "acta");
  if ("error" in retroFile) return undefined;
  const raw = retroFile.bytes.toString("utf8");
  const m = /Total tokens:\s*(\d+)/.exec(raw);
  if (!m) return undefined;
  return { cascadeNumber: best.cascadeNumber, totalTokens: Number(m[1]) };
}

/** Builds the "## Usage" section's lines, or [] when `usage` is absent —
 *  the caller (draftRetro) splices this in only when non-empty, so an
 *  existing caller that never supplies usage sees byte-identical output
 *  to before this field existed. */
function usageSection(studioRoot: string, cascade: number, usage: RetroUsage | undefined, now: Date): string[] {
  if (!usage) return [];

  const byModelLine = Object.entries(usage.byModel).sort(([a], [b]) => a.localeCompare(b)).map(([m, t]) => `${m}: ${t}`).join(", ") || "(none)";
  const byRoleLine = Object.entries(usage.byRole).sort(([a], [b]) => a.localeCompare(b)).map(([r, t]) => `${r}: ${t}`).join(", ") || "(none)";

  // Checking/building ratio: Opus verify+review tokens ÷ builder tokens —
  // "checking" and "building" are read off each agent's role (substring
  // match, case-insensitive), not off the model name, since a builder can
  // run on Opus too (studio/bisellium.yml's producer/eng-lead/architect do).
  const checkingTokens = usage.agents.filter((a) => /review|verify|censor/i.test(a.role)).reduce((s, a) => s + a.tokens, 0);
  const buildingAgents = usage.agents.filter((a) => /build/i.test(a.role));
  const buildingTokens = buildingAgents.reduce((s, a) => s + a.tokens, 0);
  const ratioLine = buildingTokens > 0 ? (checkingTokens / buildingTokens).toFixed(2) : "n/a (no building-role tokens)";

  // Tokens per opus: this cascade model runs one builder per opus (D-012),
  // so the building-role agent count is the opus count; falls back to the
  // total agent count if no agent's role reads as "building" at all.
  const opusCount = buildingAgents.length > 0 ? buildingAgents.length : Math.max(1, usage.agents.length);
  const tokensPerOpus = Math.round(usage.totalTokens / opusCount);

  const prev = previousRetroTotalTokens(studioRoot, cascade);
  const trendLine =
    prev === undefined
      ? "no prior retro found for comparison"
      : prev.totalTokens === 0
        ? `cascade ${prev.cascadeNumber} reported 0 tokens — no percentage trend`
        : (() => {
            const pct = ((usage.totalTokens - prev.totalTokens) / prev.totalTokens) * 100;
            const sign = pct >= 0 ? "+" : "";
            return `${sign}${pct.toFixed(1)}% vs cascade ${prev.cascadeNumber} (${prev.totalTokens} → ${usage.totalTokens})`;
          })();

  const postures = posturesFromCurrentAerarium(studioRoot, now, usage.totalTokens);
  const postureLines = postures.length
    ? postures.map((p) => `${p.collegium}: ${p.posture} (this cascade ${usage.totalTokens} / ${p.allowance} tokens, ${p.period})`)
    : ["(no aerarium on record for the current period)"];

  return [
    "## Usage",
    "",
    `- Total tokens: ${usage.totalTokens}`,
    `- By model: ${byModelLine}`,
    `- By role: ${byRoleLine}`,
    `- Checking/building ratio: ${ratioLine}`,
    `- Tokens per opus: ${tokensPerOpus} (opera basis: ${opusCount})`,
    `- Waste: ${usage.waste.reruns} rerun(s), ${usage.waste.refused} refusal(s), ${usage.waste.fixRounds} fix round(s)`,
    `- Trend vs previous retro: ${trendLine}`,
    "- Posture:",
    ...postureLines.map((l) => `  - ${l}`),
    "",
  ];
}

/**
 * Validates `input`, then writes the retro's acta entry, one lesson stub
 * per distinct finding class, and a petitio per class serious enough to
 * need the Patron. Throws (nothing written) if any finding's evidence is
 * empty or points at a href that doesn't exist under `studioRoot` — naming
 * the offending class, exactly the shape `lesson.evidence` itself blocks.
 */
export function draftRetro(studioRoot: string, cascade: number, input: RetroInput, now: Date): RetroDraft {
  // ---- validate first: nothing is written until every finding passes -----
  for (const f of input.reviewFindings) {
    if (!Array.isArray(f.evidence) || f.evidence.length === 0)
      throw new Error(`retro: finding class "${f.class}" has empty evidence — refusing to file a lesson with no evidence`);
    for (const href of f.evidence) {
      if (isExternal(href)) continue;
      let ok = false;
      try {
        ok = existsSync(join(studioRoot, href));
      } catch {
        ok = false;
      }
      if (!ok) throw new Error(`retro: finding class "${f.class}" evidence "${href}" not found under the officina (dead link)`);
    }
  }

  // ---- group findings by class, deterministically (sorted) ---------------
  const classesInOrder = [...new Set(input.reviewFindings.map((f) => f.class))].sort();
  const findingsByClass = new Map<string, RetroFinding[]>();
  for (const f of input.reviewFindings) {
    if (!findingsByClass.has(f.class)) findingsByClass.set(f.class, []);
    findingsByClass.get(f.class)!.push(f);
  }

  const dateStr = now.toISOString().slice(0, 10);

  // ---- lessons: one stub per distinct class, evidence = union of hrefs ----
  const existingByClass = existingLessonsByClass(studioRoot);
  const lessons: { path: string; markdown: string; id: string; class: string }[] = [];
  for (const cls of classesInOrder) {
    const findings = findingsByClass.get(cls)!;
    const evidence = [...new Set(findings.flatMap((f) => f.evidence))];
    let markdown = "";
    const { id } = createNextRecord(studioRoot, "lessons", "L", (candidate) => {
      markdown = [
        "---",
        `id: ${JSON.stringify(candidate)}`,
        `at: ${now.toISOString()}`,
        `class: ${JSON.stringify(cls)}`,
        `evidence: ${JSON.stringify(evidence)}`,
        `cascade: ${cascade}`,
        "---",
        `Filed by \`bisellium retro --cascade ${cascade}\`. ${findings.length} finding(s) in this cascade.`,
        "",
      ].join("\n");
      return markdown;
    });
    lessons.push({ path: `lessons/${id}.md`, markdown, id, class: cls });
  }

  // ---- recurrence: same class, >=2 distinct cascades, >=2 distinct lessons
  // (existing history + what this run is about to file).
  const recurrence: { class: string; cascades: number[] }[] = [];
  for (const cls of classesInOrder) {
    const history = [...(existingByClass.get(cls) ?? []), { cascade, id: lessons.find((l) => l.class === cls)!.id }];
    const distinctCascades = [...new Set(history.map((h) => h.cascade))];
    const distinctIds = new Set(history.map((h) => h.id));
    if (distinctCascades.length >= 2 && distinctIds.size >= 2) recurrence.push({ class: cls, cascades: distinctCascades.sort((a, b) => a - b) });
  }
  const recurrentClasses = new Set(recurrence.map((r) => r.class));

  // ---- proposals: a recurring class not yet addressed is a blocking-rule/
  // lex-wording proposal (files a petitio); a one-off is advisory, adopted
  // alone. A recurring class that already names what addresses it (any
  // existing lesson's `addressed_by`) files no petitio at all — re-filing
  // one for work already open, accepted or ruled-on is the duplication this
  // opus exists to end. It appears under "## Addressed" instead.
  const petitiones: string[] = [];
  const proposals: { class: string; kind: "adopt-alone" | "petitio"; petitioPath?: string }[] = [];
  for (const cls of classesInOrder) {
    if (recurrentClasses.has(cls)) {
      const targetForProposal = addressedTarget(existingByClass, cls);
      // An unresolvable (e.g. path-traversal) target is never "addressed":
      // the class still needs the Patron's attention, so it still files.
      if (targetForProposal !== undefined && classifyAddressedTarget(studioRoot, targetForProposal).kind !== "unresolvable") continue;
      const { id: pid } = createNextRecord(studioRoot, "petitiones", "P", (candidate) =>
        [
          "---",
          `id: ${JSON.stringify(candidate)}`,
          "from: qa-lead",
          "to: patron",
          "state: needs_you",
          `opened: ${now.toISOString()}`,
          "---",
          `Recurring finding class "${cls}" (cascade ${cascade} retro). Proposing a blocking rule or lex amendment — see the retro for detail.`,
          "",
        ].join("\n"),
      );
      const ppath = `petitiones/${pid}.md`;
      petitiones.push(ppath);
      proposals.push({ class: cls, kind: "petitio", petitioPath: ppath });
    } else if (classesInOrder.length > 0) {
      proposals.push({ class: cls, kind: "adopt-alone" });
    }
  }

  // ---- addressed: every recurrent class this cascade saw, its target (if
  // any) and, for an opus target, its current state — the periodic
  // exception review a class accepted in one cascade gets read aloud again
  // in the next.
  const addressedLines: string[] = recurrence.length
    ? recurrence.map(({ class: cls }) => {
        const target = addressedTarget(existingByClass, cls);
        if (target === undefined) return `- "${cls}" → nothing yet`;
        const { kind, state } = classifyAddressedTarget(studioRoot, target);
        if (kind === "unresolvable") return `- "${cls}" → nothing yet`;
        return kind === "opus" ? `- "${cls}" → ${target} (opus, ${state})` : `- "${cls}" → ${target} (${kind})`;
      })
    : ["- (none — no class recurs across two or more cascades yet)"];

  // ---- pruning candidates: decisions whose kill_when mentions a class
  // this cascade actually saw — listed, never edited.
  const pruning = pruningCandidates(studioRoot, classesInOrder);

  // ---- the retro doc itself ------------------------------------------------
  const title = `Retrospectio ${cascade}`;
  const lines: string[] = [
    "---",
    `author: qa-lead`,
    `kind: decision`,
    `title: ${JSON.stringify(title)}`,
    `at: ${now.toISOString()}`,
    "---",
    `# ${title}`,
    "",
    "## Numbers",
    "",
    `- Verifier issues: ${input.verifierIssues}`,
    `- Tests: ${input.tests}`,
    `- Fix rounds: ${input.fixRounds}`,
    `- Mutations caught: ${input.mutationsCaught}`,
    "- Agents:",
    ...(input.agents.length
      ? input.agents.map((a) => `  - ${a.label} (${a.model}): ${a.tokens} tokens, ${a.minutes} min`)
      : ["  - (none recorded)"]),
    "",
    "## Findings by class",
    "",
    ...(classesInOrder.length
      ? classesInOrder.map((c) => `- ${c}: ${findingsByClass.get(c)!.length}`)
      : ["- (no findings this cascade)"]),
    "",
    "## Lessons filed",
    "",
    ...(lessons.length ? lessons.map((l) => `- ${l.id} (${l.class}) → ${l.path}`) : ["- (none)"]),
    "",
    "## Recurrence",
    "",
    ...(recurrence.length
      ? recurrence.map((r) => `- "${r.class}" recurs across cascades ${r.cascades.join(", ")}`)
      : ["- no class recurs across two or more cascades yet"]),
    "",
    "## Addressed",
    "",
    ...addressedLines,
    "",
    "## Proposals",
    "",
    ...(proposals.length
      ? proposals.map((p) =>
          p.kind === "adopt-alone"
            ? `- "${p.class}": advisory rule — adopt alone`
            : `- "${p.class}": blocking-rule/lex-wording change — petitio filed at ${p.petitioPath}`,
        )
      : ["- (none)"]),
    "",
    "## Pruning candidates",
    "",
    ...(pruning.length
      ? pruning.map((d) => `- ${d.id} (${d.path}): kill_when — "${d.killWhen}"`)
      : ["- (none — no decision's kill_when matches this cascade's findings)"]),
    "",
    ...usageSection(studioRoot, cascade, input.usage, now),
  ];
  const markdown = lines.join("\n");

  const actaDir = ensureRealDirectory(studioRoot, "acta");
  const actaPath = `acta/${dateStr}-retro-${cascade}.md`;
  writeFileSync(join(actaDir, basename(actaPath)), markdown);

  return { path: actaPath, markdown, lessons: lessons.map((l) => ({ path: l.path, markdown: l.markdown })), petitiones };
}

// ---------------------------------------------------------------------------
// W-137 — `retro --opus`: the retro is a required step after done (D-039).
//
// Every record this mode reads has ONE named domain and ONE function that
// rejects anything outside it, failing the whole retro closed (W-161):
//   verdict logs + reds  -> readOpusVerdicts     the opus record  -> readOpus
//   lessons              -> readLessonClasses     the retro setting -> readRetroSetting
//   retro actas          -> retroFiled            the triage       -> parseTriage
// `owedRetros` is the one reader of the setting and of retro-filed status.
// ---------------------------------------------------------------------------

type Dict = Record<string, unknown>;
type Refusal = { error: string };
export { parseVerdictLog, type RecordedFinding };
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const isRefusal = (v: unknown): v is Refusal => isDict(v) && typeof v["error"] === "string";
const OPUS_ID = /^W-[0-9]+$/;
const CLASS_RE = /^[a-z][a-z0-9-]*×\S+$/;

interface Verdicts {
  /** every log and red read, officina-relative and sorted */
  sources: string[];
  findings: RecordedFinding[];
}

/** One recorded log, read through the contained reader and judged by `parseVerdictLog`. */
function readVerdictLog(root: string, id: string, rel: string): { findings: RecordedFinding[] } | Refusal {
  const file = readContainedRegularFile(root, rel, "ci", LOG_MAX_BYTES);
  if ("error" in file) return { error: `${rel}: ${file.error}` };
  const parsed = parseVerdictLog(file.bytes.toString("utf8"), id, rel);
  return "error" in parsed ? parsed : { findings: parsed.findings };
}

/** The verdict logs and reds of one opus (D-039 §2), or the first record outside the domain. */
export function readOpusVerdicts(root: string, id: string): Verdicts | Refusal {
  if (!OPUS_ID.test(id)) return { error: `${id}: not an opus id` };
  const sources: string[] = [];
  const findings: RecordedFinding[] = [];
  const ci = join(root, "ci");
  const names = existsSync(ci) ? readdirSync(ci).sort() : [];
  for (const name of names) {
    const prefix = [`${id}-review-`, `${id}-spec-`].find((p) => name.startsWith(p));
    if (prefix === undefined) continue;
    if (!/^[1-9]\d*\.log$/.test(name.slice(prefix.length))) return { error: `ci/${name}: a verdict log is named ${prefix}<n>.log, n a positive integer with no leading zero` };
    const read = readVerdictLog(root, id, `ci/${name}`);
    if (isRefusal(read)) return read;
    sources.push(`ci/${name}`);
    findings.push(...read.findings);
  }
  const redDir = join(ci, "reds", id);
  for (const name of existsSync(redDir) ? readdirSync(redDir).sort() : []) {
    if (!/^\d\d\.log$/.test(name)) return { error: `ci/reds/${id}/${name}: a red is named NN.log (two digits)` };
    const file = readContainedRegularFile(root, `ci/reds/${id}/${name}`, "ci", LOG_MAX_BYTES);
    if ("error" in file) return { error: `ci/reds/${id}/${name}: ${file.error}` };
    sources.push(`ci/reds/${id}/${name}`);
  }
  return { sources, findings };
}

const FRONT = (file: { bytes: Buffer }, label: string): Dict | Refusal => {
  try {
    const data = parseFrontMatter<unknown>(file.bytes.toString("utf8"), label).data;
    return isDict(data) ? data : { error: `${label}: front matter is not a mapping` };
  } catch (e) {
    return { error: `${label}: ${(e as Error).message}` };
  }
};

/** One opus record, or why it is unreadable. */
function readOpus(root: string, id: string): Dict | Refusal {
  if (!OPUS_ID.test(id)) return { error: `${id}: not an opus id` };
  // the id reaches a path only through the containment helper (W-047), then the contained reader
  const path = safeItemPath(join(root, "opera"), id);
  if (typeof path !== "string") return { error: `opera: ${path.error}` };
  const rel = relative(root, path).split(sep).join("/");
  const file = readContainedRegularFile(root, rel, "opera");
  if ("error" in file) return { error: `${rel}: ${file.error}` };
  return FRONT(file, rel);
}

interface RetroSetting {
  since: number;
  highGreenlitBy?: string;
}
/** The `retro` setting: absent, or `{ since, high_greenlit_by? }` and nothing else. */
function readRetroSetting(root: string): RetroSetting | undefined | Refusal {
  let manifest: unknown;
  try {
    manifest = parseYaml(readFileSync(join(root, "bisellium.yml"), "utf8"));
  } catch (e) {
    return { error: `bisellium.yml: ${(e as Error).message}` };
  }
  if (!isDict(manifest)) return { error: "bisellium.yml: not a mapping" };
  const raw = manifest["retro"];
  if (raw === undefined) return undefined;
  if (!isDict(raw)) return { error: "bisellium.yml#retro: retro must be a mapping with a `since` date" };
  const unknown = Object.keys(raw).filter((k) => k !== "since" && k !== "high_greenlit_by");
  if (unknown.length > 0) return { error: `bisellium.yml#retro: unknown key ${unknown.join(", ")}` };
  const since = instant(raw["since"])?.getTime();
  if (since === undefined) return { error: "bisellium.yml#retro: since must be an ISO date" };
  if (raw["high_greenlit_by"] === undefined) return { since };
  const patron = typeof manifest["patron"] === "string" ? manifest["patron"] : undefined;
  const problem = patronDecisionProblem(root, patron === undefined ? {} : { patron }, raw["high_greenlit_by"]);
  if (problem !== undefined) return { error: `bisellium.yml#retro: high_greenlit_by: ${problem}` };
  return { since, highGreenlitBy: raw["high_greenlit_by"] as string };
}

/** Whether a retro acta for `id` is filed: `acta/*-retro-<id>.md` carrying `opus: <id>`. Unreadable never counts. */
function retroFiled(root: string, id: string): boolean {
  const dir = join(root, "acta");
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (/^(\d{4}-\d{2}-\d{2})-retro-(W-[0-9]+)\.md$/.exec(name)?.[2] !== id) continue;
    const file = readContainedRegularFile(root, `acta/${name}`, "acta");
    if ("error" in file) continue;
    const data = FRONT(file, `acta/${name}`);
    if (!isRefusal(data) && data["opus"] === id) return true;
  }
  return false;
}

/**
 * The retros that are owed: opera `done` whose `end` is at or after `retro.since` and that file no retro. An `end`
 * that is present but not a date counts as owed (fail closed); a done opus with no `end` closed before W-096 and owes
 * none. No `retro` setting: nothing is owed. This is the one reader of the setting; `next` and `check` call it.
 */
export function owedRetros(root: string): { owed: string[] } | Refusal {
  const setting = readRetroSetting(root);
  if (isRefusal(setting)) return setting;
  if (setting === undefined) return { owed: [] };
  const dir = join(root, "opera");
  const owed: string[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const id = /^(W-[0-9]+)\.md$/.exec(name)?.[1];
    if (id === undefined) continue;
    const rec = readOpus(root, id);
    if (isRefusal(rec)) return rec;
    if (rec["state"] !== "done" || rec["end"] === undefined || rec["end"] === null) continue;
    const end = utcTimestampProblem(rec["end"]) === undefined ? instant(rec["end"])?.getTime() : undefined;
    if ((end === undefined || end >= setting.since) && !retroFiled(root, id)) owed.push(id);
  }
  return { owed };
}

/** The classes of every lesson on file; a lesson that cannot be read as a mapping with a class is out of domain. */
function readLessonClasses(root: string): Set<string> | Refusal {
  const dir = join(root, "lessons");
  const classes = new Set<string>();
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!name.endsWith(".md")) continue;
    const file = readContainedRegularFile(root, `lessons/${name}`, "lessons");
    if ("error" in file) return { error: `lessons/${name}: ${file.error}` };
    const data = FRONT(file, `lessons/${name}`);
    if (isRefusal(data)) return data;
    if (typeof data["class"] !== "string" || data["class"] === "") return { error: `lessons/${name}: class must be a non-empty string` };
    classes.add(data["class"]);
  }
  return classes;
}

type Fix = string | { title: string; collegium: string };
interface Entry {
  log: string;
  n: number;
  cls?: string;
  fix?: Fix;
  notALesson?: string;
}
const keysOnly = (o: Dict, allowed: string[]): string | undefined => Object.keys(o).find((k) => !allowed.includes(k));

/** The triage's shape alone; what it names is judged against the records in `draftOpusRetro`. */
function parseTriage(raw: unknown): Entry[] | Refusal {
  if (!isDict(raw) || !Array.isArray(raw["findings"])) return { error: "triage: want { findings: [...] }" };
  const extra = keysOnly(raw, ["findings"]);
  if (extra !== undefined) return { error: `triage: unknown key "${extra}"` };
  const entries: Entry[] = [];
  for (const [i, e] of raw["findings"].entries()) {
    const at = `triage entry ${i + 1}`;
    if (!isDict(e)) return { error: `${at}: not an object` };
    const bad = keysOnly(e, ["log", "n", "class", "fix", "not_a_lesson"]);
    if (bad !== undefined) return { error: `${at}: unknown key "${bad}"` };
    if (typeof e["log"] !== "string" || !Number.isInteger(e["n"]) || (e["n"] as number) < 1) return { error: `${at}: log must be a string and n a positive integer` };
    const base = { log: e["log"], n: e["n"] as number };
    const hasClass = e["class"] !== undefined;
    const hasNot = e["not_a_lesson"] !== undefined;
    if (hasClass === hasNot) return { error: `${at} (${base.log} #${base.n}): exactly one of class or not_a_lesson` };
    if (hasNot) {
      if (typeof e["not_a_lesson"] !== "string" || e["not_a_lesson"].trim() === "" || e["fix"] !== undefined) return { error: `${at} (${base.log} #${base.n}): not_a_lesson is a non-empty reason and takes no fix` };
      entries.push({ ...base, notALesson: e["not_a_lesson"] });
      continue;
    }
    if (typeof e["class"] !== "string" || !CLASS_RE.test(e["class"])) return { error: `${at} (${base.log} #${base.n}): class must match ${CLASS_RE.source}` };
    const fix = e["fix"];
    if (typeof fix === "string" && fix !== "") entries.push({ ...base, cls: e["class"], fix });
    else if (isDict(fix) && keysOnly(fix, ["title", "collegium"]) === undefined && typeof fix["title"] === "string" && typeof fix["collegium"] === "string")
      entries.push({ ...base, cls: e["class"], fix: { title: fix["title"], collegium: fix["collegium"] } });
    else return { error: `${at} (${base.log} #${base.n}): fix is an id, or { title, collegium }` };
  }
  return entries;
}

const sameFix = (a: Fix, b: Fix): boolean => (typeof a === "string" || typeof b === "string" ? a === b : a.title === b.title && a.collegium === b.collegium);
const oneLine = (s: string): string => s.replace(/\s*\n\s*/g, " ").trim();

/**
 * Files the retro of one done opus from its recorded verdicts and a triage (D-039 §2-§6): validates everything,
 * then writes in the order that leaves a crash owing the retro, never falsely filed — new fix opera, lessons,
 * greenlights of high-severity fixes, last the acta. Throws (nothing written) on any record outside its domain.
 */
export function draftOpusRetro(root: string, id: string, rawTriage: unknown, now: Date): { path: string } {
  const verdicts = readOpusVerdicts(root, id);
  if (isRefusal(verdicts)) throw new Error(verdicts.error);
  const opus = readOpus(root, id);
  if (isRefusal(opus)) throw new Error(opus.error);
  if (opus["state"] !== "done") throw new Error(`opera/${id}.md: ${id} is ${String(opus["state"])}, not done; a retro follows done`);
  if (retroFiled(root, id)) throw new Error(`acta: the retro of ${id} is already filed`);
  const setting = readRetroSetting(root);
  if (isRefusal(setting)) throw new Error(setting.error);
  const lessonClasses = readLessonClasses(root);
  if (isRefusal(lessonClasses)) throw new Error(lessonClasses.error);
  const entries = parseTriage(rawTriage);
  if (isRefusal(entries)) throw new Error(entries.error);

  // every recorded finding appears exactly once, and every entry names one
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.log} #${e.n}`;
    if (!verdicts.findings.some((f) => f.log === e.log && f.n === e.n)) throw new Error(`triage: ${key} is not a recorded finding`);
    if (seen.has(key)) throw new Error(`triage: ${key} is accounted for twice`);
    seen.add(key);
  }
  for (const f of verdicts.findings) if (!seen.has(`${f.log} #${f.n}`)) throw new Error(`triage: ${f.log} #${f.n} is not accounted for`);

  // one fix per class; a named fix resolves, a new one names a declared collegium and a good title
  const manifest = readManifest(root);
  const fixOf = new Map<string, Fix>();
  for (const e of entries) {
    if (e.cls === undefined || e.fix === undefined) continue;
    const had = fixOf.get(e.cls);
    if (had !== undefined && !sameFix(had, e.fix)) throw new Error(`triage: class "${e.cls}" carries two different fixes`);
    if (had !== undefined) continue;
    fixOf.set(e.cls, e.fix);
    if (typeof e.fix === "string") {
      if (classifyAddressedTarget(root, e.fix).kind === "unresolvable") throw new Error(`triage: fix "${e.fix}" of "${e.cls}" names no opus, rule id or decision`);
    } else {
      const problem = titleProblem(e.fix.title);
      if (problem !== undefined) throw new Error(`triage: fix of "${e.cls}": ${problem}`);
      if (!(manifest.collegia ?? []).some((c) => c.id === (e.fix as { collegium: string }).collegium)) throw new Error(`triage: fix of "${e.cls}" names undeclared collegium "${e.fix.collegium}"`);
    }
  }

  // severity: a rule over recorded facts (D-039 §5), never a model
  const classes = [...fixOf.keys()].sort();
  const severity = new Map<string, "high" | "medium" | "low">();
  for (const cls of classes) {
    const area = cls.slice(0, cls.indexOf("×"));
    const mine = entries.filter((e) => e.cls === cls);
    const blocking = mine.some((e) => verdicts.findings.find((f) => f.log === e.log && f.n === e.n)!.blocking);
    severity.set(cls, area === "security" || area === "data-loss" || lessonClasses.has(cls) ? "high" : blocking ? "medium" : "low");
  }

  // a high fix that is already an opus in backlog is greenlit by the setting; refuse before any write if it cannot be
  const startable = (fix: Fix): boolean => typeof fix === "string" && opusState(root, fix) === "backlog";
  if (setting?.highGreenlitBy !== undefined)
    for (const cls of classes) {
      const fix = fixOf.get(cls)!;
      const refusal = severity.get(cls) === "high" && startable(fix) ? recordOwnerRefusal(root, fix as string) : undefined;
      if (refusal !== undefined) throw new Error(refusal);
    }
  const dateStr = now.toISOString().slice(0, 10);
  const actaPath = safeItemPath(join(root, "acta"), `${dateStr}-retro-${id}`);
  if (typeof actaPath !== "string") throw new Error(`acta: ${actaPath.error}`);
  const actaRel = relative(root, actaPath).split(sep).join("/");
  // before the FIRST write: every directory the retro creates in is a real directory (or absent), and the one fixed
  // output is no entry at all (lstat: a dangling symlink is one). The other outputs are allocated by exclusive create
  // inside those directories (fix opera, lessons) or are appends to existing records (greenlit fix, event log).
  for (const dir of ["opera", "lessons", "acta"]) realDir(root, dir);
  const greenlights = setting?.highGreenlitBy !== undefined && classes.some((cls) => severity.get(cls) === "high" && (typeof fixOf.get(cls) !== "string" || startable(fixOf.get(cls)!)));
  if (greenlights) eventLogProblem(root);
  try {
    lstatSync(join(realDir(root, "acta"), basename(actaPath)));
    throw new Error(`${actaRel} already exists`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  // From here the retro writes, and it reverses nothing (spec round 2): a reversal can overwrite or delete state this run
  // does not own. A failure after the first write names every path written so far, in first-write order, and stops;
  // a person inspects those paths with git. `writing` notes what a step created, by comparing the directories it
  // writes in before and after, so a create that succeeded and then failed partway is still named.
  const phys = realpathSync(root);
  const written: string[] = [];
  const note = (rel: string): void => void (written.includes(rel) || written.push(rel));
  // An existing file this run changes counts as written once it opens for writing, before any byte goes in. The probe
  // open uses the flags the writer will use, so a permission refusal surfaces here and is not recorded.
  const claim = (rel: string, flags: number): void => {
    requireRealDirectory(dirname(join(phys, rel))); // no symlink in any parent: the open below refuses only the last component
    closeSync(openSync(join(phys, rel), flags | constants.O_NOFOLLOW));
    note(rel);
    retroTestHooks.afterOpen?.(rel);
  };
  const writing = <T>(step: () => T): T => {
    const before = listing(phys);
    try {
      return step();
    } finally {
      for (const rel of [...listing(phys)].filter((r) => !before.has(r)).sort()) note(rel);
    }
  };
  try {
  // 1. new fix opera
  const fixIds = new Map<string, string>();
  for (const cls of classes) {
    const fix = fixOf.get(cls)!;
    if (typeof fix === "string") {
      fixIds.set(cls, fix);
      continue;
    }
    const made = writing(() => newItem(root, { kind: "opus", collegium: fix.collegium, title: fix.title }));
    if (!made.ok || made.id === undefined) throw new Error(`fix of "${cls}": ${made.message}`);
    fixIds.set(cls, made.id);
  }

  // 2. one lesson per class
  const lessons: { id: string; cls: string }[] = [];
  for (const cls of classes) {
    const mine = entries.filter((e) => e.cls === cls).sort((a, b) => (a.log === b.log ? a.n - b.n : a.log < b.log ? -1 : 1));
    const evidence = [...new Set(mine.map((e) => e.log))].sort();
    const body = mine.map((e) => `${e.log} #${e.n}: ${verdicts.findings.find((f) => f.log === e.log && f.n === e.n)!.text.slice(0, 200)}`);
    const created = writing(() =>
      createNextRecord(root, "lessons", "L", (candidate) =>
      [
        "---",
        `id: ${JSON.stringify(candidate)}`,
        `at: ${now.toISOString()}`,
        `class: ${JSON.stringify(cls)}`,
        `evidence: ${JSON.stringify(evidence)}`,
        `opus: ${JSON.stringify(id)}`,
        `severity: ${severity.get(cls)}`,
        `addressed_by: ${JSON.stringify(fixIds.get(cls))}`,
        "---",
        ...body,
        "",
      ].join("\n"),
      ),
    );
    lessons.push({ id: created.id, cls });
  }

  // 3. greenlight each high lesson's backlog fix, by the decision the setting names; no Patron timeline line
  const started: { fix: string; decision: string }[] = [];
  if (setting?.highGreenlitBy !== undefined) {
    for (const cls of classes) {
      const fix = fixIds.get(cls)!;
      if (severity.get(cls) !== "high" || opusState(root, fix) !== "backlog") continue;
      const fixPath = safeItemPath(join(root, "opera"), fix);
      if (typeof fixPath !== "string") throw new Error(`opera: ${fixPath.error}`);
      claim(relative(root, fixPath).split(sep).join("/"), constants.O_WRONLY);
      editOpusFrontMatter(fixPath, (doc) => {
        doc.setIn(["state"], "greenlit");
        doc.setIn(["greenlit_by"], setting.highGreenlitBy);
        return undefined;
      });
      if (existsSync(join(phys, EVENTS_LOG_REL))) claim(EVENTS_LOG_REL, constants.O_RDWR | constants.O_APPEND);
      writing(() => emitEvent(root, manifest, "workflow.greenlight", now, { [WF.ITEM_ID]: fix, [WF.GREENLIGHT]: "granted" }));
      started.push({ fix, decision: setting.highGreenlitBy });
    }
  }

  // 4. last, the acta: its presence is what files the retro
  const acta = [
    "---",
    "author: qa-lead",
    "kind: decision",
    `title: ${JSON.stringify(`Retro ${id}`)}`,
    `at: ${now.toISOString()}`,
    `opus: ${JSON.stringify(id)}`,
    "---",
    `# Retro ${id}`,
    "",
    "## Sources",
    "",
    ...(verdicts.sources.length ? verdicts.sources.map((s) => `- ${s}`) : ["- (none)"]),
    "",
    "## Lessons",
    "",
    ...(lessons.length ? lessons.map((l) => `- ${l.id}: ${l.cls}, severity ${severity.get(l.cls)}, fix ${fixIds.get(l.cls)}`) : ["- (none)"]),
    "",
    "## Not lessons",
    "",
    ...(entries.some((e) => e.notALesson !== undefined) ? entries.filter((e) => e.notALesson !== undefined).map((e) => `- ${e.log} #${e.n}: ${oneLine(e.notALesson!)}`) : ["- (none)"]),
    "",
    "## Fixes started",
    "",
    ...(started.length ? started.map((s) => `- ${s.fix}: greenlit by ${s.decision}`) : ["- (none)"]),
    "",
  ].join("\n");
  realDir(root, "acta");
  // exclusive create: an entry already there is an I/O failure and is left as it was
  writing(() => {
    writeFileSync(join(ensureRealDirectory(root, "acta"), basename(actaPath)), acta, { flag: "wx" });
  });
  return { path: actaRel };
  } catch (e) {
    // every refusal was decided before this block: whatever fails from here is an I/O failure
    throw new RetroIoError(written, e as NodeJS.ErrnoException);
  }
}

/** Test-only fault injection: `afterOpen` runs once a path to be written is opened and recorded, before its bytes. */
export const retroTestHooks: { afterOpen?: (rel: string) => void } = {};

/** A failure in the write phase: names every path written in this run, in first-write order. */
export class RetroIoError extends Error {
  constructor(written: string[], cause: NodeJS.ErrnoException) {
    super(`I/O failure after writing [${written.join(", ")}]; failing path ${cause.path ?? "(unknown)"}: ${cause.message}`);
  }
}

/** The retro's output directories and what they hold, as officina-relative entries ("d/" for a directory). */
function listing(phys: string): Set<string> {
  const out = new Set<string>();
  for (const d of ["opera", "lessons", "acta", ".bisellium"]) {
    try {
      if (!lstatSync(join(phys, d)).isDirectory()) continue;
      out.add(`${d}/`);
      for (const n of readdirSync(join(phys, d))) out.add(`${d}/${n}`);
    } catch {
      // absent
    }
  }
  return out;
}

/** A physical officina directory, which must be a real directory (not a symlink) or absent: where the retro writes. */
function realDir(root: string, name: string): string {
  const dir = join(realpathSync(root), name);
  try {
    requireRealDirectory(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${name}: ${(e as Error).message}`);
  }
  return dir;
}

/** The event log a greenlight appends to: `.bisellium/` absent or a real directory, `events.jsonl` absent or a regular file (lstat; no permission check). */
function eventLogProblem(root: string): void {
  realDir(root, ".bisellium");
  const log = join(realpathSync(root), EVENTS_LOG_REL);
  try {
    const stat = lstatSync(log);
    if (!stat.isFile()) throw new Error(`${EVENTS_LOG_REL}: must be a regular file, not a symbolic link or directory`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** An opus's state, or undefined when it is not an opus record. */
function opusState(root: string, id: string): string | undefined {
  const rec = readOpus(root, id);
  return isRefusal(rec) || typeof rec["state"] !== "string" ? undefined : rec["state"];
}

// ---------------------------------------------------------------------------
// Seam S1 — runRetro: self-parsing `bisellium retro`
// ---------------------------------------------------------------------------

const RETRO_USAGE =
  "usage: bisellium retro --cascade <N> [--from <json>] [--studio <dir>] [--now <iso>]\n" +
  "       bisellium retro --opus <id> --from <triage.json> [--studio <dir>] [--now <iso>]";

const EMPTY_INPUT: RetroInput = { verifierIssues: 0, reviewFindings: [], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0 };

export function runRetro(args: string[], opts: { now?: Date } = {}): { exitCode: number } {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) { console.error(`unexpected argument "${a}"\n${RETRO_USAGE}`); return { exitCode: 2 }; }
    const eq = a.indexOf("=");
    const k = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    if (!["--cascade", "--opus", "--from", "--studio", "--now"].includes(k)) { console.error(`flag ${k} not allowed for "retro"\n${RETRO_USAGE}`); return { exitCode: 2 }; }
    const v = inline ?? args[++i];
    if (v === undefined) { console.error(`${k} needs a value\n${RETRO_USAGE}`); return { exitCode: 2 }; }
    values.set(k, v);
  }

  const opusId = values.get("--opus");
  if (opusId !== undefined && (values.has("--cascade") || !values.has("--from"))) { console.error(`--opus excludes --cascade and requires --from\n${RETRO_USAGE}`); return { exitCode: 2 }; }
  const cascadeRaw = values.get("--cascade");
  const cascade = cascadeRaw !== undefined ? Number(cascadeRaw) : NaN;
  if (opusId === undefined && (!cascadeRaw || !Number.isFinite(cascade))) { console.error(RETRO_USAGE); return { exitCode: 2 }; }

  const studio = resolve(values.get("--studio") ?? ".");
  if (!existsSync(join(studio, "bisellium.yml"))) { console.error(`${studio}: not a studio`); return { exitCode: 2 }; }

  let now = opts.now ?? new Date();
  if (values.has("--now")) {
    const parsed = instant(values.get("--now"));
    if (!parsed) { console.error("--now must be an ISO date"); return { exitCode: 2 }; }
    now = parsed;
  }

  if (opusId !== undefined) {
    try {
      const triage: unknown = JSON.parse(readFileSync(resolve(values.get("--from")!), "utf8"));
      console.log(draftOpusRetro(studio, opusId, triage, now).path);
      return { exitCode: 0 };
    } catch (e) {
      console.error(oneLine((e as Error).message));
      return { exitCode: e instanceof RetroIoError ? 1 : 2 };
    }
  }

  let input: RetroInput = EMPTY_INPUT;
  const fromPath = values.get("--from");
  if (fromPath !== undefined) {
    const p = isAbsolute(fromPath) ? fromPath : resolve(fromPath);
    try {
      input = JSON.parse(readFileSync(p, "utf8")) as RetroInput;
    } catch (e) {
      console.error(`--from ${fromPath}: ${(e as Error).message}`);
      return { exitCode: 2 };
    }
  }

  try {
    const draft = draftRetro(studio, cascade, input, now);
    console.log(draft.path);
    return { exitCode: 0 };
  } catch (e) {
    console.error((e as Error).message);
    return { exitCode: 2 };
  }
}
