/**
 * scripts/opus-ready.ts — the Design collegium's "definition of ready" write.
 *
 * Moving an opus to `building` needs three front-matter facts set together
 * (Design lex §1, check.ts's `state.building.spec`): a `spec:` path, a
 * `passed` "spec" probatio, and `state: building`. No `bisellium` command
 * writes any of them — `handoff` refuses a `--stage` that differs from the
 * current state, `verify` touches automated gates only, and `greenlight`
 * only does backlog → greenlit. Standing rule says officina bookkeeping is
 * never edited by hand, so the architect's spec phase runs this instead.
 *
 *   npx tsx scripts/opus-ready.ts W-016 W-019 --studio studio --now <iso>
 *
 * ponytail: this is the spec-phase transition only. When the CLI grows a
 * real `bisellium ready <opus>` write command (with its event + timeline
 * line, the way greenlight has one), delete this file and call that.
 */
import { existsSync } from "node:fs";
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
const sella = flag("--sella") ?? "architect";

if (opera.length === 0 || Number.isNaN(now.getTime())) {
  console.error("usage: tsx scripts/opus-ready.ts <opus…> [--studio <dir>] [--sella <id>] [--now <iso>]");
  process.exit(2);
}

for (const id of opera) {
  if (!/^[A-Z]-\d+$/.test(id)) {
    console.error(`refusing id "${id}" — ids are never joined into paths unchecked (D-008)`);
    process.exit(2);
  }
  const opusPath = join(studio, "opera", `${id}.md`);
  const briefRel = `briefs/${id}.md`;
  if (!existsSync(opusPath)) {
    console.error(`unknown opus: ${id}`);
    process.exit(2);
  }
  if (!existsSync(join(studio, briefRel))) {
    console.error(`${id}: no spec at ${briefRel} — not ready (Design lex §1)`);
    process.exit(2);
  }

  editOpusFrontMatter(opusPath, (doc) => {
    doc.setIn(["spec"], briefRel);
    doc.setIn(["probationes", "spec", "sella"], sella);
    doc.setIn(["probationes", "spec", "status"], "passed");
    doc.setIn(["probationes", "spec", "evidence"], briefRel);
    doc.setIn(["probationes", "spec", "at"], now.toISOString());
    doc.setIn(["state"], "building");
    // Leaving a halt's exit conditions behind on a building opus would
    // describe a state it is no longer in.
    for (const k of ["halted_at", "reason", "resume_when"]) doc.delete(k);
    return undefined;
  });
  console.log(`${id}: spec=${briefRel} gate=spec:passed state=building`);
}
