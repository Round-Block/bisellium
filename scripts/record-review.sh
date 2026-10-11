#!/usr/bin/env bash
# usage: record-review.sh <ID> <round> <passed|failed> [<session-id>]
set -euo pipefail
EV=${BISELLIUM_EVIDENCE_DIR:-$HOME/.bisellium-evidence}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$ROOT/.git" ] || { echo "run from the main checkout's scripts/" >&2; exit 2; }
ID=$1; N=$2; OUT=$3
cd "$ROOT"
cp $EV/$ID-review/r$N/verdict.md $TMPDIR/$ID-r$N.md
npm run -s bisellium -- verdict $ID --round $N --sella qa-lead --outcome $OUT --model gpt-5.6-sol ${4:+--session "$4"} --from $TMPDIR/$ID-r$N.md --studio .worktrees/$ID/studio | tail -1
F=--fail; [ "$OUT" = passed ] && F=--pass
npm run -s bisellium -- review $ID $F --evidence ci/$ID-review-$N.log --round $N --sella qa-lead --model gpt-5.6-sol --studio .worktrees/$ID/studio | tail -1
cd .worktrees/$ID || exit 1
git add studio
git -c user.name=edckt -c user.email=edene.chankt@gmail.com commit -q -m "chore(studio): $ID review round $N $OUT

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git log --oneline -1
