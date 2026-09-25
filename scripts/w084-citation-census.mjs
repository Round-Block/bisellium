#!/usr/bin/env node
/**
 * scripts/w084-citation-census.mjs — corpus evidence for W-084.
 *
 * Mirrors brief.behaviour_citation's three exclusions, records their
 * attribution in pipeline order, and writes the reproducible result to
 * studio/ci/W-084-citation-census.log.
 */
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { listMd } from "@bisellium/adapter-native";
import { countBehaviours } from "../packages/cli/src/rules/evidence.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const briefsDir = join(repoRoot, "studio", "briefs");
const evidencePath = join(repoRoot, "studio", "ci", "W-084-citation-census.log");
const citationRe = /\bBehaviour (\d+)\b/g;

function matches(text) {
  return [...text.matchAll(citationRe)];
}

function withoutFences(text) {
  const prose = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s{0,3}```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) prose.push(line);
  }
  return prose.join("\n");
}

function withoutInline(text) {
  return text.split("\n").map(stripBacktickSpans).join("\n");
}

function backtickRuns(text) {
  const runs = [];
  for (let cursor = 0; cursor < text.length;) {
    const start = text.indexOf("`", cursor);
    if (start === -1) break;
    let end = start + 1;
    while (text[end] === "`") end++;
    runs.push({ start, end, length: end - start });
    cursor = end;
  }
  return runs;
}

/** Linear equivalent of /(`+)[^`\n]*?\1/g for one line. */
function stripBacktickSpans(text) {
  const runs = backtickRuns(text);
  let output = "";
  let copyFrom = 0;
  let position = 0;
  let runIndex = 0;
  while (runIndex < runs.length) {
    const run = runs[runIndex];
    const start = Math.max(position, run.start);
    if (start >= run.end) {
      runIndex++;
      continue;
    }

    const openingLength = run.end - start;
    const next = runs[runIndex + 1];
    if (next && next.length >= openingLength) {
      output += text.slice(copyFrom, start);
      position = next.start + openingLength;
      copyFrom = position;
      runIndex++;
      continue;
    }

    const selfClosingLength = Math.floor(openingLength / 2);
    if (selfClosingLength === 0) break;
    output += text.slice(copyFrom, start);
    position = start + 2 * selfClosingLength;
    copyFrom = position;
  }
  return output + text.slice(copyFrom);
}

/** Linear equivalent of the census's historical /(`+)[\s\S]*?\1/g
 * comparison. Suffix maxima reproduce the greedy capture's fallback without
 * retrying the whole remaining text for every possible delimiter length. */
function stripLegacyBacktickSpans(text) {
  const runs = backtickRuns(text);
  const suffixMax = new Array(runs.length + 1).fill(0);
  for (let i = runs.length - 1; i >= 0; i--) suffixMax[i] = Math.max(runs[i].length, suffixMax[i + 1]);

  let output = "";
  let copyFrom = 0;
  let position = 0;
  let runIndex = 0;
  while (runIndex < runs.length) {
    const run = runs[runIndex];
    const start = Math.max(position, run.start);
    if (start >= run.end) {
      runIndex++;
      continue;
    }

    const openingLength = run.end - start;
    const delimiterLength = Math.max(Math.floor(openingLength / 2), Math.min(openingLength, suffixMax[runIndex + 1]));
    if (delimiterLength === 0) break;
    output += text.slice(copyFrom, start);

    if (delimiterLength <= Math.floor(openingLength / 2)) {
      position = start + 2 * delimiterLength;
      copyFrom = position;
      continue;
    }

    let closingIndex = runIndex + 1;
    while (runs[closingIndex].length < delimiterLength) closingIndex++;
    position = runs[closingIndex].start + delimiterLength;
    copyFrom = position;
    runIndex = closingIndex;
  }
  return output + text.slice(copyFrom);
}

const documents = [];
for (const path of listMd(briefsDir)) {
  try {
    if (!lstatSync(path).isFile()) continue;
    documents.push({ path, text: readFileSync(path, "utf8") });
  } catch {
    // The rule's contract silently skips unreadable briefs.
  }
}
let declaring = 0;
let raw = 0;
let fenced = 0;
let inline = 0;
let quoted = 0;
let live = 0;
let fencedProseChars = 0;
let oldInlineDeletedChars = 0;
let newInlineDeletedChars = 0;
const offenders = [];

for (const { path, text } of documents) {
  const declared = countBehaviours(text);
  if (declared > 0) declaring++;

  const fencedProse = withoutFences(text);
  const oldInlineProse = stripLegacyBacktickSpans(fencedProse);
  const inlineProse = withoutInline(fencedProse);
  const quotedProse = inlineProse.replace(/"(?:\\.|[^"\\])*"/g, "");

  const rawCount = matches(text).length;
  const fencedCount = matches(fencedProse).length;
  const inlineCount = matches(inlineProse).length;
  const liveMatches = matches(quotedProse);
  raw += rawCount;
  fenced += rawCount - fencedCount;
  inline += fencedCount - inlineCount;
  quoted += inlineCount - liveMatches.length;
  live += liveMatches.length;
  fencedProseChars += fencedProse.length;
  oldInlineDeletedChars += fencedProse.length - oldInlineProse.length;
  newInlineDeletedChars += fencedProse.length - inlineProse.length;

  if (declared > 0) {
    for (const match of liveMatches) {
      const cited = Number(match[1]);
      if (cited > declared) offenders.push(`${relative(repoRoot, path)}: Behaviour ${cited} > ${declared}`);
    }
  }
}

const percent = (part, whole) => `${((part / whole) * 100).toFixed(3)}% (${part}/${whole} chars)`;
const lines = [
  "# W-084 citation census",
  `briefs: ${documents.length}`,
  `declaring behaviours: ${declaring}`,
  `raw Behaviour-N matches: ${raw}`,
  `live matches: ${live}`,
  `excluded fenced: ${fenced}`,
  `excluded inline: ${inline}`,
  `excluded quoted: ${quoted}`,
  `out of range: ${offenders.length}`,
  `offenders: ${offenders.length === 0 ? "none" : offenders.join("; ")}`,
  `inline prose deletion before: ${percent(oldInlineDeletedChars, fencedProseChars)}`,
  `inline prose deletion after: ${percent(newInlineDeletedChars, fencedProseChars)}`,
  "",
];

writeFileSync(evidencePath, lines.join("\n"));
process.stdout.write(lines.join("\n"));
