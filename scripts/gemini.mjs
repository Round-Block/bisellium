/**
 * scripts/gemini.mjs — multi-provider caller for Google Gemini models.
 * Usage: node scripts/gemini.mjs [--model <model>] [--files file1 file2 ...] <prompt>
 *        node scripts/gemini.mjs [--model <model>] [--files file1 file2 ...] --prompt-file <path>
 *
 * Reads GEMINI_API_KEY from .env at repo root.
 * Passes file contents as context, prompt as the question.
 * Prints the response to stdout. Uses fetch directly (the SDK
 * routes to a stale endpoint for newer model names).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function loadKey() {
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^GEMINI_API_KEY=(.+)$/);
      if (m) return m[1].trim();
    }
  }
  return process.env.GEMINI_API_KEY;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let model = "gemini-3.8-flash";
  const files = [];
  const promptParts = [];
  let promptFile = null;
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--model" && args[i + 1]) {
      model = args[i + 1];
      i += 2;
    } else if (args[i] === "--files") {
      i++;
      while (i < args.length && !args[i].startsWith("--")) {
        files.push(args[i]);
        i++;
      }
    } else if (args[i] === "--prompt-file" && args[i + 1]) {
      promptFile = args[i + 1];
      i += 2;
    } else {
      promptParts.push(args[i]);
      i++;
    }
  }
  let prompt = promptParts.join(" ");
  if (promptFile) {
    const p = resolve(ROOT, promptFile);
    if (existsSync(p)) prompt = readFileSync(p, "utf8");
    else { console.error(`prompt file not found: ${promptFile}`); process.exit(1); }
  }
  return { model, files, prompt };
}

const { model, files, prompt } = parseArgs(process.argv);

if (!prompt) {
  console.error("usage: node scripts/gemini.mjs [--model <m>] [--files f1 f2 ...] <prompt|--prompt-file path>");
  process.exit(1);
}

const apiKey = loadKey();
if (!apiKey) {
  console.error("GEMINI_API_KEY not found in .env or environment");
  process.exit(1);
}

let context = "";
for (const f of files) {
  const p = resolve(ROOT, f);
  if (existsSync(p)) {
    context += `\n--- ${f} ---\n${readFileSync(p, "utf8")}\n`;
  } else {
    console.error(`warning: file not found: ${f}`);
  }
}

const fullPrompt = context ? `${context}\n---\n\n${prompt}` : prompt;

const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;
try {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] }),
  });
  const data = await res.json();
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.log(data.candidates[0].content.parts[0].text);
  } else if (data.error) {
    console.error(`gemini ${data.error.code}: ${data.error.message}`);
    process.exit(1);
  } else {
    console.error("gemini: unexpected response shape");
    console.error(JSON.stringify(data, null, 2).slice(0, 500));
    process.exit(1);
  }
} catch (e) {
  console.error(`gemini error: ${e.message}`);
  process.exit(1);
}
