/**
 * `checkBriefStale` (W-317) — `brief.stale`, advise. An open opus (greenlit, building, verifying, review) whose record title was
 * amended (`amend --title`, an `amendments` entry with `field: title`) after its newest architect signature
 * (`ci/<id>-spec-<n>.log`: phase spec, this opus, the design magister, outcome passed; the highest such n) carries a brief that
 * may no longer match its record (W-183 and W-179 drifted). The title as signed is the `superseded` of the first title amendment after the signature;
 * it is no finding when that equals the current title, or when `briefs/<id>.md` holds the current title (whitespace runs read
 * as one space): a retitle to the brief's own record title line is not drift. Reads the checked tree only; never throws.
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { listMd, parseFrontMatter } from "@bisellium/adapter-native";
import { instant } from "@bisellium/schema";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import type { Finding, RuleOpts } from "../check.js";
import { parseLogHeader } from "./evidence.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const OPEN = new Set(["greenlit", "building", "verifying", "review"]);
const read = (root: string, rel: string, dir: string): string | undefined => {
  const f = readContainedRegularFile(root, rel, dir);
  return "error" in f ? undefined : f.bytes.toString("utf8");
};
/** A directory listing, or none when it cannot be listed (no ci/, an opera/ that is not a directory). */
const names = (list: () => string[]): string[] => {
  try {
    return list();
  } catch {
    return [];
  }
};
const spaced = (s: string): string => s.replace(/\s+/g, " ").trim();

export function checkBriefStale(root: string, opts: RuleOpts): Finding[] {
  const collegia = isDict(opts.manifest) ? opts.manifest["collegia"] : undefined;
  const design = Array.isArray(collegia) ? collegia.find((c) => isDict(c) && c["id"] === "design") : undefined;
  const architect = isDict(design) && typeof design["magister"] === "string" ? design["magister"] : undefined;
  if (architect === undefined) return [];
  const logs = names(() => readdirSync(join(root, "ci")));
  const findings: Finding[] = [];
  for (const path of names(() => listMd(join(root, "opera")))) {
    const name = basename(path);
    const id = basename(path, ".md");
    const text = read(root, `opera/${name}`, "opera");
    let d: unknown;
    try {
      d = text === undefined ? undefined : parseFrontMatter<unknown>(text, id).data;
    } catch {
      continue;
    }
    if (!isDict(d) || !OPEN.has(String(d["state"])) || typeof d["title"] !== "string") continue;
    const sig = logs
      .filter((name) => name.startsWith(`${id}-spec-`) && /^[1-9][0-9]*\.log$/.test(name.slice(id.length + 6)))
      .map((name) => ({ name, n: Number(name.slice(id.length + 6, -4)) }))
      .sort((a, b) => b.n - a.n)
      .map((l) => ({ ...l, h: parseLogHeader(read(root, `ci/${l.name}`, "ci") ?? "") }))
      .find((l) => l.h.get("phase") === "spec" && l.h.get("opus") === id && l.h.get("sella") === architect && (l.h.get("outcome") ?? "").startsWith("passed"));
    const signedAt = instant(sig?.h.get("at"));
    if (sig === undefined || signedAt === undefined) continue;
    const later = (Array.isArray(d["amendments"]) ? d["amendments"] : []).filter((a): a is Dict => isDict(a) && a["field"] === "title" && (instant(a["at"])?.getTime() ?? 0) > signedAt.getTime());
    const first = later[0];
    if (first === undefined) continue;
    if (first["superseded"] === d["title"]) continue;
    if (spaced(read(root, `briefs/${name}`, "briefs") ?? "").includes(spaced(d["title"]))) continue;
    findings.push({
      rule: "brief.stale",
      level: "advise",
      where: `opera/${name}`,
      message: `the title was amended at ${instant(first["at"])!.toISOString()}, after the newest signature ci/${sig.name} (${signedAt.toISOString()}), and briefs/${name} does not name the current title: the architect revises the brief and signs it again`,
    });
  }
  return findings;
}
