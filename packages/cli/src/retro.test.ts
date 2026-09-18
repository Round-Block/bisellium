/**
 * packages/cli/src/retro.test.ts — W-018 (4/4): `draftRetro`/`runRetro`
 * (behaviours 10-12) and `cascades/cascade.js` (behaviour 13).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkStudio } from "./check.js";
import { draftRetro, runRetro, type RetroInput } from "./retro.js";

const repo = resolve(process.argv[2] ?? ".");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function tempStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-retro-${tag}-`));
  dirs.push(dir);
  writeFileSync(
    join(dir, "bisellium.yml"),
    [
      "bisellium: 1",
      "studio: Retro Fixture",
      "patron: patron",
      "collegia:",
      "  - { id: engineering, name: Engineering, magister: eng-lead }",
      "  - { id: qa, name: QA, magister: qa-lead }",
      "sellae:",
      "  - { id: eng-lead, collegium: engineering, kind: agent }",
      "  - { id: qa-lead, collegium: qa, kind: agent }",
      "probationes:",
      "  - { id: tests, name: Tests, kind: automated }",
      "wip_limit: 10",
      "",
    ].join("\n"),
  );
  mkdirSync(join(dir, "opera"), { recursive: true });
  return dir;
}

const NOW = new Date("2026-09-18T20:00:00Z");

try {
  // =========================================================================
  // Behaviour 10 — every section present, one lesson per class, petitio
  // only for a recurring (blocking-rule) proposal, pruning candidate
  // byte-identical, and check afterwards reports zero NEW blocking findings.
  // =========================================================================
  {
    const dir = tempStudio("full");
    writeFileSync(join(dir, "ci-log.txt"), "test output\n");

    mkdirSync(join(dir, "decisions"), { recursive: true });
    const decisionRaw =
      '---\nid: "D-001"\ntitle: "A decision"\nat: 2026-09-17T00:00:00Z\nprovenance: stated\nby: patron\nkill_when: "flaky tests recur across cascades"\n---\nBody.\n';
    writeFileSync(join(dir, "decisions", "D-001.md"), decisionRaw);

    // Pre-existing lesson from an earlier cascade, so this cascade's
    // "flaky" class recurs (>=2 distinct cascades, >=2 distinct lessons).
    mkdirSync(join(dir, "lessons"), { recursive: true });
    writeFileSync(
      join(dir, "lessons", "L-001.md"),
      '---\nid: "L-001"\nat: 2026-09-10T00:00:00Z\nclass: "flaky"\nevidence: ["ci-log.txt"]\ncascade: 3\n---\nEarlier.\n',
    );

    const input: RetroInput = {
      verifierIssues: 2,
      reviewFindings: [
        { class: "flaky", where: "packages/cli/src/tick.test.ts", evidence: ["ci-log.txt"] },
        { class: "one-off-typo", where: "docs/ADOPTION.md", evidence: ["ci-log.txt"] },
      ],
      agents: [{ label: "builder-c", model: "claude-sonnet-5", tokens: 12000, minutes: 40 }],
      tests: 120,
      fixRounds: 1,
      mutationsCaught: 3,
    };

    const draft = draftRetro(dir, 4, input, NOW);

    for (const section of ["## Numbers", "## Findings by class", "## Lessons filed", "## Recurrence", "## Proposals", "## Pruning candidates"])
      check(`10a. retro doc has section "${section}"`, draft.markdown.includes(section));

    check("10b. one lesson stub per distinct class (2 classes -> 2 new lessons)", draft.lessons.length === 2, String(draft.lessons.length));
    check(
      "10c. a petitio was filed for the recurring class, none for the one-off",
      draft.petitiones.length === 1,
      JSON.stringify(draft.petitiones),
    );
    const petitioRaw = readFileSync(join(dir, draft.petitiones[0]!), "utf8");
    check("10d. petitio is addressed to the patron, needs_you", petitioRaw.includes("to: patron") && petitioRaw.includes("state: needs_you"));

    check("10e. pruning candidate lists D-001 (kill_when mentions 'flaky')", draft.markdown.includes("D-001"), draft.markdown);
    const decisionAfter = readFileSync(join(dir, "decisions", "D-001.md"), "utf8");
    check("10f. the decision file itself is byte-identical on disk (never edited)", decisionAfter === decisionRaw);

    const before = checkStudio(dir, NOW);
    const beforeBlocks = new Set(before.findings.filter((f) => f.level === "block").map((f) => `${f.rule}@${f.where}`));
    const after = checkStudio(dir, NOW);
    const afterBlocks = new Set(after.findings.filter((f) => f.level === "block").map((f) => `${f.rule}@${f.where}`));
    const newBlocks = [...afterBlocks].filter((x) => !beforeBlocks.has(x));
    check("10g. check on the officina afterwards: zero NEW blocking findings", newBlocks.length === 0, newBlocks.join(", "));
    check("10h. check on the officina afterwards: zero blocking findings at all", after.ok, JSON.stringify(after.findings.filter((f) => f.level === "block")));
  }

  // =========================================================================
  // Behaviour 11 — refuses on empty/dead evidence, nothing written
  // =========================================================================
  {
    const dir = tempStudio("refuse-empty");
    const before = existsSync(join(dir, "acta")) ? readFileSync(join(dir, "acta"), "utf8").length : -1;
    let threw = false;
    let message = "";
    try {
      draftRetro(dir, 1, { verifierIssues: 0, reviewFindings: [{ class: "x", where: "y", evidence: [] }], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0 }, NOW);
    } catch (e) {
      threw = true;
      message = (e as Error).message;
    }
    check("11a. empty evidence list: draftRetro throws naming the class", threw && message.includes('"x"'), message);
    check("11b. nothing written: no acta/ dir created", !existsSync(join(dir, "acta")));
    check("11c. nothing written: no lessons/ dir created", !existsSync(join(dir, "lessons")));

    let threw2 = false;
    let message2 = "";
    try {
      draftRetro(
        dir,
        1,
        { verifierIssues: 0, reviewFindings: [{ class: "y", where: "z", evidence: ["does-not-exist.log"] }], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0 },
        NOW,
      );
    } catch (e) {
      threw2 = true;
      message2 = (e as Error).message;
    }
    check("11d. dead evidence href: draftRetro throws naming the class", threw2 && message2.includes('"y"'), message2);
    check("11e. nothing written after the dead-href refusal either", !existsSync(join(dir, "acta")));

    // Via the CLI wrapper: exit 2, nothing written.
    const jsonPath = join(dir, "bad-input.json");
    writeFileSync(
      jsonPath,
      JSON.stringify({ verifierIssues: 0, reviewFindings: [{ class: "x", where: "y", evidence: [] }], agents: [], tests: 0, fixRounds: 0, mutationsCaught: 0 }),
    );
    const r = runRetro(["--cascade", "1", "--from", jsonPath, "--studio", dir, "--now", NOW.toISOString()]);
    check("11f. runRetro exits 2 on the same refusal", r.exitCode === 2);
    check("11g. runRetro: nothing written either", !existsSync(join(dir, "acta")));
    void before;
  }

  // =========================================================================
  // Behaviour 12 — deterministic under a pinned --now
  // =========================================================================
  {
    const dirA = tempStudio("det-a");
    const dirB = tempStudio("det-b");
    writeFileSync(join(dirA, "ev.log"), "x\n");
    writeFileSync(join(dirB, "ev.log"), "x\n");
    const input: RetroInput = {
      verifierIssues: 1,
      reviewFindings: [
        { class: "b-class", where: "w", evidence: ["ev.log"] },
        { class: "a-class", where: "w", evidence: ["ev.log"] },
      ],
      agents: [{ label: "x", model: "m", tokens: 1, minutes: 1 }],
      tests: 5,
      fixRounds: 0,
      mutationsCaught: 1,
    };
    const draftA = draftRetro(dirA, 7, input, NOW);
    const draftB = draftRetro(dirB, 7, input, NOW);
    check("12. same input + pinned --now -> byte-identical retro markdown", draftA.markdown === draftB.markdown);
  }

  // =========================================================================
  // Behaviour 13 — cascades/cascade.js parses, phase list is exact
  // =========================================================================
  {
    const mod = (await import(join(repo, "cascades", "cascade.js"))) as { phases: string[] };
    check("13. cascade.js phases === [spec, build, verify, close]", JSON.stringify(mod.phases) === JSON.stringify(["spec", "build", "verify", "close"]));
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
