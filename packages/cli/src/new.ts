/**
 * `bisellium new` — allocate the next work-item id and scaffold its file.
 * Contract: newItem never throws.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Manifest } from "@bisellium/adapter-native";

export interface NewOptions {
  kind: string;
  dept: string;
  title: string;
}

export interface NewResult {
  ok: boolean;
  message: string;
  id?: string;
}

const ID_RE = /^W-(\d+)\.md$/;

export function newItem(dir: string, opts: NewOptions): NewResult {
  try {
    const root = resolve(dir);
    const manifestPath = join(root, "bisellium.yml");
    if (!existsSync(manifestPath)) return { ok: false, message: `${manifestPath} not found — not a studio` };

    const manifest = parseYaml(readFileSync(manifestPath, "utf8")) as Manifest;
    const departments = manifest.departments ?? [];
    if (!departments.some((d) => d.id === opts.dept))
      return { ok: false, message: `department "${opts.dept}" is not declared in ${manifestPath}` };

    const workDir = join(root, "work");
    mkdirSync(workDir, { recursive: true });
    let max = 0;
    for (const f of readdirSync(workDir)) {
      const m = ID_RE.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const id = `W-${String(max + 1).padStart(3, "0")}`;

    const front = `---
id: ${JSON.stringify(id)}
title: ${JSON.stringify(opts.title)}
kind: ${JSON.stringify(opts.kind)}
department: ${JSON.stringify(opts.dept)}
state: backlog
gates: {}
---
`;
    writeFileSync(join(workDir, `${id}.md`), front);
    return { ok: true, message: id, id };
  } catch (e) {
    return { ok: false, message: `new failed: ${(e as Error).message}` };
  }
}
