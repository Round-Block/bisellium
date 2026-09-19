/**
 * apps/web/src/lib/route.test.ts — W-025 behaviour 9.
 */
import { parseRoute } from "./route.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

// ---- Behaviour 9: /#/inbox -> Inbox, /#/officina -> Officina, default ->
// Inbox --------------------------------------------------------------------
{
  check(9, 'route: "#/inbox" -> inbox', parseRoute("#/inbox") === "inbox", parseRoute("#/inbox"));
  check(9, 'route: "#/officina" -> officina', parseRoute("#/officina") === "officina", parseRoute("#/officina"));
  check(9, 'route: "" (no hash) -> inbox', parseRoute("") === "inbox", parseRoute(""));
  check(9, 'route: "#/" (root hash) -> inbox', parseRoute("#/") === "inbox", parseRoute("#/"));
}

process.exit(failed ? 1 : 0);
