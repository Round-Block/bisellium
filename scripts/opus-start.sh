#!/usr/bin/env bash
# usage: opus-start.sh <ID>  — branch rung, ready on the opus branch, npm ci
set -euo pipefail
EV=${BISELLIUM_EVIDENCE_DIR:-$HOME/.bisellium-evidence}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$ROOT/.git" ] || { echo "run from the main checkout's scripts/" >&2; exit 2; }
ID=$1
cd "$ROOT"
npm run -s bisellium -- next $ID --perform --expect branch --studio studio --repo . | tail -3
npm run -s bisellium -- ready $ID --sella architect --studio .worktrees/$ID/studio
cd .worktrees/$ID || exit 1
git add studio
git -c user.name=edckt -c user.email=edene.chankt@gmail.com commit -q -m "chore(studio): $ID ready — spec gate passed, state building

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
mkdir -p $EV/$ID-build
npm ci --cache $EV/npm-cache > $EV/$ID-build/npm-ci.log 2>&1
echo npm-ci=$?
git log --oneline -1
