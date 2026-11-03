/**
 * packages/cli/src/guard.ts — W-310 (with W-290): the guard `bisellium hook-event guard` runs for
 * Claude Code's PreToolUse (Bash, Write, Edit, NotebookEdit), SubagentStop and Stop hooks. Deny-only and
 * fail-open: it returns a refusal or nothing, never an allow, and hooks.ts lets the call run on any
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
 * W-444: at a main-thread Stop the guard judges the session's final reply (`last_assistant_message`) by the rules in
 * STOP_RULES and sends it back once with their refusals joined; W-436 adds its rule to that table.
 */
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { instant } from "@bisellium/schema";
import { takeNotices } from "./review-notice.js";
import { CONTEXT_WIND_DOWN, readReadings, STALE_MS, type Reading } from "./usage-reading.js";

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
 *  from a variable is not followed; nor are `CDPATH`, `env -C`, `autocd` and a `cd` in a sourced script. */
export function ladderWrite(command: string, ctx: ShellContext, depth = 0, unknown = false): string | undefined {
  let cwd = ctx.cwd;
  const held = new Set([cwd]);
  let certain = true;
  let uncertain = false;
  let moved = false;
  for (const c of commandSeq(command)) {
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
    const inner = shellScript(w);
    if (inner !== undefined) {
      for (const h of here) {
        const found = depth < 3 ? ladderWrite(inner, h, depth + 1, unknown) : undefined;
        if (found) return found;
      }
      continue;
    }
    const argv = cliArgv(w);
    if (argv) {
      const step = ladderStep(argv);
      if (step) return step;
      continue;
    }
    const file = depth < 3 ? scriptOf(w, literal) : undefined;
    if (file !== undefined && unknown && !HERE_ABSOLUTE.test(file))
      return `${REFUSED}\`${file}\` runs in a directory the guard cannot know (after \`cd -\`, \`popd\` or \`pushd\` with no directory) (W-310): run it by absolute path, or dispatch a ladder-runner`;
    for (const h of here) {
      const path = file === undefined ? undefined : wordPath(file, h);
      const text = path === undefined ? undefined : scriptText(path);
      const found = text === undefined ? undefined : ladderWrite(text, h, depth + 1, unknown);
      if (found) return found.startsWith(REFUSED) ? found : `${found} (in ${file})`;
    }
  }
  return undefined;
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

/** W-496: the code a shell runs in `line`, and whether an `&` in it ends or separates a command. Read as bash reads them:
 *  single quotes; `$'…'` and double quotes, where a backslash escapes the next character; a backslash outside quotes; a
 *  `#` opening a word, to the line's end; `${…}` and `$((…))`, parentheses counted; and heredocs: after `<<` or `<<-`
 *  (a `<<<` here-string reads as `<<` with an empty delimiter, so it opens none) outside quotes and expansions and its delimiter word (quotes and backslashes removed), the lines after
 *  the next newline up to one equal to the delimiter (`<<-`: leading tabs dropped), or to the end, one heredoc after
 *  another. `code` is `line` without its comments and heredoc bodies. An `&` outside all of these ends or separates a
 *  command unless it is `&&`, follows `<`, `>`, `|` or `;` (`>&2`, `2>&1`, `<&0`, `|&`, `;&`) or precedes `>` (`&>`,
 *  `&>>`). An unterminated quote runs to the end (bash refuses that line). */
function shellCode(line: string): { code: string; amp: boolean } {
  let code = "";
  let amp = false;
  const closers: string[] = [];
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
      code += line.slice(i, end + 1);
      i = end;
    } else if (c === "\\") {
      code += line.slice(i, i + 2);
      i++;
    } else if (c === "#" && closers.length === 0 && " \t\n;&|()<>".includes(prev)) {
      const j = line.indexOf("\n", i);
      i = (j < 0 ? line.length : j) - 1;
    } else if (c === "\n" && docs.length > 0) {
      code += c;
      let k = i + 1;
      for (const d of docs.splice(0)) {
        while (k < line.length) {
          const e = line.indexOf("\n", k);
          const text = line.slice(k, e < 0 ? line.length : e);
          k = e < 0 ? line.length : e + 1;
          if ((d.tabs ? text.replace(/^\t+/, "") : text) === d.delim) break;
        }
      }
      i = k - 1;
    } else if (c === "<" && line[i + 1] === "<" && closers.length === 0) {
      let j = i + 2;
      const tabs = line[j] === "-";
      if (tabs) j++;
      while (line[j] === " " || line[j] === "\t") j++;
      let delim = "";
      for (; j < line.length && !" \t\n;&|<>()".includes(line[j]!); j++) {
        const d = line[j]!;
        if (d === "'" || d === '"') {
          const end = close(j, d === '"');
          const quoted = line.slice(j + 1, end);
          delim += d === '"' ? quoted.replace(/\\(.)/g, "$1") : quoted;
          j = end;
        } else if (d === "\\") delim += line[++j] ?? "";
        else delim += d;
      }
      if (delim !== "") docs.push({ delim, tabs });
      code += line.slice(i, j);
      i = j - 1;
    } else {
      if (c === "$" && line[i + 1] === "{") {
        closers.push("}");
        code += c;
        continue;
      }
      if (c === "$" && line.startsWith("((", i + 1)) {
        closers.push(")", ")");
        code += "$((";
        i += 2;
        continue;
      }
      if (closers.length > 0 && c === "(") closers.push(")");
      else if (closers.length > 0 && c === closers[closers.length - 1]) closers.pop();
      else if (c === "&" && closers.length === 0) {
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
  return { code, amp };
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

/** W-444: what a Stop rule is handed besides the reply: the hook input, the home whose usage readings it may read, and
 *  the clock. */
export interface StopContext {
  input: Dict;
  home: string;
  now: Date;
}
/** One rule a main-thread final reply is judged by: a refusal line, or undefined when the reply keeps it. */
export type StopRule = (reply: string, ctx: StopContext) => string | undefined;

/** The most words a reply to the Patron holds (Patron 2026-10-28: each asked point in one or two lines). */
export const REPLY_WORDS = 200;
/** A reply's words: its whitespace-separated runs that hold a letter or a digit, code blocks included (a bare `-`, `|`
 *  or fence is not a word). */
export function replyWords(reply: string): number {
  return reply.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
const replyLength: StopRule = (reply) => {
  const n = replyWords(reply);
  return n > REPLY_WORDS
    ? `refused: this reply is ${n} words, over ${REPLY_WORDS} (W-444): reply again in at most ${REPLY_WORDS} words, code blocks counted, each asked point in one or two lines`
    : undefined;
};

const pct = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A reading's context in thousands of tokens, as `usage-reading.sh` prints it, or null when the reading has none. */
const contextK = (r: Reading): number | null => {
  const t = pct(r.context_tokens);
  return t === null ? null : Math.floor(t / 1000);
};
/** A reading's four parts as a reply carries them, in the shape `usage-reading.sh` prints: a value it lacks is `?`. */
export function readingParts(r: Reading): string {
  const v = (n: number | null): string => (n === null ? "?" : String(n));
  return `Claude week ${v(pct(r.claude_week_used))}%, 5h ${v(pct(r.claude_5h_used))}% | Codex week ${v(pct(r.codex_week_used))}% | context ${v(contextK(r))}k of ${CONTEXT_WIND_DOWN / 1000}k`;
}
/** Each part is bounded by a set of letters, marks and digits (not an ASCII `\b`), so `15h 3%` or `contexts` is no part. */
const PARTS: [RegExp, (r: Reading) => number | null][] = [
  [/(?<![\p{L}\p{M}\p{N}])Claude week (\d+(?:\.\d+)?|\?)%/u, (r) => pct(r.claude_week_used)],
  [/(?<![\p{L}\p{M}\p{N}])5h (\d+(?:\.\d+)?|\?)%/u, (r) => pct(r.claude_5h_used)],
  [/(?<![\p{L}\p{M}\p{N}])Codex week (\d+(?:\.\d+)?|\?)?%/u, (r) => pct(r.codex_week_used)],
  [/(?<![\p{L}\p{M}\p{N}])context (\d+|\?)k(?![\p{L}\p{M}\p{N}])/u, contextK],
];
/** A reply carries a reading when one of its lines holds all four parts, each with the reading's value (a value the
 *  reading lacks is not compared). */
export function carriesReading(reply: string, r: Reading): boolean {
  return reply.split("\n").some((line) =>
    PARTS.every(([re, value]) => {
      const m = re.exec(line);
      const want = value(r);
      return m !== null && (want === null || Number(m[1]) === want);
    }),
  );
}
const SCRIPT = "~/.bisellium-evidence/usage/usage-reading.sh <label>";
/** The reply carries the latest usage reading (the readings file's last), taken within STALE_MS of the Stop. No readings
 *  file or no reading in it asks nothing; any other read error is refused, naming the error. */
const replyUsage: StopRule = (reply, { home, now }) => {
  const readings = readReadings(home);
  if ("error" in readings)
    return `refused: the usage readings file ~/.bisellium-evidence/usage/readings.jsonl cannot be read (W-444): ${readings.error}; fix it, then run ${SCRIPT} and carry its line`;
  const latest = readings[readings.length - 1];
  if (latest === undefined) return undefined;
  const at = instant(latest.at);
  if (at === undefined || !(Math.abs(now.getTime() - at.getTime()) <= STALE_MS))
    return `refused: this reply carries no usage reading taken in the last 30 minutes (W-444): the latest is from ${latest.at}; run ${SCRIPT} and carry its line`;
  return carriesReading(reply, latest)
    ? undefined
    : `refused: this reply carries no line with the latest usage reading (W-444): carry "${readingParts(latest)}" (the reading at ${latest.at}), or run ${SCRIPT} and carry its line`;
};

/** The rules a main-thread final reply is judged by, in order; each refusal is one line. W-436 adds its rule here. */
export const STOP_RULES: readonly StopRule[] = [replyLength, replyUsage];

/** Stop (W-444): the refusals of `rules` for the main thread's final reply, one line each, joined; undefined for a
 *  subagent (`agent_id`), a continuation a Stop hook caused (`stop_hook_active`, so a reply is sent back once) or a Stop
 *  with no reply text. */
export function stopRefusal(input: Dict, home: string = homedir(), now: Date = new Date(), rules: readonly StopRule[] = STOP_RULES): string | undefined {
  if (str(input["agent_id"]) !== undefined || input["stop_hook_active"] === true) return undefined;
  const reply = input["last_assistant_message"];
  if (typeof reply !== "string" || reply.trim() === "") return undefined;
  const why = rules.flatMap((rule) => rule(reply, { input, home, now }) ?? []);
  return why.length > 0 ? why.join("\n") : undefined;
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
  if (event === "Stop") return stopRefusal(input);
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
    const write = main ? ladderWrite(command, { cwd: str(input["cwd"]) ?? process.cwd(), home: homedir() }) : undefined;
    if (write?.startsWith(REFUSED)) return write;
    if (write) return `refused: \`${write}\` is a ladder record write, run only by a dispatched ladder-runner (W-310): dispatch one with the command`;
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
 *  `GUARDED_TOOLS`, a SubagentStop group whose matcher is `*` and a Stop group (W-444; Stop takes no
 *  matcher), each holding a hook of type `command`, timeout 2, running `GUARD_COMMAND`. [] when wired. */
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
  return missing;
}
