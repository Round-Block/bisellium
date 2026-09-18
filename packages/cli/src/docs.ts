/**
 * `bisellium docs` — the docs registry (W-019). Every doc that opts in
 * carries front matter (`kind`, `owner`, `tier`, `review`, `kill` —
 * docs/*.md, README.md, GLOSSARY.md; `docs/design/` holds tracked HTML, not
 * markdown, and is never scanned). `buildRegistry` is pure and deterministic
 * (same tree + `now` in, byte-identical registry out); `runDocs` is the CLI
 * wrapper, self-parsing argv like `instructions`/`retro` (Seam S1) —
 * dispatched in main.ts before the generic flag parser.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { splitFront } from "./frontmatter.js";

export interface DocEntry {
  path: string;
  kind: string;
  owner: string;
  tier: string;
  review: string;
  kill: string;
}
export interface DocRegistry {
  at: string;
  docs: DocEntry[];
}

export const DOC_KINDS = ["contract", "model", "template", "guide", "index"] as const;
export const DOC_FRONT_KEYS = ["kind", "owner", "tier", "review", "kill"] as const;

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

/** ISO-string-or-nothing: yaml parses a bare `2026-12-01` as a `Date`, so a
 *  front-matter value read as data may be either — never a raw object. */
function toStringField(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export interface DocFile {
  /** repo-root-relative, forward-slashed. */
  path: string;
  data?: Dict;
  body: string;
}

/** README.md, GLOSSARY.md (repo root) and the top-level `docs/*.md` files
 *  (never recursing into docs/design/, which holds HTML, not markdown) —
 *  every file this opus's front-matter contract applies to, whether or not
 *  it has actually adopted it yet. Never throws; a missing repo root or
 *  unreadable file is simply absent from the result. */
export function collectDocFiles(repoRoot: string): DocFile[] {
  const candidates: string[] = [];
  for (const f of ["README.md", "GLOSSARY.md"]) if (existsSync(join(repoRoot, f))) candidates.push(f);
  const docsDir = join(repoRoot, "docs");
  if (existsSync(docsDir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(docsDir).filter((f) => {
        if (!f.endsWith(".md")) return false;
        try {
          return statSync(join(docsDir, f)).isFile();
        } catch {
          return false;
        }
      });
    } catch {
      entries = [];
    }
    for (const f of entries.sort()) candidates.push(`docs/${f}`);
  }

  const out: DocFile[] = [];
  for (const relPath of candidates) {
    let raw: string;
    try {
      raw = readFileSync(join(repoRoot, relPath), "utf8");
    } catch {
      continue;
    }
    const split = splitFront(raw);
    if (!split) {
      out.push({ path: relPath, body: raw });
      continue;
    }
    let data: unknown;
    try {
      data = parseYaml(split.front);
    } catch {
      out.push({ path: relPath, body: split.body });
      continue;
    }
    out.push({ path: relPath, data: isDict(data) ? data : undefined, body: split.body });
  }
  return out;
}

/** A doc is "registered" once it carries parseable front matter at all —
 *  field-level problems (unknown kind, missing key, …) are `doc.fields`'s
 *  job (rules/docs.ts), advisory and never a reason to drop it here. */
export function buildRegistry(repoRoot: string, now: Date): DocRegistry {
  const docs: DocEntry[] = collectDocFiles(repoRoot)
    .filter((d): d is DocFile & { data: Dict } => d.data !== undefined)
    .map((d) => ({
      path: d.path,
      kind: toStringField(d.data["kind"]) ?? "",
      owner: toStringField(d.data["owner"]) ?? "",
      tier: toStringField(d.data["tier"]) ?? "",
      review: toStringField(d.data["review"]) ?? "",
      kill: toStringField(d.data["kill"]) ?? "",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { at: now.toISOString(), docs };
}

const USAGE = "usage: bisellium docs registry [--repo <dir>] [--now <iso>]";

export function runDocs(args: string[]): { exitCode: number } {
  const [sub, ...rest] = args;
  if (sub !== "registry") {
    console.error(`docs: unknown subcommand: ${sub ?? ""}\n${USAGE}`);
    return { exitCode: 2 };
  }

  let repoArg = ".";
  let now = new Date();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--repo") {
      const v = rest[++i];
      if (v === undefined) {
        console.error(`docs: --repo needs a value\n${USAGE}`);
        return { exitCode: 2 };
      }
      repoArg = v;
    } else if (a === "--now") {
      const v = rest[++i];
      const d = v === undefined ? undefined : new Date(v);
      if (!d || Number.isNaN(d.getTime())) {
        console.error(`docs: --now is not a valid date: ${v ?? ""}\n${USAGE}`);
        return { exitCode: 2 };
      }
      now = d;
    } else {
      console.error(`docs: unknown flag: ${a}\n${USAGE}`);
      return { exitCode: 2 };
    }
  }

  const repoRoot = resolve(repoArg);
  if (!existsSync(repoRoot)) {
    console.error(`docs: no such directory: ${repoArg}`);
    return { exitCode: 2 };
  }

  const registry = buildRegistry(repoRoot, now);
  const outDir = join(repoRoot, ".bisellium");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`docs registry: ${registry.docs.length} doc(s) at ${registry.at} -> .bisellium/registry.json`);
  return { exitCode: 0 };
}
