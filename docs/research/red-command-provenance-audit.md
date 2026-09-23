| Log | Offending path |
|---|---|
| W-020/09 | `/tmp/claude-1000/w020-b0911/behaviour9.mts` |
| W-020/10 | `/tmp/claude-1000/w020-b0911/behaviour10.mts` |
| W-020/11 | `/tmp/claude-1000/w020-b0911/behaviour11.mts` |
| W-020/13 | `/tmp/claude-1000/w020-b13-ready-spec-repro.mjs` |
| W-020/14 | `/tmp/claude-1000/w020-b14-review-evidence-repro.mjs` |
| W-020/15 | `/tmp/claude-1000/w020-b15-review-fail-done-repro.mjs` |
| W-020/16 | `/tmp/claude-1000/w020-b16/repro.mts` |
| W-028/18 | `/tmp/claude-1000/red-b18.mjs` |
| W-028/19 | `/tmp/claude-1000/red-b19.mjs` |
| W-028/21 | `/tmp/claude-1000/red-b21.mjs` |
| W-036/02 | `/tmp/claude-1000/w036-behaviour2-red-assert.mjs`; `/tmp/claude-1000/w036-ee3BXt` |
| W-042/02 | `/tmp/claude-1000/-home-edckt-projects-bisellium/54cefaf8-a6df-46b5-9f84-fcbde1e23b2f/scratchpad/w042-mutants.sh` |

The claimed set in [W-042 round-2 review](/home/edckt/projects/bisellium/studio/ci/W-042-review-2.log:75) is exact: no missed instances and no wrongly included logs. W-036/02 is one log with two external operands.

## Draft lesson body

Filed by `bisellium retro --cascade <n>`. Twelve red logs across W-020, W-028, W-036, and W-042 record `# command:` headers that invoke session-only `/tmp` scripts or worktrees rather than repository-held commands. The class recurred across four opera, so a red may be genuine but cannot be rerun from a clean repository; reviewers must reconstruct or trust vanished scratch work, adding review cost and weakening the evidence contract. An advisory now flags a command header that names a path outside the repository.

## Suggested check rule

- `id`: `opus.red_command_repo_path`
- `level`: `advise`
- `scope`: `ci/reds/*/*.log`
- Shape: extract `^# command: ` headers; tokenize absolute and `~/` path operands; resolve them lexically against `--repo`; advise with the log and operand when the resolved path lies outside the repository. This catches `/tmp`, scratchpads, and future absolute non-repo paths without hard-coding a temp directory.
tokens used
43,919
## Audit result

All 145 red-log command headers were classified: 133 are repo-runnable; 12 are not.

| Log | Offending path |
|---|---|
| W-020/09 | `/tmp/claude-1000/w020-b0911/behaviour9.mts` |
| W-020/10 | `/tmp/claude-1000/w020-b0911/behaviour10.mts` |
| W-020/11 | `/tmp/claude-1000/w020-b0911/behaviour11.mts` |
| W-020/13 | `/tmp/claude-1000/w020-b13-ready-spec-repro.mjs` |
| W-020/14 | `/tmp/claude-1000/w020-b14-review-evidence-repro.mjs` |
| W-020/15 | `/tmp/claude-1000/w020-b15-review-fail-done-repro.mjs` |
| W-020/16 | `/tmp/claude-1000/w020-b16/repro.mts` |
| W-028/18 | `/tmp/claude-1000/red-b18.mjs` |
| W-028/19 | `/tmp/claude-1000/red-b19.mjs` |
| W-028/21 | `/tmp/claude-1000/red-b21.mjs` |
| W-036/02 | `/tmp/claude-1000/w036-behaviour2-red-assert.mjs`; `/tmp/claude-1000/w036-ee3BXt` |
| W-042/02 | `/tmp/claude-1000/-home-edckt-projects-bisellium/54cefaf8-a6df-46b5-9f84-fcbde1e23b2f/scratchpad/w042-mutants.sh` |

The claimed set in [W-042 round-2 review](/home/edckt/projects/bisellium/studio/ci/W-042-review-2.log:75) is exact: no missed instances and no wrongly included logs. W-036/02 is one log with two external operands.

## Draft lesson body

Filed by `bisellium retro --cascade <n>`. Twelve red logs across W-020, W-028, W-036, and W-042 record `# command:` headers that invoke session-only `/tmp` scripts or worktrees rather than repository-held commands. The class recurred across four opera, so a red may be genuine but cannot be rerun from a clean repository; reviewers must reconstruct or trust vanished scratch work, adding review cost and weakening the evidence contract. An advisory now flags a command header that names a path outside the repository.

## Suggested check rule

- `id`: `opus.red_command_repo_path`
- `level`: `advise`
- `scope`: `ci/reds/*/*.log`
- Shape: extract `^# command: ` headers; tokenize absolute and `~/` path operands; resolve them lexically against `--repo`; advise with the log and operand when the resolved path lies outside the repository. This catches `/tmp`, scratchpads, and future absolute non-repo paths without hard-coding a temp directory.

