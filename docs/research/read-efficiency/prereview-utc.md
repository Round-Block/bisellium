# W-107 UTC pre-review evidence sheet

Status: mechanical pre-review only; no censor verdict.

## Inputs

- Worktree: `/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment`
- Branch / baseline: `codex/read-efficiency` / `5efe274d465366a449e7cfa2c8ddf1591f522988`
- Signed A1 brief SHA-256: `e0feea39982db7573346eac460701313ebb2f56e13c77762ec4956ead7b3aa22` (verified locally).
- Current runner SHA-256: `3f65eacedeb535e3c14888031f8cdd7386fdd41fea62fb85717c6d04105d720a` (verified locally).
- Earlier validation receipts are preserved and not overwritten.

## Pre-trial offline validation command

Recorded before execution. This is the only UTC pre-review command that receives the isolated key.

```bash
cd /home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment
node docs/research/read-efficiency/targeted-read-eval.mjs freeze-validate \
  --data-root /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28 \
  --registry /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/registry.json \
  --cases /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/cases.json \
  --key /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/answer-key.json \
  --manifest /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/snapshot-manifest.json \
  --output /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/validation-prereview-utc.json
```
## Offline validation result

`freeze-validate` returned `status: VALID` with no error codes. The new receipt is `/home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/validation-prereview-utc.json`. No held-out answer text is reproduced in this sheet.

## Mechanical evidence

- Current runner hash: `3f65eacedeb535e3c14888031f8cdd7386fdd41fea62fb85717c6d04105d720a` (matches UTC packet).
- Current reader hash: `5c094ca69e67bfefc85ac029bf1e8d7cc548725497aedcdb629fc8c2ecdd35e1`.
- Signed A1 brief hash matches `e0feea39982db7573346eac460701313ebb2f56e13c77762ec4956ead7b3aa22`.
- All eight current CLI red receipts are present (`studio/ci/reds/W-107/01.log` through `08.log`). The preserved pre-UTC behavior-8 receipt hash is `f6a427c8b751dfe24d1e9eedba298a0bcc5f740dbeb9c5cc35cfa854f596c98b`; the current UTC behavior-8 receipt hash is `dd43891d9eca70542968702c7751aca829a284a144d00860eef5b940a20a38ec`.
- Retained A1 canary hashes match the packet: manifest `16f7e6a7f917beae2d2af26453f5e941b8e154bfe4394c9ca158c9d94bcd0d21`, JSONL `4952594aa273c099551e19b1a6fc41af191657f0ab2907bd6769e3e2b3b4c812`, transcript `de2c2c1b6b75017ad66406c420690cfdba0b667712e3754e73e86c74af9eb570`. Its manifest reports valid Unicode/error/call-id/usage verification.
- `node docs/research/read-efficiency/targeted-read-eval-a1.test.mjs .` passed, including UTC `Z`/`+00:00` acceptance and invalid-date/nonzero-offset rejection controls.
- `node --import tsx packages/commands/src/source.test.ts .` passed.
- `node --check docs/research/read-efficiency/targeted-read-eval.mjs`, `npm run -s typecheck`, and `npm run -s format:check` passed.
- `git diff --check` passed. Changed production paths and research evidence remain within the signed W-107/A1 ownership list; studio brief/CI/opera files are bookkeeping paths.
- `npm test` was initially refused by a stale vendor-sentinel lock whose recorded PID had exited. After removing that exact generated lock, the suite process completed and removed its lock. The retained gate summary reports the full suite passed; there is no separate full-suite log in the UTC packet.

## Pretrial condition

The retained live canary predates the UTC-only runner hash above. Before any held-out model trial, run the required live canary again against this current executable and retain its fresh manifest/JSONL/transcript. This pre-review did not run it.

No censor verdict is recorded.