# W-107 pre-review evidence sheet

Status: mechanical pre-review only; no censor verdict.

## Inputs and scope

- Worktree: `/home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment`
- Branch / baseline: `codex/read-efficiency` / `5efe274d465366a449e7cfa2c8ddf1591f522988`
- Signed brief SHA-256: `018dc802447a7c08552cf78b28fa165ffdd9b2b41050ff66c663b93652aab4a1` (verified locally).
- Held-out material was not reproduced here. The validator emits only status, codes, and hashes.

## Pre-trial offline validation command

The following command was recorded before execution. It is the only command in this pre-review that receives the isolated key.

```bash
cd /home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment
node docs/research/read-efficiency/targeted-read-eval.mjs freeze-validate \
  --data-root /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28 \
  --registry /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/registry.json \
  --cases /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/cases.json \
  --key /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/answer-key.json \
  --manifest /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/snapshot-manifest.json \
  --output /home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/validation-prereview.json
```
## Offline validation result

`freeze-validate` completed before any held-out trial and returned `status: INVALID` with `errorCodes: ["MANIFEST"]`. Per the W-107 instruction, pre-review stopped at this failure. No held-out trial, freeze/seal, live canary, source change, test change, or hidden-input modification followed.

The validator receipt is `/home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/validation-prereview.json`.