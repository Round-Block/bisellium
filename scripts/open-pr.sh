#!/bin/bash
# Open a PR only from a branch rebased onto the fetched trunk (Patron, 2026-10-01:
# "all standing work should be rebased and deconflicted before opening a new PR").
# Usage: scripts/open-pr.sh <title> <body-file>
# Fetches master into the local ref, rebases HEAD onto it, refuses on conflict,
# pushes with lease, creates the PR and prints its number. Pair with
# scripts/merge-gate.sh <pr>, which reports MERGED only after master is fetched.
set -u
TITLE=${1:?usage: scripts/open-pr.sh <title> <body-file>}
BODY=${2:?usage: scripts/open-pr.sh <title> <body-file>}
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "master" ] && { echo "refusing: on master"; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "refusing: working tree dirty"; git status --short | head; exit 2; }
git fetch -q origin master:master || { echo "fetch failed"; exit 1; }
if ! git -c submodule.recurse=false rebase -q master; then
  echo "state=CONFLICT — resolve, then re-run"; git status --short | head; git rebase --abort; exit 1
fi
git push -q --force-with-lease -u origin "$BRANCH" || { echo "push failed"; exit 1; }
PR=$(gh pr create --base master --head "$BRANCH" --title "$TITLE" --body-file "$BODY" 2>&1 | grep -o '[0-9]*$')
[ -n "$PR" ] || { echo "pr create failed"; exit 1; }
echo "base=$(git rev-parse --short master) head=$(git rev-parse --short HEAD) PR=$PR"
