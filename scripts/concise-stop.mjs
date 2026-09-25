#!/usr/bin/env node
// Concise gate (Patron decree 2026-09-25): the orchestrator's replies default
// to <=6 lines. This Stop hook blocks a stop whose final assistant text runs
// long, unless the latest user message granted "expand". Enforcement is a
// hook, never a memory (CLAUDE.md standing rule).
import { readFileSync } from "node:fs";

const LIMIT = 12; // hard ceiling; the soft target of 6 stays in prose habits
let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}
let transcriptPath;
try {
  transcriptPath = JSON.parse(input).transcript_path;
} catch {
  process.exit(0);
}
if (!transcriptPath) process.exit(0);

let lines;
try {
  lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
} catch {
  process.exit(0);
}

let lastAssistantText = "";
let expandGranted = false;
for (let i = lines.length - 1; i >= 0; i--) {
  let e;
  try {
    e = JSON.parse(lines[i]);
  } catch {
    continue;
  }
  const m = e.message;
  if (!m) continue;
  if (!lastAssistantText && m.role === "assistant" && Array.isArray(m.content)) {
    lastAssistantText = m.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  } else if (m.role === "user") {
    const t =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n")
          : "";
    if (!t.includes("system-reminder") && t.trim()) {
      expandGranted = /\bexpand\b/i.test(t);
      break;
    }
  }
}

if (expandGranted) process.exit(0);
const count = lastAssistantText.split("\n").filter((l) => l.trim()).length;
if (count > LIMIT) {
  console.error(
    `concise gate: final reply is ${count} non-empty lines (limit ${LIMIT}; target 6). Shorten it — outcome first, one line per point, link records instead of restating. The Patron says "expand" to lift the gate.`,
  );
  process.exit(2);
}
process.exit(0);
