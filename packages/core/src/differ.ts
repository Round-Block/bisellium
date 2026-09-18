/**
 * Snapshot differ: turns two consecutive adapter snapshots into
 * `workflow.*`/`provider.status` events. `prev === null` means the source
 * has no history yet, so everything currently in `next` "appears".
 * Every event carries workflow.time.derived = true — the timestamp is
 * observation time (ctx.ts), not occurrence time.
 */
import { WF, type GantryEvent, type ProbatioResult, type Snapshot, type PetitioState } from "@bisellium/schema";

export interface DiffContext {
  source: string;
  seq: number;
  ts: string;
  projectId: string;
  /**
   * Probatio ids that are `kind: human` in the manifest (docs/ADOPTION.md).
   * Snapshots carry only gate *results*, never gate *definitions*, so the
   * differ has no other way to know which pending gate means "needs you" —
   * the caller (whoever holds the manifest) passes this in. Stamped onto
   * `gate_evaluated` as WF.GATE_KIND so the fact survives in the log itself
   * (the Index derives `needsYou()` from events alone, never the manifest).
   */
  humanGates?: Iterable<string>;
}

export interface DiffResult {
  events: GantryEvent[];
  seq: number;
}

type Attrs = Record<string, string | number | boolean>;

const ATTENTION_MAP: Record<PetitioState, "requested" | "resolved"> = {
  needs_you: "requested",
  awaiting_reply: "requested",
  resolved: "resolved",
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * A gate result changed only when its verdict or what it certifies changed.
 * The evidence href alone (e.g. a log mirrored to a new URL) is not a
 * re-evaluation and must not fire gate_evaluated.
 */
function gateChanged(prev: ProbatioResult | undefined, next: ProbatioResult): boolean {
  return prev?.status !== next.status || prev?.evidence?.certifies !== next.evidence?.certifies;
}

function gateAttrs(base: Attrs, gateId: string, gateResult: ProbatioResult, humanGates: Set<string>): Attrs {
  const attrs: Attrs = { ...base, [WF.GATE_ID]: gateId, [WF.GATE_STATUS]: gateResult.status };
  const href = gateResult.evidence?.href;
  if (href !== undefined) attrs[WF.GATE_EVIDENCE] = href;
  const certifies = gateResult.evidence?.certifies;
  if (certifies !== undefined) attrs[WF.GATE_CERTIFIES] = certifies;
  if (humanGates.has(gateId)) attrs[WF.GATE_KIND] = "human";
  return attrs;
}

export function diffSnapshots(prev: Snapshot | null, next: Snapshot, ctx: DiffContext): DiffResult {
  const events: GantryEvent[] = [];
  let seq = ctx.seq;
  const humanGates = new Set(ctx.humanGates ?? []);

  const emit = (name: string, attrs: Attrs): void => {
    events.push({
      id: `${ctx.source}:${seq}`,
      name,
      ts: ctx.ts,
      projectId: ctx.projectId,
      attrs: {
        ...attrs,
        [WF.SOURCE]: ctx.source,
        [WF.SOURCE_SEQ]: seq,
        [WF.TIME_DERIVED]: true,
      },
    });
    seq++;
  };

  // ---- opera -----------------------------------------------------
  const prevItems = new Map((prev?.opera ?? []).map((w) => [w.id, w] as const));
  const nextItemIds = new Set(next.opera.map((w) => w.id));

  for (const item of next.opera) {
    const collegium = str(item.meta["collegium"]);
    const base: Attrs = { [WF.ITEM_ID]: item.id };
    if (collegium !== undefined) base[WF.DEPARTMENT] = collegium;

    const prevItem = prevItems.get(item.id);
    if (!prevItem) {
      // Cold appearance: emit the item, then one gate_evaluated per gate
      // already recorded on it (so replay() of a cold ingest is truthful —
      // a gate that was already passed didn't silently un-happen), then
      // an actor_assigned if it already has a sella.
      emit("workflow.item_appeared", { ...base, [WF.STATE_TO]: item.state });
      for (const [gateId, gateResult] of Object.entries(item.probationes)) {
        emit("workflow.gate_evaluated", gateAttrs(base, gateId, gateResult, humanGates));
      }
      const sella = str(item.meta["sella"]);
      if (sella !== undefined) emit("workflow.actor_assigned", { ...base, [WF.ACTOR_ROLE]: sella });
      continue;
    }

    if (prevItem.state !== item.state) {
      emit("workflow.state_changed", { ...base, [WF.STATE_FROM]: prevItem.state, [WF.STATE_TO]: item.state });
    }

    for (const [gateId, gateResult] of Object.entries(item.probationes)) {
      if (!gateChanged(prevItem.probationes[gateId], gateResult)) continue;
      emit("workflow.gate_evaluated", gateAttrs(base, gateId, gateResult, humanGates));
    }

    const prevSella = str(prevItem.meta["sella"]);
    const nextSella = str(item.meta["sella"]);
    if (nextSella !== undefined && nextSella !== prevSella) {
      emit("workflow.actor_assigned", { ...base, [WF.ACTOR_ROLE]: nextSella });
    }
  }

  for (const item of prev?.opera ?? []) {
    if (nextItemIds.has(item.id)) continue;
    const collegium = str(item.meta["collegium"]);
    const attrs: Attrs = { [WF.ITEM_ID]: item.id };
    if (collegium !== undefined) attrs[WF.DEPARTMENT] = collegium;
    emit("workflow.item_removed", attrs);
  }

  // ---- petitiones (attention) ---------------------------------------------
  const prevPetitiones = new Map((prev?.petitiones ?? []).map((t) => [t.id, t] as const));
  for (const petitio of next.petitiones ?? []) {
    const prevPetitio = prevPetitiones.get(petitio.id);
    if (prevPetitio && prevPetitio.state === petitio.state) continue;
    const attrs: Attrs = {
      [WF.ATTENTION_THREAD]: petitio.id,
      [WF.ATTENTION_EVENT]: ATTENTION_MAP[petitio.state],
    };
    if (petitio.opusId !== undefined) attrs[WF.ITEM_ID] = petitio.opusId;
    // Who opened this thread — "you" when the Patron is the asker (adapter-
    // native's openedBy), a sella id otherwise. This is what lets a reader of
    // the event log alone (no file access) tell needs_you (a sella opened it)
    // apart from awaiting_reply (the Patron opened it) — both collapse to the
    // same ATTENTION_EVENT ("requested") above.
    if (petitio.openedBy !== undefined) attrs[WF.ACTOR_ROLE] = petitio.openedBy;
    emit("workflow.attention", attrs);
  }

  // ---- acta: append-only, only new entries fire -----------------------
  // authorRoleId -> collegiumId, so acta events roll up to a collegium
  // without the caller having to join sellae themselves.
  const collegiumByRole = new Map<string, string>();
  for (const sella of next.sellae) {
    if (sella.collegiumId !== undefined && !collegiumByRole.has(sella.roleId)) {
      collegiumByRole.set(sella.roleId, sella.collegiumId);
    }
  }

  const prevActaIds = new Set((prev?.acta ?? []).map((d) => d.id));
  for (const entry of next.acta ?? []) {
    if (prevActaIds.has(entry.id)) continue;
    const attrs: Attrs = { [WF.DIGEST_ID]: entry.id, [WF.DIGEST_KIND]: entry.kind };
    const collegium = collegiumByRole.get(entry.authorRoleId);
    if (collegium !== undefined) attrs[WF.DEPARTMENT] = collegium;
    emit("workflow.digest", attrs);
  }

  // ---- providers ---------------------------------------------------------
  const prevProviders = new Map((prev?.providers ?? []).map((p) => [p.id, p] as const));
  for (const provider of next.providers ?? []) {
    const prevProvider = prevProviders.get(provider.id);
    if (prevProvider && prevProvider.usagePct === provider.usagePct && prevProvider.status === provider.status) continue;
    const attrs: Attrs = {
      [WF.PROVIDER_ID]: provider.id,
      [WF.PROVIDER_USAGE_PCT]: provider.usagePct,
      [WF.PROVIDER_STATUS]: provider.status,
    };
    if (provider.resetAt !== undefined) attrs[WF.PROVIDER_RESET_AT] = provider.resetAt;
    emit("provider.status", attrs);
  }

  return { events, seq };
}
