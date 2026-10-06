/**
 * packages/cli/src/rules/milestones.ts — W-152: `milestones.shape` and
 * `opus.milestone` (D-038). Seam S2: `root` is the OFFICINA. Reads
 * `milestones.yml` and each opus's `milestone:` / `value:`; writes nothing,
 * never throws. Both rules are inert while `milestones.yml` is absent: the
 * mapping is demanded only once there is something to map to.
 */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { listMd, readFront } from "@bisellium/adapter-native";
import { MILESTONE_VALUES } from "@bisellium/commands/lifecycle.js";
import { parse as parseYaml } from "yaml";
import { ID_RE } from "../check.js";
import type { Finding, RuleOpts } from "../check.js";

const MILESTONES_FILE = "milestones.yml";
const EXIT_KEYS = ["opus", "rule", "needs"];

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const block = (rule: string, where: string, message: string): Finding => ({ rule, level: "block", where, message });

/** The declared milestones: ids (or undefined when the file is absent) plus
 *  every shape problem. One parse shared by both rules. */
function readDeclared(root: string): { ids: Set<string>; problems: string[] } | undefined {
  const path = join(root, MILESTONES_FILE);
  if (!existsSync(path)) return undefined;
  const ids = new Set<string>();
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    return { ids, problems: [`${MILESTONES_FILE} does not parse: ${(e as Error).message.split("\n")[0]}`] };
  }
  const list = isDict(doc) ? doc["milestones"] : undefined;
  if (!Array.isArray(list)) return { ids, problems: [`${MILESTONES_FILE} needs a "milestones" list`] };

  let total = 0;
  let weightsOk = true;
  list.forEach((m, i) => {
    const at = `milestone #${i + 1}`;
    if (!isDict(m)) {
      problems.push(`${at} is not a mapping`);
      weightsOk = false;
      return;
    }
    const id = m["id"];
    if (typeof id !== "string" || !ID_RE.test(id)) problems.push(`${at} id ${JSON.stringify(id)} is not a valid id`);
    else if (ids.has(id)) problems.push(`duplicate milestone id "${id}"`);
    else ids.add(id);
    const name = typeof id === "string" ? `milestone ${id}` : at;
    const w = m["weight"];
    if (typeof w !== "number" || !Number.isInteger(w) || w <= 0) {
      problems.push(`${name} weight must be a positive integer`);
      weightsOk = false;
    } else total += w;
    const exit = m["exit"];
    const keys = isDict(exit) ? Object.keys(exit) : [];
    const key = keys[0];
    if (!isDict(exit) || keys.length !== 1 || key === undefined || !EXIT_KEYS.includes(key))
      problems.push(`${name} exit must have exactly one of ${EXIT_KEYS.join(" | ")}`);
    else if (typeof exit[key] !== "string" || exit[key] === "") problems.push(`${name} exit ${key} must be a non-empty string`);
  });
  if (weightsOk && total !== 100) problems.push(`milestone weights total ${total}, not 100`);
  return { ids, problems };
}

export function checkMilestones(root: string, _opts: RuleOpts): Finding[] {
  const declared = readDeclared(root);
  if (!declared) return [];
  const findings = declared.problems.map((p) => block("milestones.shape", MILESTONES_FILE, p));

  for (const path of listMd(join(root, "opera"))) {
    try {
      if (!lstatSync(path).isFile()) continue;
      const d: unknown = readFront<unknown>(path).data;
      if (!isDict(d) || d["state"] === "halted") continue;
      const where = `opera/${basename(path)}`;
      const m = d["milestone"];
      const mapped = m === undefined || m === null ? [] : Array.isArray(m) ? m : [m];
      if (mapped.length !== 1) {
        findings.push(block("opus.milestone", where, `maps to ${mapped.length} milestones, needs exactly 1 (amend --milestone <id> --value <n>)`));
        continue;
      }
      if (typeof mapped[0] !== "string" || !declared.ids.has(mapped[0]))
        findings.push(block("opus.milestone", where, `milestone ${JSON.stringify(mapped[0])} is not declared in ${MILESTONES_FILE}`));
      else if (typeof d["value"] !== "number" || !MILESTONE_VALUES.includes(d["value"]))
        findings.push(block("opus.milestone", where, `value ${JSON.stringify(d["value"])} must be one of ${MILESTONE_VALUES.join(", ")}`));
    } catch {
      /* unreadable record: opus.parse already reports it */
    }
  }
  return findings;
}
