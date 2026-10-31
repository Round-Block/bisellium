/**
 * scripts/installed-inventory.mjs — W-477 (studio/briefs/W-477.md, revision 2): the installed copies of one package
 * against the lockfile, offline. The lockfile is not the install: a node_modules left from before the lock moved, or an
 * extra copy npm ci would not write, is what eslint loads. `installedInventoryProblems` walks the install and names
 * every difference; scripts/source-map-js.test.mjs runs it for minimatch on the real tree and on fixtures.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The lock's entries for `name`: a `packages` key ending `node_modules/<name>`, or an entry whose `name` is `name` (an
 *  npm alias), as `{ key: version }`. */
export function lockedCopies(packages, name) {
  const out = {};
  for (const [key, entry] of Object.entries(packages ?? {})) {
    if (key === "") continue;
    if (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`) || entry?.name === name)
      out[key] = entry?.version;
  }
  return out;
}

/** The node_modules folders the walk starts at: `<root>/node_modules` and `<root>/<ws>/node_modules` for each folder a
 *  `workspaces` pattern of `<root>/package.json` names. A pattern is `<dir>/*` or a plain folder; any other is a problem. */
function startFolders(root, problems) {
  const starts = ["node_modules"];
  let workspaces = [];
  try {
    workspaces = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.workspaces ?? [];
  } catch {
    problems.push("package.json is unreadable");
  }
  if (!Array.isArray(workspaces)) workspaces = [];
  for (const pattern of workspaces) {
    if (typeof pattern === "string" && /^[\w.-]+\/\*$/.test(pattern)) {
      const dir = pattern.slice(0, -2);
      for (const e of entries(join(root, dir))) if (isDir(join(root, dir, e))) starts.push(`${dir}/${e}/node_modules`);
    } else if (typeof pattern === "string" && /^[\w.-]+(\/[\w.-]+)*$/.test(pattern))
      starts.push(`${pattern}/node_modules`);
    else problems.push(`workspaces pattern ${JSON.stringify(pattern)} is not read`);
  }
  return starts;
}

const entries = (dir) => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};
/** A real directory: a symlink is never followed. */
const isDir = (p) => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Every installed copy of `name` under the start folders, as `{ key: version | undefined }` (key as the lock writes it):
 *  a package folder (a real directory under a node_modules, or under a `@scope` there) whose folder name is `name` or
 *  whose package.json `name` is `name`; walked into each package's own node_modules. A copy whose package.json cannot be
 *  read is `undefined`. */
export function installedCopies(root, name, problems = []) {
  const out = {};
  const walk = (rel) => {
    for (const e of entries(join(root, rel))) {
      if (e.startsWith(".")) continue;
      const at = `${rel}/${e}`;
      if (!isDir(join(root, at))) continue;
      if (e.startsWith("@")) {
        for (const s of entries(join(root, at))) if (isDir(join(root, at, s))) visit(`${at}/${s}`, s);
      } else visit(at, e);
    }
  };
  const visit = (at, folder) => {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, at, "package.json"), "utf8"));
    } catch {
      manifest = undefined;
    }
    if (folder === name || manifest?.name === name)
      out[at] = typeof manifest?.version === "string" ? manifest.version : undefined;
    if (isDir(join(root, at, "node_modules"))) walk(`${at}/node_modules`);
  };
  for (const start of startFolders(root, problems)) if (isDir(join(root, start))) walk(start);
  return out;
}

const below = (version, floor) => {
  const parts = version.split(".").map(Number);
  const at = parts.findIndex((n, i) => n !== floor[i]);
  return at !== -1 && parts[at] < floor[at];
};

/** Every difference between the installed copies of `name` and the lock's, and every copy below `floor`: one line each,
 *  in key order. Empty is a match. */
export function installedInventoryProblems(root, packages, name, floor) {
  const problems = [];
  const installed = installedCopies(root, name, problems);
  const locked = lockedCopies(packages, name);
  for (const key of [...new Set([...Object.keys(installed), ...Object.keys(locked)])].sort()) {
    const has = Object.hasOwn(installed, key);
    const v = installed[key];
    if (!Object.hasOwn(locked, key))
      problems.push(`${key} is installed at ${v ?? "an unreadable version"} and the lock has no such entry`);
    else if (!has) problems.push(`${key} is in the lock at ${locked[key]} and not installed`);
    else if (v === undefined) problems.push(`${key} has an unreadable package.json`);
    else if (v !== locked[key]) problems.push(`${key} is installed at ${v} and the lock has ${locked[key]}`);
    else if (!/^\d+\.\d+\.\d+$/.test(v) || below(v, floor))
      problems.push(`${key} is installed at ${v}, below ${floor.join(".")}`);
  }
  return problems;
}
