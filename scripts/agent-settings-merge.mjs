/**
 * scripts/agent-settings-merge.mjs — merge the agent-isolation entries into a
 * Claude Code user settings file, keeping everything already there.
 *
 *   node scripts/agent-settings-merge.mjs <settings.json> <patronDir> <agentGh>
 *
 * `merge()` is pure (a new object, input untouched, idempotent); the CLI is the
 * only part that touches the filesystem. Used by scripts/agent-workspace.sh.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";

const union = (existing, add) => [...new Set([...(existing ?? []), ...add])];

export function merge(settings, { patronDir, agentGh }) {
  const out = structuredClone(settings);
  const sandbox = (out.sandbox ??= {});
  sandbox.enabled ??= true;
  const fs = (sandbox.filesystem ??= {});
  fs.denyRead = union(fs.denyRead, ["~/.ssh", "~/.git-credentials", "~/.config/gh"]);
  fs.denyWrite = union(fs.denyWrite, [patronDir]);
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

if (import.meta.filename === process.argv[1]) {
  const [file, patronDir, agentGh] = process.argv.slice(2);
  if (!file || !patronDir || !agentGh) {
    console.error("usage: agent-settings-merge.mjs <settings.json> <patronDir> <agentGh>");
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
  const after = merge(before, { patronDir, agentGh });
  if (exists && isDeepStrictEqual(before, after)) {
    console.log("unchanged");
  } else {
    if (exists) copyFileSync(file, `${file}.bak-${new Date().toISOString()}`);
    else mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(after, null, 2)}\n`);
    const had = new Set(lines(before));
    for (const l of lines(after)) if (!had.has(l)) console.log(`added ${l}`);
  }
}
