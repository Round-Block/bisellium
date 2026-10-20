#!/usr/bin/env node
// W-288 part 1 (D-083 B): split docs/ADOPTION.md by its `## ` sections into the code-owned contract and six per-command
// reference files. Each section moves whole and byte for byte, in its original order; the only edits are the two
// `### ` headings that leave their parent section, written as `## `, a header on each new file, and one pointer line in
// ADOPTION.md. An argv other than none or `--repo <dir>`, an unreadable ADOPTION.md, a heading outside SECTIONS, or a
// reference file that already exists while ADOPTION.md still holds its sections, is refused before any write. Run again
// on a split tree it writes nothing.
//   node scripts/split-adoption.mjs [--repo <dir>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CONTRACT = "docs/ADOPTION.md";
const REFERENCE = {
  "docs/CHECK.md": "Reference: check",
  "docs/NEXT.md": "Reference: next",
  "docs/PIPELINE.md": "Reference: run, verify, ci and the merge queue",
  "docs/VERBS.md": "Reference: the record verbs",
  "docs/SERVE.md": "Reference: serve",
  "docs/TALK.md": "Reference: talk and probe",
};
// Every `## ` heading of the old file, and the two promoted `### ` ones, to the file it lands in.
const SECTIONS = {
  "## Vocabulary": CONTRACT,
  "## bisellium verdict": "docs/VERBS.md",
  "## decisions/D-nnn.md and lessons/L-nnn.md": CONTRACT,
  "## bisellium retro": "docs/VERBS.md",
  "## bisellium.yml": CONTRACT,
  "## Seats and instances": CONTRACT,
  "## Native opus model": CONTRACT,
  "## Lifecycle (fixed)": CONTRACT,
  "## The build-review loop (W-167, W-246, D-053)": CONTRACT,
  "## bisellium amend": "docs/VERBS.md",
  "## opera/<id>.md": CONTRACT,
  "## petitiones/<id>.md": CONTRACT,
  "## acta/<date>-<slug>.md": CONTRACT,
  "## aerarium/<period>.yml and usage.yml": CONTRACT,
  "## Running check": "docs/CHECK.md",
  "## Sleeps in tests": CONTRACT,
  "## Test row counts": CONTRACT,
  "## The SOURCE tree hash": CONTRACT,
  "## Running run and verify": "docs/PIPELINE.md",
  "## Running ci": "docs/PIPELINE.md",
  "## Merge queue": "docs/PIPELINE.md",
  "## Running next": "docs/NEXT.md",
  "## The spec review gate": CONTRACT,
  "## Writing to a studio (handoff, emit, answer, greenlight, budget)": "docs/VERBS.md",
  "## The `.bisellium/` directory": CONTRACT,
  "## Running serve": "docs/SERVE.md",
  "## Writing from a browser (W-067)": CONTRACT,
  "## Running tick, pause and resume": "docs/VERBS.md",
  "## Running talk": "docs/TALK.md",
  "## Running probe": "docs/TALK.md",
  "## Harness hooks (Claude Code)": CONTRACT,
  "## Disposable builder execution and review admission": CONTRACT,
};
const PROMOTED = new Set(["### The spec review gate", "### Writing from a browser (W-067)"]);
const POINTER =
  "Per-command reference: `docs/CHECK.md`, `docs/NEXT.md`, `docs/PIPELINE.md`, `docs/VERBS.md`, `docs/SERVE.md` and `docs/TALK.md`; where one disagrees with this contract, the contract wins.";
const header = (title) => [
  "---",
  "kind: guide",
  "owner: eng-lead",
  "tier: reference",
  "review: 2026-12-01",
  "kill: when the commands it describes are removed or fold back into docs/ADOPTION.md",
  "---",
  "",
  `# ${title}`,
  "",
  "Contract: `docs/ADOPTION.md`; where they disagree, the contract wins.",
  "",
];

const fail = (message) => {
  console.error(`split-adoption: ${message}; nothing written`);
  process.exit(1);
};

/** The repository to split: none given is the current directory; otherwise exactly `--repo <dir>` with a non-empty dir.
 *  Any other argv (an unknown flag, `--repo=<dir>`, a bare path, a missing or empty value, an extra argument) is an error,
 *  returned before any file is read. A value that is itself a flag (starts with `--`) is an error too, so `--repo --repo`
 *  cannot split a directory named `--repo`. Whether the directory exists is not known here: `main`'s read refuses a missing
 *  directory or an ADOPTION.md path, so that refusal comes at the read, not before I/O. */
function parseSplitArgs(argv) {
  if (argv.length === 0) return { repo: "." };
  if (argv.length === 2 && argv[0] === "--repo" && argv[1].length > 0 && !argv[1].startsWith("--"))
    return { repo: argv[1] };
  return { error: `usage: node scripts/split-adoption.mjs [--repo <dir>], not ${JSON.stringify(argv)}` };
}

function main() {
  const args = parseSplitArgs(process.argv.slice(2));
  if ("error" in args) fail(args.error);
  const repo = resolve(args.repo);
  let text;
  try {
    text = readFileSync(join(repo, CONTRACT), "utf8");
  } catch (e) {
    fail(`cannot read ${CONTRACT} in ${repo} (${e.code ?? e.message})`);
  }
  if (!text.endsWith("\n")) fail(`${CONTRACT} does not end with a newline`);
  const lines = text.slice(0, -1).split("\n");

  // Sections: the preamble, then one per heading line outside a fence.
  const sections = [{ heading: undefined, lines: [] }];
  let fenced = false;
  for (const line of lines) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading =
      !fenced && PROMOTED.has(line) ? line.slice(1) : !fenced && line.startsWith("## ") ? line : undefined;
    if (heading !== undefined) {
      if (!(heading in SECTIONS)) fail(`"${heading}" is not mapped to a file`);
      sections.push({ heading, lines: [heading] });
    } else sections.at(-1).lines.push(line);
  }
  if (fenced) fail(`${CONTRACT} ends inside a fence`);

  const out = new Map([...Object.keys(REFERENCE).map((f) => [f, header(REFERENCE[f])]), [CONTRACT, []]]);
  const preamble = sections[0].lines;
  if (!preamble.includes(POINTER)) preamble.push(POINTER, "");
  for (const s of sections) out.get(s.heading === undefined ? CONTRACT : SECTIONS[s.heading]).push(...s.lines);

  const moved = Object.keys(REFERENCE).filter((f) => out.get(f).length > header("").length);
  if (moved.length === 0) {
    const missing = Object.keys(REFERENCE).filter((f) => !existsSync(join(repo, f)));
    if (missing.length > 0) fail(`${CONTRACT} holds no reference section but ${missing.join(", ")} does not exist`);
    console.log("split-adoption: already split");
    return;
  }
  const clobber = Object.keys(REFERENCE).filter((f) => existsSync(join(repo, f)));
  if (clobber.length > 0) fail(`${clobber.join(", ")} already exists while ${CONTRACT} still holds reference sections`);
  const missing = Object.keys(REFERENCE).filter((f) => !moved.includes(f));
  if (missing.length > 0) fail(`${CONTRACT} holds no section for ${missing.join(", ")}`);
  // The six new files first, the contract last: a write that fails part-way leaves docs/ADOPTION.md whole. Limit: an
  // operating-system failure during these writes (including the final contract write) can leave a partial split; restore
  // docs/ADOPTION.md, remove the new reference files and rerun.
  for (const [file, body] of out) {
    writeFileSync(join(repo, file), `${body.join("\n")}\n`);
    console.log(`${file}: ${body.length} lines`);
  }
}

main();
