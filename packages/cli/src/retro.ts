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

export interface RetroFinding {
  class: string;
  where: string;
  /** Required, non-empty — same contract lesson.evidence enforces. */
  evidence: string[];
}
export interface RetroInput {
  verifierIssues: number;
  reviewFindings: RetroFinding[];
  agents: { label: string; model: string; tokens: number; minutes: number }[];
  tests: number;
  fixRounds: number;
  mutationsCaught: number;
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
 *  lesson-id) pairs already filed — used for the recurrence computation so
 *  it sees history, not just this run's new lessons. Never throws. */
function existingLessonsByClass(studioRoot: string): Map<string, { cascade: number; id: string }[]> {
  const out = new Map<string, { cascade: number; id: string }[]>();
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
    if (!classMatch || !cascadeMatch) continue;
    const cls = classMatch[1]!.trim();
    const cascade = Number(cascadeMatch[1]);
    const id = idMatch ? idMatch[1]!.trim() : f.replace(/\.md$/, "");
    if (!out.has(cls)) out.set(cls, []);
    out.get(cls)!.push({ cascade, id });
  }
  return out;
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

  // ---- proposals: a recurring class is a blocking-rule/lex-wording
  // proposal (files a petitio); a one-off is advisory, adopted alone.
  const petitionesDir = join(studioRoot, "petitiones");
  const petitiones: string[] = [];
  const proposals: { class: string; kind: "adopt-alone" | "petitio"; petitioPath?: string }[] = [];
  let petitioSeq = 0;
  for (const cls of classesInOrder) {
    if (recurrentClasses.has(cls)) {
      petitioSeq++;
      const base = nextId(petitionesDir, "P");
      const baseNum = Number(/P-(\d+)/.exec(base)![1]);
      const pid = `P-${String(baseNum + petitioSeq - 1).padStart(3, "0")}`;
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
