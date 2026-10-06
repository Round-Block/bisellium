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
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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

const CONTAINMENT_HELPERS = new Set(["requireRealDirectory", "readContainedRegularFile", "createNextRecord"]);

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
    const named = new Map<string, string>(); // local name -> fs function name
    const spaces = new Set<string>(); // local names that are the fs module (or fs.promises)
    const bound = new Set<string>();
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && FS_MODULES.has(st.moduleSpecifier.text)) {
        const c = st.importClause;
        if (!c) continue;
        if (c.name) spaces.add(c.name.text);
        const nb = c.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) spaces.add(nb.name.text);
        if (nb && ts.isNamedImports(nb))
          for (const el of nb.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (imported === "promises") spaces.add(el.name.text);
            else named.set(el.name.text, imported);
          }
      }
      if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && FS_MODULES.has(st.moduleSpecifier.text))
        out.outOfDomain.push(`${rel}: export from ${st.moduleSpecifier.text}`);
      if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference) && ts.isStringLiteral(st.moduleReference.expression) && FS_MODULES.has(st.moduleReference.expression.text))
        out.outOfDomain.push(`${rel}: import = require(${st.moduleReference.expression.text})`);
    }
    for (const n of named.keys()) bound.add(n);
    for (const n of spaces) bound.add(n);
    const counts = new Map<string, number>();
    const nth = (k: string): number => {
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    };
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const arg0 = n.arguments[0];
        // a bound fs name reached any way but a plain call
        if (ts.isIdentifier(callee) && callee.text === "require" && arg0 && ts.isStringLiteralLike(arg0) && FS_MODULES.has(arg0.text)) out.outOfDomain.push(`${rel}: require(${arg0.text})`);
        if (callee.kind === ts.SyntaxKind.ImportKeyword && arg0 && ts.isStringLiteralLike(arg0) && FS_MODULES.has(arg0.text)) out.outOfDomain.push(`${rel}: import(${arg0.text})`);
        if (ts.isIdentifier(callee) && callee.text === "createRequire") out.outOfDomain.push(`${rel}: createRequire`);
        // helper callers
        const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (CONTAINMENT_HELPERS.has(calleeName)) out.helperCallers.add(`${rel}:${enclosingFunctionName(n)}`);
        // inventory D
        let fsName: string | undefined;
        if (ts.isIdentifier(callee) && named.has(callee.text)) fsName = named.get(callee.text);
        else if (ts.isPropertyAccessExpression(callee)) {
          const target = callee.expression;
          if (ts.isIdentifier(target) && spaces.has(target.text)) fsName = callee.name.text;
          else if (ts.isPropertyAccessExpression(target) && target.name.text === "promises" && ts.isIdentifier(target.expression) && spaces.has(target.expression.text)) fsName = callee.name.text;
        }
        if (fsName && RAW_FS.has(fsName)) {
          const fn = enclosingFunctionName(n);
          out.d.push({ key: `${rel}:${fn}:${fsName}#${nth(`D:${fn}:${fsName}`)}`, rel, fn });
        }
        // inventory C: Date.parse
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Date" && callee.name.text === "parse") {
          const fn = enclosingFunctionName(n);
          out.c.push({ key: `${rel}:${fn}:Date.parse#${nth(`C:${fn}:Date.parse`)}`, rel, fn });
        }
      }
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date" && n.arguments?.length === 1) {
        const a = n.arguments[0]!;
        const literal = ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a);
        const ty = checker.getTypeAtLocation(a);
        const safe = !!(ty.flags & ts.TypeFlags.NumberLike) || checker.typeToString(ty) === "Date";
        if (!literal && !safe) {
          const fn = enclosingFunctionName(n);
          out.c.push({ key: `${rel}:${fn}:new Date#${nth(`C:${fn}:new Date`)}`, rel, fn });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
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
  { key: "packages/commands/src/writes.ts:runAnswer#1", disposition: "derived", why: "--charter-gap acta path; slugify as above" },
  { key: "packages/commands/src/writes.ts:runAnswer#2", disposition: "derived", why: "same slug plus a numeric suffix" },
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

const PINNED_D: PinnedSite[] = [];

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
checkW("no out-of-domain fs binding", scanCD_.outOfDomain.length === 0, JSON.stringify(scanCD_.outOfDomain));

// One node:test row so `--test-name-pattern=W-163-b6` yields an assertion-level TAP line.
test("W-163-b6 behaviour 6: the census lists every raw date parse and raw file access, and a new one fails the build", () => {
  assert.deepEqual(w163Failures, []);
});

process.exitCode = failed ? 1 : 0;
