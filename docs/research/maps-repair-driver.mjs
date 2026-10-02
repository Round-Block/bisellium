#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STOP = new Set("a an and are as at be by can did do does for from how if in into is it its may of on or that the their then these this to was were what when where which who will with would".split(" "));
const DEFAULT_LIMITS = Object.freeze({ fileBytes: 256 * 1024, excerptFiles: 4, excerptCharacters: 6000 });
const fail = message => { throw new Error(message); };
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const contained = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);

function tokenSequence(value) { return [...new Set((String(value).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(token => token.length >= 3 && !STOP.has(token)))]; }
export function tokenize(value) { return tokenSequence(value).sort(lexical); }

function validRelative(relative) {
  return typeof relative === "string" && relative.length > 0 && relative.length <= 1024 && !relative.includes("\\") && !path.posix.isAbsolute(relative) && !/^[A-Za-z]:/.test(relative) && relative.split("/").every(part => part && part !== "." && part !== "..");
}

export async function admitSources(descriptors, limits = {}, cache = new Map()) {
  const fileBytes = limits.fileBytes ?? DEFAULT_LIMITS.fileBytes;
  if (!Number.isInteger(fileBytes) || fileBytes < 0) fail("invalid file size limit");
  const admitted = [];
  for (const item of descriptors) {
    if (!validRelative(item.path)) fail(`source containment rejected ${item.path}`);
    const canonicalRoot = await realpath(item.root);
    const candidate = path.resolve(canonicalRoot, ...item.path.split("/"));
    if (!contained(canonicalRoot, candidate)) fail(`source containment rejected ${item.path}`);
    let canonical;
    try { canonical = await realpath(candidate); }
    catch (error) { fail(`source unavailable ${item.repository}/${item.path}: ${error.code ?? error.message}`); }
    if (!contained(canonicalRoot, canonical)) fail(`source symlink escape outside containment: ${item.path}`);
    const metadata = await lstat(canonical);
    if (!metadata.isFile()) fail(`source is not a regular file: ${item.path}`);
    if (metadata.size > fileBytes) fail(`source exceeds size limit: ${item.path}`);
    const cacheKey = `${canonical}\0${item.sha256}`;
    let stored = cache.get(cacheKey);
    if (!stored) {
      const bytes = await readFile(canonical);
      if (bytes.length !== metadata.size) fail(`source byte count changed while reading: ${item.path}`);
      const digest = sha256(bytes);
      if (digest !== item.sha256) fail(`source SHA-256 mismatch: ${item.path}`);
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { fail(`source strict UTF-8 decode failed: ${item.path}`); }
      stored = { bytes: bytes.length, text, sha256: digest, canonical };
      cache.set(cacheKey, stored);
    }
    admitted.push({ ...item, ...stored, root: canonicalRoot });
  }
  return admitted;
}

export function passagesFromText(source) {
  const lines = source.text.split(/\r?\n/);
  const passages = [];
  let heading = null;
  let start = null;
  let passageHeading = null;
  const emit = endIndex => {
    if (start === null) return;
    passages.push({ repository: source.repository, path: source.path, sha256: source.sha256, startLine: start + 1, endLine: endIndex + 1, heading: passageHeading, text: lines.slice(start, endIndex + 1).join("\n") });
    start = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*$/.test(line)) { emit(index - 1); continue; }
    const match = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) heading = match[1];
    if (start === null) { start = index; passageHeading = heading; }
  }
  emit(lines.length - 1);
  return passages;
}

function omission(passage, reason) {
  return { bodyScore: passage.bodyScore, endLine: passage.endLine, path: passage.path, reason, repository: passage.repository, sha256: passage.sha256, startLine: passage.startLine, totalScore: passage.totalScore, utf16Units: passage.utf16Units };
}

export function selectPolicyB(input) {
  for (const forbidden of ["key", "expected", "expectedResult", "pass", "passed"]) if (Object.hasOwn(input, forbidden)) fail(`forbidden selection field: ${forbidden}`);
  if (typeof input.question !== "string" || !Array.isArray(input.sources)) fail("selection requires question and sources");
  const maxFiles = input.maxFiles ?? 4, maxUnits = input.maxUnits ?? 6000;
  if (!Number.isInteger(maxFiles) || maxFiles < 0 || !Number.isInteger(maxUnits) || maxUnits < 0) fail("invalid selection limits");
  const queryTokens = tokenize(input.question);
  const passages = input.sources.flatMap(passagesFromText);
  const bodySequences = passages.map(passage => tokenSequence(passage.text));
  const bodies = bodySequences.map(tokens => new Set(tokens));
  const df = Object.fromEntries(queryTokens.map(token => [token, bodies.reduce((count, body) => count + Number(body.has(token)), 0)]));
  const weights = Object.fromEntries(queryTokens.map(token => [token, 1 + Math.log((1 + passages.length) / (1 + df[token]))]));
  const ranked = [];
  let nonPositivePassageCount = 0;
  for (let index = 0; index < passages.length; index++) {
    const passage = passages[index], body = bodies[index];
    const bodySequenceMatches = bodySequences[index].filter(token => Object.hasOwn(weights, token));
    const bodyMatches = [...bodySequenceMatches].sort(lexical);
    const headingSequenceMatches = tokenSequence(passage.heading ?? "").filter(token => Object.hasOwn(weights, token));
    const headingMatches = [...headingSequenceMatches].sort(lexical);
    const bodyScore = bodySequenceMatches.reduce((sum, token) => sum + weights[token], 0);
    if (!(bodyScore > 0)) { nonPositivePassageCount++; continue; }
    const totalScore = bodyScore + 2 * headingSequenceMatches.reduce((sum, token) => sum + weights[token], 0);
    ranked.push({ ...passage, bodyMatches, bodyScore, headingMatches, totalScore, utf16Units: passage.text.length });
  }
  ranked.sort((a, b) => b.totalScore - a.totalScore || lexical(a.repository, b.repository) || lexical(a.path, b.path) || a.startLine - b.startLine);
  const selected = [], oversized = [], rankedNotSelected = [], files = new Set();
  let suppliedUtf16Units = 0;
  for (const passage of ranked) {
    if (passage.utf16Units > maxUnits) { oversized.push(omission(passage, "oversized")); continue; }
    const newFile = !files.has(`${passage.repository}\0${passage.path}`);
    if (newFile && files.size >= maxFiles) { rankedNotSelected.push(omission(passage, "file-cap")); continue; }
    if (suppliedUtf16Units + passage.utf16Units > maxUnits) { rankedNotSelected.push(omission(passage, "utf16-budget")); continue; }
    selected.push(passage);
    files.add(`${passage.repository}\0${passage.path}`);
    suppliedUtf16Units += passage.utf16Units;
  }
  return {
    queryTokens, passageCount: passages.length, nonPositivePassageCount, selected,
    distinctFiles: [...files].map(value => { const [repository, relative] = value.split("\0"); return { path: relative, repository }; }),
    suppliedUtf16Units, omissions: { oversized, rankedNotSelected }, df, weights,
  };
}

async function rejectSymlinkAncestors(canonicalRoot, parent) {
  const relative = path.relative(canonicalRoot, parent);
  let current = canonicalRoot;
  for (const component of relative ? relative.split(path.sep) : []) {
    current = path.join(current, component);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) fail(`output symlink ancestor rejected: ${current}`);
    if (!metadata.isDirectory()) fail(`output ancestor is not a directory: ${current}`);
  }
}

export async function writeExclusiveContained(outputRoot, relative, data, options = {}) {
  if (!validRelative(relative)) fail(`output containment rejected: ${relative}`);
  const rootMetadata = await lstat(outputRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) fail("output root must be a real directory");
  const canonicalRoot = await realpath(outputRoot);
  const destination = path.resolve(canonicalRoot, ...relative.split("/"));
  if (!contained(canonicalRoot, destination)) fail(`output containment rejected: ${relative}`);
  const parent = path.dirname(destination);
  await rejectSymlinkAncestors(canonicalRoot, parent);
  const canonicalParent = await realpath(parent);
  if (!contained(canonicalRoot, canonicalParent)) fail("output parent containment rejected");
  const before = await stat(canonicalParent);
  if (options.sourcePaths?.some(source => path.resolve(source) === destination)) fail("output collides with source input");
  try { await lstat(destination); fail("output collision: destination exists"); }
  catch (error) { if (error.message?.startsWith("output collision")) throw error; if (error.code !== "ENOENT") throw error; }
  if (options.beforeCommit) await options.beforeCommit({ parent: canonicalParent, destination });
  const after = await stat(canonicalParent);
  if (before.dev !== after.dev || before.ino !== after.ino) fail("output parent identity changed before write");
  const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { await handle.writeFile(data); }
  finally { await handle.close(); }
  return destination;
}

async function readJsonStrict(file, label) {
  const bytes = await readFile(file);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail(`${label} is not strict UTF-8`); }
  try { return { bytes, value: JSON.parse(text), sha256: sha256(bytes) }; }
  catch (error) { fail(`${label} is invalid JSON: ${error.message}`); }
}

function caseProjection(result, item) {
  return { distinctFiles: result.distinctFiles, id: item.id, nonPositivePassageCount: result.nonPositivePassageCount, omissions: result.omissions, passageCount: result.passageCount, project: item.project, queryTokens: result.queryTokens, question: item.question, selected: result.selected, suppliedUtf16Units: result.suppliedUtf16Units };
}

function differences(expected, actual, at = "$", output = []) {
  if (Object.is(expected, actual)) return output;
  if (typeof expected !== typeof actual || expected === null || actual === null || typeof expected !== "object") { output.push({ path: at, expected, actual }); return output; }
  if (Array.isArray(expected) !== Array.isArray(actual)) { output.push({ path: at, expected, actual }); return output; }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) output.push({ path: `${at}.length`, expected: expected.length, actual: actual.length });
    for (let index = 0; index < Math.min(expected.length, actual.length); index++) differences(expected[index], actual[index], `${at}[${index}]`, output);
    return output;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort(lexical);
  for (const key of keys) differences(expected[key], actual[key], `${at}.${key}`, output);
  return output;
}

function rejectForbiddenFields(value, at = "$") {
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    if (["key", "expected", "expectedResult", "pass", "passed"].includes(name)) fail(`forbidden selection field at ${at}.${name}`);
    rejectForbiddenFields(child, `${at}.${name}`);
  }
}

export async function reconstructCandidateB({ searchResultsPath, bindingsPath }) {
  const baseline = (await readJsonStrict(searchResultsPath, "baseline search results")).value;
  const bindings = (await readJsonStrict(bindingsPath, "bindings")).value;
  rejectForbiddenFields(baseline); rejectForbiddenFields(bindings);
  if (baseline.mode !== "search" || baseline.limits?.excerptFiles !== 4 || baseline.limits?.excerptCharacters !== 6000) fail("baseline limits or mode mismatch");
  const repositories = new Map();
  for (const project of Object.values(bindings.projects ?? {})) for (const repository of project.repositories ?? []) repositories.set(repository.id, repository);
  const cache = new Map(), preparation = new Map(), cases = [];
  for (const item of baseline.results ?? []) {
    const descriptors = [];
    for (const resultRepository of item.repositories ?? []) {
      const binding = repositories.get(resultRepository.repository);
      if (!binding) fail(`baseline repository missing from binding: ${resultRepository.repository}`);
      for (const file of resultRepository.files ?? []) descriptors.push({ repository: resultRepository.repository, root: binding.root, path: file.path, sha256: file.sha256 });
    }
    const sources = await admitSources(descriptors, { fileBytes: baseline.limits.fileBytes }, cache);
    for (const source of sources) preparation.set(`${source.repository}\0${source.path}`, { bytes: source.bytes, containment: true, path: source.path, repository: source.repository, sha256: source.sha256, sizeAdmitted: true });
    cases.push(caseProjection(selectPolicyB({ question: item.question, sources, maxFiles: baseline.limits.excerptFiles, maxUnits: baseline.limits.excerptCharacters }), item));
  }
  return { cases, policy: "B", preparationReads: [...preparation.values()].sort((a, b) => lexical(a.repository, b.repository) || lexical(a.path, b.path)), rules: "selection-rules.md version 1", version: 1 };
}

export function compareReplay(expected, actual) {
  const exactDifferences = differences(expected, actual), semanticDifferences = [], toleratedNumericDifferences = [];
  const permitted = /^\$\.cases\[\d+\]\.(?:selected\[\d+\]|omissions\.rankedNotSelected\[\d+\])\.(?:bodyScore|totalScore)$/;
  for (const difference of exactDifferences) {
    const delta = typeof difference.expected === "number" && typeof difference.actual === "number" ? Math.abs(difference.expected - difference.actual) : Infinity;
    if (permitted.test(difference.path) && Number.isFinite(difference.expected) && Number.isFinite(difference.actual) && delta <= 4e-15) toleratedNumericDifferences.push({ ...difference, absoluteDelta: delta });
    else semanticDifferences.push(difference);
  }
  return { semanticDifferences, toleratedNumericDifferences };
}

export async function replayCandidateB(options) {
  const expected = (await readJsonStrict(options.candidatePath, "candidate B")).value;
  const actual = await reconstructCandidateB(options);
  const semanticExpected = { cases: expected.cases, policy: expected.policy, preparationReads: expected.preparationReads, rules: expected.rules, version: expected.version };
  const comparison = compareReplay(semanticExpected, actual);
  return { actual, ...comparison, provenanceDifferences: [
    { field: "candidateFrozenBeforeKey", historical: expected.candidateFrozenBeforeKey, replay: "not copied; historical timing claim" },
    { field: "implementation", historical: "inline historical analysis", replay: "W-105 retained driver" },
  ], serializationDifferences: ["whitespace", "indentation", "object-key order", "final newline"] };
}

function packetEvidence(packetCase) {
  if (Array.isArray(packetCase.selected)) return packetCase.selected;
  const entries = [];
  for (const repository of packetCase.repositories ?? []) for (const file of repository.files ?? []) {
    for (let index = 0; index < (file.ranges ?? []).length; index++) {
      const range = file.ranges[index], text = file.excerpts?.[index];
      if (typeof text === "string") entries.push({ repository: repository.repository, path: file.path, sha256: file.sha256, startLine: range[0], endLine: range[1], text });
    }
  }
  return entries;
}

function positionedAnchorSlice(entry, anchor) {
  if (entry.startLine > anchor.startLine || entry.endLine < anchor.endLine) return null;
  const lines = entry.text.split("\n");
  const first = anchor.startLine - entry.startLine, last = anchor.endLine - entry.startLine;
  if (first < 0 || last >= lines.length) return null;
  const requiredEndUnits = anchor.endCharacterExclusive - 1;
  if (lines[last].length < requiredEndUnits) return null;
  return first === last ? lines[first].slice(anchor.startCharacter - 1, requiredEndUnits) : [lines[first].slice(anchor.startCharacter - 1), ...lines.slice(first + 1, last), lines[last].slice(0, requiredEndUnits)].join("\n");
}

function packetSourceIdentities(packetCase) {
  const identities = [];
  for (const entry of packetCase.selected ?? []) identities.push({ repository: entry.repository, path: entry.path, sha256: entry.sha256 });
  for (const repository of packetCase.repositories ?? []) for (const file of repository.files ?? []) identities.push({ repository: repository.repository, path: file.path, sha256: file.sha256 });
  return identities;
}

function sourceAnchorIdentityDrift(entries, identities, anchor) {
  for (const identity of identities) {
    if (identity.repository === anchor.repository && identity.path === anchor.path && identity.sha256 !== anchor.fileSha256) return `source identity mismatch: SHA-256 for ${anchor.repository}/${anchor.path}`;
  }
  for (const entry of entries) {
    if (entry.repository !== anchor.repository || entry.path !== anchor.path || entry.sha256 !== anchor.fileSha256) continue;
    const claimsAnchorCoordinates = entry.startLine <= anchor.startLine && entry.endLine >= anchor.endLine;
    const suppliedSlice = claimsAnchorCoordinates ? positionedAnchorSlice(entry, anchor) : null;
    if (suppliedSlice !== null && suppliedSlice !== anchor.exactText) return `source identity mismatch: positioned content for ${anchor.id}`;
  }
  return null;
}

function sourceAnchorPresent(entries, anchor) {
  for (const entry of entries) {
    if (entry.repository !== anchor.repository || entry.path !== anchor.path || entry.sha256 !== anchor.fileSha256) continue;
    if (positionedAnchorSlice(entry, anchor) === anchor.exactText) return true;
  }
  return false;
}

function metadataCriterionPresent(packetCase, anchor) {
  const entries = packetEvidence(packetCase);
  return anchor.caseId === packetCase.id && !packetCase.liveArtifacts && entries.length > 0 && entries.every(entry => typeof entry.repository === "string" && typeof entry.path === "string" && typeof entry.sha256 === "string");
}

export function scorePackets(packet, key, options = {}) {
  if (options.expectedKeySha256) {
    if (!options.keyBytes) fail("key bytes required for hash verification");
    if (sha256(options.keyBytes) !== options.expectedKeySha256) fail("key hash mismatch");
  }
  const suppliedCases = packet?.cases ?? packet?.results;
  if (!Array.isArray(suppliedCases) || !Array.isArray(key?.cases)) fail("packets and key require cases or baseline results");
  const packetCases = new Map();
  for (const item of suppliedCases) {
    if (packetCases.has(item.id)) fail(`case identity mismatch: duplicate packet case ${item.id}`);
    packetCases.set(item.id, item);
  }
  const cases = [];
  let coveredRequirements = 0, totalRequirements = 0, coveredAnchors = 0, totalAnchors = 0;
  let sourceAndQuestionIdentityChecksPassing = true;
  for (const expectedCase of key.cases) {
    const actualCase = packetCases.get(expectedCase.id);
    if (!actualCase) fail(`case identity mismatch: missing case ${expectedCase.id}`);
    if (actualCase.project !== expectedCase.project) fail(`case identity mismatch: project for ${expectedCase.id}`);
    if (actualCase.question !== expectedCase.question) fail(`case identity mismatch: question for ${expectedCase.id}`);
    const identity = true;
    const entries = packetEvidence(actualCase), sourceIdentities = packetSourceIdentities(actualCase);
    const requirements = [];
    for (const requirement of expectedCase.requiredEvidence ?? []) {
      totalRequirements++;
      const anchors = (requirement.evidenceAnchors ?? []).map(anchor => {
        totalAnchors++;
        if (anchor.type === "sourceText") {
          const drift = sourceAnchorIdentityDrift(entries, sourceIdentities, anchor);
          if (drift) fail(drift);
        }
        const covered = anchor.type === "sourceText" ? sourceAnchorPresent(entries, anchor) : anchor.type === "metadataCriterion" ? metadataCriterionPresent(actualCase, anchor) : false;
        coveredAnchors += Number(covered);
        return { id: anchor.id, type: anchor.type, covered };
      });
      const covered = anchors.length > 0 && anchors.every(anchor => anchor.covered);
      coveredRequirements += Number(covered);
      requirements.push({ id: requirement.id, covered, anchors });
    }
    cases.push({ id: expectedCase.id, project: expectedCase.project, identity, requirements, complete: requirements.length > 0 && requirements.every(requirement => requirement.covered) });
  }
  return { cases, coveredRequirements, totalRequirements, coveredAnchors, totalAnchors, completeCases: cases.filter(item => item.complete).length, sourceAndQuestionIdentityChecksPassing };
}

export function runControls(packet, key) {
  const suppliedCases = packet.cases ?? packet.results;
  const curated = scorePackets(packet, key), empty = scorePackets({ cases: suppliedCases.map(item => ({ ...item, selected: [], repositories: [] })) }, key);
  let masksDetected = 0, masks = 0;
  for (const expectedCase of key.cases) {
    for (const requirement of expectedCase.requiredEvidence ?? []) for (const anchor of requirement.evidenceAnchors ?? []) {
      masks++;
      if (anchor.type === "metadataCriterion") { const clone = structuredClone(packet), actualCase = (clone.cases ?? clone.results).find(item => item.id === expectedCase.id); if (actualCase) actualCase.liveArtifacts = ["masked-live-artifact"]; const result = scorePackets(clone, key).cases.find(item => item.id === expectedCase.id)?.requirements.find(item => item.id === requirement.id); if (result && !result.covered) masksDetected++; continue; }
      const clone = structuredClone(packet), actualCase = (clone.cases ?? clone.results).find(item => item.id === expectedCase.id);
      let changed = false;
      if (actualCase?.selected) {
        const index = actualCase.selected.findIndex(entry => entry.repository === anchor.repository && entry.path === anchor.path && entry.sha256 === anchor.fileSha256 && positionedAnchorSlice(entry, anchor) === anchor.exactText);
        if (index >= 0) { actualCase.selected.splice(index, 1); changed = true; }
      }
      if (actualCase?.repositories) for (const repository of actualCase.repositories) for (const file of repository.files ?? []) {
        if (changed || repository.repository !== anchor.repository || file.path !== anchor.path || file.sha256 !== anchor.fileSha256) continue;
        for (let index = 0; index < (file.ranges ?? []).length; index++) {
          const range = file.ranges[index], excerpt = file.excerpts?.[index];
          if (typeof excerpt !== "string") continue;
          const entry = { repository: repository.repository, path: file.path, sha256: file.sha256, startLine: range[0], endLine: range[1], text: excerpt };
          if (positionedAnchorSlice(entry, anchor) !== anchor.exactText) continue;
          file.ranges.splice(index, 1); file.excerpts.splice(index, 1); changed = true; break;
        }
      }
      const result = scorePackets(clone, key).cases.find(item => item.id === expectedCase.id)?.requirements.find(item => item.id === requirement.id);
      if (changed && result && !result.covered) masksDetected++;
    }
  }
  return { curated, empty, masks, masksDetected, allRemovalMasksDetected: masks === masksDetected, sourceAndQuestionIdentityChecksPassing: curated.sourceAndQuestionIdentityChecksPassing };
}

export async function createFreezeManifest(descriptorPath) {
  const descriptorRead = await readJsonStrict(descriptorPath, "freeze descriptor"), descriptor = descriptorRead.value;
  if (descriptor?.version !== 1 || !Array.isArray(descriptor.files) || !Array.isArray(descriptor.commands)) fail("invalid freeze descriptor");
  const files = [];
  for (const item of descriptor.files) {
    if (typeof item?.role !== "string" || typeof item.path !== "string") fail("invalid freeze file entry");
    const metadata = await lstat(item.path);
    if (!metadata.isFile()) fail(`freeze input is not a regular file: ${item.path}`);
    const bytes = await readFile(item.path);
    files.push({ role: item.role, path: path.resolve(item.path), bytes: bytes.length, sha256: sha256(bytes) });
  }
  return { version: 1, runtime: process.version, descriptor: { path: path.resolve(descriptorPath), sha256: descriptorRead.sha256 }, commands: descriptor.commands, files };
}

export async function verifyFreezeManifest(manifestPath) {
  const manifest = (await readJsonStrict(manifestPath, "freeze manifest")).value;
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || typeof manifest.runtime !== "string") fail("invalid freeze manifest");
  if (manifest.runtime !== process.version) fail(`freeze runtime mismatch: expected ${manifest.runtime}, actual ${process.version}`);
  for (const item of manifest.files) {
    const metadata = await lstat(item.path);
    if (!metadata.isFile()) fail(`freeze input is not a regular file: ${item.path}`);
    const bytes = await readFile(item.path);
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) fail(`freeze hash mismatch: ${item.role} ${item.path}`);
  }
  return { valid: true, runtime: process.version, filesVerified: manifest.files.length };
}

function parseArgs(argv, schemas) {
  const [mode, ...rest] = argv;
  const schema = schemas[mode];
  if (!schema) fail(`unknown mode: ${mode ?? "(missing)"}`);
  const args = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!flag?.startsWith("--") || index + 1 >= rest.length) fail("options require --name value pairs");
    const name = flag.slice(2);
    if (!schema.has(name) || Object.hasOwn(args, name)) fail(`unknown or duplicate option for ${mode}: ${flag}`);
    args[name] = rest[index + 1];
  }
  for (const name of schema) if (!Object.hasOwn(args, name)) fail(`missing --${name}`);
  return { mode, args };
}

async function runBaseline(dataset, binding, harness) {
  const args = [harness, `--dataset=${dataset}`, `--binding=${binding}`, "--mode=search", `--limits=${JSON.stringify({ excerptFiles: 4, excerptCharacters: 6000 })}`];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk)); child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(`baseline harness failed (${code}): ${Buffer.concat(stderr)}`)));
  });
}

async function main() {
  const schemas = {
    baseline: new Set(["dataset", "bindings", "harness", "output-root", "output"]),
    select: new Set(["baseline", "bindings", "output-root", "output"]),
    replay: new Set(["candidate", "baseline", "bindings", "output-root", "output"]),
    score: new Set(["packets", "key", "key-sha256", "output-root", "output"]),
    controls: new Set(["packets", "key", "key-sha256", "output-root", "output"]),
    freeze: new Set(["descriptor", "output-root", "output"]),
    "verify-freeze": new Set(["manifest", "output-root", "output"]),
  };
  const { mode, args } = parseArgs(process.argv.slice(2), schemas);
  let result, sources;
  if (mode === "baseline") { result = await runBaseline(args.dataset, args.bindings, args.harness); sources = [args.dataset, args.bindings, args.harness]; }
  else if (mode === "select") { result = Buffer.from(`${JSON.stringify(await reconstructCandidateB({ searchResultsPath: args.baseline, bindingsPath: args.bindings }), null, 2)}\n`); sources = [args.baseline, args.bindings]; }
  else if (mode === "replay") { result = Buffer.from(`${JSON.stringify(await replayCandidateB({ candidatePath: args.candidate, searchResultsPath: args.baseline, bindingsPath: args.bindings }), null, 2)}\n`); sources = [args.candidate, args.baseline, args.bindings]; }
  else if (mode === "freeze") { result = Buffer.from(`${JSON.stringify(await createFreezeManifest(args.descriptor), null, 2)}\n`); sources = [args.descriptor]; }
  else if (mode === "verify-freeze") { result = Buffer.from(`${JSON.stringify(await verifyFreezeManifest(args.manifest), null, 2)}\n`); sources = [args.manifest]; }
  else {
    const packets = await readJsonStrict(args.packets, "packets"), key = await readJsonStrict(args.key, "key");
    if (key.sha256 !== args["key-sha256"]) fail("key hash mismatch");
    const value = mode === "score" ? scorePackets(packets.value, key.value, { expectedKeySha256: args["key-sha256"], keyBytes: key.bytes }) : runControls(packets.value, key.value);
    result = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); sources = [args.packets, args.key];
  }
  await writeExclusiveContained(args["output-root"], args.output, result, { sourcePaths: sources });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
