/**
 * apps/web/test/tokens.test.ts — W-024 behaviour 1: tokens.css declares
 * all thirteen colour custom properties and all seven space properties on
 * `:root`, with exact values (DIRECTION.md §3).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(HERE, "..", "src", "tokens.css"), "utf8");
const direction = readFileSync(resolve(HERE, "..", "..", "..", "docs", "design", "DIRECTION.md"), "utf8");
const componentCss = readFileSync(resolve(HERE, "..", "src", "components", "w025.css"), "utf8");
const officinaSource = readFileSync(resolve(HERE, "..", "src", "screens", "Officina.tsx"), "utf8");

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${detail}`);
  if (!ok) failed++;
};

const rootMatch = /:root\s*{([^}]*)}/.exec(css);
const root = rootMatch?.[1] ?? "";

function hasVar(name: string, value: string): boolean {
  const re = new RegExp(`--${name}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*;`, "i");
  return re.test(root);
}

const d101Colors: [string, string][] = [
  ["ink", "#F8F8F2"],
  ["ink-2", "#C6C9D8"],
  ["ink-3", "#9EA4C4"],
  ["rule", "#44475A"],
  ["wash", "#343746"],
  ["verdigris", "#3FB9A3"],
  ["amber", "#FFB86C"],
  ["ok", "#50FA7B"],
  ["bad", "#FF5555"],
];

const d103AccentColors: [string, string][] = [
  ["accent-cyan", "#8BE9FD"],
  ["accent-pink", "#FF79C6"],
  ["accent-purple", "#BD93F9"],
  ["accent-yellow", "#F1FA8C"],
];

const colors: [string, string][] = [...d101Colors, ...d103AccentColors];

for (const [name, value] of colors) {
  check(`tokens.css --${name} is ${value}`, hasVar(name, value));
}

const spaces: [string, string][] = [
  ["sp-1", "4px"],
  ["sp-2", "8px"],
  ["sp-3", "12px"],
  ["sp-4", "16px"],
  ["sp-6", "24px"],
  ["sp-8", "32px"],
  ["sp-12", "48px"],
];

for (const [name, value] of spaces) {
  check(`tokens.css --${name} is ${value}`, hasVar(name, value));
}

function token(name: string): string {
  const value = new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{6})\\s*;`, "i").exec(root)?.[1];
  assert.ok(value, `tokens.css declares a six-digit --${name}`);
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

test("W-361-b1 behaviour 1: the fixed dark palette meets its computed text and component contrast floors", () => {
  const actual = Object.fromEntries(d101Colors.map(([name]) => [name, token(name).toUpperCase()]));
  assert.deepEqual(actual, Object.fromEntries(d101Colors), "tokens.css carries D-100 A as amended by D-101 A exactly");
  assert.match(root, /--surface\s*:\s*#282a36\s*;/i, "surface is Dracula background");
  assert.match(root, /--shadow-drawer\s*:\s*rgba\(0,\s*0,\s*0,\s*0\.45\)\s*;/i, "the drawer uses the darker alpha shadow");

  const backgrounds = ["surface", "wash"];
  const textTokens = ["ink", "ink-2", "ink-3", "verdigris", "amber", "ok"];
  const componentTokens = ["verdigris", "amber", "ok", "bad"];
  for (const background of backgrounds) {
    for (const foreground of textTokens) {
      const ratio = contrast(token(foreground), token(background));
      assert.ok(ratio >= 4.5, `computed ${foreground} on ${background} text contrast ${ratio.toFixed(4)} is at least 4.5:1`);
    }
    for (const foreground of componentTokens) {
      const ratio = contrast(token(foreground), token(background));
      assert.ok(ratio >= 3, `computed ${foreground} on ${background} component contrast ${ratio.toFixed(4)} is at least 3:1`);
    }
  }
  const amberOnRule = contrast(token("amber"), token("rule"));
  assert.ok(amberOnRule >= 4.5, `computed amber on rule text contrast ${amberOnRule.toFixed(4)} is at least 4.5:1 for selected and hovered Inbox counts`);
  const inkUnderlineOnRule = contrast(token("ink"), token("rule"));
  assert.ok(inkUnderlineOnRule >= 3, `computed ink on rule current-page underline contrast ${inkUnderlineOnRule.toFixed(4)} is at least 3:1`);

  assert.match(direction, /`ink #F8F8F2` · `ink-2 #C6C9D8` · `ink-3 #9EA4C4` · `rule #44475A` ·\n`wash #343746`\. Surfaces are `#282A36`;/, "DIRECTION section 3 names the dark neutral and surface values");
  assert.match(direction, /Verdigris `#3FB9A3`/, "DIRECTION section 3 names dark verdigris");
  assert.match(direction, /Amber `#FFB86C` \(Dracula Orange\)/, "DIRECTION section 3 names official Dracula orange");
  assert.match(direction, /ok `#50FA7B` \(Dracula Green\) \/ bad `#FF5555` \(Dracula Red\)/, "DIRECTION section 3 names the official Dracula gate colours");
  assert.match(direction, /Inbox count in amber on both the\s+selected and hovered `rule` navigation fills/, "DIRECTION section 3 excludes bad from text and includes the navigation count");
  assert.match(direction, /0 16px 48px rgba\(0,0,0,\.45\)/, "DIRECTION section 3 names the dark drawer shadow");
});

test("W-366-b1 behaviour 1: Dracula accents are exact and meet computed contrast floors", () => {
  const actual = Object.fromEntries(d103AccentColors.map(([name]) => [name, token(name).toUpperCase()]));
  assert.deepEqual(actual, Object.fromEntries(d103AccentColors), "tokens.css carries D-103 A's four accent colours exactly");

  for (const background of ["surface", "wash"]) {
    for (const [foreground] of d103AccentColors) {
      const ratio = contrast(token(foreground), token(background));
      assert.ok(ratio >= 4.5, `computed ${foreground} on ${background} text contrast ${ratio.toFixed(4)} is at least 4.5:1`);
    }
  }
  const selectedText = contrast(token("surface"), token("accent-pink"));
  assert.ok(selectedText >= 4.5, `computed surface on accent-pink selected text contrast ${selectedText.toFixed(4)} is at least 4.5:1`);

  assert.match(direction, /Cyan `#8BE9FD` \(`--accent-cyan`\)/, "DIRECTION section 3 names Dracula Cyan and its link token");
  assert.match(direction, /Pink `#FF79C6` \(`--accent-pink`\)/, "DIRECTION section 3 names Dracula Pink and its text-selection token");
  assert.match(direction, /Purple `#BD93F9` \(`--accent-purple`\)/, "DIRECTION section 3 names Dracula Purple and its heading token");
  assert.match(direction, /Yellow `#F1FA8C` \(`--accent-yellow`\)/, "DIRECTION section 3 names Dracula Yellow and its project-name token");
  assert.match(direction, /only status colours[^.]*ok[^.]*amber[^.]*bad[^.]*shape cues/i, "DIRECTION section 3 reserves status meaning and shape cues to ok, amber and bad");
  assert.match(direction, /accent never marks a state/i, "DIRECTION section 3 forbids accents from conveying state");
  assert.match(direction, /at\s+most\s+three\s+status\s+colours\s+visible\s+at\s+once/i, "DIRECTION section 3's three-colour ceiling names status colours only");
  assert.match(direction, /Verdigris remains the sole product identity colour\.\s+Yellow is a constant project-name text accent, identical for every project\s+and condition\. Projects remain named, never colour-coded; project dots and\s+colour hashing remain excluded\./, "DIRECTION section 3 keeps project identity with verdigris and makes yellow constant");
});

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declarations = new RegExp(`${escaped}\\s*{([^}]*)}`).exec(componentCss)?.[1];
  assert.ok(declarations, `${selector} exists in w025.css`);
  return declarations;
}

function badTokenConsumers(): { source: string; selector: string; declarations: string }[] {
  const src = resolve(HERE, "..", "src");
  const out: { source: string; selector: string; declarations: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".css") && entry.name !== "tokens.css") {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/([^{}]+){([^{}]*var\(--bad\)[^{}]*)}/g)) {
          out.push({ source: file.slice(src.length + 1), selector: match[1]!.trim(), declarations: match[2]!.trim() });
        }
      } else if (entry.name.endsWith(".tsx")) {
        const text = readFileSync(file, "utf8");
        if (text.includes("var(--bad)")) out.push({ source: file.slice(src.length + 1), selector: "<inline TSX>", declarations: text });
      }
    }
  };
  walk(src);
  return out;
}

test("W-361-b2 behaviour 2: bad remains a non-text gate mark while confirm and budget states keep readable cues", () => {
  const badConsumers = badTokenConsumers();
  assert.deepEqual(
    badConsumers.map(({ source, selector }) => `${source}: ${selector}`),
    ["components/w025.css: .gate-ladder__mark--bad-diagonal"],
    "only the diagonal failed-gate selector consumes --bad",
  );
  for (const { source, selector, declarations } of badConsumers) {
    assert.doesNotMatch(declarations, /(?:^|;)\s*color\s*:/i, `${source}: ${selector} never sets text colour from --bad`);
  }
  assert.match(cssRule(".gate-ladder__mark--bad-diagonal"), /background\s*:\s*var\(--bad\)/, "the failed gate keeps its bad fill");
  assert.match(cssRule(".gate-ladder__mark--bad-diagonal"), /clip-path\s*:/, "the failed gate keeps its diagonal shape cue");
  assert.match(cssRule(".seats__confirm-error"), /color\s*:\s*var\(--ink\)/, "confirmation error copy uses the highest-contrast text token");
  assert.match(cssRule(".board__card--bad"), /border-left-color\s*:\s*var\(--ink\)/, "a blocked card keeps its non-colour left-rule cue without consuming bad");
  assert.match(componentCss, /\.board-drawer__gate-evidence,\s*\.board-drawer__gate-evidence:visited\s*{[^}]*color\s*:\s*var\(--verdigris\)/, "drawer evidence links and their visited state use verdigris");
  assert.match(componentCss, /\.board-drawer__gate-evidence,\s*\.board-drawer__gate-evidence:visited\s*{[^}]*text-decoration\s*:\s*underline/, "drawer evidence links retain their underline");
  assert.match(cssRule(".sidebar__badge"), /color\s*:\s*var\(--amber\)/, "the Inbox badge uses amber");
  assert.match(cssRule(".sidebar__link:hover"), /background\s*:\s*var\(--rule\)/, "hovered navigation uses the rule fill");
  const activeLink = cssRule(".sidebar__link--active");
  assert.match(activeLink, /background\s*:\s*var\(--rule\)/, "active navigation uses the rule fill");
  assert.match(activeLink, /text-decoration-line\s*:\s*underline/, "the active page alone has the persistent ink underline");
  assert.match(activeLink, /text-decoration-color\s*:\s*var\(--ink\)/, "the active page underline uses ink");
  assert.doesNotMatch(cssRule(".sidebar__link:hover"), /text-decoration(?:-line|-color)?\s*:/, "hovering a non-current page does not add the active underline");

  const interactiveTextTokens = [
    [".sidebar__link", "ink"],
    [".sidebar__link--disabled", "ink-3"],
    [".token-prompt__input", "ink"],
    [".token-prompt__submit", "ink"],
    [".officina__row--link", "ink"],
    [".inbox__input-ratio", "ink"],
    [".inbox__input-ratio::placeholder", "ink-3"],
    [".inbox__btn-action", "ink"],
    [".seats__row select", "ink"],
    [".seats__row select option", "ink"],
    [".seats__confirm-btn,\n.seats__cancel-btn", "ink"],
    [".board__project-select", "ink-2"],
    [".board__project-select option", "ink-2"],
    [".board__strip-item", "ink"],
    [".board-drawer__close", "ink-2"],
    [".board-drawer__banner-link", "verdigris"],
    [".board-drawer__gate-evidence,\n.board-drawer__gate-evidence:visited", "verdigris"],
  ] as const;
  for (const [selector, textToken] of interactiveTextTokens) {
    assert.match(cssRule(selector), new RegExp(`color\\s*:\\s*var\\(--${textToken}\\)`), `${selector.replaceAll("\n", " ")} declares its dark-surface text token`);
  }
  assert.match(cssRule(".inbox__input-ratio::placeholder"), /opacity\s*:\s*1/, "the tokenized placeholder is not dimmed by a browser default");
  assert.match(cssRule(".seats__row select option"), /background\s*:\s*var\(--surface\)/, "seat options declare the dark surface");
  assert.match(cssRule(".board__project-select option"), /background\s*:\s*var\(--surface\)/, "Board project options declare the dark surface");

  assert.doesNotMatch(officinaSource, /var\(--bad\)/, "the Officina budget graphic never consumes bad");
  assert.match(officinaSource, /function pieColor\(spent: number, allowance: number\)[\s\S]*?return spent >= allowance \? "var\(--amber\)" : "var\(--ink\)";/, "budget burn is ink under allowance and amber at or over allowance");
  assert.match(officinaSource, /const color = pieColor\(spent, allowance\);/, "the budget graphic takes its colour from the allowance boundary");
  assert.match(officinaSource, /const \{ word, reason \} = formatPosture\(entry\);[\s\S]*?officina__posture-word">\{word}[\s\S]*?officina__posture-reason">\{reason}/, "the adjacent posture word and numeric burn/allowance reason are the non-colour budget cue");
});

const NAMED = new Set(
  (`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen`).split(" "),
);
const COLOR_FUNCTION = /(?<![\w-])(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk|light-dark)\s*\([^)]*\)/gi;
const HEX = /#[0-9a-f]{3,8}(?![0-9a-f])/gi;

function stripComments(text: string, lineComments: boolean): string {
  let clean = "";
  let quote: "\"" | "'" | "`" | undefined;
  let line = false;
  let block = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    if (line) {
      if (char === "\n") {
        line = false;
        clean += char;
      }
      continue;
    }
    if (block) {
      if (char === "*" && next === "/") {
        block = false;
        i++;
      } else if (char === "\n") clean += char;
      continue;
    }
    if (quote !== undefined) {
      clean += char;
      if (char === "\\" && next !== undefined) clean += text[++i]!;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      clean += char;
    } else if (lineComments && char === "/" && next === "/") {
      line = true;
      i++;
    } else if (char === "/" && next === "*") {
      block = true;
      i++;
    } else clean += char;
  }
  return clean;
}

function literals(text: string, lineComments: boolean): string[] {
  const clean = stripComments(text, lineComments);
  const found = [...clean.matchAll(HEX), ...clean.matchAll(COLOR_FUNCTION)].map((match) => match[0]);
  for (const word of clean.matchAll(/(?<![\w-])[a-z]+(?![\w-])/gi)) if (NAMED.has(word[0].toLowerCase())) found.push(word[0]);
  return found;
}

function inlineStyleLiterals(text: string): string[] {
  const out: string[] = [];
  for (const style of text.matchAll(/style\s*=\s*\{\{([\s\S]*?)\}\}/g)) out.push(...literals(style[1] ?? "", true));
  return out;
}

function sourceColourLiterals(): string[] {
  const src = resolve(HERE, "..", "src");
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".css") && entry.name !== "tokens.css") {
        for (const value of literals(readFileSync(file, "utf8"), false)) out.push(`${file.slice(src.length + 1)}: ${value}`);
      } else if (entry.name.endsWith(".tsx")) {
        for (const value of inlineStyleLiterals(readFileSync(file, "utf8"))) out.push(`${file.slice(src.length + 1)}: ${value}`);
      }
    }
  };
  walk(src);
  return out.sort();
}

test("W-339-b1 behaviour 1: web source outside tokens.css contains no hard-coded CSS colour or direct TSX inline colour", () => {
  const forms = literals("#abc #abcd #abcdef #abcdef12 rgb(1 2 3) rgba(1,2,3,.4) hsl(1 2% 3%) hsla(1,2%,3%,.4) hwb(1 2% 3%) lab(1 2 3) lch(1 2 3) oklab(1 2 3) oklch(1 2 3) color(display-p3 1 0 0) color-mix(in srgb, red, blue) device-cmyk(0 0 0 1) light-dark(white, black) rebeccapurple transparent", false);
  assert.equal(forms.length, 23, "hex, every CSS colour function family, named colours and transparent are recognised");
  assert.deepEqual(literals("var(--red) currentColor white-space: nowrap; /* red #fff rgb(0 0 0) */", false), [], "CSS block comments, tokens, currentColor and property names are not literals");
  assert.deepEqual(literals('.x{background:url("https://cdn/x");color:red}', false), ["red"], "a quoted https URL cannot hide a later colour");
  assert.deepEqual(literals(".x{background:url(https://cdn/x);color:red}", false), ["red"], "an unquoted https URL cannot hide a later colour");
  assert.deepEqual(inlineStyleLiterals('<div style={{ note: "https://cdn/x", color: "red", // blue\n backgroundColor: "white" }} />'), ["red", "white"], "direct TSX inline styles strip JavaScript line comments quote-aware");
  assert.deepEqual(sourceColourLiterals(), [], "move every reported literal to tokens.css");
});

process.exitCode = failed ? 1 : 0;
