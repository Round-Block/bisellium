/**
 * `checkHookGuard` (W-310) — `hook.guard`, block. With `--repo`, a repo whose `.claude/settings.json`
 * exists wires the guard (`guardWiring`: a PreToolUse group covering Bash, Write, Edit and NotebookEdit
 * and a SubagentStop group, each running `bisellium hook-event guard --studio studio`), so a settings
 * edit cannot drop it unseen. A repo without the file is not judged; an unreadable or unparseable file
 * blocks once. Reads only the checked repo's settings file; never throws.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readContainedRegularFile } from "@bisellium/commands/opus-model.js";
import type { Finding, RuleOpts } from "../check.js";
import { guardWiring } from "../guard.js";

export function checkHookGuard(_root: string, opts: RuleOpts): Finding[] {
  const where = ".claude/settings.json";
  if (!opts.repo || !existsSync(join(opts.repo, where))) return [];
  const block = (message: string): Finding => ({ rule: "hook.guard", level: "block", where, message });
  const file = readContainedRegularFile(opts.repo, where, ".claude");
  if ("error" in file) return [block(`unreadable: ${file.error}`)];
  let settings: unknown;
  try {
    settings = JSON.parse(file.bytes.toString("utf8"));
  } catch (e) {
    return [block(`not JSON: ${(e as Error).message}`)];
  }
  return guardWiring(settings).map((m) => block(`the guard is not wired: ${m} (W-310)`));
}
