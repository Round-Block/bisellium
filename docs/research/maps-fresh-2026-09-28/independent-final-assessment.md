# Independent final research assessment

Separate Sol-high censor, 2026-09-28. Exact returned assessment follows. “Do not keep” refers to qualifying the experimental baseline as a sufficient lookup method; no production search tool is removed.

FINAL RESEARCH DECISION — NO-GO

Do not keep the W-103 baseline, do not advance Policy B, stop these alternatives, and make no production adoption.

The original fresh scoring remains **INVALID**. Its missing pre-score packet freeze and defective hidden key are permanent provenance and measurement defects. The original `1/25`, `0/12` scores are incident evidence only.

The bounded recovery supports this conservative no-go:

- The corrected key preserved all 12 questions and 25 requirement meanings using 49 packet-blind minimal anchors.
- Independent packet-blind validation found no remaining issue.
- Corrected key: `7ea66bb3527bfd582bb8ad8cb7df0811e2ba11988c3de093a62e1818098ae8f7`
- Pre-score 39-file manifest: `3c5141aec7e1615006f3581f56ff32be838da387812dc329a102cab7f5eee69e`
- The manifest verified under Node v25.9.0 before both one-time scoring processes.
- Saved score and aggregate hashes match. Retrieval, sources, driver, key, and packets remained unchanged.

Threshold results:

- Baseline: 4/25 requirements, 6/49 anchors, 1/12 complete cases; project completion `0/4`, `0/4`, `1/4`.
- Policy B: 16/25 requirements, 30/49 anchors, 5/12 complete cases; project completion `1/4`, `2/4`, `2/4`.
- Both fail the mandatory 10/12 overall and 3/4 per-project floors.
- Policy B added B10, E9, E10, and Y9 without losing baseline’s Y8, but these secondary conditions cannot overcome failure of the qualification threshold.
- Context volume was comparable: 71,354 UTF-16 units for Policy B versus 72,000 for baseline.

For Bisellium, this means the exact frozen heuristic—ASCII query tokens, passage IDF/body scores, doubled Markdown-heading scores, and greedy whole-passage selection under four-file/6,000-unit limits—improved coverage but remained too unreliable for use. It does not establish anything general about MAPS, agent memory, semantic retrieval, or other selectors.

Two illustrative misses:

- B8 recovered the `send` evidence, but after consuming 5,987 units it omitted the adjacent 172-unit `snapshot` passage for the UTF-16 budget. Greedy ranking lost a necessary second fact from the same file.
- E11 depended on `docs/program/BOARD.md`, whose 322,573 bytes exceeded the frozen 262,144-byte per-file limit. Neither arm could admit the source; this was a source-setup miss.

This is a post hoc, packet-fixed, blind label-correction reanalysis supporting a conservative stop decision only. It is not a repaired preregistered run and cannot support a positive effectiveness claim. Any future method requires a separate, newly specified study.
