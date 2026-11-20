import type { AttentionRow } from "./board.js";
import type { CompletionResponse, HealthResponse, OfficinaResponse, OpusEntry } from "../api.js";

export interface HomeNeedGroup {
  id: "greenlights" | "human_gates" | "inbox_decisions" | "questions";
  label: string;
  items: AttentionRow[];
}

const GROUPS: readonly Omit<HomeNeedGroup, "items">[] = [
  { id: "greenlights", label: "Greenlights" },
  { id: "human_gates", label: "Human gates" },
  { id: "inbox_decisions", label: "Inbox decisions" },
  { id: "questions", label: "Questions" },
];

export function homeAskText(item: Pick<AttentionRow, "asks">): string {
  return (item.asks ?? []).map((ask) => ask.kind === "greenlight"
    ? "Greenlight"
    : ask.kind === "human_gate"
      ? "Human gate"
      : ask.count === 1 ? "Inbox decision" : `${ask.count} Inbox decisions`).join(", ");
}

/** D-151's one collection stays unique: a combined opus is assigned to its first Board-owned kind while its row names all asks. */
export function homeNeeds(attention: readonly AttentionRow[]): HomeNeedGroup[] {
  const groups = GROUPS.map((group): HomeNeedGroup => ({ ...group, items: [] }));
  for (const item of attention) {
    const id: HomeNeedGroup["id"] = !item.boardEntry
      ? "questions"
      : item.asks?.some((ask) => ask.kind === "greenlight")
        ? "greenlights"
        : item.asks?.some((ask) => ask.kind === "human_gate")
          ? "human_gates"
          : "inbox_decisions";
    groups.find((group) => group.id === id)!.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

export interface HomeSummary {
  stuck: { count: number; cue: "blocking" | "normal" };
  health: { count: number; cue: "blocking" | "high" | "normal"; detail: string };
  wip: { id: string; label: string; count: number }[];
}

export interface HomeCompletion {
  overall: number;
  rows: { id: string; title: string; done: number; planned: number }[];
}

/** The served completion meter already owns the formula; Home retains only the facts the signed unit chart displays. */
export function homeCompletion(meter: NonNullable<CompletionResponse["meter"]>): HomeCompletion {
  return {
    overall: Math.round(meter.overall),
    rows: meter.rows.map(({ id, title, done, planned }) => ({ id, title, done, planned })),
  };
}

export function homeSummary(
  officina: Pick<OfficinaResponse, "lifecycle">,
  opera: readonly OpusEntry[],
  health: HealthResponse,
): HomeSummary {
  const stateToPhase = new Map(officina.lifecycle.states.map((state) => [state.id, state.phase] as const));
  const activePhases = [...new Set(officina.lifecycle.states.map((state) => state.phase)
    .filter((phase) => !["backlog", "planned", "done", "halted"].includes(phase)))];
  const counts = new Map(activePhases.map((phase) => [phase, 0]));
  let stuck = 0;
  for (const item of opera) {
    const phase = stateToPhase.get(item.state);
    if (phase !== undefined && counts.has(phase)) counts.set(phase, (counts.get(phase) ?? 0) + 1);
    if (phase !== "done" && phase !== "halted" && Object.values(item.probationes).some((gate) => gate.status === "failed")) stuck++;
  }
  const healthCount = health.blocks > 0 ? health.blocks : health.advisories;
  const healthDetail = health.blocks > 0
    ? `${health.blocks} blocking ${health.blocks === 1 ? "finding" : "findings"}`
    : health.advisories > 0
      ? `${health.advisories} high ${health.advisories === 1 ? "finding" : "findings"}`
      : "Healthy";
  return {
    stuck: { count: stuck, cue: stuck > 0 ? "blocking" : "normal" },
    health: { count: healthCount, cue: health.blocks > 0 ? "blocking" : health.advisories > 0 ? "high" : "normal", detail: healthDetail },
    wip: activePhases.flatMap((phase) => {
      const count = counts.get(phase) ?? 0;
      return count === 0 ? [] : [{ id: phase, label: phase.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), count }];
    }),
  };
}
