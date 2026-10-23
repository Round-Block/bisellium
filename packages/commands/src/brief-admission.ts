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

/** W-326: the numbered behaviours `countBehaviours` counts, each as its real lines from its item line up to the next
 *  item or the section's end (continuation lines kept; fences and HTML comments blank), so a reader of one behaviour's
 *  text (`redCommand`) shares admission's parser and its section heading. */
export function behaviourItems(briefText: string): string[][] {
  const items: string[][] = [];
  for (const line of behavioursSection(realLines(briefText)) ?? []) {
    if (/^\s{0,3}\d+\.\s/.test(line)) items.push([]);
    items[items.length - 1]?.push(line);
  }
  return items;
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

/** W-255: a light brief gives each numbered behaviour one red command, where `bisellium` opens a token. */
const RED_COMMAND = /(?<![^\s`])bisellium red (\S+) --behaviour ([^\s`]+)/g;

function redCommandProblems(section: string[]): string[] {
  const items: string[][] = [];
  for (const line of section) {
    if (/^\s{0,3}\d+\.\s/.test(line)) items.push([]);
    items[items.length - 1]?.push(line);
  }
  return items.flatMap((lines, i) => {
    const found = lines.flatMap((l) => [...l.matchAll(RED_COMMAND)]);
    if (found.length !== 1)
      return [`behaviour ${i + 1} names ${found.length} red commands; a light brief gives each behaviour one "bisellium red <opus> --behaviour ${i + 1} …"`];
    return found[0]![2] === String(i + 1) ? [] : [`behaviour ${i + 1}'s red command is not "bisellium red <opus> --behaviour ${i + 1} …"`];
  });
}

const captured = (lines: string[], re: RegExp): string[] =>
  lines.flatMap((l) => {
    const m = re.exec(l);
    return m ? [m[1]!.trim()] : [];
  });

const DOMAIN_HEADING = /^#{2,3} Input domain\s*$/;
const DOMAIN_COLUMNS = [/^(record|input)$/i, /^valid domain$/i, /^rejected by$/i];
const REJECTING_FUNCTION = /^`[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?(\([^`]*\))?`/;
/** W-196 (D-050): a required job's step failure, a reused call judged by its exit, or a stated limit. */
const D050_REJECTOR = /^(?:(?:runner|exit): `[^`]+`\s*\S|limit: \S)/;
const NO_TABLE = 'input domain has no table with "Record", "Valid domain" and "Rejected by" columns and at least one row';

/** The cells of one table line: one leading and one trailing `|` dropped, split on unescaped `|`, trimmed. */
const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** The one "Input domain" section (`## ` or `### `, up to the next real `^#{1,3} ` line) and its first run of `|`
 *  lines, `at` the run's index in `real`; `starts` holds every heading's index, and unless it holds one there is no section. */
function domainTable(real: string[]): { starts: number[]; section: string[]; run: string[]; at: number } {
  const starts = real.flatMap((l, i) => (DOMAIN_HEADING.test(l) ? [i] : []));
  if (starts.length !== 1) return { starts, section: [], run: [], at: -1 };
  const end = real.findIndex((l, i) => i > starts[0]! && /^#{1,3} /.test(l));
  const section = real.slice(starts[0]! + 1, end === -1 ? undefined : end);
  const first = section.findIndex((l) => /^ {0,3}\|/.test(l));
  const run: string[] = [];
  for (let i = first; i !== -1 && i < section.length && /^ {0,3}\|/.test(section[i]!); i++) run.push(section[i]!);
  return { starts, section, run, at: first === -1 ? -1 : starts[0]! + 1 + first };
}

/** W-319: the 1-based brief lines of the Input domain table's rows, as `inputDomainProblems` reads the table: the run's
 *  lines after its header and delimiter. None with no section, a repeated heading or no table (admission refuses each). */
export function inputDomainRows(briefText: string): number[] {
  const { run, at } = domainTable(realLines(briefText));
  return run.slice(2).map((_, i) => at + 3 + i);
}

/** W-322: a pin names the test row and an assertion text that exercise a ruled case: pinned by `<row>` "<assertion>". */
const PIN = /(?<![\w-])[Pp]inned by `([^`]*[^`\s][^`]*)` "([^"]*[^"\s][^"]*)"/g;
const UNPINNED = /(?<![\w-])unpinned(?![\w-])/i;
/** W-322 (D-085 D): a Valid domain of any text or any string, and the forms clause such a row holds: "recognises", the
 *  forms (code spans, or `brief:<n>` and `brief:<a>-<b>` citations of the lines that list them), then "every other form"
 *  and "limit". */
const ANY_TEXT = /(?<![\w-])any (?:text|string)(?![\w-])/i;
const FORMS = /(?<![\w-])recogni[sz]es(?![\w-])(.*?)(?<![\w-])every other form(?![\w-]).*?(?<![\w-])limits?(?![\w-])/i;
const GRAMMAR_CITE = /(?<![\w./~-])brief:([1-9]\d*)(?:-([1-9]\d*))?(?![\w/~-]|\.[\w./~-])/g;
/** W-336 (D-076 D): a Valid domain naming a filesystem path, a command line or an environment value, by this fixed
 *  vocabulary; such a row holds a forms clause too, and its line or a line the clause cites names each hostile form. */
const PATH_TYPED = /(?<![\w-])(?:paths?|director(?:y|ies)|command(?: lines?|-line)|argv|arguments?|environment)(?![\w-])/i;
const HOSTILE: readonly (readonly [form: string, word: RegExp])[] = [
  ["a space", /(?<![\w-])(?:spaces?|whitespace)(?![\w-])/i],
  ["a quote", /(?<![\w-])quot(?:e|es|ed)(?![\w-])/i],
  ["a non-ASCII name", /(?<![\w-])non-ASCII(?![\w-])/i],
  ["a symlinked parent", /(?<![\w-])symlink(?:s|ed)?(?![\w-])/i],
];
/** W-373 (D-076 D): an input surface a row names in its Record or Valid domain cell, by a fixed vocabulary (`typed`), and
 *  the hostile forms its line, or a line its forms clause cites, names besides W-336's, each by one of its `words`. */
const SURFACES: readonly { surface: string; words: string; typed: RegExp; forms: readonly (readonly [form: string, word: RegExp])[] }[] = [
  {
    surface: "shell text",
    words: "operator, control character or reserved word",
    typed: /(?<![\w-])(?:command(?: lines?|-line)|shell)(?![\w-])/i,
    forms: [
      ["a shell operator", /(?<![\w-])operators?(?![\w-])/i],
      ["a control character", /(?<![\w-])control characters?(?![\w-])/i],
      ["a reserved word", /(?<![\w-])reserved words?(?![\w-])/i],
    ],
  },
  {
    surface: "a structured record",
    words: "absent, wrong type or unreadable",
    typed: /(?<![\w-])(?:JSON|YAML|front[ -]matter|settings)(?![\w-])/i,
    forms: [
      ["an absent value", /(?<![\w-])(?:absent|missing)(?![\w-])/i],
      ["a wrong type", /(?<![\w-])wrong(?: types?|-typed)(?![\w-])/i],
      ["an unreadable file", /(?<![\w-])unreadable(?![\w-])/i],
    ],
  },
];

/** W-322: one pin: the test row's name and a text of the assertion that exercises the case. */
export interface Pin {
  row: string;
  assertion: string;
}
/** W-322: a ruled case: an Input domain row (`row` is `line`), or a grammar line that row's forms clause cites (a row's own case comes first, then its cited lines, each carrying that row as `row`). */
export interface RuledCase {
  line: number;
  row: number;
  pins: Pin[];
  unpinned: boolean;
}

/** W-336: a path-typed row with no forms clause (`formless`, unless it is an any-text row, already formless), or whose
 *  line and cited lines do not name every hostile-but-valid form (`missing`, in `HOSTILE` order). */
export interface PathGap {
  row: number;
  formless: boolean;
  missing: string[];
}

/** W-373: a row naming an input surface whose line and cited lines do not name each of its forms (`missing`, in the
 *  surface's order); `words` are the words that name them. */
export interface SurfaceGap {
  row: number;
  surface: string;
  words: string;
  missing: string[];
}

/** W-381: a brief names a prototype when a real line, trimmed, opens `Prototype:` in any case (as W-326's `readPrototype`
 *  attempts it; a Prototype line inside an HTML comment is read there and not here). */
const PROTOTYPE_ATTEMPT = /^prototype\s*:/i;

/** W-322: the brief's ruled cases in brief order, each with the pins its real line holds; `formless`, the rows whose
 *  Valid domain says any text or any string and which hold no forms clause; W-336: `pathGaps`, the path-typed rows'.
 *  W-373: `surfaceGaps`, the rows naming a surface of `SURFACES`, whose cited lines are cases too. W-381: `promises`, each
 *  promise line `absolutePromiseProblems` reads (a `PROMISE_ATTEMPT` inside its span) as a case of its own, `row` its own
 *  line; `prototype`, whether the brief names a prototype. Text only, like `inputDomainRows`. */
export function ruledCases(briefText: string): {
  cases: RuledCase[];
  formless: number[];
  pathGaps: PathGap[];
  surfaceGaps: SurfaceGap[];
  promises: RuledCase[];
  prototype: boolean;
} {
  const real = realLines(briefText);
  // W-334: a line number past 15 digits is past any brief's last line, so it clamps without a double
  const clamp = (digits: string): number => (digits.length > 15 ? real.length : Math.min(Number(digits), real.length));
  const pinsOf = (n: number): Pin[] =>
    [...(real[n - 1] ?? "").matchAll(PIN)].map((m) => ({ row: m[1]!, assertion: m[2]! }));
  const cases: RuledCase[] = [];
  const formless: number[] = [];
  const pathGaps: PathGap[] = [];
  const surfaceGaps: SurfaceGap[] = [];
  for (const n of inputDomainRows(briefText)) {
    const text = real[n - 1]!;
    cases.push({ line: n, row: n, pins: pinsOf(n), unpinned: UNPINNED.test(text) });
    const domain = cellsOf(text)[1] ?? "";
    const anyText = ANY_TEXT.test(domain);
    const pathTyped = PATH_TYPED.test(domain);
    const named2 = cellsOf(text).slice(0, 2).join(" | ");
    const surfaces = SURFACES.filter((s) => s.typed.test(named2));
    if (!anyText && !pathTyped && surfaces.length === 0) continue;
    const clause = FORMS.exec(text)?.[1];
    // a cited range is clamped to the brief's last line: a start past it cites the last line alone
    const cited = [...(clause ?? "").matchAll(GRAMMAR_CITE)].flatMap((m) => {
      const a = clamp(m[1]!);
      const b = Math.max(a, m[2] === undefined ? a : clamp(m[2]));
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });
    const noForms = clause === undefined || (cited.length === 0 && !/`[^`]+`/.test(clause));
    if (anyText && noForms) formless.push(n);
    // the row's real line and each line its clause cites; a form named after "every other form" counts as a limit
    const named = [text, ...cited.map((m) => real[m - 1] ?? "")].join("\n");
    if (pathTyped) {
      const missing = HOSTILE.filter(([, word]) => !word.test(named)).map(([form]) => form);
      if ((!anyText && noForms) || missing.length > 0) pathGaps.push({ row: n, formless: !anyText && noForms, missing });
    }
    for (const { surface, words, forms } of surfaces) {
      const missing = forms.filter(([, word]) => !word.test(named)).map(([form]) => form);
      if (missing.length > 0) surfaceGaps.push({ row: n, surface, words, missing });
    }
    for (const m of new Set(cited)) cases.push({ line: m, row: n, pins: pinsOf(m), unpinned: false });
  }
  const { start, stop } = promiseSpan(real);
  const promises: RuledCase[] = [];
  for (let i = start; i < stop; i++)
    if (PROMISE_ATTEMPT.test(real[i]!.trim())) promises.push({ line: i + 1, row: i + 1, pins: pinsOf(i + 1), unpinned: UNPINNED.test(real[i]!) });
  const prototype = real.some((l) => PROTOTYPE_ATTEMPT.test(l.trim()));
  return { cases, formless, pathGaps, surfaceGaps, promises, prototype };
}

/** W-161: problems with the one "Input domain" section: a three-column table whose rows each name a record, its
 *  domain and one rejecting function, and which says that a rejection fails closed; or one `None: <reason>` line.
 *  Shape only: the named function is not looked up. */
function inputDomainProblems(real: string[]): string[] {
  const { starts, section, run } = domainTable(real);
  if (starts.length === 0)
    return [
      'declares no input domain; add one "## Input domain" section: a table with "Record", "Valid domain" and "Rejected by" columns, or one line "None: <reason>" if it reads no officina records',
    ];
  if (starts.length > 1) return [`has ${starts.length} "Input domain" headings; one section only`];
  const nones = section.filter((l) => l.startsWith("None:"));
  if (nones.length > 0) {
    if (nones.length > 1 || run.length > 0) return ['input domain mixes "None:" with a table or repeats it; one table or one "None: <reason>" line'];
    return /^None:\s*\S/.test(nones[0]!) ? [] : ['input domain "None:" line gives no reason'];
  }
  const head = run[0] === undefined ? [] : cellsOf(run[0]);
  const delimiter = run[1] === undefined ? [] : cellsOf(run[1]);
  if (
    head.length !== DOMAIN_COLUMNS.length ||
    !DOMAIN_COLUMNS.every((re, i) => re.test(head[i]!)) ||
    delimiter.length !== DOMAIN_COLUMNS.length ||
    !delimiter.every((c) => /^:?-{3,}:?$/.test(c)) ||
    run.length < 3
  )
    return [NO_TABLE];
  const problems: string[] = [];
  run.slice(2).forEach((l, i) => {
    const cells = cellsOf(l);
    if (cells.length !== DOMAIN_COLUMNS.length || cells.some((c) => c.length === 0))
      problems.push(`input domain row ${i + 1} has an empty or missing cell`);
    else if (!REJECTING_FUNCTION.test(cells[2]!) && !D050_REJECTOR.test(cells[2]!))
      problems.push(
        `input domain row ${i + 1} names no rejecting function; its "Rejected by" cell opens with one \`function\` name, or with "runner: \`job\` …", "exit: \`call\` …" or "limit: …" (D-050)`,
      );
  });
  if (!/fails closed/i.test(section.join("\n"))) problems.push("input domain does not say that a rejection fails closed");
  return problems;
}

const READS_ATTEMPT = /^read[\s_-]*enumeration\s*:/i;
const READS_FORM = /^Read enumeration: (?:`[^`\s]+` -> `[^`\s]+`|none: \S.*)$/;
const READS_LINE = "Read enumeration: `<kept script>` -> `<its output>`";

/** W-196: the one citation of the read enumeration the drafting ran. An attempt is a real line whose trimmed text
 *  matches READS_ATTEMPT; exactly one, in READS_FORM. The cited files are not read. */
function readEnumerationProblems(real: string[]): string[] {
  const attempts = real.map((l) => l.trim()).filter((l) => READS_ATTEMPT.test(l));
  if (attempts.length === 0) return [`cites no read enumeration; add one line "${READS_LINE}", or "Read enumeration: none: <reason>"`];
  if (attempts.length > 1) return [`has ${attempts.length} read enumeration lines; one only`];
  return READS_FORM.test(attempts[0]!) ? [] : [`read enumeration line "${attempts[0]}" is not "${READS_LINE}" or "Read enumeration: none: <reason>"`];
}

/** W-196: the closed list of absolute phrases admission reads, case-insensitive, whole words. */
const ABSOLUTE = /(?<![\w-])(always|in every case|in all cases|exactly as before|exactly as on master|exactly as today)(?![\w-])/i;
const LIST_MARKER = "(?:(?:[-*]|\\d+\\.)\\s+)?";
const PROMISE_ATTEMPT = new RegExp(`^${LIST_MARKER}Promise\\s+[^\\s:]+:`);
const PROMISE_HEAD = new RegExp(`^${LIST_MARKER}Promise ([a-z][a-z0-9]*(?:-[a-z0-9]+)*): (?=\\S)`);
const LIMIT_SEP = " — limit: ";
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const PROMISE_LINE = "Promise <slug>: <claim> — limit: <what does not hold>";

/** W-196: the slug and claim of a promise line: `^LIST_MARKER Promise <slug>: <claim> — limit: <limit>$`, where the claim
 *  and the limit open with a non-space and the whole of both holds no line break (what `.` matches). The claim ends at
 *  the first " — limit: " that a non-space follows. A scan, not a lazy regex: that backtracks quadratically (CodeQL). */
function parsePromise(t: string): { slug: string; claim: string } | undefined {
  const head = PROMISE_HEAD.exec(t);
  if (head === null) return undefined;
  const rest = t.slice(head[0].length);
  if (LINE_BREAK.test(rest)) return undefined;
  for (let at = rest.indexOf(LIMIT_SEP); at !== -1; at = rest.indexOf(LIMIT_SEP, at + 1))
    if (/\S/.test(rest.charAt(at + LIMIT_SEP.length))) return { slug: head[1]!, claim: rest.slice(0, at) };
  return undefined;
}

/** `text` with a trailing run of `.`, `,` or `;` dropped: `/[.,;]+$/`, which is quadratic on a long run (CodeQL). */
function withoutTrailingPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && ".,;".includes(text.charAt(end - 1))) end--;
  return text.slice(0, end);
}

/** `text` with its inline code spans removed: exactly `text.replace(/(`+).*?\1/g, "")`, in linear time (that regex is
 *  cubic on a long backtick run, CodeQL). A span opens at a backtick run of length r (from where the scan stands), takes
 *  the longest length k <= r that a later backtick run of at least k closes (any k <= r/2 closes inside its own run), and
 *  ends at the first such run. It never crosses a line break, so each break-free stretch is scanned alone. */
function withoutInlineCode(text: string): string {
  return text.replace(/[^\n\r\u2028\u2029]+/g, (line) => {
    const runs: { at: number; len: number }[] = [];
    for (const m of line.matchAll(/`+/g)) runs.push({ at: m.index, len: m[0].length });
    const longestAfter: number[] = new Array<number>(runs.length + 1).fill(0);
    for (let j = runs.length - 1; j >= 0; j--) longestAfter[j] = Math.max(longestAfter[j + 1]!, runs[j]!.len);
    let out = "";
    let pos = 0;
    for (let j = 0; j < runs.length; ) {
      const { at, len } = runs[j]!;
      if (at + len <= pos) {
        j++;
        continue;
      }
      const from = Math.max(pos, at);
      const r = at + len - from;
      const k = Math.max(r >> 1, Math.min(longestAfter[j + 1]!, r));
      if (k === 0) break;
      let end = from + 2 * k;
      if (2 * k > r) {
        let c = j + 1;
        while (runs[c]!.len < k) c++;
        end = runs[c]!.at + k;
      }
      out += line.slice(pos, from);
      pos = end;
    }
    return out + line.slice(pos);
  });
}

/** W-196: the span promise lines are read in, as indexes of `real`: from the first real "## Intent" line (else the top) up
 *  to the first real "## Out of scope" after it (else the end), that line excluded. */
function promiseSpan(real: string[]): { start: number; stop: number } {
  const intent = real.findIndex((l) => l.trim() === "## Intent");
  const start = intent === -1 ? 0 : intent;
  const stop = real.findIndex((l, i) => i > start && l.trim() === "## Out of scope");
  return { start, stop: stop === -1 ? real.length : stop };
}

/** W-196: inside `promiseSpan`, with inline code spans removed, an ABSOLUTE phrase appears only on a promise line, and each
 *  promise's slug and claim (lower-cased, spaces collapsed, trailing .,; dropped) appear once. */
function absolutePromiseProblems(real: string[]): string[] {
  const { start, stop } = promiseSpan(real);
  const slugs = new Set<string>();
  const claims = new Set<string>();
  const problems: string[] = [];
  for (let i = start; i < stop; i++) {
    const t = real[i]!.trim();
    if (PROMISE_ATTEMPT.test(t)) {
      const m = parsePromise(t);
      if (m === undefined) problems.push(`line ${i + 1}: a promise line is "${PROMISE_LINE}"`);
      else {
        const claim = withoutTrailingPunctuation(m.claim.toLowerCase().replace(/\s+/g, " "));
        if (slugs.has(m.slug)) problems.push(`line ${i + 1}: promise "${m.slug}" is declared twice; state each promise once`);
        else if (claims.has(claim)) problems.push(`line ${i + 1}: promise "${m.slug}" repeats an earlier promise's claim; state each promise once`);
        slugs.add(m.slug);
        claims.add(claim);
      }
      continue;
    }
    const hit = ABSOLUTE.exec(withoutInlineCode(t));
    if (hit !== null) problems.push(`line ${i + 1} says "${hit[1]}" outside a promise line; declare it once as "${PROMISE_LINE}"`);
  }
  return problems;
}

/** W-303: the standard wording for a brief's diff promise; it scopes itself to the source diff and names the evidence. */
export const SOURCE_DIFF_LINE =
  "The source diff (every path outside `studio/`) touches only the files in Files owned. The officina's evidence is written by the verbs and is not owned: the opus record, `studio/ci/` logs, `studio/ci/reds/<id>/` and receipts.";
/** W-303: a whole-diff subject, a confinement and a scope, each a closed list of phrases (case-insensitive, whole words). */
const WHOLE_DIFF = /(?<![\w-])(the (?:whole |entire |full )?diff|the (?:whole|entire|full) change|every (?:changed )?file|all (?:the )?(?:changed )?files)(?![\w-])/i;
const CONFINED = /files owned|(?<![\w-])(?:only|(?:is|are|lies|stays) (?:all |entirely )?(?:under|inside|within))(?![\w-])/i;
const SCOPED = /source (?:diff|change)|outside (?:the )?`?studio\b|officina(?:'s)? evidence/i;

/** W-303 (D-070 C): a sentence of a real line (split after `.`, `!`, `?` or `;` and at `|`) that, with inline code removed,
 *  names the whole diff and confines it (to Files owned, with "only", or under one folder) promises what the verbs' own
 *  evidence breaks, unless its raw line scopes it to the source diff or names the officina evidence. Limit: a promise
 *  wrapped across lines, or worded outside the closed lists, is not seen; one problem per line. */
function wholeDiffProblems(real: string[]): string[] {
  return real.flatMap((l, i) => {
    if (SCOPED.test(l)) return [];
    for (const s of l.split(/(?<=[.!?;])\s+|\|/)) {
      const t = withoutInlineCode(s);
      const hit = WHOLE_DIFF.exec(t);
      if (hit !== null && CONFINED.test(t))
        return [`line ${i + 1} confines "${hit[1]}" to Files owned or one folder, but the verbs also write officina evidence; scope it to the source diff or name that evidence as not owned: "${SOURCE_DIFF_LINE}"`];
    }
    return [];
  });
}

/** W-161: the one reader of `brief_behaviour_limit`. Absent is no admission; a positive integer is the limit;
 *  anything else, `null` included, is an error that fails closed in both callers. */
export function readBriefLimit(raw: unknown): { limit: number | undefined } | { error: string } {
  if (raw === undefined) return { limit: undefined };
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) return { limit: raw };
  return { error: "brief_behaviour_limit must be a positive integer" };
}

/** W-264 (L-186): the limit admission reads a brief under. A declared limit is that limit. With none, a brief carrying a
 *  brief form line (`Brief: light`, or one `readBriefForm` refuses) is read with no count, so its other rules still hold;
 *  a full brief is not read (`undefined`): full-brief admission stays opt-in through the key. */
export function admissionLimit(declared: number | undefined, briefText: string): number | undefined {
  if (declared !== undefined) return declared;
  const form = readBriefForm(briefText);
  return "error" in form || form.light ? Number.POSITIVE_INFINITY : undefined;
}

/** `exception`: the one "Behaviour limit exception:" value on an over-limit brief. It is not validated here
 *  (W-140: two parameters, as W-127 signed); `briefAdmissionProblems` checks it and places its problem. */
export function readBriefAdmission(briefText: string, limit: number): { problems: string[]; exception?: string } {
  const problems: string[] = [];
  const real = realLines(briefText);
  const { light, error } = briefForm(real);
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
    if (light) problems.push(...redCommandProblems(behavioursSection(real) ?? []));
  }
  if (!light) problems.push(...inputDomainProblems(real), ...readEnumerationProblems(real));
  problems.push(...absolutePromiseProblems(real), ...wholeDiffProblems(real));
  if (error !== undefined) problems.push(error);
  return exception === undefined ? { problems } : { problems, exception };
}

const RED_ORDER_LINE = "Red order: one at a time";

/** W-166: the brief-level opt-in to D-036's one-at-a-time red order. A marker attempt is a real line (outside
 *  fences and comments) whose trimmed text matches `/^red[\s_-]*order\s*:/i`. None: not declared. Exactly one,
 *  equal to "Red order: one at a time": declared. Otherwise an error. Limit: a misspelling that no longer
 *  matches that prefix (e.g. "Redorder:") reads as absent. */
export function readRedOrder(briefText: string): { declared: boolean } | { error: string } {
  const attempts = realLines(briefText)
    .map((l) => l.trim())
    .filter((l) => /^red[\s_-]*order\s*:/i.test(l));
  if (attempts.length === 0) return { declared: false };
  if (attempts.length > 1) return { error: `declares ${attempts.length} red order lines; one line "${RED_ORDER_LINE}" or none` };
  if (attempts[0] !== RED_ORDER_LINE) return { error: `red order line "${attempts[0]}" is not exactly "${RED_ORDER_LINE}"` };
  return { declared: true };
}

const BRIEF_FORM_LINE = "Brief: light";
const RISKY_FAMILY_TOKENS = ["security", "secret", "auth", "sandbox", "protection", "pipeline", "ci", "certify"];
const RISKY_PREFIXES = [".github/", ".claude/", "packages/pipeline/"];
const RISKY_FILES = new Set([
  "package.json",
  "scripts/agent-workspace.sh",
  "scripts/ci-certify.mjs",
  "scripts/ci-scope.mjs",
  "scripts/run-builder-host.mjs",
  "scripts/git-broker.mjs",
  "scripts/git-cell-client.mjs",
  "scripts/host-cells.mjs",
  "packages/commands/src/ci.ts",
  "packages/commands/src/verify.ts",
  "packages/commands/src/builder-run.ts",
  "packages/commands/src/run.ts",
  "packages/cli/src/integrate.ts",
]);

/** D-063 §4: the first sign that a light brief is security, sandbox, branch-protection or pipeline work: a token of a real
 *  `Decree family:` value, or a backticked span of a real `## Files owned` line (every such section, to the next real `^## `).
 *  A fixed list: work outside it rests on the signing architect and the build review (a path without backticks is not seen). */
function riskySignal(real: string[]): string | undefined {
  for (const family of captured(real, /^Decree family:(.*)$/)) {
    const token = family.split("-").find((t) => RISKY_FAMILY_TOKENS.includes(t));
    if (token !== undefined) return `decree family "${family}" names "${token}"`;
  }
  let owned = false;
  for (const line of real) {
    if (/^## /.test(line)) owned = line.trim() === "## Files owned";
    else if (owned)
      for (const [, span] of line.matchAll(/`([^`]+)`/g)) {
        const path = span!.replace(/^\.\//, "");
        if (RISKY_FILES.has(path) || RISKY_PREFIXES.some((p) => path.startsWith(p))) return `Files owned names \`${span}\``;
      }
  }
  return undefined;
}

/** W-305 (D-075 D): the bullets of every real `## Files owned` section (to the next real `^## `): a line opening, after
 *  at most three spaces, with `-`, `*` or `+` and a space before text. Prose, fenced and commented lines are not counted. */
function ownedBullets(real: string[]): number {
  let owned = false;
  let n = 0;
  for (const line of real) {
    if (/^## /.test(line)) owned = line.trim() === "## Files owned";
    else if (owned && /^ {0,3}[-*+] +\S/.test(line)) n++;
  }
  return n;
}

/** W-328 (D-106 A): every backticked span on a bullet line (as `ownedBullets` counts them) of every real `## Files owned`
 *  section, to the next real `^## `, a leading `./` dropped. Prose, fenced and commented lines are not read. */
export function ownedFiles(briefText: string): string[] {
  let owned = false;
  const out: string[] = [];
  for (const line of realLines(briefText)) {
    if (/^## /.test(line)) owned = line.trim() === "## Files owned";
    else if (owned && /^ {0,3}[-*+] +\S/.test(line)) for (const [, span] of line.matchAll(/`([^`]+)`/g)) out.push(span!.replace(/^\.\//, ""));
  }
  return out;
}

/** The brief's form with its error, if any. An excluded light brief is `{ light: true, error }`: it is checked as light
 *  (its own sections were never asked for an Input domain), and the exclusion is the one problem it adds. W-305 (D-075 D):
 *  a light brief also has at most one numbered behaviour (none is admission's own problem) and one to three Files owned
 *  bullets; the first rule it breaks is its error. */
function briefForm(real: string[]): { light: boolean; error?: string } {
  const attempts = real.map((l) => l.trim()).filter((l) => /^brief[\s_-]*:/i.test(l));
  if (attempts.length === 0) return { light: false };
  if (attempts.length > 1) return { light: false, error: `has ${attempts.length} brief form lines; one line "${BRIEF_FORM_LINE}" or none` };
  if (attempts[0] !== BRIEF_FORM_LINE) return { light: false, error: `brief form line "${attempts[0]}" is not exactly "${BRIEF_FORM_LINE}"` };
  const signal = riskySignal(real);
  if (signal !== undefined)
    return { light: true, error: `a light brief is not for security, sandbox, branch-protection or pipeline work (D-063 §4): ${signal}; use the full template` };
  const behaviours = (behavioursSection(real) ?? []).filter((l) => /^\s{0,3}\d+\.\s/.test(l)).length;
  if (behaviours > 1) return { light: true, error: `a light brief has one behaviour, but it numbers ${behaviours}; use the full template (D-075 D)` };
  const owned = ownedBullets(real);
  if (owned < 1 || owned > 3)
    return { light: true, error: `a light brief owns one to three files, one "- " bullet each under "## Files owned", but it lists ${owned}; use the full template (D-075 D)` };
  return { light: true };
}

/** W-255 (D-063 §4): whether the architect marked the brief light. An attempt is a real line (outside fences and
 *  comments) whose trimmed text matches `/^brief[\s_-]*:/i`. None: full. Exactly one, equal to "Brief: light": light,
 *  unless `riskySignal` finds the work is not for a light brief. Otherwise an error. */
export function readBriefForm(briefText: string): { light: boolean } | { error: string } {
  const form = briefForm(realLines(briefText));
  return form.error === undefined ? { light: form.light } : { error: form.error };
}
