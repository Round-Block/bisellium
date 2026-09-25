#!/usr/bin/env node
/**
 * scripts/w084-citation-census.mjs — corpus evidence for W-084.
 *
 * Mirrors brief.behaviour_citation's three exclusions, records their
 * attribution in pipeline order, and writes the reproducible result to
 * studio/ci/W-084-citation-census.log.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
  return text
    .split("\n")
    .map((line) => line.replace(/(`+)[^`\n]*?\1/g, ""))
    .join("\n");
}

const paths = listMd(briefsDir);
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

for (const path of paths) {
  const text = readFileSync(path, "utf8");
  const declared = countBehaviours(text);
  if (declared > 0) declaring++;

  const fencedProse = withoutFences(text);
  const oldInlineProse = fencedProse.replace(/(`+)[\s\S]*?\1/g, "");
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
  `briefs: ${paths.length}`,
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
