#!/usr/bin/env node
/**
 * scripts/sweep-traditio-stage.mjs — cascade-23 cleanup: `check`'s
 * `traditio.stage` advisory fires whenever an opus is `state: done` but its
 * last recorded handoff still says `stage: building` (the record never
 * caught up once the opus actually finished). Mechanical, repeatable work
 * (a bulk fixup across many opera) is a script, never applied by hand
 * (engineering lex §2) — this one reads `studio/opera/*.md`, finds every
 * opus in that shape, and re-runs the real `bisellium handoff` command for
 * each so the fix goes through the same front-matter writer every other
 * handoff does. It never edits opera front matter itself.
 *
 * Usage: node scripts/sweep-traditio-stage.mjs [--studio <dir>] [--repo <dir>] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

function parseArgs(argv) {
  const values = { studio: "studio", repo: ".", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--studio") values.studio = argv[++i];
    else if (a === "--repo") values.repo = argv[++i];
    else if (a === "--dry-run") values.dryRun = true;
    else throw new Error(`unknown flag "${a}"`);
  }
  return values;
}

/** Front matter between the first two `---` lines, parsed as YAML.
 *  Undefined for a file with no (or malformed) front matter block. */
function readFrontMatter(path) {
  const text = readFileSync(path, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return undefined;
  try {
    return parseYaml(m[1]);
  } catch {
    return undefined;
  }
}

/** Opus ids whose `state` is "done" but whose last `traditio.stage` is not
 *  — the exact shape `check.ts`'s `traditio.stage` advisory reports. */
export function findStaleTraditio(operaDir) {
  const stale = [];
  for (const entry of readdirSync(operaDir)) {
    if (!entry.endsWith(".md")) continue;
    const path = join(operaDir, entry);
    const data = readFrontMatter(path);
    if (!data || typeof data !== "object") continue;
    if (data.state !== "done") continue;
    const stage = data.traditio?.stage;
    if (stage !== undefined && stage !== "done") stale.push(data.id ?? entry.replace(/\.md$/, ""));
  }
  return stale.sort();
}

function main() {
  const { studio, repo, dryRun } = parseArgs(process.argv.slice(2));
  const operaDir = join(resolve(studio), "opera");
  const ids = findStaleTraditio(operaDir);

  if (ids.length === 0) {
    console.log("sweep-traditio-stage: nothing to do");
    return;
  }

  const cliEntry = join(resolve(repo), "packages/cli/src/main.ts");
  for (const id of ids) {
    const args = [
      "--import",
      "tsx",
      cliEntry,
      "handoff",
      "--opus",
      id,
      "--sella",
      "producer",
      "--stage",
      "done",
      "--next",
      "Record aligned with state (sweep, 2026-09-20).",
      "--studio",
      studio,
    ];
    console.log(`sweep-traditio-stage: ${id} -> ${dryRun ? "(dry-run) " : ""}node ${args.join(" ")}`);
    if (dryRun) continue;
    execFileSync("node", args, { stdio: "inherit", cwd: resolve(repo) });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
