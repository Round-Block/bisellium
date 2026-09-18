/**
 * scripts/opus-close.ts — record a passed agent `review` gate and move the
 * opus to `done`.
 *
 * The same gap opus-ready.ts fills for the spec phase, at the other end of
 * the lifecycle: a review verdict is recorded as events and a ci/ note by
 * the reviewing sella, but no `bisellium` command writes the `review`
 * probatio's result or the `building` → `done` transition — `handoff`
 * refuses a `--stage` that differs from the current state and `verify`
 * touches automated gates only. Standing rule says officina bookkeeping is
 * never edited by hand, so the orchestrator closes an opus with this.
 *
 * Refuses to close unless, on disk, every automated probatio is `passed`
 * with a `tree:` certificate and the named review note exists — the Aedile
 * refuses a `done` claim the recorded gates don't support, and so does this.
 *
 *   npx tsx scripts/opus-close.ts W-016 W-019 --studio studio \
 *     --sella eng-lead --round 3 --now <iso>
 *
 * ponytail: review-pass + done only. When the CLI grows a real
 * `bisellium review <opus> --pass` / `bisellium done <opus>` write command
 * (with its event + timeline line, the way greenlight has one), delete this
 * file and call that.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { editOpusFrontMatter } from "../packages/cli/src/frontmatter.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const opera = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const studio = resolve(flag("--studio") ?? "studio");
const nowArg = flag("--now");
const now = nowArg ? new Date(nowArg) : new Date();
const sella = flag("--sella") ?? "eng-lead";
const round = flag("--round") ?? "3";

if (opera.length === 0 || Number.isNaN(now.getTime())) {
  console.error("usage: tsx scripts/opus-close.ts <opus…> [--studio <dir>] [--sella <id>] [--round <n>] [--now <iso>]");
  process.exit(2);
}

for (const id of opera) {
  if (!/^[A-Z]-\d+$/.test(id)) {
    console.error(`refusing id "${id}" — ids are never joined into paths unchecked (D-008)`);
    process.exit(2);
  }
  const opusPath = join(studio, "opera", `${id}.md`);
  const reviewRel = `ci/${id}-review-${round}.log`;
  if (!existsSync(opusPath)) {
    console.error(`unknown opus: ${id}`);
    process.exit(2);
  }
  if (!existsSync(join(studio, reviewRel))) {
    console.error(`${id}: no review note at ${reviewRel} — nothing to record`);
    process.exit(2);
  }
  const raw = readFileSync(opusPath, "utf8");
  for (const gate of ["tests", "lint", "types"]) {
    const block = raw.split(new RegExp(`\\n  ${gate}:`))[1]?.split(/\n  \S/)[0] ?? "";
    if (!/status: passed/.test(block) || !/certifies: tree:/.test(block)) {
      console.error(`${id}: automated gate "${gate}" is not a passed tree: certificate — refusing to close`);
      process.exit(1);
    }
  }

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["probationes", "review", "sella"], sella);
    doc.setIn(["probationes", "review", "status"], "passed");
    doc.setIn(["probationes", "review", "evidence"], reviewRel);
    doc.setIn(["probationes", "review", "at"], now.toISOString());
    doc.setIn(["state"], "done");
  });
  console.log(`${id}: review passed (${reviewRel}), state done`);
}
