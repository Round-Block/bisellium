/**
 * scripts/exact-digits.mjs — W-334: the lint rule `local/exact-digits`. A regex capture that can hold more than 15
 * digits (an unbounded `\d+`, `[0-9]*`, `{n,}`, or a bound above 15) is never read through `Number`, `parseInt`,
 * `parseFloat` or unary `+`: past `Number.MAX_SAFE_INTEGER` a double collapses adjacent values (W-317, W-330 round 1).
 * Bound the grammar to 15 digits, or compare the capture exactly (`BigInt`, or as a string).
 *
 * What it recognises (every other form is a limit, D-085 D):
 * - the read: `Number(x)`, `parseInt(x…)`, `parseFloat(x)`, `Number.parseInt(x…)`, `Number.parseFloat(x)` or unary `+x`,
 *   `x` seen through `!`, `?.`, `as` and the left side of `??`/`||`;
 * - the capture `x`: `m[k]`, `k` a number literal, or a name bound at index `k` of an array pattern (`const [, a] = m`);
 * - the match `m`: `<re>.exec(…)`, a non-global `….match(<re>)`, either side of a `?:` (a `null` side skipped), an
 *   element (`[i]`, `.at`, `.find`, `.findLast`) of a list of matches, a `for (const m of <list>)` name, the first
 *   parameter of a callback to `.map`, `.flatMap`, `.filter`, `.forEach`, `.some`, `.every`, `.find`, `.findLast`,
 *   `.sort` or `.toSorted` on a list, or a variable declared once whose every write is one of those;
 * - the list: `….matchAll(<re>)`, `[...<list>]`, `Array.from(<list>)`, `<list>.sort/.toSorted/.filter/.slice/.reverse/
 *   .toReversed(…)`, or a variable declared once whose every write is one of those;
 * - the regex `<re>`: a regex literal, `new RegExp(s, f)`/`RegExp(s, f)` whose `s` is a string or template literal,
 *   `String.raw`, a `+` of those or a constant holding one (any other piece, and each `${…}`, reads as empty), or a
 *   variable declared once with one write holding one of those.
 * The group's digits: each `\d`, digit-only class (`[0-9]`, `[1-9]`) or literal digit, times its quantifier, summed
 * over the group (alternatives added); more than 15, or an unbounded quantifier, is reported.
 */
export const SAFE_DIGITS = 15;

/** The source of capturing group `k` (1-based, named groups counted) of a regex pattern, or undefined. */
export function captureGroup(pattern, k) {
  const open = [];
  let n = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") i++;
    else if (c === "[") {
      for (i++; i < pattern.length && pattern[i] !== "]"; i++) if (pattern[i] === "\\") i++;
    } else if (c === "(") {
      const capturing =
        pattern[i + 1] !== "?" || (pattern[i + 2] === "<" && pattern[i + 3] !== "=" && pattern[i + 3] !== "!");
      open.push({ at: i, n: capturing ? ++n : 0 });
    } else if (c === ")") {
      const g = open.pop();
      if (g !== undefined && g.n === k) return pattern.slice(g.at + 1, i);
    }
  }
  return undefined;
}

/** A quantifier at `i`: its upper bound and its length, or undefined. */
function quantifier(src, i) {
  const c = src[i];
  const lazy = (len) => (src[i + len] === "?" ? len + 1 : len);
  if (c === "*" || c === "+") return { max: Infinity, len: lazy(1) };
  if (c === "?") return { max: 1, len: lazy(1) };
  // a bound of more than 15 digits is no quantifier here: its digits then count as literal digits, so it is flagged anyway
  const q = c === "{" ? /^\{([0-9]{1,15})(,([0-9]{0,15}))?\}/.exec(src.slice(i)) : null;
  if (q === null) return undefined;
  const max = q[2] === undefined ? Number(q[1]) : q[3] === "" ? Infinity : Number(q[3]);
  return { max, len: lazy(q[0].length) };
}

/** Whether a character class's body (between `[` and `]`) matches digits only. */
function digitClass(body) {
  return body !== "" && !body.startsWith("^") && /^(?:\\d|[0-9](?:-[0-9])?)+$/.test(body);
}

/**
 * The most digits a group's source can match: each digit atom (`\d`, a digit-only class, a literal digit) times its
 * quantifier, summed over the whole group (alternatives added, an over-count), Infinity when one is unbounded.
 */
export function maxDigits(src) {
  const stack = [0];
  const add = (v) => (stack[stack.length - 1] += v);
  for (let i = 0; i < src.length;) {
    let atom = 0;
    const c = src[i];
    if (c === "(") {
      stack.push(0);
      i +=
        src[i + 1] === "?"
          ? src[i + 2] === "<" && src[i + 3] !== "=" && src[i + 3] !== "!"
            ? src.indexOf(">", i) + 1 - i
            : 3
          : 1;
      continue;
    } else if (c === ")") {
      atom = stack.length > 1 ? stack.pop() : 0;
      i++;
    } else if (c === "\\") {
      atom = src[i + 1] === "d" ? 1 : 0;
      i += 2;
    } else if (c === "[") {
      let j = i + 1;
      for (; j < src.length && src[j] !== "]"; j++) if (src[j] === "\\") j++;
      atom = digitClass(src.slice(i + 1, j)) ? 1 : 0;
      i = j + 1;
    } else {
      atom = c >= "0" && c <= "9" ? 1 : 0;
      i++;
    }
    const q = quantifier(src, i);
    if (q !== undefined) i += q.len;
    add(atom === 0 ? 0 : q === undefined ? atom : atom * q.max);
  }
  return stack.reduce((a, b) => a + b, 0);
}

function strip(node) {
  for (;;) {
    if (node.type === "TSNonNullExpression" || node.type === "ChainExpression" || node.type === "TSAsExpression")
      node = node.expression;
    else if (node.type === "LogicalExpression" && (node.operator === "??" || node.operator === "||")) node = node.left;
    else return node;
  }
}

function variableOf(scope, name) {
  for (let s = scope; s !== null; s = s.upper) {
    const v = s.set.get(name);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Every value written to the variable `id` names, each with the for-of statement it is the iterable of, if any. */
function writesOf(id, scope, depth) {
  const v = variableOf(scope, id.name);
  // ponytail: a depth cap, not a visited set, stops a cycle (`a = b; b = a`): 16 hops is past any real chain
  if (v === undefined || depth > 16 || v.defs.length !== 1) return undefined;
  const loop = v.defs[0].node.parent?.parent;
  const forOf = loop?.type === "ForOfStatement" && loop.left === v.defs[0].node.parent ? loop : undefined;
  return {
    def: v.defs[0],
    writes: v.references
      .filter((r) => r.writeExpr != null)
      .map((r) => ({ expr: r.writeExpr, forOf: forOf !== undefined && r.writeExpr === forOf.right })),
  };
}

/** The text a string expression holds: literals, templates (each `${…}` read as empty), `String.raw`, `+` and constants; any other piece reads as empty. */
function stringOf(node, scope, depth) {
  node = strip(node);
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked ?? "").join("");
  if (
    node.type === "TaggedTemplateExpression" &&
    node.tag.type === "MemberExpression" &&
    node.tag.object.name === "String" &&
    node.tag.property.name === "raw"
  )
    return node.quasi.quasis.map((q) => q.value.raw).join("");
  if (node.type === "BinaryExpression" && node.operator === "+")
    return stringOf(node.left, scope, depth) + stringOf(node.right, scope, depth);
  if (node.type === "Identifier") {
    const w = writesOf(node, scope, depth + 1);
    return w?.writes.length === 1 && !w.writes[0].forOf ? stringOf(w.writes[0].expr, scope, depth) : "";
  }
  return "";
}

/** The regex an expression holds, `{ pattern, global }`, or undefined when it is not one the rule reads. */
function regexOf(node, scope, depth) {
  node = strip(node);
  if (node.type === "Literal" && node.regex !== undefined)
    return { pattern: node.regex.pattern, global: node.regex.flags.includes("g") };
  if (
    (node.type === "NewExpression" || node.type === "CallExpression") &&
    node.callee.type === "Identifier" &&
    node.callee.name === "RegExp" &&
    node.arguments[0] !== undefined
  ) {
    const flags = node.arguments[1] === undefined ? "" : stringOf(node.arguments[1], scope, depth);
    return { pattern: stringOf(node.arguments[0], scope, depth), global: flags.includes("g") };
  }
  if (node.type === "Identifier") {
    const w = writesOf(node, scope, depth + 1);
    return w?.writes.length === 1 && !w.writes[0].forOf ? regexOf(w.writes[0].expr, scope, depth) : undefined;
  }
  return undefined;
}

const NOTHING = (node) =>
  (node.type === "Literal" && node.value === null) || (node.type === "Identifier" && node.name === "undefined");
const method = (node, names) =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  names.includes(node.callee.property.name);

/** The patterns of every match an expression can hold (`re.exec`, a non-global `.match`, an element of a list of matches), or undefined. */
function matchOf(node, scope, depth) {
  node = strip(node);
  if (node.type === "ConditionalExpression") {
    const sides = [node.consequent, node.alternate]
      .filter((n) => !NOTHING(strip(n)))
      .map((n) => matchOf(n, scope, depth));
    return sides.some((p) => p === undefined) ? undefined : sides.flat();
  }
  if (method(node, ["exec"])) {
    const re = regexOf(node.callee.object, scope, depth);
    return re === undefined ? undefined : [re.pattern];
  }
  if (method(node, ["match"]) && node.arguments[0] !== undefined) {
    const re = regexOf(node.arguments[0], scope, depth);
    return re === undefined || re.global ? undefined : [re.pattern];
  }
  if (method(node, ["at", "find", "findLast"])) return matchesOf(node.callee.object, scope, depth);
  if (node.type === "MemberExpression" && node.computed) return matchesOf(node.object, scope, depth);
  if (node.type !== "Identifier") return undefined;
  const w = writesOf(node, scope, depth + 1);
  if (w === undefined) return undefined;
  if (w.def.type === "Parameter") {
    const fn = w.def.node;
    const call = fn.parent;
    if (
      fn.params[0] !== w.def.name ||
      call?.type !== "CallExpression" ||
      call.arguments[0] !== fn ||
      !method(call, CALLBACKS)
    )
      return undefined;
    return matchesOf(call.callee.object, scope, depth);
  }
  if (w.writes.length === 0) return undefined;
  const all = w.writes.map((x) => (x.forOf ? matchesOf(x.expr, scope, depth) : matchOf(x.expr, scope, depth)));
  return all.some((p) => p === undefined) ? undefined : all.flat();
}

const CALLBACKS = ["map", "flatMap", "filter", "forEach", "some", "every", "find", "findLast", "sort", "toSorted"];

/** The patterns of a list of matches (`.matchAll`, `[...…]`, `Array.from`, a sorted, filtered or sliced list of them), or undefined. */
function matchesOf(node, scope, depth) {
  node = strip(node);
  if (method(node, ["matchAll"]) && node.arguments[0] !== undefined) {
    const re = regexOf(node.arguments[0], scope, depth);
    return re === undefined ? undefined : [re.pattern];
  }
  if (node.type === "ArrayExpression" && node.elements.length === 1 && node.elements[0]?.type === "SpreadElement")
    return matchesOf(node.elements[0].argument, scope, depth);
  if (
    method(node, ["from"]) &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "Array" &&
    node.arguments[0] !== undefined
  )
    return matchesOf(node.arguments[0], scope, depth);
  if (method(node, ["sort", "toSorted", "filter", "slice", "reverse", "toReversed"]))
    return matchesOf(node.callee.object, scope, depth);
  if (node.type !== "Identifier") return undefined;
  const w = writesOf(node, scope, depth + 1);
  if (w === undefined || w.def.type === "Parameter" || w.writes.length === 0 || w.writes.some((x) => x.forOf))
    return undefined;
  const all = w.writes.map((x) => matchesOf(x.expr, scope, depth));
  return all.some((p) => p === undefined) ? undefined : all.flat();
}

/** A capture: `m[k]` (`k` a number literal) of a match, or a name bound at index `k` of an array pattern whose value is a match. */
function captureOf(node, scope) {
  if (
    node.type === "MemberExpression" &&
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "number"
  ) {
    const patterns = matchOf(node.object, scope, 0);
    return patterns === undefined ? undefined : { patterns, k: node.property.value };
  }
  if (node.type !== "Identifier") return undefined;
  const def = variableOf(scope, node.name)?.defs[0];
  const decl = def?.type === "Variable" ? def.node : undefined;
  if (decl?.id.type !== "ArrayPattern" || decl.init == null) return undefined;
  const k = decl.id.elements.findIndex((e) => e?.type === "Identifier" && e.name === node.name);
  const patterns = k < 1 ? undefined : matchOf(decl.init, scope, 0);
  return patterns === undefined ? undefined : { patterns, k };
}

const NUMERIC = new Set(["Number", "parseInt", "parseFloat"]);

/** The argument a numeric read converts: `Number(x)`, `parseInt(x…)`, `parseFloat(x)`, `Number.parseInt`/`Number.parseFloat`, `+x`. */
function converted(node) {
  if (node.type === "UnaryExpression" && node.operator === "+") return node.argument;
  if (node.type !== "CallExpression" || node.arguments[0] === undefined) return undefined;
  const c = node.callee;
  if (c.type === "Identifier" && NUMERIC.has(c.name)) return node.arguments[0];
  if (
    c.type === "MemberExpression" &&
    !c.computed &&
    c.object.type === "Identifier" &&
    c.object.name === "Number" &&
    (c.property.name === "parseInt" || c.property.name === "parseFloat")
  )
    return node.arguments[0];
  return undefined;
}

export const exactDigits = {
  meta: {
    type: "problem",
    docs: { description: "a regex capture of more than 15 digits is never read through a double (W-334)" },
    schema: [],
    messages: {
      lossy:
        "capture {{k}} of /{{pattern}}/ can hold {{digits}} digits, and a double is exact only to 15: bound the grammar to at most 15 digits or compare the capture exactly (BigInt, or as a string) (W-334)",
    },
  },
  create(context) {
    const check = (node) => {
      const arg = converted(node);
      const capture = arg === undefined ? undefined : captureOf(strip(arg), context.sourceCode.getScope(node));
      if (capture === undefined) return;
      for (const pattern of capture.patterns) {
        const group = captureGroup(pattern, capture.k);
        const digits = group === undefined ? 0 : maxDigits(group);
        if (digits > SAFE_DIGITS) {
          context.report({
            node,
            messageId: "lossy",
            data: { k: String(capture.k), pattern, digits: digits === Infinity ? "unboundedly many" : String(digits) },
          });
          return;
        }
      }
    };
    return { CallExpression: check, UnaryExpression: check };
  },
};

export default { rules: { "exact-digits": exactDigits } };
