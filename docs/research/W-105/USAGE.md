# W-105 retained driver handoff

The driver is standard-library-only and has separate strict processes for selection and scoring. Every write requires an existing explicit output root under this repository and uses exclusive creation. The development inputs below remain in the root checkout because they are frozen read-only inputs.

## Frozen development commands

```bash
W105_FROZEN_ROOT=/home/edckt/projects/bisellium node --test docs/research/maps-repair-driver.test.mjs

node docs/research/maps-repair-driver.mjs replay \
  --candidate /home/edckt/projects/bisellium/docs/research/maps-decision-2026-09-28/candidate-B.json \
  --baseline /home/edckt/projects/bisellium/docs/research/maps-sufficiency-2026-09-28/search-results.json \
  --bindings /home/edckt/projects/bisellium/docs/research/maps-sufficiency-2026-09-28/bindings.json \
  --output-root docs/research/W-105 --output replay-report.json

node docs/research/maps-repair-driver.mjs controls \
  --packets /home/edckt/projects/bisellium/docs/research/maps-sufficiency-2026-09-28/packet-A.json \
  --key /home/edckt/projects/bisellium/docs/research/maps-decision-2026-09-28/development-key.json \
  --key-sha256 bafe47ddd506381be2212b62bb7ca673d81b61c84153902a1d59465be9b5dc53 \
  --output-root docs/research/W-105 --output development-controls-v2.json
```

The corrected control result is curated 17/17, empty 0/17, 39/39 actual removal masks detected, and source/question identities passing.

## Fresh preparation schemas (for a later separate preparer)

No fresh question, route, anchor, expected-evidence label, or hidden key is present here. After the retained implementation freeze is independently accepted, the preparer supplies a questions file shaped as:

```json
{
  "version": 1,
  "cases": [
    {
      "id": "assigned stable case id",
      "project": "bisellium | epoch0 | yan-mo",
      "question": "question text",
      "references": []
    }
  ]
}
```

There must be exactly 12 cases, four per project. The unchanged authoritative bindings file supplies the 15/4/4 corpus manifests. `references` stays empty for search; fresh routes are not inputs.

Only after questions and source identities are frozen does the preparer create a hidden key shaped as:

```json
{
  "version": 1,
  "state": "frozen_before_either_fresh_arm",
  "inputs": {
    "questions": { "path": "...", "sha256": "..." }
  },
  "cases": [
    {
      "id": "same case id",
      "project": "same project id",
      "question": "exact same question text",
      "requiredEvidence": [
        {
          "id": "stable requirement id",
          "essentialRequestedFact": "fact description",
          "questionClause": "exact clause",
          "satisfactionRule": "all minimal anchors",
          "evidenceAnchors": [
            {
              "id": "stable anchor id",
              "type": "sourceText",
              "repository": "repository id from bindings",
              "path": "bound corpus path",
              "fileSha256": "complete frozen source hash",
              "startLine": 1,
              "startCharacter": 1,
              "endLine": 1,
              "endCharacterExclusive": 2,
              "exactText": "exact positioned source slice"
            }
          ],
          "alternativeEquivalentAnchors": []
        }
      ]
    }
  ]
}
```

A `metadataCriterion` anchor may replace `sourceText` only for an explicit absence/structural requirement. It names `caseId`, `availableEvidenceClass`, `requiredButUnavailable`, and `criterion`; the scorer derives it from packet contents and refuses an empty packet as evidence.

## Fresh run commands (only after accepted implementation freeze)

Use a new explicit output directory under this repository, never the historical `fresh-run/` directory. Run baseline once:

```bash
node docs/research/maps-repair-driver.mjs baseline \
  --dataset <frozen-questions.json> \
  --bindings /home/edckt/projects/bisellium/docs/research/maps-sufficiency-2026-09-28/bindings.json \
  --harness docs/research/bisellium-maps-harness.mjs \
  --output-root <new-output-directory> --output baseline-packets.json
```

This invokes the reviewed W-103 harness in `search` mode with explicit `excerptFiles=4` and `excerptCharacters=6000`; the harness retains the other frozen limits. Run Policy B once in a fresh process:

```bash
node docs/research/maps-repair-driver.mjs select \
  --baseline <new-output-directory>/baseline-packets.json \
  --bindings /home/edckt/projects/bisellium/docs/research/maps-sufficiency-2026-09-28/bindings.json \
  --output-root <new-output-directory> --output policy-B-packets.json
```

Freeze both packet files before any process receives the hidden key. Then score each frozen packet set in a separate process, supplying the already-frozen key hash:

```bash
node docs/research/maps-repair-driver.mjs score \
  --packets <frozen-packets.json> --key <hidden-key.json> \
  --key-sha256 <frozen-key-sha256> \
  --output-root <new-output-directory> --output <arm>-score.json
```

Selection rejects unknown options and recursively rejects `key`, `expected`, `expectedResult`, `pass`, or `passed` fields. It reads only the named baseline and bindings files, so an irrelevant neighboring key is outside its input set. Scoring refuses key hash, question, project, repository, path, full-source-hash, line, or character-slice mismatches.

## Freeze interface

Prepare a descriptor containing `version: 1`, a `files` array of `{ "role", "path" }`, and the exact `commands` array. Include the driver/tests, selection rules, W-103 harness, development questions/search results/bindings/candidate B/key, replay output, curated/control packet and result, and any separately retained scorer artifact. Then run:

```bash
node docs/research/maps-repair-driver.mjs freeze \
  --descriptor <freeze-descriptor.json> \
  --output-root <freeze-output-directory> --output manifest.json

node docs/research/maps-repair-driver.mjs verify-freeze \
  --manifest <freeze-output-directory>/manifest.json \
  --output-root <verification-output-directory> --output verification.json
```

The manifest derives complete SHA-256 hashes, byte counts, absolute paths, descriptor hash, commands, and exact Node runtime. Verification rereads every file and refuses any byte-count, hash, file-type, or runtime mismatch.

## R2 scorer identity and omission boundary

Scoring validates only identity claims the packet makes. An entry for the expected repository and path must carry the key's complete source SHA-256 even when its excerpt does not contain the anchor. When that expected file entry claims to cover the anchor's line coordinates, the exact positioned character slice must match. A matching quotation in another repository, path, or line does not prove drift and remains ordinary missing evidence.

The R2 development removal controls model genuine omission: for each source anchor they remove the selected passage or curated range that claimed those coordinates, then require that requirement to become uncovered. They do not alter text while preserving a claim that the corrupted text came from the same source coordinates. The earlier control artifacts and reds remain retained as historical evidence.

## R3 truncated baseline excerpts

W-103 retains a file range even when the 6,000-character packet budget truncates the corresponding excerpt. Scoring therefore treats range coverage and supplied text extent separately. It compares positioned content only when the actual excerpt reaches the anchor's final character; a single-line or multiline excerpt ending before that point is uncovered evidence, not drift. Full file identity is still validated from repository/file metadata, including files with zero supplied excerpts, so an expected repository/path with the wrong complete SHA-256 always invalidates scoring.
