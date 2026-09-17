/**
 * Acceptance for W-002 (context bundle and query) against
 * examples/sample-studio. `now` is pinned so age-derived text never drifts.
 */
import { resolve } from "node:path";
import { buildContext } from "./context.js";
import { answer } from "./query.js";

const repo = resolve(process.argv[2] ?? ".");
const root = resolve(repo, "examples/sample-studio");
const NOW = new Date("2026-09-17T13:00:00Z");
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(42)} ${detail}`);
  if (!ok) failed++;
};

// ---- buildContext -----------------------------------------------------------

{
  const c = buildContext(root, "builder-1", { now: NOW });
  check("builder-1: engineering charter present", c.text.includes("Engineering charter") && c.text.includes("Mandate"));
  check("builder-1: W-002 and W-004 handoffs present", c.text.includes("W-002") && c.text.includes("W-004"));
  check("builder-1: A-1 not included (addressed to owner)", !c.text.includes("A-1"));
}

{
  const c = buildContext(root, "owner", { now: NOW });
  check("owner: A-1 included (needs_you, to: owner)", c.text.includes("A-1"));
}

{
  const c = buildContext(root, "builder-1", { now: NOW, maxTokens: 300 });
  const lastLine = c.text.split("\n").pop() ?? "";
  check("maxTokens=300: sections dropped", c.truncated.length > 0);
  check("maxTokens=300: text ends with 'truncated:' line", lastLine.startsWith("truncated:"));
}

{
  const c = buildContext(root, "nobody", { now: NOW });
  check("unknown seat: empty text, truncated ['unknown seat']", c.text === "" && c.truncated[0] === "unknown seat");
}

// ---- answer -------------------------------------------------------------------

{
  const a = answer(root, "what is blocked on me", { now: NOW });
  check(
    "needs_you: mentions W-004 and A-1",
    a.kind === "needs_you" && !!a.answer && a.answer.includes("W-004") && a.answer.includes("A-1"),
  );
}

{
  const a = answer(root, "status W-003", { now: NOW });
  check(
    "status W-003: mentions verifying and failed",
    a.kind === "status" && !!a.answer && a.answer.includes("verifying") && a.answer.includes("failed"),
  );
}

{
  const a = answer(root, "burn", { now: NOW });
  check(
    "burn: mentions engineering and conserve",
    a.kind === "burn" && !!a.answer && a.answer.includes("engineering") && a.answer.includes("conserve"),
  );
}

{
  const a = answer(root, "hello", { now: NOW });
  check("hello: kind unknown", a.kind === "unknown" && a.answer === null && !!a.suggestions?.length);
}

process.exit(failed ? 1 : 0);
