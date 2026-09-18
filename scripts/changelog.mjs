#!/usr/bin/env node
/**
 * scripts/changelog.mjs — generates CHANGELOG.md from `git log` (W-019).
 * Mechanical, deterministic, run and kept — never hand-edited.
 *
 * Grouping (`groupByCascade`): walking the log newest-first, a commit
 * subject that starts "Cascade N" opens group N; every commit from there
 * until the next "Cascade M" subject belongs to N. Anything newer than the
 * first "Cascade N" line encountered (i.e. not yet folded into a cascade)
 * lands under "Unreleased".
 *
 *   node scripts/changelog.mjs [repo-dir]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CASCADE_RE = /^Cascade\s+([^\s:]+)/;

/** @param {string[]} logLines - commit subjects, newest first. */
export function groupByCascade(logLines) {
  const groups = [{ cascade: "Unreleased", subject: "Unreleased", commits: [] }];
  let current = groups[0];
  for (const line of logLines) {
    const m = CASCADE_RE.exec(line);
    if (m) {
      current = { cascade: m[1], subject: line, commits: [] };
      groups.push(current);
    }
    current.commits.push(line);
  }
  return groups;
}

export function renderChangelog(groups) {
  const sections = groups
    .filter((g) => g.commits.length > 0)
    .map((g) => `## ${g.subject}\n\n${g.commits.map((c) => `- ${c}`).join("\n")}\n`);
  return `# Changelog\n\n${sections.join("\n")}`;
}

function gitLogSubjects(repoDir) {
  return execFileSync("git", ["-C", repoDir, "log", "--format=%s"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.length > 0);
}

function main() {
  const repoDir = resolve(process.argv[2] ?? ".");
  const groups = groupByCascade(gitLogSubjects(repoDir));
  writeFileSync(join(repoDir, "CHANGELOG.md"), renderChangelog(groups));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
