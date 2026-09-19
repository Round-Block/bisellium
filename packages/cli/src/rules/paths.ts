/**
 * packages/cli/src/rules/paths.ts — D-008, `path.id.unvalidated` and
 * `path.escapes.officina`. Seam S2: `root` is the OFFICINA; never throws;
 * [] for a directory with no `bisellium.yml`.
 *
 * `check` is hermetic, so detection is over officina *data* (opera/,
 * petitiones/, decisions/, lessons/, acta/, receipts/), never a scan of
 * source text. This module dogfoods its own rule: no `startsWith` used as a
 * containment test anywhere below (`escapesOfficina` proves the relation
 * via the first segment of a `relative()` path instead).
 *
 * Built to block per P-001 item 4 (D-008 promoted, decreed 2026-09-19).
 * P-004 resolved: `path.escapes.officina` scoped to the contractually
 * officina-relative surfaces (opus spec: and gate evidence: paths only);
 * acta evidence stays with checkLink. Both rules promoted to blocking.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { listMd, readFront } from "@bisellium/adapter-native";
import { ID_RE } from "../check.js";
import type { Finding, RuleOpts } from "../check.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const isExternal = (href: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(href);

function safeFront(path: string): Dict | undefined {
  try {
    const fm = readFront<unknown>(path);
    return isDict(fm.data) ? fm.data : undefined;
  } catch {
    return undefined;
  }
}

function safeList(dir: string): string[] {
  try {
    return listMd(dir);
  } catch {
    return [];
  }
}

const badId = (id: string): boolean => !ID_RE.test(id) || id.includes("..");

/** Every `sella`/`collegium` key at any depth of a parsed front-matter
 *  mapping, plus every key of a top-level `probationes` mapping (opus gate
 *  ids) — the id-shaped values D-008 covers beyond the file's own `id`. */
function collectIdRefs(data: Dict): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const walk = (v: unknown, label: string) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${label}[${i}]`));
      return;
    }
    if (!isDict(v)) return;
    for (const [k, vv] of Object.entries(v)) {
      if ((k === "sella" || k === "collegium") && typeof vv === "string") out.push({ label: `${label}.${k}`, value: vv });
      walk(vv, `${label}.${k}`);
    }
  };
  walk(data, "front matter");

  const gates = data["probationes"];
  if (isDict(gates)) for (const gid of Object.keys(gates)) out.push({ label: "probationes key", value: gid });
  return out;
}

function checkIds(root: string): Finding[] {
  const findings: Finding[] = [];
  const rel = (p: string) => relative(root, p).split(sep).join("/");

  for (const dir of ["opera", "petitiones", "decisions", "lessons"]) {
    for (const p of safeList(join(root, dir))) {
      const data = safeFront(p);
      if (!data) continue;
      const where = rel(p);

      const id = data["id"];
      if (typeof id === "string" && id.length > 0 && badId(id))
        findings.push({ rule: "path.id.unvalidated", level: "block", where, message: `id "${id}" is not a valid id` });

      for (const ref of collectIdRefs(data))
        if (badId(ref.value))
          findings.push({ rule: "path.id.unvalidated", level: "block", where, message: `${ref.label} "${ref.value}" is not a valid id` });
    }
  }

  const receiptsDir = join(root, "receipts");
  if (existsSync(receiptsDir)) {
    let names: string[] = [];
    try {
      names = readdirSync(receiptsDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      let isDir = false;
      try {
        isDir = statSync(join(receiptsDir, name)).isDirectory();
      } catch {
        isDir = false;
      }
      if (isDir && badId(name))
        findings.push({ rule: "path.id.unvalidated", level: "block", where: "receipts/", message: `receipts directory name "${name}" is not a valid id` });
    }
  }
  return findings;
}

/** True when `href` resolved against `root` escapes it — proven by the
 *  first segment of `relative(root, resolve(root, href))`, never a
 *  string-prefix test. */
function escapesOfficina(root: string, href: string): boolean {
  if (isExternal(href)) return false;
  const rel = relative(root, resolve(root, href));
  if (isAbsolute(rel)) return true;
  const [first] = rel.split(sep);
  return first === "..";
}

function checkContainment(root: string): Finding[] {
  const findings: Finding[] = [];
  const rel = (p: string) => relative(root, p).split(sep).join("/");

  for (const p of safeList(join(root, "opera"))) {
    const data = safeFront(p);
    if (!data) continue;
    const where = rel(p);

    const spec = data["spec"];
    if (typeof spec === "string" && spec.length > 0 && escapesOfficina(root, spec))
      findings.push({ rule: "path.escapes.officina", level: "block", where, message: `spec "${spec}" resolves outside the officina` });

    const gates = data["probationes"];
    if (isDict(gates))
      for (const [gid, gv] of Object.entries(gates)) {
        if (!isDict(gv)) continue;
        const ev = gv["evidence"];
        if (typeof ev === "string" && ev.length > 0 && escapesOfficina(root, ev))
          findings.push({ rule: "path.escapes.officina", level: "block", where, message: `gate "${gid}" evidence "${ev}" resolves outside the officina` });
      }
  }

  return findings;
}

export function checkPaths(root: string, _opts: RuleOpts): Finding[] {
  if (!existsSync(join(root, "bisellium.yml"))) return [];
  return [...checkIds(root), ...checkContainment(root)];
}
