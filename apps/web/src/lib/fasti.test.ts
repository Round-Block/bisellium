/**
 * apps/web/src/lib/fasti.test.ts — W-025 behaviours 1-3 (fasti strip day
 * math). No framework, exit code off `failed`, house pattern (nearest
 * model packages/cli/src/rules.test.ts): `argv[2]` a conventional repo arg
 * (unused here — this module has no filesystem/git dependency), `argv[3]`
 * an optional behaviour number to isolate a single red (`bisellium red`'s
 * own convention — two behaviours never share one recorded output).
 */
import { buildFastiColumns } from "./fasti.js";

let failed = 0;
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
function check(behaviour: number, name: string, ok: boolean, detail = "") {
  if (only !== undefined && only !== behaviour) return;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`);
  if (!ok) failed++;
}

const TODAY = new Date("2026-09-19T00:00:00.000Z"); // a Saturday

// ---- Behaviour 1: exactly 14 day-columns spanning today-13..today, with a
// weekday initial under each ---------------------------------------------
{
  const cols = buildFastiColumns([], TODAY);
  check(1, "fasti: renders exactly 14 day-columns", cols.length === 14, `got ${cols.length}`);
  check(
    1,
    "fasti: spans today-13 through today",
    cols[0]?.date === "2026-09-06" && cols[13]?.date === "2026-09-19",
    `${cols[0]?.date} .. ${cols[13]?.date}`,
  );
  check(
    1,
    "fasti: every column carries a weekday initial",
    cols.every((c) => typeof c.weekdayInitial === "string" && c.weekdayInitial.length === 1),
  );
}

// ---- Behaviour 2: the today column carries the 1px full-height ink rule,
// no other column does ------------------------------------------------------
{
  const cols = buildFastiColumns([], TODAY);
  const todayCols = cols.filter((c) => c.isToday);
  check(2, "fasti: exactly one column is today", todayCols.length === 1, `got ${todayCols.length}`);
  check(2, "fasti: the today column is the last (rightmost) one", cols[13]?.isToday === true);
}

// ---- Behaviour 3: a landing day ticks filled, a non-landing day ticks
// hollow ----------------------------------------------------------------
{
  const acta = [{ id: "a1", author: "eng-lead", kind: "retro", title: "Retrospectio 6", at: "2026-09-18T14:00:00.000Z", evidence: {} }];
  const cols = buildFastiColumns(acta, TODAY);
  const landed = cols.find((c) => c.date === "2026-09-18");
  const notLanded = cols.find((c) => c.date === "2026-09-17");
  check(3, "fasti: a day with a cascade-landing actum ticks filled", landed?.tick === "filled", `${landed?.tick}`);
  check(3, "fasti: a day with no landing ticks hollow", notLanded?.tick === "hollow", `${notLanded?.tick}`);
}

process.exit(failed ? 1 : 0);
