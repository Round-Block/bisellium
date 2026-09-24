/**
 * `bisellium talk` — the direct line over harness profiles (W-010). Talks to
 * one sella, from the Patron's seat: a deterministic query first (never
 * touching a model), else a real turn through the sella's harness (a
 * @bisellium/shim HarnessProfile), persisted as a resumable session and
 * appended to that sella's timeline. Kept out of main.ts on purpose — wired
 * in by the integrator alongside the other builders' commands.
 *
 * dossier: a conversation is chatter (timeline) unless it produces a
 * petitio or a decision — a reply line starting "PETITIO: <text>" opens a
 * petitio addressed to the patron, and one starting "ACTUM: <text>" writes
 * a decision acta entry. That's the seat's only way to escalate out of a
 * conversation; everything else stays in the timeline.
 *
 * Exit codes: 0 ok (including the deterministic-query fast path) · 2 usage
 * error / not a studio / unknown sella / unknown or unavailable harness ·
 * 3 the harness reported a usage/rate limit (posture "limited") · anything
 * else the harness's own turn.exitCode, relayed as-is.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readManifest, type Manifest } from "@bisellium/adapter-native";
import { filterEnv, HARNESS_PROFILES, makeSessionId, redact, writeReceiptEnd, writeReceiptStart, type HarnessProfile, type Turn } from "@bisellium/shim";
import { answer } from "./query.js";
import { buildContext } from "./context.js";
import { pauseWarning } from "./pause.js";

export interface RunTalkOptions {
  /** Harness registry override — tests inject { fake: fakeProfile, ... }
   *  instead of depending on real vendor CLIs being on PATH. Defaults to
   *  @bisellium/shim's HARNESS_PROFILES. */
  harnesses?: Record<string, HarnessProfile>;
}

export interface RunTalkResult {
  exitCode: number;
}

const USAGE =
  'usage: bisellium talk --sella <sella> [--studio <dir>] [--harness <id>] [--model-only] [--now <iso>] <message…>';

interface ParsedTalkArgs {
  sella: string;
  studio: string;
  harness?: string;
  modelOnly: boolean;
  now: Date;
  message: string;
}

function parseArgs(args: string[]): ParsedTalkArgs | { error: string } {
  let sella: string | undefined;
  let studio = ".";
  let harness: string | undefined;
  let modelOnly = false;
  let now = new Date();
  let message = "";

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--sella" || a === "--studio" || a === "--harness" || a === "--now") {
      const v = args[++i];
      if (v === undefined) return { error: `${a} needs a value\n${USAGE}` };
      if (a === "--sella") sella = v;
      else if (a === "--studio") studio = v;
      else if (a === "--harness") harness = v;
      else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return { error: `--now must be an ISO date\n${USAGE}` };
        now = d;
      }
      continue;
    }
    if (a === "--model-only") {
      modelOnly = true;
      continue;
    }
    if (a.startsWith("--")) return { error: `flag ${a} not allowed for "talk"\n${USAGE}` };
    // First non-flag token starts the message — everything from here to the
    // end of argv belongs to it (the spec's trailing "<message…>").
    message = args.slice(i).join(" ").trim();
    break;
  }

  if (!sella) return { error: `--sella is required\n${USAGE}` };
  if (!message) return { error: `a message is required\n${USAGE}` };
  return { sella, studio, harness, modelOnly, now, message };
}

// ---------------------------------------------------------------------------
// Session store: <studio>/sessions/<sella>.json (gitignored, local like
// receipts/ — docs/ADOPTION.md).
// ---------------------------------------------------------------------------

interface SessionRecord {
  harness: string;
  /** `null` means the harness gave back no usable sessionId on its last
   *  turn — a fresh start, not something a later call may resume. */
  sessionId: string | null;
  startedAt: string;
  lastAt: string;
  turns: number;
}

function sessionPathFor(root: string, sella: string): string {
  return join(root, "sessions", `${sella}.json`);
}

/** A record with no valid (non-empty string) sessionId can't be resumed —
 *  ignore it entirely (as if there were no session file at all) rather than
 *  ever resuming against "" or null. */
function readSession(path: string): (SessionRecord & { sessionId: string }) | undefined {
  try {
    const v: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof v !== "object" || v === null) return undefined;
    const r = v as Partial<SessionRecord>;
    if (typeof r.harness !== "string") return undefined;
    if (typeof r.sessionId !== "string" || r.sessionId.length === 0) return undefined;
    return {
      harness: r.harness,
      sessionId: r.sessionId,
      startedAt: typeof r.startedAt === "string" ? r.startedAt : "",
      lastAt: typeof r.lastAt === "string" ? r.lastAt : "",
      turns: typeof r.turns === "number" ? r.turns : 0,
    };
  } catch {
    return undefined;
  }
}

function writeSession(path: string, rec: SessionRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rec, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Timeline: <studio>/timeline/<sella>.jsonl — chatter (gitignored, local
// like receipts/). Escalation (a petitio or a decision) is what promotes a
// line of it into the studio's committed record.
// ---------------------------------------------------------------------------

interface TimelineEntry {
  at: string;
  sella: string;
  direction: "in" | "out";
  text: string;
  sessionId: string;
  model?: string;
  usage?: { input?: number; output?: number };
  /** Set only when the harness gave back no usable sessionId for this turn
   *  (see the session-store contract above) — flags the entry rather than
   *  silently recording an empty string. */
  note?: string;
}

function appendTimeline(root: string, sella: string, entries: TimelineEntry[]): void {
  const path = join(root, "timeline", `${sella}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Escalation: PETITIO:/ACTUM: lines in a reply.
// ---------------------------------------------------------------------------

const PETITIO_ID_RE = /^P-(\d+)\.md$/;

/** Allocates the next P-NNN and writes it, addressed to the patron. Returns the new id. */
function openPetitio(root: string, manifest: Manifest, sella: string, text: string, now: Date): string {
  const dir = join(root, "petitiones");
  mkdirSync(dir, { recursive: true });
  let max = 0;
  for (const f of readdirSync(dir)) {
    const m = PETITIO_ID_RE.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const id = `P-${String(max + 1).padStart(3, "0")}`;
  const patron = manifest.patron ?? "patron";
  const front =
    `---\n` +
    `id: ${JSON.stringify(id)}\n` +
    `from: ${JSON.stringify(sella)}\n` +
    `to: ${JSON.stringify(patron)}\n` +
    `state: needs_you\n` +
    `opened: ${JSON.stringify(now.toISOString())}\n` +
    `---\n${text}\n`;
  writeFileSync(join(dir, `${id}.md`), front);
  return id;
}

function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "decision";
}

/** Writes a `kind: decision` acta entry authored by `sella`. */
function writeActum(root: string, sella: string, text: string, now: Date): string {
  const dir = join(root, "acta");
  mkdirSync(dir, { recursive: true });
  const date = now.toISOString().slice(0, 10);
  const slug = slugify(text);
  let filename = `${date}-${slug}.md`;
  for (let n = 2; existsSync(join(dir, filename)); n++) filename = `${date}-${slug}-${n}.md`;
  const front =
    `---\n` +
    `author: ${JSON.stringify(sella)}\n` +
    `kind: decision\n` +
    `title: ${JSON.stringify(text.slice(0, 120))}\n` +
    `at: ${JSON.stringify(now.toISOString())}\n` +
    `---\n${text}\n`;
  writeFileSync(join(dir, filename), front);
  return filename;
}

/** Best-effort reset hint out of a usage-limit Turn's `raw` — never assumed present. */
function extractResetHint(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  for (const k of ["resetAt", "reset_at", "reset"]) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/** W-046 round 2 (behaviour 7, F-2), widened round 3 (F-4): a failed turn's
 *  `Turn.raw` takes one of four shapes across the two profiles, and the
 *  vendor's own diagnostic can live in any of them:
 *   - `{ stdout, stderr }` when no envelope parses (claude-code.ts, codex.ts)
 *     — a vanished resume session id, a bad provider name;
 *   - a parsed `is_error` envelope itself (claude-code.ts) — the vendor's
 *     structured error response, e.g. a mismatched model. `raw` here is the
 *     envelope, not a wrapper, so `result` (the vendor's own prose) and
 *     `api_error_status` live directly on it. Reading `result` *because*
 *     `is_error === true` is reading structured metadata, not "branching on
 *     the diagnostic" — the profile already branches on `is_error` itself
 *     (claude-code.ts's `reply` line); this function never inspects the
 *     diagnostic's own text to decide anything;
 *   - `{ error }` on a spawn failure (claude-code.ts, codex.ts) — the
 *     binary couldn't be launched at all.
 *  Collects every value present, in this fixed order — `stderr`, `result`
 *  (only under `is_error`), `error` (a string, or an object's `.message`) —
 *  falls back to `stdout` alone when nothing else is there, joins with
 *  " · ", then redacts (the same pass every timeline entry gets — a
 *  secret-shaped token in vendor output must not become plaintext evidence
 *  either) and truncates to ONE fixed budget for the whole joined string,
 *  never one per part. An `api_error_status` under `is_error` prefixes the
 *  result. Still a diagnostic for a human, never a signal: no part of this
 *  text is ever parsed, matched or branched on — only ever appended to a
 *  message string. */
const VENDOR_DIAGNOSTIC_BUDGET = 300;
// W-069: exported (one keyword, no logic change) so packages/commands/src/
// probe.ts's verdict construction (behaviour 2) reuses the same extractor
// rather than a second implementation drifting from it.
export function vendorDiagnostic(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const isError = obj["is_error"] === true;

  const parts: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === "string" && v.trim().length > 0) parts.push(v.trim());
  };
  collect(obj["stderr"]);
  if (isError) collect(obj["result"]);
  const errVal = obj["error"];
  if (typeof errVal === "string") collect(errVal);
  else if (typeof errVal === "object" && errVal !== null) collect((errVal as Record<string, unknown>)["message"]);

  const stdout = typeof obj["stdout"] === "string" ? obj["stdout"].trim() : "";
  const collected = parts.length > 0 ? parts : stdout.length > 0 ? [stdout] : [];
  if (collected.length === 0) return undefined;

  const joined = collected.join(" · ");
  const redacted = redact(joined);
  const bounded = redacted.length > VENDOR_DIAGNOSTIC_BUDGET ? `${redacted.slice(0, VENDOR_DIAGNOSTIC_BUDGET)}…` : redacted;

  const status = obj["api_error_status"];
  const hasStatus = isError && (typeof status === "number" || typeof status === "string");
  return hasStatus ? `status ${status}: ${bounded}` : bounded;
}

// ---------------------------------------------------------------------------
// Shared core: everything from the deterministic fast path through
// escalation, factored out of the CLI entry point so a non-CLI caller
// (tick.ts's daily-acta step) can get a reply back without going through
// argv/exit-code plumbing. `runTalk` (CLI) and `talkOnce` (programmatic,
// see below) are both thin wrappers around this.
// ---------------------------------------------------------------------------

interface PerformTalkParams {
  studio: string;
  sella: string;
  message: string;
  harness?: string;
  modelOnly?: boolean;
  now: Date;
  harnesses?: Record<string, HarnessProfile>;
}

type PerformTalkOutcome =
  | { ok: true; source: "query"; answer: string }
  | { ok: true; source: "harness"; reply: string; petitiones: string[] }
  | { ok: false; exitCode: number; message: string };

async function performTalk(params: PerformTalkParams): Promise<PerformTalkOutcome> {
  const { sella, message, now } = params;
  const modelOnly = params.modelOnly ?? false;

  const root = resolve(params.studio);
  const manifestPath = join(root, "bisellium.yml");
  if (!existsSync(manifestPath)) {
    return { ok: false, exitCode: 2, message: `not a studio: ${root}` };
  }

  let manifest: Manifest;
  try {
    manifest = readManifest(root);
  } catch (e) {
    return { ok: false, exitCode: 2, message: `${manifestPath} unparseable — not a studio: ${(e as Error).message}` };
  }

  const sellaRow = (manifest.sellae ?? []).find((s) => s.id === sella);
  if (!sellaRow) {
    return { ok: false, exitCode: 2, message: `unknown sella "${sella}" — not declared in ${manifestPath}` };
  }

  // 1. Deterministic path first — a question `bisellium query` already
  // knows how to answer never touches a model, unless --model-only forces it.
  if (!modelOnly) {
    const qa = answer(root, message, { now });
    if (qa.kind !== "unknown" && qa.answer !== null) {
      return { ok: true, source: "query", answer: qa.answer };
    }
  }

  // 2. Pick and validate the harness.
  const harnessId = params.harness ?? sellaRow.harness ?? "claude-code";
  const registry = params.harnesses ?? HARNESS_PROFILES;
  const profile = registry[harnessId];
  if (!profile) {
    return { ok: false, exitCode: 2, message: `${sella}: unknown harness "${harnessId}"` };
  }
  let isAvailable: boolean;
  try {
    isAvailable = await profile.available();
  } catch {
    isAvailable = false;
  }
  if (!isAvailable) {
    return { ok: false, exitCode: 2, message: `${sella}: harness "${harnessId}" is unavailable` };
  }

  // 3. The boot bundle (same one `bisellium context` prints) is the system prompt.
  const bundle = buildContext(root, sella, { now });
  const systemPrompt = bundle.text;

  // 4. Start or resume, in the studio root (worktrees are for `run`, not `talk`).
  const sessPath = sessionPathFor(root, sella);
  const existing = readSession(sessPath);
  // Same secret-shaped-env stripping packages/pipeline gives an untrusted
  // probatio command — a harness subprocess is no more trusted with the
  // parent process's credentials than one is.
  const env = filterEnv(process.env);

  // W-046: the decreed model (sellae[].model) travels into the profile
  // verbatim — never read from process.env, a vendor config file, or the
  // session being resumed. Absent means no bisellium override.
  const requestedModel = sellaRow.model;

  let turn: Turn;
  try {
    turn =
      existing && existing.harness === harnessId
        ? await profile.resume({ cwd: root, sella, sessionId: existing.sessionId, message, env, model: requestedModel })
        : await profile.start({ cwd: root, sella, systemPrompt, message, env, model: requestedModel });
  } catch (e) {
    return { ok: false, exitCode: 2, message: `${sella}: ${(e as Error).message}` };
  }

  if (turn.exitCode === 3) {
    const reset = extractResetHint(turn.raw);
    return { ok: false, exitCode: 3, message: `${sella} is limited on ${harnessId}; try again after ${reset ?? "unknown"}` };
  }
  if (turn.exitCode !== 0) {
    // W-046 round 2 (behaviour 7, censor F-2): both claude-code.ts and
    // codex.ts put { stdout, stderr } in Turn.raw when no envelope parses —
    // the vendor's own diagnostic, captured and then silently discarded.
    // One guard here, the shared site both profiles' failures pass through,
    // carries it into the operator-facing message: redacted (the same pass
    // every timeline entry gets) and bounded to a fixed character budget,
    // never parsed, matched or branched on — a diagnostic for a human, not
    // a signal.
    const diagnostic = vendorDiagnostic(turn.raw);
    const base = `${sella}: ${harnessId} exited ${turn.exitCode} (requested model: ${requestedModel ?? "none"})${turn.reply ? ` — ${turn.reply}` : ""}`;
    return {
      ok: false,
      exitCode: turn.exitCode,
      message: diagnostic ? `${base} — ${diagnostic}` : base,
    };
  }
  // W-046 (behaviour 3): a turn that exits 0 with an empty reply is a
  // failure, not a recorded success — nothing is persisted below (no
  // session, no timeline, no receipt).
  if (turn.reply === "") {
    return {
      ok: false,
      exitCode: 1,
      message: `${sella}: ${harnessId} exited 0 with an empty reply (requested model: ${requestedModel ?? "none"})`,
    };
  }

  // 5. Persist the session (same id on resume; harness pinned so a later
  // `--harness` switch starts fresh instead of resuming under a mismatched
  // vendor). A harness switch means step 4 above took the `start` branch
  // with a brand-new sessionId, so `startedAt`/`turns` must restart too —
  // otherwise the record describes a session that never had that many
  // turns under a harness it never talked to before this one.
  const sameHarness = existing !== undefined && existing.harness === harnessId;
  // An empty/missing sessionId from the harness can never be persisted or
  // resumed against — treat it as a fresh start (sessionId: null) rather
  // than silently writing/resuming "".
  const hasValidSessionId = typeof turn.sessionId === "string" && turn.sessionId.length > 0;
  writeSession(sessPath, {
    harness: harnessId,
    sessionId: hasValidSessionId ? turn.sessionId : null,
    startedAt: sameHarness ? existing.startedAt || now.toISOString() : now.toISOString(),
    lastAt: now.toISOString(),
    turns: sameHarness ? existing.turns + 1 : 1,
  });

  // 6. Timeline: chatter, in both directions. Redacted the same way receipts
  // are (docs/ADOPTION.md: a credential passed in a message must not become
  // plaintext evidence sitting in the repo).
  const timelineSessionId = hasValidSessionId ? turn.sessionId : "";
  const noSessionIdNote = hasValidSessionId ? {} : { note: "no sessionId from harness" };
  appendTimeline(root, sella, [
    { at: now.toISOString(), sella, direction: "in", text: redact(message), sessionId: timelineSessionId, ...noSessionIdNote },
    {
      at: now.toISOString(),
      sella,
      direction: "out",
      text: redact(turn.reply),
      sessionId: timelineSessionId,
      // W-046: the vendor's own echo wins when it gives one (the truth about
      // what actually ran); otherwise the requested model — never overwrite
      // an echoed model with the request unconditionally.
      model: turn.model ?? requestedModel,
      usage: turn.usage,
      ...noSessionIdNote,
    },
  ]);

  // 7. Receipt.
  const receiptFile = writeReceiptStart(root, {
    sella,
    sessionId: turn.sessionId || makeSessionId(now),
    startedAt: now.toISOString(),
    cwd: root,
    cmd: [message],
    harness: harnessId,
  });
  writeReceiptEnd(receiptFile, { endedAt: now.toISOString(), exitCode: 0, durationMs: 0 });

  // 8. Escalation: a reply line can open a petitio or write a decision —
  // everything else in it stays chatter (timeline only). Three guards, all
  // required before a line counts:
  //  (a) not inside a fenced code block (``` … ``` — a sella quoting an
  //      example must not accidentally escalate);
  //  (b) top-level — `^PETITIO:`/`^ACTUM:` with no leading whitespace, so a
  //      line nested under a list/blockquote never matches;
  //  (c) not an exact (trimmed) echo of a line already present in the boot
  //      bundle sent as this turn's system prompt — that's the sella
  //      reading back context (e.g. quoting an existing petitio's body),
  //      content, never a fresh instruction to escalate.
  const bundleLines = new Set(
    systemPrompt
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );
  const petitiones: string[] = [];
  let inFence = false;
  for (const line of turn.reply.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (bundleLines.has(line.trim())) continue;

    // Both petitiones/ and acta/ are tracked studio files (unlike
    // timeline/, which is gitignored) — a credential the model happened to
    // echo in an escalation line must not become plaintext evidence
    // committed to the repo, same as the redact() already applied to the
    // timeline entries above.
    const petitio = /^PETITIO:\s*(.+)$/.exec(line);
    if (petitio) {
      const id = openPetitio(root, manifest, sella, redact(petitio[1]!.trim()), now);
      petitiones.push(id);
      continue;
    }
    const actum = /^ACTUM:\s*(.+)$/.exec(line);
    if (actum) writeActum(root, sella, redact(actum[1]!.trim()), now);
  }

  return { ok: true, source: "harness", reply: turn.reply, petitiones };
}

// ---------------------------------------------------------------------------
// Programmatic seam: `bisellium tick`'s daily-acta step (packages/cli/src/
// tick.ts) needs a reply back, not a CLI exit code — it dynamic-imports this
// module and calls `talkOnce` (see tick.ts's `TalkFn`/`loadRealTalkOnce`).
// Throws on any failure (usage/unknown sella/unavailable harness/non-zero or
// limited turn) so a caller can treat "no reply" as one failure mode; never
// prints anything (that's runTalk/CLI's job below).
// ---------------------------------------------------------------------------

export interface TalkOnceOptions {
  studio: string;
  sella: string;
  message: string;
  /** Which vendor CLI to run the sella through. Falls back to the sella's
   *  manifest `harness`, then "claude-code" — same precedence as the CLI's
   *  `--harness` flag. */
  harness?: string;
  now?: Date;
  /** Harness registry override, for tests. Defaults to @bisellium/shim's
   *  HARNESS_PROFILES. */
  harnesses?: Record<string, HarnessProfile>;
}

export interface TalkOnceResult {
  reply: string;
}

export async function talkOnce(opts: TalkOnceOptions): Promise<TalkOnceResult> {
  const now = opts.now ?? new Date();
  const outcome = await performTalk({
    studio: opts.studio,
    sella: opts.sella,
    message: opts.message,
    harness: opts.harness,
    now,
    harnesses: opts.harnesses,
  });
  if (!outcome.ok) throw new Error(outcome.message);
  return { reply: outcome.source === "query" ? outcome.answer : outcome.reply };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function runTalk(args: string[], opts: RunTalkOptions = {}): Promise<RunTalkResult> {
  const parsed = parseArgs(args);
  if ("error" in parsed) {
    console.error(parsed.error);
    return { exitCode: 2 };
  }
  const { sella, harness: harnessFlag, modelOnly, now, message, studio } = parsed;

  // `bisellium pause` stops autonomous starting (bisellium tick), not
  // talking directly — the Patron talking to a sella is how you find out
  // why it's paused, so the direct line proceeds regardless, with just a
  // warning (same posture as `run`; see pause.ts's pauseWarning).
  const warning = pauseWarning(resolve(studio));
  if (warning) console.error(warning);

  const outcome = await performTalk({ studio, sella, message, harness: harnessFlag, modelOnly, now, harnesses: opts.harnesses });
  if (!outcome.ok) {
    console.error(outcome.message);
    return { exitCode: outcome.exitCode };
  }
  if (outcome.source === "query") {
    console.log(`query · ${outcome.answer}`);
    return { exitCode: 0 };
  }

  // Print the reply, then any escalations it produced.
  console.log(outcome.reply);
  for (const id of outcome.petitiones) console.log(`petitio ${id} opened`);
  return { exitCode: 0 };
}
