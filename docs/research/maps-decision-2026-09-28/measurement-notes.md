# MAPS measurement notes

Key v2 was frozen 2026-09-28 before candidate outputs. Old key/results were untouched. Evidence availability (anchored facts present) is separate from answer quality (reasoning, completeness, precision, abstention, overclaims).

Anchors are minimal exact repo/path/hash/line/character fragments; larger containing excerpts qualify. No alternative equivalent anchors appeared in the inspected frozen excerpts, a development-corpus limitation rather than a claim about uninspected sources. E7 live state uses metadata: the packet contains static repository excerpts, no deployment ledger/startup artifact; no quote is fabricated. Frozen snapshot identities remain authoritative despite current root HEAD advancing.

Controls PASS: curated 17/17; empty failed 17/17; all 39 single-anchor deletions failed their requirement; source anchors match original route excerpts, curated packet, prior source labels, and question clauses.

## Actual control commands

```bash
sha256sum docs/research/maps-decision-2026-09-28/development-key.json docs/research/maps-sufficiency-2026-09-28/{questions.json,answer-key.json,route-results.json,packet-A.json}
python3 -c "import json; c=json.load(open('docs/research/maps-decision-2026-09-28/measurement-controls.json')); s=c['summary']; assert s['overallPass'] and s['emptyPacketFailsAll'] and s['everyAnchorDropFails']; print(s)"
```

No candidate policy, answer, reusable driver, target write, or studio bookkeeping was produced.

## Control replay correction

The initial retained command only asserted prewritten summary booleans, and its deletion rows were constructed rather than produced by packet mutation. control-replay.txt corrects this: it rechecks frozen excerpts and labels, evaluates a synthetic empty packet, then masks each exact source fragment or removes E7 static-corpus metadata in an independent packet copy. Replay passed 17 requirements and detected all 39 mutations. Key and anchors did not change.
