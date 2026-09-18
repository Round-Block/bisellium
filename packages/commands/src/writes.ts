/**
 * packages/cli/src/writes.ts — W-012: the five write commands (`handoff`,
 * `emit`, `answer`, `greenlight`, `budget`). Kept out of main.ts on purpose,
 * same as verify.ts (W-005/W-006) — the integrator wires these in
 * alongside the other builders' commands.
 *
 * Every front-matter edit here goes through `editOpusFrontMatter`
 * (frontmatter.ts): merge into the yaml Document API, never replace, so
 * untouched keys, comments and key order survive and the body travels
 * through byte-for-byte unless a caller explicitly rewrites it — the exact
 * discipline verify.ts established for the first tool-written change to an
 * opus. `answer`, `greenlight` and `budget` are Patron writes: the CLI sets
 * `BISELLIUM_ROLE=patron` for them (defaulted to "patron" here so calling
 * the functions directly, as the tests do, doesn't need a wrapper), and
 * every one of them also appends a line to `<studio>/timeline/patron.jsonl`
 * — the Patron's own append-only record, separate from `receipts/` (which
 * is `bisellium run` sessions) and from `events.jsonl` (which is derived
 * workflow telemetry).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { readManifest, type Manifest } from "@bisellium/adapter-native";
import { appendEvents, EVENTS_LOG_REL, readLog } from "@bisellium/core";
import { WF, type GantryEvent } from "@bisellium/schema";
import { editOpusFrontMatter, splitFront } from "./frontmatter.js";

export interface WriteOptions {
  /** Pinned clock, for reproducible timestamps/events in tests — same
   *  shape as run.ts's RunOptions.now. Overridden by an explicit --now. */
  now?: Date;
}

export interface WriteResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Shared argv/studio/event/timeline plumbing
// ---------------------------------------------------------------------------

export interface FlagSpec {
  valued?: string[];
  boolean?: string[];
}
export interface ParsedFlags {
  values: Map<string, string>;
  flags: Set<string>;
  positionals: string[];
}

/** Minimal, strict flag parser shared by all five commands: any `--flag`
 *  not declared in `spec` is a usage error, never a silent no-op — this is
 *  what makes budget refuse an arbitrary `--burn-anything` flag. */
export function parseFlags(args: string[], spec: FlagSpec): ParsedFlags | { error: string } {
  const valued = new Set(spec.valued ?? []);
  const boolean = new Set(spec.boolean ?? []);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (boolean.has(a)) {
        flags.add(a);
        continue;
      }
      if (valued.has(a)) {
        const v = args[++i];
        if (v === undefined) return { error: `${a} needs a value` };
        values.set(a, v);
        continue;
      }
      return { error: `unknown flag "${a}"` };
    }
    positionals.push(a);
  }
  return { values, flags, positionals };
}

/** `--now <iso>` if given, else `opts.now`, else the real clock. `undefined`
 *  return means an explicit --now failed to parse as a date. */
export function resolveNow(flagValue: string | undefined, fallback: Date | undefined): Date | undefined {
  if (flagValue === undefined) return fallback ?? new Date();
  const d = new Date(flagValue);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export interface OpenedStudio {
  root: string;
  manifest: Manifest;
}

/**
 * Resolves a caller-supplied id (`--opus`, `--petitio`) to `<dir>/<id>.md`
 * and refuses anything that would land outside `dir`. An id containing a
 * path separator or a bare `.`/`..` segment is rejected outright, which is
 * enough on its own to keep `join(dir, id + ".md")` inside `dir` — the
 * containment check below is defense in depth against join()'s own
 * normalization ever surprising us. Matches the house convention
 * `verify.ts` already follows via `snapshotDir(...).opera.find`.
 */
export function safeItemPath(dir: string, id: string): string | { error: string } {
  if (!id || /[\\/]/.test(id) || id === "." || id === "..") return { error: `invalid id "${id}"` };
  const resolvedDir = resolve(dir);
  const path = join(resolvedDir, `${id}.md`);
  if (dirname(path) !== resolvedDir) return { error: `invalid id "${id}"` };
  return path;
}

/** Resolves `studioArg` (default ".") and confirms it's a readable studio —
 *  same not-a-studio wording verify.ts and run.ts use. */
export function openStudio(studioArg: string | undefined): OpenedStudio | { error: string } {
  const root = resolve(studioArg ?? ".");
  const manifestPath = join(root, "bisellium.yml");
  if (!existsSync(manifestPath)) return { error: `${manifestPath} not found — not a studio` };
  try {
    return { root, manifest: readManifest(root) };
  } catch (e) {
    return { error: `${manifestPath} unparseable — not a studio: ${(e as Error).message}` };
  }
}

/** Same slugging adapter-native's createBiselliumAdapter uses for its
 *  default projectId, so events emitted here line up with the studio's own
 *  snapshots. */
function projectIdFor(manifest: Manifest): string {
  return manifest.studio.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Reads an opus/petitio's current `state` without going through the full
 *  adapter (which trims the body) — every command here needs this before it
 *  decides what to write. */
export function readState(path: string): string | { error: string } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { error: `could not read ${path}: ${(e as Error).message}` };
  }
  const split = splitFront(raw);
  if (!split) return { error: `${path}: missing front matter` };
  const state = parseDocument(split.front).get("state");
  return typeof state === "string" ? state : "";
}

/** Appends one workflow.* event to `<studio>/.bisellium/events.jsonl`
 *  (EVENTS_LOG_REL, `@bisellium/core` — the same file a Store reads/appends
 *  to, so a CLI write and a running Store never fork the log), seq'd off the
 *  log's current length (this file's simpler seq scheme — not the
 *  per-source counter @bisellium/core's Store keeps for snapshot diffing). */
export function emitEvent(root: string, manifest: Manifest, name: string, now: Date, attrs: Record<string, string | number | boolean>): void {
  const logPath = join(root, EVENTS_LOG_REL);
  const seq = readLog(logPath).events.length;
  const event: GantryEvent = {
    id: `cli:${seq}`,
    name,
    ts: now.toISOString(),
    projectId: projectIdFor(manifest),
    attrs: { ...attrs, [WF.SOURCE]: "cli", [WF.SOURCE_SEQ]: seq },
  };
  appendEvents(logPath, [event]);
}

/** Every Patron write (answer/greenlight/budget) leaves one line here — the
 *  Patron's own append-only record. `BISELLIUM_ROLE` is set by the CLI
 *  wrapper around these commands; it defaults to "patron" so calling the
 *  functions directly (as the tests do) needs no wrapper. */
function appendPatronTimeline(root: string, entry: Record<string, unknown>): void {
  const path = join(root, "timeline", "patron.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  const role = process.env["BISELLIUM_ROLE"] || "patron";
  appendFileSync(path, JSON.stringify({ role, ...entry }) + "\n", "utf8");
}

function slugify(s: string, maxLen = 48): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "entry").slice(0, maxLen).replace(/-+$/, "") || "entry";
}

// ---------------------------------------------------------------------------
// 1. handoff
// ---------------------------------------------------------------------------

const HANDOFF_USAGE =
  "usage: bisellium handoff --opus <id> --sella <sella> [--stage <state>] --next <text> " +
  "[--blocked-on <text>] [--studio <dir>] [--now <iso>]";

export function runHandoff(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--opus", "--sella", "--stage", "--next", "--blocked-on", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${HANDOFF_USAGE}`);
    return { exitCode: 2 };
  }
  const { values } = parsed;
  const opusId = values.get("--opus");
  const sella = values.get("--sella");
  const next = values.get("--next");
  if (!opusId || !sella || !next) {
    console.error(HANDOFF_USAGE);
    return { exitCode: 2 };
  }
  const stageArg = values.get("--stage");
  const blockedOn = values.get("--blocked-on") ?? "none";

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;

  if (!(manifest.sellae ?? []).some((s) => s.id === sella)) {
    console.error(`unknown sella "${sella}" — not declared in bisellium.yml`);
    return { exitCode: 2 };
  }

  const opusPath = safeItemPath(join(root, "opera"), opusId);
  if (typeof opusPath !== "string") {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }
  if (!existsSync(opusPath)) {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }

  const currentState = readState(opusPath);
  if (typeof currentState !== "string") {
    console.error(currentState.error);
    return { exitCode: 2 };
  }
  if (stageArg !== undefined && stageArg !== currentState) {
    console.error(`--stage "${stageArg}" does not match opus state "${currentState}"`);
    return { exitCode: 2 };
  }
  const stage = stageArg ?? currentState;

  try {
    editOpusFrontMatter(opusPath, (doc) => {
      doc.setIn(["traditio", "sella"], sella);
      doc.setIn(["traditio", "stage"], stage);
      doc.setIn(["traditio", "next"], next);
      doc.setIn(["traditio", "blocked_on"], blockedOn);
      doc.setIn(["traditio", "at"], now.toISOString());
      return undefined;
    });
  } catch (e) {
    console.error(`handoff failed: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  console.log(`${opusId}: traditio -> sella=${sella} stage=${stage} next=${JSON.stringify(next)} blocked_on=${blockedOn}`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 2. emit
// ---------------------------------------------------------------------------

const EMIT_USAGE =
  "usage: bisellium emit <json> [--studio <dir>] [--now <iso>]\n" +
  "       bisellium emit --usage <tokens> --opus <id> --sella <sella> --model <model> [--studio <dir>] [--now <iso>]";

interface RawCliEvent {
  name: string;
  attrs?: Record<string, string | number | boolean>;
}

/** Minimal event shape: {name, attrs?}. Never throws — every failure comes
 *  back as an { error } the caller turns into exit 2. */
function parseRawEvent(json: string): RawCliEvent | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    return { error: `invalid JSON: ${(e as Error).message}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "event must be a JSON object" };
  const v = value as Record<string, unknown>;
  if (typeof v["name"] !== "string" || v["name"].length === 0) return { error: 'event needs a non-empty string "name"' };
  if (v["attrs"] === undefined) return { name: v["name"] };
  if (typeof v["attrs"] !== "object" || v["attrs"] === null || Array.isArray(v["attrs"])) return { error: '"attrs" must be an object' };
  const attrs: Record<string, string | number | boolean> = {};
  for (const [k, val] of Object.entries(v["attrs"] as Record<string, unknown>)) {
    if (typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean")
      return { error: `attrs["${k}"] must be a string, number or boolean` };
    attrs[k] = val;
  }
  return { name: v["name"], attrs };
}

/** Opus front matter is just enough to attribute a usage event to a
 *  collegium (`WF.DEPARTMENT`) — same file safeItemPath already validates
 *  containment for. Returns undefined (never throws) on anything
 *  unreadable/unparseable; --usage then omits WF.DEPARTMENT rather than
 *  failing the whole emit over an opus that happens to have no collegium. */
function opusCollegium(opusPath: string): string | undefined {
  try {
    const split = splitFront(readFileSync(opusPath, "utf8"));
    if (!split) return undefined;
    const front = parseDocument(split.front).toJS() as Record<string, unknown> | null;
    const collegium = front?.["collegium"];
    return typeof collegium === "string" && collegium.length > 0 ? collegium : undefined;
  } catch {
    return undefined;
  }
}

export function runEmit(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--studio", "--now", "--usage", "--opus", "--sella", "--model"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${EMIT_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;

  let raw: RawCliEvent;
  if (values.has("--usage")) {
    // --usage shortcut: appends a gen_ai.usage event, so `burn`
    // (packages/core/src/index-db.ts) derives collegium spend from real
    // recorded usage — the wire attrs a usage span needs (docs/ADOPTION.md,
    // packages/schema/src/index.ts's WF comment): gen_ai.usage.total_tokens,
    // WF.ITEM_ID, WF.ACTOR_ROLE, WF.DEPARTMENT.
    const tokensRaw = values.get("--usage");
    const tokens = tokensRaw !== undefined ? Number(tokensRaw) : NaN;
    const opusId = values.get("--opus");
    const sella = values.get("--sella");
    const model = values.get("--model");
    if (!Number.isFinite(tokens) || tokens < 0 || !opusId || !sella || !model) {
      console.error(EMIT_USAGE);
      return { exitCode: 2 };
    }
    if (!(manifest.sellae ?? []).some((s) => s.id === sella)) {
      console.error(`unknown sella "${sella}" — not declared in bisellium.yml`);
      return { exitCode: 2 };
    }
    const opusPath = safeItemPath(join(root, "opera"), opusId);
    if (typeof opusPath !== "string" || !existsSync(opusPath)) {
      console.error(`unknown opus: ${opusId}`);
      return { exitCode: 2 };
    }
    const attrs: Record<string, string | number | boolean> = {
      "gen_ai.usage.total_tokens": tokens,
      "gen_ai.request.model": model,
      [WF.ITEM_ID]: opusId,
      [WF.ACTOR_ROLE]: sella,
    };
    const collegium = opusCollegium(opusPath);
    if (collegium !== undefined) attrs[WF.DEPARTMENT] = collegium;
    raw = { name: "gen_ai.usage", attrs };
  } else {
    const json = positionals[0];
    if (json === undefined) {
      console.error(EMIT_USAGE);
      return { exitCode: 2 };
    }
    const parsedEvent = parseRawEvent(json);
    if ("error" in parsedEvent) {
      console.error(`emit: ${parsedEvent.error}`);
      return { exitCode: 2 };
    }
    raw = parsedEvent;
  }

  const logPath = join(root, EVENTS_LOG_REL);
  let event: GantryEvent;
  try {
    const seq = readLog(logPath).events.length;
    event = {
      id: `cli:${seq}`,
      name: raw.name,
      ts: now.toISOString(),
      projectId: projectIdFor(manifest),
      attrs: { ...(raw.attrs ?? {}), [WF.SOURCE]: "cli", [WF.SOURCE_SEQ]: seq },
    };
    appendEvents(logPath, [event]);
  } catch (e) {
    console.error(`emit failed: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  console.log(`${event.id}: ${event.name}`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 3. answer (Patron write)
// ---------------------------------------------------------------------------

const ANSWER_USAGE = "usage: bisellium answer --petitio <id> <reply…> [--ask-back] [--charter-gap] [--studio <dir>] [--now <iso>]";

export function runAnswer(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, {
    valued: ["--petitio", "--studio", "--now"],
    boolean: ["--ask-back", "--charter-gap"],
  });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${ANSWER_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, flags, positionals } = parsed;
  const petitioId = values.get("--petitio");
  const reply = positionals.join(" ").trim();
  if (!petitioId || !reply) {
    console.error(ANSWER_USAGE);
    return { exitCode: 2 };
  }
  const askBack = flags.has("--ask-back");
  const charterGap = flags.has("--charter-gap");

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;
  const patronId = manifest.patron ?? "patron";

  const petitioPath = safeItemPath(join(root, "petitiones"), petitioId);
  if (typeof petitioPath !== "string") {
    console.error(`unknown petitio: ${petitioId}`);
    return { exitCode: 2 };
  }
  if (!existsSync(petitioPath)) {
    console.error(`unknown petitio: ${petitioId}`);
    return { exitCode: 2 };
  }

  let firstLine = "";
  let petitioRawBefore: string;
  try {
    petitioRawBefore = readFileSync(petitioPath, "utf8");
    const split = splitFront(petitioRawBefore);
    if (!split) throw new Error("missing front matter");
    firstLine = split.body.trim().split("\n")[0] ?? "";
  } catch (e) {
    console.error(`could not read ${petitioPath}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  // --ask-back turns this into the Patron asking a follow-up — only sound
  // when the petitio is currently needs_you (the sella is the one waiting
  // on the Patron). Once it's already awaiting_reply (a prior --ask-back),
  // asking back again would flip from/to a second time, undoing the first
  // flip and corrupting the record — refuse instead, leaving the file
  // untouched, until the sella replies and moves it back to needs_you.
  if (askBack) {
    const currentState = readState(petitioPath);
    if (typeof currentState !== "string") {
      console.error(currentState.error);
      return { exitCode: 2 };
    }
    if (currentState !== "needs_you") {
      console.error(`--ask-back requires petitio "${petitioId}" to be needs_you (currently ${currentState || "?"})`);
      return { exitCode: 2 };
    }
  }

  const newState = askBack ? "awaiting_reply" : "resolved";

  // The petitio front-matter edit, the optional acta file and the Patron
  // timeline append must land together: if any later step throws, we roll
  // the petitio back to its pre-edit bytes and remove any acta file we
  // created, so a failure here can never leave a half-applied Patron write
  // (a mutated petitio with no matching acta/timeline record).
  let actaPath: string | undefined;
  try {
    editOpusFrontMatter(petitioPath, (doc, body) => {
      // --ask-back turns this into the Patron asking a follow-up: from/to
      // flip so `from` is the Patron (check.ts's petitio.direction rule for
      // awaiting_reply requires exactly that).
      if (askBack) {
        const askTo = doc.get("from");
        doc.setIn(["from"], patronId);
        doc.setIn(["to"], askTo);
      }
      doc.setIn(["state"], newState);
      return `${body}\n\n[stated] ${now.toISOString()} ${patronId}: ${reply}`;
    });

    if (charterGap) {
      const actaDir = join(root, "acta");
      mkdirSync(actaDir, { recursive: true });
      const dateStr = now.toISOString().slice(0, 10);
      const slug = slugify(`lex-gap-${firstLine}`);
      actaPath = join(actaDir, `${dateStr}-${slug}.md`);
      for (let n = 2; existsSync(actaPath); n++) actaPath = join(actaDir, `${dateStr}-${slug}-${n}.md`);
      const title = `Lex gap: ${firstLine}`;
      const front = `---\nauthor: ${JSON.stringify(patronId)}\nkind: decision\ntitle: ${JSON.stringify(title)}\nat: ${JSON.stringify(now.toISOString())}\n---\n`;
      const body = `${petitioId} surfaced a gap in the lex — proposing an amendment.\n\n> ${firstLine}\n\nPatron: ${reply}\n`;
      writeFileSync(actaPath, front + body);
    }

    appendPatronTimeline(root, {
      at: now.toISOString(),
      action: "answer",
      petitio: petitioId,
      state: newState,
      ask_back: askBack,
      charter_gap: charterGap,
    });
  } catch (e) {
    try {
      writeFileSync(petitioPath, petitioRawBefore);
    } catch {
      /* best-effort rollback */
    }
    if (actaPath !== undefined) {
      try {
        if (existsSync(actaPath)) unlinkSync(actaPath);
      } catch {
        /* best-effort rollback */
      }
    }
    console.error(`answer failed: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  console.log(`${petitioId}: ${newState}`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 4. greenlight (Patron write)
// ---------------------------------------------------------------------------

const GREENLIGHT_USAGE = "usage: bisellium greenlight <opus> [--decline <reason>] [--studio <dir>] [--now <iso>]";

export function runGreenlight(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--decline", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${GREENLIGHT_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const opusId = positionals[0];
  if (!opusId) {
    console.error(GREENLIGHT_USAGE);
    return { exitCode: 2 };
  }

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;

  const opusPath = safeItemPath(join(root, "opera"), opusId);
  if (typeof opusPath !== "string") {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }
  if (!existsSync(opusPath)) {
    console.error(`unknown opus: ${opusId}`);
    return { exitCode: 2 };
  }

  const currentState = readState(opusPath);
  if (typeof currentState !== "string") {
    console.error(currentState.error);
    return { exitCode: 2 };
  }
  if (currentState !== "backlog") {
    console.error(`${opusId} is not in backlog (state: ${currentState || "?"})`);
    return { exitCode: 2 };
  }

  const decline = values.get("--decline");

  // Same discipline as answer: the opus front-matter edit, the
  // workflow.greenlight event and the Patron timeline line must land
  // together. If the event or timeline append throws after the opus was
  // already mutated, roll the opus back so a crash never leaves it
  // greenlit/declined with no matching event or timeline record.
  let opusRawBefore: string;
  try {
    opusRawBefore = readFileSync(opusPath, "utf8");
  } catch (e) {
    console.error(`could not read ${opusPath}: ${(e as Error).message}`);
    return { exitCode: 2 };
  }
  try {
    editOpusFrontMatter(opusPath, (doc) => {
      if (decline !== undefined) doc.setIn(["declined"], decline);
      else doc.setIn(["state"], "greenlit");
      return undefined;
    });

    const attrs: Record<string, string | number | boolean> = { [WF.ITEM_ID]: opusId, [WF.GREENLIGHT]: decline !== undefined ? "declined" : "granted" };
    if (decline !== undefined) attrs["reason"] = decline;
    emitEvent(root, manifest, "workflow.greenlight", now, attrs);

    appendPatronTimeline(root, {
      at: now.toISOString(),
      action: "greenlight",
      opus: opusId,
      result: decline !== undefined ? "declined" : "granted",
      ...(decline !== undefined ? { reason: decline } : {}),
    });
  } catch (e) {
    try {
      writeFileSync(opusPath, opusRawBefore);
    } catch {
      /* best-effort rollback */
    }
    console.error(`greenlight failed: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  console.log(decline !== undefined ? `${opusId}: declined (${decline})` : `${opusId}: greenlit`);
  return { exitCode: 0 };
}

// ---------------------------------------------------------------------------
// 5. budget (Patron write)
// ---------------------------------------------------------------------------

const BUDGET_USAGE = "usage: bisellium budget <period> --collegium <id> --tokens <n> [--hours <n>] [--studio <dir>] [--now <iso>]";
const PERIOD_RE = /^\d{4}-W\d{2}$/;

export function runBudget(args: string[], opts: WriteOptions = {}): WriteResult {
  const parsed = parseFlags(args, { valued: ["--collegium", "--tokens", "--hours", "--studio", "--now"] });
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${BUDGET_USAGE}`);
    return { exitCode: 2 };
  }
  const { values, positionals } = parsed;
  const period = positionals[0];
  if (!period) {
    console.error(BUDGET_USAGE);
    return { exitCode: 2 };
  }
  if (!PERIOD_RE.test(period)) {
    console.error(`period "${period}" must match YYYY-Www (e.g. 2026-W39)`);
    return { exitCode: 2 };
  }

  const collegium = values.get("--collegium");
  const tokensRaw = values.get("--tokens");
  if (!collegium || tokensRaw === undefined) {
    console.error(BUDGET_USAGE);
    return { exitCode: 2 };
  }
  const tokens = Number(tokensRaw);
  if (!Number.isFinite(tokens) || tokens < 0) {
    console.error("--tokens must be a non-negative number");
    return { exitCode: 2 };
  }
  let hours: number | undefined;
  if (values.has("--hours")) {
    hours = Number(values.get("--hours"));
    if (!Number.isFinite(hours) || hours < 0) {
      console.error("--hours must be a non-negative number");
      return { exitCode: 2 };
    }
  }

  const now = resolveNow(values.get("--now"), opts.now);
  if (!now) {
    console.error("--now must be an ISO date");
    return { exitCode: 2 };
  }

  const opened = openStudio(values.get("--studio"));
  if ("error" in opened) {
    console.error(opened.error);
    return { exitCode: 2 };
  }
  const { root, manifest } = opened;

  if (!(manifest.collegia ?? []).some((c) => c.id === collegium)) {
    console.error(`unknown collegium "${collegium}" — not declared in bisellium.yml`);
    return { exitCode: 2 };
  }

  const aerariumDir = join(root, "aerarium");
  const path = join(aerariumDir, `${period}.yml`);

  // Same discipline as answer/greenlight: the aerarium write and the Patron
  // timeline append must land together. `existedBefore`/`rawBefore` let us
  // roll the aerarium file back to its pre-write bytes (or remove it, if we
  // created it) when the timeline append throws after the file was already
  // written.
  const existedBefore = existsSync(path);
  let rawBefore: string | undefined;
  if (existedBefore) {
    try {
      rawBefore = readFileSync(path, "utf8");
    } catch (e) {
      console.error(`could not read ${path}: ${(e as Error).message}`);
      return { exitCode: 2 };
    }
  }

  try {
    mkdirSync(aerariumDir, { recursive: true });
    const raw = rawBefore ?? `period: ${JSON.stringify(period)}\ncollegia: {}\n`;

    // Allowances only, merged in — never a wholesale rewrite, so a hand-added
    // comment or another collegium's entry survives untouched. Only
    // stipendium_tokens/stipendium_hours are ever written here; a burn* key
    // can only reach this file by hand (docs/ADOPTION.md: burn is derived,
    // never mirrored — `check` blocks on it either way).
    const doc = parseDocument(raw);
    doc.setIn(["period"], period);
    doc.setIn(["collegia", collegium, "stipendium_tokens"], tokens);
    if (hours !== undefined) doc.setIn(["collegia", collegium, "stipendium_hours"], hours);
    writeFileSync(path, doc.toString({ lineWidth: 0 }));

    appendPatronTimeline(root, {
      at: now.toISOString(),
      action: "budget",
      period,
      collegium,
      tokens,
      ...(hours !== undefined ? { hours } : {}),
    });
  } catch (e) {
    try {
      if (existedBefore) writeFileSync(path, rawBefore!);
      else if (existsSync(path)) unlinkSync(path);
    } catch {
      /* best-effort rollback */
    }
    console.error(`budget failed: ${(e as Error).message}`);
    return { exitCode: 2 };
  }

  console.log(`${period}: ${collegium} = ${tokens} tokens${hours !== undefined ? ` / ${hours} hours` : ""}`);
  return { exitCode: 0 };
}
