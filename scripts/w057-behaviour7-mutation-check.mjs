#!/usr/bin/env node
/**
 * scripts/w057-behaviour7-mutation-check.mjs — mutation red evidence for
 * W-057 behaviour 7 ("every one of the seventeen error bodies is
 * byte-identical to today's"). Per the brief: behaviour 7 passes today by
 * construction (a regression guard for what must NOT change), so its red is
 * a mutation red rather than a pre-fix one — delete one of the three
 * `:581` auth literal codes ("cross-origin writes are refused" -> a
 * different string) and watch the byte-identity row for that site fail.
 *
 * Same shape as scripts/w079-mutation-check.mjs: apply the mutation, run
 * behaviour 7 alone (BISELLIUM_ONLY_BEHAVIOUR=7), restore http.ts from a
 * byte-for-byte backup in a `finally`, then propagate the mutated run's own
 * exit code — non-zero (the mutation killed) is what `bisellium red`
 * records; the file is back to its implemented, green state either way.
 *
 * Usage: node scripts/w057-behaviour7-mutation-check.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "apps/server/src/http.ts";
const targetPath = join(repoRoot, TARGET);

const FROM = 'authStatus === 403 ? "cross-origin writes are refused" : "Content-Type must be application/json"';
const TO = 'authStatus === 403 ? "cross-origin writes are refused (mutated)" : "Content-Type must be application/json"';

const backupDir = mkdtempSync(join(tmpdir(), "bisellium-w057-b7-"));
const backupPath = join(backupDir, "http.ts");
copyFileSync(targetPath, backupPath);
const original = readFileSync(backupPath, "utf8");
const matches = original.split(FROM).length - 1;
if (matches !== 1) {
  rmSync(backupDir, { recursive: true, force: true });
  throw new Error(`${TARGET}: mutation anchor matched ${matches} times, expected 1`);
}

writeFileSync(targetPath, original.replace(FROM, TO));

let suiteExit = 1;
let output = "";
try {
  output = execFileSync(
    process.execPath,
    ["--import", "tsx", join(repoRoot, "apps/server/test/server.test.ts"), repoRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, BISELLIUM_ONLY_BEHAVIOUR: "7" },
    },
  );
  suiteExit = 0;
} catch (e) {
  output = (e.stdout ?? "") + (e.stderr ?? "");
  suiteExit = typeof e.status === "number" ? e.status : 1;
} finally {
  writeFileSync(targetPath, original);
  rmSync(backupDir, { recursive: true, force: true });
}

process.stdout.write(output);
if (suiteExit === 0) {
  console.error(
    "w057-behaviour7-mutation-check: mutation SURVIVED (behaviour 7 still passed) — the byte-identity guard is not testing what it claims to",
  );
  process.exit(1);
}
console.error(
  "w057-behaviour7-mutation-check: mutation KILLED (behaviour 7 failed, as expected) — http.ts restored to its implemented state",
);
process.exit(suiteExit);
