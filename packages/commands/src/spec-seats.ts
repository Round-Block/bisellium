/**
 * W-452 (D-150 C, D-129 A): `bisellium.yml#spec_seats`, the seats that sign and review an opus's spec, chosen by the opus's
 * collegium. `next` (readSpecReviewer) and `verdict --phase spec` read it through this one function, so both name one signer.
 * Absent, every opus keeps today's routing (the design magister, `spec_reviewer`, and the `kind: ui` pair of D-091).
 * D-150 B: an opus whose spec sequence began before `since` (its first `ci/<id>-spec-<n>.log` carries an earlier `# at:`) keeps
 * today's routing too, so an opus in flight finishes on the seats it started under. A `kind: ui` opus keeps the UI pair.
 */
import { instant } from "@bisellium/schema";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A studio-relative reader of the checkout that owns the spec evidence (`next`'s Src; verdict's officina). */
export interface SpecLogSource {
  read(rel: string): string | undefined;
  list(dir: string): string[];
}

export type SpecSeatRoute = { route: "legacy" } | { route: "collegium"; collegium: string; signer: string; reviewer: { sella: string; model: string } } | { error: string };

/** One declared, live agent seat with a model, or why not; a signer must be a seat of the collegium it signs for (`collegium`),
 *  while a reviewer may belong to any collegium. */
function seat(m: Dict, id: string, role: "signer" | "reviewer", collegium?: string): { model: string } | { error: string } {
  const rows = (Array.isArray(m["sellae"]) ? m["sellae"] : []).filter((r): r is Dict => isDict(r) && r["id"] === id);
  const row = rows[0];
  if (row === undefined) return { error: `${id} is not a declared seat` };
  if (rows.length > 1) return { error: `${id} is declared ${rows.length} times; the spec ${role} must be one seat` };
  if (row["retired"] !== undefined && row["retired"] !== false) return { error: `${id} is retired; the spec ${role} must be a live seat` };
  if (row["kind"] !== "agent") return { error: `${id} must be kind: agent` };
  if (collegium !== undefined && row["collegium"] !== collegium)
    return { error: `${id} is a seat of ${str(row["collegium"]) ?? "no collegium"}, not ${collegium}; the spec signer must be a seat of the collegium it signs for` };
  const model = str(row["model"]);
  return model === undefined ? { error: `${id} declares no model; the spec ${role}'s model is read from its row` } : { model };
}

/** D-150 B: whether the opus's spec sequence began before `since`: a spec log of it whose `# at:` is earlier. */
function startedBefore(id: string, since: Date, logs: SpecLogSource | undefined): boolean | { error: string } {
  const name = new RegExp(`^${esc(id)}-spec-[1-9][0-9]{0,14}\\.log$`);
  for (const log of (logs?.list("ci") ?? []).filter((n) => name.test(n)).sort()) {
    const text = logs!.read(`ci/${log}`);
    if (text === undefined) return { error: `ci/${log} is unreadable; an opus's spec seats follow its first spec log (D-150 B)` };
    const head = text.split("\n");
    const end = head.indexOf("");
    const ats = (end === -1 ? head : head.slice(0, end)).filter((l) => l.startsWith("# at: "));
    const at = ats.length === 1 ? instant(ats[0]!.slice("# at: ".length)) : undefined;
    if (at === undefined) return { error: `ci/${log} carries no single "# at:" instant; an opus's spec seats follow its first spec log (D-150 B)` };
    if (at.getTime() < since.getTime()) return true;
  }
  return false;
}

/**
 * The spec seats of one opus: `legacy` (today's routing, read by the caller as before), its collegium's pair, or why the setting
 * cannot be read (next holds at spec; verdict refuses). Every form but a mapping `{ since, collegia }` is refused; a row is
 * `{ signer, reviewer }`, two declared live agent seats on different models (D-150 C: one writes, another checks), the signer a
 * seat of the row's collegium.
 */
export function readSpecSeats(manifest: unknown, id: string, rec: Dict, logs: SpecLogSource | undefined): SpecSeatRoute {
  if (!isDict(manifest) || !("spec_seats" in manifest)) return { route: "legacy" };
  const bad = (why: string): { error: string } => ({ error: `bisellium.yml#spec_seats: ${why}` });
  const s = manifest["spec_seats"];
  if (!isDict(s)) return bad("must be a mapping of since and collegia");
  const since = instant(s["since"]);
  if (since === undefined) return bad("since must be an ISO instant: the opera whose first spec log is earlier keep today's seats (D-150 B)");
  const collegia = s["collegia"];
  if (!isDict(collegia)) return bad("collegia must be a mapping of collegium id to { signer, reviewer }");
  if (rec["kind"] === "ui") return { route: "legacy" };
  const started = startedBefore(id, since, logs);
  if (typeof started !== "boolean") return started;
  if (started) return { route: "legacy" };
  const collegium = str(rec["collegium"]);
  if (collegium === undefined) return bad(`opera/${id}.md names no collegium, so no seats sign its spec`);
  const row = collegia[collegium];
  if (row === undefined) return bad(`collegia declares no seats for ${collegium}`);
  if (!isDict(row)) return bad(`collegia.${collegium} must be a mapping { signer, reviewer }`);
  const signer = str(row["signer"]);
  const reviewer = str(row["reviewer"]);
  if (signer === undefined) return bad(`collegia.${collegium}.signer must be the id of one declared seat (a non-empty string)`);
  if (reviewer === undefined) return bad(`collegia.${collegium}.reviewer must be the id of one declared seat (a non-empty string)`);
  if (signer === reviewer) return bad(`collegia.${collegium}: the signer and reviewer must be different seats`);
  const signed = seat(manifest, signer, "signer", collegium);
  if ("error" in signed) return bad(signed.error);
  const reviewed = seat(manifest, reviewer, "reviewer");
  if ("error" in reviewed) return bad(reviewed.error);
  if (signed.model === reviewed.model) return bad(`collegia.${collegium}: ${signer} and ${reviewer} are both ${signed.model}; the reviewer must be another model (D-150 C)`);
  return { route: "collegium", collegium, signer, reviewer: { sella: reviewer, model: reviewed.model } };
}
