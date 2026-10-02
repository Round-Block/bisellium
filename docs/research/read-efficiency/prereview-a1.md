# W-107 A1 pre-review evidence sheet

Status: mechanical pre-review only; no censor verdict.

## Inputs

- Worktree: `/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment`
- Branch / baseline: `codex/read-efficiency` / `5efe274d465366a449e7cfa2c8ddf1591f522988`
- Signed A1 brief SHA-256: `e0feea39982db7573346eac460701313ebb2f56e13c77762ec4956ead7b3aa22` (verified locally).
- The original pre-A1 validation receipt is preserved and is not overwritten.

## Pre-trial offline validation command

Recorded before execution. This is the only A1 pre-review command that receives the isolated key.

```bash
cd /home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment
node docs/research/read-efficiency/targeted-read-eval.mjs freeze-validate \
  --data-root /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28 \
  --registry /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/registry.json \
  --cases /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/cases.json \
  --key /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/answer-key.json \
  --manifest /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/snapshot-manifest.json \
  --output /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/validation-prereview-a1.json
```
## Offline validation result

`freeze-validate` returned `status: INVALID` with `errorCodes: ["MANIFEST"]`. Per the A1 instruction, pre-review stopped at this field-level failure. No hidden answer content was reproduced; no held-out trial, model activity, paid canary rerun, product edit, or hidden-input modification followed.

Receipt: `/home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/validation-prereview-a1.json`.