# Ordinal-1 retry evidence limitation

Recorded during closeout on 2026-09-29, after all twelve runs. This is a retrospective incident note, not an original failure receipt or independent verification of the retry.

Terra final prereview found that commands.txt records only one ordinal-1 RUN/AUDIT and no ENOENT failure/retry entry. The executing clerk confirms no contemporaneous raw file or failure receipt was persisted. The clerk supplied the following as recovery from its session tool output; no original tool-call identifier was supplied and the producer has not independently recovered the underlying tool event:

```
Error: ENOENT: no such file or directory, mkdir '/home/edckt/projects/bisellium/docs/research/read-efficiency-evaluation-2026-09-28/run-v1-2026-09-29/runs/01'
    at mkdirSync (node:fs:1334:26)
    at runArm (file:///home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/read-efficiency/targeted-read-eval.mjs:1497:3)
    at file:///home/edckt/projects/bisellium/.worktrees/maps-lookup-experiment/docs/research/read-efficiency/targeted-read-eval.mjs:1771:41
```

The clerk reports that the failed invocation used the recorded B8 baseline ordinal-1 command, and that creating the runs parent allowed the identical frozen command to complete. The historical identity of those invocations is not independently established by retained failure files. Do not promote this narrative into contemporaneous proof.

All twelve retained completed runs have VALID audits. Neither their source-response measurements nor semantic answers have been altered. The sole censor receives this limitation alongside the raw evidence and determines its effect on the agreed evidence gate. No new trials, changed inputs, fabricated receipts, or post-result implementation tuning are authorized by this incident note.
