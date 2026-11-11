/**
 * packages/commands/src/class-census.ts — W-563 (presign-meet-1109 call 2, D-189): a brief that answers a repeated class
 * names its census. `findingLines`, `OTHER_LOG` and `classesIn` are W-381's readers, moved from packages/cli/src/next.ts
 * (whose `repeatHold` imports them back, unchanged in behaviour), so `verdict --phase spec` reads classes as `next` does.
 * `CLASS_TAG` (D-070 B) moved here from verdict.ts, which re-exports it.
 *
 * ponytail: the census is checked for shape, not completeness (call 2 (i)): one listed site and no limit passes; the
 * round-1 reviewers' every-site clause and the reviewer judge the rest.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** D-070 B: a finding's class tag, `[class: <area>×<slug>]`. */
export const CLASS_TAG = /\[class: ([a-z0-9][a-z0-9-]*×[a-z0-9][a-z0-9-]*)\]/g;
/** W-381: another opus's review or spec log, by name: `<opus>-review-<n>.log` or `<opus>-spec-<n>.log`. */
export const OTHER_LOG = /^(.+)-(?:review|spec)-[1-9][0-9]{0,14}\.log$/;
/** W-381: the numbered lines of every `## Findings` section of a log (each to the next `## ` line), read loosely so it reads
 *  no less than is there: CRLF and CR line ends and trailing blanks are dropped first, and a log `parseVerdictLog` refuses
 *  (one written before a grammar it now holds, or with a second Findings section) still names its classes. */
export function findingLines(text: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const l of text.split(/\r\n|\r|\n/).map((x) => x.trimEnd())) {
    if (l.startsWith("## ")) inside = l === "## Findings";
    else if (inside && /^[1-9]\d*\. \S/.test(l)) out.push(l);
  }
  return out;
}
export const classesIn = (text: string): string[] => [...text.matchAll(CLASS_TAG)].map((m) => m[1]!);

const CENSUS_MAX_BYTES = 1024 * 1024;

/**
 * W-563 behaviour 4: the opus's repeated classes. Each class a standing `[severity: S1]` blocker of a failed review or spec
 * log of the opus under `ci/` carries is repeated when a second failed round of the opus carries it too, or
 * a Findings line (`findingLines`) of another opus's review or spec log does. An unlistable `ci/` (other than none at all),
 * or a name-matching log `read` (the officina's contained reader) cannot read, is an error. Every log, the opus's own
 * included, is read through `findingLines`, as repeatHold reads the logs it scans: never stricter than `next` on one record (W-558's class).
 */
export function repeatedClasses(ciDir: string, id: string, read: (rel: string) => string | undefined): string[] | { error: string } {
  let names: string[];
  try {
    names = readdirSync(ciDir).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    return { error: "ci/ cannot be listed" };
  }
  const rounds = new Map<string, number>();
  const elsewhere = new Set<string>();
  for (const name of names) {
    const m = OTHER_LOG.exec(name);
    if (m === null) continue;
    const text = read(`ci/${name}`);
    if (text === undefined) return { error: `ci/${name} cannot be read` };
    if (m[1] !== id) {
      for (const c of findingLines(text).flatMap(classesIn)) elsewhere.add(c);
      continue;
    }
    if (!text.split(/\r\n|\r|\n/).some((l) => l.trimEnd() === "# outcome: failed")) continue;
    const own = new Set(findingLines(text).filter((l) => /^[1-9]\d*\. blocking(?![\p{L}\p{M}\p{N}])/u.test(l) && /\[severity: S1\]/.test(l)).flatMap(classesIn));
    for (const c of own) rounds.set(c, (rounds.get(c) ?? 0) + 1);
  }
  return [...rounds].filter(([c, n]) => n > 1 || elsewhere.has(c)).map(([c]) => c);
}

const CENSUS = /^Class census: ([a-z0-9][a-z0-9-]*×[a-z0-9][a-z0-9-]*) ((?:\/|~\/)\S+) -> ((?:\/|~\/)\S+) sha256:([0-9a-f]{64})$/;
const expand = (p: string): string => {
  try {
    return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
  } catch {
    return "";
  }
};
function regular(path: string): Buffer | undefined {
  try {
    const st = statSync(path);
    return st.isFile() && st.size <= CENSUS_MAX_BYTES && isAbsolute(path) ? readFileSync(path) : undefined;
  } catch {
    return undefined;
  }
}

/** W-563 behaviour 4: why the brief's census lines do not answer `classes`: one well-shaped `Class census:` line per class. */
export function censusProblems(brief: string, classes: string[]): string[] {
  const problems: string[] = [];
  const lines = brief.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("Class census:"));
  const byClass = new Map<string, RegExpExecArray[]>();
  for (const l of lines) {
    const m = CENSUS.exec(l);
    if (m === null) problems.push(`"${l}" is not "Class census: <area>×<slug> <script path> -> <output path> sha256:<64 hex>"`);
    else byClass.set(m[1]!, [...(byClass.get(m[1]!) ?? []), m]);
  }
  for (const c of classes) {
    const got = byClass.get(c) ?? [];
    if (got.length === 0) {
      problems.push(`${c} is a repeated class of this opus, and the brief has no "Class census: ${c} <script> -> <output> sha256:<hex>" line`);
      continue;
    }
    if (got.length > 1) {
      problems.push(`${c} has ${got.length} "Class census:" lines; one only`);
      continue;
    }
    const [, , script, output, digest] = got[0]!;
    if (regular(expand(script!)) === undefined) problems.push(`${c}'s census script ${script} is not a readable regular file`);
    const out = regular(expand(output!));
    if (out === undefined) {
      problems.push(`${c}'s census output ${output} is not a readable regular file`);
      continue;
    }
    const actual = createHash("sha256").update(out).digest("hex");
    if (actual !== digest) problems.push(`${c}'s census output ${output} has sha256 ${actual}, not the ${digest} the brief names`);
    for (const [i, l] of out.toString("utf8").split("\n").entries()) {
      if (l.trim() === "") continue;
      if (!l.startsWith("site ") && !l.startsWith("limit ")) problems.push(`${c}'s census output line ${i + 1} opens neither "site " nor "limit "`);
      else if (l.startsWith("limit ") && !l.includes("follow-on:")) problems.push(`${c}'s census output line ${i + 1} is a limit with no "follow-on:"`);
    }
  }
  return problems;
}
