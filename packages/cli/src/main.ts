/** bisellium — CLI entry. `check` is the validator; more commands land per the dossier build order. */
import { resolve } from "node:path";
import { checkStudio, formatReport } from "./check.js";

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const args = rest.filter((a) => !a.startsWith("--"));

switch (cmd) {
  case "check": {
    const root = resolve(args[0] ?? ".");
    const result = checkStudio(root);
    if (flags.has("--json")) console.log(JSON.stringify(result, null, 2));
    else console.log(formatReport(root, result));
    process.exit(result.ok ? 0 : 1);
  }
  // falls through only if exit did not happen
  default:
    console.error("usage: bisellium check [dir] [--json]");
    process.exit(2);
}
