/**
 * `bisellium new` — allocate the next work-item id and scaffold its file.
 * Contract: newItem never throws.
 *
 * `runNew` (Seam S1) is the self-parsing entry point the integrator wires
 * in main.ts BEFORE the generic flag parser — same convention as
 * run/verify/talk/tick today. It's a superset of the old inline `new`
 * handling: every existing flag/exit code is unchanged, byte for byte
 * (cli.test.ts, which this builder does not own, must stay green), plus
 * `--spec <path>` and `--brief` (Design collegium, W-018).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Manifest } from "@bisellium/adapter-native";
import { createNextRecord } from "@bisellium/commands/ids.js";
import { isNativeOpusKind, loadNativeRecords, titleProblem, validateNativeRecord } from "@bisellium/commands/opus-model.js";

export interface NewOptions {
  kind: string;
  collegium: string;
  title: string;
  arc?: string;
  parent?: string;
}

export interface NewResult {
  ok: boolean;
  message: string;
  id?: string;
  /** true when `dir` isn't a studio at all (missing/unparseable manifest) — main.ts exits 2, not 1. */
  notAStudio?: boolean;
}

/**
 * Private W-101 test seam.  A focused child-process test supplies a fresh
 * temporary directory, waits for two `<pid>.ready` files, then creates the
 * `release` file.  Keeping the wait after rendering and before the first
 * write makes the existing scan/write race deterministic without adding a
 * public flag or changing an ordinary invocation.  It is one-shot because
 * the eventual exclusive-create implementation retries after EEXIST and a
 * retry must not re-enter the barrier.
 */
let idsTestBarrierUsed = false;
function waitAtIdsTestBarrier(candidate: string): void {
  const barrierDir = process.env["BISELLIUM_IDS_TEST_BARRIER_DIR"];
  if (!barrierDir || idsTestBarrierUsed) return;
  idsTestBarrierUsed = true;
  writeFileSync(join(barrierDir, `${process.pid}.ready`), candidate, { flag: "wx" });
  const release = join(barrierDir, "release");
  const deadline = Date.now() + 30_000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(release)) {
    if (Date.now() >= deadline) throw new Error(`ids test barrier timed out waiting for ${release}`);
    Atomics.wait(sleeper, 0, 0, 10);
  }
}

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

    if (!isNativeOpusKind(opts.kind)) return { ok: false, message: `kind ${JSON.stringify(opts.kind)} is not a native opus kind` };
    const badTitle = titleProblem(opts.title);
    if (badTitle) return { ok: false, message: badTitle };
    const loaded = loadNativeRecords(root);
    if (loaded.problems.length) return { ok: false, message: loaded.problems[0]!.problem.message };
    const proposed = { id: "W-0", title: opts.title, kind: opts.kind, collegium: opts.collegium, state: "backlog", arc: opts.arc, parent: opts.parent };
    const problem = validateNativeRecord(proposed, loaded.records).find((candidate) => candidate.rule !== "opus.title" && candidate.rule !== "opus.kind") ??
      validateNativeRecord(proposed, loaded.records)[0];
    if (problem) return { ok: false, message: `${problem.rule}: ${problem.message}` };

    const { id } = createNextRecord(root, "opera", "W", (candidate) => {
      const candidateProblem = validateNativeRecord({ ...proposed, id: candidate }, loaded.records)[0];
      if (candidateProblem) throw new Error(`${candidateProblem.rule}: ${candidateProblem.message}`);
      return `---
id: ${JSON.stringify(candidate)}
title: ${JSON.stringify(opts.title)}
kind: ${JSON.stringify(opts.kind)}
collegium: ${JSON.stringify(opts.collegium)}
state: backlog
${opts.arc === undefined ? "" : `arc: ${JSON.stringify(opts.arc)}\n`}${opts.parent === undefined ? "" : `parent: ${JSON.stringify(opts.parent)}\n`}probationes: {}
---
`;
    });
    return { ok: true, message: id, id };
  } catch (e) {
    return { ok: false, message: `new failed: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Seam S1 — runNew: self-parsing `bisellium new`
// ---------------------------------------------------------------------------

const NEW_USAGE =
  "usage: bisellium new --kind <kind> --collegium <collegium> --title <title> [--arc <id>] [--parent <id>] [--spec <path>] [--brief] [dir]";

const BRIEF_SECTIONS = ["Intent", "Files owned", "Interfaces", "Behaviours to test", "Acceptance", "Out of scope"];

function briefTemplate(id: string, title: string): string {
  const sections = BRIEF_SECTIONS.map((s) => `## ${s}\n\nTODO.\n`).join("\n");
  return `# ${id} — ${title}\n\n${sections}`;
}

/** `--spec <path>` must be an officina-relative path with no leading `/`
 *  and no `..` segment, and must resolve inside the officina — never an
 *  absolute path, never something that escapes it via `..`. */
function validSpecPath(root: string, specPath: string): boolean {
  if (isAbsolute(specPath)) return false;
  if (specPath.split(/[\\/]+/).includes("..")) return false;
  const rel = relative(root, resolve(root, specPath));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Minimal, strict self-contained argv parser (Seam S1): every command this
 *  cascade touches parses its own argv, dispatched in main.ts before the
 *  generic flag parser — the discipline that makes `--brief` (a bare
 *  boolean) and `--spec` work at all without one swallowing the other's
 *  value. Splits on the FIRST `=` only, same as main.ts's own parser, so a
 *  value may itself contain `=` (`--title='a=b: ship it'`). */
function parseNewArgs(args: string[]): { values: Map<string, string>; brief: boolean; positionals: string[] } | { error: string } {
  const values = new Map<string, string>();
  let brief = false;
  const positionals: string[] = [];
  const valuedFlags = new Set(["--kind", "--collegium", "--title", "--arc", "--parent", "--spec"]);

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) { positionals.push(a); continue; }
    const eq = a.indexOf("=");
    const k = eq === -1 ? a : a.slice(0, eq);
    const inline = eq === -1 ? undefined : a.slice(eq + 1);
    if (k === "--brief") {
      if (inline === undefined || inline === "true") { brief = true; continue; }
      if (inline === "false") { brief = false; continue; }
      return { error: `${k} must be true or false` };
    }
    if (!valuedFlags.has(k)) return { error: `flag ${k} not allowed for "new"\n${NEW_USAGE}` };
    const v = inline ?? args[++i];
    if (v === undefined) return { error: `${k} needs a value\n${NEW_USAGE}` };
    values.set(k, v);
  }
  return { values, brief, positionals };
}

export function runNew(args: string[]): { exitCode: number } {
  const parsed = parseNewArgs(args);
  if ("error" in parsed) { console.error(parsed.error); return { exitCode: 2 }; }
  const { values, brief, positionals } = parsed;

  const kind = values.get("--kind");
  const collegium = values.get("--collegium");
  const title = values.get("--title");
  if (!kind || !collegium || !title) { console.error(NEW_USAGE); return { exitCode: 2 }; }

  const root = resolve(positionals[0] ?? ".");
  const manifestPath = join(root, "bisellium.yml");
  if (!existsSync(manifestPath)) { console.error(`${manifestPath} not found — not a studio`); return { exitCode: 2 }; }

  let manifest: Manifest;
  try {
    manifest = parseYaml(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch (e) {
    console.error(`${manifestPath} unparseable — not a studio: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  const specOpt = values.get("--spec");
  if (specOpt !== undefined && !brief && !validSpecPath(root, specOpt)) {
    // Refused before anything is written: absolute, a `..` segment, or
    // resolves outside the officina.
    console.error(`--spec "${specOpt}" must be an officina-relative path with no ".." segment, inside the studio`);
    return { exitCode: 1 };
  }
  try {
    const collegia = manifest.collegia ?? [];
    if (!collegia.some((d) => d.id === collegium)) {
      console.error(`collegium "${collegium}" is not declared in ${manifestPath}`);
      return { exitCode: 1 };
    }
    if (!isNativeOpusKind(kind)) {
      console.error(`kind ${JSON.stringify(kind)} is not a native opus kind`);
      return { exitCode: 1 };
    }
    const badTitle = titleProblem(title);
    if (badTitle) {
      console.error(badTitle);
      return { exitCode: 1 };
    }
    const loaded = loadNativeRecords(root);
    if (loaded.problems.length) {
      console.error(loaded.problems[0]!.problem.message);
      return { exitCode: 1 };
    }
    const proposed = {
      id: "W-0",
      title,
      kind,
      collegium,
      state: "backlog",
      arc: values.get("--arc"),
      parent: values.get("--parent"),
    };
    const modelProblem = validateNativeRecord(proposed, loaded.records)[0];
    if (modelProblem) {
      console.error(`${modelProblem.rule}: ${modelProblem.message}`);
      return { exitCode: 1 };
    }

    const created = createNextRecord(root, "opera", "W", (id) => {
      const candidateProblem = validateNativeRecord({ ...proposed, id }, loaded.records)[0];
      if (candidateProblem) throw new Error(`${candidateProblem.rule}: ${candidateProblem.message}`);
      // --brief always wins over an explicit --spec: it creates the canonical
      // briefs/<id>.md and points spec: at exactly that path, so the two
      // never disagree.
      const briefRelPath = `briefs/${id}.md`;
      const specValue = brief ? briefRelPath : specOpt;
      const front = `---
id: ${JSON.stringify(id)}
title: ${JSON.stringify(title)}
kind: ${JSON.stringify(kind)}
collegium: ${JSON.stringify(collegium)}
state: backlog${specValue !== undefined ? `\nspec: ${JSON.stringify(specValue)}` : ""}
${values.get("--arc") === undefined ? "" : `arc: ${JSON.stringify(values.get("--arc"))}\n`}${values.get("--parent") === undefined ? "" : `parent: ${JSON.stringify(values.get("--parent"))}\n`}probationes: {}
---
`;
      waitAtIdsTestBarrier(id);
      return front;
    });
    if (brief) {
      const briefsDir = join(root, "briefs");
      mkdirSync(briefsDir, { recursive: true });
      try {
        writeFileSync(join(briefsDir, `${created.id}.md`), briefTemplate(created.id, title), { flag: "wx" });
      } catch (error) {
        unlinkSync(created.path);
        throw error;
      }
    }
    console.log(created.id);
    return { exitCode: 0 };
  } catch (e) {
    console.error(`new failed: ${(e as Error).message}`);
    return { exitCode: 1 };
  }
}
