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
  Actor,
  ActorKind,
  Budget,
  Department,
  DigestEntry,
  Gate,
  GateKind,
  GateResult,
  GateStatus,
  Lifecycle,
  Provider,
  ProviderStatus,
  Snapshot,
  SnapshotAdapter,
  Thread,
  ThreadState,
  WorkItem,
} from "@bisellium/schema";

// Fixed lifecycle (ADOPTION.md): greenlit is the Owner's slate decision.
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
  owner?: string;
  timezone?: string;
  departments: { id: string; name: string; lead: string; fallback?: string; charter?: string }[];
  seats: { id: string; department: string; kind?: ActorKind; model?: string }[];
  gates: { id: string; name: string; kind: GateKind }[];
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
  const raw = readFileSync(path, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${path}: missing front matter`);
  return { data: parseYaml(m[1] ?? "") as T, body: (m[2] ?? "").trim(), raw };
}

export function listMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => join(dir, f));
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
  const gates: Gate[] = manifest.gates.map((g) => ({ id: g.id, name: g.name, kind: g.kind }));
  const owner = manifest.owner ?? "owner";
  const production = manifest.departments.find((d) => d.id === "production")?.lead ?? "production";
  const actorsFor = (to: string): string[] | undefined =>
    to === "greenlit" ? [owner] : to === "done" ? ["merge-script"] : to === "halted" ? [production] : undefined;
  const transitions: Lifecycle["transitions"] = ORDER.slice(1).map((to, i) => ({ from: ORDER[i]!, to, actors: actorsFor(to) }));
  for (const s of ORDER) if (s !== "done") transitions.push({ from: s, to: "halted", actors: actorsFor("halted") });
  return { id: NATIVE_LIFECYCLE_ID, states: STATES, transitions, gates, wipLimit: manifest.wip_limit };
}

export function snapshotDir(root: string, projectId: string): Snapshot {
  const manifest = readManifest(root);

  const departments: Department[] = manifest.departments.map((d) => ({
    id: d.id,
    projectId,
    name: d.name,
    leadRoleId: d.lead,
    fallbackRoleId: d.fallback,
    charterHref: d.charter,
  }));

  const actors: Actor[] = manifest.seats.map((s) => ({
    id: s.id,
    roleId: s.id,
    projectId,
    kind: s.kind ?? "agent",
    departmentId: s.department,
    meta: { model: s.model },
  }));

  interface WorkFront {
    id: string;
    title: string;
    kind?: string;
    department?: string;
    owner?: string;
    state: string;
    gates?: Record<string, { status: GateStatus; evidence?: string; certifies?: string }>;
    tokens?: number;
    heartbeat?: string;
    review_round?: number;
    handoff?: Record<string, string>;
    resume_when?: string;
  }
  const workItems: WorkItem[] = listMd(join(root, "work")).map((p) => {
    const { data, body } = readFront<WorkFront>(p);
    const gateStatus: Record<string, GateResult> = {};
    for (const [id, g] of Object.entries(data.gates ?? {})) {
      gateStatus[id] = {
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
      gateStatus,
      meta: {
        title: data.title,
        department: data.department,
        owner: data.owner,
        tokens: data.tokens,
        heartbeat: data.heartbeat,
        reviewRound: data.review_round,
        handoff: data.handoff,
        resumeWhen: data.resume_when,
        notes: body,
      },
    };
  });

  interface AskFront { id: string; work: string; from: string; to: string; state: ThreadState; opened?: string }
  const threads: Thread[] = listMd(join(root, "asks")).map((p) => {
    const { data, body } = readFront<AskFront>(p);
    return {
      id: data.id,
      workItemId: data.work,
      openedBy: data.from === "owner" ? "you" : data.from,
      counterparty: data.from === "owner" ? data.to : data.from,
      state: data.state,
      subject: body.split("\n")[0],
    };
  });

  interface DigestFront { author: string; kind: DigestEntry["kind"]; title: string; at: string; evidence?: { label: string; href: string }[] }
  const digest: DigestEntry[] = listMd(join(root, "digest")).map((p) => {
    const { data, body } = readFront<DigestFront>(p);
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

  // Burn is derived: the sum of item tokens per department. Any burn figure
  // written in the budgets file is ignored (derive, never mirror).
  const burnFor = (departmentId: string): number =>
    workItems
      .filter((w) => w.meta["department"] === departmentId)
      .reduce((n, w) => n + (typeof w.meta["tokens"] === "number" ? (w.meta["tokens"] as number) : 0), 0);
  const budgets: Budget[] = [];
  const budgetsDir = join(root, "budgets");
  if (existsSync(budgetsDir)) {
    for (const f of readdirSync(budgetsDir).filter((f) => f.endsWith(".yml")).sort()) {
      const b = parseYaml(readFileSync(join(budgetsDir, f), "utf8")) as {
        period: string;
        departments: Record<string, { allowance_tokens?: number }>;
      };
      for (const [departmentId, v] of Object.entries(b.departments)) {
        const burn = burnFor(departmentId);
        budgets.push({
          departmentId,
          period: String(b.period),
          allowance: { tokens: v.allowance_tokens },
          burn: { tokens: burn },
          posture: posture(v.allowance_tokens, burn),
        });
      }
    }
  }

  let providers: Provider[] = [];
  const usagePath = join(root, "usage.yml");
  if (existsSync(usagePath)) {
    const u = parseYaml(readFileSync(usagePath, "utf8")) as {
      providers: { id: string; usage_pct: number; reset_at?: string; status?: ProviderStatus }[];
    };
    providers = u.providers.map((p) => ({
      id: p.id,
      usagePct: p.usage_pct,
      resetAt: p.reset_at ? String(p.reset_at) : undefined,
      status: p.status ?? "unknown",
    }));
  }

  return { actors, workItems, providers, digest, departments, budgets, threads };
}

export function createBiselliumAdapter(root: string, projectId?: string): SnapshotAdapter {
  const manifest = readManifest(root);
  const id = projectId ?? manifest.studio.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    style: "snapshot",
    projectId: id,
    intervalMs: 5_000,
    describeLifecycles: () => [describeLifecycle(manifest)],
    snapshot: async () => snapshotDir(root, id),
  };
}
