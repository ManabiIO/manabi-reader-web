# Clean-room research PR review checklist

Status: research-review aid only
Revision: 2026-10-03

This checklist is for reviewing PR #260 as a research/specification artifact.

It is not an implementation plan, approval record, or completion signal.

## 1. GitHub state

Verify:

- PR #260 is open;
- PR #260 is still GitHub Draft;
- title visibly identifies it as Draft/research/per-feature approval gated;
- no auto-merge is enabled;
- no implementation work is being represented as part of this PR;
- no reviewer/worker has marked it ready merely because research documents are coherent.

If Draft state changed without explicit project-owner authorization referring to PR #260, restore Draft state before further research refinement.

## 2. Approval gate

Read `CLEAN_ROOM_APPROVALS.md` before interpreting any CR document.

Verify:

- active approvals are exactly what explicit owner instructions support;
- workers have not self-created/broadened approval;
- approval levels match the allowed deliverable;
- approval basis still matches the current relevant spec revision/scope;
- completed/revoked/superseded records cannot be reused as active authority;
- no implicit delegation exists.

When Active approvals is None, no CR-derived target tests, fixtures, product changes, implementation PRs, or integration are authorized.

## 3. Separation of authority and quality language

Check that:

- MUST/SHOULD/MAY only express quality inside approved scope;
- failed tests do not imply permission to fix;
- benchmarks do not imply optimization authority;
- a feature being easy/high-value does not imply approval;
- an opportunity being detailed does not imply priority;
- optional opportunity entries remain DISCOVERY_ONLY.

Search for newly added wording that could accidentally read like:
- “implement next”;
- “worker should now build”;
- “finish these phases”;
- “release blocker” without approval context;
- “strong candidates” as implied queue;
- “all remaining work”.

Repair ambiguous authority language before expanding the research.

## 4. Per-feature boundary

For any active approval, verify:

- exact CR IDs or uniquely mapped named feature;
- approval level;
- target repository/platform;
- bounded deliverable;
- approval basis/spec revision;
- exclusions;
- status.

Check that adjacent work is listed as unapproved rather than bundled.

Check the minimal-shared-primitive rule:
- required for approved behavior;
- minimum coherent abstraction;
- no unrelated user-visible capability;
- no speculative preimplementation;
- no broad future-facing refactor hidden inside the approved change.

## 5. Observer / implementer firewall

Implementation-side files must contain no named-source provenance.

Verify:
- no motivating product/vendor names;
- no external source URLs;
- no external GitHub links;
- no copied screenshots/assets;
- no source symbols/file paths from competitors;
- no implementation descriptions from external projects;
- no observer evidence IDs that reveal named provenance.

The observer dossier/evidence ledger must remain outside the implementation repository.

A clean implementation worker must not receive those observer artifacts.

## 6. Evidence hygiene

Observer-side review should distinguish:

- documented;
- reported;
- observed;
- inconclusive.

Do not promote release-note or issue claims into black-box observations.

If prohibited material contaminated an observation:
- quarantine it;
- reacquire from allowed behavior/user-facing evidence;
- sanitize from the new clean observation only.

## 7. CR namespace integrity

For the three CR specification files:

- every CR definition heading is unique;
- references may repeat IDs, but definitions must not;
- intentional numeric gaps are acceptable;
- counts in PR prose must describe actual entries accurately;
- adding/splitting/merging CR IDs must not silently change approval scope.

The opportunity registry currently uses topical numeric bands, so the largest CR-OPP number is not the number of entries.

## 8. Target overlap

Before calling an opportunity “new,” inspect authorized target-owned architecture.

Classify it as:

1. already satisfied;
2. qualification/test gap;
3. UX exposure of existing primitive;
4. bounded extension of existing primitive;
5. genuinely new primitive.

Do not create a second implementation of an existing target primitive to mirror external products.

Keep overlap notes target-side and source-clean.

## 9. Opportunity backlog quality

Each CR-OPP should:

- describe user value;
- remain implementation-neutral;
- state important privacy/durability constraints;
- avoid distinctive copied UI wording;
- avoid bundling several unrelated features into one approval unit;
- be separable enough for per-feature approval;
- identify when it is an extension of existing target architecture.

If two opportunities cannot realistically be approved independently, consider merging or explicitly declaring their dependency.

## 10. Correctness-spec quality

Acceptance requirements should be:

- externally observable;
- deterministic where practical;
- independent of competitor implementation;
- testable with project-owned fixtures;
- explicit about optional/platform-specific behavior;
- careful about Unicode and semantic-vs-visual boundaries;
- explicit about cancellation/stale async state;
- explicit about destructive/sync conflict behavior.

Avoid turning one product's historical bug wording into a permanent target requirement unless the desired behavior independently makes sense for Manabi.

## 11. Benchmark quality

Benchmark targets should:

- measure the product boundary;
- state environment/fixture;
- separate cold/warm;
- report median/p95/max where appropriate;
- avoid pretending one machine threshold is universal;
- distinguish provider/network latency from local application latency;
- never create approval to optimize merely because a threshold is missed.

## 12. Data, privacy, and migration review

For any opportunity/spec change involving data:

- identify durable vs derived state;
- define deletion semantics;
- define account/profile scope;
- define exportability where relevant;
- identify network processing;
- define migration/backward compatibility implications;
- avoid making a derived cache authoritative.

Any material new privacy/network/migration implication invalidates prior approval unless already included in its bounded scope.

## 13. Platform review

Do not treat:
- browser emulation as physical-device qualification;
- web approval as Android approval;
- Android approval as iOS approval;
- desktop input assumptions as touch/controller behavior.

Platform expansion requires explicit scope.

## 14. Research-PR shape

PR #260 should remain research/specification only.

If product code, target test fixtures, implementation workflows, generated binary assets, or feature-specific runtime changes appear in this PR, treat that as a scope violation unless the project owner explicitly re-scoped PR #260 itself.

Prefer separate approved implementation PRs for target changes.

## 15. Handoff manifest

After any authorized research-document change:

1. recompute/fetch changed Git blob SHAs;
2. update `CLEAN_ROOM_HANDOFF.md`;
3. verify the approval-ledger SHA first;
4. verify sanitized research hashes;
5. rerun contamination checks;
6. update the pinned handoff PR comment.

A stale manifest must not be used for implementation handoff.

## 16. PR description / handoff comment

Verify they state:

- Draft;
- Active approvals;
- no implied implementation authority;
- per-feature approval requirement;
- exact current manifest/approved input identity;
- opportunity count accurately;
- no competitor provenance;
- no product code changes;
- adjacent work stop rule.

Old handoff comments should be superseded rather than leaving conflicting current instructions.

## 17. No-finish rule

Research refinement has no autonomous “complete the whole backlog” step.

A future worker may finish only the bounded research task explicitly requested in its turn.

It must not:

- decide that PR #260 is mature enough to leave Draft;
- implement the backlog to make the PR “complete”;
- mark every CR as handled;
- merge because the checklist passes;
- convert research recommendations into a roadmap without explicit owner direction.

A passing review means only that the research artifact is internally consistent at that revision.

## 18. Review record template

For a research review, record:

- PR head SHA:
- GitHub Draft status:
- approval-ledger SHA:
- active approvals:
- handoff-manifest SHA:
- CR definition duplicate check:
- contamination scan:
- target-overlap changes:
- authority-language findings:
- stale-hash findings:
- research-only file-shape check:
- corrections made:
- unresolved questions:
- result: CONSISTENT / NEEDS_REFINEMENT

Do not use PASS/READY/MERGE language for the overall PR.
