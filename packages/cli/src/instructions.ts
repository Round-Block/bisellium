/**
 * `bisellium instructions` — the ROM tier every builder reads before it
 * reads anything else (W-017 dossier intent): `CLAUDE.md`, `AGENTS.md` and
 * `GLOSSARY.md` render from one template plus the manifest, so they cannot
 * drift from each other or from reality. Self-parsing argv, like
 * run/verify/talk/tick (Seam S1) — dispatched in main.ts before the generic
 * flag parser.
 *
 * `renderInstructions` is pure and deterministic: same `studioRoot` (same
 * `bisellium.yml` on disk) in, byte-identical output out, regardless of
 * `now` and with no absolute paths baked in — `now` is accepted only to
 * match the interface other renderers in this cascade share, and is never
 * interpolated into the content.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export interface RenderedInstructions {
  claude: string;
  agents: string;
  glossary: string;
}

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "instructions.template.md");

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads `bisellium.yml` loosely (never throws) — this command must still
 *  render something sane (an empty roles section) for a studio whose
 *  manifest is missing or broken; `check` is the place that blocks that. */
function readManifestLoosely(studioRoot: string): Dict {
  try {
    const text = readFileSync(join(studioRoot, "bisellium.yml"), "utf8").replace(/^﻿/, "");
    const v = parseYaml(text);
    return isDict(v) ? v : {};
  } catch {
    return {};
  }
}

function rolesSection(manifest: Dict): string {
  const collegia = Array.isArray(manifest["collegia"]) ? (manifest["collegia"] as unknown[]) : [];
  const rows = collegia
    .filter(isDict)
    .map((c) => {
      const id = typeof c["id"] === "string" ? c["id"] : "?";
      const magister = typeof c["magister"] === "string" ? c["magister"] : "?";
      return `- ${id} (magister: ${magister})`;
    });
  return rows.length > 0 ? rows.join("\n") : "- (no collegia declared)";
}

const CLAUDE_HARNESS = [
  "## Claude Code",
  "",
  "Hooks, subagents and slash commands are installed for this repo:",
  "- Hooks: `.claude/settings.json` (SessionStart/PreCompact re-inject context, Stop closes the receipt, PostToolUse on Write|Edit logs a tool event). The sella comes from `$BISELLIUM_SELLA` (default `guest`), never a `--sella` baked into a hook command.",
  "- Subagents: `.claude/agents/{builder,censor,architect,clerk}.md`, each pointing at its collegium's lex and `bisellium context`.",
  "- Slash commands: `.claude/commands/{tick,talk,retro,verify,check}.md` — exact invocations, since the CLI's flag allowlists are strict.",
].join("\n");

const NEUTRAL_HARNESS = [
  "## Harness",
  "",
  "This project assumes no particular harness: no hooks or subagents are",
  "installed for you. Boot yourself with `bisellium context --sella <you>",
  "studio` and re-run it after any compaction or context reset.",
].join("\n");

function fillTemplate(template: string, title: string, manifest: Dict, harness: string): string {
  return `${template
    .replace(/\{\{TITLE\}\}/g, title)
    .replace(/\{\{ROLES\}\}/g, rolesSection(manifest))
    .replace(/\{\{HARNESS\}\}/g, harness)
    .trimEnd()}\n`;
}

const VOCABULARY: Array<{ latin: string; english: string; meaning: string }> = [
  { latin: "Patron", english: "Owner", meaning: "the human who greenlights, funds and answers escalations." },
  { latin: "Collegium", english: "Department", meaning: "a group of sellae with a shared lex and magister." },
  { latin: "Magister", english: "Lead", meaning: "the collegium's default reviewer and escalation point." },
  { latin: "Sella", english: "Seat / actor", meaning: "one human or agent identity in the studio." },
  { latin: "Lex", english: "Charter", meaning: "a collegium's standing rules, in `leges/<collegium>.md`." },
  { latin: "Acta", english: "Digest", meaning: "an inform-and-proceed entry, not a request for approval." },
  { latin: "Petitio", english: "Ask / thread", meaning: "a question to the Patron not tied to one opus." },
  { latin: "Opus", english: "Work item", meaning: "one unit of work, tracked in `opera/<id>.md`." },
  { latin: "Probatio", english: "Gate", meaning: "one thing that must pass before an opus is done." },
  { latin: "Traditio", english: "Handoff", meaning: "the record of who has an opus now and what's next." },
  { latin: "Aerarium", english: "Budget", meaning: "a collegium's spend allowance for a period." },
  { latin: "Stipendium", english: "Allowance", meaning: "one sella's share of an aerarium." },
  { latin: "Officina", english: "Studio", meaning: "a directory of the files this glossary describes." },
  { latin: "Cascade", english: "Build round", meaning: "one batch of opera run together by a set of builders." },
  { latin: "Retrospectio", english: "Retro", meaning: "a cascade's closing review, written after it lands." },
];

const PROBATIO_KINDS = [
  { name: "automated", meaning: "a shell command; passes iff it exits 0." },
  { name: "agent", meaning: "a sella's verdict, recorded as evidence." },
  { name: "human", meaning: "the Patron's own call." },
];

function renderGlossary(): string {
  const rows = VOCABULARY.map((v) => `| ${v.latin} | ${v.english} | ${v.meaning} |`).join("\n");
  const kinds = PROBATIO_KINDS.map((k) => `- \`${k.name}\` — ${k.meaning}`).join("\n");
  return [
    "# Glossary",
    "",
    "Bisellium's product-facing contract uses Latin names. The wire-level",
    "`workflow.*` attribute names and the lifecycle state ids stay English",
    "everywhere, including inside Latin-named files — see `docs/ADOPTION.md`.",
    "",
    "| Latin | English | Meaning |",
    "|---|---|---|",
    rows,
    "",
    "## Probatio kinds",
    "",
    kinds,
    "",
  ].join("\n");
}

export function renderInstructions(studioRoot: string, _opts: { now?: Date } = {}): RenderedInstructions {
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  const manifest = readManifestLoosely(studioRoot);
  const claude = fillTemplate(template, "CLAUDE.md", manifest, CLAUDE_HARNESS);
  const agents = fillTemplate(template, "AGENTS.md", manifest, NEUTRAL_HARNESS);
  const glossary = renderGlossary();
  return { claude, agents, glossary };
}

function gitToplevel(dir: string): string | undefined {
  try {
    const out = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

const USAGE = "usage: bisellium instructions [--studio <dir>] [--repo <dir>] [--write] [--now <iso>]";

export function runInstructions(args: string[], opts: { now?: Date } = {}): { exitCode: number } {
  let studio = "studio";
  let repoArg: string | undefined;
  let write = false;
  let now = opts.now ?? new Date();

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--studio") {
      const v = args[++i];
      if (v === undefined) {
        console.error(`instructions: --studio needs a value\n${USAGE}`);
        return { exitCode: 2 };
      }
      studio = v;
    } else if (a === "--repo") {
      const v = args[++i];
      if (v === undefined) {
        console.error(`instructions: --repo needs a value\n${USAGE}`);
        return { exitCode: 2 };
      }
      repoArg = v;
    } else if (a === "--write") {
      write = true;
    } else if (a === "--now") {
      const v = args[++i];
      if (v === undefined) {
        console.error(`instructions: --now needs a value\n${USAGE}`);
        return { exitCode: 2 };
      }
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        console.error(`instructions: --now is not a valid date: ${v}\n${USAGE}`);
        return { exitCode: 2 };
      }
      now = d;
    } else {
      console.error(`instructions: unknown flag: ${a}\n${USAGE}`);
      return { exitCode: 2 };
    }
  }

  const studioRoot = resolve(studio);
  if (!existsSync(studioRoot)) {
    console.error(`instructions: no such studio directory: ${studio}`);
    return { exitCode: 2 };
  }
  const repoRoot = repoArg !== undefined ? resolve(repoArg) : (gitToplevel(studioRoot) ?? process.cwd());
  const rendered = renderInstructions(studioRoot, { now });

  if (!write) {
    console.log(rendered.claude);
    console.log(rendered.agents);
    console.log(rendered.glossary);
    return { exitCode: 0 };
  }

  writeFileSync(join(repoRoot, "CLAUDE.md"), rendered.claude);
  writeFileSync(join(repoRoot, "AGENTS.md"), rendered.agents);
  writeFileSync(join(repoRoot, "GLOSSARY.md"), rendered.glossary);
  return { exitCode: 0 };
}
