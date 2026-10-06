/**
 * W-129 behaviour 16: the dossier backlog page shows greenlit as Planned, not In
 * flight. `renderStatusPage` over in-memory opera, no filesystem. Select the
 * numbered behaviour with `--behaviour 16` (the only one); omitting the selector
 * runs it. node:test TAP, one test(), modelled on the W-128 suites. No timers,
 * sleeps or polling.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderStatusPage } from "./status-page.mjs";

const argv = process.argv.slice(2);
const behaviourAt = argv.indexOf("--behaviour");
const only = behaviourAt === -1 ? undefined : Number(argv[behaviourAt + 1]);
if (behaviourAt !== -1 && only !== 16) {
  console.error("status-planned.test.mjs: --behaviour must be 16");
  process.exit(2);
}

/** The markup of the section whose h2 is `heading`, up to its closing tag. */
function section(html, heading) {
  const start = html.indexOf(`<h2>${heading}</h2>`);
  if (start === -1) return undefined;
  return html.slice(start, html.indexOf("</section>", start));
}
const ids = (markup) => [...markup.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]).sort();

test("W-129 behaviour 16: the dossier backlog page shows greenlit as Planned, not In flight", () => {
  const states = [
    ["W-1", "greenlit"],
    ["W-2", "building"],
    ["W-3", "verifying"],
    ["W-4", "review"],
    ["W-5", "backlog"],
    ["W-6", "halted"],
  ];
  const opera = states.map(([id, state]) => ({
    id,
    title: `title of ${id}`,
    collegium: "engineering",
    state,
    probationes: {},
  }));
  const html = renderStatusPage({
    opera,
    declaredGates: 5,
    openPetitionsByOpus: new Map(),
    decisions: [],
    rankingActa: undefined,
  });

  // (a) passes today
  const at = ["In flight", "Backlog", "Standing constraints"].map((h) => html.indexOf(`>${h}<`));
  assert.ok(
    at.every((i) => i >= 0) && at[0] < at[1] && at[1] < at[2],
    "16(a): the In flight, Backlog and Standing constraints headings appear in that order",
  );

  // (b) Genuine red
  const inFlight = section(html, "In flight");
  assert.ok(inFlight, "16(b): there is an In flight section");
  assert.deepEqual(
    ids(inFlight),
    ["W-2", "W-3", "W-4"],
    "16(b): In flight holds W-2, W-3, W-4 and not the greenlit W-1",
  );

  // (c)
  const planned = html.indexOf(">Planned<");
  assert.ok(planned > at[0] && planned < at[1], "16(c): a Planned heading sits between In flight and Backlog");
  const plannedSection = section(html, "Planned");
  assert.ok(plannedSection, "16(c): there is a Planned section");
  assert.deepEqual(ids(plannedSection), ["W-1"], "16(c): the Planned table holds exactly W-1");
  assert.ok(
    plannedSection.includes("Greenlit by the Patron and not started"),
    "16(c): the Planned caption says what Planned is",
  );

  // (d)
  const backlog = section(html, "Backlog");
  assert.ok(backlog, "16(d): there is a Backlog section");
  assert.deepEqual(ids(backlog), ["W-5", "W-6"], "16(d): Backlog still holds W-5 and W-6 only");

  // (e)
  const caption = /<p class="mock-caption">([^<]*(?:<(?!\/p>)[^<]*)*)<\/p>/.exec(inFlight)?.[1] ?? "";
  assert.ok(caption.length > 0, "16(e): the In flight section has a caption");
  assert.ok(!/greenlit/i.test(caption), "16(e): the In flight caption no longer mentions greenlit");
});
