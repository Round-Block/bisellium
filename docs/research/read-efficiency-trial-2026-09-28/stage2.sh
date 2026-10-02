#!/bin/sh
OUT=docs/research/read-efficiency-trial-2026-09-28
{ printf '%s\n' 'path/range: docs/ADOPTION.md:579-619'; sed -n '579,619p' docs/ADOPTION.md; } > "$OUT/cold-adoption-body.txt" 2> "$OUT/cold-adoption-body.stderr"
{ printf '%s\n' 'path/range: studio/leges/design.md:5-13'; sed -n '5,13p' studio/leges/design.md; } > "$OUT/cold-design-body.txt" 2> "$OUT/cold-design-body.stderr"
{ printf '%s\n' 'path/range: studio/leges/engineering.md:11-34'; sed -n '11,34p' studio/leges/engineering.md; } > "$OUT/cold-engineering-body.txt" 2> "$OUT/cold-engineering-body.stderr"
{ printf '%s\n' 'path: docs/ADOPTION.md'; cat docs/ADOPTION.md; } > "$OUT/repeat-adoption-baseline.txt" 2> "$OUT/repeat-adoption-baseline.stderr"
{ printf '%s\n' 'path: studio/leges/design.md'; cat studio/leges/design.md; } > "$OUT/repeat-design-baseline.txt" 2> "$OUT/repeat-design-baseline.stderr"
{ printf '%s\n' 'path: studio/leges/engineering.md'; cat studio/leges/engineering.md; } > "$OUT/repeat-engineering-baseline.txt" 2> "$OUT/repeat-engineering-baseline.stderr"
{ printf '%s\n' 'path: docs/ADOPTION.md'; grep -n '^## ' docs/ADOPTION.md; } > "$OUT/repeat-adoption-discovery.txt" 2> "$OUT/repeat-adoption-discovery.stderr"
{ printf '%s\n' 'path: studio/leges/design.md'; grep -n '^## ' studio/leges/design.md; } > "$OUT/repeat-design-discovery.txt" 2> "$OUT/repeat-design-discovery.stderr"
{ printf '%s\n' 'path: studio/leges/engineering.md'; grep -n '^## ' studio/leges/engineering.md; } > "$OUT/repeat-engineering-discovery.txt" 2> "$OUT/repeat-engineering-discovery.stderr"
{ printf '%s\n' 'path/range: docs/ADOPTION.md:579-619'; sed -n '579,619p' docs/ADOPTION.md; } > "$OUT/repeat-adoption-body.txt" 2> "$OUT/repeat-adoption-body.stderr"
{ printf '%s\n' 'path/range: studio/leges/design.md:5-13'; sed -n '5,13p' studio/leges/design.md; } > "$OUT/repeat-design-body.txt" 2> "$OUT/repeat-design-body.stderr"
{ printf '%s\n' 'path/range: studio/leges/engineering.md:11-34'; sed -n '11,34p' studio/leges/engineering.md; } > "$OUT/repeat-engineering-body.txt" 2> "$OUT/repeat-engineering-body.stderr"
sha256sum docs/ADOPTION.md studio/leges/design.md studio/leges/engineering.md > "$OUT/source-hashes-after.txt"
wc -c "$OUT"/cold-*-baseline.txt "$OUT"/cold-*-discovery.txt "$OUT"/cold-*-body.txt "$OUT"/repeat-*-baseline.txt "$OUT"/repeat-*-discovery.txt "$OUT"/repeat-*-body.txt > "$OUT/packet-counts.txt"
{
printf '%s\n' 'cold adoption baseline-span then targeted-body payload'
sed -n '580,620p' "$OUT/cold-adoption-baseline.txt" | sha256sum
sed -n '2,42p' "$OUT/cold-adoption-body.txt" | sha256sum
printf '%s\n' 'cold design baseline-span then targeted-body payload'
sed -n '6,14p' "$OUT/cold-design-baseline.txt" | sha256sum
sed -n '2,10p' "$OUT/cold-design-body.txt" | sha256sum
printf '%s\n' 'cold engineering baseline-span then targeted-body payload'
sed -n '12,35p' "$OUT/cold-engineering-baseline.txt" | sha256sum
sed -n '2,25p' "$OUT/cold-engineering-body.txt" | sha256sum
printf '%s\n' 'repeat adoption baseline-span then targeted-body payload'
sed -n '580,620p' "$OUT/repeat-adoption-baseline.txt" | sha256sum
sed -n '2,42p' "$OUT/repeat-adoption-body.txt" | sha256sum
printf '%s\n' 'repeat design baseline-span then targeted-body payload'
sed -n '6,14p' "$OUT/repeat-design-baseline.txt" | sha256sum
sed -n '2,10p' "$OUT/repeat-design-body.txt" | sha256sum
printf '%s\n' 'repeat engineering baseline-span then targeted-body payload'
sed -n '12,35p' "$OUT/repeat-engineering-baseline.txt" | sha256sum
sed -n '2,25p' "$OUT/repeat-engineering-body.txt" | sha256sum
} > "$OUT/span-checks.txt"
wc -c "$OUT"/*.stderr > "$OUT/stderr-counts.txt"
date -Iseconds >> "$OUT/tooling.txt"
