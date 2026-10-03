#!/usr/bin/env bash
# scripts/agent-workspace.sh — move agent work into its own clone and lock the
# Patron's folder away from agents.
#
#   scripts/agent-workspace.sh setup            one-time, see below
#   scripts/agent-workspace.sh verify [--inside]  read-only checks
#
# What `setup` does:
#   1. stores a fine-grained, non-admin GitHub token in a gh config of its own
#      ($AGENT_GH), apart from the Patron's gh login;
#   2. clones the repo into $AGENT_DIR with git pointed at that token only;
#   3. copies the Patron's local Claude settings and project memory across;
#   4. merges the isolation entries into ~/.claude/settings.json (the sandbox
#      denies reading ssh/git/gh credentials and writing $PATRON_DIR);
#   5. installs dependencies and runs `verify`.
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
  node "$AGENT_DIR/scripts/agent-settings-merge.mjs" "$USER_SETTINGS" "$PATRON_DIR" "$AGENT_GH"

  # e. dependencies.
  (cd "$AGENT_DIR" && npm ci)

  # f.
  verify || die "setup finished but verify failed; see the FAIL lines above."
  echo "Done. Open Claude Code sessions in $AGENT_DIR from now on."
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
const [mod, file, patronDir, agentGh] = process.argv.slice(1);
const { merge } = await import(pathToFileURL(mod).href);
let s = {};
try {
  s = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
process.exit(isDeepStrictEqual(s, merge(s, { patronDir, agentGh })) ? 0 : 1);
'

settings_merged() {
  node --input-type=module -e "$NOOP_JS" "$SELF_DIR/agent-settings-merge.mjs" "$USER_SETTINGS" "$PATRON_DIR" "$AGENT_GH"
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
  if ((inside)); then
    check "Patron folder $PATRON_DIR is not writable" patron_unwritable
    check "~/.git-credentials is not readable" unreadable "$HOME/.git-credentials"
    check "~/.ssh/id_* are not readable" unreadable "$HOME"/.ssh/id_*
    check "agent clone reaches origin" remote_reachable
  fi
  [[ $FAILS -eq 0 ]]
}

case ${1:-} in
setup) setup ;;
verify)
  shift
  verify "$@"
  ;;
*)
  echo "usage: ${0##*/} setup | verify [--inside]" >&2
  exit 2
  ;;
esac
