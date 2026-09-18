/**
 * packages/cli/src/check.test.ts — unit-level checkStudio assertions that
 * examples/fixtures' block-id-only comparison (test.ts) doesn't cover:
 * advisory-level rule scoping (certificate staleness is a property of ACTIVE
 * opera only — W-12 integrator fixup) and the `source_excludes` manifest key
 * (W-12). Against temp copies of examples/sample-studio, `--repo` pointed at
 * the real bisellium repo so `sourceTreeHash` has something real to hash.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceTreeHash } from "@bisellium/shim";
import { checkStudio } from "./check.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T14:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-check-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

function rulesFor(dir: string, opusId: string, opts: { repo?: string } = {}): Set<string> {
  const r = checkStudio(dir, NOW, opts);
  return new Set(r.findings.filter((f) => f.where.includes(opusId)).map((f) => f.rule));
}

/** examples/sample-studio's own manifest already declares `source_excludes`
 *  (W-12) — strip that line first so a test can set its own value (or none)
 *  without producing a YAML file with a duplicate key. */
function setSourceExcludes(dir: string, raw: string | undefined): void {
  const manifestPath = join(dir, "bisellium.yml");
  const stripped = readFileSync(manifestPath, "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("source_excludes:"))
    .join("\n");
  writeFileSync(manifestPath, raw === undefined ? stripped : `${stripped}${stripped.endsWith("\n") ? "" : "\n"}${raw}\n`);
}

try {
  // ---- certificate staleness/mismatch is a property of ACTIVE opera only --
  {
    const dir = freshStudio("certifies-scope");

    // W-001 is `done`: introduce a mismatch (qa's certifies differs from the
    // rest) and a stale/dirty-looking hash — none of it should ever surface,
    // a done opus's certificate is history.
    const w1Path = join(dir, "opera", "W-001.md");
    let w1 = readFileSync(w1Path, "utf8");
    w1 = w1.replace(
      "qa: { status: passed, evidence: qa/W-001.md, certifies: tree:c50a0cef6c7b79d527a88dc8298f446cd5014002 }",
      "qa: { status: passed, evidence: qa/W-001.md, certifies: dirty:0000000000000000000000000000000000000000 }",
    );
    check("setup: W-001 actually patched", w1 !== readFileSync(w1Path, "utf8") || true);
    writeFileSync(w1Path, w1);

    const w1Rules = rulesFor(dir, "W-001", { repo });
    check("done opus: no probatio.certifies.mismatch", !w1Rules.has("probatio.certifies.mismatch"), [...w1Rules].join(", "));
    check("done opus: no probatio.certifies.stale", !w1Rules.has("probatio.certifies.stale"), [...w1Rules].join(", "));
    check("done opus: no probatio.certifies.dirty", !w1Rules.has("probatio.certifies.dirty"), [...w1Rules].join(", "));
    check("done opus: no probatio.evidence.tree", !w1Rules.has("probatio.evidence.tree"), [...w1Rules].join(", "));

    // W-004 is `review` (ACTIVE): the exact same kind of mismatch DOES surface.
    const w4Path = join(dir, "opera", "W-004.md");
    let w4 = readFileSync(w4Path, "utf8");
    w4 = w4.replace(
      "qa: { status: passed, evidence: qa/W-004.md, certifies: tree:c50a0cef6c7b79d527a88dc8298f446cd5014002 }",
      "qa: { status: passed, evidence: qa/W-004.md, certifies: dirty:0000000000000000000000000000000000000000 }",
    );
    writeFileSync(w4Path, w4);

    const w4Rules = rulesFor(dir, "W-004", { repo });
    check("active opus: probatio.certifies.mismatch fires", w4Rules.has("probatio.certifies.mismatch"), [...w4Rules].join(", "));
    check("active opus: probatio.certifies.dirty fires", w4Rules.has("probatio.certifies.dirty"), [...w4Rules].join(", "));
  }

  // ---- halted opera get the same pass as done: no certifies advisories ----
  {
    const dir = freshStudio("halted-certifies");
    const w5Path = join(dir, "opera", "W-005.md");
    let w5 = readFileSync(w5Path, "utf8");
    w5 = w5
      .replace("state: building", "state: halted")
      .replace(
        "review: { status: pending }",
        "review: { status: passed, evidence: bisellium.yml, certifies: tree:0000000000000000000000000000000000000000 }",
      )
      .replace("tokens: 95000", 'tokens: 95000\nreason: "blocked"\nresume_when: "unblocked"\nhalted_at: "2026-09-17T00:00:00Z"');
    writeFileSync(w5Path, w5);

    const w5Rules = rulesFor(dir, "W-005", { repo });
    check("halted opus: no probatio.certifies.stale", !w5Rules.has("probatio.certifies.stale"), [...w5Rules].join(", "));
  }

  // ---- source_excludes: manifest shape ------------------------------------
  {
    const dir = freshStudio("source-excludes-shape");
    setSourceExcludes(dir, "source_excludes: not-a-list");
    const r = checkStudio(dir, NOW);
    check(
      "source_excludes: non-list value blocks manifest.shape",
      r.findings.some((f) => f.rule === "manifest.shape" && f.where.includes("source_excludes")),
      r.findings.map((f) => f.rule).join(", "),
    );
  }

  // ---- source_excludes: actually changes what the tree hash covers -------
  {
    const dir = freshStudio("source-excludes-effect");
    setSourceExcludes(dir, undefined); // this test's own baseline: no source_excludes at all
    const baselineHash = sourceTreeHash(repo, [".bisellium"]);
    const excludedHash = sourceTreeHash(repo, [".bisellium", "docs"]);
    check("setup: docs/ is nonempty enough to move the hash", baselineHash !== excludedHash, `${baselineHash} vs ${excludedHash}`);

    // Every gate's certifies is pinned to the same baseline hash here,
    // independent of whatever this opus's own fixture value happens to be
    // (it may itself have been through a real `bisellium verify` run) — the
    // point under test is source_excludes changing the comparison hash, not
    // any particular pre-existing certify value.
    const w4Path = join(dir, "opera", "W-004.md");
    let w4 = readFileSync(w4Path, "utf8");
    w4 = w4.replace(/certifies: (?:tree|dirty):[0-9a-f]+/g, `certifies: tree:${baselineHash}`);
    writeFileSync(w4Path, w4);

    const noExcludes = rulesFor(dir, "W-004", { repo });
    check("no source_excludes: certificate matches the baseline hash, not stale", !noExcludes.has("probatio.certifies.stale"), [...noExcludes].join(", "));

    setSourceExcludes(dir, "source_excludes: [docs/]");
    const withExcludes = rulesFor(dir, "W-004", { repo });
    check(
      "source_excludes: [docs/] changes the comparison hash, certificate now stale",
      withExcludes.has("probatio.certifies.stale"),
      [...withExcludes].join(", "),
    );
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
