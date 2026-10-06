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
 * Inventory B is every raw id-to-path join: any `TemplateExpression` whose
 * last literal chunk ends in ".md", anywhere in the source set — no filter
 * on how the interpolated expression is spelled [censor round 1, F-1: an
 * earlier draft filtered on the substitution ending in "Id", which dropped
 * 17 of 29 real matches and made the class of miss invisible]. Each entry
 * carries a disposition (`guarded`, `derived`, `bypass`, `helper`, or the one
 * `bypass-via-verify` special case) and a one-line why, both pinned by hand,
 * verified against the source at HEAD — the AST proves the *site*, not the
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
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
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
// Inventory B — every raw id-to-path join: any TemplateExpression whose last
// literal chunk ends in ".md", anywhere in the source set. No filter on how
// the interpolated expression is spelled is permitted [censor round 1,
// F-1] — scan wide, then adjudicate each entry's disposition in the pin.
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
        const fn = enclosingFunctionName(node);
        const n = (counts.get(fn) ?? 0) + 1;
        counts.set(fn, n);
        keys.push(`${rel}:${fn}#${n}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return keys;
}

// ---------------------------------------------------------------------------
// W-163 — inventories C (a raw date parse) and D (a raw file access).
//
// Source set for both: non-test .ts/.tsx under packages/, apps/ and adapters/,
// plus scripts/*.mjs. Inventory C is typed: one ts.createProgram over the set
// lets the checker say whether a `new Date(x)` argument is a number or a Date
// (not a site) or anything else (a site). Keys are `rel:fn:what#n`, never a
// line number, so a reformat moves nothing.
// ---------------------------------------------------------------------------
const CD_BASES = ["packages", "apps", "adapters"];

function isExcludedCD(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.includes("node_modules") || parts.includes("dist") || parts.includes("test") || parts.includes("tests-serve")) return true;
  if (!/\.(ts|tsx)$/.test(rel) || rel.endsWith(".d.ts") || /\.(test|spec)\.tsx?$/.test(rel)) return true;
  return false;
}

export function sourceFilesCD(root: string): string[] {
  const found: string[] = [];
  for (const base of CD_BASES) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(join(root, base), { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const parentAbs = (e as unknown as { parentPath?: string }).parentPath ?? e.path;
      const rel = relative(root, join(parentAbs, e.name)).split(sep).join("/");
      if (!isExcludedCD(rel)) found.push(rel);
    }
  }
  try {
    for (const name of readdirSync(join(root, "scripts"))) if (name.endsWith(".mjs") && !/\.test\.mjs$/.test(name)) found.push(`scripts/${name}`);
  } catch {
    // no scripts/ directory
  }
  return found.sort();
}

const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const MODULE_MODULES = new Set(["module", "node:module"]);
const RAW_FS = new Set([
  "readFileSync", "readFile", "openSync", "open", "createReadStream",
  "writeFileSync", "writeFile", "appendFileSync", "appendFile", "createWriteStream",
  "mkdirSync", "mkdir", "rmSync", "rm", "rmdirSync", "unlinkSync", "unlink",
  "renameSync", "rename", "copyFileSync", "copyFile", "cpSync", "symlinkSync", "truncateSync",
]);

interface Site {
  key: string;
  rel: string;
  fn: string;
}

interface CDScan {
  c: Site[];
  d: Site[];
  /** `rel:fn` of every function that calls a containment helper. */
  helperCallers: Set<string>;
  /** Anything that binds `fs` outside the static imports the scan understands. */
  outOfDomain: string[];
}

const CONTAINMENT_HELPERS = new Set(["requireRealDirectory", "ensureRealDirectory", "readContainedRegularFile", "createNextRecord"]);

// What a name can be bound to: the fs module, `Date`, the global object (whose `.Date` is `Date`), or node:module.
type Kind = "fs" | "date" | "global" | "mod";
const KIND_LABEL: Record<Kind, string> = { fs: "the fs module", date: "Date", global: "the global object", mod: "node:module" };
/** The kind of `<kind>.<name>` when it is itself a namespace (fs.promises, fs.default, globalThis.Date); else undefined. */
const memberKind = (kind: Kind, name: string): Kind | undefined =>
  kind === "fs" && (name === "promises" || name === "default") ? "fs" : kind === "global" && name === "Date" ? "date" : undefined;
const WRAPPERS = (n: ts.Node): n is ts.ParenthesizedExpression | ts.AsExpression | ts.NonNullExpression | ts.SatisfiesExpression | ts.TypeAssertion =>
  ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n);
const unwrap = (n: ts.Node): ts.Node => (WRAPPERS(n) ? unwrap(n.expression) : n);
/** The member a property or element access names: its name, a string literal key, or undefined for any other key. */
const memberOf = (n: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined =>
  ts.isPropertyAccessExpression(n) ? n.name.text : ts.isStringLiteralLike(n.argumentExpression) ? n.argumentExpression.text : undefined;
/** An identifier that declares or names something (a binding, a property key, a member) rather than reading a binding. */
function isNamePosition(id: ts.Identifier): boolean {
  const p = id.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node };
  if (ts.isShorthandPropertyAssignment(p) || ts.isExportSpecifier(p)) return false; // `{ x }` and `export { x }` read x
  return p.name === id || p.propertyName === id || (ts.isQualifiedName(p) && p.right === id);
}

function scanCD(root: string, rels: string[]): CDScan {
  const options: ts.CompilerOptions = {
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    types: ["node"],
    typeRoots: [join(root, "node_modules/@types")],
  };
  const program = ts.createProgram(rels.map((r) => join(root, r)), options);
  const checker = program.getTypeChecker();
  const out: CDScan = { c: [], d: [], helperCallers: new Set(), outOfDomain: [] };
  for (const rel of rels) {
    const sf = program.getSourceFile(join(root, rel));
    if (!sf) {
      out.outOfDomain.push(`${rel}: not in the program`);
      continue;
    }
    // parseDiagnostics is internal API but is the one honest "does it parse" answer.
    const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diags.length) out.outOfDomain.push(`${rel}: parse error`);

    // The census follows one form: a direct call. `ns` holds the names that are a whole namespace (an fs import, `Date`,
    // the global object, node:module); `named` holds fs functions imported on their own. Any other use of an fs function,
    // an fs namespace, Date.parse or the Date constructor (aliased, destructured, stored, passed, returned, exported) is an
    // out-of-domain finding, so no alias is ever tracked: it fails by rule. Names are matched without scope, so a shadowing
    // name is a false alarm, never a miss.
    const ns = new Map<string, Kind>([["Date", "date"], ["globalThis", "global"], ["global", "global"], ["window", "global"], ["self", "global"]]);
    const named = new Map<string, string>();
    const kindOf = (e: ts.Node): Kind | undefined => {
      const x = unwrap(e);
      if (ts.isIdentifier(x)) return ns.get(x.text);
      if (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
        const base = kindOf(x.expression);
        const name = memberOf(x);
        return base !== undefined && name !== undefined ? memberKind(base, name) : undefined;
      }
      return undefined;
    };
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const m = st.moduleSpecifier.text;
        const kind: Kind | undefined = FS_MODULES.has(m) ? "fs" : MODULE_MODULES.has(m) ? "mod" : undefined;
        const c = st.importClause;
        if (kind === undefined || !c) continue;
        if (c.name) ns.set(c.name.text, kind);
        const nb = c.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) ns.set(nb.name.text, kind);
        if (nb && ts.isNamedImports(nb))
          for (const el of nb.elements) {
            const imported = (el.propertyName ?? el.name).text;
            const inner = imported === "default" ? kind : memberKind(kind, imported);
            if (inner !== undefined) ns.set(el.name.text, inner);
            else if (kind === "fs") named.set(el.name.text, imported);
          }
      }
      if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && (FS_MODULES.has(st.moduleSpecifier.text) || MODULE_MODULES.has(st.moduleSpecifier.text)))
        out.outOfDomain.push(`${rel}: export from ${st.moduleSpecifier.text}`);
      if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference) && ts.isStringLiteral(st.moduleReference.expression) && (FS_MODULES.has(st.moduleReference.expression.text) || MODULE_MODULES.has(st.moduleReference.expression.text)))
        out.outOfDomain.push(`${rel}: import = require(${st.moduleReference.expression.text})`);
    }

    /** The expression around `e` once parentheses and casts are peeled off. */
    const outer = (e: ts.Node): ts.Node => {
      let top = e;
      while (top.parent && WRAPPERS(top.parent) && top.parent.expression === top) top = top.parent;
      return top;
    };
    /** A namespace may only be the base of a member access (and, for Date, a constructor, a call, `instanceof` or `typeof`). */
    const nsUseSeen = (e: ts.Node, kind: Kind): boolean => {
      const top = outer(e);
      const p = top.parent;
      if (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) return p.expression === top;
      if (ts.isTypeOfExpression(p) || ts.isQualifiedName(p) || ts.isTypeNode(p)) return true;
      if (kind === "date" && (ts.isNewExpression(p) || ts.isCallExpression(p))) return p.expression === top;
      return kind === "date" && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && p.right === top;
    };

    const escapes = new Set<string>();
    const counts = new Map<string, number>();
    const nth = (k: string): number => {
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    };
    const site = (list: Site[], tag: "C" | "D", n: ts.Node, what: string): void => {
      const fn = enclosingFunctionName(n);
      list.push({ key: `${rel}:${fn}:${what}#${nth(`${tag}:${fn}:${what}`)}`, rel, fn });
    };
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) {
        // the only ways to reach fs that no import shows: a require function or the builtin loader
        if (n.text === "createRequire" || n.text === "getBuiltinModule") out.outOfDomain.push(`${rel}: ${n.text}`);
      }
      // a reference: an fs function or Date.parse (followed only as the callee of a direct call), or a whole namespace
      if ((ts.isIdentifier(n) && !isNamePosition(n)) || ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        let fnRef: { list: Site[]; tag: "C" | "D"; what: string } | undefined;
        if (ts.isIdentifier(n)) {
          const one = named.get(n.text);
          if (one !== undefined && RAW_FS.has(one)) fnRef = { list: out.d, tag: "D", what: one };
        } else {
          const base = kindOf(n.expression);
          const name = memberOf(n);
          if (base === "fs" && (name === undefined || RAW_FS.has(name))) fnRef = { list: out.d, tag: "D", what: name ?? "<computed>" };
          if (base === "date" && (name === undefined || name === "parse")) fnRef = { list: out.c, tag: "C", what: name === undefined ? "Date.<computed>" : "Date.parse" };
          // the Date member allowlist: parse (a C site), UTC and now, each only as a direct call; any other member fails closed
          if (base === "date" && name !== undefined && name !== "parse") {
            const top = outer(n);
            const called = ts.isCallExpression(top.parent) && top.parent.expression === top;
            const typePos = ts.isTypeNode(top.parent) || ts.isQualifiedName(top.parent);
            if (!typePos && !((name === "UTC" || name === "now") && called)) escapes.add(`${rel}:${enclosingFunctionName(n)}: Date.${name} is off the Date member allowlist (parse, UTC and now, called)`);
          }
          if (base === "mod" && name === undefined) escapes.add(`${rel}:${enclosingFunctionName(n)}: a computed member of node:module is used where the scan cannot follow it`);
        }
        const top = outer(n);
        const type = ts.isTypeNode(top.parent) || ts.isQualifiedName(top.parent);
        if (fnRef !== undefined && !type) {
          if (ts.isCallExpression(top.parent) && top.parent.expression === top) site(fnRef.list, fnRef.tag, n, fnRef.what);
          else escapes.add(`${rel}:${enclosingFunctionName(n)}: ${fnRef.what} is used other than as a direct call`);
        }
        const k = kindOf(n);
        if (k !== undefined && !nsUseSeen(n, k)) escapes.add(`${rel}:${enclosingFunctionName(n)}: ${KIND_LABEL[k]} is used where the scan cannot follow it`);
      }
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const arg0 = n.arguments[0];
        const literal = arg0 !== undefined && ts.isStringLiteralLike(arg0);
        if (ts.isIdentifier(callee) && callee.text === "require" && (!literal || FS_MODULES.has(arg0.text))) out.outOfDomain.push(`${rel}: require(${literal ? arg0.text : "…"})`);
        if (callee.kind === ts.SyntaxKind.ImportKeyword && (!literal || FS_MODULES.has(arg0.text))) out.outOfDomain.push(`${rel}: import(${literal ? arg0.text : "…"})`);
        // helper callers
        const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (CONTAINMENT_HELPERS.has(calleeName)) out.helperCallers.add(`${rel}:${enclosingFunctionName(n)}`);
      }
      if (ts.isNewExpression(n) && kindOf(n.expression) === "date" && n.arguments?.length === 1) {
        const a = n.arguments[0]!;
        const literal = ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a);
        const ty = checker.getTypeAtLocation(a);
        const safe = !!(ty.flags & ts.TypeFlags.NumberLike) || checker.typeToString(ty) === "Date";
        if (!literal && !safe) site(out.c, "C", n, "new Date");
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    out.outOfDomain.push(...escapes);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pinned lists. Order is file-then-source order over the sorted source set.
// ---------------------------------------------------------------------------

const PINNED_A: string[] = [
  "packages/cli/src/next.ts:runNext:opera#1",
  "packages/cli/src/retro.ts:classifyAddressedTarget:opera#1",
  "packages/cli/src/retro.ts:classifyAddressedTarget:decisions#1",
  "packages/cli/src/retro.ts:readOpus:opera#1",
  "packages/cli/src/retro.ts:draftOpusRetro:acta#1",
  "packages/cli/src/retro.ts:draftOpusRetro:opera#1",
  "packages/commands/src/lifecycle.ts:runReady:opera#1",
  "packages/commands/src/lifecycle.ts:runDone:opera#1",
  "packages/commands/src/lifecycle.ts:runReview:opera#1",
  "packages/commands/src/lifecycle.ts:runHalt:opera#1",
  "packages/commands/src/lifecycle.ts:runHalt:decisions#1",
  "packages/commands/src/lifecycle.ts:patronDecisionProblem:decisions#1",
  "packages/commands/src/lifecycle.ts:runWaive:opera#1",
  "packages/commands/src/lifecycle.ts:runAmend:opera#1",
  "packages/commands/src/verdict.ts:runVerdict:opera#1",
  "packages/commands/src/verify.ts:runVerify:opera#1",
  "packages/commands/src/writes.ts:runHandoff:opera#1",
  "packages/commands/src/writes.ts:runEmit:opera#1",
  "packages/commands/src/writes.ts:runAnswer:petitiones#1",
  "packages/commands/src/writes.ts:runAnswer:opera#1",
  "packages/commands/src/writes.ts:runGreenlight:opera#1",
];

interface PinnedB {
  key: string;
  disposition: string;
  why: string;
}

// Re-derived with this file's own AST rule (no spelling filter) at HEAD,
// 2026-09-24, and confirmed entry-for-entry against studio/briefs/W-047.md's
// signed 29-entry table before pinning [censor round 1, F-1; brief amendment
// 2]: same 29 keys, same order, no disagreement to report. The twelve
// entries pinned in round 1 (including pruneStaleOpusBranches, corrected
// from the brief's original `pruneBranches`) keep their keys and #nth
// unchanged. A 30th entry (apps/web/tests-serve/answer.spec.ts) was added by
// W-067: the census is source-wide by construction (no test-file exclusion
// for inventory B, unlike inventory A's non-test filter), so a new spec that
// joins an id onto a ".md" path surfaces here too — dispositioned "bypass"
// above rather than silently exempted.
const PINNED_B: PinnedB[] = [
  { key: "apps/server/src/store.ts:opus#1", disposition: "guarded", why: "safeId(id) refuses before the raw join" },
  {
    key: "apps/web/tests-serve/answer.spec.ts:<module>#1",
    disposition: "bypass",
    why: "W-067 acceptance smoke, test-only: target.id is read back from the served instance's own /api/inbox response and joined against a mkdtemp scratch studio this same test creates and deletes — a traversal here reaches nothing but the test's own throwaway temp dir, never studio/ or examples/sample-studio itself",
  },
  {
    key: "apps/web/tests-serve/board.spec.ts:setOpusState#1",
    disposition: "bypass",
    why: "W-064 mounted fixtures, test-only: id is always a literal opus id this same test file writes ('W-002'/'W-005'/'W-007'), joined against a mkdtemp scratch studio startRestartable/startServed creates and deletes — same shape as answer.spec.ts's own bypass above, never studio/ or examples/sample-studio itself",
  },
  {
    key: "apps/web/tests-serve/board.spec.ts:setOpusTitle#1",
    disposition: "bypass",
    why: "same function family as setOpusState#1 above — a literal id, a throwaway temp studio",
  },
  {
    key: "apps/web/tests-serve/board.spec.ts:setOpusBody#1",
    disposition: "bypass",
    why: "same function family as setOpusState#1 above — a literal id, a throwaway temp studio",
  },
  {
    key: "apps/web/tests-serve/board.spec.ts:setTraditioNext#1",
    disposition: "bypass",
    why: "same function family as setOpusState#1 above — a literal id, a throwaway temp studio",
  },
  {
    key: "apps/web/tests-serve/walk.spec.ts:<module>#1",
    disposition: "bypass",
    why: "W-110 behaviour 3 seeding, test-only: the period id is read back from the served instance's own /api/health `due` answer and joined against the mkdtemp scratch studio this same test creates and deletes — same shape as answer.spec.ts's own bypass above, never studio/ or examples/sample-studio itself",
  },
  { key: "packages/cli/src/branch.ts:readOpusRecord#1", disposition: "bypass", why: "positional <opus-id>, into a git pathspec" },
  { key: "packages/cli/src/branch.ts:readOpusRecord#2", disposition: "bypass", why: "same value, same pathspec, error path" },
  { key: "packages/cli/src/branch.ts:readOpusRecord#3", disposition: "bypass", why: "same value, filesystem read fallback" },
  { key: "packages/cli/src/branch.ts:mergeOpusBranch#1", disposition: "bypass", why: "positional <opus-id>, read + named in an error" },
  { key: "packages/cli/src/branch.ts:runBranch#1", disposition: "bypass", why: "positional <opus-id>, existence gate before branching" },
  { key: "packages/cli/src/branch.ts:runMerge#1", disposition: "bypass", why: "positional <opus-id>, existence gate before merging" },
  { key: "packages/cli/src/close.ts:closeChecks#1", disposition: "bypass", why: "positional <opus-id> from runClose (:68-74)" },
  {
    key: "packages/cli/src/init.ts:initStudio#1",
    disposition: "derived",
    why: "isoDateInZone(now, timezone) — Intl output, digits and hyphens; an invalid zone throws, it does not escape",
  },
  { key: "packages/cli/src/new.ts:runNew#1", disposition: "derived", why: "W-### from createNextRecord, front-matter spec: value" },
  { key: "packages/cli/src/new.ts:runNew#2", disposition: "derived", why: "same allocated id, briefs/ companion write" },
  {
    key: "packages/cli/src/next.ts:recordRel#1",
    disposition: "guarded",
    why: "W-124: opus matches ID_RE and passes safeItemPath in runNext before any call; the value only reaches a git pathspec (`git show <ref>:<studio>/opera/<id>.md`) or readContainedRegularFile, never a write",
  },
  {
    key: "packages/cli/src/next.ts:briefRel#1",
    disposition: "guarded",
    why: "W-124: same guarded opus as recordRel#1; read-only (git pathspec or readContainedRegularFile), never a write",
  },
  { key: "packages/cli/src/prune.ts:pruneStaleOpusBranches#1", disposition: "derived", why: 'id is branch.replace(/^opus\\//, ""); git refuses ".." in a ref name' },
  {
    key: "packages/cli/src/prune.ts:pruneCiLogs#1",
    disposition: "guarded",
    why: "W-131: the opus id is captured by /^([A-Za-z]+-\\d+)-…/ from a ci/ directory entry and goes only to readContainedRegularFile, which refuses symlinks and escapes before the state read; the deleted ci/<name> is checked by the same helper before unlinkSync",
  },
  { key: "packages/cli/src/retro.ts:draftRetro#1", disposition: "derived", why: "L-### from createNextRecord" },
  { key: "packages/cli/src/retro.ts:draftRetro#2", disposition: "derived", why: "P-### from createNextRecord" },
  {
    key: "packages/cli/src/retro.ts:draftRetro#3",
    disposition: "derived",
    why: "--cascade passes Number() + Number.isFinite in runRetro (:565-567); a finite number carries no separator",
  },
  {
    key: "packages/cli/src/tick.ts:writeDailyActum#1",
    disposition: "bypass",
    why: "sella id read from bisellium.yml, unguarded at the join, and it writes acta/<date>-<sella>-daily.md. Mitigation, not a guard: path.id.unvalidated blocks a non-id sella at check time. Newly surfaced — see Intent",
  },
  {
    key: "packages/commands/src/builder-run.ts:attachReceipt#1",
    disposition: "guarded",
    why: "runCommand passes opus through seatInstance's ID_RE-equivalent guard before runBuilderCommand can attach the receipt",
  },
  {
    key: "packages/commands/src/builder-run.ts:runBuilderCommand#1",
    disposition: "guarded",
    why: "runCommand passes request.opus through seatInstance's ID_RE-equivalent guard before the only call to runBuilderCommand",
  },
  {
    key: "packages/commands/src/builder-run.ts:admitCurrentRunReceipt#1",
    disposition: "guarded",
    why: "runReview passes opus through safeItemPath and readContainedRegularFile before calling receipt admission",
  },
  {
    key: "packages/commands/src/builder-run.ts:admitCurrentRunReceipt#2",
    disposition: "guarded",
    why: "same caller guard as #1: runReview passes opus through safeItemPath before admission, and the briefs/ join is read-only (a missing or unreadable brief refuses admission)",
  },
  {
    key: "packages/commands/src/context.ts:buildContextFor#1",
    disposition: "derived",
    why: "a display label inside the context bundle; never reaches the filesystem",
  },
  { key: "packages/commands/src/ids.ts:createNextRecord#1", disposition: "derived", why: "W/P/L-### from the shared ref-aware allocator" },
  {
    key: "packages/commands/src/lifecycle.ts:unsafeOpusProblem#1",
    disposition: "guarded",
    why: "opusId first passed safeItemPath at every caller, then readContainedRegularFile rejects non-regular and symlinked opera paths",
  },
  { key: "packages/commands/src/lifecycle.ts:runReady#1", disposition: "guarded", why: "opusId passed safeItemPath and the resulting brief passes readContainedRegularFile" },
  {
    key: "packages/commands/src/lifecycle.ts:runHalt#1",
    disposition: "guarded",
    why: "decisionId passes safeItemPath and readContainedRegularFile before the decision is read",
  },
  {
    key: "packages/commands/src/lifecycle.ts:patronDecisionProblem#1",
    disposition: "guarded",
    why: "decisionId passes safeItemPath and readContainedRegularFile before the decision is read",
  },
  { key: "packages/commands/src/lifecycle.ts:runWaive#1", disposition: "guarded", why: "decisionId passed patronDecisionProblem -> safeItemPath and readContainedRegularFile" },
  {
    key: "packages/commands/src/opus-model.ts:ruling#1",
    disposition: "guarded",
    why: "decisionId matches ^D-[0-9]{3,}$ then passes readContainedRegularFile under decisions/",
  },
  { key: "packages/commands/src/talk.ts:writeActum#1", disposition: "derived", why: "slugify strips to [a-z0-9-], capped at 40" },
  { key: "packages/commands/src/talk.ts:writeActum#2", disposition: "derived", why: "same slug plus a numeric suffix" },
  {
    key: "packages/commands/src/verdict.ts:runVerdict#1",
    disposition: "guarded",
    why: "opusId passes safeItemPath and readContainedRegularFile before the record is read",
  },
  {
    key: "packages/commands/src/verify.ts:runVerify#1",
    disposition: "guarded",
    why: "opusId passes safeItemPath and readContainedRegularFile before the record is read",
  },
  { key: "packages/commands/src/writes.ts:safeItemPath#1", disposition: "helper", why: "the containment helper's own join — the one join that is allowed to be raw" },
  {
    key: "packages/commands/src/writes.ts:recordOwnerRefusal#1",
    disposition: "bypass-via-verify",
    why: "guarded at its lifecycle.ts callers, raw when verify.ts calls it",
  },
  {
    key: "packages/commands/src/writes.ts:runAnswer#1",
    disposition: "guarded",
    why: "W-163: petitioId passes safeItemPath, and the petitio is read through readContainedRegularFile, which refuses a symlink and an escape; the bytes are what the rollback restores",
  },
  { key: "packages/commands/src/writes.ts:runAnswer#2", disposition: "derived", why: "--charter-gap acta path; slugify as above" },
  { key: "packages/commands/src/writes.ts:runAnswer#3", disposition: "derived", why: "same slug plus a numeric suffix" },
  {
    key: "packages/commands/src/writes.ts:runGreenlight#1",
    disposition: "guarded",
    why: "W-163: opusId passes safeItemPath, and the opus is read through readContainedRegularFile; the bytes are what the rollback restores",
  },
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
const knownDispositions = new Set(["guarded", "derived", "bypass", "helper", "bypass-via-verify"]);
check("inventory B: every pinned disposition is a recognized value", PINNED_B.every((p) => knownDispositions.has(p.disposition)), JSON.stringify(PINNED_B.map((p) => p.disposition)));

// ---------------------------------------------------------------------------
// W-163 — inventories C and D: pinned lists and checks (behaviour 6).
// ---------------------------------------------------------------------------

type Disposition = "helper" | "contained" | "guarded" | "outside" | "listed";
interface PinnedSite {
  key: string;
  disposition: Disposition;
  why: string;
}

/** The approved helpers' own bodies: a `helper` pin is valid only for one of these (file + function). */
const APPROVED_HELPERS = new Set([
  "packages/schema/src/index.ts:instant",
  "packages/commands/src/opus-model.ts:instant",
  "packages/commands/src/opus-model.ts:readContainedRegularFile",
  "packages/commands/src/ids.ts:createNextRecord",
  "packages/commands/src/ids.ts:ensureRealDirectory",
]);

// Inventory C — every raw date parse. After W-163 four remain: the strict
// UTC profile's own ordering parse, and the browser bundle's three reads of
// times the server already sent it.
const PINNED_C: PinnedSite[] = [
  {
    key: "apps/web/src/lib/board.ts:formatBoardTimestamp:new Date#1",
    disposition: "listed",
    why: "browser bundle: formats a timestamp the server already sent; it shares no code with the server, so it cannot import the schema parser. Follow-on: none (default 5)",
  },
  {
    key: "apps/web/src/lib/board.ts:liveLabel:new Date#1",
    disposition: "listed",
    why: "browser bundle: same as formatBoardTimestamp#1 — a server-sent time, no shared code (default 5)",
  },
  {
    key: "apps/web/src/lib/officinaTruth.ts:healthStamp:Date.parse#1",
    disposition: "listed",
    why: "browser bundle: a health stamp the server already sent, read for display only (default 5)",
  },
  {
    key: "packages/commands/src/opus-model.ts:instant:Date.parse#1",
    disposition: "helper",
    why: "the exact-UTC profile's ordering instant: it runs only after utcTimestampProblem has accepted the string",
  },
];

const PINNED_D: PinnedSite[] = [
  { key: "adapters/native/src/index.ts:readFront:readFileSync#1", disposition: "listed", why: "reads a record by an absolute path the caller built; follow-on: read through readContainedRegularFile (the snapshot reader, Seams S1/S2)" },
  { key: "adapters/native/src/index.ts:readManifest:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml); follow-on: read through readContainedRegularFile (the snapshot reader, Seams S1/S2)" },
  { key: "adapters/native/src/index.ts:readMilestones:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (milestones.yml); follow-on: read through readContainedRegularFile (the snapshot reader, Seams S1/S2)" },
  { key: "adapters/native/src/index.ts:snapshotDir:readFileSync#1", disposition: "listed", why: "reads each record found by a directory listing; follow-on: read through readContainedRegularFile (the snapshot reader, Seams S1/S2)" },
  { key: "adapters/native/src/index.ts:readUsageProviders:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (usage.yml); follow-on: read through readContainedRegularFile (the snapshot reader, Seams S1/S2)" },
  { key: "apps/server/src/branchRecords.ts:readBoundedRegular:open#1", disposition: "listed", why: "the server's own bounded reader: lstat, then open with O_NOFOLLOW, size-capped; follow-on: read through readContainedRegularFile or the server's bounded reader" },
  { key: "apps/server/src/http.ts:sendFile:readFileSync#1", disposition: "outside", why: "serves the built web assets from the package's own dist; never an officina file" },
  { key: "apps/server/src/store.ts:readOpusBody:openSync#1", disposition: "listed", why: "opens the opus record with O_NOFOLLOW; follow-on: read through readContainedRegularFile or the server's bounded reader" },
  { key: "apps/server/src/store.ts:readPausedAt:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (PAUSED); follow-on: read through readContainedRegularFile or the server's bounded reader" },
  { key: "apps/server/src/store.ts:readModelsRecord:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (models.json); follow-on: read through readContainedRegularFile or the server's bounded reader" },
  { key: "apps/server/src/store.ts:health:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (health.json); follow-on: read through readContainedRegularFile or the server's bounded reader" },
  { key: "apps/server/src/store.ts:timeline:readFileSync#1", disposition: "listed", why: "reads timeline/patron.jsonl, a fixed name under timeline/; follow-on: read through readContainedRegularFile or the server's bounded reader" },
  { key: "apps/server/src/store.ts:receipts:readFileSync#1", disposition: "listed", why: "reads receipts found by a directory listing; follow-on: read through readContainedRegularFile or the server's bounded reader" },
  { key: "packages/cli/src/branch.ts:rebaseOntoTrunk:rmSync#1", disposition: "outside", why: "removes a scratch directory it made under OS temp for the rebase" },
  { key: "packages/cli/src/branch.ts:rebaseOntoTrunk:rmSync#2", disposition: "outside", why: "removes a scratch directory it made under OS temp for the rebase" },
  { key: "packages/cli/src/check.ts:safeYaml:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml, usage.yml); every listed name (aerarium/) goes through readContainedRegularFile instead" },
  { key: "packages/cli/src/docs.ts:collectDocFiles:readFileSync#1", disposition: "outside", why: "reads the repo's docs/ files, not an officina" },
  { key: "packages/cli/src/docs.ts:runDocs:mkdirSync#1", disposition: "outside", why: "writes docs/registry.json in the repo (--repo), not an officina" },
  { key: "packages/cli/src/docs.ts:runDocs:writeFileSync#1", disposition: "outside", why: "writes docs/registry.json in the repo (--repo), not an officina" },
  { key: "packages/cli/src/hooks.ts:countLogLines:readFileSync#1", disposition: "outside", why: "reads .bisellium/events.jsonl, the runtime event log beside the officina" },
  { key: "packages/cli/src/hooks.ts:handleCompact:appendFileSync#1", disposition: "contained", why: "timeline/<sella>.jsonl in a real timeline/ checked by ensureRealDirectory before the append" },
  { key: "packages/cli/src/init.ts:initStudio:mkdirSync#1", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/init.ts:initStudio:mkdirSync#2", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/init.ts:initStudio:writeFileSync#1", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/init.ts:initStudio:writeFileSync#2", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/init.ts:initStudio:writeFileSync#3", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/init.ts:initStudio:writeFileSync#4", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/init.ts:initStudio:writeFileSync#5", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/init.ts:initStudio:writeFileSync#6", disposition: "listed", why: "init creates the officina tree from nothing and writes only fixed names; follow-on: refuse a symlinked root component before the first write" },
  { key: "packages/cli/src/instructions.ts:readManifestLoosely:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml); no id or flag builds the path" },
  { key: "packages/cli/src/instructions.ts:renderInstructions:readFileSync#1", disposition: "outside", why: "reads the instructions template shipped in the package" },
  { key: "packages/cli/src/instructions.ts:runInstructions:writeFileSync#1", disposition: "outside", why: "writes CLAUDE.md, AGENTS.md and GLOSSARY.md at the repo root (--repo), not an officina" },
  { key: "packages/cli/src/instructions.ts:runInstructions:writeFileSync#2", disposition: "outside", why: "writes CLAUDE.md, AGENTS.md and GLOSSARY.md at the repo root (--repo), not an officina" },
  { key: "packages/cli/src/instructions.ts:runInstructions:writeFileSync#3", disposition: "outside", why: "writes CLAUDE.md, AGENTS.md and GLOSSARY.md at the repo root (--repo), not an officina" },
  { key: "packages/cli/src/new.ts:waitAtIdsTestBarrier:writeFileSync#1", disposition: "outside", why: "test barrier file in a directory named by a test-only environment variable" },
  { key: "packages/cli/src/new.ts:newItem:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml)" },
  { key: "packages/cli/src/new.ts:runNew:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml)" },
  { key: "packages/cli/src/new.ts:runNew:writeFileSync#1", disposition: "contained", why: "briefs/<id>.md in a real briefs/ checked by ensureRealDirectory; the id comes from createNextRecord" },
  { key: "packages/cli/src/new.ts:runNew:unlinkSync#1", disposition: "contained", why: "removes the opus record createNextRecord just made in the same call" },
  { key: "packages/cli/src/next.ts:readMarker:readFileSync#1", disposition: "outside", why: "reads the step marker under .bisellium/ (lstat first)" },
  { key: "packages/cli/src/next.ts:readProc:readFileSync#1", disposition: "outside", why: "reads /proc/<pid>/stat" },
  { key: "packages/cli/src/next.ts:readOutput:openSync#1", disposition: "outside", why: "reads the step output file under .bisellium/, opened with O_NOFOLLOW after an lstat of every parent" },
  { key: "packages/cli/src/next.ts:installMarker:mkdirSync#1", disposition: "outside", why: "writes the step marker under .bisellium/, exclusive create" },
  { key: "packages/cli/src/next.ts:installMarker:unlinkSync#1", disposition: "outside", why: "writes the step marker under .bisellium/, exclusive create" },
  { key: "packages/cli/src/next.ts:installMarker:writeFileSync#1", disposition: "outside", why: "writes the step marker under .bisellium/, exclusive create" },
  { key: "packages/cli/src/next.ts:runNext:readFileSync#1", disposition: "outside", why: "reads, appends to and removes the step marker and its output under .bisellium/" },
  { key: "packages/cli/src/next.ts:log:appendFileSync#1", disposition: "outside", why: "appends to the step output file under .bisellium/" },
  { key: "packages/cli/src/next.ts:runNext:readFileSync#2", disposition: "outside", why: "reads, appends to and removes the step marker and its output under .bisellium/" },
  { key: "packages/cli/src/next.ts:runNext:unlinkSync#1", disposition: "outside", why: "reads, appends to and removes the step marker and its output under .bisellium/" },
  { key: "packages/cli/src/prune.ts:pruneCiLogs:unlinkSync#1", disposition: "contained", why: "the log was just read through readContainedRegularFile, which refuses a symlink and an escape; its absolute path is what is unlinked" },
  { key: "packages/cli/src/retro.ts:draftRetro:writeFileSync#1", disposition: "contained", why: "acta/<date>-retro-<n>.md in a real acta/ checked by ensureRealDirectory before the write" },
  { key: "packages/cli/src/retro.ts:readRetroSetting:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml)" },
  { key: "packages/cli/src/retro.ts:claim:openSync#1", disposition: "contained", why: "a write-capable probe open of opera/<fix>.md or .bisellium/events.jsonl, after requireRealDirectory on its parent; O_NOFOLLOW refuses a symlinked last component, and the bytes go through editOpusFrontMatter and emitEvent" },
  { key: "packages/cli/src/retro.ts:draftOpusRetro:writeFileSync#1", disposition: "contained", why: "acta/<date>-retro-<id>.md in a real acta/ checked by ensureRealDirectory, exclusive create" },
  { key: "packages/cli/src/retro.ts:runRetro:readFileSync#1", disposition: "outside", why: "reads the user-named --from file" },
  { key: "packages/cli/src/retro.ts:runRetro:readFileSync#2", disposition: "outside", why: "reads the user-named --from file" },
  { key: "packages/cli/src/rules/design.ts:checkDesign:readFileSync#1", disposition: "outside", why: "reads docs/design/DIRECTION.md in the repo (opts.repo)" },
  { key: "packages/cli/src/rules/docs.ts:checkDossierShrink:readFileSync#1", disposition: "outside", why: "reads the dossier under docs/ in the repo" },
  { key: "packages/cli/src/rules/instructions.ts:checkInstructions:readFileSync#1", disposition: "outside", why: "reads the generated CLAUDE.md, AGENTS.md and GLOSSARY.md at the repo root" },
  { key: "packages/cli/src/rules/milestones.ts:readDeclared:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (milestones.yml)" },
  { key: "packages/cli/src/rules/tests.ts:fileSet:readFileSync#1", disposition: "outside", why: "reads package.json and source files in the repo" },
  { key: "packages/cli/src/rules/tests.ts:scanTests:readFileSync#1", disposition: "outside", why: "reads test files in the repo" },
  { key: "packages/cli/src/test.ts:<module>:readFileSync#1", disposition: "outside", why: "acceptance run: reads the fixtures under examples/ in the repo" },
  { key: "packages/cli/src/tick.ts:writeHealthFile:writeFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (health.json)" },
  { key: "packages/cli/src/tick.ts:writeTickReceipt:writeFileSync#1", disposition: "contained", why: "receipts/tick/<session>.json in a real receipts/tick/ checked by ensureRealDirectory" },
  { key: "packages/cli/src/tick.ts:writeDailyActum:mkdirSync#1", disposition: "contained", why: "acta/<date>-<sella>-daily.md in a real acta/ checked by ensureRealDirectory before the turn is spent" },
  { key: "packages/cli/src/tick.ts:writeDailyActum:writeFileSync#1", disposition: "contained", why: "acta/<date>-<sella>-daily.md in a real acta/ checked by ensureRealDirectory before the turn is spent" },
  { key: "packages/commands/src/builder-run.ts:gitWriteProbe:openSync#1", disposition: "outside", why: "creates and removes .git/index.lock to probe git writability" },
  { key: "packages/commands/src/builder-run.ts:gitWriteProbe:unlinkSync#1", disposition: "outside", why: "creates and removes .git/index.lock to probe git writability" },
  { key: "packages/commands/src/builder-run.ts:acquireProducerLease:mkdirSync#1", disposition: "outside", why: "the producer lease under .bisellium/leases/" },
  { key: "packages/commands/src/builder-run.ts:acquireProducerLease:mkdirSync#2", disposition: "outside", why: "the producer lease under .bisellium/leases/" },
  { key: "packages/commands/src/builder-run.ts:acquireProducerLease:writeFileSync#1", disposition: "outside", why: "the producer lease under .bisellium/leases/" },
  { key: "packages/commands/src/builder-run.ts:acquireProducerLease:rmSync#1", disposition: "outside", why: "the producer lease under .bisellium/leases/" },
  { key: "packages/commands/src/builder-run.ts:readOptional:readFileSync#1", disposition: "outside", why: "reads the lease pid file under .bisellium/leases/" },
  { key: "packages/commands/src/builder-run.ts:cleanupAbandonedRuntime:readFileSync#1", disposition: "outside", why: "reads the host result file and removes a runner-made directory directly under OS temp" },
  { key: "packages/commands/src/builder-run.ts:cleanupAbandonedRuntime:rmSync#1", disposition: "outside", why: "reads the host result file and removes a runner-made directory directly under OS temp" },
  { key: "packages/commands/src/builder-run.ts:runBuilderCommand:readFileSync#1", disposition: "outside", why: "reads the host result file and removes the result directory and lease under OS temp and .bisellium/" },
  { key: "packages/commands/src/builder-run.ts:runBuilderCommand:rmSync#1", disposition: "outside", why: "reads the host result file and removes the result directory and lease under OS temp and .bisellium/" },
  { key: "packages/commands/src/builder-run.ts:runBuilderCommand:rmSync#2", disposition: "outside", why: "reads the host result file and removes the result directory and lease under OS temp and .bisellium/" },
  { key: "packages/commands/src/ci.ts:defaultInstallDeps:rmSync#1", disposition: "outside", why: "removes a cache directory the run made under OS temp" },
  { key: "packages/commands/src/delegate.ts:runDelegate:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml), read and rewritten; no id or flag builds the path" },
  { key: "packages/commands/src/delegate.ts:runDelegate:writeFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml), read and rewritten; no id or flag builds the path" },
  { key: "packages/commands/src/delegate.ts:runDelegate:writeFileSync#2", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (bisellium.yml), read and rewritten; no id or flag builds the path" },
  { key: "packages/commands/src/frontmatter.ts:editOpusFrontMatter:writeFileSync#1", disposition: "contained", why: "the record was just read through readContainedRegularFile; requireRealDirectory checks its directory before the write" },
  { key: "packages/commands/src/ids.ts:ensureRealDirectory:mkdirSync#1", disposition: "helper", why: "the containment helper's own mkdir, one level at a time, each level checked by requireRealDirectory" },
  { key: "packages/commands/src/ids.ts:createNextRecord:mkdirSync#1", disposition: "helper", why: "the shared allocator: requireRealDirectory before the exclusive create" },
  { key: "packages/commands/src/ids.ts:createNextRecord:writeFileSync#1", disposition: "helper", why: "the shared allocator: requireRealDirectory before the exclusive create" },
  { key: "packages/commands/src/lifecycle.ts:runRed:writeFileSync#1", disposition: "contained", why: "ci/reds/<opus>/<nn>.log in a real directory chain checked by ensureRealDirectory; nothing is created below a symlink" },
  { key: "packages/commands/src/lifecycle.ts:declaredMilestoneIds:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (milestones.yml)" },
  { key: "packages/commands/src/opus-model.ts:readContainedRegularFile:openSync#1", disposition: "helper", why: "the contained reader's own open and read" },
  { key: "packages/commands/src/opus-model.ts:readContainedRegularFile:readFileSync#1", disposition: "helper", why: "the contained reader's own open and read" },
  { key: "packages/commands/src/pause.ts:readPauseState:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (PAUSED)" },
  { key: "packages/commands/src/pause.ts:runPause:mkdirSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (PAUSED)" },
  { key: "packages/commands/src/pause.ts:runPause:writeFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (PAUSED)" },
  { key: "packages/commands/src/pause.ts:runResume:rmSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (PAUSED)" },
  { key: "packages/commands/src/probe.ts:probeBattery:writeFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (models.json) and its .tmp sibling, atomic rename" },
  { key: "packages/commands/src/probe.ts:probeBattery:renameSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (models.json) and its .tmp sibling, atomic rename" },
  { key: "packages/commands/src/probe.ts:readModelsRecord:readFileSync#1", disposition: "listed", why: "a fixed-name file at the officina root, not built from an id, a listed name or a flag (models.json)" },
  { key: "packages/commands/src/talk.ts:writeSession:openSync#1", disposition: "contained", why: "sessions/<sella>.json in a real sessions/ made by ensureRealDirectory, opened with O_NOFOLLOW; talk refuses a symlinked sessions/ or session file before the turn is spent" },
  { key: "packages/commands/src/talk.ts:writeSession:writeFileSync#1", disposition: "contained", why: "sessions/<sella>.json in a real sessions/ made by ensureRealDirectory, opened with O_NOFOLLOW; talk refuses a symlinked sessions/ or session file before the turn is spent" },
  { key: "packages/commands/src/talk.ts:appendTimeline:appendFileSync#1", disposition: "contained", why: "timeline/<sella>.jsonl in a real timeline/ checked by ensureRealDirectory" },
  { key: "packages/commands/src/talk.ts:writeActum:writeFileSync#1", disposition: "contained", why: "acta/<date>-<slug>.md in a real acta/ checked by ensureRealDirectory" },
  { key: "packages/commands/src/verdict.ts:runVerdict:readFileSync#1", disposition: "outside", why: "reads the user-named --from findings file" },
  { key: "packages/commands/src/verdict.ts:runVerdict:readFileSync#2", disposition: "outside", why: "reads the findings from stdin (fd 0)" },
  { key: "packages/commands/src/verdict.ts:runVerdict:writeFileSync#1", disposition: "contained", why: "ci/<opus>-<phase>-<round>.log in a real ci/ checked by ensureRealDirectory, exclusive create" },
  { key: "packages/commands/src/writes.ts:appendPatronTimeline:appendFileSync#1", disposition: "contained", why: "timeline/patron.jsonl in a real timeline/ checked by ensureRealDirectory" },
  { key: "packages/commands/src/writes.ts:runAnswer:writeFileSync#1", disposition: "contained", why: "acta/<date>-<slug>.md in a real acta/ checked by ensureRealDirectory before any write" },
  { key: "packages/commands/src/writes.ts:runAnswer:writeFileSync#2", disposition: "contained", why: "restores the petitio bytes just read through readContainedRegularFile; editOpusFrontMatter checked its directory" },
  { key: "packages/commands/src/writes.ts:runAnswer:unlinkSync#1", disposition: "contained", why: "removes the acta this call created in the real acta/ it checked" },
  { key: "packages/commands/src/writes.ts:runGreenlight:writeFileSync#1", disposition: "contained", why: "restores the opus bytes just read through readContainedRegularFile; editOpusFrontMatter checked its directory" },
  { key: "packages/commands/src/writes.ts:runBudget:writeFileSync#1", disposition: "contained", why: "aerarium/<period>.yml in a real aerarium/ checked by ensureRealDirectory; the period is matched against YYYY-Www" },
  { key: "packages/commands/src/writes.ts:runBudget:writeFileSync#2", disposition: "contained", why: "restores the aerarium bytes read through readContainedRegularFile" },
  { key: "packages/commands/src/writes.ts:runBudget:unlinkSync#1", disposition: "contained", why: "removes the aerarium file this call created in the real aerarium/ it checked" },
  { key: "packages/core/src/index-db.ts:<module>:mkdirSync#1", disposition: "outside", why: "creates the .bisellium/ directory for the SQLite index" },
  { key: "packages/core/src/index-db.ts:openOrRecreate:rmSync#1", disposition: "outside", why: "removes a corrupt SQLite index file under .bisellium/" },
  { key: "packages/core/src/log.ts:appendEvents:mkdirSync#1", disposition: "listed", why: "the event log under .bisellium/, opened with O_NOFOLLOW; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/core/src/log.ts:appendEvents:openSync#1", disposition: "listed", why: "the event log under .bisellium/, opened with O_NOFOLLOW; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/core/src/log.ts:readLog:readFileSync#1", disposition: "listed", why: "the event log under .bisellium/; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/core/src/store.ts:loadPersistedSnapshots:readFileSync#1", disposition: "listed", why: "persisted snapshots under .bisellium/; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/core/src/store.ts:persistSnapshot:mkdirSync#1", disposition: "listed", why: "persisted snapshots under .bisellium/; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/core/src/store.ts:persistSnapshot:writeFileSync#1", disposition: "listed", why: "persisted snapshots under .bisellium/; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/pipeline/src/index.ts:run:mkdirSync#1", disposition: "guarded", why: "writes the gate logs into logDir; its only caller, runVerify, passes ci/ and refuses a symlinked ci/ before any state is written" },
  { key: "packages/pipeline/src/index.ts:run:writeFileSync#1", disposition: "guarded", why: "writes the gate logs into logDir; its only caller, runVerify, passes ci/ and refuses a symlinked ci/ before any state is written" },
  { key: "packages/shim/src/harness/claude-code.ts:start:writeFileSync#1", disposition: "outside", why: "writes a system-prompt file in a temp directory and removes it" },
  { key: "packages/shim/src/harness/claude-code.ts:start:rmSync#1", disposition: "outside", why: "writes a system-prompt file in a temp directory and removes it" },
  { key: "packages/shim/src/hooks/claude-code.ts:claudeCodeHooksBlock:readFileSync#1", disposition: "outside", why: "reads the hooks template shipped in the package" },
  { key: "packages/shim/src/hooks/receiptStatus.ts:readSellaReceipts:openSync#1", disposition: "listed", why: "reads receipts/<sella>/*.json, opened with O_NOFOLLOW; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/shim/src/hooks/receiptStatus.ts:readSellaReceipts:readFileSync#1", disposition: "listed", why: "reads receipts/<sella>/*.json, opened with O_NOFOLLOW; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/shim/src/receipts.ts:writeReceiptStart:mkdirSync#1", disposition: "listed", why: "receipts/<sella>/<session>.json; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/shim/src/receipts.ts:writeReceiptStart:writeFileSync#1", disposition: "listed", why: "receipts/<sella>/<session>.json; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/shim/src/receipts.ts:writeReceiptEnd:readFileSync#1", disposition: "listed", why: "receipts/<sella>/<session>.json; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/shim/src/receipts.ts:writeReceiptEnd:writeFileSync#1", disposition: "listed", why: "receipts/<sella>/<session>.json; follow-on: move the real-parent check below core/shim, then contain this write" },
  { key: "packages/shim/src/worktree.ts:acquire:mkdirSync#1", disposition: "outside", why: "creates the worktrees root under .bisellium/" },
  { key: "packages/shim/src/worktree.ts:reclaimWorktrees:rmSync#1", disposition: "outside", why: "removes a reclaimed worktree directory under .bisellium/worktrees/" },
  { key: "scripts/agent-settings-merge.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/agent-settings-merge.mjs:<module>:copyFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/agent-settings-merge.mjs:<module>:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/agent-settings-merge.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/arch-graph.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/arch-graph.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/capture-gh-fixtures.mjs:save:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/capture-gh-fixtures.mjs:<module>:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/capture-gh-fixtures.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/changelog.mjs:main:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/ci-scope.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/ci-scope.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/concise-stop.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/concise-stop.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/gemini.mjs:loadKey:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/gemini.mjs:parseArgs:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/gemini.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-broker.mjs:openCellChannel:openSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-broker.mjs:openCellChannel:openSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:acquire:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:acquire:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:acquire:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:acquire:renameSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:acquire:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:call:openSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:call:openSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/git-cell-client.mjs:<module>:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/milestones-seed.mjs:stateOf:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/milestones-seed.mjs:main:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/milestones-seed.mjs:main:writeFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/milestones-seed.mjs:main:readFileSync#2", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/no-vendor.mjs:preflightBisDir:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:acquireLock:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:acquireLock:openSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:acquireLock:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:acquireLock:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:releaseLock:unlinkSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:readLogLines:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:clearLog:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:clearLog:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:scanBareVendorSpawns:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:scanTestFilesForVendorNames:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:scanTestSuppliedPaths:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/no-vendor.mjs:main:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/probe-builder-runtime.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/probe-builder-runtime.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/probe-builder-runtime.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/probe-builder-runtime.mjs:<module>:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:flush:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:flush:renameSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:rebaseWorkspaceLinks:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:rebaseWorkspaceLinks:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:rebaseWorkspaceLinks:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:rebaseWorkspaceLinks:symlinkSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:etcFor:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:etcFor:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:etcFor:writeFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:removeScratch:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:teardownAll:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:teardownAll:rmSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:writeFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:mkdirSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:mkdirSync#3", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:writeFileSync#3", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:copyModules:cpSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:copyFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:symlinkSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:copyFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:rmSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:rmSync#3", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:readFileSync#3", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:identifyRebased:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:readFileSync#4", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:mkdirSync#4", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/run-builder-host.mjs:<module>:mkdirSync#5", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:siteEdits:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:contractEdit:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:censusInsertHelperCallEdit:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:censusInsertRawJoinEdit:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:censusInsertInFunctionEdit:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:censusReformatEdit:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:<module>:writeFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/safe-item-path-mutants.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/served-e2e.mjs:<module>:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/served-e2e.mjs:<module>:mkdirSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/served-e2e.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/served-e2e.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/status-page.mjs:readFrontMatter:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/status-page.mjs:readOfficina:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/status-page.mjs:readMilestones:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/status-page.mjs:readHistoryRows:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/status-page.mjs:main:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/status-page.mjs:main:writeFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/sweep-traditio-stage.mjs:readFrontMatter:readFileSync#1", disposition: "listed", why: "reads record files (opera, milestones, history) to build a report; follow-on: scripts that read records go through readContainedRegularFile" },
  { key: "scripts/usage-from-workflow.mjs:readJson:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/usage-from-workflow.mjs:main:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w030-usage-guard-mutation.mjs:mutate:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w030-usage-guard-mutation.mjs:mutate:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w030-usage-guard-mutation.mjs:revert:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w041-mutation-check.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w041-mutation-check.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w041-mutation-check.mjs:<module>:writeFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w041-mutation-check.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w044-mutation-check.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w044-mutation-check.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w044-mutation-check.mjs:<module>:writeFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w049-mutation-check.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w049-mutation-check.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w049-mutation-check.mjs:<module>:writeFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w057-behaviour7-mutation-check.mjs:<module>:copyFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w057-behaviour7-mutation-check.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w057-behaviour7-mutation-check.mjs:<module>:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w057-behaviour7-mutation-check.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w057-behaviour7-mutation-check.mjs:<module>:writeFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w057-behaviour7-mutation-check.mjs:<module>:rmSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w079-mutation-check.mjs:<module>:copyFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w079-mutation-check.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w079-mutation-check.mjs:<module>:rmSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w079-mutation-check.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w079-mutation-check.mjs:<module>:copyFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w079-mutation-check.mjs:<module>:rmSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w079-mutation-check.mjs:<module>:readFileSync#2", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w084-citation-census.mjs:<module>:readFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
  { key: "scripts/w084-citation-census.mjs:<module>:writeFileSync#1", disposition: "outside", why: "dev tooling: reads and writes repo files and temp scratch, never an officina" },
];

const filesCD = sourceFilesCD(repo);
check("source set C/D is non-empty", filesCD.length > 0, String(filesCD.length));
const scanCD_ = scanCD(repo, filesCD);
const w163Failures: string[] = [];
const checkW = (name: string, ok: boolean, detail = ""): void => {
  check(name, ok, detail);
  if (!ok) w163Failures.push(name);
};
const REMEDY_CD =
  "a raw date parse or raw file access changed — see studio/briefs/W-163.md; fix it through the approved helper, or pin it here with a disposition and a reason";

for (const [letter, scanned, pinned, what] of [
  ["C", scanCD_.c, PINNED_C, "raw date parse"],
  ["D", scanCD_.d, PINNED_D, "raw file access"],
] as const) {
  const keys = pinned.map((p) => p.key);
  const scanKeys = scanned.map((x) => x.key);
  checkW(`inventory ${letter}: pinned list length matches the scan's own count`, pinned.length === scanned.length, `pinned=${pinned.length} scan=${scanned.length}`);
  const { added, removed } = diffLists(scanKeys, keys);
  checkW(
    `inventory ${letter}: every ${what} is pinned, none missing`,
    added.length === 0 && removed.length === 0,
    added.length || removed.length ? `${REMEDY_CD} — added: ${JSON.stringify(added)} removed: ${JSON.stringify(removed)}` : "",
  );
  checkW(`inventory ${letter}: scan order matches the pinned order exactly`, JSON.stringify(scanKeys) === JSON.stringify(keys));
  checkW(`inventory ${letter}: pinned keys are unique`, new Set(keys).size === keys.length);
  checkW(`inventory ${letter}: every pinned disposition comes from the table`, pinned.every((p) => ["helper", "contained", "guarded", "outside", "listed"].includes(p.disposition)));
}
const allPins = [...PINNED_C, ...PINNED_D];
checkW(
  "every helper pin is inside an approved helper",
  allPins.filter((p) => p.disposition === "helper").every((p) => {
    const [rel, fn] = p.key.split(":");
    return APPROVED_HELPERS.has(`${rel}:${fn}`);
  }),
);
checkW(
  "every contained pin's function calls a containment helper",
  allPins.filter((p) => p.disposition === "contained").every((p) => {
    const [rel, fn] = p.key.split(":");
    return scanCD_.helperCallers.has(`${rel}:${fn}`);
  }),
);
checkW("every why is non-empty", allPins.every((p) => p.why.trim().length > 0));
// A whole fs module handed on is a form the scan cannot follow, so it fails closed. These are the reviewed exceptions: each
// must still be found (a stale one fails) and nothing else may be (a new one fails).
const PINNED_ESCAPES: { key: string; why: string }[] = [
  {
    key: "scripts/record-reads.mjs:<module>: the fs module is used where the scan cannot follow it",
    why: "dev tooling: the read-tracing preload (W-139) patches fs and fs.promises with logging wrappers that call the originals with the traced process's own paths; it opens no officina path itself",
  },
  {
    key: "scripts/record-reads.mjs:<module>: appendFileSync is used other than as a direct call",
    why: "dev tooling: the same preload keeps the original appendFileSync before it patches fs, so its own log lines never pass through a wrapper",
  },
];
{
  const pinnedEscapes = PINNED_ESCAPES.map((e) => e.key);
  const unexpected = scanCD_.outOfDomain.filter((o) => !pinnedEscapes.includes(o));
  const stale = pinnedEscapes.filter((k) => !scanCD_.outOfDomain.includes(k));
  checkW("no out-of-domain fs binding", unexpected.length === 0 && stale.length === 0, JSON.stringify({ unexpected, stale }));
  checkW("every pinned escape has a why", PINNED_ESCAPES.every((e) => e.why.trim().length > 0));
}

// One node:test row so `--test-name-pattern=W-163-b6` yields an assertion-level TAP line.
test("W-163-b6 behaviour 6: the census lists every raw date parse and raw file access, and a new one fails the build", () => {
  assert.deepEqual(w163Failures, []);
});

// ---------------------------------------------------------------------------
// W-163 review round 1 — the scan's own mutants. Each fixture is a synthetic
// source file in a scratch tree, scanned once with the real scanCD; each row
// states what that form must do to the census: become a pinned-or-fail site,
// or fail the scan closed (out-of-domain). A form the scan does not see here
// is a hole in the build gate.
// ---------------------------------------------------------------------------
const FIXTURES: Record<string, string> = {
  // inventory D: member and binding forms of an fs module
  "d-computed-ns": `import * as fs from "node:fs";\nexport function f(p: string) { return fs["readFileSync"](p); }\n`,
  "d-computed-default": `import fs from "fs";\nexport function f(p: string) { fs["writeFileSync"](p, ""); }\n`,
  "d-default-specifier": `import { default as fs } from "node:fs";\nexport function f(p: string) { return fs.readFileSync(p); }\n`,
  "d-non-literal-member": `import * as fs from "node:fs";\nexport function f(name: string, p: string) { return (fs as any)[name](p); }\n`,
  // fail closed: a binding the scan cannot follow
  "o-escape-fs": `import * as fs from "node:fs";\ndeclare function use(x: unknown): void;\nuse(fs);\n`,
  "o-create-require-alias": `import { createRequire as cr } from "node:module";\nconst r = cr(import.meta.url);\nexport function f() { return r("node:fs"); }\n`,
  "o-create-require-namespace": `import * as m from "node:module";\nconst r = m.createRequire(import.meta.url);\nexport function f() { return r("node:fs"); }\n`,
  "o-create-require-literal-member": `import * as m from "node:module";\nconst r = m["createRequire"](import.meta.url);\nexport function f() { return r("node:fs"); }\n`,
  "o-create-require-computed": `import * as m from "node:module";\nexport function f(k: string) { return (m as any)[k](import.meta.url); }\n`,
  "o-dynamic-import": `export async function f(x: string) { return import(x); }\n`,
  "o-get-builtin-module": `export function f() { return process.getBuiltinModule("fs"); }\n`,
  // inventory C: member and binding forms of Date
  "c-computed-parse": `export function f(x: string) { return Date["parse"](x); }\n`,
  "c-non-literal-member": `export function f(k: string, x: string) { return (Date as any)[k](x); }\n`,
  "c-global-date": `export function f(x: string) { return globalThis.Date.parse(x) + Number(new globalThis["Date"](x)); }\n`,
  "o-escape-date": `declare function use(x: unknown): void;\nuse(Date);\n`,
  // direct calls: the form the census follows
  "direct": `import * as fs from "node:fs";\nimport { writeFile } from "node:fs/promises";\nexport async function f(p: string, x: string) { fs.readFileSync(p); await writeFile(p, ""); return [Date.parse(x), new Date(x)]; }\n`,
  // controls: ordinary uses that must stay out of the scan
  "ok-control": `import { readdirSync } from "node:fs";\nexport function f(p: string, a: unknown) { return [readdirSync(p), Date.now(), new Date(5), new Date("2026-01-01"), a instanceof Date, typeof Date, Date.UTC(2000, 0, 1)]; }\n`,
};

// W-163 review round 2: the census follows a direct call and nothing else. Any other use of an fs function or namespace,
// Date.parse or the Date constructor (aliased, destructured, stored, passed, returned, exported) fails by rule, so the
// scan never has to track an alias; only a reviewed PINNED_ESCAPES entry can excuse one.
const NO_ALIAS_FIXTURES: Record<string, string> = {
  // an extracted fs function
  "named-alias": `import { readFileSync } from "node:fs";\nconst r = readFileSync;\nexport function f(p: string) { return r(p); }\n`,
  "destructured-alias": `import * as fs from "node:fs";\nconst { readFileSync } = fs;\nexport function f(p: string) { return readFileSync(p, "utf8"); }\n`,
  "destructured-rename-promises": `import { promises } from "node:fs";\nconst { readFile: rd } = promises;\nexport async function f(p: string) { return rd(p); }\n`,
  "destructured-rest": `import * as fs from "node:fs";\nconst { ...all } = fs;\nexport function f(p: string) { return all.readFileSync(p); }\n`,
  "destructured-computed-key": `import * as fs from "node:fs";\nconst key = "read" + "FileSync";\nconst { [key]: rd } = fs as any;\nexport function f(p: string) { return rd(p); }\n`,
  "property-alias": `import fs from "node:fs";\nconst r = fs.readFileSync;\nexport function f(p: string) { return r(p); }\n`,
  "literal-computed-alias": `import fs from "node:fs";\nconst r = fs["readFileSync"];\nexport function f(p: string) { return r(p); }\n`,
  "assignment-alias": `import { readFileSync } from "node:fs";\nlet r: any;\nr = readFileSync;\nexport function f(p: string) { return r(p); }\n`,
  "assignment-destructure": `import * as fs from "node:fs";\nlet rd: any;\n({ readFileSync: rd } = fs);\nexport function f(p: string) { return rd(p); }\n`,
  "inline-exported-alias": `import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n`,
  "inline-exported-property": `import fs from "node:fs";\nexport const read = fs.readFileSync;\n`,
  "export-specifier": `import { readFileSync } from "node:fs";\nexport { readFileSync };\n`,
  "export-specifier-renamed": `import { readFileSync } from "node:fs";\nexport { readFileSync as read };\n`,
  "reexport-named": `export { readFileSync } from "node:fs";\n`,
  "reexport-star": `export * from "node:fs";\n`,
  "reexport-namespace": `export * as fs from "node:fs";\n`,
  "passed-as-argument": `import { readFileSync } from "node:fs";\ndeclare function use(x: unknown): void;\nuse(readFileSync);\n`,
  "returned": `import { readFileSync } from "node:fs";\nexport function f() { return readFileSync; }\n`,
  "stored-on-property": `import { readFileSync } from "node:fs";\nexport const o = { read: readFileSync };\n`,
  "stored-shorthand": `import { readFileSync } from "node:fs";\nexport const o = { readFileSync };\n`,
  "bound-call": `import { readFileSync } from "node:fs";\nexport function f(p: string) { return readFileSync.call(undefined, p); }\n`,
  // an fs namespace
  "namespace-alias": `import * as fs from "node:fs";\nconst g = fs;\nexport function f(p: string) { return g.readFileSync(p); }\n`,
  "namespace-alias-chain": `import fs from "node:fs";\nconst a = fs.promises;\nconst b = a;\nexport async function f(p: string) { return b["readFile"](p); }\n`,
  "namespace-assignment": `import * as fs from "node:fs";\nlet g: typeof fs;\ng = fs;\nexport function f(p: string) { return g.rmSync(p); }\n`,
  "namespace-stored": `import fs from "node:fs";\nexport const o = { fs };\n`,
  "namespace-exported": `import fs from "node:fs";\nexport { fs };\n`,
  "namespace-default-exported": `import fs from "node:fs";\nexport default fs;\n`,
  // Date.parse and the Date constructor
  "date-parse-alias": `export const p = Date.parse;\nexport function f(x: string) { return p(x); }\n`,
  "date-parse-destructured": `const { parse } = Date;\nexport function f(x: string) { return parse(x); }\n`,
  "date-parse-literal-computed": `const p = Date["parse"];\nexport function f(x: string) { return p(x); }\n`,
  "date-parse-assignment": `let p: any;\np = Date.parse;\nexport function f(x: string) { return p(x); }\n`,
  "date-parse-argument": `export function f(xs: string[]) { return xs.map(Date.parse); }\n`,
  "date-parse-bound-call": `export function f(x: string) { return Date.parse.call(undefined, x); }\n`,
  "date-ctor-alias": `const D = Date;\nexport function f(x: string) { return new D(x); }\n`,
  "date-ctor-assignment": `let D: any;\nD = Date;\nexport function f(x: string) { return new D(x); }\n`,
  "date-ctor-exported": `export { Date as D };\n`,
  "date-ctor-inline-exported": `export const D = Date;\n`,
  "date-ctor-stored": `export const o = { Date };\n`,
  "global-object-alias": `const g = globalThis;\nexport function f(x: string) { return g.Date.parse(x); }\n`,
};
for (const name of Object.keys(NO_ALIAS_FIXTURES)) FIXTURES[`na-${name}`] = NO_ALIAS_FIXTURES[name]!;

// W-163 spec round 2: on Date the only member uses are the direct calls Date.parse(...), Date.UTC(...) and Date.now();
// any other member access is an out-of-domain finding (reflection and the prototype chain beyond it are out of scope).
const DATE_MEMBER_FIXTURES: Record<string, string> = {
  "date-prototype": `export const p = Date.prototype;\n`,
  "date-prototype-constructor-parse": `export function f(x: string) { return (Date.prototype.constructor as DateConstructor).parse(x); }\n`,
  "date-prototype-constructor-new": `export function f(x: string) { return new (Date.prototype.constructor as DateConstructor)(x); }\n`,
  "date-global-prototype": `export const p = globalThis.Date.prototype;\n`,
  "date-other-member": `export const n = Date.length;\n`,
  "date-now-uncalled": `export const f = Date.now;\n`,
};
// W-163 review round 4: a computed Date member whose key is not a string literal is off the allowlist, never a pinnable C site.
DATE_MEMBER_FIXTURES["computed-member"] = `export function f(k: string, x: string) { return (Date as any)[k](x); }\n`;
DATE_MEMBER_FIXTURES["global-computed-member"] = `export function f(k: string, x: string) { return (globalThis.Date as any)[k](x); }\n`;
for (const name of Object.keys(DATE_MEMBER_FIXTURES)) FIXTURES[`dm-${name}`] = DATE_MEMBER_FIXTURES[name]!;
let fixtureScan: CDScan | undefined;
function fixtureSites(name: string): { d: string[]; c: string[]; out: string[] } {
  const rel = (n: string): string => `packages/m/src/${n}.ts`;
  if (!fixtureScan) {
    const dir = mkdtempSync(join(tmpdir(), "w163-census-"));
    try {
      for (const [n, text] of Object.entries(FIXTURES)) {
        mkdirSync(dirname(join(dir, rel(n))), { recursive: true });
        writeFileSync(join(dir, rel(n)), text);
      }
      fixtureScan = scanCD(dir, Object.keys(FIXTURES).map(rel));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const mine = (xs: Site[]): string[] => xs.filter((x) => x.rel === rel(name)).map((x) => x.key.slice(rel(name).length + 1)).sort();
  return { d: mine(fixtureScan.d), c: mine(fixtureScan.c), out: fixtureScan.outOfDomain.filter((o) => o.startsWith(rel(name))) };
}

for (const [name, want] of [
  ["d-computed-ns", ["f:readFileSync#1"]],
  ["d-computed-default", ["f:writeFileSync#1"]],
  ["d-default-specifier", ["f:readFileSync#1"]],
  ["d-non-literal-member", ["f:<computed>#1"]],
] as const) {
  test(`W-163-b6 round 2: inventory D lists the ${name} form`, () => {
    const got = fixtureSites(name);
    assert.deepEqual(got.d, [...want]);
    assert.deepEqual(got.out, []);
  });
}
for (const [name, want] of [
  ["c-computed-parse", ["f:Date.parse#1"]],
  ["c-global-date", ["f:Date.parse#1", "f:new Date#1"]],
] as const) {
  test(`W-163-b6 round 2: inventory C lists the ${name} form`, () => {
    const got = fixtureSites(name);
    assert.deepEqual(got.c, [...want]);
    assert.deepEqual(got.out, []);
  });
}
for (const name of [
  "o-escape-fs",
  "o-create-require-alias",
  "o-create-require-namespace",
  "o-create-require-literal-member",
  "o-create-require-computed",
  "o-dynamic-import",
  "o-get-builtin-module",
  "o-escape-date",
]) {
  test(`W-163-b6 round 2: the scan fails closed on the ${name} form`, () => {
    assert.ok(fixtureSites(name).out.length > 0, "an out-of-domain finding names the file");
  });
}
for (const name of Object.keys(NO_ALIAS_FIXTURES)) {
  test(`W-163-b6 round 3: the scan refuses the ${name} form`, () => {
    assert.ok(fixtureSites(`na-${name}`).out.length > 0, "an out-of-domain finding names the file");
  });
}
const round = (name: string): number => (name.endsWith("computed-member") ? 5 : 4);
for (const name of Object.keys(DATE_MEMBER_FIXTURES)) {
  test(`W-163-b6 round ${round(name)}: the scan refuses the ${name} form`, () => {
    assert.ok(fixtureSites(`dm-${name}`).out.length > 0, "an out-of-domain finding names the file");
  });
}
test("W-163-b6 round 3: a direct call stays the one followed form", () => {
  assert.deepEqual(fixtureSites("direct"), { d: ["f:readFileSync#1", "f:writeFile#1"], c: ["f:Date.parse#1", "f:new Date#1"], out: [] });
});
test("W-163-b6 round 2: ordinary Date and fs uses stay out of the scan", () => {
  assert.deepEqual(fixtureSites("ok-control"), { d: [], c: [], out: [] });
});
test("W-163-b6 round 2: the bright line's two raw reads left the pins and the session write is a contained pin", () => {
  const pin = (key: string): string | undefined => PINNED_D.find((p) => p.key === key)?.disposition;
  assert.equal(pin("packages/cli/src/prune.ts:walk:readFileSync#1"), undefined, "prune's walk reads through readContainedRegularFile");
  assert.equal(pin("packages/commands/src/talk.ts:readSession:readFileSync#1"), undefined, "talk's readSession reads through readContainedRegularFile");
  assert.equal(pin("packages/commands/src/talk.ts:writeSession:mkdirSync#1"), undefined, "talk's writeSession makes sessions/ through ensureRealDirectory");
  assert.equal(pin("packages/commands/src/talk.ts:writeSession:openSync#1"), "contained");
  assert.equal(pin("packages/commands/src/talk.ts:writeSession:writeFileSync#1"), "contained");
});

// W163_DUMP=1 prints the scan (C, D, out-of-domain, helper callers) as one JSON line: the input of the PINNED_D generator.
if (process.env["W163_DUMP"]) console.log("DUMP" + JSON.stringify({ c: scanCD_.c.map((x) => x.key), d: scanCD_.d.map((x) => x.key), out: scanCD_.outOfDomain, hc: [...scanCD_.helperCallers] }));
process.exitCode = failed ? 1 : 0;
