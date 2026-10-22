/**
 * packages/cli/src/guard.ts — W-310 (with W-290): the guard `bisellium hook-event guard` runs for
 * Claude Code's PreToolUse (Bash, Write, Edit, NotebookEdit) and SubagentStop hooks. Deny-only and
 * fail-open: it returns a refusal or nothing, never an allow, and hooks.ts lets the call run on any
 * error, unknown event or unreadable input. The main thread is a hook input without `agent_id`
 * (Claude Code sets it only inside a subagent, D-073 B).
 *
 * The Bash classifiers are lexical and recognise only the forms listed at `simpleCommands`,
 * `strip`, `cliArgv` and `scriptOf`; a script a command runs is read and judged by its text. What
 * is left unjudged is deliberate evasion (D-045): eval, an alias, a function, a command or script
 * path built from a variable, a command substitution inside double quotes: a limit.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Splits a command line into simple commands, each a list of words. Recognised: single quotes,
 *  double quotes (a backslash escapes the next character, nothing expands), a backslash outside
 *  quotes, a `#` comment opening a word, and the breaks `;` `&` `|` newline `(` `)` backtick and
 *  `$(` outside quotes. */
export function simpleCommands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  const endWord = (): void => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "#" && !inWord) {
      const j = line.indexOf("\n", i);
      i = (j < 0 ? line.length : j) - 1;
    } else if (c === "'") {
      const j = line.indexOf("'", i + 1);
      const end = j < 0 ? line.length : j;
      word += line.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < line.length && line[i] !== '"'; i++) {
        if (line[i] === "\\" && i + 1 < line.length) i++;
        word += line[i];
      }
    } else if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (c === "$" && line[i + 1] === "(") {
      endCommand();
      i++;
    } else if (";&|\n()`".includes(c)) endCommand();
    else if (c === " " || c === "\t") endWord();
    else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return out;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KEYWORDS = new Set(["!", "{", "}", "if", "then", "elif", "else", "do", "time"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const DURATION = /^(?:\d+(?:\.\d*)?|\.\d+)[smhd]?$/;
const base = (w: string | undefined): string => (w ?? "").slice((w ?? "").lastIndexOf("/") + 1);

/** Wrappers whose flags `strip` skips; `OPERAND` names the flags that take a separate operand. */
const WRAPPERS = new Set(["env", "command", "exec", "nice", "xargs", "timeout"]);
const OPERAND: Record<string, Set<string>> = {
  env: new Set(["-u", "-C", "-S", "--unset", "--chdir", "--split-string"]),
  exec: new Set(["-a"]),
  nice: new Set(["-n", "--adjustment"]),
  xargs: new Set(["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a"]),
  timeout: new Set(["-k", "-s", "--kill-after", "--signal"]),
};

/** Drops the prefix words before a command: assignments, the keywords in `KEYWORDS`, and the
 *  `WRAPPERS` with their flags (an `OPERAND` flag with its value; `env` also its assignments),
 *  `timeout` then its duration. `timed` is true when a `timeout` with a duration above zero was
 *  dropped. */
function strip(words: string[]): { words: string[]; timed: boolean } {
  let i = 0;
  let timed = false;
  for (;;) {
    const w = words[i];
    if (w === undefined) break;
    const b = base(w);
    if (ASSIGNMENT.test(w) || KEYWORDS.has(w)) i++;
    else if (WRAPPERS.has(b)) {
      for (i++; words[i]?.startsWith("-") || (b === "env" && ASSIGNMENT.test(words[i] ?? "")); ) i += OPERAND[b]?.has(words[i]!) ? 2 : 1;
      if (b !== "timeout") continue;
      const d = words[i] ?? "";
      if (DURATION.test(d) && Number.parseFloat(d) > 0) timed = true;
      i++;
    } else break;
  }
  return { words: words.slice(i), timed };
}

const NPX_OPERAND = new Set(["-p", "--package"]);
const SHELL_OPERAND = new Set(["-o", "+o", "-O", "+O"]);
const SHELL_INLINE = /^-[a-z]*c[a-z]*$/;
const NPX_INLINE = /^(?:-c|--call)$/;

/** A launcher's leading option words (`valued` ones take the next word), up to its first operand: the
 *  index of that operand (after a `--`), and the inline script when an option word matching `inline`
 *  holds one. A `-c` after the operand is the operand's own argument, never an option; one helper for
 *  every launcher, so no caller reads it the other way. */
function leading(w: string[], valued: Set<string>, inline?: RegExp): { operand: number; script?: string } {
  let j = 1;
  for (; w[j] !== undefined && w[j] !== "--" && /^[-+]/.test(w[j]!); j += valued.has(w[j]!) ? 2 : 1) if (inline?.test(w[j]!)) return { operand: j + 2, script: w[j + 1] };
  return { operand: w[j] === "--" ? j + 1 : j };
}

/** The CLI's own argv when the words run it, in one of the recognised forms: `bisellium …` (any
 *  path), `npx [flags] bisellium …` (`-p`/`--package` with their value), `npm … run|run-script [flags]
 *  bisellium [--] …`, and `node|tsx … <…/bisellium.mjs | …cli/src/main.ts> …`. */
function cliArgv(w: string[]): string[] | undefined {
  const b = base(w[0]);
  if (b === "bisellium") return w.slice(1);
  if (b === "npx") {
    const { operand } = leading(w, NPX_OPERAND);
    return base(w[operand]) === "bisellium" ? w.slice(operand + 1) : undefined;
  }
  if (b === "npm") {
    let j = w.findIndex((x) => x === "run" || x === "run-script") + 1;
    if (j === 0) return undefined;
    while (w[j]?.startsWith("-")) j++;
    if (w[j] !== "bisellium") return undefined;
    const rest = w.slice(j + 1);
    return rest[0] === "--" ? rest.slice(1) : rest;
  }
  if (b === "node" || b === "tsx") {
    const j = w.findIndex((x) => base(x) === "bisellium.mjs" || x.endsWith("cli/src/main.ts"));
    return j > 0 ? w.slice(j + 1) : undefined;
  }
  return undefined;
}

/** The inline script of `bash|sh|zsh|dash [flags] -c <script>` (a single-dash flag word holding `c`)
 *  or `npx [flags] -c|--call <script>`, among the launcher's leading options only. */
function shellScript(w: string[]): string | undefined {
  const b = base(w[0]);
  return b === "npx" ? leading(w, NPX_OPERAND, NPX_INLINE).script : SHELLS.has(b) ? leading(w, SHELL_OPERAND, SHELL_INLINE).script : undefined;
}

/** The script file the words run: `bash|sh|zsh|dash [flags] <file>` (`-o`/`+o` with their value),
 *  `source <file>`, `. <file>`, or a command word holding `/` (`./x.sh`, `scripts/x.sh`). */
function scriptOf(w: string[]): string | undefined {
  const b = base(w[0]);
  if (SHELLS.has(b)) {
    return w[leading(w, new Set(["-o", "+o"])).operand];
  }
  if (b === "source" || w[0] === ".") return w[1];
  return w[0]?.includes("/") ? w[0] : undefined;
}

export interface ShellContext {
  cwd: string;
  home: string;
}

/** A word as a path: `~` and `$HOME`/`${HOME}` expanded, resolved against `cwd`; undefined when
 *  another `$` remains (a path built from a variable is not judged). */
function wordPath(word: string, ctx: ShellContext): string | undefined {
  const p = word === "~" || word.startsWith("~/") ? ctx.home + word.slice(1) : /^\$(?:HOME|\{HOME\})(?:\/|$)/.test(word) ? ctx.home + word.slice(word.startsWith("${") ? 7 : 5) : word;
  return p.includes("$") ? undefined : resolve(ctx.cwd, p);
}

/** Bytes of a script the guard reads at most; a larger, unreadable or binary file is not judged. */
const SCRIPT_MAX = 256 * 1024;
function scriptText(path: string): string | undefined {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > SCRIPT_MAX) return undefined;
    const text = readFileSync(path, "utf8");
    return text.includes("\0") ? undefined : text;
  } catch {
    return undefined;
  }
}

/** The verbs that are hand ladder record writes whatever their flags (`review` records a build review). */
const LADDER = new Set(["branch", "ready", "done", "merge", "review"]);
/** The rungs `next --perform --expect <step>` performs that are hand ladder record writes (the
 *  review rung records a build `verdict` and a `review`). */
const PERFORM_LADDER = new Set(["branch", "ready", "done", "merge", "spec", "review"]);

/** The hand ladder record write a CLI argv makes, or undefined: the verbs in `LADDER`; `verdict`
 *  with `--phase spec` or `build`, or with no `--phase` (the verb's default is build), so only a
 *  handoff verdict runs; `next --perform --chain` (its review rung records a verdict and a review);
 *  and `next --perform` with `--expect` in `PERFORM_LADDER` or with no `--expect` (its rung is not
 *  named). */
function ladderStep(argv: string[]): string | undefined {
  // the last value given counts, as in the CLI's parseFlags
  const value = (name: string): string | undefined => {
    let found: string | undefined;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!;
      if (a === name) found = argv[i + 1] ?? "";
      else if (a.startsWith(`${name}=`)) found = a.slice(name.length + 1);
    }
    return found;
  };
  const [verb] = argv;
  if (verb !== undefined && LADDER.has(verb)) return verb;
  if (verb === "verdict") {
    const phase = value("--phase") ?? "build";
    return phase === "spec" || phase === "build" ? `verdict --phase ${phase}` : undefined;
  }
  if (verb !== "next" || !argv.includes("--perform")) return undefined;
  if (argv.includes("--chain")) return "next --perform --chain";
  const step = value("--expect");
  if (step === undefined) return "next --perform without --expect";
  return PERFORM_LADDER.has(step) ? `next --perform --expect ${step}` : undefined;
}

/** The hand ladder record write a command runs, or undefined: in each simple command, through
 *  `-c` scripts and the script files it runs (read by `scriptText`, resolved against `cwd` as `cd`
 *  moves it), three deep. */
export function ladderWrite(command: string, ctx: ShellContext, depth = 0): string | undefined {
  let cwd = ctx.cwd;
  for (const words of simpleCommands(command)) {
    const { words: w } = strip(words);
    const here = { ...ctx, cwd };
    if (w[0] === "cd") {
      // a target the guard cannot confirm is a directory leaves the root: a failed cd leaves the shell in place
      const target = w[1] === undefined ? ctx.home : wordPath(w[1], here);
      if (target !== undefined && statSync(target, { throwIfNoEntry: false })?.isDirectory()) cwd = target;
      continue;
    }
    const inner = shellScript(w);
    if (inner !== undefined) {
      const found = depth < 3 ? ladderWrite(inner, here, depth + 1) : undefined;
      if (found) return found;
      continue;
    }
    const argv = cliArgv(w);
    if (argv) {
      const step = ladderStep(argv);
      if (step) return step;
      continue;
    }
    const file = depth < 3 ? scriptOf(w) : undefined;
    const path = file === undefined ? undefined : wordPath(file, here);
    const text = path === undefined ? undefined : scriptText(path);
    const found = text === undefined ? undefined : ladderWrite(text, here, depth + 1);
    if (found) return `${found} (in ${file})`;
  }
  return undefined;
}

/** True when a simple command starts a `while` or `until` loop outside any `timeout` with a
 *  duration above zero, searched through `-c` scripts three deep (a `timeout` before the shell
 *  bounds its script). `~/.bisellium-evidence/wait-until.sh` runs its loop inside the script, so its
 *  command line holds no loop. */
export function unboundedLoop(command: string, bounded = false, depth = 0): boolean {
  for (const words of simpleCommands(command)) {
    const { words: w, timed } = strip(words);
    const inBound = bounded || timed;
    if ((w[0] === "while" || w[0] === "until") && !inBound) return true;
    const inner = shellScript(w);
    if (inner !== undefined && depth < 3 && unboundedLoop(inner, inBound, depth + 1)) return true;
  }
  return false;
}

/** The path with its longest existing prefix resolved through symlinks. */
function realOf(path: string): string {
  const tail: string[] = [];
  for (let head = path; ; ) {
    try {
      return join(realpathSync(head), ...[...tail].reverse());
    } catch {
      const parent = dirname(head);
      if (parent === head) return path;
      tail.push(basename(head));
      head = parent;
    }
  }
}

/** The nearest ancestor directory holding `.git/HEAD` (a checkout) or a `.git` file (a linked worktree). */
function checkoutOf(path: string): string | undefined {
  for (let d = dirname(path); ; d = dirname(d)) {
    if (existsSync(join(d, ".git", "HEAD")) || statSync(join(d, ".git"), { throwIfNoEntry: false })?.isFile()) return d;
    if (dirname(d) === d) return undefined;
  }
}

/** W-290: in a git checkout, `studio/decisions/**` and `docs/SESSION-HANDOFF.md` are written only
 *  by a dispatched clerk; the main thread writes nothing outside `studio/` and `docs/`. A path
 *  outside every checkout is not judged. */
export function writeRefusal(filePath: string, cwd: string | undefined, main: boolean, clerk: boolean): string | undefined {
  const real = realOf(resolve(cwd ?? process.cwd(), filePath));
  const top = checkoutOf(real);
  if (!top) return undefined;
  const rel = relative(top, real).split(sep).join("/");
  if (rel.startsWith("studio/decisions/") || rel === "docs/SESSION-HANDOFF.md")
    return clerk ? undefined : `refused: ${rel} is written only by a dispatched clerk subagent (W-290): dispatch a clerk with the text`;
  if (main && !rel.startsWith("studio/") && !rel.startsWith("docs/"))
    return `refused: the orchestrator session does not write source or tests (${rel}) (W-290): dispatch a builder subagent`;
  return undefined;
}

/** SubagentStop: the in-flight shell and monitor tasks (`background_tasks`) whose id the stopping
 *  agent's own transcript names, so the agent started them. */
export function ownLiveWork(input: Dict): string[] {
  const path = str(input["agent_transcript_path"]);
  const tasks = Array.isArray(input["background_tasks"]) ? input["background_tasks"] : [];
  if (!path || tasks.length === 0) return [];
  let transcript: string;
  try {
    transcript = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return tasks.flatMap((t) => {
    const id = isDict(t) ? str(t["id"]) : undefined;
    return id && isDict(t) && (t["type"] === "shell" || t["type"] === "monitor") && transcript.includes(id) ? [id] : [];
  });
}

/** The guard's one entry: a refusal line for the hook input, or undefined to let the call run. */
export function guardRefusal(input: Dict): string | undefined {
  const event = input["hook_event_name"];
  const main = str(input["agent_id"]) === undefined;
  if (event === "SubagentStop") {
    if (input["stop_hook_active"] === true) return undefined;
    const ids = ownLiveWork(input);
    return ids.length
      ? `refused: your report is in but your own background work still runs (${ids.join(", ")}): stop each with TaskStop, then finish (W-310)`
      : undefined;
  }
  if (event !== "PreToolUse") return undefined;
  const tool = input["tool_name"];
  const args = isDict(input["tool_input"]) ? input["tool_input"] : {};
  if (tool === "Bash") {
    const command = str(args["command"]);
    if (!command) return undefined;
    const write = main ? ladderWrite(command, { cwd: str(input["cwd"]) ?? process.cwd(), home: homedir() }) : undefined;
    if (write) return `refused: \`${write}\` is a ladder record write, run only by a dispatched ladder-runner (W-310): dispatch one with the command`;
    if (args["run_in_background"] === true && unboundedLoop(command))
      return "refused: a background while/until loop needs a hard bound (W-310): prefix `timeout <seconds>` or wait with `~/.bisellium-evidence/wait-until.sh <minutes> <condition>`";
    return undefined;
  }
  if (tool === "Write" || tool === "Edit" || tool === "NotebookEdit") {
    const path = str(args["file_path"]) ?? str(args["notebook_path"]);
    const clerk = !main && input["agent_type"] === "clerk";
    return path ? writeRefusal(path, str(input["cwd"]), main, clerk) : undefined;
  }
  return undefined;
}

/** The hook command the repo's `.claude/settings.json` wires for the guard. */
export const GUARD_COMMAND = "bisellium hook-event guard --studio studio";
const GUARDED_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"];

/** What the settings lack for the guard: a PreToolUse group whose matcher covers each of
 *  `GUARDED_TOOLS` and a SubagentStop group whose matcher is `*`, each holding a hook of type
 *  `command`, timeout 2, running `GUARD_COMMAND`. [] when wired. */
export function guardWiring(settings: unknown): string[] {
  const hooks = isDict(settings) && isDict(settings["hooks"]) ? settings["hooks"] : {};
  const groups = (event: string): Dict[] => (Array.isArray(hooks[event]) ? (hooks[event] as unknown[]).filter(isDict) : []);
  const runs = (g: Dict): boolean =>
    Array.isArray(g["hooks"]) && g["hooks"].some((h) => isDict(h) && h["type"] === "command" && h["timeout"] === 2 && h["command"] === GUARD_COMMAND);
  const covers = (g: Dict, tool: string): boolean => {
    const m = typeof g["matcher"] === "string" ? g["matcher"] : "";
    return m === "*" || m.split("|").includes(tool);
  };
  const missing: string[] = [];
  for (const tool of GUARDED_TOOLS)
    if (!groups("PreToolUse").some((g) => runs(g) && covers(g, tool))) missing.push(`PreToolUse ${tool} -> ${GUARD_COMMAND} (type command, timeout 2)`);
  if (!groups("SubagentStop").some((g) => runs(g) && g["matcher"] === "*")) missing.push(`SubagentStop * -> ${GUARD_COMMAND} (type command, timeout 2)`);
  return missing;
}
