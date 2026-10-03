# Clean-room implementation handoff manifest

Status: SEALED RESEARCH HANDOFF — NO ACTIVE IMPLEMENTATION APPROVALS
Revision: 2026-10-03 approval-gated refinement 3

PR #260 is a research/specification Draft. This manifest identifies clean documents a future worker may read. **It does not authorize that worker to design, implement, test, prototype, integrate, mark ready, merge, or finish any feature.**

## Approval gate comes first

Before doing any CR-derived target work, read:

| Path | Git blob SHA | Purpose |
| --- | --- | --- |
| `CLEAN_ROOM_APPROVALS.md` | `233c10acda33879c36b829d23b8492ac7de1f413` | explicit per-feature/work-level authorization ledger |

At this revision, `CLEAN_ROOM_APPROVALS.md` states **Active approvals: None** and records **no delegated approval authority**.

Therefore no target design, fixtures/tests, production changes, implementation PRs, integration, or PR #260 finalization are authorized by this clean-room program.

## Sanitized research inputs

Subject to the approval gate above, a future worker may receive these documents plus ordinary authorized target-repository material:

| Path | Git blob SHA | Purpose |
| --- | --- | --- |
| `CLEAN_ROOM_COMPETITIVE_RESEARCH.md` | `6cb64cd45478906d3648860945b33c35f75e450d` | process boundary, evidence rules, taint handling, authorization separation |
| `specs/clean-room-reader-competitive-spec.md` | `fd1269b0426ce7b526a99f985c15b4192634fcdd` | behavior contracts, fixtures, acceptance tests, benchmarks |
| `specs/clean-room-reader-adversarial-qualification.md` | `b4249481022cb010cfcee89d5263c3766201208b` | adversarial, sync, cache, fuzz, soak, cross-engine qualification |
| `specs/clean-room-reader-feature-opportunities.md` | `61383888e92c7d56959ed70d71d8a54230c60be8` | DISCOVERY_ONLY optional feature registry |

Research reviewers may also use:

| Path | Git blob SHA | Purpose |
| --- | --- | --- |
| `CLEAN_ROOM_REVIEW.md` | `6066bbcd69a9512b57a58d232156140fc0deef3e` | research-only consistency/review checklist |

The review checklist is not an implementation authority or approval source.

## Default worker authority

With no active approval, a worker may only do research/specification work that the user explicitly requests on this draft branch, such as:

- review wording;
- deduplicate requirements;
- identify target-side overlap;
- refine acceptance criteria;
- audit approval/manifest consistency;
- report which feature/CR IDs would need approval.

The worker must not create target design deliverables, fixtures/tests, or modify product/runtime code from these documents.

## Approval levels

Only `CLEAN_ROOM_APPROVALS.md` defines authority. Current levels are:

- `DISCOVERY_ONLY`
- `APPROVED_FOR_DESIGN`
- `APPROVED_FOR_TESTS`
- `APPROVED_FOR_IMPLEMENTATION`
- `APPROVED_FOR_INTEGRATION`

A higher level is not inferred from a lower one. Design does not authorize tests; tests do not authorize production fixes; implementation does not authorize integration.

## Per-feature approval rule

A target-side action requires an active approval that names:

- the feature/CR IDs;
- approval level;
- target repository/platform;
- bounded deliverable;
- approval basis/spec revision or equivalent explicit scope;
- exclusions/constraints.

Approval is non-transitive and cannot be self-created by a worker.

In particular:

- `CR-OPP-*` remains DISCOVERY_ONLY until individually selected;
- MUST/SHOULD language is not authorization;
- a failing test/benchmark is not authorization;
- approval of tests is not approval of fixes;
- approval of one feature is not approval of an adjacent feature;
- approval on one platform is not approval on another;
- a generic instruction such as “continue,” “go deeper,” “review,” “refine,” “finish,” or “work through the backlog” is not per-feature implementation approval;
- a later material spec expansion is not automatically covered by an older approval.

## PR #260 state gate

PR #260 must remain a GitHub Draft unless the user/project owner explicitly authorizes a PR-state transition referring to PR #260 or this clean-room research PR.

Per-feature approvals do not imply permission to:

- mark PR #260 ready for review;
- merge PR #260;
- close it as completed;
- declare the overall clean-room program finished.

Likewise, permission to finalize PR #260 would not by itself authorize any product feature implementation.

## Not authorized

The worker must not receive or request:

- observer dossiers or evidence ledgers;
- named-source provenance;
- external implementation repositories;
- external source code, patches, diffs, comments or source-level identifiers;
- contaminated observation notes;
- copied third-party fixtures or distinctive UI assets.

The worker must not independently research the external products that motivated the sanitized requirements.

## Worker startup checklist

Before any target-side work:

1. verify the approval-ledger blob SHA and read it;
2. verify the sanitized research blob SHAs above;
3. confirm an active approval exactly covers the requested CR IDs and work level;
4. verify that the approval basis still matches the current relevant spec revision/scope;
5. if no matching approval exists, stop target-side execution and report the required approval;
6. do not perform external competitor research;
7. inspect current target-owned architecture for overlap only within the user's requested review/approved scope;
8. preserve existing working primitives rather than rebuilding them to resemble another product.

## Approved-work execution

Only after a matching approval exists:

1. restate the approval ID, CR IDs, work level, target, approval basis, deliverable and exclusions;
2. if approved for design, stop after the bounded design deliverable;
3. if approved for tests, create only independently authored fixtures/tests and stop at reported failures;
4. if approved for implementation, make only the bounded target-owned changes needed for the approved IDs;
5. if adjacent unapproved work is discovered, report it rather than “finishing it while here”;
6. obey the minimal-shared-primitive rule in the approval ledger;
7. run only qualification/benchmark/device work included in approval;
8. mark the approval record completed when the bounded work is done.

## Worker completion attestation

An implementation PR for an approved feature should include a statement equivalent to:

> I implemented and qualified only the approved CR scope using the sealed clean-room handoff and authorized target-repository material. I did not consult prohibited external implementation material or the observer-side provenance record, and I did not expand into unapproved adjacent features.

## Manifest updates

Any change to the approval ledger, research-review checklist, or one of the four sanitized research documents changes its blob SHA and requires a new manifest revision before handoff.

A stale manifest is invalid for clean implementation handoff.

This manifest itself contains no external source provenance and may be supplied to a future worker.
