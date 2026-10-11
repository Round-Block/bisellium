#!/bin/bash
# usage: land-spec.sh <ID> — performs next's spec landing; if the queue outlasts next's own wait, waits for the PR and performs again.
set -euo pipefail
EV=${BISELLIUM_EVIDENCE_DIR:-$HOME/.bisellium-evidence}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$ROOT/.git" ] || { echo "run from the main checkout's scripts/" >&2; exit 2; }
ID=$1; cd "$ROOT" || exit 1
export GH_CONFIG_DIR=~/.config/agent-gh XDG_CACHE_HOME=$EV/gh-cache
npm run -s bisellium -- next $ID --perform --expect spec --budget 400000 --studio studio --repo . 2>&1 | tail -4 || echo "first perform exited $?; waiting for the PR"
PR=$(gh pr list --head spec/$ID --state all --json number -q '.[0].number')
for i in $(seq 1 150); do s=$(gh pr view $PR --json state -q .state); [ "$s" = MERGED ] || [ "$s" = CLOSED ] && break; sleep 20; done
echo "PR $PR $s"
[ "$s" = MERGED ] && npm run -s bisellium -- next $ID --perform --expect spec --budget 400000 --studio studio --repo . 2>&1 | tail -3
