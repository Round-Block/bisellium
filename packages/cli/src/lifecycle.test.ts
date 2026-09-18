/**
 * packages/cli/src/lifecycle.test.ts — W-020 (red). `ready`/`done`/`review`
 * land in a follow-up commit; their behaviours are added to this file then.
 * `now` is pinned to 2026-09-19T13:00:00Z. House pattern: writes.test.ts is
 * the model.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cpSync } from "node:fs";
import { runRed } from "./lifecycle.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-19T13:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-lifecycle-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

try {
  // =========================================================================
  // red — behaviours 9-11
  // =========================================================================
  {
    const dir = freshStudio("red-record");
    const redsDir = join(dir, "ci", "reds", "W-900");

    const r = await runRed(["W-900", "--behaviour", "3", "--sella", "builder-a", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('out-line'); console.error('err-line'); process.exit(7)"], {});
    check("red: recording a real failure exits 0", r.exitCode === 0, String(r.exitCode));

    const logPath = join(redsDir, "03.log");
    check("red: writes 03.log", existsSync(logPath));
    const log = readFileSync(logPath, "utf8");
    const lines = log.split("\n");
    check("red: header line 1 is # behaviour: 3", lines[0] === "# behaviour: 3", lines[0]);
    check("red: header line 2 is # command:", lines[1]?.startsWith("# command: node -e") ?? false, lines[1]);
    check("red: header line 3 is # exit: 7", lines[2] === "# exit: 7", lines[2]);
    check("red: header line 4 is # at: <now>", lines[3] === `# at: ${NOW.toISOString()}`, lines[3]);
    check("red: header line 5 is # sella: builder-a", lines[4] === "# sella: builder-a", lines[4]);
    check("red: header line 6 is # tree: unknown (non-git --repo)", lines[5] === "# tree: unknown", lines[5]);
    check("red: blank line then combined output", lines[6] === "" && log.includes("out-line") && log.includes("err-line"), JSON.stringify(lines.slice(6)));
  }

  {
    const dir = freshStudio("red-exit0");
    const redsDir = join(dir, "ci", "reds", "W-901");
    const r = await runRed(["W-901", "--behaviour", "5", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "process.exit(0)"], {});
    check("red: a passing command refuses with exit 1", r.exitCode === 1, String(r.exitCode));
    check("red: no directory created for a passing command", !existsSync(redsDir));
  }

  {
    const dir = freshStudio("red-overwrite");
    const redsDir = join(dir, "ci", "reds", "W-902");
    await runRed(["W-902", "--behaviour", "1", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('first'); process.exit(1)"], {});
    await runRed(["W-902", "--behaviour", "2", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('second'); process.exit(1)"], {});
    await runRed(["W-902", "--behaviour", "1", "--studio", dir, "--repo", dir, "--now", NOW.toISOString(), "--", "node", "-e", "console.log('first-rerun'); process.exit(1)"], {});

    const log1 = readFileSync(join(redsDir, "01.log"), "utf8");
    const log2 = readFileSync(join(redsDir, "02.log"), "utf8");
    check("red: re-running a behaviour overwrites only that log", log1.includes("first-rerun") && !log1.includes("first\n"), log1);
    check("red: sibling behaviour's log is untouched", log2.includes("second"), log2);
  }

  // ---- behaviour 11: usage refusals -------------------------------------
  {
    const dir = freshStudio("red-usage");
    const okCmd = ["node", "-e", "process.exit(1)"];

    const zero = await runRed(["W-903", "--behaviour", "0", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: --behaviour 0 exits 2", zero.exitCode === 2, String(zero.exitCode));

    const negative = await runRed(["W-903", "--behaviour", "-1", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: negative --behaviour exits 2", negative.exitCode === 2, String(negative.exitCode));

    const nonInt = await runRed(["W-903", "--behaviour", "abc", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: non-integer --behaviour exits 2", nonInt.exitCode === 2, String(nonInt.exitCode));

    const noSep = await runRed(["W-903", "--behaviour", "1", "--studio", dir, "--repo", dir], {});
    check("red: missing -- separator exits 2", noSep.exitCode === 2, String(noSep.exitCode));

    const emptyCmd = await runRed(["W-903", "--behaviour", "1", "--studio", dir, "--repo", dir, "--"], {});
    check("red: empty command exits 2", emptyCmd.exitCode === 2, String(emptyCmd.exitCode));

    const dotdot = await runRed(["..", "--behaviour", "1", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: '..' opus id exits 2", dotdot.exitCode === 2, String(dotdot.exitCode));

    const withSlash = await runRed(["sub/dir", "--behaviour", "1", "--studio", dir, "--repo", dir, "--", ...okCmd], {});
    check("red: opus id with a path separator exits 2", withSlash.exitCode === 2, String(withSlash.exitCode));

    check("red: none of the usage refusals created ci/reds", !existsSync(join(dir, "ci", "reds")));
  }

  // ---- behaviour 12 (red's own slice): no-argument invocation through
  // main.ts prints red's own usage line (not the generic one) and exits 2.
  {
    const mainPath = join(repo, "packages/cli/src/main.ts");
    let stderr = "";
    let exitCode = 0;
    try {
      execFileSync("node", ["--import", "tsx", mainPath, "red"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      exitCode = err.status ?? 1;
      stderr = err.stderr ?? "";
    }
    check(`main.ts: "red" with no args exits 2`, exitCode === 2, String(exitCode));
    check(`main.ts: "red" prints its own usage, not the generic one`, stderr.trim().startsWith("usage: bisellium red "), stderr);
  }
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
