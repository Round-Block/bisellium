/**
 * packages/cli/src/rules/lex.ts — W-018 (2/4): leges as leges. The clause
 * convention (docs/LEX_TEMPLATE.md): a clause a `check` rule enforces ends
 * with `(check: <rule.id>)`. `lex.unchecked` (advise, one finding per lex)
 * reports the count of §2 ("Decides alone") / §3 ("Digests") / §4 ("Asks")
 * clauses with no such marker — it never fires per-clause, so adding one
 * more unchecked bullet to an already-noisy lex doesn't multiply findings.
 *
 * Seam S2: never throws, `[]` for a non-officina.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding, Level, RuleOpts } from "../check.js";

const CHECK_MARKER = /\(check:\s*[^)]+\)\s*$/;
const SECTION_HEADING = /^##\s+([0-9]+)\./;

/** Body text of §2/§3/§4 (numbered `## N. Title` headings), in file order. */
function numberedSections(text: string, numbers: Set<string>): string[] {
  const out: string[] = [];
  let capturing = false;
  let buf: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = SECTION_HEADING.exec(line);
    if (m) {
      if (capturing) out.push(buf.join("\n"));
      capturing = numbers.has(m[1]!);
      buf = [];
      continue;
    }
    if (capturing) buf.push(line);
  }
  if (capturing) out.push(buf.join("\n"));
  return out;
}

/** Top-level bullet clauses (`- ` / `* `) within a section body. */
function bulletClauses(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+\S/.test(l));
}

export function checkLex(root: string, _opts: RuleOpts): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, level: Level, where: string, message: string) => findings.push({ rule, level, where, message });

  if (!existsSync(join(root, "bisellium.yml"))) return findings;

  const legesDir = join(root, "leges");
  let files: string[] = [];
  try {
    files = existsSync(legesDir) ? readdirSync(legesDir).filter((f) => f.endsWith(".md")).sort() : [];
  } catch {
    files = [];
  }

  const sectionNumbers = new Set(["2", "3", "4"]);
  for (const f of files) {
    const where = `leges/${f}`;
    let text: string;
    try {
      text = readFileSync(join(legesDir, f), "utf8");
    } catch {
      continue; // unreadable lex is lex.present's job (check.ts), not ours
    }
    let unchecked = 0;
    for (const body of numberedSections(text, sectionNumbers)) {
      for (const clause of bulletClauses(body)) if (!CHECK_MARKER.test(clause)) unchecked++;
    }
    if (unchecked > 0)
      add("lex.unchecked", "advise", where, `${unchecked} clause(s) in §2/§3/§4 with no "(check: <rule.id>)" marker`);
  }

  return findings;
}
