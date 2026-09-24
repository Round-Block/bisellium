/**
 * apps/web/src/lib/route.test.ts — W-025 behaviour 9; W-065 behaviour 1
 * (Board and Seats routes; an unknown hash still falls back to inbox).
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

// ---- W-065 behaviour 1: #/seats -> seats, #/board -> board, everything
// else from W-025 unchanged, an unknown hash still falls back to inbox -----
{
  check(1, 'route: "#/seats" -> seats', parseRoute("#/seats") === "seats", parseRoute("#/seats"));
  check(1, 'route: "#/board" -> board', parseRoute("#/board") === "board", parseRoute("#/board"));
  check(1, 'route: "#/inbox" unchanged', parseRoute("#/inbox") === "inbox", parseRoute("#/inbox"));
  check(1, 'route: "#/officina" unchanged', parseRoute("#/officina") === "officina", parseRoute("#/officina"));
  check(1, 'route: "" unchanged', parseRoute("") === "inbox", parseRoute(""));
  check(1, 'route: "#/" unchanged', parseRoute("#/") === "inbox", parseRoute("#/"));
  check(1, 'route: unknown hash falls back to inbox', parseRoute("#/nonsense") === "inbox", parseRoute("#/nonsense"));
}

process.exit(failed ? 1 : 0);
