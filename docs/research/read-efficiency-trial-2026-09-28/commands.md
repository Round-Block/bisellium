# Observation command transcript

Repository root: `/home/edckt/projects/bisellium`

The governing `spec.md` was found at the nested path recorded in `results.md`. This transcript was written stage by stage before executing each stage. No command below edits a source document or studio bookkeeping.

## Stage 1: availability, initial hashes, cold baseline and discovery

```sh
date -Iseconds > "$OUT/tooling.txt"
for tool in cat grep sed wc sha256sum date; do command -v "$tool"; done >> "$OUT/tooling.txt" 2>&1
sha256sum docs/ADOPTION.md studio/leges/design.md studio/leges/engineering.md > "$OUT/source-hashes-before.txt"
{ printf '%s\n' 'path: docs/ADOPTION.md'; cat docs/ADOPTION.md; } > "$OUT/cold-adoption-baseline.txt" 2> "$OUT/cold-adoption-baseline.stderr"
{ printf '%s\n' 'path: studio/leges/design.md'; cat studio/leges/design.md; } > "$OUT/cold-design-baseline.txt" 2> "$OUT/cold-design-baseline.stderr"
{ printf '%s\n' 'path: studio/leges/engineering.md'; cat studio/leges/engineering.md; } > "$OUT/cold-engineering-baseline.txt" 2> "$OUT/cold-engineering-baseline.stderr"
{ printf '%s\n' 'path: docs/ADOPTION.md'; grep -n '^## ' docs/ADOPTION.md; } > "$OUT/cold-adoption-discovery.txt" 2> "$OUT/cold-adoption-discovery.stderr"
{ printf '%s\n' 'path: studio/leges/design.md'; grep -n '^## ' studio/leges/design.md; } > "$OUT/cold-design-discovery.txt" 2> "$OUT/cold-design-discovery.stderr"
{ printf '%s\n' 'path: studio/leges/engineering.md'; grep -n '^## ' studio/leges/engineering.md; } > "$OUT/cold-engineering-discovery.txt" 2> "$OUT/cold-engineering-discovery.stderr"
```
