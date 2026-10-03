#!/bin/bash
# scripts/cascade-loop.sh — restart a fresh headless orchestrator session until
# one says stop.
#
#   scripts/cascade-loop.sh
#
# An orchestrating Claude session cannot clear itself and is capped near 500k
# context, so the Patron starts this loop once. Each iteration runs one fresh
# `claude -p` session in $AGENT_CLONE; that session takes the next queue item to
# a checkpoint and writes one word to $CASCADE_STATUS before it exits:
#
#   CONTINUE      checkpoint reached, more work, nothing blocks: next iteration
#   NEEDS_PATRON  a call only the Patron can make: stop
#   LOW_CREDIT    credits look short for another item: stop
#   QUEUE_EMPTY   nothing left: stop, exit 0
#
# A missing or unknown status, or a nonzero claude exit, also stops the loop,
# and CASCADE_MAX_RUNS caps the spend. The status file is deleted before every
# run, so a session that writes nothing cannot inherit the last CONTINUE.
#
# Run it from the Patron's reviewed folder (~/projects/bisellium/scripts/
# cascade-loop.sh), never from the agent clone, and never point a hook at it
# (hooks run unsandboxed). It touches nothing outside $AGENT_CLONE except the
# status file and the logs under ~/.cascade-loop.
set -euo pipefail
umask 077
set -C # noclobber: each log is created exclusively; the logs are the only `>` below

AGENT_CLONE=${AGENT_CLONE:-$HOME/agents/bisellium}
CASCADE_STATUS=${CASCADE_STATUS:-$HOME/.bisellium-evidence/cascade-status}
CASCADE_MAX_RUNS=${CASCADE_MAX_RUNS:-5}
CLAUDE_BIN=${CLAUDE_BIN:-claude}
STATE_DIR=$HOME/.cascade-loop
LOG_DIR=$STATE_DIR/logs

stop() {
  if [ "$1" -eq 0 ]; then echo "cascade-loop: $2"; else echo "cascade-loop: $2" >&2; fi
  exit "$1"
}

# Agents can write ~/.bisellium-evidence, so the logs live in a Patron-only dir.
# Refuse a symlink at $1 or at any ancestor below $HOME.
no_symlinks() {
  local p=$1
  while [ "$p" != "$HOME" ] && [ "$p" != / ]; do
    if [ -L "$p" ]; then stop 1 "refusing symlinked path $p"; fi
    p=$(dirname -- "$p")
  done
}

# Print MISSING, INVALID, or the allowed word the status file holds. The file
# must be a plain file, not a symlink, whose whole content is exactly one word
# and an optional newline: a byte-for-byte match against each word, so any
# other size, extra line, control byte or NUL is INVALID. Raw contents are never printed.
status_word() {
  if [ ! -e "$CASCADE_STATUS" ] && [ ! -L "$CASCADE_STATUS" ]; then echo MISSING; return; fi
  if [ -f "$CASCADE_STATUS" ] && [ ! -L "$CASCADE_STATUS" ]; then
    local w
    for w in CONTINUE NEEDS_PATRON LOW_CREDIT QUEUE_EMPTY; do
      if printf '%s\n' "$w" | cmp -s - "$CASCADE_STATUS" || printf '%s' "$w" | cmp -s - "$CASCADE_STATUS"; then
        echo "$w"
        return
      fi
    done
  fi
  echo INVALID
}

BOOT_PROMPT=$(
  cat <<EOF
You are the orchestrating session (producer). Read CLAUDE.md, then
docs/SESSION-HANDOFF.md, and boot with
\`npm run -s bisellium -- context --sella producer studio\`.

Take the next item in the handoff's Queue to a checkpoint: merged, master
fetched, done recorded, handoff updated on master.

Stay under 400k context. If the item cannot finish within that, stop at a clean
point and record where you are in the handoff.

This is headless, so no one can answer questions mid-run. Ship reversible
defaults. For a judgment only the Patron can make, file a petitio, update the
handoff, and write NEEDS_PATRON.

Dispatch subagents in the foreground (run_in_background: false). For a command
over 10 minutes, run it in the background and wait on it with the Monitor tool.
Never end your turn while work is still running.

Before exiting, write exactly one word to $CASCADE_STATUS:
- CONTINUE: the checkpoint is reached and the queue has more work nothing blocks
- NEEDS_PATRON
- LOW_CREDIT: credits look insufficient for another item
- QUEUE_EMPTY
EOF
)

[[ $CASCADE_MAX_RUNS =~ ^[1-9][0-9]*$ ]] || stop 1 "CASCADE_MAX_RUNS must be a positive integer, got '$CASCADE_MAX_RUNS'"
no_symlinks "$LOG_DIR"
mkdir -p "$LOG_DIR" "$(dirname "$CASCADE_STATUS")"

for ((run = 1; run <= CASCADE_MAX_RUNS; run++)); do
  rm -f "$CASCADE_STATUS"
  cd "$AGENT_CLONE" || stop 1 "cannot enter AGENT_CLONE $AGENT_CLONE"
  no_symlinks "$LOG_DIR"
  log=$LOG_DIR/$(date +%Y%m%dT%H%M%S)-$run.log
  (: >"$log") || stop 1 "cannot create log $log exclusively"
  rc=0
  # stream-json under -p needs --verbose (claude refuses it otherwise)
  "$CLAUDE_BIN" -p "$BOOT_PROMPT" --permission-mode auto --output-format stream-json --verbose >>"$log" 2>&1 || rc=$?
  [ "$rc" -eq 0 ] || stop 1 "claude exited $rc on run $run. Log: $log"

  case $(status_word) in
    CONTINUE) ;;
    QUEUE_EMPTY) stop 0 "QUEUE_EMPTY, the queue is done after $run run(s). Log: $log" ;;
    NEEDS_PATRON) stop 1 "NEEDS_PATRON after run $run: a Patron decision is waiting (see the handoff). Log: $log" ;;
    LOW_CREDIT) stop 1 "LOW_CREDIT after run $run: credits look short for another item. Log: $log" ;;
    MISSING) stop 1 "status file missing ($CASCADE_STATUS) after run $run: the session wrote no status. Log: $log" ;;
    *) stop 1 "invalid status after run $run: not one allowed word alone in a plain file (contents not shown). Log: $log" ;;
  esac
done
stop 1 "reached CASCADE_MAX_RUNS=$CASCADE_MAX_RUNS runs with work still queued. Last log: $log"
