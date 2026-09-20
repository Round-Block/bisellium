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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { isoWeek } from "@bisellium/adapter-native";
import { safeItemPath } from "@bisellium/commands/writes.js";

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

function nextId(dir: string, prefix: string): string {
  let max = 0;
  let files: string[] = [];
  try {
    files = existsSync(dir) ? readdirSync(dir) : [];
  } catch {
    files = [];
  }
  const re = new RegExp(`^${prefix}-(\\d+)\\.md$`);
  for (const f of files) {
    const m = re.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

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
    let raw: string;
    try {
      raw = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
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

/** Classifies an `addressed_by` target by what exists on disk — never by
 *  `RULE_IDS` (retro.ts doesn't import `ids.ts`; see the opus's "Files
 *  owned" seam note) — and, for an opus target, reads its `state:` with the
 *  same regex style `existingLessonsByClass` already uses.
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
  if (existsSync(opusPath)) {
    let state = "unknown";
    try {
      const raw = readFileSync(opusPath, "utf8");
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
      const stateMatch = m ? /^state:\s*"?([^"\n]+)"?\s*$/m.exec(m[1]!) : null;
      if (stateMatch) state = stateMatch[1]!.trim();
    } catch {
      /* state stays "unknown" */
    }
    return { kind: "opus", state };
  }
  if (existsSync(decisionPath)) return { kind: "decision" };
  return { kind: "rule" };
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
    let raw: string;
    try {
      raw = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
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
    doc = parseYaml(readFileSync(path, "utf8"));
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
  let raw: string;
  try {
    raw = readFileSync(join(dir, best.file), "utf8");
  } catch {
    return undefined;
  }
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
  const lessonsDir = join(studioRoot, "lessons");
  const existingByClass = existingLessonsByClass(studioRoot);
  const lessons: { path: string; markdown: string; id: string; class: string }[] = [];
  let lessonSeq = 0;
  for (const cls of classesInOrder) {
    const findings = findingsByClass.get(cls)!;
    const evidence = [...new Set(findings.flatMap((f) => f.evidence))];
    lessonSeq++;
    // nextId reads the dir fresh each call, but two lessons in the same
    // run would otherwise collide on the same next number — offset by how
    // many we've already assigned this run.
    const base = nextId(lessonsDir, "L");
    const baseNum = Number(/L-(\d+)/.exec(base)![1]);
    const id = `L-${String(baseNum + lessonSeq - 1).padStart(3, "0")}`;
    const markdown = [
      "---",
      `id: ${JSON.stringify(id)}`,
      `at: ${now.toISOString()}`,
      `class: ${JSON.stringify(cls)}`,
      `evidence: ${JSON.stringify(evidence)}`,
      `cascade: ${cascade}`,
      "---",
      `Filed by \`bisellium retro --cascade ${cascade}\`. ${findings.length} finding(s) in this cascade.`,
      "",
    ].join("\n");
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
  const petitionesDir = join(studioRoot, "petitiones");
  const petitiones: string[] = [];
  const proposals: { class: string; kind: "adopt-alone" | "petitio"; petitioPath?: string }[] = [];
  for (const cls of classesInOrder) {
    if (recurrentClasses.has(cls)) {
      const targetForProposal = addressedTarget(existingByClass, cls);
      // An unresolvable (e.g. path-traversal) target is never "addressed":
      // the class still needs the Patron's attention, so it still files.
      if (targetForProposal !== undefined && classifyAddressedTarget(studioRoot, targetForProposal).kind !== "unresolvable") continue;
      // Petitiones are written *inside* this loop (just below), so `nextId`
      // already sees every one filed earlier in the same run — unlike
      // `lessonSeq` above (lessons are written after their loop, so
      // `nextId` alone would see none of them), no manual offset is needed
      // here, and adding one double-counts (the numbering-skip bug this
      // opus fixes).
      const pid = nextId(petitionesDir, "P");
      const ppath = `petitiones/${pid}.md`;
      const pmarkdown = [
        "---",
        `id: ${JSON.stringify(pid)}`,
        "from: qa-lead",
        "to: patron",
        "state: needs_you",
        `opened: ${now.toISOString()}`,
        "---",
        `Recurring finding class "${cls}" (cascade ${cascade} retro). Proposing a blocking rule or lex amendment — see the retro for detail.`,
        "",
      ].join("\n");
      mkdirSync(petitionesDir, { recursive: true });
      writeFileSync(join(studioRoot, ppath), pmarkdown);
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

  const actaDir = join(studioRoot, "acta");
  mkdirSync(actaDir, { recursive: true });
  const actaPath = `acta/${dateStr}-retro-${cascade}.md`;
  writeFileSync(join(studioRoot, actaPath), markdown);

  mkdirSync(lessonsDir, { recursive: true });
  for (const l of lessons) writeFileSync(join(studioRoot, l.path), l.markdown);

  return { path: actaPath, markdown, lessons: lessons.map((l) => ({ path: l.path, markdown: l.markdown })), petitiones };
}

// ---------------------------------------------------------------------------
// Seam S1 — runRetro: self-parsing `bisellium retro`
// ---------------------------------------------------------------------------

const RETRO_USAGE = "usage: bisellium retro --cascade <N> [--from <json>] [--studio <dir>] [--now <iso>]";

const EMPTY_INPUT: RetroInput = { verifierIssues: 0, reviewFindings: [], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0 };

export function runRetro(args: string[], opts: { now?: Date } = {}): { exitCode: number } {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) { console.error(`unexpected argument "${a}"\n${RETRO_USAGE}`); return { exitCode: 2 }; }
    const eq = a.indexOf("=");
    const k = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    if (!["--cascade", "--from", "--studio", "--now"].includes(k)) { console.error(`flag ${k} not allowed for "retro"\n${RETRO_USAGE}`); return { exitCode: 2 }; }
    const v = inline ?? args[++i];
    if (v === undefined) { console.error(`${k} needs a value\n${RETRO_USAGE}`); return { exitCode: 2 }; }
    values.set(k, v);
  }

  const cascadeRaw = values.get("--cascade");
  const cascade = cascadeRaw !== undefined ? Number(cascadeRaw) : NaN;
  if (!cascadeRaw || !Number.isFinite(cascade)) { console.error(RETRO_USAGE); return { exitCode: 2 }; }

  const studio = resolve(values.get("--studio") ?? ".");
  if (!existsSync(join(studio, "bisellium.yml"))) { console.error(`${studio}: not a studio`); return { exitCode: 2 }; }

  let now = opts.now ?? new Date();
  if (values.has("--now")) {
    const parsed = new Date(values.get("--now")!);
    if (Number.isNaN(parsed.getTime())) { console.error("--now must be an ISO date"); return { exitCode: 2 }; }
    now = parsed;
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
