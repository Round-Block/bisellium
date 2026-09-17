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
// Lazy-imported inside providerStatus() (not at module top level) — @bisellium/providers
// imports readUsageProviders back from this module, and both sides only touch
// the cycle from inside function bodies, never at module-evaluation time.
import { compositeSource, quotaAxiSource, usageYamlSource } from "@bisellium/providers";

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
  collegia: { id: string; name: string; magister: string; fallback?: string; lex?: string }[];
  sellae: { id: string; collegium: string; kind?: ActorKind; model?: string }[];
  probationes: { id: string; name: string; kind: ProbatioKind; command?: string }[];
  wip_limit?: number;
  /** Overrides for the Defaults table in the dossier. */
  defaults?: Record<string, number>;
}

export interface FrontMatter<T> {
  data: T;
  body: string;
  raw: string;
}

export function readFront<T>(path: string): FrontMatter<T> {
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${path}: missing front matter`);
  const data = (parseYaml(m[1] ?? "") ?? {}) as T;
  return { data, body: (m[2] ?? "").trim(), raw };
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
  }));

  const sellae: Sella[] = manifest.sellae.map((s) => ({
    id: s.id,
    roleId: s.id,
    projectId,
    kind: s.kind ?? "agent",
    collegiumId: s.collegium,
    meta: { model: s.model },
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

  interface PetitioFront { id: string; opus: string; from: string; to: string; state: PetitioState; opened?: string }
  const petitiones: Petitio[] = listMd(join(root, "petitiones")).map((p) => {
    const { data, body } = readFront<PetitioFront>(p);
    return {
      id: data.id,
      opusId: data.opus,
      openedBy: data.from === "patron" ? "you" : data.from,
      counterparty: data.from === "patron" ? data.to : data.from,
      state: data.state,
      subject: body.split("\n")[0],
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

  const providers = readUsageProviders(root);

  return { sellae, opera, providers, acta, collegia, stipendia, petitiones };
}

/**
 * usage.yml → Provider[] — the "observed" half of the W-007 provider status
 * seam. Extracted so @bisellium/providers's usageYamlSource can reuse this
 * exact parsing instead of duplicating it (docs/ADOPTION.md: usage.yml is
 * observed provider limit telemetry).
 */
export function readUsageProviders(root: string): Provider[] {
  const usagePath = join(root, "usage.yml");
  if (!existsSync(usagePath)) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(usagePath, "utf8"));
  } catch {
    // Malformed YAML (unparseable) degrades to "no observed providers"
    // rather than throwing a raw YAMLParseError at callers — see W-007
    // verifier finding on readUsageProviders.
    return [];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { providers?: unknown }).providers)
  ) {
    return [];
  }
  const u = parsed as {
    providers: unknown[];
  };
  return u.providers
    .filter(
      (p): p is { id: string; usage_pct: number; reset_at?: string; status?: ProviderStatus } =>
        typeof p === "object" && p !== null && !Array.isArray(p),
    )
    .map((p) => ({
      id: p.id,
      usagePct: p.usage_pct,
      resetAt: p.reset_at ? String(p.reset_at) : undefined,
      status: p.status ?? "unknown",
    }));
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
      const yaml = usageYamlSource(root);
      const source = live ? compositeSource([quotaAxiSource({}), yaml]) : yaml;
      const { providers } = await source.read({ now: new Date() });
      return providers;
    },
  };
}
