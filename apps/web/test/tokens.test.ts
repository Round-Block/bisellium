/**
 * apps/web/test/tokens.test.ts — W-024 behaviour 1: tokens.css declares
 * all nine colour custom properties and all seven space properties on
 * `:root`, with exact values (DIRECTION.md §3).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(HERE, "..", "src", "tokens.css"), "utf8");

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

const colors: [string, string][] = [
  ["ink", "#16211E"],
  ["ink-2", "#4A5654"],
  ["ink-3", "#677270"],
  ["rule", "#DDE3E1"],
  ["wash", "#F4F7F6"],
  ["verdigris", "#0B6E5F"],
  ["amber", "#99651A"],
  ["ok", "#257F51"],
  ["bad", "#C14738"],
];

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
