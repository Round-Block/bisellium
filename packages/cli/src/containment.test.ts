/**
 * packages/cli/src/containment.test.ts — W-047 behaviour 4: two inventories
 * derived from the TypeScript AST, each compared against a pinned list.
 *
 * Inventory A is every call site of `safeItemPath` (packages/commands/src/
 * writes.ts:104) across every non-test `.ts` file under packages/, apps/ and
 * adapters/ — alias- and multiline-proof, because it resolves the helper's
 * local binding per file from its ImportDeclarations (or its own declaration
 * in writes.ts) rather than grepping a literal name, and locates a call by
 * `fn`+`nth`-call-in-that-function rather than by line number.
 *
 * Inventory B is every raw id-to-path join Sol's repo-wide scan found: a
 * template literal whose last substitution is an identifier ending in "Id"
 * and whose last literal chunk ends in ".md" — the shape a caller-supplied id
 * takes when it reaches a path without going through the helper. Each entry
 * carries a disposition (`guarded`, `derived`, `bypass`, or the one
 * `bypass-via-verify` special case) that this file pins by hand, verified
 * against the source at HEAD — the AST proves the *site*, not the
 * disposition; a disposition is a judgment call, not a derivation, so it is
 * recorded here rather than computed.
 *
 * This file lives on its own (not inside writes.test.ts) because a census
 * that runs during a writes.ts mutation would die to every mutant in that
 * file and make behaviour 2's red unreadable [brief red-team 2].
 *
 * The source set and both pinned lists are also read by
 * scripts/safe-item-path-mutants.mjs's `census` group, which mutates real
 * source files (never this one) and re-runs this file to prove the census
 * both bites (mE, mF) and does not false-drift on a reformat (mG).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const repo = resolve(process.argv[2] ?? ".");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
};

// ---------------------------------------------------------------------------
// Source set: every .ts file under packages/, apps/, adapters/, excluding
// node_modules, dist, *.test.ts and *.d.ts. Sorted by relative path (POSIX
// separators) for a deterministic, platform-independent order — never the
// raw order readdirSync's `recursive` option happens to return, which the
// docs do not promise. "packages/cli" sorts before "packages/commands"
// alphabetically, which is what the brief's own pinned order relies on.
// ---------------------------------------------------------------------------
const SOURCE_ROOTS = ["packages", "apps", "adapters"];

function isExcludedRel(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.includes("node_modules") || parts.includes("dist")) return true;
  if (!rel.endsWith(".ts")) return true;
  if (rel.endsWith(".test.ts") || rel.endsWith(".d.ts")) return true;
  return false;
}

export function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const base of SOURCE_ROOTS) {
    const abs = join(root, base);
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(abs, { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const parentAbs = (e as unknown as { parentPath?: string }).parentPath ?? e.path;
      const abs2 = join(parentAbs, e.name);
      const rel = relative(root, abs2).split(sep).join("/");
      if (isExcludedRel(rel)) continue;
      found.push(rel);
    }
  }
  return found.sort();
}

// ---------------------------------------------------------------------------
// AST helpers shared by both inventories.
// ---------------------------------------------------------------------------

function parse(root: string, rel: string): ts.SourceFile {
  const abs = join(root, rel);
  const text = readFileSync(abs, "utf8");
  return ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
}

/** Nearest enclosing named function, walking `.parent` — a FunctionDeclaration
 *  by its own name, a function/arrow expression by the identifier it's bound
 *  to (`const name = () => …` or `name: () => …`), a method by its name.
 *  "<module>" for top-level code. The scan's answer is authoritative over
 *  the brief's table if the two ever disagree (an arrow-function wrapper,
 *  say) — no line numbers, so this is the only way a call is named at all. */
function enclosingFunctionName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isFunctionExpression(cur) || ts.isArrowFunction(cur)) {
      const p = cur.parent;
      if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
    }
    cur = cur.parent;
  }
  return "<module>";
}

// ---------------------------------------------------------------------------
// Inventory A — every safeItemPath call site.
// ---------------------------------------------------------------------------

/** Local names bound to the helper in one file: direct call names (an
 *  imported/aliased binding, or the name it's declared under in writes.ts
 *  itself) and namespace names (`import * as ns` — checked at the call site
 *  via `ns.safeItemPath`). */
function helperBindings(sf: ts.SourceFile): { direct: Set<string>; namespaces: Set<string> } {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "safeItemPath") direct.add("safeItemPath");
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
      const nb = node.importClause.namedBindings;
      if (ts.isNamedImports(nb)) {
        for (const spec of nb.elements) {
          const imported = (spec.propertyName ?? spec.name).text;
          if (imported === "safeItemPath") direct.add(spec.name.text);
        }
      } else if (ts.isNamespaceImport(nb)) {
        namespaces.add(nb.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { direct, namespaces };
}

/** The string literal last argument of an inner `join(...)` call passed as
 *  the helper's first argument, or "?" — this is inventory A's `dir`
 *  component. */
function callDirLabel(call: ts.CallExpression): string {
  const firstArg = call.arguments[0];
  if (firstArg && ts.isCallExpression(firstArg) && ts.isIdentifier(firstArg.expression) && firstArg.expression.text === "join") {
    const last = firstArg.arguments[firstArg.arguments.length - 1];
    if (last && ts.isStringLiteral(last)) return last.text;
  }
  return "?";
}

function collectInventoryA(root: string, rel: string): string[] {
  const sf = parse(root, rel);
  const { direct, namespaces } = helperBindings(sf);
  const counts = new Map<string, number>();
  const keys: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      let isHelperCall = false;
      if (ts.isIdentifier(node.expression) && direct.has(node.expression.text)) isHelperCall = true;
      else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        namespaces.has(node.expression.expression.text) &&
        node.expression.name.text === "safeItemPath"
      )
        isHelperCall = true;
      if (isHelperCall) {
        const fn = enclosingFunctionName(node);
        const dir = callDirLabel(node);
        const groupKey = `${fn}:${dir}`;
        const n = (counts.get(groupKey) ?? 0) + 1;
        counts.set(groupKey, n);
        keys.push(`${rel}:${fn}:${dir}#${n}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

// ---------------------------------------------------------------------------
// Inventory B — every raw id-to-path join: a TemplateExpression whose last
// literal chunk ends in ".md" and whose last substitution's text ends in
// "Id" — the exact shape of the repo-wide scan the brief's Intent describes.
// ---------------------------------------------------------------------------

function collectInventoryB(root: string, rel: string): string[] {
  const sf = parse(root, rel);
  const counts = new Map<string, number>();
  const keys: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans;
      const lastSpan = spans[spans.length - 1];
      if (lastSpan && lastSpan.literal.text.endsWith(".md")) {
        const exprText = ts.isIdentifier(lastSpan.expression)
          ? lastSpan.expression.text
          : sf.text.slice(lastSpan.expression.getStart(sf), lastSpan.expression.getEnd());
        if (exprText.endsWith("Id")) {
          const fn = enclosingFunctionName(node);
          const n = (counts.get(fn) ?? 0) + 1;
          counts.set(fn, n);
          keys.push(`${rel}:${fn}#${n}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

// ---------------------------------------------------------------------------
// Pinned lists. Order is file-then-source order over the sorted source set.
// ---------------------------------------------------------------------------

const PINNED_A: string[] = [
  "packages/cli/src/retro.ts:classifyAddressedTarget:opera#1",
  "packages/cli/src/retro.ts:classifyAddressedTarget:decisions#1",
  "packages/commands/src/lifecycle.ts:runReady:opera#1",
  "packages/commands/src/lifecycle.ts:runDone:opera#1",
  "packages/commands/src/lifecycle.ts:runReview:opera#1",
  "packages/commands/src/lifecycle.ts:runHalt:opera#1",
  "packages/commands/src/lifecycle.ts:runHalt:decisions#1",
  "packages/commands/src/lifecycle.ts:patronDecisionProblem:decisions#1",
  "packages/commands/src/lifecycle.ts:runWaive:opera#1",
  "packages/commands/src/writes.ts:runHandoff:opera#1",
  "packages/commands/src/writes.ts:runEmit:opera#1",
  "packages/commands/src/writes.ts:runAnswer:petitiones#1",
  "packages/commands/src/writes.ts:runAnswer:opera#1",
  "packages/commands/src/writes.ts:runGreenlight:opera#1",
];

interface PinnedB {
  key: string;
  disposition: string;
}

// NOTE (deviation from studio/briefs/W-047.md, reported per the brief's own
// rule that "the scan's answer is authoritative and the brief's table is the
// thing that was wrong"): the brief's Inventory B row for prune.ts names the
// enclosing function `pruneBranches`. At HEAD the function is
// `pruneStaleOpusBranches` (packages/cli/src/prune.ts:22) — there is no
// `pruneBranches` anywhere in the file. Pinned here as the scan reads it.
const PINNED_B: PinnedB[] = [
  { key: "packages/cli/src/branch.ts:readOpusRecord#1", disposition: "bypass" },
  { key: "packages/cli/src/branch.ts:readOpusRecord#2", disposition: "bypass" },
  { key: "packages/cli/src/branch.ts:readOpusRecord#3", disposition: "bypass" },
  { key: "packages/cli/src/branch.ts:mergeOpusBranch#1", disposition: "bypass" },
  { key: "packages/cli/src/branch.ts:runBranch#1", disposition: "bypass" },
  { key: "packages/cli/src/branch.ts:runMerge#1", disposition: "bypass" },
  { key: "packages/cli/src/close.ts:closeChecks#1", disposition: "bypass" },
  { key: "packages/cli/src/prune.ts:pruneStaleOpusBranches#1", disposition: "derived" },
  { key: "packages/commands/src/lifecycle.ts:runReady#1", disposition: "guarded" },
  { key: "packages/commands/src/lifecycle.ts:runWaive#1", disposition: "guarded" },
  { key: "packages/commands/src/verify.ts:runVerify#1", disposition: "bypass" },
  { key: "packages/commands/src/writes.ts:recordOwnerRefusal#1", disposition: "bypass-via-verify" },
];

// ---------------------------------------------------------------------------
// Run the scan, compare.
// ---------------------------------------------------------------------------

const files = sourceFiles(repo);
check("source set is non-empty", files.length > 0, String(files.length));

const scanA = files.flatMap((rel) => collectInventoryA(repo, rel));
const scanB = files.flatMap((rel) => collectInventoryB(repo, rel));

const REMEDY = "a containment call site changed — see studio/briefs/W-047.md; a new call site needs a traversal case, a new bypass needs a decision";

function diffLists(scanned: string[], pinned: string[]): { added: string[]; removed: string[] } {
  const scannedSet = new Set(scanned);
  const pinnedSet = new Set(pinned);
  return {
    added: scanned.filter((k) => !pinnedSet.has(k)),
    removed: pinned.filter((k) => !scannedSet.has(k)),
  };
}

// Inventory A -----------------------------------------------------------
check("inventory A: pinned list length matches the scan's own count", PINNED_A.length === scanA.length, `pinned=${PINNED_A.length} scan=${scanA.length}`);
{
  const { added, removed } = diffLists(scanA, PINNED_A);
  check(
    "inventory A: every safeItemPath call site is pinned, none missing",
    added.length === 0 && removed.length === 0,
    added.length || removed.length ? `${REMEDY} — added: ${JSON.stringify(added)} removed: ${JSON.stringify(removed)}` : "",
  );
  check("inventory A: scan order matches the pinned order exactly", JSON.stringify(scanA) === JSON.stringify(PINNED_A), JSON.stringify({ scanA, PINNED_A }));
}

// Inventory B -----------------------------------------------------------
const pinnedBKeys = PINNED_B.map((p) => p.key);
check("inventory B: pinned list length matches the scan's own count", PINNED_B.length === scanB.length, `pinned=${PINNED_B.length} scan=${scanB.length}`);
{
  const { added, removed } = diffLists(scanB, pinnedBKeys);
  check(
    "inventory B: every raw id-to-path join is pinned, none missing",
    added.length === 0 && removed.length === 0,
    added.length || removed.length ? `${REMEDY} — added: ${JSON.stringify(added)} removed: ${JSON.stringify(removed)}` : "",
  );
  check("inventory B: scan order matches the pinned order exactly", JSON.stringify(scanB) === JSON.stringify(pinnedBKeys), JSON.stringify({ scanB, pinnedBKeys }));
}
const knownDispositions = new Set(["guarded", "derived", "bypass", "bypass-via-verify"]);
check("inventory B: every pinned disposition is a recognized value", PINNED_B.every((p) => knownDispositions.has(p.disposition)), JSON.stringify(PINNED_B.map((p) => p.disposition)));

process.exit(failed ? 1 : 0);
