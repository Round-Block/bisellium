#!/usr/bin/env node
/**
 * scripts/lint-fix.mjs — the mechanical remediation pass for `npm run -s
 * lint` (W-019: "anything that still needs fixing is fixed by a committed
 * script, never by hand"). Idempotent: a clean tree produces no changes, so
 * running it twice in a row is always safe.
 *
 *   node scripts/lint-fix.mjs
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("npx", ["eslint", ".", "--fix"], { stdio: "inherit" });
} catch (err) {
  // eslint --fix still exits non-zero when unfixable errors remain — that's
  // a real red for `npm run -s lint` to report, not this script's to hide.
  process.exit(err.status ?? 1);
}
