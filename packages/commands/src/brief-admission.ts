/**
 * packages/commands/src/brief-admission.ts — W-127: the text-only part of
 * brief admission. One declared decree family per brief and a bounded set of
 * numbered behaviours, each naming exactly one genuine red. No filesystem:
 * `lifecycle.ts` adds the decision lookup and both callers (`ready`, `check`).
 */

/** Exported for the test: N = the count of the ordered list directly under
 *  "## Behaviours to test" in a brief. Items match `^\s{0,3}\d+\.\s`;
 *  continuation lines, nested/indented items, bullet lists, and anything
 *  inside a fenced code block or after the next `^## ` heading don't count. */
export function countBehaviours(briefText: string): number {
  const lines = briefText.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## Behaviours to test");
  if (start === -1) return 0;

  let count = 0;
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^## /.test(line)) break;
    if (/^\s{0,3}\d+\.\s/.test(line)) count++;
  }
  return count;
}

/** Lines outside fenced blocks, with the same fence rule `countBehaviours`
 *  uses (`^\s{0,3}` then three backticks toggles). */
function unfenced(briefText: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of briefText.split(/\r?\n/)) {
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

/** Genuine-red markers per numbered behaviour (and before item 1), bounded like `countBehaviours`. */
function redMarkers(briefText: string): { before: number; per: number[] } {
  const lines = briefText.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "## Behaviours to test");
  const per: number[] = [];
  let before = 0;
  let inFence = false;
  for (let i = start + 1; start !== -1 && i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^## /.test(line)) break;
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

/** `exception`: the one "Behaviour limit exception:" value on an over-limit brief, for the caller to
 *  validate; `exceptionAt`: where in `problems` that validation's problem belongs (clause 2's slot). */
export function readBriefAdmission(
  briefText: string,
  limit: number,
): { problems: string[]; exception?: string; exceptionAt?: number } {
  const problems: string[] = [];
  const families = captured(unfenced(briefText), /^Decree family:(.*)$/);
  if (families.length === 0) problems.push('declares no decree family; add one line "Decree family: <slug>"');
  else if (families.length > 1)
    problems.push(`declares ${families.length} decree families (${families.join(", ")}); one per brief, file each other family as its own opus`);
  else if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(families[0]!)) problems.push(`decree family "${families[0]}" is not one slug`);
  let exception: string | undefined;
  let exceptionAt: number | undefined;
  const n = countBehaviours(briefText);
  if (n === 0) problems.push('numbers no behaviours under "## Behaviours to test"');
  else if (n > limit) {
    const exceptions = captured(unfenced(briefText), /^Behaviour limit exception:(.*)$/);
    if (exceptions.length === 0)
      problems.push(
        `numbers ${n} behaviours; the limit is ${limit} (brief_behaviour_limit); split it by decree family, or cite an architect ruling on a "Behaviour limit exception:" line`,
      );
    else if (exceptions.length > 1) problems.push(`has ${exceptions.length} "Behaviour limit exception:" lines; at most one`);
    else {
      exception = exceptions[0]!;
      exceptionAt = problems.length;
    }
  }
  if (n > 0) {
    const { before, per } = redMarkers(briefText);
    if (before > 0) problems.push('has a "**Genuine red:**" outside any numbered behaviour');
    per.forEach((k, i) => {
      if (k !== 1)
        problems.push(
          `behaviour ${i + 1} names ${k} genuine reds; each numbered behaviour names exactly one, so number every independent behaviour`,
        );
    });
  }
  return exception === undefined ? { problems } : { problems, exception, exceptionAt };
}
