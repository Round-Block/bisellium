#!/usr/bin/env bash
# usage: opus-done.sh <ID> — cleanup rung, then verify + done on a clean chore/done-<ID> branch off master
set -euo pipefail
EV=${BISELLIUM_EVIDENCE_DIR:-$HOME/.bisellium-evidence}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$ROOT/.git" ] || { echo "run from the main checkout's scripts/" >&2; exit 2; }
# order: verify on a clean tree FIRST, then write the checkpoint (docs/ edits are source and make verify refuse), then next --perform --expect done twice
ID=$1
cd "$ROOT"
npm run -s bisellium -- next $ID --perform --expect cleanup --studio studio --repo . | tail -3
git checkout -q -b chore/done-$ID --no-track master
test "$(git branch --show-current)" = chore/done-$ID
mkdir -p $EV/$ID-done
npm run -s bisellium -- verify $ID --studio studio --repo . > $EV/$ID-done/verify.log 2>&1 || { tail -5 $EV/$ID-done/verify.log; exit 1; }
tail -3 $EV/$ID-done/verify.log
# done is performed by `next --perform --expect done` (performDone calls runDone); never run the done verb here
git status --short
