/**
 * W-572 rows (studio/briefs/W-572.md): the guard routes the main thread's questions to the Patron through a leads' meet (D-189).
 * node:test TAP, selected by `--test-name-pattern='^W-572-b<n>\s'`. Row b1 feeds AskUserQuestion hook inputs to `runHookEvent`
 * with HOME set to a fixture home under the OS tmp dir that holds a fake `.bisellium-evidence/` (meet folders, collations, a
 * symlink, an empty file); b2 checks a fixture repo's settings and reads the real `.claude/settings.json`, `CLAUDE.md` and
 * `studio/leges/production.md`. Nothing reads or writes the real home.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { runHookEvent } from "./hooks.js";
import { checkStudio } from "./check.js";
import { PATRON_TAGS } from "./guard.js";
import { initStudio } from "./init.js";
import { RULE_IDS } from "./rules/ids.js";
import { bulletClauses } from "./rules/lex.js";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "w572-"));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The guard on one hook input, HOME set to `home`: its exit code and stderr. */
async function guard(input: unknown, home: string): Promise<{ code: number; err: string }> {
  const err: string[] = [];
  const error = console.error;
  const saved = process.env["HOME"];
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  process.env["HOME"] = home;
  try {
    const r = await runHookEvent(["guard", "--studio", "studio"], { stdin: Readable.from([JSON.stringify(input)]), stdinTimeoutMs: 1000 });
    return { code: r.exitCode, err: err.join("\n") };
  } finally {
    console.error = error;
    if (saved === undefined) delete process.env["HOME"];
    else process.env["HOME"] = saved;
  }
}
/** An AskUserQuestion input of the tool's shape: each text one question with two options. */
const ask = (texts: string[], extra: Record<string, unknown> = {}, home = "/nonexistent") => ({
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  tool_input: { questions: texts.map((question) => ({ question, header: "Call", multiSelect: false, options: [{ label: "Yes", description: "y" }, { label: "No", description: "n" }] })) },
  cwd: home,
  ...extra,
});
const raw = (tool_input: unknown, home: string) => ({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input, cwd: home });
const BUILDER = { agent_id: "b1", agent_type: "builder" };
const CLERK = { agent_id: "c1", agent_type: "clerk" };

/** A fixture home: `.bisellium-evidence/` holding a meet's collations, a non-meet folder's, a symlink, an empty file, a
 *  nested folder, and a meet collation outside the evidence root. */
function home(): { h: string; ok: string; okR2: string } {
  const h = tmp();
  const ev = join(h, ".bisellium-evidence");
  mkdirSync(join(ev, "w562-certify-meet-1110"), { recursive: true });
  writeFileSync(join(ev, "w562-certify-meet-1110", "collated.md"), "# collation\n");
  writeFileSync(join(ev, "w562-certify-meet-1110", "collated-r2.md"), "# collation r2\n");
  writeFileSync(join(ev, "w562-certify-meet-1110", "notes.md"), "# notes\n");
  writeFileSync(join(ev, "w562-certify-meet-1110", "empty-collated.md"), "x\n");
  writeFileSync(join(ev, "w562-certify-meet-1110", "collated-empty.md"), "");
  mkdirSync(join(ev, "w562-certify-meet-1110", "collated-dir.md"));
  symlinkSync(join(ev, "w562-certify-meet-1110", "collated.md"), join(ev, "w562-certify-meet-1110", "collated-link.md"));
  mkdirSync(join(ev, "W-572-spec"));
  writeFileSync(join(ev, "W-572-spec", "collated.md"), "# not a meet\n");
  mkdirSync(join(ev, "calls-meet-1107", "round-2"), { recursive: true });
  writeFileSync(join(ev, "calls-meet-1107", "round-2", "collated.md"), "# nested\n");
  mkdirSync(join(h, "elsewhere", "x-meet"), { recursive: true });
  writeFileSync(join(h, "elsewhere", "x-meet", "collated.md"), "# outside the evidence root\n");
  symlinkSync(join(h, "elsewhere", "x-meet"), join(ev, "linked-meet"));
  return { h, ok: join(ev, "w562-certify-meet-1110", "collated.md"), okR2: join(ev, "w562-certify-meet-1110", "collated-r2.md") };
}
const TAGS = ["ui", "architecture", "code-owner", "settings", "veto"];

test("W-572-b1 behaviour 1: the guard refuses a main-thread question that cites no leads' meet collation and opens with no Patron-only tag", async () => {
  const { h, ok } = home();
  const r = await guard(ask(["W-562's route: rebuild under a new id, or re-record red 3?"], {}, h), h);
  assert.equal(r.code, 2, "an untagged question with no collation is refused");
  assert.match(r.err, /^refused: the orchestrator asks the Patron only after a leads' meet \(D-189, W-572\): question 1 .+; each question cites a leads' meet collation .+: run the leads' meet first, and ask the Patron only a call that is theirs alone$/, "the refusal names the rule");
  for (const t of TAGS) assert.ok(r.err.includes(`[${t}]`), `the refusal names the tag [${t}]`);
  assert.match(r.err, /collated\*\.md/, "the refusal names the collation form");
  assert.equal((await guard(ask([`W-562's route (the meet: ${ok})?`], {}, h), h)).code, 0, "a question citing an existing collation by absolute path passes");
});

test("W-572-b1 behaviour 1: a cited collation that does not exist, or is a symlink, is refused", async () => {
  const { h } = home();
  const ev = join(h, ".bisellium-evidence");
  const missing = await guard(ask([`Route? See ${join(ev, "w562-certify-meet-1110", "collated-r9.md")}`], {}, h), h);
  assert.equal(missing.code, 2, "a missing collation is refused");
  assert.match(missing.err, /collated-r9\.md: no such file/, "the refusal names the missing path");
  const link = await guard(ask([`Route? See ${join(ev, "w562-certify-meet-1110", "collated-link.md")}`], {}, h), h);
  assert.equal(link.code, 2, "a symlinked collation is refused");
  assert.match(link.err, /collated-link\.md: a symlink/, "the refusal names the symlink");
});

test("W-572-b1 behaviour 1: a question opening with a Patron-only tag passes; an unknown tag is refused", async () => {
  const { h, ok } = home();
  for (const t of TAGS) assert.equal((await guard(ask([`[${t}] Approve the four screens?`], {}, h), h)).code, 0, `[${t}] passes`);
  const unknown = await guard(ask(["[urgent] Approve the route?"], {}, h), h);
  assert.equal(unknown.code, 2, "an unknown tag is refused");
  assert.match(unknown.err, /unknown tag \[urgent\]/, "the refusal names the unknown tag");
  assert.equal((await guard(ask(["[UI] Approve the screens?"], {}, h), h)).code, 2, "a tag is lower case exactly: [UI] is unknown");
  assert.equal((await guard(ask([" [ui] Approve the screens?"], {}, h), h)).code, 2, "a tag opens the text: a leading blank is no tag");
  assert.equal((await guard(ask(["Approve the screens? [ui]"], {}, h), h)).code, 2, "a tag later in the text is no tag");
  assert.equal((await guard(ask(["ui: Approve the screens?"], {}, h), h)).code, 2, "the `ui:` form is no tag");
  assert.equal((await guard(ask([`[urgent] Route? ${ok}`], {}, h), h)).code, 0, "an unknown tag with a cited collation passes on the citation");
});

test("W-572-b1 behaviour 1: a subagent's question is not judged", async () => {
  const { h } = home();
  assert.equal((await guard(ask(["Route?"], BUILDER, h), h)).code, 0, "a builder's question passes");
  assert.equal((await guard(ask(["Route?"], CLERK, h), h)).code, 0, "a clerk's question passes");
  assert.equal((await guard(raw({}, h), h)).code, 2, "the main thread's malformed input is judged");
  assert.equal((await guard({ ...raw({}, h), ...BUILDER }, h)).code, 0, "a subagent's malformed input is not judged");
  assert.equal((await guard(ask(["Route?"], { agent_id: "" }, h), h)).code, 2, "an empty agent_id is the main thread");
});

test("W-572-b1 behaviour 1: every question in the call must pass", async () => {
  const { h, ok } = home();
  const mixed = await guard(ask(["[ui] Approve the screens?", "W-562's route?"], {}, h), h);
  assert.equal(mixed.code, 2, "one passing and one failing question: refused");
  assert.match(mixed.err, /question 2 /, "the refusal names the failing question");
  assert.equal((await guard(ask(["W-562's route?", `[veto] Veto? ${ok}`], {}, h), h)).code, 2, "the first failing: refused");
  assert.equal((await guard(ask(["[ui] Approve the screens?", `Route? ${ok}`, "[veto] Keep the default?", "[settings] Allow it?"], {}, h), h)).code, 0, "four passing questions: allowed");
});

test("W-572-b1 behaviour 1: a cited path must be a readable, non-empty regular file directly in a meet folder under ~/.bisellium-evidence named collated*.md", async () => {
  const { h, ok, okR2 } = home();
  const ev = join(h, ".bisellium-evidence");
  const refused = async (what: string, text: string, why: RegExp): Promise<void> => {
    const r = await guard(ask([text], {}, h), h);
    assert.equal(r.code, 2, what);
    assert.match(r.err, why, `${what}: the reason`);
  };
  await refused("a meet collation outside the evidence root", `Route? ${join(h, "elsewhere", "x-meet", "collated.md")}`, /not directly in a folder under ~\/\.bisellium-evidence\//);
  await refused("a folder whose name holds no meet", `Route? ${join(ev, "W-572-spec", "collated.md")}`, /is not a leads' meet/);
  await refused("a folder nested in a meet folder", `Route? ${join(ev, "calls-meet-1107", "round-2", "collated.md")}`, /not directly in a folder/);
  await refused("a file not named collated*.md", `Route? ${join(ev, "w562-certify-meet-1110", "notes.md")}`, /not a collated\*\.md/);
  await refused("a name with collated not at its start", `Route? ${join(ev, "w562-certify-meet-1110", "empty-collated.md")}`, /not a collated\*\.md/);
  await refused("an empty collation", `Route? ${join(ev, "w562-certify-meet-1110", "collated-empty.md")}`, /: empty/);
  await refused("a folder named collated*.md", `Route? ${join(ev, "w562-certify-meet-1110", "collated-dir.md")}`, /not a regular file/);
  await refused("a .. path out of the evidence root", `Route? ${join(ev, "w562-certify-meet-1110", "..", "..", "elsewhere", "x-meet", "collated.md")}`, /not directly in a folder/);
  await refused("a folder symlinked to a meet folder outside the root", `Route? ${join(ev, "linked-meet", "collated.md")}`, /not directly in a folder/);
  await refused("a relative path", "Route? .bisellium-evidence/w562-certify-meet-1110/collated.md", /cites no path/);
  await refused("a path only in an option's description", "Route?", /cites no path/);
  const inOption = ask(["Route?"], {}, h);
  (inOption.tool_input.questions[0]!.options[0]! as { description: string }).description = ok;
  assert.equal((await guard(inOption, h)).code, 2, "a collation named only in an option is no citation");
  const pass = async (what: string, text: string): Promise<void> => assert.equal((await guard(ask([text], {}, h), h)).code, 0, what);
  await pass("a ~/ path", "Route? (the meet: ~/.bisellium-evidence/w562-certify-meet-1110/collated.md)");
  await pass("a collated-r2.md", `Route? ${okR2}.`);
  await pass("a path in backticks", `Route? \`${ok}\``);
  await pass("one valid path among others", `Route? ${join(ev, "W-572-spec", "collated.md")} and ${ok}`);
  await pass("a .. path that lands in a meet folder", `Route? ${join(ev, "W-572-spec", "..", "w562-certify-meet-1110", "collated.md")}`);
});

test("W-572-b1 behaviour 1: a malformed AskUserQuestion input is refused (fail-closed)", async () => {
  const { h } = home();
  const bad: [string, unknown][] = [
    ["no questions", {}],
    ["questions not a list", { questions: "Route?" }],
    ["an empty list", { questions: [] }],
    ["a question not an object", { questions: ["Route?"] }],
    ["a question with no text", { questions: [{ header: "Call", options: [] }] }],
    ["a question text not a string", { questions: [{ question: 7 }] }],
    ["an empty question text", { questions: [{ question: "" }] }],
    ["tool_input not an object", "Route?"],
  ];
  for (const [what, input] of bad) {
    const r = await guard(raw(input, h), h);
    assert.equal(r.code, 2, what);
    assert.match(r.err, /^refused: the orchestrator asks the Patron only after a leads' meet \(D-189, W-572\): .+: run the leads' meet first, and ask the Patron only a call that is theirs alone$/, `${what}: the rule`);
  }
  assert.equal((await guard(ask(["[ui] Approve?"], {}, h), join(h, "no-such-home"))).code, 0, "a tagged question passes with no evidence root");
  assert.equal((await guard(ask([`Route? ${join(h, ".bisellium-evidence", "w562-certify-meet-1110", "collated.md")}`], {}, h), join(h, "no-such-home"))).code, 2, "with no evidence root nothing is a collation");
});

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** A studio and a repo whose .claude/settings.json is `settings`; the hook.guard findings. */
function hookGuard(settings: string): { message: string; level: string }[] {
  const t = tmp();
  const studio = join(t, "studio");
  const now = new Date("2026-11-10T12:00:00Z");
  assert.ok(initStudio(studio, { now }).root);
  mkdirSync(join(t, ".claude"));
  writeFileSync(join(t, ".claude", "settings.json"), settings);
  return checkStudio(studio, now, { repo: t }).findings.filter((f) => f.rule === "hook.guard");
}

test("W-572-b2 behaviour 2: AskUserQuestion reaches the guard: check blocks hook.guard without it, the repo wires it, and CLAUDE.md and the lex name the rule", () => {
  const text = readFileSync(join(REPO, ".claude", "settings.json"), "utf8");
  const settings = JSON.parse(text) as { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[]> };
  const narrowed = structuredClone(settings);
  narrowed.hooks["PreToolUse"]![0]!.matcher = "Bash|Write|Edit|NotebookEdit";
  const f = hookGuard(JSON.stringify(narrowed));
  assert.equal(f.length, 1, "a PreToolUse matcher without AskUserQuestion: one block");
  assert.match(f[0]?.message ?? "", /the guard is not wired: PreToolUse AskUserQuestion -> bisellium hook-event guard --studio studio \(type command, timeout 2\)/, "the block names AskUserQuestion");
  assert.deepEqual(hookGuard(text), [], "the repo's own settings wire the guard for AskUserQuestion");
  assert.ok((settings.hooks["PreToolUse"]?.[0]?.matcher ?? "").split("|").includes("AskUserQuestion"), "the repo's PreToolUse matcher names AskUserQuestion");
  const claude = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
  assert.match(claude, /a main-thread AskUserQuestion whose questions neither cite a leads' meet collation nor open with a Patron-only tag/, "CLAUDE.md names the refusal");
  const lex = readFileSync(join(REPO, "studio", "leges", "production.md"), "utf8");
  const line = bulletClauses(lex).find((c) => c.startsWith("- **A call rests on the leads' meet (D-189).**"));
  assert.ok(line, "the lex holds the D-189 line");
  assert.match(line, /AskUserQuestion/, "the D-189 line names the guard's question rule");
  for (const t of PATRON_TAGS) assert.ok(line.includes(`\`[${t}]\``), `the D-189 line names the tag [${t}]`);
  const marker = /\(check: ([^)]+)\)$/.exec(line)?.[1];
  assert.equal(marker, "hook.guard", "the D-189 line ends with the hook.guard marker");
  assert.ok(RULE_IDS.has(marker), "the marker names a check rule");
});
