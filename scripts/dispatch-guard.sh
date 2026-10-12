#!/usr/bin/env bash
# PreToolUse guard on Agent and Bash: a dispatch runs only on the step `next` names.
# Reads the hook's JSON on stdin; exit 2 blocks the call and stderr goes to the model.
# Runs master's `next` from a dedicated detached worktree (~/projects/bisellium-guard), never the agent clone and
# never the Patron's working tree. One-time setup:
#   git -C ~/projects/bisellium worktree add --detach ~/projects/bisellium-guard origin/master
#   (cd ~/projects/bisellium-guard && npm ci)
# ponytail: node_modules there is refreshed by hand; rerun `npm ci` in it when package-lock.json changes on master.
set -u
GUARD=~/projects/bisellium-guard; AGENT=~/agents/bisellium; LOG=~/.bisellium-dispatch.log
block() { printf 'BLOCKED: %s\n' "$*" >&2; exit 2; }
input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || block "dispatch-guard cannot read the hook input (jq?)"
case $tool in
  Agent) text=$(printf '%s' "$input" | jq -r '.tool_input.prompt // ""'); kind=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // ""')
         # only declared seats are dispatched (studio/bisellium.yml sellae with an agent file); no ad-hoc agents
         case $kind in builder|censor|architect|clerk|eng-lead) ;; *) block "\"$kind\" is not a declared sella; dispatch a seat from studio/bisellium.yml.";; esac;;
  Bash)  text=$(printf '%s' "$input" | jq -r '.tool_input.command // ""'); kind=bash
         # launches: an inline codex run, a host-seam dispatch, or a kept script that wraps either
         printf '%s' "$text" | grep -qE '(^|[^a-z])codex exec|bisellium run --sella|-- run --sella|\.bisellium-evidence/[^ ]*\.sh' || exit 0;;
  "") block "dispatch-guard got no tool name";;
  *) exit 0;;
esac
id=$(printf '%s' "$text" | grep -oE '\bW-[0-9]+\b' | head -1)
if [ -z "$id" ]; then echo "$(date -u +%FT%TZ) $tool $kind no-opus" >> "$LOG"; exit 0; fi
out=$(cd "$GUARD" && git fetch -q origin master && git checkout -q --detach origin/master && \
      node --import tsx packages/cli/src/main.ts next "$id" --budget 400000 --studio $AGENT/studio --repo $AGENT 2>&1)
step=$(printf '%s' "$out" | sed -n 's/^next: W-[0-9]* \([a-z]*\).*/\1/p' | head -1)
actor=$(printf '%s' "$out" | sed -n 's/^actor: //p' | head -1)
echo "$(date -u +%FT%TZ) $tool $kind $id step=$step actor=$actor" >> "$LOG"
[ "$actor" = patron ] && block "$id is held for the Patron.
$(printf '%s' "$out" | grep -E '^(why|grant|attach):')"
case "$kind:$step" in
  builder:build|builder:reds|architect:spec|censor:review|bash:review|bash:spec|bash:handoff|bash:build) exit 0;;
  *) block "next names \"$step\" (actor $actor) for $id; this dispatch is a $kind.";;
esac