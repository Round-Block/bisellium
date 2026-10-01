#!/bin/bash
# The PR merge gate the producer runs for every opus, spec and chore branch.
# Usage: scripts/merge-gate.sh <pr-number>
# Refuses to merge while any required check is pending or failing, while any
# GHAS code-scanning alert is open, or if the queue rejects; reports MERGED only
# after reading it back. Branch cleanup is deliberately NOT here: do it only
# after this prints state=MERGED (PR 127 was closed by a chained cleanup).
set -u
PR=${1:?usage: scripts/merge-gate.sh <pr-number>}
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if [ "$(gh pr view "$PR" --json mergeStateStatus -q .mergeStateStatus)" = "BEHIND" ]; then gh pr update-branch "$PR" && sleep 10; fi
state=WAITING; total=0; pending=0; failing=0
for _ in $(seq 1 60); do
  checks=$(gh pr checks "$PR" 2>/dev/null)
  total=$(echo "$checks" | grep -c .)
  pending=$(echo "$checks" | grep -c pending)
  failing=$(echo "$checks" | grep -c fail)
  if [ "$pending" -eq 0 ] && [ "$failing" -eq 0 ] && [ "$total" -ge 5 ]; then state=CHECKS_GREEN; break; fi
  if [ "$failing" -gt 0 ]; then echo "FAILING CHECKS:"; echo "$checks" | grep fail; state=CHECKS_FAILED; break; fi
  sleep 20
done
[ "$state" != "CHECKS_GREEN" ] && { echo "state=$state total=$total pending=$pending failing=$failing"; exit 1; }
open_alerts=$(gh api "repos/$REPO/code-scanning/alerts?state=open&per_page=100" --jq 'length')
[ "$open_alerts" -ne 0 ] && { echo "state=GHAS_STOP open_alerts=$open_alerts"; exit 1; }
# --auto lets the merge queue serialize PRs that leapfrog each other's update-branch.
gh pr merge "$PR" --squash --auto || { echo "state=MERGE_FAILED"; exit 1; }
state=QUEUED
for _ in $(seq 1 60); do
  read -r prstate mstate <<<"$(gh pr view "$PR" --json state,mergeStateStatus -q '.state + " " + .mergeStateStatus')"
  if [ "$prstate" = "MERGED" ]; then state=MERGED; break; fi
  if [ "$prstate" = "CLOSED" ]; then echo "state=QUEUE_REJECTED"; exit 1; fi
  # The ruleset requires an up-to-date branch and auto-merge never updates it:
  # a PR that falls behind while its checks run stalls forever (PRs 139, 147).
  if [ "$mstate" = "BEHIND" ]; then gh pr update-branch "$PR" >/dev/null 2>&1 && echo "updated branch (was BEHIND)"; fi
  sleep 20
done
[ "$state" != "MERGED" ] && { echo "state=QUEUE_TIMEOUT"; exit 1; }
git fetch -q origin master:master 2>/dev/null && echo "local master -> $(git rev-parse --short master)"
echo "state=MERGED"
