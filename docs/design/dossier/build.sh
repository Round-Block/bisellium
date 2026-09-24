#!/usr/bin/env bash
# Rebuild both pages from head + bodies, then republish with the Artifact tool:
#   dossier  -> https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
#   progress -> https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
set -e
cd "$(dirname "$0")"
cat head.html body.html > bisellium-dossier.html
sed 's|<title>Bisellium Dossier</title>|<title>Bisellium Progress</title>|' head.html | cat - progress-body.html > bisellium-progress.html
node build-arch.mjs
node build-arch.mjs ../DIRECTION.md bisellium-direction.html "Bisellium Design Direction" "Agent studio &middot; design direction" "What the console is (an officina&rsquo;s ledger) and is not (a SaaS dashboard) &mdash; the system, the signature elements, and the bans. Web I builds to this."
node ../../../scripts/backlog-page.mjs
sed 's|<title>Bisellium Dossier</title>|<title>Bisellium Backlog</title>|' head.html | cat - backlog-body.html > bisellium-backlog.html
echo built bisellium-dossier.html bisellium-progress.html bisellium-backlog.html
