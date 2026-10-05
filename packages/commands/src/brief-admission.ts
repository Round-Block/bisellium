/**
 * packages/commands/src/brief-admission.ts — W-127: the text-only part of
 * brief admission. One declared decree family per brief and a bounded set of
 * numbered behaviours, each naming exactly one genuine red. No filesystem:
 * `lifecycle.ts` adds the decision lookup and both callers (`ready`, `check`).
 */

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

const captured = (lines: string[], re: RegExp): string[] =>
  lines.flatMap((l) => {
    const m = re.exec(l);
    return m ? [m[1]!.trim()] : [];
  });

export function readBriefAdmission(briefText: string, limit: number): { problems: string[]; exception?: string } {
  void limit;
  const problems: string[] = [];
  const families = captured(unfenced(briefText), /^Decree family:(.*)$/);
  if (families.length === 0) problems.push('declares no decree family; add one line "Decree family: <slug>"');
  else if (families.length > 1)
    problems.push(`declares ${families.length} decree families (${families.join(", ")}); one per brief, file each other family as its own opus`);
  else if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(families[0]!)) problems.push(`decree family "${families[0]}" is not one slug`);
  return { problems };
}
