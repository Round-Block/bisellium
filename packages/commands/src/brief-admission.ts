/**
 * packages/commands/src/brief-admission.ts — W-127: the text-only part of
 * brief admission. One declared decree family per brief and a bounded set of
 * numbered behaviours, each naming exactly one genuine red. No filesystem:
 * `lifecycle.ts` adds the decision lookup and both callers (`ready`, `check`).
 */

/** The text with everything that is not real brief content blanked, line for line: fenced blocks (`^\s{0,3}`
 *  then three backticks toggles) and HTML comments (`<!-- … -->`, on one line or several). One rule for every
 *  reader below, so a decoy heading, numbered line or marker hidden in either cannot be selected or ended on. */
function realLines(briefText: string): string[] {
  let fence = false;
  let comment = false;
  return briefText.split(/\r?\n/).map((line) => {
    if (!comment && /^\s{0,3}```/.test(line)) {
      fence = !fence;
      return "";
    }
    if (fence) return "";
    let out = "";
    let rest = line;
    for (;;) {
      if (comment) {
        const end = rest.indexOf("-->");
        if (end === -1) return out;
        rest = rest.slice(end + 3);
        comment = false;
      } else {
        const open = rest.indexOf("<!--");
        if (open === -1) return out + rest;
        out += rest.slice(0, open);
        rest = rest.slice(open + 4);
        comment = true;
      }
    }
  });
}

const HEADING = "## Behaviours to test";

/** The lines of the first real "## Behaviours to test" section, up to the next real `^## ` heading; a repeated
 *  real heading ends it (and is reported by `readBriefAdmission`). `undefined` when there is none. */
function behavioursSection(real: string[]): string[] | undefined {
  const start = real.findIndex((l) => l.trim() === HEADING);
  if (start === -1) return undefined;
  const end = real.findIndex((l, i) => i > start && /^## /.test(l));
  return real.slice(start + 1, end === -1 ? undefined : end);
}

/** Exported for the test: N = the count of the ordered list directly under
 *  "## Behaviours to test" in a brief. Items match `^\s{0,3}\d+\.\s`;
 *  continuation lines, nested/indented items, bullet lists, and anything
 *  inside a fenced code block or an HTML comment, or after the next real
 *  `^## ` heading, don't count. */
export function countBehaviours(briefText: string): number {
  return (behavioursSection(realLines(briefText)) ?? []).filter((l) => /^\s{0,3}\d+\.\s/.test(l)).length;
}

/** Genuine-red markers per numbered behaviour (and before item 1), bounded like `countBehaviours`. */
function redMarkers(section: string[]): { before: number; per: number[] } {
  const per: number[] = [];
  let before = 0;
  for (const line of section) {
    if (/^\s{0,3}\d+\.\s/.test(line)) per.push(0);
    const k = (line.match(/(?<!`)\*\*Genuine red:\*\*/g) ?? []).length;
    if (per.length === 0) before += k;
    else per[per.length - 1]! += k;
  }
  return { before, per };
}

const captured = (lines: string[], re: RegExp): string[] =>
  lines.flatMap((l) => {
    const m = re.exec(l);
    return m ? [m[1]!.trim()] : [];
  });

const DOMAIN_HEADING = /^#{2,3} Input domain\s*$/;
const DOMAIN_COLUMNS = [/^(record|input)$/i, /^valid domain$/i, /^rejected by$/i];
const REJECTING_FUNCTION = /^`[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?(\([^`]*\))?`/;
const NO_TABLE = 'input domain has no table with "Record", "Valid domain" and "Rejected by" columns and at least one row';

/** The cells of one table line: one leading and one trailing `|` dropped, split on unescaped `|`, trimmed. */
const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** W-161: problems with the one "Input domain" section (`## ` or `### `, up to the next real `^#{1,3} ` line):
 *  a three-column table whose rows each name a record, its domain and one rejecting function.
 *  Shape only: the named function is not looked up. */
function inputDomainProblems(real: string[]): string[] {
  const starts = real.flatMap((l, i) => (DOMAIN_HEADING.test(l) ? [i] : []));
  if (starts.length === 0)
    return [
      'declares no input domain; add one "## Input domain" section: a table with "Record", "Valid domain" and "Rejected by" columns, or one line "None: <reason>" if it reads no officina records',
    ];
  if (starts.length > 1) return [`has ${starts.length} "Input domain" headings; one section only`];
  const end = real.findIndex((l, i) => i > starts[0]! && /^#{1,3} /.test(l));
  const section = real.slice(starts[0]! + 1, end === -1 ? undefined : end);
  const first = section.findIndex((l) => /^ {0,3}\|/.test(l));
  const run: string[] = [];
  for (let i = first; i !== -1 && i < section.length && /^ {0,3}\|/.test(section[i]!); i++) run.push(section[i]!);
  const head = run[0] === undefined ? [] : cellsOf(run[0]);
  const delimiter = run[1] === undefined ? [] : cellsOf(run[1]);
  if (
    head.length !== DOMAIN_COLUMNS.length ||
    !DOMAIN_COLUMNS.every((re, i) => re.test(head[i]!)) ||
    delimiter.length === 0 ||
    !delimiter.every((c) => /^:?-{3,}:?$/.test(c)) ||
    run.length < 3
  )
    return [NO_TABLE];
  const problems: string[] = [];
  run.slice(2).forEach((l, i) => {
    const cells = cellsOf(l);
    if (cells.length !== DOMAIN_COLUMNS.length || cells.some((c) => c.length === 0))
      problems.push(`input domain row ${i + 1} has an empty or missing cell`);
    else if (!REJECTING_FUNCTION.test(cells[2]!))
      problems.push(`input domain row ${i + 1} names no rejecting function; its "Rejected by" cell opens with one \`function\` name`);
  });
  return problems;
}

/** `exception`: the one "Behaviour limit exception:" value on an over-limit brief. It is not validated here
 *  (W-140: two parameters, as W-127 signed); `briefAdmissionProblems` checks it and places its problem. */
export function readBriefAdmission(briefText: string, limit: number): { problems: string[]; exception?: string } {
  const problems: string[] = [];
  const real = realLines(briefText);
  const families = captured(real, /^Decree family:(.*)$/);
  if (families.length === 0) problems.push('declares no decree family; add one line "Decree family: <slug>"');
  else if (families.length > 1)
    problems.push(`declares ${families.length} decree families (${families.join(", ")}); one per brief, file each other family as its own opus`);
  else if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(families[0]!)) problems.push(`decree family "${families[0]}" is not one slug`);
  let exception: string | undefined;
  const n = countBehaviours(briefText);
  if (n === 0) problems.push('numbers no behaviours under "## Behaviours to test"');
  else if (n > limit) {
    const exceptions = captured(real, /^Behaviour limit exception:(.*)$/);
    if (exceptions.length === 0)
      problems.push(
        `numbers ${n} behaviours; the limit is ${limit} (brief_behaviour_limit); split it by decree family, or cite an architect ruling on a "Behaviour limit exception:" line`,
      );
    else if (exceptions.length > 1) problems.push(`has ${exceptions.length} "Behaviour limit exception:" lines; at most one`);
    else {
      exception = exceptions[0]!;
    }
  }
  const headings = real.filter((l) => l.trim() === HEADING).length;
  if (headings > 1) problems.push(`has ${headings} "${HEADING}" headings; one section only`);
  if (n > 0) {
    const { before, per } = redMarkers(behavioursSection(real) ?? []);
    if (before > 0) problems.push('has a "**Genuine red:**" outside any numbered behaviour');
    per.forEach((k, i) => {
      if (k !== 1)
        problems.push(
          `behaviour ${i + 1} names ${k} genuine reds; each numbered behaviour names exactly one, so number every independent behaviour`,
        );
    });
  }
  problems.push(...inputDomainProblems(real));
  return exception === undefined ? { problems } : { problems, exception };
}
