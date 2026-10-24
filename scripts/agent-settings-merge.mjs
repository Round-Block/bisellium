/**
 * scripts/agent-settings-merge.mjs — merge the agent-isolation entries into a
 * Claude Code user settings file, keeping everything already there.
 *
 *   node scripts/agent-settings-merge.mjs [--check] <settings.json> <patronDir> <agentGh> [<agentDir>]
 *
 * W-398: with --check it only reads: exit 0 when the merge would change nothing, else exit 1 with one line per entry
 * the merge would add (or why the file cannot be merged); it never backs up, makes a folder or writes. Run by
 * scripts/agent-workspace.sh verify; setup and guard run it without --check, the only runs that write.
 *
 * W-362: the sandbox is always turned on (an existing `sandbox.enabled: false` would switch every deny
 * off), and with <agentDir> (absolute) it also denies writing the agent clone's source folders
 * (`SOURCE_DIRS`), so a session's shell cannot write them; `.worktrees/`, `studio/`, `docs/` and the
 * clone's root files stay writable. The sandbox is the whole session's: a subagent is denied there too.
 *
 * `merge()` is pure (a new object, input untouched, idempotent); the CLI is the
 * only part that touches the filesystem, and only without --check. Used by scripts/agent-workspace.sh.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const union = (existing, add) => [...new Set([...(existing ?? []), ...add])];

/** The agent clone's folders the sandbox keeps a session from writing (W-362, the Patron's ruling of 2026-10-22). */
export const SOURCE_DIRS = ["packages", "apps", "adapters", "scripts"];

const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Throws on a sandbox shape the merge would reshape (a denyWrite string spread into characters) instead of keeping. */
function checkShape({ sandbox }) {
  const fs = sandbox?.filesystem;
  if (sandbox !== undefined && !plain(sandbox)) throw new Error("sandbox is not an object");
  if (fs !== undefined && !plain(fs)) throw new Error("sandbox.filesystem is not an object");
  const dw = fs?.denyWrite;
  if (dw !== undefined && !(Array.isArray(dw) && dw.every((d) => typeof d === "string")))
    throw new Error("sandbox.filesystem.denyWrite is not an array of strings");
}

export function merge(settings, { patronDir, agentGh, agentDir }) {
  checkShape(settings);
  const out = structuredClone(settings);
  const sandbox = (out.sandbox ??= {});
  sandbox.enabled = true;
  const fs = (sandbox.filesystem ??= {});
  fs.denyRead = union(fs.denyRead, ["~/.ssh", "~/.git-credentials", "~/.config/gh"]);
  fs.denyWrite = union(fs.denyWrite, [patronDir, ...(agentDir ? SOURCE_DIRS.map((d) => join(agentDir, d)) : [])]);
  const permissions = (out.permissions ??= {});
  permissions.deny = union(permissions.deny, [
    "Read(~/.ssh/**)",
    "Read(~/.git-credentials)",
    "Read(~/.config/gh/**)",
    `Edit(/${patronDir}/**)`,
    `Write(/${patronDir}/**)`,
  ]);
  (out.env ??= {}).GH_CONFIG_DIR = agentGh;
  return out;
}

/** One `path: value` line per leaf or array element, so the CLI can print what merge() added. */
const lines = (o, prefix = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    Array.isArray(v)
      ? v.map((x) => `${prefix}${k}: ${JSON.stringify(x)}`)
      : v && typeof v === "object"
        ? lines(v, `${prefix}${k}.`)
        : [`${prefix}${k}: ${JSON.stringify(v)}`],
  );

// W-398: only as the program node was started with; an import (a `node -e` whose first argument is this path included)
// never runs it
if (import.meta.main) {
  const check = process.argv[2] === "--check";
  const [file, patronDir, agentGh, agentDir] = process.argv.slice(check ? 3 : 2);
  if (!file || !patronDir || !agentGh) {
    console.error("usage: agent-settings-merge.mjs [--check] <settings.json> <patronDir> <agentGh> [<agentDir>]");
    process.exit(2);
  }
  if (agentDir !== undefined && !isAbsolute(agentDir)) {
    console.error(`agentDir ${agentDir} must be an absolute path; nothing was written`);
    process.exit(2);
  }
  const exists = existsSync(file);
  let before = {};
  if (exists) {
    try {
      before = JSON.parse(readFileSync(file, "utf8"));
      if (before === null || typeof before !== "object" || Array.isArray(before)) throw new Error("not an object");
    } catch {
      console.error(`${file} is not valid JSON (an object); left untouched`);
      process.exit(1);
    }
  }
  let after;
  try {
    after = merge(before, { patronDir, agentGh, agentDir });
  } catch (e) {
    console.error(`${file}: ${e.message}; left untouched`);
    process.exit(1);
  }
  const same = exists && isDeepStrictEqual(before, after);
  if (check) {
    // W-398: read and report only; nothing below this line writes
    if (same) process.exit(0);
    if (!exists) console.log(`${file} does not exist`);
    const had = new Set(lines(before));
    const add = lines(after).filter((l) => !had.has(l));
    for (const l of add) console.log(`missing ${l}`);
    if (exists && add.length === 0)
      console.log(`${file} holds every entry, but the merge would rewrite it (a repeated entry)`);
    process.exit(1);
  }
  if (same) {
    console.log("unchanged");
  } else {
    if (exists) copyFileSync(file, `${file}.bak-${new Date().toISOString()}`);
    else mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(after, null, 2)}\n`);
    const had = new Set(lines(before));
    for (const l of lines(after)) if (!had.has(l)) console.log(`added ${l}`);
  }
}
