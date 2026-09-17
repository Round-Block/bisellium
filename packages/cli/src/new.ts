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
  collegium: string;
  title: string;
}

export interface NewResult {
  ok: boolean;
  message: string;
  id?: string;
  /** true when `dir` isn't a studio at all (missing/unparseable manifest) — main.ts exits 2, not 1. */
  notAStudio?: boolean;
}

const ID_RE = /^W-(\d+)\.md$/;

export function newItem(dir: string, opts: NewOptions): NewResult {
  const root = resolve(dir);
  const manifestPath = join(root, "bisellium.yml");
  if (!existsSync(manifestPath)) return { ok: false, notAStudio: true, message: `${manifestPath} not found — not a studio` };

  let manifest: Manifest;
  try {
    manifest = parseYaml(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch (e) {
    return { ok: false, notAStudio: true, message: `${manifestPath} unparseable — not a studio: ${(e as Error).message}` };
  }

  try {
    const collegia = manifest.collegia ?? [];
    if (!collegia.some((d) => d.id === opts.collegium))
      return { ok: false, message: `collegium "${opts.collegium}" is not declared in ${manifestPath}` };

    const operaDir = join(root, "opera");
    mkdirSync(operaDir, { recursive: true });
    let max = 0;
    for (const f of readdirSync(operaDir)) {
      const m = ID_RE.exec(f);
      if (m) max = Math.max(max, Number(m[1]));
    }
    const id = `W-${String(max + 1).padStart(3, "0")}`;

    const front = `---
id: ${JSON.stringify(id)}
title: ${JSON.stringify(opts.title)}
kind: ${JSON.stringify(opts.kind)}
collegium: ${JSON.stringify(opts.collegium)}
state: backlog
probationes: {}
---
`;
    writeFileSync(join(operaDir, `${id}.md`), front);
    return { ok: true, message: id, id };
  } catch (e) {
    return { ok: false, message: `new failed: ${(e as Error).message}` };
  }
}
