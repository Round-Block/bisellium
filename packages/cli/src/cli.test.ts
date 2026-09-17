/**
 * cli.test.ts — spawns the real CLI process (not the library functions
 * directly) and asserts exit codes and key output lines, so a bug in
 * main.ts's own argv handling or exit-code wiring can't hide behind unit
 * tests that call buildContext/answer/etc. in-process (W-004).
 *
 * `now` is pinned so age-derived text never drifts.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(process.argv[2] ?? ".");
const NOW = "2026-09-17T15:00:00Z";
const MAIN = "packages/cli/src/main.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(42)} ${detail}`);
  if (!ok) failed++;
};

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  const r = spawnSync(process.execPath, ["--import", "tsx", MAIN, ...args], { cwd: repo, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A JS stack trace frame looks like "    at fn (file:line:col)" — never emit one to the user. */
const looksLikeStackTrace = (s: string): boolean => /\n\s*at\s+\S+.*:\d+:\d+/.test(s) || /^\s*at\s+\S+.*:\d+:\d+/.test(s);

const nonStudio = mkdtempSync(join(tmpdir(), "bisellium-cli-nonstudio-"));

try {
  // ---- check ----------------------------------------------------------------
  {
    const r = run(["check", nonStudio, "--now", NOW]);
    check("check: non-studio dir exits 2", r.status === 2, `status=${r.status}`);
  }

  // ---- query ------------------------------------------------------------------
  {
    const r = run(["query", "burn", "examples/sample-studio", "--now", NOW]);
    check(
      "query burn: sample-studio exits 0, mentions engineering",
      r.status === 0 && r.stdout.includes("engineering"),
      `status=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 120))}`,
    );
  }
  {
    const r = run(["query", "burn", nonStudio, "--now", NOW]);
    check(
      "query: non-studio dir exits 2, no stack trace",
      r.status === 2 && !looksLikeStackTrace(r.stderr) && !looksLikeStackTrace(r.stdout),
      `status=${r.status} stderr=${JSON.stringify(r.stderr)}`,
    );
  }

  // ---- context ------------------------------------------------------------------
  {
    const r = run(["context", "--sella", "nobody", "examples/sample-studio", "--now", NOW]);
    check("context: unknown sella exits 1", r.status === 1, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }
  {
    const r = run(["context", "--sella", "builder-1", "--max-tokens", "300", "examples/sample-studio", "--now", NOW]);
    const truncIdx = r.stdout.indexOf("truncated:");
    const tokensIdx = r.stdout.indexOf("tokens:");
    check(
      "context: builder-1 max-tokens=300 exits 0, 'truncated:' before 'tokens:'",
      r.status === 0 && truncIdx !== -1 && tokensIdx !== -1 && truncIdx < tokensIdx,
      `status=${r.status} truncIdx=${truncIdx} tokensIdx=${tokensIdx}`,
    );
  }

  // ---- init + new: '=' inside a flag value round-trips -----------------------
  {
    const dir = mkdtempSync(join(tmpdir(), "bisellium-cli-init-"));
    try {
      const init = run(["init", dir, "--now", NOW]);
      check("init: temp dir exits 0", init.status === 0, `status=${init.status} stdout=${init.stdout}`);

      const title = "a=b: ship it";
      const newRun = run(["new", "--kind", "task", "--collegium", "production", `--title=${title}`, dir]);
      check("new: '--title=a=b: ship it' exits 0", newRun.status === 0, `status=${newRun.status} stderr=${newRun.stderr}`);

      const itemPath = join(dir, "opera", "W-001.md");
      const raw = readFileSync(itemPath, "utf8");
      check(
        "new: title with embedded '=' preserved verbatim",
        raw.includes(`title: ${JSON.stringify(title)}`),
        `raw=${JSON.stringify(raw)}`,
      );

      // A freshly-initialized studio must stay at 0 blocking / 0 advisory —
      // pins the property that init's seeded acta entry and .gitkeep-free
      // dirs are meant to guarantee. Any advisory that isn't aerarium-related
      // (a reintroduced .gitkeep, a dropped seeded acta entry, etc.) must
      // fail this.
      const afterInit = run(["check", dir, "--now", NOW]);
      const passLine = /PASS — 0 blocking, 0 advisory/.test(afterInit.stdout);
      const advisoryRuleIds = [...afterInit.stdout.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]);
      const nonAerariumRuleIds = advisoryRuleIds.filter((id) => !id!.startsWith("aerarium."));
      check(
        "check after init: 0 blocking, 0 advisory (no non-aerarium rule ids)",
        afterInit.status === 0 && passLine && nonAerariumRuleIds.length === 0,
        `status=${afterInit.status} nonAerariumRuleIds=${JSON.stringify(nonAerariumRuleIds)} stdout=${JSON.stringify(afterInit.stdout)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- new: not-a-studio ------------------------------------------------------
  {
    const r = run(["new", "--kind", "task", "--collegium", "production", "--title", "X", nonStudio]);
    check("new: non-studio dir exits 2", r.status === 2, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }

  // ---- unknown flag -------------------------------------------------------------
  {
    const r = run(["check", "examples/sample-studio", "--bogus"]);
    check("unknown flag exits 2", r.status === 2, `status=${r.status} stderr=${JSON.stringify(r.stderr)}`);
  }
} finally {
  rmSync(nonStudio, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
