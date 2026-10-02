# W-107 pretrial manifest clarification

The first actual freeze validation returned INVALID / MANIFEST before any
held-out trial. The validator requires preparation to be an object. Architect
preparation has always emitted a nonempty provenance/status string. The public
handoff described its purpose but omitted its explicit primitive type.
W-107-A1 clarifies nonempty string; no hidden inputs change.

Synthetic reproducer: generate fixture-build inputs, change only manifest
preparation to "Synthetic preparation; not yet independently validated.", and
run freeze-validate. Current result is MANIFEST; A1 requires success when other
checks pass. Reject empty string, object, array, null and omitted preparation.

Other public-contract negative cases from narrow static inspection:
- Repeat an identical anchor within one key case: reject duplicate identity.
- Point one case's anchor at a valid source in another project: reject the
  owning-case/project mismatch even if its quote and hash are valid.
- Mark oversized-document while all cited files have <=4096 code points:
  reject unproved coverage.
- Use three invented project ids consistently throughout otherwise valid
  synthetic data: reject; the evaluation requires the three named projects.
- Use a non-UTC preparedAt accepted by Date.parse: reject under UTC contract.
- Use a snapshotPath containing a/../file or a symlink to an in-root file:
  reject traversal/symlink spelling even when realpath stays contained.
These implement existing public requirements, not broader task semantics.
They are architect contract analysis, not review-gate judgments.

No hidden question/fact/qualification/anchor/source/hash changed. Original
inputs and failed receipt remain in place, unchanged. No data correction
occurred, so no backup replacement was needed. Revalidation requires the
separate builder fix, then an authorized offline operator and a new receipt.

Earlier combined writes/lifecycle action and narrower document-only action
were rejected by automatic approval review under orchestration-only scope;
neither ran. The user subsequently explicitly authorized the separate
architect to amend the specification and the separate builder to fix/test
the validator, with the root remaining orchestration-only.
