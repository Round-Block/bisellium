#!/usr/bin/env node
/**
 * scripts/w079-mutation-check.mjs — mutation red/green evidence for W-079.
 *
 * Applies one of runAmend's two guard mutations, runs block 51 of
 * lifecycle.test.ts, then restores lifecycle.ts from a byte-for-byte copy
 * in a finally. The assertion is inverted for test-strengthening evidence:
 * exit 0 means the suite failed and killed the mutation; exit non-zero means
 * the suite passed and the mutation survived.
 *
 * Usage: node scripts/w079-mutation-check.mjs <1|2>
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "packages/commands/src/lifecycle.ts";
const targetPath = join(repoRoot, TARGET);

const MUTATIONS = {
  "1": {
    label: "absolute --spec refusal deleted",
    from: `    if (isAbsolute(specFlag)) {
      console.error(\`${"${opusId}"}: --spec "${"${specFlag}"}" must be officina-relative, not absolute\`);
      return { exitCode: 2 };
    }
`,
    to: "",
  },
  "2": {
    label: "AmendShapeError-only catch widened to a blanket refusal",
    from: `  } catch (e) {
    if (e instanceof AmendShapeError) {
      console.error(e.message);
      return { exitCode: 2 };
    }
    throw e;
  }
`,
    to: `  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return { exitCode: 2 };
  }
`,
  },
};

const behaviour = process.argv[2];
const mutation = MUTATIONS[behaviour];
if (!mutation) {
  console.error("usage: node scripts/w079-mutation-check.mjs <1|2>");
  process.exit(2);
}

const backupDir = mkdtempSync(join(tmpdir(), "bisellium-w079-"));
const backupPath = join(backupDir, "lifecycle.ts");
copyFileSync(targetPath, backupPath);
const original = readFileSync(backupPath, "utf8");
const matches = original.split(mutation.from).length - 1;
if (matches !== 1) {
  rmSync(backupDir, { recursive: true, force: true });
  throw new Error(`${TARGET}: behaviour ${behaviour} mutation anchor matched ${matches} times`);
}

writeFileSync(targetPath, original.replace(mutation.from, mutation.to));

let suiteExit = 1;
try {
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx", join(repoRoot, "packages/cli/src/lifecycle.test.ts"), repoRoot],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, BISELLIUM_ONLY_BEHAVIOUR: "51" },
    },
  );
  process.stdout.write(out);
  suiteExit = 0;
} catch (err) {
  process.stdout.write(err.stdout ?? "");
  process.stderr.write(err.stderr ?? "");
  suiteExit = typeof err.status === "number" ? err.status : 1;
} finally {
  copyFileSync(backupPath, targetPath);
  rmSync(backupDir, { recursive: true, force: true });
  if (readFileSync(targetPath, "utf8") !== original) {
    throw new Error(`w079-mutation-check: restore left ${TARGET} changed`);
  }
}

if (suiteExit === 0) {
  console.error(`w079-mutation-check: behaviour ${behaviour} mutation SURVIVED (${mutation.label})`);
  process.exit(1);
}

console.log(`w079-mutation-check: behaviour ${behaviour} mutation KILLED (${mutation.label}); suite exit ${suiteExit}`);
process.exit(0);
