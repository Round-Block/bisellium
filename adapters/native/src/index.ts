/**
 * @bisellium/adapter-native — reads a Bisellium studio directory
 * (docs/ADOPTION.md) into a Snapshot. Snapshot-native: the core diffs
 * consecutive snapshots; this file only describes current state. The raw
 * readers are exported for `bisellium check`, which validates the same files.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  ActorKind,
  Actum,
  AutonomyLevel,
  Collegium,
  Lifecycle,
  Petitio,
  PetitioState,
  Probatio,
  ProbatioKind,
  ProbatioResult,
  ProbatioStatus,
  Provider,
  ProviderStatus,
  Sella,
  Snapshot,
  SnapshotAdapter,
  Stipendium,
  Opus,
} from "@bisellium/schema";
// @bisellium/providers imports readUsageProviders back from this module —
// a static import of @bisellium/providers here (as this file used to have)
// would be a real top-level ESM cycle. providerStatus() below dynamic-
// imports it instead, deferred to first call, so this module never
// statically depends on providers.

// Fixed lifecycle (ADOPTION.md): greenlit is the Patron's slate decision.
export const NATIVE_LIFECYCLE_ID = "bisellium";
export const STATES: Lifecycle["states"] = [
  { id: "backlog", name: "Backlog", phase: "backlog" },
  { id: "greenlit", name: "Greenlit", phase: "planned" },
  { id: "building", name: "Building", phase: "in_progress" },
  { id: "verifying", name: "Verifying", phase: "verifying" },
  { id: "review", name: "Review", phase: "awaiting_review" },
  { id: "done", name: "Done", phase: "done" },
  { id: "halted", name: "Halted", phase: "halted" },
];
export const ORDER = ["backlog", "greenlit", "building", "verifying", "review", "done"];

export interface Manifest {
  bisellium: number;
  studio: string;
  patron?: string;
  timezone?: string;
  /** `autonomy` (L0–L3, dossier §10) defaults to "L1" when absent; an
   *  invalid value is `check`'s job to block (collegium.autonomy), not
   *  this reader's — it's passed through as-is. */
  collegia: { id: string; name: string; magister: string; fallback?: string; lex?: string; autonomy?: string }[];
  /** `harness`: the @bisellium/shim harness profile id `bisellium talk`
   *  drives this sella through — defaults to "claude-code" when absent.
   *  `retired` (W-089): the row is a historical seat — kept declared so
   *  every record that ever named it stays readable and its typo-catching
   *  membership rules stay blocking forever, but `resolveSeat`'s callers
   *  must refuse it as a live dispatch target (S3). Absent means live. */
  sellae: { id: string; collegium: string; kind?: ActorKind; model?: string; harness?: string; retired?: boolean }[];
  probationes: { id: string; name: string; kind: ProbatioKind; command?: string }[];
  wip_limit?: number;
  /** Overrides for the Defaults table in the dossier. */
  defaults?: Record<string, number>;
  /** Repo-root-relative paths additionally excluded from the SOURCE tree
   *  hash / dirty check (on top of the studio dir and `.bisellium/`, always
   *  excluded) — e.g. a studio nested in a monorepo alongside unrelated
   *  sibling studios or fixtures. See check.ts/verify.ts. */
  source_excludes?: string[];
  standing_rules?: string[];
  /** D-023 §2: the six role-named tiers (fast/mid/high/escalation/build/
   *  review) and their current model holders. Optional — a manifest
   *  declaring neither this nor `munera` parses, checks and serves exactly
   *  as before (no migration). The screen renders from these records; it
   *  dispatches on neither (W-065). */
  tiers?: { id: string; model?: string }[];
  /** D-023 §2: the nine munera (task types) mapped to a tier id. */
  munera?: { id: string; tier: string }[];
  /** D-015: how an opus branch reaches the trunk is a setting, not a fixed
   *  flow. Absent entirely ⇒ today's only behaviour (fast-forward only, no
   *  push, no PR) — `bisellium merge` (packages/cli/src/branch.ts) is the
   *  reader. */
  integration?: {
    /** "fast_forward" (default) | "rebase" | "merge_commit". */
    strategy?: string;
    /** Push the trunk to origin after a successful merge. Default: false. */
    push?: boolean;
    /** `git pull` the trunk again after that push. Default: false; ignored
     *  when `push` is false. */
    pull_after_push?: boolean;
    pr?: {
      /** A PR must carry the change to the trunk instead of `merge` landing
       *  it directly. Default: false. PR creation itself is out of scope
       *  here (W-028) — `bisellium merge` stops short of opening one. */
      required?: boolean;
      /** sella id that reviews the PR. Advisory; nothing here opens the PR. */
      reviewer?: string;
    };
  };
}

export interface FrontMatter<T> {
  data: T;
  body: string;
  raw: string;
}

/** Parses a front-matter document already in memory — the same shape
 *  `readFront` reads off disk, reused by a caller that gets the raw text
 *  from somewhere else (e.g. `git show <ref>:<path>`, packages/cli/src/
 *  branch.ts B5.1) instead of the filesystem. `label` is only used in the
 *  thrown error message. */
export function parseFrontMatter<T>(raw: string, label = "<content>"): FrontMatter<T> {
  const stripped = raw.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(stripped);
  if (!m) throw new Error(`${label}: missing front matter`);
  const data = (parseYaml(m[1] ?? "") ?? {}) as T;
  return { data, body: (m[2] ?? "").trim(), raw: stripped };
}

export function readFront<T>(path: string): FrontMatter<T> {
  return parseFrontMatter<T>(readFileSync(path, "utf8"), path);
}

export function listMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * ISO 8601 week (Monday start, week containing the year's first Thursday) of
 * `date`, in UTC — e.g. "2026-W38". Burn is computed only for the aerarium
 * period this matches; other periods are period-blind by design (ADOPTION.md:
 * burn is derived per period, not summed across all of history).
 */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Strips a paired delimiter (`*` or `_`) acting as markdown emphasis —
 *  paired, and adjacent to a non-word character on the outside — leaving it
 *  alone everywhere else, so `snake_case_name` and `a*b` survive intact
 *  (W-076 land 7). */
function stripEmphasis(text: string, delim: "*" | "_"): string {
  const d = delim === "*" ? "\\*" : "_";
  const re = new RegExp(`(?<![\\w${d}])${d}([^\\s${d}](?:[^${d}]*[^\\s${d}])?)${d}(?![\\w])`, "g");
  return text.replace(re, "$1");
}

/**
 * W-076: a petitio's inbox subject when the `subject:` front-matter key is
 * absent (or present-and-invalid — `check.ts`'s `petitio.subject` rule
 * blocks that case; this function is never asked to rescue it). A legacy
 * fallback, not a correct subject: first paragraph (not first *line* — the
 * whole fix for wrap-artifact mid-sentence cuts), unwrapped, markdown
 * stripped, capped at 120 characters total including the ellipsis. Cuts at
 * the last space at or before the boundary; when no space exists there (a
 * single token longer than the cap, e.g. a long URL), cuts mid-word at the
 * boundary — the one deliberate mid-word exception.
 */
export function deriveSubject(body: string): string {
  const firstParagraph = (body.split(/\r?\n\s*\r?\n/)[0] ?? "").trim();
  let s = firstParagraph.replace(/\s+/g, " ").trim();
  s = s.replace(/^#+\s*/, ""); // leading heading marker(s)
  s = s.replace(/`([^`]*)`/g, "$1"); // inline code
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
  s = s.replace(/__([^_]+)__/g, "$1"); // bold (underscore form)
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // [text](url)
  s = stripEmphasis(s, "*");
  s = stripEmphasis(s, "_");
  s = s.replace(/\s+/g, " ").trim();

  const LIMIT = 120;
  if (s.length > LIMIT) {
    // W-076 censor round 1 (F1): the last-space search window is the full
    // 120-char boundary, not LIMIT-1 — a word ending exactly at index 119
    // (P-010's "gap") has its trailing space AT that index, one past a
    // LIMIT-1 window, and was being discarded whole. The no-space fallback
    // still cuts at LIMIT-1 (budget), leaving room for the ellipsis.
    const window = s.slice(0, LIMIT);
    const lastSpace = window.lastIndexOf(" ");
    const cut = lastSpace > 0 ? window.slice(0, lastSpace) : s.slice(0, LIMIT - 1);
    s = `${cut}…`;
  }
  return s;
}

function posture(allowance: number | undefined, burn: number | undefined): ProviderStatus {
  if (allowance === undefined || burn === undefined) return "unknown";
  const r = burn / allowance;
  if (r >= 1) return "limited";
  if (r >= 0.85) return "closeout";
  if (r >= 0.6) return "conserve";
  return "ok";
}

export function readManifest(root: string): Manifest {
  return parseYaml(readFileSync(join(root, "bisellium.yml"), "utf8")) as Manifest;
}

// ---------------------------------------------------------------------------
// W-089 — Seam S1/S2: seats are templates, instance identity is minted at
// dispatch. Both live here (not in @bisellium/cli or @bisellium/commands)
// because this is the lowest package every class-B consumer named in the
// brief's census — context/talk/tick/delegate/probe/hooks (all of which
// already import @bisellium/adapter-native) and `check` itself — can import
// without a cycle.
// ---------------------------------------------------------------------------

/** The minimal shape `resolveSeat` needs off a `sellae` row — a subset of
 *  `Manifest["sellae"][number]`, so `check.ts` (which parses `bisellium.yml`
 *  itself, ahead of full shape validation) can build one of these off its
 *  own raw rows without importing the rest of the manifest contract. */
export interface SeatLike {
  id: string;
  retired?: boolean;
}

export interface ResolvedSeat<T extends SeatLike> {
  seat: T;
  /** Present only when `id` was `<seat>.<instance>` — an exact declared id
   *  (template or a historical tombstone) resolves with none. */
  instance?: string;
}

/**
 * Seam S1 (W-089): the single authority on what a sella id means against a
 * manifest's `sellae` roster. Every membership test and row lookup goes
 * through this — no caller re-implements `id.split(".")` or `sellae.find`.
 *
 * An exact declared id (a live template or a `retired: true` tombstone)
 * resolves with `instance` absent; exact match is tried first. Otherwise the
 * substring before the FIRST "." is taken as the seat id and the (non-empty)
 * remainder as `instance` — the seat itself is matched whole, never split on
 * "-", so a hyphenated seat id (`builder-codex`) still parses
 * `builder-codex.W-100` correctly. `ghost`, `ghost.W-089`, `builder.` (empty
 * instance) and any other prefix that names nothing declared all return
 * `undefined`.
 *
 * A retired row still resolves — reads must work forever. Resolution is NOT
 * permission to dispatch: the caller reads `resolved.seat.retired` and
 * applies its own live/historical policy (behaviour 6).
 */
export function resolveSeat<T extends SeatLike>(manifest: { sellae?: readonly T[] }, id: string): ResolvedSeat<T> | undefined {
  if (!id) return undefined;
  const rows = manifest.sellae ?? [];
  const exact = rows.find((r) => r.id === id);
  if (exact) return { seat: exact };

  const dot = id.indexOf(".");
  if (dot <= 0) return undefined; // no "." at all, or an empty seat prefix
  const instance = id.slice(dot + 1);
  if (instance.length === 0) return undefined; // "builder." — empty instance
  const seat = rows.find((r) => r.id === id.slice(0, dot));
  if (!seat) return undefined;
  return { seat, instance };
}

// Mirrors packages/cli/src/check.ts's ID_RE exactly (S2's own containment
// invariant) — NOT an import: @bisellium/adapter-native sits below
// @bisellium/cli in the dependency graph (cli already depends on this
// package), so importing check.ts's copy back would be a real cycle. Kept
// in lockstep by hand; check.ts:37 itself is unchanged by this opus.
const SEAT_INSTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Seam S2 (W-089): the single authority that joins a resolved live builder
 * template to an opus id — `seatInstance("builder", "W-089") ===
 * "builder.W-089"`. No caller may spell `` `${seat}.${opus}` `` itself.
 *
 * Refuses (returns `undefined`) rather than ever handing back a bad id: when
 * either operand is empty, or the joined string contains a doubled dot, or
 * it fails the same character-class invariant every id in this system is
 * held to (ID_RE).
 */
export function seatInstance(seatId: string, opusId: string): string | undefined {
  if (!seatId || !opusId) return undefined;
  const candidate = `${seatId}.${opusId}`;
  if (candidate.includes("..")) return undefined;
  if (!SEAT_INSTANCE_ID_RE.test(candidate)) return undefined;
  return candidate;
}

/**
 * W-089 behaviour 6: the live template a retired row's own name suggests,
 * for the refusal message at the three group-A membership sites. Never
 * stored on the row — derived from what's actually declared, so it can
 * never drift out of sync with the manifest the way a hand-written
 * "replaced_by" field could.
 *
 * Candidates are every LIVE row sharing the retired row's collegium and
 * harness (`undefined === undefined` for "no harness declared" on both
 * sides). Among those, the retired id with its last `-<segment>` stripped
 * (`builder-a` → `builder`, `builder-sol` → `builder`) is preferred when it
 * names one of them exactly — this is what makes a codex-harness retiree
 * land on `builder-codex` rather than the first alphabetical engineering
 * seat. Falls back to the first candidate, or `undefined` when none exist.
 */
export function liveReplacementFor<T extends SeatLike & { collegium?: string; harness?: string }>(manifest: { sellae?: readonly T[] }, retired: T): T | undefined {
  const candidates = (manifest.sellae ?? []).filter((r) => r.retired !== true && r.collegium === retired.collegium && r.harness === retired.harness);
  if (candidates.length === 0) return undefined;
  const stem = retired.id.replace(/-[^-]+$/, "");
  return candidates.find((r) => r.id === stem) ?? candidates[0];
}

/** W-089 behaviours 4/5/8: the two live builder-class seat templates D-020/
 *  D-023 declare — the only seats the minter (`seatInstance`) is ever
 *  called for at a dispatch boundary, and the only rows `process.cascade`
 *  (hooks.ts) suppresses its warning for. A single shared definition so
 *  hooks.ts and run.ts (and any future dispatch boundary) can never drift
 *  on which two ids this means. */
export const BUILDER_CLASS_SEAT_IDS = new Set(["builder", "builder-codex"]);

/** True when `resolved` names one of the two live (non-retired)
 *  builder-class templates — never true for a retired tombstone, an
 *  instance's own seat included. */
export function isBuilderClassSeat<T extends SeatLike>(resolved: ResolvedSeat<T> | undefined): boolean {
  return resolved !== undefined && resolved.seat.retired !== true && BUILDER_CLASS_SEAT_IDS.has(resolved.seat.id);
}

/** The exact refusal text for a live-dispatch site (run.ts:160, writes.ts's
 *  handoff/emit --usage) naming a retired sella — pinned by W-089 behaviour
 *  6's own tests. Always names the resolved SEAT's own id, never the
 *  original (possibly instance-shaped) string the caller supplied. */
export function retiredDispatchMessage<T extends SeatLike & { collegium?: string; harness?: string }>(manifest: { sellae?: readonly T[] }, seat: T): string {
  const replacement = liveReplacementFor(manifest, seat);
  return replacement
    ? `sella "${seat.id}" is retired — dispatch "${replacement.id}" instead`
    : `sella "${seat.id}" is retired — no live replacement is declared for it`;
}

export function describeLifecycle(manifest: Manifest): Lifecycle {
  const gates: Probatio[] = manifest.probationes.map((g) => ({ id: g.id, name: g.name, kind: g.kind, command: g.command }));
  const patron = manifest.patron ?? "patron";
  const production = manifest.collegia.find((d) => d.id === "production")?.magister ?? "production";
  const actorsFor = (to: string): string[] | undefined =>
    to === "greenlit" ? [patron] : to === "done" ? ["merge-script"] : to === "halted" ? [production] : undefined;
  const transitions: Lifecycle["transitions"] = ORDER.slice(1).map((to, i) => ({ from: ORDER[i]!, to, actors: actorsFor(to) }));
  for (const s of ORDER) if (s !== "done") transitions.push({ from: s, to: "halted", actors: actorsFor("halted") });
  return { id: NATIVE_LIFECYCLE_ID, states: STATES, transitions, gates, wipLimit: manifest.wip_limit };
}

export function snapshotDir(root: string, projectId: string, now: Date = new Date()): Snapshot {
  const manifest = readManifest(root);
  const currentPeriod = isoWeek(now);

  const collegia: Collegium[] = manifest.collegia.map((d) => ({
    id: d.id,
    projectId,
    name: d.name,
    magisterRoleId: d.magister,
    fallbackRoleId: d.fallback,
    lexHref: d.lex,
    // check.ts validates the declared value (collegium.autonomy); an
    // invalid string still passes through here rather than being silently
    // coerced, so a consumer that skips check can't mistake garbage for L1.
    autonomy: (d.autonomy as AutonomyLevel | undefined) ?? "L1",
  }));

  const sellae: Sella[] = manifest.sellae.map((s) => ({
    id: s.id,
    roleId: s.id,
    projectId,
    kind: s.kind ?? "agent",
    collegiumId: s.collegium,
    // retired (W-089): only ever `true` on a row, never written `false` —
    // consumers that don't care about it can ignore the key entirely.
    meta: { model: s.model, ...(s.retired ? { retired: true } : {}) },
  }));

  interface OpusFront {
    id: string;
    title: string;
    kind?: string;
    collegium?: string;
    sella?: string;
    state: string;
    probationes?: Record<string, { status: ProbatioStatus; evidence?: string; certifies?: string }>;
    tokens?: number;
    heartbeat?: string;
    review_round?: number;
    traditio?: Record<string, string>;
    resume_when?: string;
  }
  const opera: Opus[] = listMd(join(root, "opera")).map((p) => {
    const { data, body } = readFront<OpusFront>(p);
    const probationes: Record<string, ProbatioResult> = {};
    for (const [id, g] of Object.entries(data.probationes ?? {})) {
      probationes[id] = {
        status: g.status,
        evidence: g.evidence ? { href: g.evidence, certifies: g.certifies } : undefined,
      };
    }
    return {
      id: data.id,
      projectId,
      kind: data.kind ?? "task",
      lifecycleId: NATIVE_LIFECYCLE_ID,
      state: data.state,
      probationes,
      meta: {
        title: data.title,
        collegium: data.collegium,
        sella: data.sella,
        tokens: data.tokens,
        heartbeat: data.heartbeat,
        reviewRound: data.review_round,
        traditio: data.traditio,
        resumeWhen: data.resume_when,
        notes: body,
      },
    };
  });

  interface PetitioFront { id: string; opus: string; from: string; to: string; state: PetitioState; opened?: string; subject?: unknown }
  const petitiones: Petitio[] = listMd(join(root, "petitiones")).map((p) => {
    const { data, body } = readFront<PetitioFront>(p);
    // `subject:`, when present and a non-blank string, is authoritative
    // (W-076 design §1) — verbatim, even when the body would derive
    // something else, even when the body is empty. A present-but-invalid
    // value (blank, whitespace-only, non-string) is check.ts's
    // `petitio.subject` rule's problem to block, not this reader's to
    // rescue — it still falls through to the derivation here only because
    // the schema field is required and something has to occupy it.
    // Absent, or the derivation's own output is empty (an empty/whitespace
    // body), falls back to the petitio id rather than a blank label.
    const front = typeof data.subject === "string" && data.subject.trim().length > 0 ? data.subject : undefined;
    const derived = deriveSubject(body);
    return {
      id: data.id,
      opusId: data.opus,
      openedBy: data.from === "patron" ? "you" : data.from,
      counterparty: data.from === "patron" ? data.to : data.from,
      state: data.state,
      subject: front ?? (derived || data.id),
      body,
    };
  });

  interface ActumFront { author: string; kind: Actum["kind"]; title: string; at: string; evidence?: { label: string; href: string }[] }
  const acta: Actum[] = listMd(join(root, "acta")).map((p) => {
    const { data, body } = readFront<ActumFront>(p);
    return {
      id: p.split(/[\\/]/).pop()!.replace(/\.md$/, ""),
      projectId,
      authorRoleId: data.author,
      at: String(data.at),
      kind: data.kind,
      title: data.title,
      body,
      evidence: data.evidence ?? [],
    };
  });

  // Burn is derived: the sum of item tokens per collegium. Any burn figure
  // written in the aerarium file is ignored (derive, never mirror).
  const burnFor = (collegiumId: string): number =>
    opera
      .filter((w) => w.meta["collegium"] === collegiumId)
      .reduce((n, w) => n + (typeof w.meta["tokens"] === "number" ? (w.meta["tokens"] as number) : 0), 0);
  const stipendia: Stipendium[] = [];
  const aerariumDir = join(root, "aerarium");
  if (existsSync(aerariumDir)) {
    for (const f of readdirSync(aerariumDir).filter((f) => f.endsWith(".yml")).sort()) {
      const b = parseYaml(readFileSync(join(aerariumDir, f), "utf8")) as {
        period: string;
        collegia: Record<string, { stipendium_tokens?: number }>;
      };
      const period = String(b.period);
      const isCurrent = period === currentPeriod;
      for (const [collegiumId, v] of Object.entries(b.collegia)) {
        // Burn is only meaningful for the period containing `now` — a past
        // or future aerarium file gets burn 0 and an honest "unknown"
        // posture rather than the same all-time total repeated per file.
        const burn = isCurrent ? burnFor(collegiumId) : 0;
        stipendia.push({
          collegiumId,
          period,
          allowance: { tokens: v.stipendium_tokens },
          burn: { tokens: burn },
          posture: isCurrent ? posture(v.stipendium_tokens, burn) : "unknown",
        });
      }
    }
  }

  const providers = readUsageProviders(root).providers;

  return { sellae, opera, providers, acta, collegia, stipendia, petitiones };
}

/**
 * usage.yml → Provider[] — the "observed" half of the W-007 provider status
 * seam. Extracted so @bisellium/providers's usageYamlSource can reuse this
 * exact parsing instead of duplicating it (docs/ADOPTION.md: usage.yml is
 * observed provider limit telemetry).
 */
export interface ReadUsageProvidersResult {
  providers: Provider[];
  /** One entry per skipped/malformed provider row, for callers (e.g.
   *  `bisellium providers --source usage`) that want to surface why an
   *  entry produced nothing rather than silently dropping it. */
  notes: string[];
}

export function readUsageProviders(root: string): ReadUsageProvidersResult {
  const usagePath = join(root, "usage.yml");
  if (!existsSync(usagePath)) return { providers: [], notes: [] };
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(usagePath, "utf8"));
  } catch {
    // Malformed YAML (unparseable) degrades to "no observed providers"
    // rather than throwing a raw YAMLParseError at callers — see W-007
    // verifier finding on readUsageProviders.
    return { providers: [], notes: [] };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { providers?: unknown }).providers)
  ) {
    return { providers: [], notes: [] };
  }
  const u = parsed as { providers: unknown[] };

  const providers: Provider[] = [];
  const notes: string[] = [];
  for (const raw of u.providers) {
    // Same tolerance as the quota-axi source: validate the shape of each
    // entry independently and skip (with a note), never throw and never
    // let one bad row (e.g. `- {}`) take the whole list down.
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      notes.push("usage.yml: skipped a provider entry — not a mapping");
      continue;
    }
    const p = raw as { id?: unknown; usage_pct?: unknown; reset_at?: unknown; status?: unknown };
    const id = typeof p.id === "string" && p.id.length > 0 ? p.id : undefined;
    if (!id) {
      notes.push("usage.yml: skipped a provider entry — id must be a non-empty string");
      continue;
    }
    const usagePct = typeof p.usage_pct === "number" && Number.isFinite(p.usage_pct) ? p.usage_pct : undefined;
    if (usagePct === undefined || usagePct < 0 || usagePct > 100) {
      notes.push(`usage.yml: skipped provider "${id}" — usage_pct must be a number 0–100`);
      continue;
    }
    providers.push({
      id,
      usagePct,
      resetAt: p.reset_at !== undefined ? String(p.reset_at) : undefined,
      status: (p.status as ProviderStatus | undefined) ?? "unknown",
    });
  }
  return { providers, notes };
}

export interface CreateBiselliumAdapterOpts {
  /** providerStatus() runs quota-axi (a live subprocess) only when true.
   *  Default false so snapshot tests stay hermetic. */
  live?: boolean;
}

export function createBiselliumAdapter(root: string, projectId?: string, opts: CreateBiselliumAdapterOpts = {}): SnapshotAdapter {
  const manifest = readManifest(root);
  const id = projectId ?? manifest.studio.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const live = opts.live === true;
  return {
    style: "snapshot",
    projectId: id,
    intervalMs: 5_000,
    describeLifecycles: () => [describeLifecycle(manifest)],
    snapshot: async () => snapshotDir(root, id),
    providerStatus: async () => {
      if (!live) return readUsageProviders(root).providers;
      // Dynamic import, deferred to first call — not at module-evaluation
      // time — so this module never statically depends on
      // @bisellium/providers (see the comment above readUsageProviders).
      const { compositeSource, quotaAxiSource, usageYamlSource } = await import("@bisellium/providers");
      const source = compositeSource([quotaAxiSource({}), usageYamlSource(root)]);
      const { providers } = await source.read({ now: new Date() });
      return providers;
    },
  };
}
