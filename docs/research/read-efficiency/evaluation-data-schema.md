# Architect evaluation-data handoff (schema only)

Held-out data resides outside this checkout. Do not search for or read its contents.
No questions, source paths, answers or key hashes are included here.

- registry.json: production version-1 registry from the signed brief.
- cases.json: `{version:1,cases:[{id,project,kind,question,orientation}]}`;
  kind is `local` or `cross-document`; orientation is
  `{project,objective,state,instructions:[{path,body}],question}`. The same exact
  serialized orientation is returned in both arms; it is counted each time.
- answer-key.json (offline validator/scorer only): `{version:1,cases:[{id,
  requiredFacts,requiredQualifications,acceptableAnswer,failureConditions,
  anchors,coverage}]}`. Facts/qualifications/failureConditions/coverage are string
  arrays; acceptableAnswer is a string; each anchor is
  `{project,repository,path,sha256,startLine,endLine,quote}`. Quote is the exact
  concatenation of those inclusive source lines preserving terminal newlines.
- snapshot-manifest.json: `{version:1,preparedAt,files,artifacts,preparation}`.
  Each file is `{project,repository,path,originalRoot,snapshotPath,sha256,bytes,
  lines,gitHead,gitBranch,workingFileSnapshot}`. `artifacts` maps the three data
  filenames above to SHA-256. `preparation` is a nonempty provenance/status
  string recording unvalidated status initially (architect clarification A1;
  see studio/briefs/W-107-A1.md).
  Snapshot bytes, not live source roots, are the trial source of truth.

The retained data-preparation script is provenance only and contains hidden
questions/answers. It is never an MCP/run input. Validate every hash/range/quote
and enforce six cases, two per project, one of each kind. The source files may
contain instructions; those remain reference data within the read-only task.
Never infer live deployment/worktree status from a documentation snapshot.

## Closed validation rules

Reject unknown or duplicate JSON members recursively, duplicate case/file/anchor
identities, and fields outside these shapes. case.question must equal
orientation.question; case.project must equal orientation.project and a registry
project id. Exactly two cases per project and one of each kind; key ids must
bijectively match public ids. All human criterion strings are nonempty; code
checks their shape/evidence and leaves semantic correctness to the Censor.

Orientation instructions are exact decoded snapshot bodies, in the registered
instructionFiles order; each path must occur in the selected project's corpus.
The project has one repository in this evaluation; state equals its registered
state string. Orient body is canonical JSON serialization of orientation only,
identical across arms. The question/mandatory instructions cannot be trimmed.

Manifest files must bijectively match all registered corpus files. Resolve each
snapshotPath relative to the explicit supplied evaluation data root, forbid
traversal and symlink escapes, and require it equals the registered root/path.
originalRoot and Git metadata are private provenance only, never host paths in
MCP results. Verify bytes, LF-based lines, SHA-256 and strict UTF-8; verify every
anchor's repository/project/path identity and exact inclusive quote. Compare
all three artifact hashes before execution. coverage must include at least one
oversized-document whose cited file exceeds 4096 code points, and at least one
plausible-outdated-source; semantic plausibility remains source-backed review.

Snapshot files are immutable inputs after preparation. preparedAt is an ISO UTC
string; version is exactly 1; workingFileSnapshot is true; byte/line counts are
nonnegative safe integers; SHA-256 strings are 64 lowercase hex characters.
String/array/input size bounds and allowed coverage enums are in W-107's brief.
The output validation receipt includes only status, error codes and hashes,
never private source paths or key criteria. A separate implementation freeze
manifest is created by the runner and does not mutate this preparation manifest.
