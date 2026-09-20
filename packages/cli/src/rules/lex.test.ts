/**
 * packages/cli/src/rules/lex.test.ts — W-035: `bulletClauses` continuation
 * folding (behaviours 1-3), `lex.marker_unknown` (behaviours 4-6) and the
 * `RULE_IDS` drift guard (behaviour 7). Pure-function / fixture-officina
 * style, modelled on rules/process.test.ts's local `check()` — no
 * framework, exit code off `failed`.
 *
 * The drift guard (behaviour 7) resolves its source paths from
 * `import.meta.url`, never `process.argv[2]` — a worktree's cwd is not the
 * repo root.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bulletClauses, checkLex } from "./lex.js";
import { RULE_IDS } from "./ids.js";

// behaviour 7's harvest: the same two shapes checkStudio actually uses,
// `add("id", ...)` and `{ rule: "id", ... }`, over check.ts plus every
// rules/*.ts — excluding ids.ts itself (else a stale literal in the
// registry would satisfy the guard against itself) and every *.test.ts.
// Paths resolve off import.meta.url, not process.argv[2]/cwd — a
// worktree's cwd is not the repo root.
const HARVEST_RE = /(?<![.\w])add\(\s*"([a-z][A-Za-z0-9._-]*)"|rule:\s*"([a-z][A-Za-z0-9._-]*)"/g;
function harvestRuleIds(): Set<string> {
  const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/src/rules
  const srcDir = dirname(here); // packages/cli/src
  const files = [join(srcDir, "check.ts")];
  for (const f of readdirSync(here)) {
    if (f === "ids.ts" || f.endsWith(".test.ts") || !f.endsWith(".ts")) continue;
    files.push(join(here, f));
  }
  const ids = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(HARVEST_RE)) ids.add((m[1] ?? m[2])!);
  }
  return ids;
}

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

const dirs: string[] = [];
function freshOfficina(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-lex-${tag}-`));
  dirs.push(dir);
  writeFileSync(join(dir, "bisellium.yml"), "bisellium: 1\nstudio: fixture\ncollegia: []\nsellae: []\nprobationes: []\n");
  mkdirSync(join(dir, "leges"), { recursive: true });
  return dir;
}

function writeLex(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, "leges", name), body);
}

try {
  // behaviour 1: a wrapped bullet folds; a marker on the continuation line is found
  {
    const body = ["- A clause whose marker is wrapped onto the next line", "  (check: some.rule)"].join("\n");
    const clauses = bulletClauses(body);
    check(
      1,
      "bulletClauses folds a wrapped bullet and the marker is found on the joined clause",
      clauses.length === 1 && /\(check:\s*some\.rule\)\s*$/.test(clauses[0] ?? ""),
      JSON.stringify(clauses),
    );
  }

  // behaviour 2: folding stops at the next bullet and at a blank line
  {
    const body = ["- clause A", "  still clause A", "- clause B starts immediately, not folded into A", "", "- clause C"].join("\n");
    const clauses = bulletClauses(body);
    check(
      2,
      "bulletClauses does not fold across a following bullet or a blank line",
      clauses.length === 3 &&
        clauses[0] === "- clause A still clause A" &&
        clauses[1] === "- clause B starts immediately, not folded into A" &&
        clauses[2] === "- clause C",
      JSON.stringify(clauses),
    );
  }

  // behaviour 3: lex.unchecked's count drops for a lex whose only unchecked
  // clauses were wrapped — before the fix, a wrapped marker is invisible and
  // the clause is overcounted as unchecked.
  {
    const dir = freshOfficina("wrapped-unchecked");
    writeLex(
      dir,
      "fixture.md",
      [
        "# Fixture Lex",
        "",
        "Magister: `x` · Adopted: 2026-09-01 · Amended: see §9",
        "",
        "## 2. Decides alone",
        "",
        "- A clause whose marker is wrapped onto the next line",
        "  (check: some.rule)",
        "",
        "## 3. Digests",
        "",
        "- nothing (check: some.rule)",
        "",
        "## 4. Asks",
        "",
        "- Another wrapped clause continuing here",
        "  and still continuing",
        "  (check: another.rule)",
        "",
      ].join("\n"),
    );
    const findings = checkLex(dir, { now: new Date("2026-09-20T00:00:00Z") });
    const unchecked = findings.filter((f) => f.rule === "lex.unchecked");
    check(
      3,
      "lex.unchecked is silent for a lex whose only unchecked clauses were wrapped markers",
      unchecked.length === 0,
      JSON.stringify(findings),
    );
  }
  // behaviour 4: advises once for a lex citing an absent id, naming that id
  {
    const dir = freshOfficina("marker-unknown-one");
    writeLex(dir, "fixture.md", ["# Fixture Lex", "", "## 2. Decides alone", "", "- A clause with a bogus id (check: nonexistent.rule)", ""].join("\n"));
    const findings = checkLex(dir, { now: new Date("2026-09-20T00:00:00Z") });
    const unknown = findings.filter((f) => f.rule === "lex.marker_unknown");
    check(
      4,
      "lex.marker_unknown advises once for a lex citing an absent id, naming that id",
      unknown.length === 1 && unknown[0]!.level === "advise" && unknown[0]!.message.includes("nonexistent.rule"),
      JSON.stringify(findings),
    );
  }

  // behaviour 5: silent when every marker names a real id
  {
    const dir = freshOfficina("marker-known");
    writeLex(dir, "fixture.md", ["# Fixture Lex", "", "## 2. Decides alone", "", "- A clause with a real id (check: decision.kill)", ""].join("\n"));
    const findings = checkLex(dir, { now: new Date("2026-09-20T00:00:00Z") });
    check(5, "lex.marker_unknown is silent when every marker names a real id", findings.filter((f) => f.rule === "lex.marker_unknown").length === 0, JSON.stringify(findings));
  }

  // behaviour 6: counts once per lex, not once per clause
  {
    const dir = freshOfficina("marker-unknown-multi");
    writeLex(
      dir,
      "fixture.md",
      ["# Fixture Lex", "", "## 2. Decides alone", "", "- First bogus clause (check: nonexistent.one)", "", "- Second bogus clause (check: nonexistent.two)", ""].join("\n"),
    );
    const findings = checkLex(dir, { now: new Date("2026-09-20T00:00:00Z") });
    const unknown = findings.filter((f) => f.rule === "lex.marker_unknown");
    check(
      6,
      "lex.marker_unknown counts once per lex, not once per clause",
      unknown.length === 1 && unknown[0]!.message.startsWith("2 clause(s)") && unknown[0]!.message.includes("nonexistent.one") && unknown[0]!.message.includes("nonexistent.two"),
      JSON.stringify(findings),
    );
  }

  // behaviour 7: RULE_IDS equals the live harvest of check.ts + rules/*.ts
  {
    const harvested = harvestRuleIds();
    const registered = new Set(RULE_IDS);
    const missingFromRegistry = [...harvested].filter((id) => !registered.has(id)).sort();
    const staleInRegistry = [...registered].filter((id) => !harvested.has(id)).sort();
    check(
      7,
      "RULE_IDS equals the harvest of check.ts + rules/*.ts",
      missingFromRegistry.length === 0 && staleInRegistry.length === 0,
      JSON.stringify({ missingFromRegistry, staleInRegistry }),
    );
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
