/**
 * packages/cli/src/guard.ts — W-310 (with W-290): the guard `bisellium hook-event guard` runs for
 * Claude Code's PreToolUse (Bash, Write, Edit, NotebookEdit), SubagentStop, Stop and UserPromptSubmit hooks. Deny-only at a tool call and a
 * subagent's stop, and fail-open: it returns a refusal or nothing, never an allow, and hooks.ts lets the call run on any
 * error, unknown event or unreadable input. The main thread is a hook input without `agent_id`
 * (Claude Code sets it only inside a subagent, D-073 B).
 *
 * The Bash classifiers are lexical and recognise only the forms listed at `simpleCommands`,
 * `strip`, `cliArgv` and `scriptOf`; a script a command runs is read and judged by its text. What
 * is left unjudged is deliberate evasion (D-045): eval, an alias, a function, a command or script
 * path built from a variable, a command substitution inside double quotes: a limit.
 *
 * W-418: at a main-thread PreToolUse whose input names a cwd, the guard first takes the review notices a PR perform or
 * `review-request` left under that checkout's Git common directory (review-notice.ts) and refuses the call once with
 * their text, so the session pushes them to the Patron; taking a notice removes it.
 *
 * W-444, W-508: at a main-thread Stop the session's final reply (`last_assistant_message`) has been shown, so it is never
 * sent back: Stop exits 0 and the hook itself shows the Patron the usage reading; at UserPromptSubmit it hands the model the
 * same reading. No rule judges a reply's text at Stop (the Patron 2026-11-06 removed the length rule).
 */
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { takeNotices } from "./review-notice.js";
import { claudeFresh, CONTEXT_WIND_DOWN, takeReading, type Reading } from "./usage-reading.js";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Splits a command line into simple commands, each a list of words. Recognised: single quotes,
 *  double quotes (a backslash escapes the next character, nothing expands), a backslash outside
 *  quotes, a `#` comment opening a word, and the breaks `;` `&` `|` newline `(` `)` backtick and
 *  `$(` outside quotes. */
export function simpleCommands(line: string): string[][] {
  return commandSeq(line).map((c) => c.words);
}

/** A simple command with the break characters (`;` `&` `|` newline `(` `)` backtick `$(`) that
 *  precede and follow it. */
interface Command {
  words: string[];
  before: string;
  after: string;
}

/** The characters GNU env 9.4 splits a `-S` string at (info env, "Splitting arguments by whitespace"): space, tab, newline,
 *  carriage return, vertical tab and form feed. */
const ENV_BLANK = " \t\n\r\v\f";

/* `literal` (env -S's string, the one split for every classifier): only `ENV_BLANK` breaks words and a `#` opening a word
   ends the whole string, as env reads it; `;` `&` `|` `(` `)` backtick and `$(` stay argument text. */
function commandSeq(line: string, literal = false): Command[] {
  const out: Command[] = [];
  let run = "";
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
    if (words.length) {
      out.push({ words, before: run, after: "" });
      run = "";
    }
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "#" && !inWord) {
      const j = literal ? -1 : line.indexOf("\n", i);
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
    } else if (!literal && c === "$" && line[i + 1] === "(") {
      endCommand();
      run += "$(";
      i++;
    } else if (!literal && ";&|\n()`".includes(c)) {
      endCommand();
      run += c;
    } else if (literal ? ENV_BLANK.includes(c) : c === " " || c === "\t") endWord();
    else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  out.forEach((c, k) => (c.after = out[k + 1]?.before ?? run));
  return out;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const KEYWORDS = new Set(["!", "{", "}", "if", "then", "elif", "else", "do", "time"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const DURATION = /^(?:\d+(?:\.\d*)?|\.\d+)[smhd]?$/;
const base = (w: string | undefined): string => (w ?? "").slice((w ?? "").lastIndexOf("/") + 1);

/** Wrappers whose flags `strip` skips; `OPERAND` names the flags that take a separate operand (`env`'s are `envOption`'s). */
const WRAPPERS = new Set(["env", "command", "exec", "nice", "xargs", "timeout"]);
const OPERAND: Record<string, Set<string>> = {
  exec: new Set(["-a"]),
  nice: new Set(["-n", "--adjustment"]),
  xargs: new Set(["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a"]),
  timeout: new Set(["-k", "-s", "--kill-after", "--signal"]),
};

/** W-362: the `env` option word at `words[i]`: how many words it uses, and for `-S`/`--split-string` its string split
 *  into words by `commandSeq`'s quoting (they take its place and are read as env's arguments, as env does). Recognised: a
 *  short cluster (`-i`, `-0`, `-v`) whose first `u`, `C` or `S` takes the rest of the word or the next word
 *  (`-S'…'`, `-iS '…'`, `-uNAME`), and `--split-string`, `--unset` and `--chdir`, or any prefix of one (`--split`, as
 *  getopt_long reads it), with `=` or the next word; any other word stands alone. Env's own escapes in the string (`\_`, `\c`) and its `${VAR}` are read as plain text (a limit). */
function envOption(words: string[], i: number): { used: number; split?: string[] } {
  const w = words[i]!;
  const long = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(w);
  const name = long ? ["split-string", "unset", "chdir"].find((n) => n.startsWith(long[1]!)) : undefined;
  const short = w.startsWith("--") ? null : /^-[^SuC]*([SuC])([\s\S]*)$/.exec(w);
  const flag = long ? (name === undefined ? undefined : name === "split-string" ? "S" : "u") : short?.[1];
  if (flag === undefined) return { used: 1 };
  const rest = long ? long[2] : short![2] || undefined;
  const value = rest ?? words[i + 1];
  const used = rest === undefined ? 2 : 1;
  return flag === "S" ? { used, split: commandSeq(value ?? "", true).flatMap((c) => c.words) } : { used };
}

/** Drops the prefix words before a command: assignments, the keywords in `KEYWORDS`, and the
 *  `WRAPPERS` with their flags (an `OPERAND` flag with its value; `env` its options as `envOption`
 *  reads them, a split string's words taking their place, and its assignments), `timeout` then its
 *  duration. `timed` is true when a `timeout` with a duration above zero was dropped. `literal` is true once an `env`
 *  split string was spliced in: env runs its words as a program's argv, so shell syntax in them (`KEYWORDS` bar `time`, a
 *  loop, `cd`, `source`) is plain text, not shell syntax (W-362). */
function strip(line: string[]): { words: string[]; timed: boolean; literal: boolean } {
  let words = line;
  let i = 0;
  let timed = false;
  let literal = false;
  for (;;) {
    const w = words[i];
    if (w === undefined) break;
    const b = base(w);
    if (ASSIGNMENT.test(w) || (KEYWORDS.has(w) && (!literal || w === "time"))) i++;
    else if (WRAPPERS.has(b)) {
      for (i++; words[i]?.startsWith("-") || (b === "env" && ASSIGNMENT.test(words[i] ?? "")); ) {
        const o = b === "env" && words[i]!.startsWith("-") ? envOption(words, i) : { used: OPERAND[b]?.has(words[i]!) ? 2 : 1 };
        if (o.split) {
          words = [...words.slice(0, i), ...o.split, ...words.slice(i + o.used)];
          literal = true;
        } else i += o.used;
      }
      if (b !== "timeout") continue;
      const d = words[i] ?? "";
      if (DURATION.test(d) && Number.parseFloat(d) > 0) timed = true;
      i++;
    } else break;
  }
  return { words: words.slice(i), timed, literal };
}

const NPX_OPERAND = (w: string): boolean => w === "-p" || w === "--package";
/** The shell options that take the next word (W-362): a `-`/`+` letter cluster holding `o` or `O` (`-o pipefail`,
 *  `-eo pipefail`, `-O extglob`, `+O extglob`) and the long `--init-file`/`--rcfile`; any other long option is read
 *  as taking none, and a cluster holding both `c` and `o` reads `c` first (limits). */
const SHELL_OPERAND = (w: string): boolean => /^[-+][A-Za-z]*[oO][A-Za-z]*$/.test(w) || w === "--init-file" || w === "--rcfile";
const SHELL_INLINE = /^-[a-z]*c[a-z]*$/;
const NPX_INLINE = /^(?:-c|--call)$/;

/** A launcher's leading option words (`valued` ones take the next word), up to its first operand: the
 *  index of that operand (after a `--`), and the inline script when an option word matching `inline`
 *  holds one. A `-c` after the operand is the operand's own argument, never an option; one helper for
 *  every launcher, so no caller reads it the other way. */
function leading(w: string[], valued: (word: string) => boolean, inline?: RegExp): { operand: number; script?: string } {
  let j = 1;
  for (; w[j] !== undefined && w[j] !== "--" && /^[-+]/.test(w[j]!); j += valued(w[j]!) ? 2 : 1) if (inline?.test(w[j]!)) return { operand: j + 2, script: w[j + 1] };
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

/** The script file the words run: `bash|sh|zsh|dash [flags] <file>` (`SHELL_OPERAND`'s options with their value),
 *  `source <file>`, `. <file>`, or a command word holding `/` (`./x.sh`, `scripts/x.sh`). */
function scriptOf(w: string[], literal = false): string | undefined {
  const b = base(w[0]);
  if (SHELLS.has(b)) {
    return w[leading(w, SHELL_OPERAND).operand];
  }
  if (!literal && (b === "source" || w[0] === ".")) return w[1];
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

/** The prefix of a refusal `ladderWrite` returns whole (the unknown directory), as opposed to a ladder step. */
const REFUSED = "refused: ";
const HERE_ABSOLUTE = /^(?:\/|~\/|\$HOME\/|\$\{HOME\}\/)/;

/** True when the guard can enter the directory: it exists and its execute bit is open to this process. */
function enterable(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The hand ladder record write a command runs, or undefined: in each simple command, through
 *  `-c` scripts and the script files it runs (read by `scriptText`), three deep. A line (the
 *  command, a `-c` script, a script file) starts in one directory, `ctx.cwd`. A `cd <one operand>`
 *  (no option, no prefix word) after nothing, `;` or a newline and before `;`, `&&` or a newline
 *  is certain while every simple command before it on the line is one: it moves the one directory
 *  when the guard can enter the target. Every other `cd` or `pushd` (a pipeline, a subshell, a
 *  substitution, a branch, `||`, a `cd` after another command) is uncertain and only adds: every
 *  directory held so far stays a candidate, and each literal operand that is not an option (home
 *  for a `cd` with none), resolved against each candidate, joins when the guard can enter it. A
 *  command is judged in the one directory while the line is certain, in every candidate once it
 *  is not (no cap). `popd`, `pushd` with no directory and a `cd -` no certain `cd` precedes read
 *  a directory the line did not set: `unknown` holds from there on, in the `-c` scripts and script
 *  files it runs too, and a script file named without `/`, `~/` or `$HOME/` at its start is
 *  refused whatever it holds (the whole refusal line is returned). Limits: a `cd` target built
 *  from a variable is not followed; nor are `CDPATH`, `env -C`, `autocd` and a `cd` in a sourced script. W-364: each line
 *  is read without its comments and heredoc bodies (`walk`), so a heredoc fed to a shell is not read. */
export function ladderWrite(command: string, ctx: ShellContext, depth = 0, unknown = false): string | undefined {
  return walk(command, ctx, ladderJudge, depth, unknown);
}

/** W-364: a rule `walk` asks of each simple command: its words after `strip`'s prefixes, its words as written (its
 *  redirections among them) and one directory it may run in; it answers what it found, or undefined. */
type Judge = (words: string[], raw: string[], here: ShellContext) => string | undefined;

/** The hand ladder record write a CLI argv makes (`ladderStep`), as a `walk` rule. */
const ladderJudge: Judge = (w) => {
  const argv = cliArgv(w);
  return argv ? ladderStep(argv) : undefined;
};

/** The walk `ladderWrite` describes, for any `judge` (W-364): it is asked of each simple command in each directory the
 *  command may run in, before its `-c` script and the script file it runs are read. Each line (the command, a `-c`
 *  script, a script file) is read without its comments and heredoc bodies (`shellCode`'s `bare`), so text a heredoc
 *  carries is never read as a command, nor a `cd -` or `popd` in it as moving the shell; a heredoc fed to a shell
 *  (`bash <<EOF`) is then not read (a limit). */
function walk(command: string, ctx: ShellContext, judge: Judge, depth: number, unknown: boolean): string | undefined {
  let cwd = ctx.cwd;
  const held = new Set([cwd]);
  let certain = true;
  let uncertain = false;
  let moved = false;
  for (const c of commandSeq(shellCode(command).bare)) {
    const { words: w, literal } = strip(c.words);
    if (certain && c.words[0] === "cd" && w.length === 2 && !/^[-+]/.test(w[1]!) && /^[;\n]*$/.test(c.before) && /^(?:[;\n]*|&&\n*)$/.test(c.after)) {
      const target = wordPath(w[1]!, { ...ctx, cwd });
      if (target !== undefined && enterable(target) && target !== cwd) {
        held.add((cwd = target));
        moved = true;
      }
      continue;
    }
    certain = false;
    if (!literal && (w[0] === "cd" || w[0] === "pushd" || w[0] === "popd")) {
      uncertain = true;
      const operands = w.slice(1).filter((x) => !/^[-+]/.test(x));
      if (w[0] === "popd" || (w[0] === "pushd" && operands.length === 0) || (w[0] === "cd" && w.includes("-") && !moved)) unknown = true;
      const targets = w[0] === "cd" && w.length === 1 ? ["~"] : operands;
      for (const d of [...held])
        for (const x of targets) {
          const t = wordPath(x, { ...ctx, cwd: d });
          if (t !== undefined && enterable(t)) held.add(t);
        }
      continue;
    }
    const here = (uncertain ? [...held] : [cwd]).map((d) => ({ ...ctx, cwd: d }));
    for (const h of here) {
      const found = judge(w, c.words, h);
      if (found) return found;
    }
    const inner = shellScript(w);
    if (inner !== undefined) {
      for (const h of here) {
        const found = depth < 3 ? walk(inner, h, judge, depth + 1, unknown) : undefined;
        if (found) return found;
      }
      continue;
    }
    if (cliArgv(w)) continue;
    const file = depth < 3 ? scriptOf(w, literal) : undefined;
    if (file !== undefined && unknown && !HERE_ABSOLUTE.test(file))
      return `${REFUSED}\`${file}\` runs in a directory the guard cannot know (after \`cd -\`, \`popd\` or \`pushd\` with no directory) (W-310): run it by absolute path, or dispatch a ladder-runner`;
    for (const h of here) {
      const path = file === undefined ? undefined : wordPath(file, h);
      const text = path === undefined ? undefined : scriptText(path);
      const found = text === undefined ? undefined : walk(text, h, judge, depth + 1, unknown);
      if (found) return found.startsWith(REFUSED) ? found : `${found} (in ${file})`;
    }
  }
  return undefined;
}

/** W-227: the operand of the first `cd` or `pushd` in the command whose target is `.worktrees` or a folder under it, or
 *  undefined. Each simple command is read as `walk` reads it (comments and heredoc bodies dropped, `strip`'s prefixes), in
 *  a subshell, a pipeline or a branch alike; its literal operands (home for a bare `cd`) are resolved against the call's
 *  directory and every directory an earlier `cd` named, lexically and through symlinks (`realOf`), existing or not (a
 *  sandbox remakes the folder). A target is judged by its path segments: one named `.worktrees` and the name after it, the
 *  folder it enters, unless the call's own directory is already in that folder. Limits: a target built
 *  from a variable, `cd -`, `popd`, `CDPATH`, a `cd` inside a `-c` script or a script file, and `env -C` are not judged. */
export function worktreeCd(command: string, ctx: ShellContext): string | undefined {
  const held = new Set([ctx.cwd]);
  // the folder a path enters: up to its first `.worktrees` segment and the name after it; a cd that stays in the folder the
  // call starts in (a session already inside a worktree, a test run in one) enters none
  const entered = (p: string, from: string): boolean => {
    const parts = p.split(sep);
    const k = parts.indexOf(".worktrees");
    if (k < 0) return false;
    const top = parts.slice(0, k + 2).join(sep);
    return from !== top && !from.startsWith(top + sep);
  };
  const inside = (t: string): boolean => entered(t, ctx.cwd) || entered(realOf(t), realOf(ctx.cwd));
  for (const c of commandSeq(shellCode(command).bare)) {
    const { words: w, literal } = strip(c.words);
    if (literal || (w[0] !== "cd" && w[0] !== "pushd")) continue;
    const operands = w.slice(1).filter((x) => !/^[-+]/.test(x));
    const targets = w[0] === "cd" && operands.length === 0 ? ["~"] : operands;
    for (const d of [...held])
      for (const x of targets) {
        const t = wordPath(x, { ...ctx, cwd: d });
        if (t === undefined) continue;
        if (inside(t)) return `${w[0]} ${x}`;
        held.add(t);
      }
  }
  return undefined;
}

/** W-364: the codex options that take the next word, skipped before its subcommand. */
const CODEX_OPERAND = (w: string): boolean =>
  ["-c", "--config", "-m", "--model", "-p", "--profile", "-s", "--sandbox", "-a", "--ask-for-approval", "-C", "--cd", "-i", "--image", "--enable", "--disable", "--local-provider"].includes(w);

/** W-364: the heavy run the words make, or undefined: `codex exec` (or its alias `e`, after codex's leading options,
 *  `CODEX_OPERAND`'s with their value), the CLI's `verify`, its `ci` with `--opus`, and either of the last two as the
 *  command after `bisellium run`'s `--` (its prefixes stripped). */
export function heavyStep(w: string[]): string | undefined {
  if (base(w[0]) === "codex") {
    const sub = w[leading(w, CODEX_OPERAND).operand];
    return sub === "exec" || sub === "e" ? "codex exec" : undefined;
  }
  const argv = cliArgv(w);
  if (argv === undefined) return undefined;
  if (argv[0] === "verify") return "verify";
  if (argv[0] === "ci" && argv.includes("--opus")) return "ci --opus";
  const k = argv[0] === "run" ? argv.indexOf("--") : -1;
  return k < 0 ? undefined : heavyStep(strip(argv.slice(k + 1)).words);
}

/** W-364: the heavy run (`heavyStep`) a command runs, walked as `ladderWrite` walks (directories, `-c` scripts and
 *  script files three deep, each line without its comments and heredoc bodies); or a whole refusal line (`REFUSED`)
 *  for a script in a directory the guard cannot know. */
export function heavyRun(command: string, ctx: ShellContext): string | undefined {
  return walk(command, ctx, (w) => heavyStep(w), 0, false);
}

/** True when a simple command starts a `while` or `until` loop outside any `timeout` with a
 *  duration above zero, searched through `-c` scripts three deep (a `timeout` before the shell
 *  bounds its script). `~/.bisellium-evidence/wait-until.sh` runs its loop inside the script, so its
 *  command line holds no loop. */
export function unboundedLoop(command: string, bounded = false, depth = 0): boolean {
  for (const words of simpleCommands(command)) {
    const { words: w, timed, literal } = strip(words);
    const inBound = bounded || timed;
    if (!literal && (w[0] === "while" || w[0] === "until") && !inBound) return true;
    const inner = shellScript(w);
    if (inner !== undefined && depth < 3 && unboundedLoop(inner, inBound, depth + 1)) return true;
  }
  return false;
}

/** W-496: the commands that detach work from the Bash call, refused as a simple command's first word. */
const DETACHERS = new Set(["nohup", "setsid", "disown"]);

/** W-496: the word that stands in `code` for skipped text (quotes, escapes, expansions, a heredoc delimiter). */
const SKIPPED = "Q";

const ANSI_C: Record<string, string> = { a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "'": "'", '"': '"', "?": "?" };

/** W-496: the text of a `$'…'` body with its escapes decoded as bash does: `\xHH`, `\uHHHH`, `\UHHHHHHHH`, `\NNN` octal,
 *  `\cX`, and the single-letter escapes; any other backslash stays. `\xHH` and `\NNN` are bytes, literal characters are
 *  their UTF-8 bytes, and the whole byte run is read as UTF-8, so `\303\277` is "ÿ" and the delimiter compares byte for
 *  byte with the terminator line. */
function ansiC(body: string): Buffer {
  const bytes: Buffer[] = [];
  let at = 0;
  for (const m of body.matchAll(/\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|[0-7]{1,3}|c[\s\S]|[\s\S])/gu)) {
    bytes.push(Buffer.from(body.slice(at, m.index)));
    at = m.index + m[0].length;
    const e = m[1]!;
    if (e.length > 1 && (e[0] === "u" || e[0] === "U")) {
      const n = parseInt(e.slice(1), 16);
      bytes.push(Buffer.from(n <= 0x10ffff ? String.fromCodePoint(n) : m[0]));
    } else if (e.length > 1 && e[0] === "x") bytes.push(Buffer.from([parseInt(e.slice(1), 16)]));
    else if (/^[0-7]/.test(e)) bytes.push(Buffer.from([parseInt(e, 8) & 255]));
    else if (e.length > 1) bytes.push(Buffer.from([e.charCodeAt(1) & 31]));
    else bytes.push(Buffer.from(ANSI_C[e] ?? m[0]));
  }
  bytes.push(Buffer.from(body.slice(at)));
  return Buffer.concat(bytes);
}

/** W-496: a heredoc's delimiter word read from `start` by shell quote removal, to the first unquoted blank or operator
 *  character: a backslash-newline goes, a backslash quotes the next character, single quotes keep their text, double
 *  quotes and `$"…"` keep theirs but for a backslash before `$`, a backtick, `"`, `\` or a newline, and `$'…'` decodes its
 *  escapes (`ansiC`). `end` is the index after the word. */
export function heredocDelimiter(line: string, start: number): { delim: string; end: number } {
  const parts: Buffer[] = [];
  const put = (text: string): number => parts.push(Buffer.from(text));
  let j = start;
  while (j < line.length && !" \t\n;&|<>()".includes(line[j]!)) {
    const c = line[j]!;
    if (c === "\\") {
      const ch = j + 1 < line.length ? String.fromCodePoint(line.codePointAt(j + 1)!) : "";
      if (ch !== "\n") put(ch);
      j += 1 + Math.max(ch.length, 1);
    } else if (c === "'" || (c === "$" && line[j + 1] === "'")) {
      const ansi = c === "$";
      let e = j + (ansi ? 2 : 1);
      const from = e;
      while (e < line.length && line[e] !== "'") e += ansi && line[e] === "\\" ? 2 : 1;
      const body = line.slice(from, Math.min(e, line.length));
      if (ansi) parts.push(ansiC(body));
      else put(body);
      j = e + 1;
    } else if (c === '"' || (c === "$" && line[j + 1] === '"')) {
      let e = j + (c === "$" ? 2 : 1);
      while (e < line.length && line[e] !== '"') {
        const n = line[e + 1];
        if (line[e] === "\\" && n === "\n") e += 2;
        else if (line[e] === "\\" && n !== undefined && "$`\"\\".includes(n)) {
          put(n);
          e += 2;
        } else {
          const ch = String.fromCodePoint(line.codePointAt(e)!);
          put(ch);
          e += ch.length;
        }
      }
      j = e + 1;
    } else {
      const ch = String.fromCodePoint(line.codePointAt(j)!);
      put(ch);
      j += ch.length;
    }
  }
  return { delim: Buffer.concat(parts).toString("utf8"), end: Math.min(j, line.length) };
}

/** W-496: the code a shell runs in `line`, and whether an `&` in it ends or separates a command. Read as bash reads them:
 *  single quotes; `$'…'` and double quotes, where a backslash escapes the next character; a backslash outside quotes; a
 *  `#` opening a word, to the line's end; `${…}` and `$((…))`, parentheses counted; and heredocs: after `<<` or `<<-`
 *  (a `<<<` here-string reads as `<<` with an empty delimiter, so it opens none) outside quotes and expansions and its delimiter word (quotes and backslashes removed), the lines after
 *  the next newline up to one equal to the delimiter (`<<-`: leading tabs dropped), or to the end, one heredoc after
 *  another. `code` is `line` without its comments and heredoc bodies. An `&` outside all of these ends or separates a
 *  command unless it is `&&`, follows `<`, `>`, `|` or `;` (`>&2`, `2>&1`, `<&0`, `|&`, `;&`) or precedes `>` (`&>`,
 *  `&>>`). An unterminated quote runs to the end (bash refuses that line). W-364: `bare` is `line` without its comments and
 *  heredoc bodies, everything else (quotes included) as written. */
function shellCode(line: string): { code: string; amp: boolean; bare: string } {
  let code = "";
  /** W-364: the spans `bare` leaves out, [start, end). */
  const cuts: [number, number][] = [];
  let amp = false;
  const closers: string[] = [];
  /** True inside a word: a `#` there is a character, not a comment (a quote, an escape or an expansion is part of the word). */
  let word = false;
  /** The open `(`s outside expansions, true for a `$(` (whose close ends a word) and false for a subshell's. */
  const parens: boolean[] = [];
  /** True between a pair of backticks. */
  let tick = false;
  const docs: { delim: string; tabs: boolean }[] = [];
  /** The index of the quote closing the one at `i` (or the last index), skipping a backslash's next character when `escapes`. */
  const close = (i: number, escapes: boolean): number => {
    let j = i + 1;
    for (; j < line.length && line[j] !== line[i]; j++) if (escapes && line[j] === "\\") j++;
    return Math.min(j, line.length - 1);
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const prev = line[i - 1] ?? "\n";
    if (c === "'" || c === '"' || (c === "$" && line[i + 1] === "'")) {
      const open = c === "$" ? i + 1 : i;
      const end = close(open, c !== "'");
      if (closers.length === 0) code += SKIPPED;
      word = true;
      i = end;
    } else if (c === "\\") {
      if (closers.length === 0) code += line[i + 1] === "\n" ? " " : SKIPPED;
      if (line[i + 1] !== "\n") word = true;
      i++;
    } else if (c === "#" && closers.length === 0 && !word) {
      const j = line.indexOf("\n", i);
      cuts.push([i, j < 0 ? line.length : j]);
      i = (j < 0 ? line.length : j) - 1;
    } else if (c === "\n" && docs.length > 0) {
      code += c;
      word = false;
      let k = i + 1;
      for (const d of docs.splice(0)) {
        while (k < line.length) {
          const e = line.indexOf("\n", k);
          const text = line.slice(k, e < 0 ? line.length : e);
          k = e < 0 ? line.length : e + 1;
          if ((d.tabs ? text.replace(/^\t+/, "") : text) === d.delim) break;
        }
      }
      cuts.push([i + 1, k]);
      i = k - 1;
    } else if (c === "<" && line[i + 1] === "<" && closers.length === 0) {
      let j = i + 2;
      const tabs = line[j] === "-";
      if (tabs) j++;
      while (line[j] === " " || line[j] === "\t") j++;
      const { delim, end } = heredocDelimiter(line, j);
      if (delim !== "") docs.push({ delim, tabs });
      code += "<<" + SKIPPED;
      word = end > j;
      i = end - 1;
    } else {
      if (c === "$" && line[i + 1] === "{") {
        if (closers.length === 0) code += SKIPPED;
        closers.push("}");
        word = true;
        i++;
        continue;
      }
      if (c === "$" && line.startsWith("((", i + 1)) {
        if (closers.length === 0) code += SKIPPED;
        closers.push(")", ")");
        word = true;
        i += 2;
        continue;
      }
      if (closers.length > 0) {
        if (c === "(") closers.push(")");
        else if (c === closers[closers.length - 1]) closers.pop();
        word = true;
        continue;
      }
      word = !" \t\n;&|()<>".includes(c);
      if (c === "(") parens.push(prev === "$");
      else if (c === ")") word = parens.pop() === true;
      else if (c === "`") {
        tick = !tick;
        word = !tick;
      }
      if (c === "&") {
        if (line[i + 1] === "&") {
          code += "&&";
          i++;
          continue;
        }
        if (line[i + 1] !== ">" && !"<>|;".includes(prev)) amp = true;
      }
      code += c;
    }
  }
  let bare = "";
  let at = 0;
  for (const [from, to] of cuts) {
    bare += line.slice(at, from);
    at = to;
  }
  return { code, amp, bare: bare + line.slice(at) };
}

/** W-496: the background form a foreground Bash call holds, or undefined: `&` when an `&` ends or separates a command
 *  (`shellCode`), else `nohup`, `setsid` or `disown` when one is a simple command's first word after the prefixes `strip`
 *  drops, by any path. A script the command runs (`-c`, a file) is not read: a limit. */
export function backgroundForm(command: string): string | undefined {
  const { code, amp } = shellCode(command);
  if (amp) return "&";
  for (const words of simpleCommands(code)) {
    const first = base(strip(words).words[0]);
    if (DETACHERS.has(first)) return first;
  }
  return undefined;
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

/** W-364: the dossier, which the main thread does not write. */
const DOSSIER = "docs/design/dossier/";

/** W-290: in a git checkout, `studio/decisions/**` and `docs/SESSION-HANDOFF.md` are written only
 *  by a dispatched clerk; the main thread writes nothing outside `studio/` and `docs/`, nor (W-364) under
 *  `docs/design/dossier/`. A path outside every checkout is not judged. */
export function writeRefusal(filePath: string, cwd: string | undefined, main: boolean, clerk: boolean): string | undefined {
  const real = realOf(resolve(cwd ?? process.cwd(), filePath));
  const top = checkoutOf(real);
  if (!top) return undefined;
  const rel = relative(top, real).split(sep).join("/");
  if (rel.startsWith("studio/decisions/") || rel === "docs/SESSION-HANDOFF.md")
    return clerk ? undefined : `refused: ${rel} is written only by a dispatched clerk subagent (W-290): dispatch a clerk with the text`;
  if (main && rel.startsWith(DOSSIER))
    return `refused: the orchestrator session does not write the dossier (${rel}) (W-364): dispatch a subagent with the text`;
  if (main && !rel.startsWith("studio/") && !rel.startsWith("docs/"))
    return `refused: the orchestrator session does not write source or tests (${rel}) (W-290): dispatch a builder subagent`;
  return undefined;
}

/** W-364: the paths the main thread does not write by shell, relative to their checkout: the officina's gate logs and
 *  opus records (the bisellium verbs write them), decisions and the handoff (a dispatched clerk) and the dossier (a
 *  dispatched agent). A directory names itself and everything under it. */
const RECORD_PATHS = ["studio/ci/", "studio/opera/", "studio/decisions/", DOSSIER, "docs/SESSION-HANDOFF.md"];

/** W-364: the path relative to its checkout (`realOf`, `checkoutOf`) when it is one of `RECORD_PATHS` or under one;
 *  undefined for any other path and for a path in no checkout. */
function recordPath(path: string): string | undefined {
  const real = realOf(path);
  const top = checkoutOf(real);
  if (!top) return undefined;
  const rel = relative(top, real).split(sep).join("/");
  return RECORD_PATHS.some((r) => (r.endsWith("/") ? rel === r.slice(0, -1) || rel.startsWith(r) : rel === r)) ? rel : undefined;
}

/** A redirection word: `>` or `>>` after an optional fd number, its target in the word or the next one (`commandSeq` breaks
 *  a word at `&` and `|`, so `&>` reads as `>`, and `>|` is not seen: a limit). */
const REDIRECT = /^\d*>>?([\s\S]*)$/;

/** W-364: an input redirection word: `<`, `<<<`, `<&`, or a heredoc operator `<<` or `<<-` (its delimiter, not a file) after an optional fd number (`<>` opens for writing and is not one), its
 *  source in the word or the next one. It writes nothing and is not an operand of the command. */
const INPUT = /^\d*<(?!>)(?:<<|<-|<)?&?([\s\S]*)$/;

/** W-364: the words a simple command writes to, as the rule recognises them: each output redirection's target (`REDIRECT`; an input redirection, `INPUT`, is neither a target nor an operand;
 *  `commandSeq` breaks at `&`, so `>&2`'s fd is never read as one); `tee`'s operands; the target of `cp`, `mv` and `install` (`-t`, `-t<dir>` or
 *  `--target-directory`, else the last of two or more operands); and with `-i` (in any short cluster) or `--in-place`,
 *  `sed`'s file operands (the first operand is its script unless `-e`, `-f`, `--expression` or `--file` gives one).
 *  `raw` is the command as written, `w` the words after `strip`'s prefixes. */
function writeTargets(w: string[], raw: string[]): string[] {
  const out: string[] = [];
  const redirected = new Set<number>();
  raw.forEach((x, i) => {
    const m = REDIRECT.exec(x);
    if (!m) return;
    const t = m[1] === "" ? raw[i + 1] : m[1];
    if (m[1] === "") redirected.add(i + 1);
    if (t !== undefined) out.push(t);
  });
  const offset = raw.length - w.length;
  w.forEach((x, i) => {
    if (INPUT.exec(x)?.[1] === "") redirected.add(offset + i + 1);
  });
  const args = w.slice(1).filter((x, i) => !REDIRECT.test(x) && !INPUT.test(x) && !redirected.has(offset + 1 + i));
  const operands = args.filter((x) => !x.startsWith("-"));
  const b = base(w[0]);
  if (b === "tee") out.push(...operands);
  if (b === "cp" || b === "mv" || b === "install") {
    const t = args.findIndex((x) => x === "-t" || x === "--target-directory");
    const joined = args.find((x) => /^-t./.test(x) || x.startsWith("--target-directory="));
    if (t >= 0 && args[t + 1] !== undefined) out.push(args[t + 1]!);
    else if (joined !== undefined) out.push(joined.startsWith("--") ? joined.slice(joined.indexOf("=") + 1) : joined.slice(2));
    else if (operands.length >= 2) out.push(operands[operands.length - 1]!);
  }
  if (b === "sed" && args.some((x) => /^-[A-Za-z]*i/.test(x) || x === "--in-place" || x.startsWith("--in-place="))) {
    const files: string[] = [];
    let script = false;
    for (let i = 0; i < args.length; i++) {
      const x = args[i]!;
      if (x === "-e" || x === "-f" || x === "--expression" || x === "--file") {
        script = true;
        i++;
      } else if (/^-[A-Za-z]*[ef]/.test(x) || x.startsWith("--expression=") || x.startsWith("--file=")) script = true;
      else if (!x.startsWith("-")) files.push(x);
    }
    out.push(...(script ? files : files.slice(1)));
  }
  return out;
}

/** W-364: the record path (`recordPath`) a command writes by shell (`writeTargets`), walked as `ladderWrite` walks (each
 *  line without its comments and heredoc bodies); or a whole refusal line (`REFUSED`) for a script in a directory the
 *  guard cannot know. A target built from a variable is not judged. */
export function recordWrite(command: string, ctx: ShellContext): string | undefined {
  return walk(
    command,
    ctx,
    (w, raw, here) => {
      for (const t of writeTargets(w, raw)) {
        const path = wordPath(t, here);
        const rel = path === undefined ? undefined : recordPath(path);
        if (rel !== undefined) return rel;
      }
      return undefined;
    },
    0,
    false,
  );
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

/** W-494: the stopping or calling subagent's own transcript. A PreToolUse input names the session's transcript
 *  (`transcript_path`) and the agent (`agent_id`); Claude Code keeps a subagent's transcript at
 *  `<session transcript without .jsonl>/subagents/agent-<agent_id>.jsonl` (`probe/hook-input-probe.out`). The rule
 *  recognises that path and a `transcript_path` that already names `agent-<agent_id>.jsonl`; any other input is not
 *  judged. */
export function agentTranscriptPath(input: Dict): string | undefined {
  const id = str(input["agent_id"]);
  const session = str(input["transcript_path"]);
  if (id === undefined || session === undefined || !/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
  const own = `agent-${id}.jsonl`;
  if (basename(session) === own) return session;
  if (!session.endsWith(".jsonl")) return undefined;
  return join(dirname(session), basename(session, ".jsonl"), "subagents", own);
}

/** W-494: the background Bash runs a transcript shows started and not yet ended, in start order. Started: a record whose
 *  `toolUseResult.backgroundTaskId` names the task. Ended: a `task-notification` attachment whose prompt names it in
 *  `<task-id>…</task-id>` (any status), or a TaskStop result (`toolUseResult.task_id` with a message opening
 *  `Successfully stopped task`). A line that is not JSON is skipped. */
export function liveBackgroundRuns(transcript: string): string[] {
  const started: string[] = [];
  const ended = new Set<string>();
  for (const line of transcript.split("\n")) {
    if (!/backgroundTaskId|task-notification|Successfully stopped task/.test(line)) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isDict(rec)) continue;
    const result = isDict(rec["toolUseResult"]) ? rec["toolUseResult"] : {};
    const bg = str(result["backgroundTaskId"]);
    if (bg !== undefined && !started.includes(bg)) started.push(bg);
    const stopped = str(result["task_id"]);
    if (stopped !== undefined && str(result["message"])?.startsWith("Successfully stopped task")) ended.add(stopped);
    const att = isDict(rec["attachment"]) ? rec["attachment"] : {};
    const prompt = att["commandMode"] === "task-notification" ? str(att["prompt"]) : undefined;
    for (const m of prompt?.matchAll(/<task-id>([^<]+)<\/task-id>/g) ?? []) if (m[1] !== undefined) ended.add(m[1]);
  }
  return started.filter((id) => !ended.has(id));
}

/** W-494: true when the last tool call in a subagent's transcript is SubagentHandback, so this stop follows its report.
 *  A reused agent's transcript holds earlier hand-backs; only the last tool call counts. A line that is not JSON is
 *  skipped. */
export function handsBack(transcript: string): boolean {
  let last: string | undefined;
  for (const line of transcript.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const content = isDict(rec) && rec["type"] === "assistant" && isDict(rec["message"]) ? rec["message"]["content"] : undefined;
    for (const c of Array.isArray(content) ? content : []) if (isDict(c) && c["type"] === "tool_use" && str(c["name"]) !== undefined) last = str(c["name"]);
  }
  return last === "SubagentHandback";
}

/** W-494: the calling subagent's live background runs, read from its own transcript; [] for the main thread or a
 *  transcript that cannot be read (fail-open). */
export function callerLiveRuns(input: Dict): string[] {
  const path = agentTranscriptPath(input);
  if (path === undefined) return [];
  try {
    return liveBackgroundRuns(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

/** W-494: a wait loop, as the rule recognises one: `while` or `until` opening the command text, a simple command or a
 *  quoted `-c` script, or a call of `wait-until.sh`. */
const WAIT_LOOP = /(?:^|[;&|(\n'"`])\s*(?:while|until)(?=[\s;]|$)|wait-until\.sh/;
/** W-494: `pgrep` given `-f` (alone or among other short flags, after other short flags) or `--full`. */
const PGREP_FULL = /(?:^|[\s;&|(`'"/!])pgrep(?:\s+-[A-Za-z]+)*?\s+(?:-[A-Za-z]*f[A-Za-z]*|--full)(?=[\s;'"`)]|$)/;
/** W-494: true when the command text holds a wait loop and a `pgrep -f` anywhere, quotes and `-c` scripts included:
 *  `pgrep -f` matches the shell running this very call, whose command line holds the pattern, so the loop never sees
 *  the run end (the 11-01 W-452 done run). Lexical: a pgrep given its flags another way (`-u me -f`), one reached through
 *  a variable or a script file, and a `ps | grep` wait are not recognised (a limit). */
export function selfMatchingWait(command: string): boolean {
  return WAIT_LOOP.test(command) && PGREP_FULL.test(command);
}

/** The foreground wait a refusal names: the run writes its exit file last, and the wait polls it in calls under the Bash
 *  tool's 120 s default foreground cap (a longer call is moved to the background, a second waiter). */
export const EXIT_FILE_POLL = "timeout 100 bash -c 'until [ -f X.exit ]; do sleep 10; done'";

const pct = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A reading's context in thousands of tokens, as `usage-reading.sh` prints it, or null when the reading has none. */
const contextK = (r: Reading): number | null => {
  const t = pct(r.context_tokens);
  return t === null ? null : Math.floor(t / 1000);
};
/** A reading's four parts as the hook shows them, in the shape `usage-reading.sh` prints: a value it lacks is `?`. */
export function readingParts(r: Reading): string {
  const v = (n: number | null): string => (n === null ? "?" : String(n));
  return `Claude week ${v(pct(r.claude_week_used))}%, 5h ${v(pct(r.claude_5h_used))}% | Codex week ${v(pct(r.codex_week_used))}% | context ${v(contextK(r))}k of ${CONTEXT_WIND_DOWN / 1000}k`;
}
/** W-508: a reading as the hook shows it: `readingParts`, marked with when the Claude values were seen when the status line
 *  is older than STALE_MS; undefined when no source gave a value, so a host with neither source shows nothing. */
export function shownReading(r: Reading): string | undefined {
  if ([r.claude_week_used, r.claude_5h_used, r.codex_week_used, r.context_tokens].every((v) => v === null)) return undefined;
  return claudeFresh(r) || r.claude_seen === null ? readingParts(r) : `${readingParts(r)} (Claude values seen ${r.claude_seen})`;
}

/** Stop (W-444, W-508): what the hook prints for the main thread's final reply, as Claude Code reads it: a JSON object whose
 *  one field `systemMessage` it shows the Patron (the reading of the plans' own sources), or undefined to print nothing. A subagent
 *  (`agent_id`), a continuation another Stop hook caused (`stop_hook_active`) and a Stop with no reply text show nothing. An
 *  `agent_id` of a wrong type and a `stop_hook_active` that is not boolean are refused here, before anything is read or shown:
 *  neither is read as absent. Never a refusal, so never a second reply. */
export function stopOutput(input: Dict, home: string = homedir(), now: Date = new Date()): string | undefined {
  const active = input["stop_hook_active"];
  if (input["agent_id"] !== undefined || typeof active !== "boolean" || active) return undefined;
  const reply = input["last_assistant_message"];
  if (typeof reply !== "string" || reply.trim() === "") return undefined;
  const reading = shownReading(takeReading(home, now, "stop"));
  return reading === undefined ? undefined : JSON.stringify({ systemMessage: reading });
}

/** A main-thread prompt's session id, as every probed input holds it. */
const PROMPT_SESSION = /^[A-Za-z0-9_-]{1,128}$/;
/** W-508: UserPromptSubmit, the main thread's next turn: a JSON object whose `additionalContext` Claude Code hands the model
 *  with the prompt: the reading. Undefined when there is none. A main-thread input has no `agent_id` and a session id in
 *  PROMPT_SESSION; any other, a wrong type included, is undefined before the usage sources are read. */
export function promptOutput(input: Dict, home: string = homedir(), now: Date = new Date()): string | undefined {
  const session = input["session_id"];
  if (input["agent_id"] !== undefined || typeof session !== "string" || !PROMPT_SESSION.test(session)) return undefined;
  const reading = shownReading(takeReading(home, now, "prompt"));
  return reading === undefined
    ? undefined
    : JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `Usage now: ${reading}. The Stop hook shows the Patron the latest reading under each reply, so a reply need not carry it.` } });
}

/** W-508: what the guard prints on stdout for a hook input, exit 0: the Stop and UserPromptSubmit outputs; undefined for any
 *  other event. */
export function replyHookOutput(input: Dict): string | undefined {
  const event = input["hook_event_name"];
  return event === "Stop" ? stopOutput(input) : event === "UserPromptSubmit" ? promptOutput(input) : undefined;
}

/** The guard's one entry: a refusal line for the hook input, or undefined to let the call run. */
export function guardRefusal(input: Dict): string | undefined {
  const event = input["hook_event_name"];
  const main = str(input["agent_id"]) === undefined;
  if (event === "SubagentStop") {
    if (input["stop_hook_active"] === true) return undefined;
    const ids = ownLiveWork(input);
    if (ids.length === 0) return undefined;
    let back = false;
    try {
      back = handsBack(readFileSync(str(input["agent_transcript_path"]) ?? "", "utf8"));
    } catch {
      back = false;
    }
    if (back) return `refused: your report is in but your own background work still runs (${ids.join(", ")}): stop each with TaskStop, then finish (W-310)`;
    // W-494: a turn that hands nothing back may end while the agent's one run is live; the run's notice wakes it
    return ids.length > 1
      ? `refused: ${ids.length} of your own background runs still run (${ids.join(", ")}) (W-494): stop all but one with TaskStop; a turn may end while one run is live, and its notice wakes you`
      : undefined;
  }
  if (event !== "PreToolUse") return undefined;
  // W-418: a notice a PR perform left for the Patron is handed to the main thread once, before anything else is judged;
  // an input with no cwd (the hooks-check probe) reads none
  const cwd = str(input["cwd"]);
  if (main && cwd !== undefined) {
    const notices = takeNotices(cwd);
    if (notices.length > 0)
      return `refused: ${notices.length === 1 ? "a PR waits" : `${notices.length} PRs wait`} on the Patron's review (W-418): send the Patron each notice below with PushNotification, then rerun this call: ${notices.map((n, i) => `${i + 1}) ${n}`).join(" ")}`;
  }
  const tool = input["tool_name"];
  const args = isDict(input["tool_input"]) ? input["tool_input"] : {};
  if (tool === "Bash") {
    const command = str(args["command"]);
    if (!command) return undefined;
    // W-227: a main-thread cd into a worktree folder makes the sandbox pin it for the session's life (cleanup then cannot remove it)
    const into = main ? worktreeCd(command, { cwd: str(input["cwd"]) ?? process.cwd(), home: homedir() }) : undefined;
    if (into) return `refused: the orchestrator session does not cd into a folder under .worktrees/ (W-227): \`${into}\` moves this session's shell there, and the sandbox then keeps that folder as a mount point for the session's life, so cleanup cannot remove it; use \`git -C <path>\` and absolute paths, or dispatch a subagent`;
    const write = main ? ladderWrite(command, { cwd: str(input["cwd"]) ?? process.cwd(), home: homedir() }) : undefined;
    if (write?.startsWith(REFUSED)) return write;
    if (write) return `refused: \`${write}\` is a ladder record write, run only by a dispatched ladder-runner (W-310): dispatch one with the command`;
    // W-364: the main thread's heavy runs, refused here before the CLI refuses verify and ci --opus outside a session
    const heavy = main ? heavyRun(command, { cwd: str(input["cwd"]) ?? process.cwd(), home: homedir() }) : undefined;
    if (heavy?.startsWith(REFUSED)) return heavy;
    if (heavy) return `refused: \`${heavy}\` is a heavy run, run only by a dispatched agent (W-364): dispatch one with the command; it runs verify and ci --opus inside a \`bisellium run --sella <seat> …\` session`;
    // W-364: the main thread's shell writes into the records, the handoff and the dossier (an early warning: the verbs own the records)
    const record = main ? recordWrite(command, { cwd: str(input["cwd"]) ?? process.cwd(), home: homedir() }) : undefined;
    if (record?.startsWith(REFUSED)) return record;
    if (record) return `refused: the orchestrator session does not write \`${record}\` by shell (W-364): the bisellium verbs write studio/ci/ and studio/opera/, a dispatched clerk the decisions and the handoff, a dispatched agent the dossier`;
    // W-496: background syntax in a foreground call, any thread's (a jq PreToolUse hook matched an `&` anywhere before)
    const form = args["run_in_background"] === true ? undefined : backgroundForm(command);
    if (form) return `refused: \`${form}\` puts work in the background, where it dies when this Bash call returns (W-496): run the long command as its own Bash call with the run_in_background parameter set to true instead`;
    if (selfMatchingWait(command))
      return `refused: \`pgrep -f\` matches this call's own command line, so a loop waiting on it never ends (W-494): have the run write an exit file last (\`cmd > X.log 2>&1; echo $? > X.exit\`) and poll that in the foreground in calls under the 120 s default Bash cap: \`${EXIT_FILE_POLL}\`, repeated`;
    if (args["run_in_background"] === true && unboundedLoop(command))
      return "refused: a background while/until loop needs a hard bound (W-310): prefix `timeout <seconds>` or wait with `~/.bisellium-evidence/wait-until.sh <minutes> <condition>`";
    if (args["run_in_background"] === true && !main) {
      const live = callerLiveRuns(input);
      if (live.length > 0)
        return `refused: your background run ${live.join(", ")} is still live, and an agent keeps one background run at a time (W-494): wait for it in the foreground (write an exit file last, \`cmd > X.log 2>&1; echo $? > X.exit\`, and poll it in calls under the 120 s default Bash cap, \`${EXIT_FILE_POLL}\`, repeated), or stop it with TaskStop, then start the next`;
    }
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
 *  `GUARDED_TOOLS`, a SubagentStop group whose matcher is `*`, a Stop group (W-444) and a UserPromptSubmit group (W-508; neither
 *  takes a matcher), each holding a hook of type `command`, timeout 2, running `GUARD_COMMAND`. [] when wired. */
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
  if (!groups("Stop").some(runs)) missing.push(`Stop -> ${GUARD_COMMAND} (type command, timeout 2)`);
  if (!groups("UserPromptSubmit").some(runs)) missing.push(`UserPromptSubmit -> ${GUARD_COMMAND} (type command, timeout 2)`);
  return missing;
}

/** W-364: the variable `bisellium run` sets for the command it runs (`run.ts`, `builder-run.ts`, and the host runner's
 *  builder and gate cells): the CLI's one sign that it runs inside a `bisellium run` session. */
export const SESSION_ENV = "BISELLIUM_SESSION";

/** W-364: the variables `bisellium run` stamps that name its session (its seat, its officina, its id); a heavy run drops them. */
export const SESSION_VARS = ["BISELLIUM_SELLA", "BISELLIUM_STUDIO", SESSION_ENV] as const;

/** W-364: the heavy run a CLI argv names: `verify` with any argument, `ci` with `--opus` among its arguments. */
function heavyVerb(cmd: string | undefined, args: readonly string[]): "verify" | "ci --opus" | undefined {
  return cmd === "verify" && args.length > 0 ? "verify" : cmd === "ci" && args.includes("--opus") ? "ci --opus" : undefined;
}

/** W-364: a heavy run admitted inside a session leaves it before its steps and gates start: `SESSION_VARS` are dropped from
 *  `env`, so the suite runs without the session's seat, studio, or session-id variables (the run's Git identity remains) and a
 *  nested verb against a fixture never reads the run's seat (11-03: `done` read `BISELLIUM_SELLA=producer` in close.test.ts). Any other argv leaves `env` as it is. */
export function leaveSession(cmd: string | undefined, args: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  if (heavyVerb(cmd, args) === undefined) return;
  for (const name of SESSION_VARS) delete env[name];
}

/** W-364: the CLI's refusal of a heavy run outside a `bisellium run` session, so a heavy run from any harness's main
 *  thread is refused by the verb: `verify` with any argument and `ci` with `--opus` among its arguments, when
 *  `SESSION_ENV` is unset or empty. Undefined otherwise: `verify` with no argument keeps its usage line, and `ci`
 *  without `--opus` (the CI workflow's steps) runs. The variable is a claim, not an attestation (D-045). */
export function sessionRefusal(cmd: string | undefined, args: readonly string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const step = heavyVerb(cmd, args);
  if (step === undefined || (env[SESSION_ENV] ?? "") !== "") return undefined;
  return `refused: \`bisellium ${step}\` runs only inside a bisellium run session (W-364): dispatch an agent, which runs it as \`bisellium run --sella <seat> --no-worktree --studio studio -- npm run -s bisellium -- ${step} …\` (a seat that is not a builder template, as eng-lead or producer)`;
}
