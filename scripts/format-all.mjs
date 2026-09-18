#!/usr/bin/env node
/**
 * scripts/format-all.mjs — the mechanical write pass behind `npm run -s
 * format:check` (W-019). Respects .prettierignore, so it never touches a
 * file another opus owns this cascade.
 *
 *   node scripts/format-all.mjs
 */
import { execFileSync } from "node:child_process";

execFileSync("npx", ["prettier", "--write", "."], { stdio: "inherit" });
