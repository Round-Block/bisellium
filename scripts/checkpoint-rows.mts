// W-495 (kept; the builder commits it as scripts/checkpoint-rows.mts): rewrite the figures of history rows already on the
// page from computed figures, never typed ones. For each opus named, its row's "(PR n)" names the PR; its land is the
// first-parent master commit whose subject names the opus and ends "(#n)"; the cycle, lead and cost are checkpointFigures'
// over the record timestamps on master and the usage readings under the home folder. The row's leading figures (from
// "Cycle" through "over <h> h" and a parenthesis after it) give way to the computed sentence; the prose after them stays.
// A masthead naming the opus has its "cycle N min" set to the computed cycle.
//   node --import tsx scripts/checkpoint-rows.mts <repo> <id>...   (--dry-run prints the sentences and writes nothing)
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { instant } from "@bisellium/schema";
import { checkpointFigures, firstSpecSignature } from "../packages/cli/src/checkpoint.js";
import { readReadings } from "../packages/cli/src/usage-reading.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const [repo, ...ids] = args.filter((a) => a !== "--dry-run");
if (repo === undefined || ids.length === 0) throw new Error("usage: checkpoint-rows.mts <repo> <id>... [--dry-run]");
const git = (...a: string[]): string => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" });
const PAGE = join(repo, "docs/design/dossier/progress-body.html");
const MAST = join(repo, "docs/design/dossier/body.html");
const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const trunk = {
  read: (rel: string): string | undefined => {
    try {
      return git("show", `master:studio/${rel}`);
    } catch {
      return undefined;
    }
  },
  list: (dir: string): string[] =>
    git("ls-tree", "--name-only", "master", `studio/${dir}/`)
      .split("\n")
      .filter(Boolean)
      .map((p) => p.slice(p.lastIndexOf("/") + 1)),
};
let page = readFileSync(PAGE, "utf8");
let mast = readFileSync(MAST, "utf8");
const readings = readReadings(homedir());
for (const id of ids) {
  const named = new RegExp(`<strong>${esc(id)} shipped \\(PR (\\d+)\\)</strong>`);
  const lines = page.split("\n");
  const i = lines.findIndex((l) => named.test(l));
  if (i < 0) throw new Error(`no history row names ${id} shipped`);
  const pr = named.exec(lines[i]!)![1]!;
  const land = git("log", "--first-parent", "--format=%H %cI %s", "master")
    .split("\n")
    .find((l) => l.endsWith(`(#${pr})`) && new RegExp(`(?<![\\w-])${esc(id)}(?![\\w-])`).test(l));
  if (land === undefined) throw new Error(`no master commit names ${id} and ends (#${pr})`);
  const greenlit = git(
    "log",
    "--reverse",
    "--format=%cI",
    "-G^state: .?greenlit.?$",
    "master",
    "--",
    `studio/opera/${id}.md`,
  )
    .split("\n")[0]
    ?.trim();
  const fig = checkpointFigures({
    id,
    spec: firstSpecSignature(id, [trunk]),
    greenlit: instant(greenlit),
    land: instant(land.split(" ")[1]),
    readings,
  });
  if ("missing" in fig) throw new Error(`${id}: ${fig.missing.join("; ")}`);
  console.log(`${id}: land ${land.split(" ")[0]!.slice(0, 8)} (#${pr}); ${fig.sentence}`);
  const cells = lines[i]!.split("<td>");
  const spend = cells[3];
  if (spend === undefined) throw new Error(`${id}: the row has no spend cell`);
  const lead = /^Cycle .*? over \d+(?:\.\d+)? h(?: \([^)]*\))?[.,;:]?\s*/.exec(spend);
  if (lead === null) throw new Error(`${id}: the spend cell does not open with figures: ${spend.slice(0, 80)}`);
  const rest = spend.slice(lead[0].length);
  cells[3] = `${fig.sentence} ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  lines[i] = cells.join("<td>");
  page = lines.join("\n");
  mast = mast.replace(new RegExp(`(${esc(id)} shipped PR ${pr} [^<"]*?; cycle )\\d+( min)`), `$1${fig.cycle}$2`);
}
if (!dry) {
  writeFileSync(PAGE, page);
  writeFileSync(MAST, mast);
}
