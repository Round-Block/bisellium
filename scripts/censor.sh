#!/usr/bin/env bash
# usage: censor.sh <ID> <round>  — runs Codex Sol on r<round>/prompt.md, prints the verdict
set -euo pipefail
EV=${BISELLIUM_EVIDENCE_DIR:-$HOME/.bisellium-evidence}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$ROOT/.git" ] || { echo "run from the main checkout's scripts/" >&2; exit 2; }
P=$EV/$1-review/r$2
cd $P || exit 1
[ -s prompt.md ] || { echo "no prompt.md in $P" >&2; exit 2; }
rm -f verdict.md
rc=0
codex exec -c model_provider=openai -m gpt-5.6-sol -c model_reasoning_effort=high -s read-only --skip-git-repo-check -C $P -o $P/verdict.md "$(cat prompt.md)" < /dev/null > session.log 2>&1 || rc=$?
[ "$rc" -ne 0 ] || [ -s verdict.md ] || rc=3
echo exit=$rc; cat verdict.md || true; echo; grep -A1 -i "tokens used" session.log | tail -1 || true
exit "$rc"
