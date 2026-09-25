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
import { deriveSubject, snapshotDir } from "@bisellium/adapter-native";
import { checkStudio } from "./check.js";
import { RULE_IDS } from "./rules/ids.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const realStudio = resolve(repo, "studio");
const NOW = new Date("2026-09-18T14:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

// W-076 behaviours 1/2/4/5 — same "repo positional, behaviour positional"
// convention as apps/web/src/lib/*.test.ts and packages/commands/src/
// delegate.test.ts, so `bisellium red` can isolate one behaviour's output
// in a file this large without disturbing the checks above.
const onlyBehaviour = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
const checkB = (behaviour: number, name: string, ok: boolean, detail = "") => {
  if (onlyBehaviour !== undefined && onlyBehaviour !== behaviour) return;
  check(`[W-076 b${behaviour}] ${name}`, ok, detail);
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

  // =====================================================================
  // W-076 — the inbox carries a subject and a body (studio/briefs/W-076.md)
  // =====================================================================

  // ---- behaviour 1: the derivation, pinned output by output against all
  // twelve real petitiones on disk (studio/petitiones/*.md) — read, never
  // written. The reference run (studio/briefs/W-076.md's "reference run"
  // table) is reproduced here as the pinned expectation for each id. ----
  {
    // [id, expected subject] — computed by running the derivation exactly
    // as specified (first paragraph, unwrap, strip markdown, cap at 120
    // total incl. ellipsis) over each file's real body. P-010's unwrapped
    // first paragraph is 197 characters, well over the cap, and the word
    // "gap" ends exactly at the 119-character text boundary (its trailing
    // space sits AT index 119) — censor round 1, F1: the cap's last-space
    // search must cover the full 120-char window, not LIMIT-1, or that
    // trailing word is discarded whole. Fixed in deriveSubject; P-010's pin
    // below is the corrected 119-chars-plus-ellipsis value the brief names.
    const PINNED: [string, string][] = [
      ["P-001", "Retrospectio 4b (acta/2026-09-18-retro-4b.md) found six failure classes recurring across two or more cascades. Four of…"],
      ["P-002", "Choose a licence"],
      ["P-003", "Recurring finding class \"review×evidence-backfilled-or-absent\" (cascade 5 retro). Proposing a blocking rule or lex…"],
      ["P-004", "W-021's insurance clause (P-001 items 2-4, adopted verbatim): build path.id.unvalidated and path.escapes.officina, run…"],
      ["P-005", "Recurring finding class \"review×evidence-backfilled-or-absent\" (cascade 6 retro). Proposing a blocking rule or lex…"],
      ["P-007", "Recurring finding class \"review×path-traversal-from-ids\" (cascade 6 retro). Proposing a blocking rule or lex amendment…"],
      ["P-008", "process.cascade advises whenever one sella signs both the spec and review gates of an opus. The QA lex (§1) has the…"],
      ["P-009", "Proposed amendment to the QA lex (studio/leges/qa.md), granting the Censor the improvement-tracking obligation decreed…"],
      ["P-010", "Proposed amendment to the production lex (studio/leges/production.md). No opus: — this proposes law, not work. (The gap…"],
      ["P-011", "docs/research/agent-studio-landscape-2026-09-21.md (\"Proposed Bisellium direction\") proposes: for the first playable…"],
      ["P-012", "A check rule for red provenance: bisellium red records a working-tree identity, and a rule verifies it — superseding…"],
      ["P-013", "W-064's red gate: D-024's kill arm has fired, and only you can rule."],
    ];
    checkB(1, "pins exactly twelve real petitiones", PINNED.length === 12, String(PINNED.length));
    for (const [id, expected] of PINNED) {
      const raw = readFileSync(join(realStudio, "petitiones", `${id}.md`), "utf8");
      const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
      const body = (m?.[1] ?? "").trim();
      const actual = deriveSubject(body);
      checkB(1, `${id}: pinned subject exact`, actual === expected, JSON.stringify(actual));
      checkB(1, `${id}: non-empty`, actual.length > 0, actual);
      checkB(1, `${id}: no leaked markdown (#, **, backtick, [text](url))`, !/^#|\*\*|`|\]\(/.test(actual), actual);
      checkB(1, `${id}: length <=120 including any ellipsis`, actual.length <= 120, String(actual.length));
      checkB(1, `${id}: ellipsis (if any) isn't preceded by a trailing space`, !actual.endsWith(" …"), actual);
    }

    // Synthetic row the twelve do not cover: a first paragraph that is a
    // single token longer than the cap (a long URL) — the no-space
    // fallback, cutting mid-token at the boundary by design.
    const longToken = "https://example.com/" + "a".repeat(150);
    const expectedSynthetic =
      "https://example.com/" + "a".repeat(150).slice(0, 119 - "https://example.com/".length) + "…";
    const actualSynthetic = deriveSubject(longToken);
    checkB(1, "synthetic: single token longer than the cap — pinned exact", actualSynthetic === expectedSynthetic, JSON.stringify(actualSynthetic));
    checkB(1, "synthetic: capped at 120 total", actualSynthetic.length === 120, String(actualSynthetic.length));
    checkB(1, "synthetic: ends in the ellipsis", actualSynthetic.endsWith("…"), actualSynthetic);
    checkB(1, "synthetic: the no-space fallback actually applies (no space in the capped window)", !actualSynthetic.slice(0, -1).includes(" "), actualSynthetic);
  }

  // ---- behaviour 2: `subject:` in front matter wins, verbatim — including
  // when it differs from what the body would derive, and when the body is
  // empty. Built officina (a temp copy of examples/sample-studio, plus two
  // synthetic petitio files), not the real studio (which has no subject:
  // key on any of the twelve — that absence is behaviour 5's territory). --
  {
    const dir = freshStudio("w076-b2-front-matter-subject");
    writeFileSync(
      join(dir, "petitiones", "W076-B2-A.md"),
      [
        "---",
        'id: "W076-B2-A"',
        "from: eng-lead",
        "to: patron",
        "state: needs_you",
        "opened: 2026-09-19T10:00:00Z",
        'subject: "Custom subject text, not derived"',
        "---",
        "",
        "This body would derive a completely different subject if the fallback ran at all — proving front matter wins outright.",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "petitiones", "W076-B2-B.md"),
      [
        "---",
        'id: "W076-B2-B"',
        "from: eng-lead",
        "to: patron",
        "state: needs_you",
        "opened: 2026-09-19T10:00:00Z",
        'subject: "Wins even with an empty body"',
        "---",
        "",
      ].join("\n"),
    );
    const snap = snapshotDir(dir, "w076-b2");
    const a = (snap.petitiones ?? []).find((p) => p.id === "W076-B2-A");
    const b = (snap.petitiones ?? []).find((p) => p.id === "W076-B2-B");
    checkB(2, "front matter subject wins even though it differs from the derivation", a?.subject === "Custom subject text, not derived", JSON.stringify(a));
    checkB(2, "front matter subject wins even when the body is empty", b?.subject === "Wins even with an empty body", JSON.stringify(b));
    // W-076 censor round 1 (F3): the previous version of this assertion
    // checked B (an EMPTY-body fixture) for `body === ""`, which a mutant
    // that always returns `body: ""` also satisfies — vacuous. A's body is
    // real, non-empty content; asserting it verbatim is the assertion that
    // actually bites a "never carry the body" mutation.
    checkB(
      2,
      "body is carried verbatim alongside the front-matter subject (non-empty case)",
      a?.body === "This body would derive a completely different subject if the fallback ran at all — proving front matter wins outright.",
      JSON.stringify(a?.body),
    );
    checkB(2, "an empty body is still carried as body: \"\" (not e.g. omitted)", b?.body === "", JSON.stringify(b?.body));
  }

  // ---- behaviour 4: empty bodies fall back to the petitio id (never an
  // empty label), and subject:'s two check-rule failure levels — present-
  // and-invalid blocks (not rescued by the derivation), absent advises,
  // valid non-blank neither. petitio.opened's exact two-level shape. ----
  {
    const dir = freshStudio("w076-b4-subject-levels");
    const write = (id: string, subjectLine: string | undefined, body = "") =>
      writeFileSync(
        join(dir, "petitiones", `${id}.md`),
        [
          "---",
          `id: "${id}"`,
          "from: eng-lead",
          "to: patron",
          "state: needs_you",
          "opened: 2026-09-19T10:00:00Z",
          ...(subjectLine !== undefined ? [subjectLine] : []),
          "---",
          "",
          body,
          "",
        ].join("\n"),
      );
    write("W076-B4-EMPTYBODY", undefined, "   \n   ");
    write("W076-B4-ABSENT", undefined);
    write("W076-B4-BLANK", 'subject: ""');
    write("W076-B4-WHITESPACE", 'subject: "   "');
    write("W076-B4-NUM", "subject: 42");
    write("W076-B4-LIST", "subject: [a]");
    write("W076-B4-VALID", 'subject: "A perfectly fine subject"', "Real, non-empty body content for the carry-verbatim check.");

    const snap = snapshotDir(dir, "w076-b4");
    const emptyBody = (snap.petitiones ?? []).find((p) => p.id === "W076-B4-EMPTYBODY");
    checkB(4, "an empty/whitespace-only body yields body: \"\"", emptyBody?.body === "", JSON.stringify(emptyBody?.body));
    checkB(4, "...and a non-empty derived subject, falling back to the petitio id", emptyBody?.subject === "W076-B4-EMPTYBODY", JSON.stringify(emptyBody?.subject));
    // W-076 censor round 1 (F3): the assertion above only ever checks a
    // body that's supposed to end up "" — a mutant that always returns
    // `body: ""` satisfies it too. This sibling checks a real, non-empty
    // body carries through verbatim, so "always empty" fails here instead.
    const validRow = (snap.petitiones ?? []).find((p) => p.id === "W076-B4-VALID");
    checkB(4, "a non-empty body is carried verbatim (not collapsed to \"\")", validRow?.body === "Real, non-empty body content for the carry-verbatim check.", JSON.stringify(validRow?.body));

    const r = checkStudio(dir, NOW);
    const subjectFindings = (id: string) => r.findings.filter((f) => f.rule === "petitio.subject" && f.where.includes(id));
    checkB(4, "subject: \"\" is a blocking finding", subjectFindings("W076-B4-BLANK").some((f) => f.level === "block"), JSON.stringify(subjectFindings("W076-B4-BLANK")));
    checkB(4, "subject: \"   \" is a blocking finding", subjectFindings("W076-B4-WHITESPACE").some((f) => f.level === "block"), JSON.stringify(subjectFindings("W076-B4-WHITESPACE")));
    checkB(4, "subject: 42 is a blocking finding", subjectFindings("W076-B4-NUM").some((f) => f.level === "block"), JSON.stringify(subjectFindings("W076-B4-NUM")));
    checkB(4, "subject: [a] is a blocking finding", subjectFindings("W076-B4-LIST").some((f) => f.level === "block"), JSON.stringify(subjectFindings("W076-B4-LIST")));
    checkB(4, "no subject: key is advisory, not blocking", subjectFindings("W076-B4-ABSENT").length === 1 && subjectFindings("W076-B4-ABSENT")[0]?.level === "advise", JSON.stringify(subjectFindings("W076-B4-ABSENT")));
    checkB(4, "a valid non-blank subject produces neither", subjectFindings("W076-B4-VALID").length === 0, JSON.stringify(subjectFindings("W076-B4-VALID")));

    // Malformed values are never rescued by the derivation as far as the
    // *check* is concerned (it still blocks, asserted above); the adapter
    // still has to put a real string in the required schema field, so it
    // is never the raw non-string value itself.
    const numRow = (snap.petitiones ?? []).find((p) => p.id === "W076-B4-NUM");
    checkB(4, "the schema field is always a real string, never the raw malformed value", typeof numRow?.subject === "string" && numRow.subject.length > 0, JSON.stringify(numRow?.subject));
  }

  // ---- behaviour 5: nothing else in the snapshot moves, and the `check`
  // delta on the real officina is exact. ----
  {
    // opera/acta/needsYou().opera rows are untouched by this opus: a
    // self-relative check (not a pinned hash against the live studio, which
    // this opus's own `ready`/`red`/`done` bookkeeping writes keep moving,
    // unrelated to petitiones) — add a petitio with a subject and a body to
    // a temp officina and confirm opera/acta don't shift at all.
    const dir = freshStudio("w076-b5-nothing-else-moves");
    const before = snapshotDir(dir, "w076-b5", NOW);
    writeFileSync(
      join(dir, "petitiones", "W076-B5-NEW.md"),
      [
        "---",
        'id: "W076-B5-NEW"',
        "from: eng-lead",
        "to: patron",
        "state: needs_you",
        "opened: 2026-09-19T10:00:00Z",
        'subject: "A brand-new petitio"',
        "---",
        "",
        "A whole new petitio, added purely to prove opera and acta don't move.",
        "",
      ].join("\n"),
    );
    const after = snapshotDir(dir, "w076-b5", NOW);
    checkB(5, "opera is unaffected by a petitiones-only change", JSON.stringify(before.opera) === JSON.stringify(after.opera), "opera mismatch");
    checkB(5, "acta is unaffected by a petitiones-only change", JSON.stringify(before.acta) === JSON.stringify(after.acta), "acta mismatch");

    // The check delta on the real officina, exact: today, zero findings of
    // any rule are scoped to petitiones/ (verified directly below); after
    // this opus, exactly twelve — one per real petitio, all `petitio.subject`
    // advisories (no other rule's petitio-scoped finding set is touched,
    // and none of the twelve has a malformed key, so none blocks). No
    // `--repo` here: `probatio.certifies` and friends key off the live git
    // tree, which this very opus's own commits move — irrelevant to this
    // rule and excluded by staying hermetic, the same way most of this file
    // already does.
    const REAL_IDS = ["P-001", "P-002", "P-003", "P-004", "P-005", "P-007", "P-008", "P-009", "P-010", "P-011", "P-012", "P-013"];
    const r = checkStudio(realStudio, new Date("2026-09-25T12:00:00Z"));
    const petitioScoped = r.findings.filter((f) => f.where.startsWith("petitiones/"));
    checkB(5, "petitiones-scoped findings are exactly twelve (one per real petitio)", petitioScoped.length === 12, JSON.stringify(petitioScoped));
    checkB(5, "...and every one is petitio.subject (no other petitio rule's set altered)", petitioScoped.every((f) => f.rule === "petitio.subject"), JSON.stringify(petitioScoped));
    checkB(5, "...and every one is advisory (zero new blocking findings)", petitioScoped.every((f) => f.level === "advise"), JSON.stringify(petitioScoped));
    for (const id of REAL_IDS) {
      checkB(5, `petitio.subject advises on ${id} (no subject: key today)`, petitioScoped.some((f) => f.where === `petitiones/${id}.md`), JSON.stringify(petitioScoped.map((f) => f.where)));
    }
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
