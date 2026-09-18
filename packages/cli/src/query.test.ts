/**
 * packages/cli/src/query.test.ts — W-013's `--from-index` path
 * (packages/cli/src/query.ts's `answerFromIndexIfPresent`) against temp
 * copies of examples/sample-studio. `now` is pinned to 2026-09-18T14:00:00Z,
 * same clock writes.test.ts uses.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { snapshotDir } from "@bisellium/adapter-native";
import { Store } from "@bisellium/core";
import { answer } from "./query.js";
import { runGreenlight } from "./writes.js";

const repo = resolve(process.argv[2] ?? ".");
const sampleStudio = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-18T14:00:00Z");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${detail}`);
  if (!ok) failed++;
};

const dirs: string[] = [];
function freshStudio(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bisellium-query-${tag}-`));
  cpSync(sampleStudio, dir, { recursive: true });
  // Hermetic per this file's own header: a `.bisellium/` the fixture picked
  // up from some other run against examples/sample-studio directly (it's
  // gitignored, not tracked, but cpSync copies it regardless) must not leak
  // into what's supposed to be a clean copy.
  rmSync(join(dir, ".bisellium"), { recursive: true, force: true });
  dirs.push(dir);
  return dir;
}

// ---- --from-index must not answer stale after a CLI write ------------------
// Simulates a studio that already has a primed `.bisellium/` index (e.g. from
// apps/server having ingested it once) and then receives a write that never
// goes through that Store — every `bisellium <write>` command (handoff/emit/
// answer/greenlight/budget, packages/cli/src/writes.ts) edits files or
// appends events directly. The index must not keep answering the pre-write
// state forever (the verifier's repro: `status W-007` via files says
// "greenlit" after `bisellium greenlight W-007`, but --from-index kept
// saying "backlog").
try {
  const dir = freshStudio("stale-index");

  const primer = new Store({ studioDir: dir });
  primer.ingest(snapshotDir(dir, "query", NOW), { source: "query", ts: NOW.toISOString(), projectId: "sample-studio" });
  primer.query.close();

  const before = answer(dir, "status W-007", { now: NOW, fromIndex: true });
  check("before greenlight: --from-index reports backlog", /state: backlog/.test(before.answer ?? ""), before.answer ?? "");

  const gl = runGreenlight(["W-007", "--studio", dir], { now: NOW });
  check("greenlight: exitCode 0", gl.exitCode === 0, String(gl.exitCode));

  const after = answer(dir, "status W-007", { now: NOW, fromIndex: true });
  check(
    "after greenlight: --from-index reflects greenlit, not stale backlog",
    /state: greenlit/.test(after.answer ?? ""),
    after.answer ?? "",
  );
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ---- W-016 behaviour 2 & 10: --from-index on a studio with no index yet ----
// builds one (index.db exists, the question is answered from it) but never
// writes to the shared events.jsonl the CLI/hooks also append to — a read
// path must not have write side effects on the log other tools trust.
try {
  const dir = freshStudio("fresh-index");
  const logPath = join(dir, ".bisellium", "events.jsonl");
  const dbPath = join(dir, ".bisellium", "index", "index.db");
  const before = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);

  check("fresh studio: no index.db yet", !existsSync(dbPath));

  const result = answer(dir, "status W-007", { now: NOW, fromIndex: true });
  check("fresh studio: --from-index answers on first use", /state: backlog/.test(result.answer ?? ""), result.answer ?? "");
  check("fresh studio: --from-index built the index db", existsSync(dbPath));

  const after = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);
  check(
    "fresh studio: --from-index appended nothing to events.jsonl",
    Buffer.compare(before, after) === 0,
    `before=${before.length}B after=${after.length}B`,
  );
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
