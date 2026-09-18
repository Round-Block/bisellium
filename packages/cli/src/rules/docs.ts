/**
 * packages/cli/src/rules/docs.ts — W-019 (2/2): the docs registry as a check
 * rule. Both `doc.fields` and `doc.link` are advisory only — documentation
 * drift never blocks a build (docs.ts's own header). `root` (Seam S2) is
 * the OFFICINA; README.md, GLOSSARY.md and docs/*.md live at the REPO ROOT,
 * reached only via `opts.repo` — same reasoning as rules/instructions.ts.
 * Never throws.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Finding, RuleOpts } from "../check.js";
import { collectDocFiles, DOC_FRONT_KEYS, DOC_KINDS, type DocFile } from "../docs.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function declaredSellae(manifest: unknown): { ids: Set<string>; patron: string } {
  const ids = new Set<string>();
  let patron = "patron";
  if (isDict(manifest)) {
    if (isString(manifest["patron"])) patron = manifest["patron"];
    const sellae = manifest["sellae"];
    if (Array.isArray(sellae)) for (const row of sellae) if (isDict(row) && isString(row["id"])) ids.add(row["id"]);
  }
  return { ids, patron };
}

function reviewDate(v: unknown): Date | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
  if (typeof v !== "string") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const isExternal = (href: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(href) || href.startsWith("mailto:");

function checkFields(doc: DocFile, opts: RuleOpts): Finding[] {
  const out: Finding[] = [];
  if (!isDict(doc.data)) return out; // unregistered doc: front-matter presence is its own concern, not doc.fields'

  for (const key of DOC_FRONT_KEYS) {
    if (doc.data[key] === undefined) out.push({ rule: "doc.fields", level: "advise", where: doc.path, message: `missing front-matter key "${key}"` });
  }

  const kind = doc.data["kind"];
  if (isString(kind) && !(DOC_KINDS as readonly string[]).includes(kind))
    out.push({ rule: "doc.fields", level: "advise", where: doc.path, message: `unregistered kind "${kind}"` });

  const owner = doc.data["owner"];
  if (isString(owner)) {
    const { ids, patron } = declaredSellae(opts.manifest);
    if (owner !== patron && !ids.has(owner))
      out.push({ rule: "doc.fields", level: "advise", where: doc.path, message: `owner "${owner}" is not a declared sella or the patron` });
  }

  const review = reviewDate(doc.data["review"]);
  if (doc.data["review"] !== undefined && review && review.getTime() < opts.now.getTime())
    out.push({ rule: "doc.fields", level: "advise", where: doc.path, message: `review date ${review.toISOString().slice(0, 10)} is before now` });

  return out;
}

function checkLinks(doc: DocFile, repo: string): Finding[] {
  const out: Finding[] = [];
  if (!doc.path.startsWith("docs/")) return out; // scoped to docs/*.md, not README.md/GLOSSARY.md
  const docDir = dirname(join(repo, doc.path));
  for (const m of doc.body.matchAll(LINK_RE)) {
    const href = m[1] ?? "";
    if (href.length === 0 || href.startsWith("#") || isExternal(href)) continue;
    const target = href.split("#")[0]!;
    if (target.length === 0) continue; // "#fragment" already handled above; guards a bare "file.md#frag" with empty target
    let exists = false;
    try {
      exists = existsSync(join(docDir, target));
    } catch {
      exists = false;
    }
    if (!exists) out.push({ rule: "doc.link", level: "advise", where: doc.path, message: `dead relative link "${href}"` });
  }
  return out;
}

export function checkDocs(_root: string, opts: RuleOpts): Finding[] {
  if (!opts.repo) return [];
  if (!existsSync(opts.repo)) return [];

  const findings: Finding[] = [];
  for (const doc of collectDocFiles(opts.repo)) {
    findings.push(...checkFields(doc, opts));
    findings.push(...checkLinks(doc, opts.repo));
  }
  return findings;
}
