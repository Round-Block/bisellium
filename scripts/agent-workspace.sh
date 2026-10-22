#!/usr/bin/env bash
# scripts/agent-workspace.sh — move agent work into its own clone and lock the
# Patron's folder away from agents.
#
#   scripts/agent-workspace.sh setup            one-time, see below
#   scripts/agent-workspace.sh verify [--inside]  read-only checks
#   scripts/agent-workspace.sh guard            install the hook guard (W-362)
#   scripts/agent-workspace.sh guard-check      judge the guard installer's inputs only
#
# What `setup` does:
#   1. stores a fine-grained, non-admin GitHub token in a gh config of its own
#      ($AGENT_GH), apart from the Patron's gh login;
#   2. clones the repo into $AGENT_DIR with git pointed at that token only;
#   3. copies the Patron's local Claude settings and project memory across;
#   4. merges the isolation entries into ~/.claude/settings.json (the sandbox
#      is on and denies reading ssh/git/gh credentials and writing $PATRON_DIR
#      and the agent clone's packages/, apps/, adapters/ and scripts/);
#   5. installs dependencies, installs the hook guard (`guard`) and runs `verify`.
#
# What `guard` does (the Patron, in their own terminal, after each merge that
# changes the guard): the hooks in .claude/settings.json run the `bisellium` on
# PATH unsandboxed, so it must be code no session can change. It judges its
# inputs first and changes nothing unless all hold (`guard-check` prints the
# same judgement alone); then it moves $GUARD_DIR, a linked worktree of
# $PATRON_DIR, to origin/master, runs npm ci there, links $GUARD_BIN to it,
# merges the user settings from that worktree and probes the guard.
#
# `setup` is run ONCE, by the Patron, in their own terminal — never by an agent
# (it prompts for a token and edits the user-level Claude settings). Why: agents
# never write the Patron's folder and never read personal credentials; they
# work in $AGENT_DIR with a token that can read and push but not administer.
# From then on open Claude Code sessions in $AGENT_DIR.
#
# `verify` only reads. `--inside` adds the checks that only mean something from
# a sandboxed Claude session (the Patron's folder is read-only, credentials are
# unreadable, the agent clone can reach the remote).
set -euo pipefail

PATRON_DIR=${PATRON_DIR:-$HOME/projects/bisellium}
AGENT_DIR=${AGENT_DIR:-$HOME/agents/bisellium}
AGENT_GH=${AGENT_GH:-$HOME/.config/agent-gh}
GUARD_DIR=${GUARD_DIR:-$HOME/projects/bisellium-guard}
GUARD_BIN=${GUARD_BIN:-$HOME/.local/bin/bisellium}
REPO=${REPO:-Round-Block/bisellium}

URL=https://github.com/$REPO.git
HELPER="!GH_CONFIG_DIR=$AGENT_GH gh auth git-credential"
USER_SETTINGS=$HOME/.claude/settings.json
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

die() {
  echo "$*" >&2
  exit 1
}

# Claude Code's per-project directory name: the absolute path, "/" -> "-".
key() { echo "${1//\//-}"; }

# Only the agent token: an ambient GH_TOKEN would override the config dir.
agent_gh() { env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN GH_CONFIG_DIR="$AGENT_GH" gh "$@"; }

wipe_agent_gh() {
  [[ -n $AGENT_GH && $AGENT_GH != / && $AGENT_GH != "$HOME" ]] || die "refusing to remove AGENT_GH='$AGENT_GH'"
  rm -rf "$AGENT_GH"
}

token_reads_repo() { agent_gh api "repos/$REPO" --jq .full_name; }
# Refused = gh failed AND the server said 403/404; any other failure (network, auth) proves nothing.
refused() {
  local err
  if err=$(agent_gh api "$1" 2>&1 >/dev/null); then return 1; fi
  [[ $err == *"HTTP 403"* || $err == *"HTTP 404"* ]]
}
# No admin or webhook rights: needs a working token first, so no vacuous pass.
token_refused_admin() {
  token_reads_repo >/dev/null && refused "repos/$REPO/hooks" && refused "repos/$REPO/actions/permissions"
}

set_helper() {
  git -C "$AGENT_DIR" config --local --replace-all credential.helper ''
  git -C "$AGENT_DIR" config --local --add credential.helper "$HELPER"
}

setup() {
  for c in gh git node npm; do command -v "$c" >/dev/null || die "setup needs $c on PATH"; done

  # a. the agent token: read silently, handed straight to gh, never kept elsewhere.
  local token
  read -rsp "Fine-grained GitHub token for agents (github_pat_...): " token
  echo
  [[ $token == github_pat_* ]] || die "That is not a fine-grained token (it must start with github_pat_)."
  mkdir -p "$AGENT_GH"
  # --insecure-storage: keep it in $AGENT_GH, not the keyring (which would share the Patron's github.com entry).
  printf '%s' "$token" | agent_gh auth login --with-token --insecure-storage || {
    wipe_agent_gh
    die "gh did not accept the token."
  }
  token=
  token_reads_repo >/dev/null 2>&1 || {
    wipe_agent_gh
    die "The token cannot read $REPO. Give it Contents and Metadata access to that repo."
  }
  token_refused_admin >/dev/null 2>&1 || {
    wipe_agent_gh
    die "The token has admin or webhook rights on $REPO. Use a token with only Contents, Pull requests, Actions (read), Checks (read), Commit statuses (read) and Metadata."
  }

  # b. the agent clone, with git using only the agent token.
  if [[ -d $AGENT_DIR/.git ]]; then
    [[ $(git -C "$AGENT_DIR" remote get-url origin 2>/dev/null) == "$URL" ]] ||
      die "$AGENT_DIR is a clone of something other than $URL."
  elif [[ -e $AGENT_DIR && -n $(ls -A "$AGENT_DIR") ]]; then
    die "$AGENT_DIR exists and is not empty; move it away first."
  else
    mkdir -p "$(dirname "$AGENT_DIR")"
    git -c credential.helper= -c "credential.helper=$HELPER" clone "$URL" "$AGENT_DIR"
  fi
  set_helper
  git -C "$AGENT_DIR" ls-remote origin HEAD >/dev/null || die "git in $AGENT_DIR cannot reach origin with the agent token."

  # c. carry the Patron's local settings and project memory over, once.
  mkdir -p "$AGENT_DIR/.claude"
  if [[ -f $PATRON_DIR/.claude/settings.local.json && ! -e $AGENT_DIR/.claude/settings.local.json ]]; then
    cp "$PATRON_DIR/.claude/settings.local.json" "$AGENT_DIR/.claude/settings.local.json"
  fi
  local mem_src mem_dst
  mem_src=$HOME/.claude/projects/$(key "$PATRON_DIR")/memory
  mem_dst=$HOME/.claude/projects/$(key "$AGENT_DIR")/memory
  if [[ -d $mem_src && ! -e $mem_dst ]]; then
    mkdir -p "$(dirname "$mem_dst")"
    cp -r "$mem_src" "$mem_dst"
  fi

  # d. the isolation entries in the user-level Claude settings.
  node "$AGENT_DIR/scripts/agent-settings-merge.mjs" "$USER_SETTINGS" "$(real "$PATRON_DIR")" "$AGENT_GH" "$(real "$AGENT_DIR")"

  # e. dependencies.
  (cd "$AGENT_DIR" && npm ci)

  # f. the hook guard, outside the agent clone.
  guard

  # g.
  verify || die "setup finished but verify failed; see the FAIL lines above."
  echo "Done. Open Claude Code sessions in $AGENT_DIR from now on."
}

# A directory's real path (symlinks resolved), or nothing when it is not an enterable directory.
real() { [[ -n $1 ]] && (CDPATH='' cd -- "$1" 2>/dev/null && pwd -P); }
within() { [[ -n $2 && ($1 == "$2" || $1 == "$2"/*) ]]; }
# True when git's top of the checkout at $1 is the real path $2.
top_is() { [[ -n $2 && $(git -C "$1" rev-parse --show-toplevel 2>/dev/null) == "$2" ]]; }
gitpath() { real "$(git -C "$1" rev-parse --path-format=absolute "$2" 2>/dev/null)"; }

# The guard installer's inputs (W-362), judged before anything changes: one line per fault, status 1 when any.
#   All four are absolute. AGENT_DIR: the top of a git checkout. PATRON_DIR: the top of a git checkout holding
#   origin/master; neither inside the other. GUARD_DIR: absent under an existing directory, or the top of a linked
#   worktree sharing PATRON_DIR's git directory with no uncommitted tracked change, never PATRON_DIR itself; never
#   inside AGENT_DIR. GUARD_BIN: named bisellium, absent or a link, its directory existing, outside AGENT_DIR and on
#   PATH, with no relative entry, no entry inside AGENT_DIR and no other executable bisellium before that entry (a
#   bisellium later on PATH is never run). Paths compare by their real paths (pwd -P), so a symlinked parent, a space,
#   a quote and a non-ASCII name are the paths they name.
guard_inputs() {
  local bad=0 v agent='' patron='' gdir='' bdir='' p e found='' entries=()
  say() {
    echo "$*"
    bad=1
  }
  for v in AGENT_DIR PATRON_DIR GUARD_DIR GUARD_BIN; do [[ ${!v} == /* ]] || say "$v ${!v} is not an absolute path"; done
  if agent=$(real "$AGENT_DIR") && top_is "$AGENT_DIR" "$agent"; then :; else
    agent=''
    say "AGENT_DIR $AGENT_DIR is not the top of a git checkout"
  fi
  if patron=$(real "$PATRON_DIR") && top_is "$PATRON_DIR" "$patron" && git -C "$PATRON_DIR" rev-parse -q --verify refs/remotes/origin/master >/dev/null; then :; else
    patron=''
    say "PATRON_DIR $PATRON_DIR is not the top of a git checkout holding origin/master"
  fi
  if [[ -n $agent && -n $patron ]] && { within "$agent" "$patron" || within "$patron" "$agent"; }; then
    say "PATRON_DIR and AGENT_DIR are one inside the other"
  fi
  if [[ -L $GUARD_DIR || -e $GUARD_DIR ]]; then
    gdir=$(real "$GUARD_DIR") || true
    if [[ -z $gdir ]]; then
      say "GUARD_DIR $GUARD_DIR is not a directory"
    elif [[ $gdir == "$patron" ]]; then
      say "GUARD_DIR $GUARD_DIR is PATRON_DIR itself; it must be a separate worktree"
    elif [[ -z $patron ]] || ! top_is "$GUARD_DIR" "$gdir" || [[ $(gitpath "$GUARD_DIR" --git-dir) == "$(gitpath "$GUARD_DIR" --git-common-dir)" || $(gitpath "$GUARD_DIR" --git-common-dir) != "$(gitpath "$PATRON_DIR" --git-common-dir)" ]]; then
      say "GUARD_DIR $GUARD_DIR is not a linked worktree of PATRON_DIR"
    elif [[ -n $(git --no-optional-locks -C "$GUARD_DIR" status --porcelain --untracked-files=no) ]]; then
      say "GUARD_DIR $GUARD_DIR has uncommitted changes"
    fi
  elif p=$(real "$(dirname -- "$GUARD_DIR")"); then
    gdir=$p/$(basename -- "$GUARD_DIR")
  else
    say "GUARD_DIR $GUARD_DIR has no parent directory"
  fi
  if [[ -n $agent && -n $gdir ]] && within "$gdir" "$agent"; then say "GUARD_DIR $GUARD_DIR is inside AGENT_DIR"; fi
  [[ ${GUARD_BIN##*/} == bisellium ]] || say "GUARD_BIN $GUARD_BIN is not named bisellium (the hooks run bisellium)"
  if [[ -e $GUARD_BIN && ! -L $GUARD_BIN ]]; then say "GUARD_BIN $GUARD_BIN exists and is not a link"; fi
  if bdir=$(real "$(dirname -- "$GUARD_BIN")"); then
    if [[ -n $agent ]] && within "$bdir" "$agent"; then say "GUARD_BIN $GUARD_BIN is inside AGENT_DIR (hooks run unsandboxed; a session could replace it)"; fi
    IFS=: read -ra entries <<<"$PATH"
    [[ $PATH == *: ]] && entries+=("")
    for e in "${entries[@]}"; do
      if [[ $e != /* ]]; then
        say "a relative PATH entry ('$e') comes before GUARD_BIN's directory"
        continue
      fi
      p=$(real "$e") || true
      if [[ -n $p && $p == "$bdir" ]]; then
        found=1
        break
      fi
      if [[ -n $agent && -n $p ]] && within "$p" "$agent"; then say "a PATH entry inside AGENT_DIR ($e) comes before GUARD_BIN's directory"; fi
      if [[ -f $e/bisellium && -x $e/bisellium ]]; then say "an earlier bisellium on PATH ($e/bisellium) is not GUARD_BIN"; fi
    done
    [[ -n $found ]] || say "GUARD_BIN's directory $(dirname -- "$GUARD_BIN") is not on PATH"
  else
    say "GUARD_BIN's directory $(dirname -- "$GUARD_BIN") does not exist"
  fi
  return $bad
}

guard_linked() { within "$(readlink -f -- "$GUARD_BIN")" "$(real "$GUARD_DIR")"; }
# The probe prints a guard: line per fact; status 0 when wired, installed outside the agent clone and live.
guard_live() { "$GUARD_BIN" hooks check --harness claude-code --studio "$AGENT_DIR/studio" --repo "$AGENT_DIR"; }
guard_unwritable() { ! test -w "$(dirname -- "$GUARD_BIN")" && ! test -w "$GUARD_DIR"; }
# The sandbox's deny on the agent clone's source folders is in force (W-362).
source_unwritable() {
  local d
  for d in packages apps adapters scripts; do ! test -w "$AGENT_DIR/$d" || return 1; done
}

# Every step stops it on a failure (set -euo pipefail); the inputs are judged first.
guard() {
  guard_inputs || die "the guard's inputs are not valid; see the lines above (nothing was changed)."
  # this script runs unsandboxed: never the agent clone's copy, which a session can change
  if within "$(real "$SELF_DIR")" "$(real "$AGENT_DIR")"; then die "run the guard step from your own clone's copy of this script, never the agent clone's (nothing was changed)."; fi
  git -C "$PATRON_DIR" fetch -q origin "+refs/heads/master:refs/remotes/origin/master"
  if [[ -e $GUARD_DIR ]]; then
    git -C "$GUARD_DIR" checkout -q --detach origin/master
  else
    git -C "$PATRON_DIR" worktree add -q --detach "$GUARD_DIR" origin/master
  fi
  (cd "$GUARD_DIR" && npm ci --silent)
  ln -sfn "$GUARD_DIR/packages/cli/bin/bisellium.mjs" "$GUARD_BIN"
  guard_linked || die "$GUARD_BIN does not lead into $GUARD_DIR."
  node "$GUARD_DIR/scripts/agent-settings-merge.mjs" "$USER_SETTINGS" "$(real "$PATRON_DIR")" "$AGENT_GH" "$(real "$AGENT_DIR")"
  guard_live || die "the guard at $GUARD_DIR is not wired, not outside $AGENT_DIR, or not live; see the guard: lines above."
  echo "guard: installed from $GUARD_DIR at $(git -C "$GUARD_DIR" rev-parse --short HEAD)"
}

FAILS=0
check() {
  local what=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok $what"
  else
    echo "FAIL $what"
    FAILS=$((FAILS + 1))
  fi
}

# JS run by the settings check: exit 0 when merge() would change nothing.
NOOP_JS='
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
const [mod, file, patronDir, agentGh, agentDir] = process.argv.slice(1);
const { merge } = await import(pathToFileURL(mod).href);
let s = {};
try {
  s = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
process.exit(isDeepStrictEqual(s, merge(s, { patronDir, agentGh, agentDir })) ? 0 : 1);
'

settings_merged() {
  node --input-type=module -e "$NOOP_JS" "$SELF_DIR/agent-settings-merge.mjs" "$USER_SETTINGS" "$(real "$PATRON_DIR")" "$AGENT_GH" "$(real "$AGENT_DIR")"
}
origin_is_https() { [[ $(git -C "$AGENT_DIR" remote get-url origin) == "$URL" ]]; }
helper_is_set() { git -C "$AGENT_DIR" config --local --get-all credential.helper | grep -Fxq -- "$HELPER"; }
patron_unwritable() { ! test -w "$PATRON_DIR"; }
# Unreadable = absent, denied, or masked as an empty file (as the sandbox does); stat only, never reads content.
unreadable() {
  local f
  for f in "$@"; do [[ ! -r $f || ! -s $f ]] || return 1; done
}
remote_reachable() { git -C "$AGENT_DIR" ls-remote origin HEAD; }

verify() {
  local inside=0
  [[ ${1:-} == --inside ]] && inside=1
  FAILS=0
  check "user settings hold every isolation entry" settings_merged
  check "agent clone origin is $URL" origin_is_https
  check "agent clone uses the agent credential helper" helper_is_set
  check "agent token reads $REPO" token_reads_repo
  check "agent token has no admin or webhook rights on $REPO" token_refused_admin
  check "the hook guard's installer inputs hold (PATH, GUARD_DIR, GUARD_BIN)" guard_inputs
  check "GUARD_BIN leads into GUARD_DIR" guard_linked
  check "the hook guard is wired, installed outside $AGENT_DIR and live" guard_live
  if ((inside)); then
    check "Patron folder $PATRON_DIR is not writable" patron_unwritable
    check "~/.git-credentials is not readable" unreadable "$HOME/.git-credentials"
    check "~/.ssh/id_* are not readable" unreadable "$HOME"/.ssh/id_*
    check "agent clone reaches origin" remote_reachable
    check "the installed hook guard ($GUARD_BIN, $GUARD_DIR) is not writable" guard_unwritable
    check "the agent clone's packages/, apps/, adapters/ and scripts/ are not writable" source_unwritable
  fi
  [[ $FAILS -eq 0 ]]
}

case ${1:-} in
setup) setup ;;
guard) guard ;;
guard-check)
  guard_inputs
  echo "guard inputs: ok"
  ;;
verify)
  shift
  verify "$@"
  ;;
*)
  echo "usage: ${0##*/} setup | guard | guard-check | verify [--inside]" >&2
  exit 2
  ;;
esac
