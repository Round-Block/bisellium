/**
 * scripts/v1-walk-count.ts — W-576: the count reader. `node --import tsx scripts/v1-walk-count.ts --studio <dir>` prints
 * `v1 walk: <green> of 9 steps green` from the walk table (packages/core/src/v1-walk.ts) and exits 0; when S5 is not
 * counted, a second line names the half that failed. It runs the S5 bar script (scripts/s5-bar.ts under the cwd,
 * W-308's) only when S5's row is empty, passing `--studio <dir> --opus <S5 barOpus>`: exit 0 is met, exit 1 breached,
 * absent or any other exit is not run. A malformed table prints `v1 walk: refused: <why>` and exits 2; so does any other
 * argument (with a usage line). `BISELLIUM_WALK_TABLE` (this reader's only, evidence tooling no gate sets) names a JSON
 * table scored instead of `WALK`. See studio/briefs/W-576.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WALK, walkScore, type BarResult, type WalkRow, type WalkScore } from "../packages/core/src/v1-walk.js";

const USAGE = "usage: node --import tsx scripts/v1-walk-count.ts --studio <dir>";
const BAR_TIMEOUT_MS = 120_000;
/** The repository the reader runs from: the bar child runs there, so its `--import tsx` resolves. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The bar script's answer for one opus: the cwd's scripts/s5-bar.ts, run with the studio's absolute path. */
function runBar(studio: string, opus: string): BarResult {
  const script = join(process.cwd(), "scripts", "s5-bar.ts");
  if (!existsSync(script)) return { ok: false, notRun: "scripts/s5-bar.ts is absent" };
  const r = spawnSync(process.execPath, ["--import", "tsx", script, "--studio", resolve(studio), "--opus", opus], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: BAR_TIMEOUT_MS,
  });
  const last = (r.stdout ?? "").trim().split("\n").at(-1)?.trim() ?? "";
  if (r.status === 0) return { ok: true, opus };
  if (r.status === 1) return { ok: false, breached: last === "" ? "exit 1" : last };
  return { ok: false, notRun: r.error !== undefined ? r.error.message : `exit ${r.status ?? r.signal}` };
}

function barText(score: WalkScore): string {
  const bar = score.s5.bar;
  if (bar === "not run") return "not run: S5's row is pending";
  if (bar.ok) return `met by ${bar.opus}`;
  return "breached" in bar ? `breached: ${bar.breached}` : `not run: ${bar.notRun}`;
}

export function main(argv: readonly string[]): number {
  if (argv.length !== 2 || argv[0] !== "--studio" || argv[1] === undefined || argv[1] === "") {
    console.error(USAGE);
    return 2;
  }
  const studio = argv[1];
  let walk: readonly WalkRow[] = WALK;
  const tablePath = process.env["BISELLIUM_WALK_TABLE"];
  if (tablePath !== undefined) {
    try {
      walk = JSON.parse(readFileSync(tablePath, "utf8")) as readonly WalkRow[];
    } catch (e) {
      console.log(
        `v1 walk: refused: BISELLIUM_WALK_TABLE ${tablePath} is unreadable: ${(e as Error).message.split("\n")[0]}`,
      );
      return 2;
    }
  }
  let score: WalkScore;
  try {
    score = walkScore(walk);
    const s5 = walk.find((r) => r.step === "S5")!;
    if (score.s5.table === "empty") score = walkScore(walk, runBar(studio, s5.barOpus!));
  } catch (e) {
    console.log((e as Error).message);
    return 2;
  }
  console.log(`v1 walk: ${score.green} of 9 steps green`);
  const counted = score.s5.table === "empty" && score.s5.bar !== "not run" && score.s5.bar.ok;
  if (!counted)
    console.log(
      `S5: table ${score.s5.table === "empty" ? "empty" : `pending ${score.s5.table.join(", ")}`}; bar ${barText(score)}`,
    );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
