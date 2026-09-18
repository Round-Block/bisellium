#!/usr/bin/env bash
# Rebuild the dossier page from head + body, then republish with the Artifact tool to
# https://claude.ai/code/artifact/d70aefcf-d87a-4918-933f-cc7b58410d4c (pass url=).
set -e
cd "$(dirname "$0")"
cat head.html body.html > bisellium-dossier.html
echo built bisellium-dossier.html
