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
  "packages/commands/src/lifecycle.ts:runAmend:opera#1",
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
  { key: "apps/server/src/store.ts:opus#1", disposition: "guarded", why: 'safeId(id) refuses one line above (":223")' },
  {
    key: "apps/web/tests-serve/answer.spec.ts:<module>#1",
    disposition: "bypass",
    why: "W-067 acceptance smoke, test-only: target.id is read back from the served instance's own /api/inbox response and joined against a mkdtemp scratch studio this same test creates and deletes — a traversal here reaches nothing but the test's own throwaway temp dir, never studio/ or examples/sample-studio itself",
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
  { key: "packages/cli/src/new.ts:newItem#1", disposition: "derived", why: "W-### from a counter over opera/" },
  { key: "packages/cli/src/new.ts:runNew#1", disposition: "derived", why: "same counter id, front-matter spec: value" },
  { key: "packages/cli/src/new.ts:runNew#2", disposition: "derived", why: "same counter id, briefs/ write" },
  { key: "packages/cli/src/new.ts:runNew#3", disposition: "derived", why: "same counter id, opera/ write" },
  { key: "packages/cli/src/prune.ts:pruneStaleOpusBranches#1", disposition: "derived", why: 'id is branch.replace(/^opus\\//, ""); git refuses ".." in a ref name' },
  { key: "packages/cli/src/retro.ts:draftRetro#1", disposition: "derived", why: "L-### from nextId" },
  { key: "packages/cli/src/retro.ts:draftRetro#2", disposition: "derived", why: "P-### from nextId" },
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
    key: "packages/commands/src/context.ts:buildContextFor#1",
    disposition: "derived",
    why: "a display label inside the context bundle; never reaches the filesystem",
  },
  { key: "packages/commands/src/lifecycle.ts:runReady#1", disposition: "guarded", why: "opusId passed safeItemPath at :109" },
  { key: "packages/commands/src/lifecycle.ts:runWaive#1", disposition: "guarded", why: "decisionId passed patronDecisionProblem -> safeItemPath" },
  { key: "packages/commands/src/talk.ts:openPetitio#1", disposition: "derived", why: "P-### from a counter" },
  { key: "packages/commands/src/talk.ts:writeActum#1", disposition: "derived", why: "slugify strips to [a-z0-9-], capped at 40" },
  { key: "packages/commands/src/talk.ts:writeActum#2", disposition: "derived", why: "same slug plus a numeric suffix" },
  {
    key: "packages/commands/src/verify.ts:runVerify#1",
    disposition: "bypass",
    why: "positional id, unvalidated (:54-84), and verify writes probationes to what it resolves",
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

process.exit(failed ? 1 : 0);
