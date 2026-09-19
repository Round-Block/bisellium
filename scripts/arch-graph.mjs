/**
 * scripts/arch-graph.mjs — prints the workspace dependency graph in docs/ARCHITECTURE.md
 * as a Mermaid `flowchart` block. Mechanical work is a script, not a hand-drawn picture
 * that drifts: every edge comes from a workspace's package.json plus a scan of the
 * `@bisellium/*` import specifiers in its own sources.
 *
 * Edge kinds, all derived, never listed by hand:
 *   solid  — declared in `dependencies` and statically imported by a non-test file
 *   dotted — imported with a dynamic `import()` (deliberately not a static ESM edge)
 *   dashed — `devDependencies` / test-only (the graph the shipped code does not have)
 *
 * Drift (declared-but-never-imported, imported-but-undeclared) goes to stderr so the
 * pasted block stays clean. Usage: node scripts/arch-graph.mjs [repoRoot]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WORKSPACE_DIRS = ["packages", "apps", "adapters"];
const SCOPE = "@bisellium/";
/** Edges whose real contract is an injection seam, not a plain import — the label
 *  the diagram needs and the import graph alone cannot tell you. */
const SEAM_LABELS = { "cli->server": "injects checkStudio + runners" };

const repoRoot = process.argv[2] ?? process.cwd();

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}

const isTestFile = (p) => /\.test\./.test(p) || /(^|[\\/])test[\\/]/.test(p);
const nodeId = (name) => name.slice(SCOPE.length).replace(/[^a-z0-9]/gi, "_");

// ---- collect workspaces ---------------------------------------------------
const pkgs = [];
for (const wsDir of WORKSPACE_DIRS) {
  for (const entry of readdirSync(join(repoRoot, wsDir)).sort()) {
    const dir = join(repoRoot, wsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      console.error(`note: ${wsDir}/${entry} has no package.json — not a workspace yet, omitted`);
      continue;
    }
    pkgs.push({ name: pkg.name, dir, rel: `${wsDir}/${entry}`, deps: pkg.dependencies ?? {}, devDeps: pkg.devDependencies ?? {} });
  }
}
const known = new Set(pkgs.map((p) => p.name));

// ---- scan imports ---------------------------------------------------------
const edges = new Map(); // "from->to" -> { from, to, kind }
const rank = { dashed: 0, dotted: 1, solid: 2 };
const addEdge = (from, to, kind) => {
  const key = `${from}->${to}`;
  const prev = edges.get(key);
  if (!prev || rank[kind] > rank[prev.kind]) edges.set(key, { from, to, kind });
};

for (const p of pkgs) {
  const imported = new Set();
  for (const file of walk(p.dir)) {
    const src = readFileSync(file, "utf8");
    const test = isTestFile(file);
    for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*)["'](@bisellium\/[^"'/]+)/g)) {
      const target = m[1];
      if (!known.has(target) || target === p.name) continue;
      imported.add(target);
      const dynamic = m[0].includes("(");
      const declared = target in p.deps;
      addEdge(p.name, target, test || !declared ? "dashed" : dynamic ? "dotted" : "solid");
      if (!declared && !(target in p.devDeps)) console.error(`drift: ${p.rel} imports ${target} but does not declare it`);
    }
  }
  for (const dep of Object.keys(p.deps)) {
    if (!known.has(dep)) continue;
    if (!imported.has(dep)) console.error(`drift: ${p.rel} declares ${dep} but never imports it`);
    else if (!edges.has(`${p.name}->${dep}`)) addEdge(p.name, dep, "solid");
  }
  for (const dep of Object.keys(p.devDeps)) if (known.has(dep)) addEdge(p.name, dep, "dashed");
}

// ---- print ----------------------------------------------------------------
const arrow = { solid: "-->", dotted: "-. dynamic .->", dashed: "-.->" };
const lines = ["flowchart TD"];
for (const p of pkgs.sort((a, b) => a.name.localeCompare(b.name))) {
  lines.push(`  ${nodeId(p.name)}["${nodeId(p.name).replace(/_/g, "-")}<br/>${relative(repoRoot, p.dir).replaceAll("\\", "/")}"]`);
}
for (const e of [...edges.values()].sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`))) {
  const from = nodeId(e.from);
  const to = nodeId(e.to);
  const seam = SEAM_LABELS[`${from}->${to}`];
  lines.push(`  ${from} ${seam ? `-- "${seam}" -->` : arrow[e.kind]} ${to}`);
}
console.log(lines.join("\n"));
console.error(`\n${pkgs.length} workspaces, ${edges.size} edges (solid = runtime import, dotted = dynamic, dashed = dev/test-only)`);
