/**
 * W-610 behaviour 6 (studio/briefs/W-610.md): build-review.md and lex production §9 steps 3-4 state review on the light
 * gates before the one ci. It reads the two kept texts under studio/, so it is a test:record file, apart from
 * w610.test.ts's fixture rows; it also pins that studio/bisellium.yml declares a well-formed light_gates. Select it with --test-name-pattern='^W-610-b6\s'.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { lightGateCommands } from "@bisellium/commands/light-gates.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A row whose failing assertion's message opens with the row's title (`<title>: <message>`), the pin the brief names. */
function row(name: string, body: () => void | Promise<void>): void {
  const title = name.replace(/^W-610-b[1-9] /, "");
  test(name, { timeout: 1_800_000 }, async () => {
    try {
      await body();
    } catch (e) {
      if (!(e instanceof assert.AssertionError)) throw e;
      throw new assert.AssertionError({ message: `${title}: ${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
    }
  });
}

row("W-610-b6 build-review.md and lex production 9 steps 3-4 state review on the light gates before the one ci", () => {
  const prompt = readFileSync(join(REPO_ROOT, "studio", "prompts", "build-review.md"), "utf8");
  const lex = readFileSync(join(REPO_ROOT, "studio", "leges", "production.md"), "utf8");
  assert.match(prompt, /<WORKTREE>\/studio\/ci\/<ID>-light-<8 hex>\.log/, "the prompt names the light-gate log");
  assert.doesNotMatch(prompt, /automated gates were passed at the reviewed head's source tree/, "the prompt no longer says the full gates ran before review");
  assert.match(lex, /4\. \*\*Review:\*\* `next` orders review when the light gates/, "lex §9 step 4 orders review on the light gates");
  assert.match(lex, /after a passed review, one `ci --opus` at the reviewed tree/, "lex §9 orders one ci after the pass");
  // the real officina declares a well-formed light_gates, so it takes the new order (absent, it keeps the old one silently)
  const manifest = parse(readFileSync(join(REPO_ROOT, "studio", "bisellium.yml"), "utf8")) as Record<string, unknown>;
  const cmds = lightGateCommands(manifest, "studio", "");
  assert.ok(Array.isArray(cmds) && cmds.length > 0, `studio/bisellium.yml declares a well-formed light_gates: ${JSON.stringify(cmds)}`);
  assert.ok(!(manifest["light_gates"] as string[]).some((c) => c.includes("{studio}")), "no light_gates entry splices {studio} (D-196): the officina path is BISELLIUM_STUDIO");
});
