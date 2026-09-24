#!/usr/bin/env node
/**
 * scripts/safe-item-path-mutants.mjs — W-047's mutation-record red harness.
 *
 * `safeItemPath` (packages/commands/src/writes.ts:104) is already correct,
 * so a test written against it passes on first run — there is no honest
 * "red, then implement" sequence to record. What W-042 and W-044 both found
 * missing in review was evidence that the tests *bite*: that removing a
 * guard, or laundering an id instead of refusing it, actually fails the
 * suite. This script supplies that evidence mechanically: it applies one
 * named mutation to a real source file, runs the test command the mutation
 * is supposed to break, checks that the right assertions failed (never just
 * "the process exited non-zero" — an unrelated pre-existing failure would
 * otherwise "kill" every mutant in the run), and restores the file
 * byte-for-byte from memory before touching the next one.
 *
 *     node scripts/safe-item-path-mutants.mjs <group>
 *
 * <group> is one of: contract, writes, lifecycle, census, legacy, all.
 *
 * A mutant is a record — { label, file, fn, nth, kind, expect, kills } — not
 * a string edit. `kind` is one of raw-join, sanitize, body, insert. `expect`
 * is "dead" (the mutation must make the test fail) or "alive" (it must not:
 * a recorded, examined limit, never a false-drift bug). `kills` is the list
 * of exact `check(...)` label substrings that must appear on `^FAIL` lines
 * of the mutated run — empty only when `expect: "alive"`.
 *
 * Mutants are located by function name + nth-call-in-that-function (via the
 * TypeScript compiler's own AST, the same tool containment.test.ts's census
 * uses), never by line number and never by a raw text search — several of
 * these call sites are textually IDENTICAL across different functions
 * (`safeItemPath(join(root, "opera"), opusId)` appears verbatim in five
 * different functions in lifecycle.ts alone), so a plain string anchor would
 * be genuinely ambiguous. Every edit is applied by character offset, read
 * into memory first and restored from that same in-memory copy in a
 * `finally`, then re-read to confirm byte equality — never `git checkout --`
 * (the lex forbids it: a mutation this script did not itself track down
 * could otherwise be silently discarded along with real work).
 *
 * Exit codes (inverted on purpose — this is what makes an incomplete
 * demonstration impossible for `bisellium red` to record, since `red`
 * refuses a command that exits 0):
 *   1 — every mutant matched its `expect`, and at least one was `expect:
 *       dead`. The success case.
 *   0 — at least one mutant did not match. Names which, and how.
 *   2 — usage error, or the selected group has no mutants.
 *   3 — baseline not green, an anchor was ambiguous (fn/nth resolved to zero
 *       or more than one call), or a mutated file failed to restore
 *       byte-for-byte.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);

// ---------------------------------------------------------------------------
// AST plumbing — shared shape with containment.test.ts's census, narrowed to
// what locating a known call site (or the safeItemPath declaration) needs.
// ---------------------------------------------------------------------------

function parseFile(absPath, text) {
  return ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true);
}

function enclosingFunctionName(node) {
  let cur = node.parent;
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

function callDirLabel(sf, call) {
  const firstArg = call.arguments[0];
  if (
    firstArg &&
    ts.isCallExpression(firstArg) &&
    ts.isIdentifier(firstArg.expression) &&
    firstArg.expression.text === "join"
  ) {
    const last = firstArg.arguments[firstArg.arguments.length - 1];
    if (last && ts.isStringLiteral(last)) return last.text;
  }
  return "?";
}

class AnchorError extends Error {}

/** Every `safeItemPath(...)` CallExpression in `fn` whose `dir` label
 *  matches, in source order — callers index into this by nth (1-based). */
function locateCalls(text, absPath, fn, dir) {
  const sf = parseFile(absPath, text);
  const found = [];
  (function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "safeItemPath") {
      if (enclosingFunctionName(node) === fn && callDirLabel(sf, node) === dir) found.push(node);
    }
    ts.forEachChild(node, visit);
  })(sf);
  return { sf, calls: found };
}

function findFunctionDeclaration(sf, name) {
  let found;
  (function visit(node) {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return found;
}

function ifStatementsIn(bodyNode) {
  const stmts = [];
  (function visit(node) {
    if (ts.isIfStatement(node)) stmts.push(node);
    ts.forEachChild(node, visit);
  })(bodyNode);
  return stmts;
}

/** Applies `edits` ({start,end,replacement}) to `text` in one pass, highest
 *  offset first, so earlier offsets are never invalidated by a later edit. */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

// ---------------------------------------------------------------------------
// Mutation shapes for a known safeItemPath(join(R, "D"), I) call.
// ---------------------------------------------------------------------------

function rawJoinEdit(sf, call) {
  const dirCall = call.arguments[0];
  const idExpr = call.arguments[1];
  const dirArgsText = dirCall.arguments.map((a) => a.getText(sf)).join(", ");
  const idText = idExpr.getText(sf);
  const replacement = `join(${dirArgsText}, \`\${${idText}}.md\`)`;
  return { start: call.getStart(sf), end: call.getEnd(), replacement };
}

function sanitizeEdit(sf, call) {
  const dirCall = call.arguments[0];
  const idExpr = call.arguments[1];
  const dirText = dirCall.getText(sf);
  const idText = idExpr.getText(sf);
  const replacement = `safeItemPath(${dirText}, ${idText}.split("/").at(-1) ?? ${idText})`;
  return { start: call.getStart(sf), end: call.getEnd(), replacement };
}

/** Locates the nth (1-based) matching call and returns its edit(s) — a
 *  single-element list for an ordinary site, or one element per site for a
 *  mutated-as-a-pair site (retro.ts's opera+decisions calls in the same
 *  function, W-047's own judgment call: they're tested by one shared
 *  early-return guard and can never be observed independently). */
function siteEdits(file, fn, dirs, kind, textByFile) {
  const abs = join(REPO_ROOT, file);
  const text = textByFile.get(file) ?? readFileSync(abs, "utf8");
  textByFile.set(file, text);
  const edits = [];
  for (const dir of dirs) {
    const { sf, calls } = locateCalls(text, abs, fn, dir);
    if (calls.length !== 1)
      throw new AnchorError(
        `${file}: expected exactly 1 safeItemPath call in ${fn} with dir "${dir}", found ${calls.length}`,
      );
    edits.push(kind === "raw-join" ? rawJoinEdit(sf, calls[0]) : sanitizeEdit(sf, calls[0]));
  }
  return { file, edits };
}

// ---------------------------------------------------------------------------
// Contract-group (behaviour 1) mutants: body replacements inside
// safeItemPath itself, packages/commands/src/writes.ts.
// ---------------------------------------------------------------------------

const WRITES_TS = "packages/commands/src/writes.ts";

function contractEdit(kind) {
  const abs = join(REPO_ROOT, WRITES_TS);
  const text = readFileSync(abs, "utf8");
  const sf = parseFile(abs, text);
  const fn = findFunctionDeclaration(sf, "safeItemPath");
  if (!fn || !fn.body) throw new AnchorError(`${WRITES_TS}: safeItemPath function declaration not found`);
  const ifs = ifStatementsIn(fn.body);
  if (ifs.length !== 2)
    throw new AnchorError(`${WRITES_TS}: expected exactly 2 if-statements in safeItemPath, found ${ifs.length}`);
  const [shapeIf, dirnameIf] = ifs;
  const disable = (ifStmt) => ({
    start: ifStmt.expression.getStart(sf),
    end: ifStmt.expression.getEnd(),
    replacement: "false",
  });
  if (kind === "mA") return { file: WRITES_TS, edits: [disable(shapeIf)] };
  if (kind === "mB") return { file: WRITES_TS, edits: [disable(shapeIf), disable(dirnameIf)] };
  if (kind === "mD") return { file: WRITES_TS, edits: [disable(dirnameIf)] };
  if (kind === "mC") {
    const sanitizedBody =
      "{\n" +
      '  const cleaned = id.replace(/[\\\\/]/g, "").replace(/^\\.+$/, "");\n' +
      "  const resolvedDir = resolve(dir);\n" +
      '  const path = join(resolvedDir, `${cleaned || "_"}.md`);\n' +
      "  return path;\n" +
      "}";
    return {
      file: WRITES_TS,
      edits: [{ start: fn.body.getStart(sf), end: fn.body.getEnd(), replacement: sanitizedBody }],
    };
  }
  throw new Error(`unknown contract mutant kind ${kind}`);
}

// ---------------------------------------------------------------------------
// Census-group (behaviour 4) mutants: insertions/reformats over real source
// files, re-run through containment.test.ts (never edited itself).
// ---------------------------------------------------------------------------

function censusInsertHelperCallEdit() {
  // mE: a fifteenth safeItemPath call, in a newly inserted function, in an
  // EXISTING file that already declares/imports the helper.
  const abs = join(REPO_ROOT, WRITES_TS);
  const text = readFileSync(abs, "utf8");
  const insertion =
    "\nexport function __w047MutantProbeE(dir: string, probeOpusId: string): string | { error: string } {\n  return safeItemPath(dir, probeOpusId);\n}\n";
  return { file: WRITES_TS, edits: [{ start: text.length, end: text.length, replacement: insertion }] };
}

function censusInsertRawJoinEdit() {
  // mF: a new raw `${...Id}.md` join, in a different existing file, never
  // routed through the helper.
  const file = "packages/cli/src/close.ts";
  const abs = join(REPO_ROOT, file);
  const text = readFileSync(abs, "utf8");
  const insertion =
    "\nexport function __w047MutantProbeF(dir: string, probeOpusId: string): string {\n  return `${dir}/${probeOpusId}.md`;\n}\n";
  return { file, edits: [{ start: text.length, end: text.length, replacement: insertion }] };
}

function censusReformatEdit() {
  // mG: an existing call, reformatted across two lines — no line numbers are
  // pinned anywhere, so this must leave both inventories unchanged.
  const abs = join(REPO_ROOT, WRITES_TS);
  const text = readFileSync(abs, "utf8");
  const { sf, calls } = locateCalls(text, abs, "runHandoff", "opera");
  if (calls.length !== 1)
    throw new AnchorError(`${WRITES_TS}: expected exactly 1 safeItemPath call in runHandoff, found ${calls.length}`);
  const call = calls[0];
  const original = call.getText(sf);
  const reformatted = original.replace(", opusId)", ",\n    opusId,\n  )");
  if (reformatted === original) throw new AnchorError(`${WRITES_TS}: reformat anchor not found in ${original}`);
  return { file: WRITES_TS, edits: [{ start: call.getStart(sf), end: call.getEnd(), replacement: reformatted }] };
}

// ---------------------------------------------------------------------------
// Test commands.
// ---------------------------------------------------------------------------

const NODE = process.execPath;
const WRITES_CMD = { cmd: NODE, args: ["--import", "tsx", "packages/cli/src/writes.test.ts", "."], env: {} };
const CONTAINMENT_CMD = { cmd: NODE, args: ["--import", "tsx", "packages/cli/src/containment.test.ts", "."], env: {} };
const LIFECYCLE_B45_CMD = {
  cmd: NODE,
  args: ["--import", "tsx", "packages/cli/src/lifecycle.test.ts", "."],
  env: { BISELLIUM_ONLY_BEHAVIOUR: "45" },
};
// Legacy sites 9, 10, 11 are exercised by lifecycle.test.ts blocks 19
// (behaviour 2, halt refusals — sites 9 and 10) and 33 (behaviour 3, done's
// human-gate refusals — site 11, via `waived_by`). NOTE (deviation from
// studio/briefs/W-047.md's Groups table, reported per the brief's own rule
// that the scan's answer is authoritative over its table): the brief names
// block 44 as the third block here, but block 44 ("red-sella-record") tests
// `red`'s sella-fallback behaviour and never calls halt/done/waive at all —
// it cannot exercise site 11. The brief's own Intent section cites line
// :1717, which is inside block 36 ("waive-refuse"), not 44 — the same
// `../D-777` sentinel through `waive --decision` that Intent names as one of
// the two places sites 9-11 "bite". Block 36 is used here instead.
const LIFECYCLE_LEGACY_CMD = {
  cmd: NODE,
  args: ["--import", "tsx", "packages/cli/src/lifecycle.test.ts", "."],
  env: { BISELLIUM_ONLY_BEHAVIOUR: "19,33,36" },
};
const RETRO_CMD = { cmd: NODE, args: ["--import", "tsx", "packages/cli/src/retro.test.ts", "."], env: {} };

function cmdKey(c) {
  return JSON.stringify([c.args, c.env]);
}

function runCmd(c) {
  const res = spawnSync(c.cmd, c.args, { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, ...c.env } });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  const output = stderr ? `${stdout}\n[stderr]\n${stderr}` : stdout;
  const failLines = output.split("\n").filter((l) => /^FAIL/.test(l));
  return { exitCode: res.status ?? 1, output, failLines };
}

// ---------------------------------------------------------------------------
// The mutant catalogue.
// ---------------------------------------------------------------------------

function site(label, file, fn, dirs, kind, expect, kills, testCmd) {
  return { label, file, fn, dirs, kind, expect, kills, testCmd };
}

// All three of mA/mB/mC make the empty-id row (`safeItemPath(base, "")`,
// expected refused) wrongly succeed — mA and mB by disabling the guard that
// refuses it, mC by laundering it into "_" instead of refusing it — so all
// three share this kill label alongside whichever other rows they also
// break.
const EMPTY_ID_KILL = ['1. safeItemPath("")'];
const CONTRACT_MUTANTS = [
  {
    label: "mA no-shape-guard",
    kind: "mA",
    expect: "dead",
    kills: EMPTY_ID_KILL,
    group: "contract",
    testCmd: WRITES_CMD,
    edits: () => [contractEdit("mA")],
  },
  {
    label: "mB no-guard",
    kind: "mB",
    expect: "dead",
    kills: EMPTY_ID_KILL,
    group: "contract",
    testCmd: WRITES_CMD,
    edits: () => [contractEdit("mB")],
  },
  {
    label: "mC sanitize-in-helper",
    kind: "mC",
    expect: "dead",
    kills: EMPTY_ID_KILL,
    group: "contract",
    testCmd: WRITES_CMD,
    edits: () => [contractEdit("mC")],
  },
  {
    label: "mD no-dirname-check",
    kind: "mD",
    expect: "alive",
    kills: [],
    group: "contract",
    testCmd: WRITES_CMD,
    edits: () => [contractEdit("mD")],
  },
];

const WRITES_SITES = [
  site("row1 handoff", WRITES_TS, "runHandoff", ["opera"], null, "dead", ["row1 handoff"], WRITES_CMD),
  site("row2 emit-usage", WRITES_TS, "runEmit", ["opera"], null, "dead", ["row2 emit-usage"], WRITES_CMD),
  site(
    "row3 answer-petitio",
    WRITES_TS,
    "runAnswer",
    ["petitiones"],
    null,
    "dead",
    ["row3 answer-petitio"],
    WRITES_CMD,
  ),
  site("row4 answer-opus", WRITES_TS, "runAnswer", ["opera"], null, "dead", ["row4 answer-opus"], WRITES_CMD),
  site("row5 greenlight", WRITES_TS, "runGreenlight", ["opera"], null, "dead", ["row5 greenlight"], WRITES_CMD),
];

const LIFECYCLE_TS = "packages/commands/src/lifecycle.ts";
const LIFECYCLE_SITES = [
  site("row6 ready", LIFECYCLE_TS, "runReady", ["opera"], null, "dead", ["row6 ready"], LIFECYCLE_B45_CMD),
  site("row7 done", LIFECYCLE_TS, "runDone", ["opera"], null, "dead", ["row7 done"], LIFECYCLE_B45_CMD),
  site("row8 review", LIFECYCLE_TS, "runReview", ["opera"], null, "dead", ["row8 review"], LIFECYCLE_B45_CMD),
  site("row9 waive", LIFECYCLE_TS, "runWaive", ["opera"], null, "dead", ["row9 waive"], LIFECYCLE_B45_CMD),
];

const RETRO_TS = "packages/cli/src/retro.ts";
// Legacy sites 9, 10, 11, and the 13+14 pair — each already has a
// traversal case (pre-dating W-047) whose target exists, which is what
// makes a raw-join mutant observable at all; none has an in-directory
// collision record, which is the recorded gap a sanitize mutant exposes.
const LEGACY_SITES = [
  {
    name: "site9 runHalt:opera",
    file: LIFECYCLE_TS,
    fn: "runHalt",
    dirs: ["opera"],
    testCmd: LIFECYCLE_LEGACY_CMD,
    deadKills: ["opus id ../petitiones/A-1"],
  },
  {
    name: "site10 runHalt:decisions",
    file: LIFECYCLE_TS,
    fn: "runHalt",
    dirs: ["decisions"],
    testCmd: LIFECYCLE_LEGACY_CMD,
    deadKills: ["--decision of ../leges/qa"],
  },
  {
    name: "site11 patronDecisionProblem:decisions",
    file: LIFECYCLE_TS,
    fn: "patronDecisionProblem",
    dirs: ["decisions"],
    testCmd: LIFECYCLE_LEGACY_CMD,
    deadKills: ["waived_by containment sentinel"],
  },
  {
    name: "site13+14 classifyAddressedTarget (pair)",
    file: RETRO_TS,
    fn: "classifyAddressedTarget",
    dirs: ["opera", "decisions"],
    testCmd: RETRO_CMD,
    deadKills: ["path-traversal addressed_by"],
  },
];

function buildLegacyMutants() {
  const mutants = [];
  for (const s of LEGACY_SITES) {
    mutants.push({
      label: `${s.name} raw-join`,
      group: "legacy",
      expect: "dead",
      kills: s.deadKills,
      testCmd: s.testCmd,
      edits: (textByFile) => [siteEdits(s.file, s.fn, s.dirs, "raw-join", textByFile)],
    });
    mutants.push({
      label: `${s.name} sanitize`,
      group: "legacy",
      expect: "alive",
      kills: [],
      testCmd: s.testCmd,
      edits: (textByFile) => [siteEdits(s.file, s.fn, s.dirs, "sanitize", textByFile)],
    });
  }
  return mutants;
}

function buildSiteMutants(sites, kind) {
  const label = kind === "raw-join" ? "raw-join" : "sanitize";
  return sites.map((s) => ({
    label: `${s.label} ${label}`,
    group: s.file === LIFECYCLE_TS ? "lifecycle" : "writes",
    expect: s.expect,
    kills: s.kills,
    testCmd: s.testCmd,
    edits: (textByFile) => [siteEdits(s.file, s.fn, s.dirs, kind, textByFile)],
  }));
}

const CENSUS_MUTANTS = [
  {
    label: "mE new helper call site",
    group: "census",
    expect: "dead",
    kills: ["inventory A"],
    testCmd: CONTAINMENT_CMD,
    edits: () => [censusInsertHelperCallEdit()],
  },
  {
    label: "mF new raw id join",
    group: "census",
    expect: "dead",
    kills: ["inventory B"],
    testCmd: CONTAINMENT_CMD,
    edits: () => [censusInsertRawJoinEdit()],
  },
  {
    label: "mG reformat across two lines",
    group: "census",
    expect: "alive",
    kills: [],
    testCmd: CONTAINMENT_CMD,
    edits: () => [censusReformatEdit()],
  },
];

function allMutants() {
  return [
    ...CONTRACT_MUTANTS,
    ...buildSiteMutants(WRITES_SITES, "raw-join"),
    ...buildSiteMutants(WRITES_SITES, "sanitize"),
    ...buildSiteMutants(LIFECYCLE_SITES, "raw-join"),
    ...buildSiteMutants(LIFECYCLE_SITES, "sanitize"),
    ...CENSUS_MUTANTS,
    ...buildLegacyMutants(),
  ];
}

const GROUPS = {
  contract: () => CONTRACT_MUTANTS,
  writes: () => [...buildSiteMutants(WRITES_SITES, "raw-join"), ...buildSiteMutants(WRITES_SITES, "sanitize")],
  lifecycle: () => [...buildSiteMutants(LIFECYCLE_SITES, "raw-join"), ...buildSiteMutants(LIFECYCLE_SITES, "sanitize")],
  census: () => CENSUS_MUTANTS,
  legacy: () => buildLegacyMutants(),
  all: () => allMutants(),
};

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

function usageExit(msg) {
  if (msg) console.error(msg);
  console.error("usage: node scripts/safe-item-path-mutants.mjs <contract|writes|lifecycle|census|legacy|all>");
  process.exit(2);
}

const group = process.argv[2];
if (!group || !(group in GROUPS)) usageExit(group ? `unknown group "${group}"` : "missing <group>");

const mutants = GROUPS[group]();
if (mutants.length === 0) {
  console.error(`group "${group}" selected zero mutants`);
  process.exit(2);
}

// Baseline: every distinct test command used by the selected mutants must
// run clean before any mutation. A red recorded against an already-red
// suite proves nothing.
const seenCmds = new Map();
for (const m of mutants) if (!seenCmds.has(cmdKey(m.testCmd))) seenCmds.set(cmdKey(m.testCmd), m.testCmd);

let baselineFailed = false;
for (const cmd of seenCmds.values()) {
  const label = [
    ...cmd.args,
    ...(cmd.env.BISELLIUM_ONLY_BEHAVIOUR ? [`BISELLIUM_ONLY_BEHAVIOUR=${cmd.env.BISELLIUM_ONLY_BEHAVIOUR}`] : []),
  ].join(" ");
  const r = runCmd(cmd);
  const clean = r.exitCode === 0 && r.failLines.length === 0;
  console.log(
    `baseline: ${clean ? "0 FAIL" : `NOT CLEAN (exit ${r.exitCode}, ${r.failLines.length} FAIL)`} — ${label}`,
  );
  if (!clean) {
    console.log(r.output);
    baselineFailed = true;
  }
}
if (baselineFailed) {
  console.error("baseline not green — no mutant runs");
  process.exit(3);
}

let deadCount = 0;
let aliveCount = 0;
const mismatches = [];

for (const m of mutants) {
  console.log(`\n=== mutant: ${m.label} (expect: ${m.expect}) ===`);

  const textByFile = new Map();
  let editsByFile;
  try {
    editsByFile = m.edits(textByFile);
  } catch (e) {
    if (e instanceof AnchorError) {
      console.error(`anchor error: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }

  // Snapshot originals (edits() may have already populated textByFile for
  // some files; make sure every touched file's original bytes are on hand).
  const originals = new Map();
  for (const { file } of editsByFile) {
    if (!originals.has(file)) originals.set(file, textByFile.get(file) ?? readFileSync(join(REPO_ROOT, file), "utf8"));
  }

  let result;
  try {
    for (const { file, edits } of editsByFile) {
      const original = originals.get(file);
      const mutated = applyEdits(original, edits);
      writeFileSync(join(REPO_ROOT, file), mutated);
    }
    result = runCmd(m.testCmd);
  } finally {
    for (const file of originals.keys()) writeFileSync(join(REPO_ROOT, file), originals.get(file));
    for (const file of originals.keys()) {
      const restored = readFileSync(join(REPO_ROOT, file), "utf8");
      if (restored !== originals.get(file)) {
        console.error(`restore failed: ${file} is not byte-identical to its original`);
        process.exit(3);
      }
    }
  }

  // A mutant is dead iff the run exited non-zero AND every one of its
  // `kills` labels appears on a `^FAIL` line — exit code alone proves
  // nothing (an unrelated pre-existing failure would "kill" every mutant in
  // the run). For an `expect: alive` mutant, `kills` is empty by rule, so
  // this reduces to "the run stayed green" — any nonzero exit at all,
  // whatever the cause, means it did not match.
  const killsSeen = m.kills.map((k) => ({ label: k, seen: result.failLines.some((l) => l.includes(k)) }));
  const allKillsSeen = killsSeen.every((k) => k.seen);
  const died = result.exitCode !== 0 && allKillsSeen;
  const matched = m.expect === "dead" ? died : !died;

  console.log(
    `resolved: file(s)=${editsByFile.map((e) => e.file).join(",")} exit=${result.exitCode} FAIL-count=${result.failLines.length}`,
  );
  for (const k of killsSeen) console.log(`kills[${JSON.stringify(k.label)}]: ${k.seen ? "seen" : "NOT seen"}`);
  // Printed verbatim, never indented: these are the red's assertion-level
  // content, and the acceptance gate greps the log for `^FAIL` lines — an
  // indented copy would never match.
  for (const line of result.failLines) console.log(line);

  if (matched) {
    if (m.expect === "dead") deadCount++;
    else aliveCount++;
    console.log(`-> matched (${m.expect})`);
  } else {
    console.log(`-> DID NOT MATCH (expected ${m.expect}, got ${died ? "dead" : "alive"})`);
    mismatches.push(m.label);
  }
}

const total = mutants.length;
if (mismatches.length === 0) {
  console.log(`\nall ${total} mutants matched (${deadCount} dead, ${aliveCount} alive)`);
  process.exit(1);
} else {
  console.log(`\n${mismatches.length} of ${total} mutants did NOT match: ${mismatches.join(", ")}`);
  process.exit(0);
}
