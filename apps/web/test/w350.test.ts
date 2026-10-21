/** W-350's policy row reads source text first, so its master red is an
 * assertion failure even though the browser spec and font helper do not yet
 * exist there. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { brotliCompressSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string): string => {
  try {
    return readFileSync(resolve(ROOT, rel), "utf8");
  } catch {
    return "";
  }
};

function fixtureWoff2(family: string, weight: number): Uint8Array {
  const familyBytes = Buffer.from([...family].flatMap((char) => [0, char.charCodeAt(0)]));
  const name = Buffer.alloc(18 + familyBytes.length);
  name.writeUInt16BE(1, 2);
  name.writeUInt16BE(18, 4);
  name.writeUInt16BE(3, 6);
  name.writeUInt16BE(1, 8);
  name.writeUInt16BE(0x409, 10);
  name.writeUInt16BE(16, 12);
  name.writeUInt16BE(familyBytes.length, 14);
  familyBytes.copy(name, 18);
  const os2 = Buffer.alloc(6);
  os2.writeUInt16BE(weight, 4);
  const compressed = brotliCompressSync(Buffer.concat([name, os2]));
  const directory = Buffer.from([5, name.length, 6, os2.length]);
  const out = Buffer.alloc(48 + directory.length + compressed.length);
  out.write("wOF2", 0, "latin1");
  out.writeUInt32BE(0x00010000, 4);
  out.writeUInt32BE(out.length, 8);
  out.writeUInt16BE(2, 12);
  out.writeUInt32BE(compressed.length, 20);
  directory.copy(out, 48);
  compressed.copy(out, 48 + directory.length);
  return out;
}

test("W-350-b1 behaviour 1: the four live screens have deterministic runner-owned desktop and phone baselines", async () => {
  const spec = read("apps/web/tests-serve/screenshots.spec.ts");
  const fonts = read("apps/web/tests-serve/font-assets.ts");
  const config = read("apps/web/playwright.serve.config.ts");
  const tokens = read("apps/web/src/tokens.css");
  const html = read("apps/web/index.html");
  const workflow = read(".github/workflows/ci.yml");

  assert.match(spec, /const VIEWPORTS = \[1280, 390\] as const/, "the screenshot row names the exact desktop and phone widths");
  assert.match(spec, /NAV_ENTRIES/, "the screenshot row enumerates the live navigation table");
  assert.match(spec, /clock\.setFixedTime\(new Date\(FIXED_NOW\)\)/, "the browser clock stays fixed while loading continues");
  assert.doesNotMatch(spec, /clock\.install/, "the screenshot row does not install an advancing fake clock");
  assert.match(spec, /expectLoadedState/, "every screen has a loaded-fixture assertion before capture");
  assert.match(spec, /expectFontAssets/, "font files are authenticated before the served browser starts");
  assert.match(spec, /document\.fonts\.load/, "every declared production face and weight is loaded before capture");
  assert.match(spec, /toHaveScreenshot\(`\$\{entry\.route\}-\$\{width\}\.png`/, "the matrix uses Playwright screenshot assertions");
  assert.match(spec, /scrollTo\(0, 0\)/, "scroll positions are reset for the initial view");
  assert.match(spec, /document\.activeElement/, "focus is cleared deliberately");
  assert.match(spec, /getSelection\(\)\?\.removeAllRanges/, "selection is cleared deliberately");
  assert.match(spec, /page\.mouse\.move\(width - 1, 899\)/, "the pointer is parked away from controls");

  for (const name of [
    "BricolageGrotesque-SemiBold.woff2",
    "BricolageGrotesque-Bold.woff2",
    "InstrumentSans-Regular.woff2",
    "InstrumentSans-Medium.woff2",
    "IBMPlexMono-Regular.woff2",
  ]) assert.match(fonts, new RegExp(name.replace(/\./g, "\\.")), `${name} is an authenticated input`);
  assert.match(fonts, /readWoff2Identity/, "font identity comes from the WOFF2's own tables");
  assert.match(fonts, /OFL\.txt/, "each family carries its SIL OFL licence");
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/, "index.html makes no external font request");
  assert.match(tokens, /@font-face[\s\S]*Bricolage Grotesque[\s\S]*Instrument Sans[\s\S]*IBM Plex Mono/, "production families are declared from local assets");

  assert.match(config, /deviceScaleFactor: 1/, "DPR is one");
  assert.match(config, /locale: "en-GB"/, "locale is en-GB");
  assert.match(config, /timezoneId: "UTC"/, "timezone is UTC");
  assert.match(config, /threshold: 0/, "pixel threshold is zero");
  assert.match(config, /maxDiffPixels: 0/, "no differing pixel is accepted");
  assert.match(config, /updateSnapshots: refreshScreenshots \? "all" : "none"/, "baseline writes default off");
  assert.match(workflow, /workflow_dispatch:[\s\S]*refresh_screenshots:/, "only an explicit runner dispatch requests refresh");
  assert.match(workflow, /run: npm run -s test:policy --workspace @bisellium\/web/, "web-e2e runs the focused policy step");
  assert.match(workflow, /screenshots\.spec\.ts-snapshots/, "the runner uploads the generated baseline directory");

  const { FONT_ASSETS, readWoff2Identity } = await import("../tests-serve/font-assets.js");
  const faces = [...tokens.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => {
    const block = match[1] ?? "";
    return {
      family: /font-family:\s*"([^"]+)"/.exec(block)?.[1],
      style: /font-style:\s*([^;]+);/.exec(block)?.[1]?.trim(),
      weight: Number(/font-weight:\s*(\d+);/.exec(block)?.[1]),
      src: /src:\s*url\("([^"]+)"\)\s*format\("woff2"\)/.exec(block)?.[1],
    };
  });
  assert.deepEqual(
    faces,
    FONT_ASSETS.map(({ family, style, weight, path }) => ({ family, style, weight, src: `./assets/fonts/${path}` })),
    "exactly five local CSS faces bind each authenticated family, style and weight to its FONT_ASSETS path",
  );
  assert.deepEqual(readWoff2Identity(fixtureWoff2("Bricolage Grotesque", 600)), { family: "Bricolage Grotesque", weight: 600 }, "family and weight come from the font's own tables");
  assert.throws(() => readWoff2Identity(new Uint8Array()), /not a WOFF2 font/, "an arbitrary file is not accepted as a font");

  const { parse } = await import("yaml");
  const ci = parse(workflow) as { jobs: { "web-e2e": { "runs-on": string; steps: { run?: string; uses?: string; if?: string; env?: Record<string, string> }[] } } };
  const webE2e = ci.jobs["web-e2e"];
  const fullPath = "github.event_name != 'pull_request' && steps.scope.outputs.record_only != 'true'";
  const refreshEnv = { BISELLIUM_UPDATE_SCREENSHOTS: "${{ inputs.refresh_screenshots && '1' || '0' }}" };
  assert.equal(webE2e["runs-on"], "ubuntu-24.04", "the screenshot job pins its OS family");
  const serve = webE2e.steps.find((step) => step.run?.includes("test:serve"));
  assert.deepEqual(serve?.env, refreshEnv, "the test:serve step derives refresh only from the dispatch input");
  const rendering = webE2e.steps.find((step) => step.run?.includes("rendering-environment.ts"));
  assert.deepEqual(
    { if: rendering?.if, env: rendering?.env },
    { if: fullPath, env: refreshEnv },
    "the rendering identity runs on every full path and derives writes only from the dispatch input",
  );
  const upload = webE2e.steps.find((step) => step.uses === "actions/upload-artifact@v4");
  assert.equal(upload?.if, "github.event_name == 'workflow_dispatch' && inputs.refresh_screenshots", "baseline upload is dispatch-refresh only");

  const { readRenderingEnvironmentMode } = await import("../tests-serve/rendering-environment.js");
  assert.equal(readRenderingEnvironmentMode("0", "true"), "compare", "the full-path identity step compares when refresh is off");
  assert.equal(readRenderingEnvironmentMode("1", "true"), "write", "the full-path identity step writes on an authorised runner refresh");
  assert.throws(() => readRenderingEnvironmentMode("1", undefined), /GitHub Actions/, "the rendering identity cannot be written by a developer machine");

  const { readRefreshScreenshots } = await import("../playwright.serve.config.js");
  assert.equal(readRefreshScreenshots(undefined, undefined), false, "an absent refresh value compares only");
  assert.equal(readRefreshScreenshots("0", "true"), false, "zero compares only");
  assert.equal(readRefreshScreenshots("1", "true"), true, "one refreshes on GitHub Actions");
  assert.throws(() => readRefreshScreenshots("1", undefined), /GitHub Actions/, "a developer machine cannot refresh");
  assert.throws(() => readRefreshScreenshots("true", "true"), /0 or 1/, "every other refresh value fails closed");
});
