#!/usr/bin/env bash
# scripts/agent-workspace.sh — move agent work into its own clone and lock the
# Patron's folder away from agents.
#
#   scripts/agent-workspace.sh setup            one-time, see below
#   scripts/agent-workspace.sh verify [--inside]  read-only checks
#   scripts/agent-workspace.sh guard            install the hook guard (W-362)
#   scripts/agent-workspace.sh guard-check      judge the guard installer's inputs only
#   scripts/agent-workspace.sh sync             fast-forward the agent clone (W-369), run by the installed guard
#
# What `sync` does (the installed guard's `hook-event sync`, outside the sandbox, at SessionStart and after a merge
# perform asks for it): it refuses, changing nothing, unless $PATRON_DIR is on master with no uncommitted tracked change
# and the agent clone's .git holds only setup's config keys (git's own core values among them), no hook, no
# info/attributes, info/grafts or alternates; then prunes dead worktree entries, fetches origin's master into $PATRON_DIR and fast-forwards the
# agent clone's master to that commit when HEAD is master and clean and master is behind it. Git in the agent clone
# runs with no global or system config, no hooks, no fsmonitor and no replacement refs; the commit comes from the Patron's clone only.
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
# PATH unsandboxed, so it must be code no session can change: the Patron's own
# clone at master (W-379). It runs only as $PATRON_DIR/scripts/agent-workspace.sh
# and judges its inputs first, changing nothing unless all hold, $PATRON_DIR on
# master with no uncommitted tracked change among them (`guard-check` prints the
# same judgement alone); then it fast-forwards $PATRON_DIR's master to
# origin/master, runs npm ci there, links $GUARD_BIN to it, merges the user
# settings from it, probes the guard, and removes W-362's old guard worktree
# $OLD_GUARD_DIR when $GUARD_BIN led into it as the run began and git finds it clean.
# Every git it runs has a clean environment, no global or system config, no hooks
# and no fsmonitor (cgit); the fetch alone keeps the Patron's environment and
# config (its ssh agent, url rules and credentials), with hooks and fsmonitor off.
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
# W-362's guard worktree, replaced by the Patron's clone (W-379): `guard` removes it once GUARD_BIN proves it the old guard
OLD_GUARD_DIR=${OLD_GUARD_DIR:-$HOME/projects/bisellium-guard}
GUARD_BIN=${GUARD_BIN:-$HOME/.local/bin/bisellium}
REPO=${REPO:-Round-Block/bisellium}

URL=https://github.com/$REPO.git
HELPER="!GH_CONFIG_DIR=$AGENT_GH gh auth git-credential"
USER_SETTINGS=$HOME/.claude/settings.json
# the script's real directory: a symlinked file or parent is followed to its target (GNU readlink -f)
SELF_DIR=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")

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

# git in the checkout at $1, run outside the sandbox: a clean environment, no global or system config, no hooks, no
# fsmonitor, no submodule recursion, no global excludes, no prompt, no replacement refs (W-369, W-379). The guard's git calls and the
# sync's in the agent clone go through it; the Patron clone's fetches do not (they need the Patron's own config).
cgit() {
  env -i HOME="$HOME" PATH="$PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GIT_PAGER=cat GIT_NO_REPLACE_OBJECTS=1 \
    git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c submodule.recurse=false -c core.excludesFile=/dev/null -C "$1" "${@:2}"
}

# A directory's real path (symlinks resolved), or nothing when it is not an enterable directory.
real() { [[ -n $1 ]] && (CDPATH='' cd -- "$1" 2>/dev/null && pwd -P); }
within() { [[ -n $2 && ($1 == "$2" || $1 == "$2"/*) ]]; }
# True when git's top of the checkout at $1 is the real path $2.
top_is() { [[ -n $2 && $(cgit "$1" rev-parse --show-toplevel 2>/dev/null) == "$2" ]]; }

# The guard installer's inputs (W-362, W-379), judged before anything changes: one line per fault, status 1 when any.
#   All three are absolute. AGENT_DIR: the top of a git checkout. PATRON_DIR: the top of a git checkout holding
#   origin/master, on master with no uncommitted tracked change (the guard installs it); neither inside the other.
#   GUARD_BIN: named bisellium, absent or a link, its directory existing, outside AGENT_DIR and on
#   PATH, with no relative entry, no entry inside AGENT_DIR and no other executable bisellium before that entry (a
#   bisellium later on PATH is never run). Paths compare by their real paths (pwd -P), so a symlinked parent, a space,
#   a quote and a non-ASCII name are the paths they name.
guard_inputs() {
  local bad=0 pathbad=0 v agent='' patron='' bdir='' p e found='' entries=()
  say() {
    echo "$*"
    bad=1
  }
  for v in AGENT_DIR PATRON_DIR GUARD_BIN; do [[ ${!v} == /* ]] || say "$v ${!v} is not an absolute path"; done
  agent=$(real "$AGENT_DIR") || agent=''
  # PATH is judged before any git runs: cgit finds git through it, so a rejected entry must never be searched (W-379)
  if bdir=$(real "$(dirname -- "$GUARD_BIN")"); then
    if [[ -n $agent ]] && within "$bdir" "$agent"; then say "GUARD_BIN $GUARD_BIN is inside AGENT_DIR (hooks run unsandboxed; a session could replace it)"; fi
    IFS=: read -ra entries <<<"$PATH"
    [[ $PATH == *: ]] && entries+=("")
    for e in "${entries[@]}"; do
      if [[ $e != /* ]]; then
        say "a relative PATH entry ('$e') comes before GUARD_BIN's directory"
        pathbad=1
        continue
      fi
      p=$(real "$e") || true
      if [[ -n $p && $p == "$bdir" ]]; then
        found=1
        break
      fi
      if [[ -n $agent && -n $p ]] && within "$p" "$agent"; then
        say "a PATH entry inside AGENT_DIR ($e) comes before GUARD_BIN's directory"
        pathbad=1
      fi
      if [[ -f $e/bisellium && -x $e/bisellium ]]; then
        say "an earlier bisellium on PATH ($e/bisellium) is not GUARD_BIN"
        pathbad=1
      fi
    done
    [[ -n $found ]] || { say "GUARD_BIN's directory $(dirname -- "$GUARD_BIN") is not on PATH"; pathbad=1; }
  else
    say "GUARD_BIN's directory $(dirname -- "$GUARD_BIN") does not exist"
    pathbad=1
  fi
  [[ ${GUARD_BIN##*/} == bisellium ]] || say "GUARD_BIN $GUARD_BIN is not named bisellium (the hooks run bisellium)"
  if [[ -e $GUARD_BIN && ! -L $GUARD_BIN ]]; then say "GUARD_BIN $GUARD_BIN exists and is not a link"; fi
  # no git runs while PATH holds a rejected entry: the faults above stand, the clones are not read
  if ((pathbad)); then return 1; fi
  if [[ -n $agent ]] && top_is "$AGENT_DIR" "$agent"; then :; else
    agent=''
    say "AGENT_DIR $AGENT_DIR is not the top of a git checkout"
  fi
  if patron=$(real "$PATRON_DIR") && top_is "$PATRON_DIR" "$patron" && cgit "$PATRON_DIR" rev-parse -q --verify refs/remotes/origin/master >/dev/null; then :; else
    patron=''
    say "PATRON_DIR $PATRON_DIR is not the top of a git checkout holding origin/master"
  fi
  # the guard installs this clone, so it judges it as the sync does (W-379)
  if [[ -n $patron ]] && ! p=$(patron_on_master "the guard"); then say "$p"; fi
  if [[ -n $agent && -n $patron ]] && { within "$agent" "$patron" || within "$patron" "$agent"; }; then
    say "PATRON_DIR and AGENT_DIR are one inside the other"
  fi
  return $bad
}

guard_linked() { within "$(readlink -f -- "$GUARD_BIN")" "$(real "$PATRON_DIR")"; }
# The probe prints a guard: line per fact; status 0 when wired, installed outside the agent clone and live.
guard_live() { "$GUARD_BIN" hooks check --harness claude-code --studio "$AGENT_DIR/studio" --repo "$AGENT_DIR"; }
guard_unwritable() { ! test -w "$(dirname -- "$GUARD_BIN")" && ! test -w "$PATRON_DIR"; }
# The sandbox's deny on the agent clone's source folders is in force (W-362).
source_unwritable() {
  local d
  for d in packages apps adapters scripts; do ! test -w "$AGENT_DIR/$d" || return 1; done
}

# W-362's old guard worktree (W-379), after the new install: removed only when it is proved the old guard, GUARD_BIN
# leading into it as this run began ($1) and git listing it as a linked worktree of PATRON_DIR, and git's
# `worktree remove` (never forced) finds it clean; else it is left, with the reason and the Patron's command.
old_guard() {
  local o p q line n=0 found='' why='' out
  [[ -e $OLD_GUARD_DIR || -L $OLD_GUARD_DIR ]] || return 0
  # each path single-quoted for the shell (a quote in it as '\''), so the command pastes as it reads
  p="'${PATRON_DIR//\'/\'\\\'\'}'"
  q="'${OLD_GUARD_DIR//\'/\'\\\'\'}'"
  o=$(real "$OLD_GUARD_DIR") || o=''
  if [[ -z $o ]]; then
    why="it is not a directory"
  elif [[ $o == "$(real "$PATRON_DIR")" ]]; then
    # PATRON_DIR itself, a main or a linked worktree, is never removed whatever GUARD_BIN led into (W-379 spec review 2)
    why="it is not a linked worktree of PATRON_DIR"
  elif [[ -z $1 ]] || ! within "$1" "$o"; then
    why="GUARD_BIN did not lead into it when this run began, so it is not proved the old guard"
  else
    # git's worktrees of PATRON_DIR: the first record is the main one, every later one a linked worktree
    while IFS= read -r -d '' line; do
      [[ $line == "worktree "* ]] || continue
      n=$((n + 1))
      if ((n > 1)) && [[ $(real "${line#worktree }") == "$o" ]]; then found=1; fi
    done < <(cgit "$PATRON_DIR" worktree list --porcelain -z)
    [[ -n $found ]] || why="it is not a linked worktree of PATRON_DIR"
  fi
  if [[ -z $why ]]; then
    if out=$(cgit "$PATRON_DIR" worktree remove -- "$OLD_GUARD_DIR" 2>&1); then
      echo "guard: removed the old guard worktree $OLD_GUARD_DIR"
      return 0
    fi
    why=${out//$'\n'/ }
  fi
  echo "guard: left $OLD_GUARD_DIR in place ($why); once it holds nothing you need: git -C $p worktree remove $q"
}

# Every step stops it on a failure (set -euo pipefail); the inputs are judged first.
guard() {
  # this script runs unsandboxed: never the agent clone's copy (SELF_DIR is its real target), which a session can change
  if within "$(real "$SELF_DIR")" "$(real "$AGENT_DIR")"; then die "run the guard step from your own clone's copy of this script, never the agent clone's (nothing was changed)."; fi
  guard_inputs || die "the guard's inputs are not valid; see the lines above (nothing was changed)."
  # the guard installs the clone it runs from, so it runs only as that clone's own copy (W-379)
  local patron entry
  patron=$(real "$PATRON_DIR")
  [[ $(real "$SELF_DIR") == "$patron/scripts" ]] || die "run the guard step as $patron/scripts/agent-workspace.sh, the copy in the clone it installs, not the copy in $SELF_DIR (nothing was changed)."
  # where GUARD_BIN leads before this run relinks it: the proof that OLD_GUARD_DIR is W-362's old guard
  # (an absent GUARD_BIN proves nothing: readlink -f would invent a path for its missing last component)
  if [[ -L $GUARD_BIN ]]; then entry=$(readlink -f -- "$GUARD_BIN") || entry=''; else entry=''; fi
  # the fetch keeps the Patron's environment and config (ssh agent, url rules, credentials); hooks and fsmonitor off
  git -c core.hooksPath=/dev/null -c core.fsmonitor=false -C "$PATRON_DIR" fetch -q origin "+refs/heads/master:refs/remotes/origin/master"
  cgit "$PATRON_DIR" merge -q --ff-only refs/remotes/origin/master || die "PATRON_DIR's master does not fast-forward to origin/master; see git's line above (only origin/master was fetched)."
  (cd "$PATRON_DIR" && npm ci --silent)
  ln -sfn "$patron/packages/cli/bin/bisellium.mjs" "$GUARD_BIN"
  guard_linked || die "$GUARD_BIN does not lead into $PATRON_DIR."
  node "$patron/scripts/agent-settings-merge.mjs" "$USER_SETTINGS" "$patron" "$AGENT_GH" "$(real "$AGENT_DIR")"
  guard_live || die "the guard at $PATRON_DIR is not wired, not outside $AGENT_DIR, or not live; see the guard: lines above."
  old_guard "$entry"
  echo "guard: installed from $PATRON_DIR at $(cgit "$PATRON_DIR" rev-parse --short HEAD)"
}

# The agent clone's .git/config keys the sync accepts (W-369): git's clone keys, setup's remote and credential helper,
# a branch's upstream and VS Code's merge-base note. Any other key (an include, a filter, a hook path) refuses the sync,
# and so does a value of a core key git consults other than its clone's (SYNC_VALUES: key, git type, the one value).
SYNC_VALUES='core.repositoryformatversion:int:0 core.filemode:bool:true core.bare:bool:false core.logallrefupdates:bool:true'
SYNC_KEYS='^(core\.(repositoryformatversion|filemode|bare|logallrefupdates)|remote\.origin\.(url|fetch)|credential\.helper|branch\..+\.(remote|merge|vscode-merge-base))$'

# git in the agent clone, outside the sandbox, on a .git a session can write: a clean environment, no global or system
# config, no hooks, no fsmonitor, no submodule recursion, no prompt, no replacement refs (W-369). sync_inputs judges its
# config and the object-substitution files first.
agit() { cgit "$AGENT_DIR" "$@"; }

# The Patron's clone, the sync's fetch source (W-369) and the guard's install (W-379): on master with no uncommitted
# tracked change, or the reason and status 1; $1 names who runs only from it (default: the sync). Read with cgit.
patron_on_master() {
  local h st who=${1:-the sync}
  h=$(cgit "$PATRON_DIR" symbolic-ref -q HEAD) || h=detached
  [[ $h == refs/heads/master ]] || { echo "PATRON_DIR $PATRON_DIR is on $h, not master; $who runs only while it is on master"; return 1; }
  st=$(cgit "$PATRON_DIR" --no-optional-locks status --porcelain --untracked-files=no) || { echo "git status failed in PATRON_DIR $PATRON_DIR"; return 1; }
  [[ -z $st ]] || { echo "PATRON_DIR $PATRON_DIR has uncommitted tracked changes (${st%%$'\n'*}); $who runs only while it is on a clean master"; return 1; }
}

# git config on the agent clone's config file alone: from /, no global or system config, a clean environment.
cfg() { (cd / && env -i PATH="$PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_NO_REPLACE_OBJECTS=1 git config --file "$1" "${@:2}"); }

# The sync's inputs (W-369): prints the first fault and returns 1, or returns 0. Nothing here runs git in the agent clone.
sync_inputs() {
  local agent patron gd h k kv t want v why
  [[ $AGENT_DIR == /* && $PATRON_DIR == /* ]] || { echo "AGENT_DIR and PATRON_DIR must be absolute paths"; return 1; }
  agent=$(real "$AGENT_DIR") || { echo "AGENT_DIR $AGENT_DIR is not a directory"; return 1; }
  if patron=$(real "$PATRON_DIR") && top_is "$PATRON_DIR" "$patron"; then :; else
    echo "PATRON_DIR $PATRON_DIR is not the top of a git checkout"
    return 1
  fi
  if within "$agent" "$patron" || within "$patron" "$agent"; then echo "PATRON_DIR and AGENT_DIR are one inside the other"; return 1; fi
  if within "$(real "$SELF_DIR")" "$agent"; then echo "this is the agent clone's copy of the script; the sync runs only from the installed guard"; return 1; fi
  why=$(patron_on_master) || { echo "$why"; return 1; }
  gd=$agent/.git
  [[ -d $gd && ! -L $gd && -f $gd/config && ! -L $gd/config ]] || { echo "$gd is not a git directory with its own config"; return 1; }
  for h in info/attributes info/grafts objects/info/alternates objects/info/http-alternates; do
    if [[ -e $gd/$h || -L $gd/$h ]]; then echo "$gd/$h exists"; return 1; fi
  done
  for h in "$gd"/hooks/*; do
    if [[ (-e $h || -L $h) && $h != *.sample ]]; then echo "a git hook is installed: $h"; return 1; fi
  done
  cfg "$gd/config" --list >/dev/null 2>&1 || { echo "$gd/config does not parse"; return 1; }
  while IFS= read -r -d '' kv; do
    k=${kv%%$'\n'*}
    [[ $k =~ $SYNC_KEYS ]] || { echo "unexpected .git/config key: $k"; return 1; }
  done < <(cfg "$gd/config" --list -z)
  # every value of each core key git consults, read as git types it; an absent key is git's default, the same value
  for kv in $SYNC_VALUES; do
    IFS=: read -r k t want <<<"$kv"
    if v=$(cfg "$gd/config" --type="$t" --get-all "$k" 2>&1); then
      while IFS= read -r h; do
        [[ $h == "$want" ]] || { echo "the .git/config value $k = $h is not $want"; return 1; }
      done <<<"$v"
    elif [[ -n $v ]]; then
      echo "the .git/config value of $k is not a $t (${v//$'\n'/ })"
      return 1
    fi
  done
}

# Fast-forward the agent clone's master to the Patron clone's freshly fetched origin/master and prune dead worktree
# entries (W-369). Run unsandboxed by the installed guard's `hook-event sync`; prints sync: lines, exits 1 on a refusal.
sync() {
  local why out n target head old st
  # every git below, in either clone, reads objects as they are: no replacement refs, no alternates or graft file from
  # the environment (agit's env -i drops them; the Patron's calls inherit this one). A planted info/grafts or
  # objects/info/alternates in the agent clone is refused by sync_inputs, which runs no git there.
  export GIT_NO_REPLACE_OBJECTS=1
  unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_GRAFT_FILE GIT_OBJECT_DIRECTORY
  stop() {
    echo "sync: refused: $1; master was not moved"
    exit 1
  }
  why=$(sync_inputs) || stop "$why"
  # the request (a merge perform's hold) is answered by this run, whatever it finds
  [[ -L $AGENT_DIR/.git/bisellium ]] || rm -f -- "$AGENT_DIR/.git/bisellium/sync"
  if out=$(agit worktree prune -v 2>&1); then
    n=$(grep -c '^Removing ' <<<"$out" || true)
    ((n == 0)) || echo "sync: pruned $n dead worktree entries"
  else
    echo "sync: git worktree prune failed: ${out//$'\n'/ }"
  fi
  out=$(GIT_TERMINAL_PROMPT=0 git -C "$PATRON_DIR" fetch -q origin "+refs/heads/master:refs/remotes/origin/master" 2>&1) || stop "could not fetch origin's master into PATRON_DIR (${out//$'\n'/ })"
  target=$(git -C "$PATRON_DIR" rev-parse -q --verify 'refs/remotes/origin/master^{commit}') || stop "PATRON_DIR has no origin/master"
  head=$(agit symbolic-ref -q HEAD) || head=detached
  [[ $head == refs/heads/master ]] || stop "HEAD of AGENT_DIR is $head, not master"
  old=$(agit rev-parse -q --verify 'refs/heads/master^{commit}') || stop "cannot read AGENT_DIR's master"
  # a tracked change is refused whether master is behind or already current
  st=$(agit status --porcelain --untracked-files=no) || stop "git status failed in AGENT_DIR"
  [[ -z $st ]] || stop "AGENT_DIR has uncommitted tracked changes (${st%%$'\n'*})"
  if [[ $old == "$target" ]]; then
    echo "sync: master is current (${target:0:12})"
    return 0
  fi
  agit cat-file -e "$target^{commit}" 2>/dev/null || agit fetch -q --no-tags --no-write-fetch-head "$(real "$PATRON_DIR")" refs/remotes/origin/master 2>/dev/null || stop "could not fetch ${target:0:12} from PATRON_DIR"
  agit merge-base --is-ancestor "$old" "$target" || stop "AGENT_DIR's master ${old:0:12} is not behind origin/master ${target:0:12} (ahead or diverged)"
  out=$(agit merge -q --ff-only --no-overwrite-ignore "$target" 2>&1) || stop "git merge --ff-only ${target:0:12} refused (${out//$'\n'/ })"
  [[ $(agit rev-parse -q --verify refs/heads/master) == "$target" ]] || stop "master did not reach ${target:0:12}"
  echo "sync: master ${old:0:12} -> ${target:0:12}"
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
  check "the hook guard's installer inputs hold (PATH, PATRON_DIR on master, GUARD_BIN)" guard_inputs
  check "GUARD_BIN leads into PATRON_DIR" guard_linked
  check "the hook guard is wired, installed outside $AGENT_DIR and live" guard_live
  if ((inside)); then
    check "Patron folder $PATRON_DIR is not writable" patron_unwritable
    check "~/.git-credentials is not readable" unreadable "$HOME/.git-credentials"
    check "~/.ssh/id_* are not readable" unreadable "$HOME"/.ssh/id_*
    check "agent clone reaches origin" remote_reachable
    check "the installed hook guard ($GUARD_BIN, $PATRON_DIR) is not writable" guard_unwritable
    check "the agent clone's packages/, apps/, adapters/ and scripts/ are not writable" source_unwritable
  fi
  [[ $FAILS -eq 0 ]]
}

case ${1:-} in
setup) setup ;;
guard) guard ;;
sync) sync ;;
guard-check)
  guard_inputs
  echo "guard inputs: ok"
  ;;
verify)
  shift
  verify "$@"
  ;;
*)
  echo "usage: ${0##*/} setup | guard | guard-check | sync | verify [--inside]" >&2
  exit 2
  ;;
esac
