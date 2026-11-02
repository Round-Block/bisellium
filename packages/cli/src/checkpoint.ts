/**
 * packages/cli/src/checkpoint.ts — W-495: the checkpoint row's figures, computed, never typed. The cycle runs from the
 * opus's first spec signature (the earliest `# at:` of its `ci/<id>-spec-<n>.log`) to its land (the committer time of its
 * PR's merge commit on master); the lead from its greenlight (the committer time of the first master commit that wrote
 * `state: greenlit` into its record) to the land; the cost is the plans' whole use in the cycle, from the usage readings
 * (`spanCost`). `done` writes the sentence into the history row's FIGURES_SLOT. See studio/briefs/W-495.md.
 */
import { instant } from "@bisellium/schema";
import { costPhrase, spanCost, type Cost, type Reading } from "./usage-reading.js";

/** The slot a checkpoint row carries where done writes its figures. */
export const FIGURES_SLOT = "{{figures}}";

const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const named = (id: string): RegExp => new RegExp(`(?<![\\w-])${esc(id)}(?![\\w-])`); // one-sided: W-214's own match of an opus id on the history page, reused; a non-ASCII letter beside an id is a stated limit

/** A studio-relative reader (next's Src). */
export interface SpecLogs {
  read(rel: string): string | undefined;
  list(dir: string): string[];
}

/** The earliest single `# at:` instant in the header of the opus's spec logs across `sources`; a log without one is passed over. */
export function firstSpecSignature(id: string, sources: (SpecLogs | undefined)[]): Date | undefined {
  const name = new RegExp(`^${esc(id)}-spec-[1-9][0-9]{0,14}\\.log$`);
  let first: Date | undefined;
  for (const src of sources) {
    if (src === undefined) continue;
    for (const log of src.list("ci").filter((n) => name.test(n))) {
      const text = src.read(`ci/${log}`);
      if (text === undefined) continue;
      const lines = text.split("\n");
      const end = lines.indexOf("");
      const ats = (end === -1 ? lines : lines.slice(0, end)).filter((l) => l.startsWith("# at: "));
      const at = ats.length === 1 ? instant(ats[0]!.slice("# at: ".length)) : undefined;
      if (at !== undefined && (first === undefined || at.getTime() < first.getTime())) first = at;
    }
  }
  return first;
}

export interface FigureInputs {
  id: string;
  /** The first spec signature, the greenlight and the land; undefined when the record does not show it. */
  spec: Date | undefined;
  greenlit: Date | undefined;
  land: Date | undefined;
  readings: Reading[] | { error: string };
}
export type Figures = { sentence: string; cycle: number; lead: number; cost: Cost } | { missing: string[] };

const stamp = (d: Date): string => `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}Z`;

/** The row's figures, or what is missing to compute them; a missing input is named, never filled in. */
export function checkpointFigures(i: FigureInputs): Figures {
  const missing: string[] = [];
  if (i.spec === undefined) missing.push(`no spec log of ${i.id} on master carries an "# at:" instant, so the cycle has no start (its first spec signature)`);
  if (i.greenlit === undefined) missing.push(`no master commit wrote "state: greenlit" into opera/${i.id}.md, so the lead has no start (its greenlight)`);
  if (i.land === undefined) missing.push(`the merge commit of ${i.id}'s PR cannot be read, so the cycle and the lead have no end (its land)`);
  if ("error" in i.readings) missing.push(`the usage readings cannot be read (${i.readings.error}), so the cost has no source`);
  const { spec, greenlit, land, readings } = i;
  if (spec === undefined || greenlit === undefined || land === undefined || "error" in readings) return { missing };
  if (spec.getTime() > land.getTime()) return { missing: [`the first spec signature (${spec.toISOString()}) is after the land (${land.toISOString()})`] };
  if (greenlit.getTime() > land.getTime()) return { missing: [`the greenlight (${greenlit.toISOString()}) is after the land (${land.toISOString()})`] };
  const cycle = Math.round((land.getTime() - spec.getTime()) / 60_000);
  const lead = Math.round((land.getTime() - greenlit.getTime()) / 60_000);
  const cost = spanCost(readings, spec.getTime(), land.getTime());
  const sentence =
    `Cycle ${cycle} min from the first spec signature (${stamp(spec)}) to land (${stamp(land)}); ` +
    `lead ${lead} min (${(lead / 1440).toFixed(1)} days) from the greenlight (${stamp(greenlit)}); ` +
    `${costPhrase(cost)} (the plans' whole use in the cycle, every lane's, from the usage readings).`;
  return { sentence, cycle, lead, cost };
}

/** The history page with FIGURES_SLOT filled with `sentence` on every line naming `id`; `filled` counts the slots. */
export function fillFigures(page: string, id: string, sentence: string): { page: string; filled: number } {
  const re = named(id);
  let filled = 0;
  const lines = page.split("\n").map((l) => {
    if (!re.test(l) || !l.includes(FIGURES_SLOT)) return l;
    const parts = l.split(FIGURES_SLOT);
    filled += parts.length - 1;
    return parts.join(sentence);
  });
  return { page: lines.join("\n"), filled };
}
