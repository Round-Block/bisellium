#!/usr/bin/env node
/**
 * Re-runnable UI-evidence capture for W-366.  It deliberately reuses the
 * served-test harness: a real `bisellium serve` process is given a temporary
 * copy of examples/sample-studio, never the worktree's studio/.
 *
 * Run from any directory:
 *   node --import /home/edckt/agents/bisellium/.worktrees/W-366/node_modules/tsx/dist/loader.mjs capture.mjs
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "/home/edckt/agents/bisellium/.worktrees/W-366";
const OUT = dirname(fileURLToPath(import.meta.url));
const NOW = "2026-09-25T09:35:43.947Z";
const VIEWPORTS = [1280, 390];
const require = createRequire(join(REPO, "package.json"));
const { chromium } = require("playwright");
const { startServed } = await import(`${REPO}/apps/web/tests-serve/harness.ts`);

const output = [];
function log(message) {
  output.push(message);
  console.log(message);
}
function writeRun(code) {
  const text = [...output, `exit ${code}`].join("\n") + "\n";
  writeFileSync(join(OUT, "capture.out"), text);
}
function token(name) {
  const css = readFileSync(join(REPO, "apps/web/src/tokens.css"), "utf8");
  const match = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})\\s*;`, "i"));
  if (!match) throw new Error(`could not read ${name} from tokens.css`);
  return match[1].toLowerCase();
}
function rgb(hex) {
  const value = hex.slice(1);
  return `rgb(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)})`;
}
function resultLine(name, property, computed, tokenName, tokenValue) {
  const expected = rgb(tokenValue);
  return `${name}: ${property}=${computed}; ${tokenName}=${tokenValue} (${expected}); ${computed === expected ? "match" : "mismatch"}`;
}
async function signIn(page, served) {
  await page.goto(`${served.baseURL}/#/board`);
  if (await page.locator(".token-prompt").isVisible()) {
    await page.locator("#token-prompt-input").fill(served.token);
    await page.locator(".token-prompt__submit").click();
  }
  await page.locator(".token-prompt").waitFor({ state: "hidden" });
  await page.locator('.board__card[data-card-id="W-004"]').last().waitFor({ state: "visible" });
}
async function openW004Drawer(page) {
  await page.locator('.board__card[data-card-id="W-004"]').last().click();
  await page.locator(".board-drawer").waitFor({ state: "visible" });
  await page.locator(".board-drawer__banner-link").waitFor({ state: "visible" });
  await page.locator(".board-drawer__gate-evidence").first().waitFor({ state: "visible" });
  await page.locator(".board-drawer").evaluate((el) => { el.scrollTop = 0; });
}
async function focusCloseByTab(page) {
  await page.locator('.board__card[data-card-id="W-004"]').last().focus();
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await page.keyboard.press("Tab");
    const isClose = await page.locator(".board-drawer__close").evaluate((el) => document.activeElement === el);
    if (isClose) return;
  }
  throw new Error("Tab never reached the Board drawer close control");
}
async function selectBoardTitle(page) {
  await page.locator(".board-drawer").evaluate((el) => { el.scrollTop = 0; });
  await page.locator(".board-drawer__title").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const selected = await page.evaluate(() => getSelection()?.toString());
  if (!selected) throw new Error("drawer title selection was not retained");
}
function pngInfo(name, description) {
  const path = join(OUT, name);
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 1, 4) !== "PNG") throw new Error(`${name} is not a PNG`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return `${name} ${width}x${height} ${statSync(path).size} sha256:${createHash("sha256").update(bytes).digest("hex")} ${description}`;
}

async function main() {
  for (const width of VIEWPORTS) {
    for (const kind of ["board-drawer", "focus", "selection"]) rmSync(join(OUT, `${kind}-${width}.png`), { force: true });
  }
  const cyan = token("--accent-cyan");
  const pink = token("--accent-pink");
  const verdigris = token("--verdigris");
  const computed = [];
  let served;
  let browser;
  try {
    served = await startServed("w366-ui-evidence", { now: NOW });
    log(`served ${served.baseURL} using temporary sample-studio fixture`);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: "en-GB", timezoneId: "UTC", deviceScaleFactor: 1 });
    const page = await context.newPage();

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, served);
      await openW004Drawer(page);

      const linkColor = await page.locator(".board-drawer__gate-evidence").first().evaluate((el) => getComputedStyle(el).color);
      if (linkColor !== rgb(cyan)) throw new Error(`drawer evidence-link color is ${linkColor}, expected ${rgb(cyan)}`);
      await page.screenshot({ path: join(OUT, `board-drawer-${width}.png`), fullPage: false });
      computed.push(resultLine(`board-drawer-${width}.png`, "link color", linkColor, "--accent-cyan", cyan));
      log(`captured board-drawer-${width}.png`);

      await focusCloseByTab(page);
      const focus = await page.locator(".board-drawer__close").evaluate((el) => {
        const style = getComputedStyle(el);
        return { outline: style.outline, outlineColor: style.outlineColor };
      });
      if (focus.outlineColor !== rgb(verdigris)) throw new Error(`close outline color is ${focus.outlineColor}, expected ${rgb(verdigris)}`);
      await page.screenshot({ path: join(OUT, `focus-${width}.png`), fullPage: false });
      computed.push(resultLine(`focus-${width}.png`, `outline ${focus.outline}`, focus.outlineColor, "--verdigris", verdigris));
      log(`captured focus-${width}.png`);

      await selectBoardTitle(page);
      const selectionColor = await page.locator(".board-drawer__title").evaluate((el) => getComputedStyle(el, "::selection").backgroundColor);
      if (selectionColor !== rgb(pink)) throw new Error(`selection background is ${selectionColor}, expected ${rgb(pink)}`);
      await page.screenshot({ path: join(OUT, `selection-${width}.png`), fullPage: false });
      computed.push(resultLine(`selection-${width}.png`, "::selection background", selectionColor, "--accent-pink", pink));
      log(`captured selection-${width}.png`);

      // Route away before the next viewport: changing a hash to its current
      // value does not remount Board, and would leave this drawer over it.
      await page.goto(`${served.baseURL}/#/inbox`);
    }
    await context.close();
  } finally {
    await browser?.close();
    await served?.close();
  }
  writeFileSync(join(OUT, "computed.txt"), `${computed.join("\n")}\n`);
  const manifest = [
    ...VIEWPORTS.flatMap((width) => [
      pngInfo(`board-drawer-${width}.png`, "W-004 drawer: Waiting on you content, cyan Inbox link, and cyan gate-evidence links."),
      pngInfo(`focus-${width}.png`, "Board drawer close control reached by Tab with a visible verdigris keyboard-focus outline."),
      pngInfo(`selection-${width}.png`, "Board drawer title selected with the browser's pink text-selection fill."),
    ]),
  ];
  writeFileSync(join(OUT, "manifest.txt"), `${manifest.join("\n")}\n`);
  log("wrote computed.txt and manifest.txt");
}

main().then(
  () => writeRun(0),
  (error) => {
    log(error instanceof Error ? `${error.stack ?? error.message}` : String(error));
    writeRun(1);
    process.exitCode = 1;
  },
);
