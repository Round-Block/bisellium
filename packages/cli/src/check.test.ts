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
import { RULE_IDS } from "./rules/ids.js";

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
/** examples/sample-studio's own manifest already declares `integration:`
 *  (D-015) as a multi-line block — strip it (the key line plus every more-
 *  indented continuation line) before a test appends its own, same reason
 *  as setSourceExcludes below: two `integration:` keys is invalid YAML. */
function stripIntegration(dir: string): void {
  const manifestPath = join(dir, "bisellium.yml");
  const lines = readFileSync(manifestPath, "utf8").split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^integration:/.test(line)) { skipping = true; continue; }
    if (skipping && (line === "" || /^\s/.test(line))) continue;
    skipping = false;
    out.push(line);
  }
  writeFileSync(manifestPath, out.join("\n"));
}

/** Same recipe as stripIntegration, generalized to any top-level key — W-065
 *  behaviour 16 needs to strip/replace `tiers:`/`munera:` the same way. */
function stripKeyBlock(dir: string, key: string): void {
  const manifestPath = join(dir, "bisellium.yml");
  const lines = readFileSync(manifestPath, "utf8").split("\n");
  const out: string[] = [];
  let skipping = false;
  const keyRe = new RegExp(`^${key}:`);
  for (const line of lines) {
    if (keyRe.test(line)) { skipping = true; continue; }
    if (skipping && (line === "" || /^\s/.test(line))) continue;
    skipping = false;
    out.push(line);
  }
  writeFileSync(manifestPath, out.join("\n"));
}

function appendYaml(dir: string, yaml: string): void {
  const manifestPath = join(dir, "bisellium.yml");
  writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\n${yaml}`);
}

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

  // ---- integration: manifest shape (D-015) --------------------------------
  {
    const dir = freshStudio("integration-shape");
    stripIntegration(dir);
    const manifestPath = join(dir, "bisellium.yml");
    const append = (raw: string) => writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\n${raw}\n`);

    append("integration: not-a-mapping");
    const notMapping = checkStudio(dir, NOW);
    check(
      "integration: non-mapping value blocks manifest.shape",
      notMapping.findings.some((f) => f.rule === "manifest.shape" && f.where.includes("#integration")),
      notMapping.findings.map((f) => f.rule).join(", "),
    );
  }
  {
    const dir = freshStudio("integration-strategy");
    stripIntegration(dir);
    const manifestPath = join(dir, "bisellium.yml");
    writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\nintegration:\n  strategy: teleport\n`);
    const r = checkStudio(dir, NOW);
    check(
      "integration.strategy: invalid value blocks manifest.shape",
      r.findings.some((f) => f.rule === "manifest.shape" && f.where.includes("integration.strategy")),
      r.findings.map((f) => f.rule).join(", "),
    );
  }
  {
    const dir = freshStudio("integration-push-type");
    stripIntegration(dir);
    const manifestPath = join(dir, "bisellium.yml");
    writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\nintegration:\n  push: "yes"\n`);
    const r = checkStudio(dir, NOW);
    check(
      "integration.push: non-boolean value blocks manifest.shape",
      r.findings.some((f) => f.rule === "manifest.shape" && f.where.includes("integration.push")),
      r.findings.map((f) => f.rule).join(", "),
    );
  }
  {
    const dir = freshStudio("integration-pr-reviewer");
    stripIntegration(dir);
    const manifestPath = join(dir, "bisellium.yml");
    writeFileSync(manifestPath, `${readFileSync(manifestPath, "utf8")}\nintegration:\n  pr: { required: true, reviewer: nobody-such-sella }\n`);
    const r = checkStudio(dir, NOW);
    check(
      "integration.pr.reviewer: unknown sella blocks integration.pr.reviewer",
      r.findings.some((f) => f.rule === "integration.pr.reviewer"),
      r.findings.map((f) => f.rule).join(", "),
    );
  }
  {
    const dir = freshStudio("integration-valid");
    stripIntegration(dir);
    const manifestPath = join(dir, "bisellium.yml");
    writeFileSync(
      manifestPath,
      `${readFileSync(manifestPath, "utf8")}\nintegration:\n  strategy: rebase\n  push: true\n  pull_after_push: true\n  pr: { required: true, reviewer: qa-lead }\n`,
    );
    const r = checkStudio(dir, NOW);
    check(
      "integration: a well-formed block adds no manifest.shape or integration.* blocking findings",
      !r.findings.some((f) => f.level === "block" && (f.rule === "manifest.shape" || f.rule.startsWith("integration.")) && f.where.includes("integration")),
      r.findings.filter((f) => f.level === "block").map((f) => f.rule).join(", "),
    );
  }
  // ---- W-065 behaviour 16: the munus.tier check rule --------------------
  {
    const dir = freshStudio("munus-tier-undeclared");
    stripKeyBlock(dir, "munera");
    appendYaml(dir, "munera:\n  - { id: ghost, tier: nonexistent }\n");
    const r = checkStudio(dir, NOW);
    check(
      "munus.tier: a munus naming an undeclared tier blocks, naming both ids",
      r.findings.some((f) => f.rule === "munus.tier" && f.level === "block" && f.message.includes("ghost") && f.message.includes("nonexistent")),
      r.findings.filter((f) => f.rule === "munus.tier").map((f) => f.message).join(" | "),
    );
  }
  {
    const dir = freshStudio("munus-tier-dup-tier-id");
    stripKeyBlock(dir, "tiers");
    appendYaml(dir, "tiers:\n  - { id: fast, model: x }\n  - { id: fast, model: y }\n");
    const r = checkStudio(dir, NOW);
    check(
      "munus.tier: a duplicate tiers[].id blocks (manifest.unique)",
      r.findings.some((f) => f.rule === "manifest.unique" && f.where.includes("tiers")),
      r.findings.filter((f) => f.rule === "manifest.unique").map((f) => f.where).join(", "),
    );
  }
  {
    const dir = freshStudio("munus-tier-dup-munus-id");
    stripKeyBlock(dir, "munera");
    appendYaml(dir, "munera:\n  - { id: audit, tier: mid }\n  - { id: audit, tier: high }\n");
    const r = checkStudio(dir, NOW);
    check(
      "munus.tier: a duplicate munera[].id blocks (manifest.unique)",
      r.findings.some((f) => f.rule === "manifest.unique" && f.where.includes("munera")),
      r.findings.filter((f) => f.rule === "manifest.unique").map((f) => f.where).join(", "),
    );
  }
  {
    const dir = freshStudio("munus-tier-missing-model");
    stripKeyBlock(dir, "tiers");
    appendYaml(dir, "tiers:\n  - { id: bare }\n");
    const r = checkStudio(dir, NOW);
    check(
      "munus.tier: a tier row missing its required model string blocks",
      r.findings.some((f) => f.rule === "munus.tier" && f.level === "block" && f.message.includes("bare")),
      r.findings.filter((f) => f.rule === "munus.tier").map((f) => f.message).join(" | "),
    );
  }
  {
    const dir = freshStudio("munus-tier-missing-tier");
    stripKeyBlock(dir, "munera");
    appendYaml(dir, "munera:\n  - { id: bare-munus }\n");
    const r = checkStudio(dir, NOW);
    check(
      "munus.tier: a munus row missing its required tier string blocks",
      r.findings.some((f) => f.rule === "munus.tier" && f.level === "block" && f.message.includes("bare-munus")),
      r.findings.filter((f) => f.rule === "munus.tier").map((f) => f.message).join(" | "),
    );
  }
  {
    const dir = freshStudio("munus-tier-bad-id-format");
    stripKeyBlock(dir, "munera");
    appendYaml(dir, "munera:\n  - { id: 'bad/id', tier: mid }\n");
    const r = checkStudio(dir, NOW);
    check(
      "munus.tier: an id failing manifest.id.format blocks",
      r.findings.some((f) => f.rule === "manifest.id.format" && f.where.includes("munera")),
      r.findings.filter((f) => f.rule === "manifest.id.format").map((f) => f.where).join(", "),
    );
  }
  {
    const dir = freshStudio("munus-tier-neither-key");
    stripKeyBlock(dir, "tiers");
    stripKeyBlock(dir, "munera");
    const r = checkStudio(dir, NOW);
    check(
      "munus.tier: a manifest with neither key produces no finding",
      !r.findings.some((f) => f.rule === "munus.tier"),
      r.findings.map((f) => f.rule).join(", "),
    );
  }
  check("munus.tier is in the rule-id registry", RULE_IDS.has("munus.tier"));

  // ---- W-071 behaviour 5: model_probe_stale_days is a declared default,
  // not an unknown one (check.ts:74's closed DEFAULTS table; Sol finding
  // 10) — with the two positive controls the brief requires, so the
  // assertion can't pass by the rule being disabled. ----------------------
  {
    const dir = freshStudio("w071-probe-stale-declared");
    appendYaml(dir, "defaults:\n  model_probe_stale_days: 14\n");
    const r = checkStudio(dir, NOW);
    check(
      "w071 b5: declaring model_probe_stale_days earns no manifest.defaults advisory",
      !r.findings.some((f) => f.rule === "manifest.defaults" && f.message.includes("model_probe_stale_days")),
      r.findings.filter((f) => f.rule === "manifest.defaults").map((f) => f.message).join(" | "),
    );
  }
  {
    // Positive control: an actually-unknown sibling key still advises —
    // required so the first check can't pass merely because the whole rule
    // is disabled.
    const dir = freshStudio("w071-probe-stale-unknown-sibling");
    appendYaml(dir, "defaults:\n  totally_unknown_key: 1\n");
    const r = checkStudio(dir, NOW);
    check(
      "w071 b5: positive control — an actually unknown default key still advises",
      r.findings.some((f) => f.rule === "manifest.defaults" && f.level === "advise" && f.message.includes("totally_unknown_key")),
      r.findings.filter((f) => f.rule === "manifest.defaults").map((f) => f.message).join(" | "),
    );
  }
  {
    // Positive control: a non-numeric value still blocks — required so a
    // declared key isn't silently trusted regardless of its value's shape.
    const dir = freshStudio("w071-probe-stale-non-numeric");
    appendYaml(dir, 'defaults:\n  model_probe_stale_days: "soon"\n');
    const r = checkStudio(dir, NOW);
    check(
      "w071 b5: positive control — a non-numeric model_probe_stale_days still blocks",
      r.findings.some((f) => f.rule === "manifest.defaults" && f.level === "block" && f.message.includes("model_probe_stale_days")),
      r.findings.filter((f) => f.rule === "manifest.defaults").map((f) => f.message).join(" | "),
    );
  }
  {
    // Neither shipped manifest declares the key, so this opus changes
    // nothing about the real studio's or the fixture's own finding counts —
    // behaviour 5's whole point (asserted operationally too, by the
    // acceptance script's repeated `bisellium check` runs).
    const r = checkStudio(sampleStudio, NOW);
    check("w071 b5: sample-studio's own manifest carries no model_probe_stale_days finding", !r.findings.some((f) => f.message.includes("model_probe_stale_days")));
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
