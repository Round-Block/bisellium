#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runExperiment } from "../bisellium-maps-harness.mjs";

const PILOT = "/home/edckt/projects/bisellium/docs/research/maps-sufficiency-2026-09-28";
const OUTPUT = path.dirname(fileURLToPath(import.meta.url));
const LIMITS = Object.freeze({ directories: 128, files: 512, opens: 128, bytes: 8 * 1024 * 1024, fileBytes: 256 * 1024, excerptFiles: 4, excerptCharacters: 6_000 });
const SPANS = Object.freeze([
  ["B6", "bisellium-main", "docs/ADOPTION.md", 87, 99],
  ["B7", "bisellium-main", "docs/ADOPTION.md", 581, 610],
  ["E6", "epoch0-main", "AGENTS.md", 29, 31],
  ["E6", "epoch0-main", "AGENTS.md", 51, 65],
  ["E7", "epoch0-main", "README.md", 33, 49],
  ["Y6", "yan-mo-main", "docs/dev-workflow.md", 69, 89],
  ["Y7", "yan-mo-main", "docs/vertical-slice-spec.md", 36, 47],
]);
const INPUT_FILES = ["route-dataset.json", "bindings.json", "answer-key.json", "route-results.json", "search-results.json"];
const RETRIEVAL_FILES = ["search-diverse-results.json", "search-diverse-repeat.json", "replay-status.json"];

const fail = message => { throw new Error(message); };
const bytes = file => readFileSync(file);
const json = file => JSON.parse(bytes(file));
const sha256 = value => createHash("sha256").update(value).digest("hex");
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const compact = value => `${JSON.stringify(value)}\n`;
const spanId = span => `${span.case}:${span.repository}:${span.path}:${span.start}-${span.end}`;
const unitId = unit => `${unit.case}:${unit.repository}:${unit.path}:${unit.line}`;

function freeze() {
  for (const name of RETRIEVAL_FILES) if (existsSync(path.join(OUTPUT, name))) fail(`refusing to freeze after retrieval output exists: ${name}`);
  const answerKey = json(path.join(PILOT, "answer-key.json"));
  const dataset = json(path.join(PILOT, "route-dataset.json"));
  const route = json(path.join(PILOT, "route-results.json"));
  const spans = [];
  for (const [caseId, repository, sourcePath, start, end] of SPANS) {
    const keyedCase = answerKey.cases.find(item => item.id === caseId) ?? fail(`answer key missing ${caseId}`);
    const source = keyedCase.authoritativeSources.find(item => item.repository === repository && item.path === sourcePath && item.start === start && item.end === end) ?? fail(`answer key missing exact span ${caseId}/${sourcePath}:${start}-${end}`);
    const datasetCase = dataset.cases.find(item => item.id === caseId && item.project === keyedCase.project) ?? fail(`dataset missing ${caseId}`);
    if (!datasetCase.references.some(item => item.path === sourcePath && item.start === start && item.end === end && item.fileSha256 === source.fileSha256)) fail(`dataset mismatch for ${caseId}/${sourcePath}`);
    const resultCase = route.results.find(item => item.id === caseId && item.project === keyedCase.project) ?? fail(`route result missing ${caseId}`);
    const file = resultCase.repositories.find(item => item.repository === repository)?.files.find(item => item.path === sourcePath) ?? fail(`route result missing ${caseId}/${sourcePath}`);
    if (file.sha256 !== source.fileSha256 || file.capturedHashMatches !== true) fail(`route hash mismatch for ${caseId}/${sourcePath}`);
    const rangeIndex = file.ranges.findIndex(range => range[0] === start && range[1] === end);
    if (rangeIndex < 0) fail(`route range mismatch for ${caseId}/${sourcePath}`);
    const lines = file.excerpts[rangeIndex].split("\n");
    if (lines.length !== end - start + 1) fail(`route excerpt cannot establish every line for ${caseId}/${sourcePath}`);
    spans.push({ case: caseId, project: keyedCase.project, repository, path: sourcePath, start, end, sha256: source.fileSha256, lines, units: lines.map((text, index) => ({ line: start + index, text })).filter(unit => unit.text.trim() !== "") });
  }
  const filenameOrderUnits = [];
  for (const span of spans.filter(item => item.case === "E7")) {
    for (let index = 0; index < span.lines.length; index++) {
      if (span.lines[index].includes("filename order")) filenameOrderUnits.push(span.start + index);
      else if (index + 1 < span.lines.length && `${span.lines[index]} ${span.lines[index + 1]}`.replace(/\s+/g, " ").includes("filename order")) filenameOrderUnits.push(span.start + index, span.start + index + 1);
    }
  }
  if (!filenameOrderUnits.length) fail("E7 frozen span cannot establish the literal filename order phrase");
  const key = { version: 1, rule: "A unit is a nonblank authoritative-span source line and is covered only when an emitted excerpt supplies the entire line at its keyed repository/path/line and file hash. Blank lines are excluded; unions do not double count. A span is covered only when every unit is covered.", characterConvention: "JavaScript UTF-16 String.length and String.slice", spans, e7FilenameOrderLines: [...new Set(filenameOrderUnits)], e7FilenameOrderDerivation: "The literal phrase `filename order` is line-wrapped across two adjacent authoritative E7 source lines; both exact full lines must be covered." };
  const hashes = Object.fromEntries(INPUT_FILES.map(name => [name, sha256(bytes(path.join(PILOT, name)))]));
  writeFileSync(path.join(OUTPUT, "evaluator-key.json"), stable(key));
  writeFileSync(path.join(OUTPUT, "frozen-input-hashes.json"), stable({ version: 1, pilot: PILOT, hashes }));
  process.stdout.write(`froze ${spans.reduce((sum, span) => sum + span.units.length, 0)} units across ${spans.length} spans\n`);
}

function poisonedDataset(dataset) {
  const output = structuredClone(dataset);
  for (const item of output.cases) Object.assign(item, {
    references: [{ path: "poison.md", start: 999, end: 1000, excerpt: "poison", fileSha256: "f".repeat(64) }],
    capturedHashes: ["f".repeat(64)], capturedExcerpts: ["poison"], expectedOutcome: "poison", expectedOutcomes: ["poison"],
    expectedScopedOutcome: { poison: true }, measurement: { poison: true }, measurements: { poison: true },
    checkoutSnapshots: { poison: true }, checkouts: { poison: true }, routeResults: [{ poison: true }],
  });
  return output;
}

async function retrieve() {
  if (!existsSync(path.join(OUTPUT, "evaluator-key.json")) || !existsSync(path.join(OUTPUT, "frozen-input-hashes.json"))) fail("freeze evaluator and input hashes before retrieval");
  const dataset = json(path.join(PILOT, "route-dataset.json"));
  const bindings = json(path.join(PILOT, "bindings.json"));
  const frozenBaseline = bytes(path.join(PILOT, "search-results.json"));
  const baseline = Buffer.from(compact(await runExperiment(dataset, bindings, "search", LIMITS)));
  if (!baseline.equals(frozenBaseline)) {
    writeFileSync(path.join(OUTPUT, "replay-status.json"), stable({ status: "inconclusive", reason: "baseline search did not reproduce byte-for-byte", frozenSha256: sha256(frozenBaseline), replaySha256: sha256(baseline) }));
    fail("baseline search did not reproduce byte-for-byte; comparison is inconclusive");
  }
  const first = Buffer.from(compact(await runExperiment(dataset, bindings, "search-diverse", LIMITS)));
  const second = Buffer.from(compact(await runExperiment(dataset, bindings, "search-diverse", LIMITS)));
  if (!first.equals(second)) fail("search-diverse repeats differ byte-for-byte");
  const poison = Buffer.from(compact(await runExperiment(poisonedDataset(dataset), bindings, "search-diverse", LIMITS)));
  if (!first.equals(poison)) fail("forbidden case-field poisoning changed search-diverse output or metrics");
  writeFileSync(path.join(OUTPUT, "search-diverse-results.json"), first);
  writeFileSync(path.join(OUTPUT, "search-diverse-repeat.json"), second);
  writeFileSync(path.join(OUTPUT, "replay-status.json"), stable({ status: "reproduced", baselineByteIdentical: true, diverseRepeatByteIdentical: true, poisonedByteIdentical: true, hashes: { baseline: sha256(baseline), diverse: sha256(first), diverseRepeat: sha256(second), poisoned: sha256(poison) } }));
  process.stdout.write("baseline reproduced; search-diverse repeated and poison-isolated byte-for-byte\n");
}

function coveredUnits(output, key) {
  const covered = new Set();
  const units = key.spans.flatMap(span => span.units.map(unit => ({ ...unit, case: span.case, repository: span.repository, path: span.path, sha256: span.sha256 })));
  for (const result of output.results) for (const repository of result.repositories) for (const file of repository.files) {
    for (let rangeIndex = 0; rangeIndex < file.excerpts.length; rangeIndex++) {
      const [start, end] = file.ranges[rangeIndex];
      const parts = file.excerpts[rangeIndex].split("\n");
      for (const unit of units) {
        if (unit.case !== result.id || unit.repository !== repository.repository || unit.path !== file.path || unit.sha256 !== file.sha256 || unit.line < start || unit.line > end) continue;
        const offset = unit.line - start;
        if (offset < parts.length - 1 || (offset === parts.length - 1 && parts[offset] === unit.text)) covered.add(unitId(unit));
      }
    }
  }
  return covered;
}

function measures(output) {
  const repositories = output.results.flatMap(result => result.repositories);
  const files = repositories.flatMap(repository => repository.files);
  const excerpts = files.flatMap(file => file.excerpts);
  return {
    cases: output.results.length, repositories: repositories.length,
    directories: repositories.reduce((sum, item) => sum + item.metrics.directories, 0),
    candidates: repositories.reduce((sum, item) => sum + item.metrics.candidates, 0),
    opens: repositories.reduce((sum, item) => sum + item.metrics.opens, 0),
    bytes: repositories.reduce((sum, item) => sum + item.metrics.bytes, 0),
    retrievedFiles: files.length, suppliedFiles: files.filter(file => file.excerpts.length > 0).length,
    suppliedCharactersUtf16: excerpts.reduce((sum, excerpt) => sum + excerpt.length, 0),
    omissions: repositories.reduce((sum, item) => sum + item.metrics.omittedExcerpts, 0),
    failures: repositories.reduce((sum, item) => sum + item.failures.length, 0),
    incomplete: repositories.filter(item => item.coverage !== "complete").length,
  };
}

function evaluate() {
  const status = json(path.join(OUTPUT, "replay-status.json"));
  if (status.status !== "reproduced") fail("cannot evaluate an inconclusive replay");
  const key = json(path.join(OUTPUT, "evaluator-key.json"));
  const baseline = json(path.join(PILOT, "search-results.json"));
  const diverse = json(path.join(OUTPUT, "search-diverse-results.json"));
  const baselineCovered = coveredUnits(baseline, key), diverseCovered = coveredUnits(diverse, key);
  const gains = [...diverseCovered].filter(unit => !baselineCovered.has(unit)).sort();
  const losses = [...baselineCovered].filter(unit => !diverseCovered.has(unit)).sort();
  const spans = key.spans.map(span => {
    const ids = span.units.map(unit => unitId({ ...unit, case: span.case, repository: span.repository, path: span.path }));
    return { id: spanId(span), case: span.case, baselineUnits: ids.filter(id => baselineCovered.has(id)).length, diverseUnits: ids.filter(id => diverseCovered.has(id)).length, totalUnits: ids.length, baselineCovered: ids.every(id => baselineCovered.has(id)), diverseCovered: ids.every(id => diverseCovered.has(id)) };
  });
  const targetRecovery = spans.some(span => ["B6", "B7", "Y6", "Y7"].includes(span.case) && !span.baselineCovered && span.diverseCovered);
  const e6Loss = losses.some(unit => unit.startsWith("E6:"));
  const gatePassed = targetRecovery && !e6Loss;
  const e7FilenameOrder = key.e7FilenameOrderLines.map(line => {
    const id = `E7:epoch0-main:README.md:${line}`;
    return { line, baseline: baselineCovered.has(id), diverse: diverseCovered.has(id) };
  });
  const comparison = { version: 1, gatePassed, gateRule: "At least one B6/B7/Y6/Y7 span absent at baseline becomes fully covered, with no loss of an E6 baseline-covered unit.", gains, losses, spans, e7FilenameOrder, measures: { baseline: measures(baseline), diverse: measures(diverse) } };
  writeFileSync(path.join(OUTPUT, "comparison.json"), stable(comparison));
  const inputHashes = json(path.join(OUTPUT, "frozen-input-hashes.json")).hashes;
  const outputHashes = Object.fromEntries(["evaluator-key.json", "frozen-input-hashes.json", "search-diverse-results.json", "search-diverse-repeat.json", "replay-status.json", "comparison.json"].map(name => [name, sha256(bytes(path.join(OUTPUT, name)))]));
  const provenance = diverse.results.flatMap(result => result.repositories.map(repository => `${result.id}: ${repository.repository} @ ${repository.identity.head} (${repository.identity.branch}; dirty=${repository.identity.dirty}; gitCalls=${repository.identity.gitCalls})`));
  const rows = spans.map(span => `| ${span.id} | ${span.baselineUnits}/${span.totalUnits} | ${span.diverseUnits}/${span.totalUnits} | ${span.baselineCovered ? "yes" : "no"} | ${span.diverseCovered ? "yes" : "no"} |`).join("\n");
  const report = `# W-104 source-diverse replay\n\nThis deterministic experiment replays six known development cases. It is not held-out validation and makes no answer-quality, accuracy, cost, savings, or adoption claim. No model was called.\n\n## Result\n\nThe cheap gate **${gatePassed ? "passed" : "did not pass"}**. ${gatePassed ? "Neutral retrieval packets are frozen; any model trial still requires separate authorization and preregistration." : "The negative result ends the experiment; no model trial was run."}\n\nThe baseline reproduced byte-for-byte. Two search-diverse runs and the forbidden-field poison run were byte-identical. Retrieval received only case id, project, question, bindings, manifests, checkouts, and limits; the frozen evaluator key entered only the post-output evaluation stage.\n\n| Span | Baseline units | Diverse units | Baseline whole span | Diverse whole span |\n|---|---:|---:|---|---|\n${rows}\n\nLine-unit gains: ${gains.length}; losses: ${losses.length}. E6 baseline-covered unit losses: ${e6Loss ? "yes" : "no"}. E7 literal \`filename order\` is wrapped across two frozen source lines; both retain exact full-line coverage semantics. Line coverage: ${e7FilenameOrder.map(item => `line ${item.line} baseline=${item.baseline}, diverse=${item.diverse}`).join("; ")}. Partial line changes do not satisfy the gate. The conservative full-span proxy can miss useful partial recovery and cannot establish requested-fact coverage or answer sufficiency.\n\n## Retrieval measures\n\n| Measure | Baseline search | Search-diverse |\n|---|---:|---:|\n${Object.keys(comparison.measures.baseline).map(name => `| ${name} | ${comparison.measures.baseline[name]} | ${comparison.measures.diverse[name]} |`).join("\n")}\n\nEffective limits were ${JSON.stringify(diverse.limits)}. Supplied characters use JavaScript UTF-16 \`String.length\`/\`slice\`, as the harness does. The earlier pilot's producer-side 35,999-character total used Python code-point length, so that historical unit difference is not evidence or budget drift. Coverage/incompleteness, omissions, failures, opens, and bytes above come directly from the harness output.\n\n## Frozen hashes\n\nInputs:\n\n${Object.entries(inputHashes).map(([name, hash]) => `- \`${name}\`: \`${hash}\``).join("\n")}\n\nOutputs:\n\n${Object.entries(outputHashes).map(([name, hash]) => `- \`${name}\`: \`${hash}\``).join("\n")}\n\n## Provenance\n\n${provenance.map(item => `- ${item}`).join("\n")}\n`;
  writeFileSync(path.join(OUTPUT, "report.md"), report);
  process.stdout.write(`gate ${gatePassed ? "PASS" : "NEGATIVE"}; gains=${gains.length} losses=${losses.length}\n`);
}

const stage = process.argv[2];
if (stage === "freeze") freeze();
else if (stage === "retrieve") await retrieve();
else if (stage === "evaluate") evaluate();
else fail("usage: node docs/research/W-104/replay.mjs freeze|retrieve|evaluate");
