/**
 * `checkInstructions` (W-017) — advisory rules over the generated ROM tier:
 * `instructions.present` (neither CLAUDE.md nor AGENTS.md exists at the
 * repo root), `cap.instructions` (a generated file is over the 6,000-char
 * cap), `instructions.stale` (a committed file no longer matches the
 * current render). All three are "advise", never "block" — a stale doc
 * should never itself fail a build.
 *
 * `root` is the OFFICINA (e.g. `studio/`); CLAUDE.md/AGENTS.md/GLOSSARY.md
 * live at the REPO ROOT, reached only via `opts.repo`. When `opts.repo` is
 * absent this returns `[]` rather than guessing — for `examples/sample-studio`
 * the officina's parent (`examples/`) is not the repo root, so inferring it
 * from `dirname(root)` would silently check the wrong directory.
 * `checkInstructions` never throws.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, RuleOpts } from "../check.js";
import { renderInstructions } from "../instructions.js";

const CAP = 6000;
const GENERATED_FILES = ["CLAUDE.md", "AGENTS.md", "GLOSSARY.md"] as const;

export function checkInstructions(root: string, opts: RuleOpts): Finding[] {
  const findings: Finding[] = [];
  try {
    if (!opts.repo) return [];
    const repo = opts.repo;

    const claudeExists = existsSync(join(repo, "CLAUDE.md"));
    const agentsExists = existsSync(join(repo, "AGENTS.md"));
    if (!claudeExists && !agentsExists) {
      findings.push({
        rule: "instructions.present",
        level: "advise",
        where: repo,
        message: "neither CLAUDE.md nor AGENTS.md exists at the repo root — run `bisellium instructions --write`",
      });
      return findings;
    }

    let rendered: { claude: string; agents: string; glossary: string } | undefined;
    try {
      rendered = renderInstructions(root, { now: opts.now });
    } catch {
      rendered = undefined;
    }
    const wanted: Record<(typeof GENERATED_FILES)[number], string> | undefined = rendered
      ? { "CLAUDE.md": rendered.claude, "AGENTS.md": rendered.agents, "GLOSSARY.md": rendered.glossary }
      : undefined;

    for (const name of GENERATED_FILES) {
      const path = join(repo, name);
      if (!existsSync(path)) continue;
      let content: string;
      try {
        content = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      if (content.length > CAP) {
        findings.push({
          rule: "cap.instructions",
          level: "advise",
          where: name,
          message: `${name} is ${content.length} characters, over the ${CAP}-character cap`,
        });
      }
      if (wanted && content !== wanted[name]) {
        findings.push({
          rule: "instructions.stale",
          level: "advise",
          where: name,
          message: `${name} differs from the current render — run \`bisellium instructions --write\``,
        });
      }
    }
    return findings;
  } catch {
    return findings;
  }
}
