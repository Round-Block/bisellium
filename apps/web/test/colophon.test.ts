/**
 * apps/web/test/colophon.test.ts — W-024 behaviour 10: the colophon
 * renders a 1px hairline then a mono 11px ink-3 line with officina path
 * and generated-at timestamp, separated by " · ". Static-rendered with
 * `react-dom/server` — no DOM needed.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { Colophon } from "../src/components/Colophon.js";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
};

const html = renderToStaticMarkup(Colophon({ studioPath: "studio", generatedAt: "2026-09-19T00:00:00.000Z" }));

check("colophon renders a footer", html.includes("<footer"));
check("colophon renders a 1px hairline", /height:1px/.test(html) && /background:var\(--rule\)/.test(html), html);
check("colophon line is mono 11px ink-3", /font-family:var\(--font-mono\)/.test(html) && /font-size:11px/.test(html) && /color:var\(--ink-3\)/.test(html), html);
check("colophon joins officina path and generated-at with ' · '", html.includes("studio · 2026-09-19T00:00:00.000Z"), html);

process.exit(failed ? 1 : 0);
