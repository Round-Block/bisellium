#!/usr/bin/env bash
# Rebuild both pages from head + bodies, then republish with the Artifact tool:
#   dossier  -> https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c
#   progress -> https://claude.ai/code/artifact/Rnk9m3UwfP9uexz57Zw37e
set -e
cd "$(dirname "$0")"
cat head.html body.html > bisellium-dossier.html
sed 's|<title>Bisellium Dossier</title>|<title>Bisellium Progress</title>|' head.html | cat - progress-body.html > bisellium-progress.html
echo built bisellium-dossier.html bisellium-progress.html
