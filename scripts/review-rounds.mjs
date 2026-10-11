/**
 * W-215: the review-round measurement, on demand. Prints what every `retro --opus` acta carries:
 *   node --import tsx scripts/review-rounds.mjs <studio>
 * Exit 0, or 2 (nothing printed) on no or several arguments, a missing directory, or a log outside its domain.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { reviewRounds } from "../packages/cli/src/retro.ts";

/** Exactly one positional: an existing directory. */
export function parseRoundsArgs(argv) {
  if (argv.length !== 1) return { error: "usage: node --import tsx scripts/review-rounds.mjs <studio>" };
  const studio = resolve(argv[0]);
  try {
    if (statSync(studio).isDirectory()) return { studio };
  } catch {
    // fall through to the one refusal
  }
  return { error: `${argv[0]} is not a directory` };
}

const args = parseRoundsArgs(process.argv.slice(2));
const rounds = "error" in args ? args : reviewRounds(args.studio);
if ("error" in rounds) {
  console.error(`review-rounds: ${rounds.error}`);
  process.exitCode = 2;
} else console.log(rounds.lines.join("\n"));
