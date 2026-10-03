# Clean-room feature approval gate

Status: CLOSED BY DEFAULT
Revision: 2026-10-03

This file is the authorization gate for work derived from the clean-room competitive-reader program.

## Default rule

**No feature, acceptance suite, benchmark-driven fix, fixture suite, or product change is approved for implementation merely because it appears in this branch or PR #260.**

The clean-room documents are research/specification inputs. They are not a standing work order.

Unless an approval is recorded below, a worker may only:

- review and refine the clean-room research/specification documents on this draft branch;
- deduplicate or clarify requirements;
- inspect authorized Manabi target code to identify overlap when the user explicitly asks for review;
- report what would need approval.

Without an approval, a worker must not:

- add CR-derived test fixtures to the product test suite;
- add CR-derived automated/browser/device tests;
- modify product/runtime code;
- implement a `CR-OPP-*` feature;
- open an implementation PR based on this program;
- mark PR #260 ready for review;
- merge or close PR #260 as “finished”;
- infer approval from a previous worker's activity.

## Approval levels

An approval must identify a bounded feature or CR ID set and one of these levels.

### DISCOVERY_ONLY

Default state. Research/spec refinement only. No product/test mutation is authorized.

### APPROVED_FOR_DESIGN

Authorizes only target-side product/design exploration for the named feature/CR IDs, such as:
- target-owned UX flows;
- wire-level behavior descriptions;
- target architecture impact analysis;
- data/privacy decisions;
- acceptance-criteria refinement.

It does **not** authorize adding product fixtures/tests, changing production behavior, or opening an implementation PR.

### APPROVED_FOR_TESTS

Authorizes only independently authored fixtures and tests for the named feature/CR IDs.

It does **not** authorize production behavior changes, even if tests fail.

### APPROVED_FOR_IMPLEMENTATION

Authorizes production changes only for the named feature/CR IDs and only within the stated scope.

It includes the minimum tests needed for that implementation unless the approval explicitly says otherwise.

### APPROVED_FOR_INTEGRATION

Authorizes integration/merge work for the named implementation PR or bounded feature change.

This does not authorize unrelated features.

## What counts as explicit per-feature approval

A valid approval must come from the user/project owner and must unambiguously identify the feature.

Preferred forms:

- `Approve CR-OPP-001 for implementation.`
- `Approve CR-OPP-003 and CR-OPP-149 for design exploration only.`
- `Approve the chapter-preflight feature (CR-OPP-001) for implementation in Manabi Reader Web.`
- `Approve CR-AT-001..006 for tests only; do not change production code.`

A named feature may be accepted without the literal CR ID only when the mapping is unique and the worker records the mapped CR ID before starting.

## What does not count as approval

None of the following authorizes implementation:

- the feature appearing in this branch;
- the feature being marked MUST/SHOULD/MAY;
- the feature being described as high value, strong, important, or a candidate;
- a benchmark or acceptance test failing;
- a prior worker creating research/spec text;
- a prior worker creating PR #260;
- approval of a neighboring or related feature;
- approval of the same feature in another repository/platform;
- generic instructions such as “continue,” “go deeper,” “review,” “refine,” “finish the clean-room work,” or “work through the backlog”;
- a request to investigate or compare a feature;
- an implementation worker deciding that a feature is easy or obviously beneficial.

Approval is non-transitive and non-inferential.

## Approval scope requirements

Each approval record must state:

- approval ID;
- date;
- feature/CR IDs;
- approval level;
- target repository/platform;
- bounded deliverable;
- explicit exclusions or constraints;
- status: active, completed, revoked, or superseded.

If any of those materially affect what can be changed and are unspecified, use the narrowest reasonable interpretation and do not expand scope.

## PR #260 state gate

PR #260 is a **research/specification draft**.

It must remain a GitHub Draft until the user/project owner explicitly authorizes a PR-state transition referring to PR #260 or this clean-room research PR.

Per-feature implementation approvals do **not** implicitly authorize marking PR #260 ready, merging it, or declaring the overall program complete.

Examples of valid PR-state authorization:

- `Mark PR #260 ready for review.`
- `Merge PR #260.`
- `Finalize the clean-room research PR.`

Absent such an instruction, future workers must preserve Draft state.

## Active approvals

**None.**

Therefore, at this revision:

- no `CR-OPP-*` feature is approved for tests or implementation;
- no correctness/acceptance suite is approved for target-code mutation under this program;
- no implementation PR is authorized;
- PR #260 is not authorized to leave Draft state.

## Recording a future approval

Append a record in this format:

```text
Approval ID: CR-AUTH-001
Date: YYYY-MM-DD
Feature/CR IDs: ...
Level: APPROVED_FOR_DESIGN | APPROVED_FOR_TESTS | APPROVED_FOR_IMPLEMENTATION | APPROVED_FOR_INTEGRATION
Target: ...
Deliverable: ...
Exclusions: ...
Status: active
Evidence of approval: concise paraphrase of the explicit user/project-owner instruction
```

Do not include competitor provenance in an approval record.

## Revocation and completion

The user/project owner may revoke or narrow approval at any time.

When a bounded approved feature is completed, mark that approval record completed. Completion does not authorize the next feature.

A new feature requires a new explicit approval.


## Approval validation checklist

Before target-side work, a worker must validate all of the following:

1. the approval record exists in this file;
2. its status is active;
3. the requested CR ID/feature is explicitly covered;
4. the requested action is permitted by the approval level;
5. the target repository/platform matches;
6. the requested deliverable fits the bounded deliverable text;
7. no exclusion forbids the requested change;
8. the approval has not been superseded by a narrower/later record.

If any check fails, target-side work is not authorized.

## Per-feature scope packet

Before starting an approved feature, the worker should state a compact scope packet in its implementation PR or working notes:

- Approval ID
- CR IDs
- target repo/platform
- existing target primitive(s) reused
- user-visible behavior being changed
- data/storage migrations, if any
- privacy/network effect, if any
- test/benchmark IDs in scope
- explicit non-goals
- adjacent CR IDs discovered but not approved

The scope packet is derived only from the sanitized handoff plus authorized target code.

## Minimal shared-primitive rule

An approved feature may require a shared target-owned primitive.

That does not create authority to implement other features that could also use the primitive.

A worker may add/refine a shared primitive only when all of these are true:

- it is necessary for the approved behavior;
- its API/scope is the minimum coherent target-owned abstraction needed;
- it does not expose unrelated new user-visible features;
- it does not pre-implement unapproved feature-specific behavior;
- its tests are limited to the primitive's contract and the approved feature;
- adjacent opportunities are recorded for later approval rather than bundled in.

A broad refactor justified mainly by future unapproved CR-OPP entries requires separate approval.

## No batch approval by implication

Even if several CR entries share one subsystem, approval remains per named feature/suite.

For example, approval of one audio mode does not authorize every `CR-OPP-070..` media feature; approval of one OCR feature does not authorize the entire OCR opportunity section.

A user/project owner may explicitly approve a bounded bundle, but the bundle must be named or enumerated. Workers may not construct the bundle themselves.


## Approval-ledger mutation rule

Workers are not authorized to create, broaden, reactivate, or upgrade an approval record on their own.

An approval record may be added or changed to `active` only when the current user/project-owner instruction explicitly grants that approval.

A worker must not mutate this ledger merely because:

- a task was assigned by another worker;
- an issue/PR says a feature should be implemented;
- a project document recommends the feature;
- CI/test output suggests a fix;
- a previous assistant claimed approval existed;
- the feature appears in an implementation branch;
- the worker believes approval is implied.

When recording a new approval, the worker must be able to point to the explicit owner instruction in the current conversational/task context. If that evidence is absent, leave the ledger unchanged and report that approval is missing.

A worker may update an existing record to `completed`, `revoked`, or `superseded` only when:
- the bounded approved work has actually completed; or
- the user/project owner explicitly revokes/supersedes it.

Completion may never broaden scope.

## Approval precedence

When approval records overlap:

1. explicit revocation wins over earlier approval;
2. a later narrower approval constrains an earlier broader one when it says it supersedes it;
3. explicit exclusions win over general deliverable language;
4. repository/platform-specific scope wins over generic scope;
5. the lower work level wins when ambiguity remains.

If precedence cannot be resolved deterministically, stop and request explicit owner clarification before target-side work.

## Prerequisite and bug-fix boundary

An approved feature may expose an unrelated bug, missing prerequisite, migration, refactor opportunity, or infrastructure weakness.

The worker may fix it under the existing approval only when the change is both:

- necessary to deliver the approved user-visible behavior safely; and
- the smallest coherent change that does not add unrelated user-visible capability.

Otherwise it requires separate approval.

In particular, these are not automatic scope:
- broad cleanup/refactoring;
- framework migrations;
- “while here” performance work;
- unrelated accessibility fixes;
- unrelated security hardening;
- new telemetry/analytics;
- new data migrations for future features;
- generalized provider abstractions primarily justified by unapproved future work.

If a severe unrelated security/data-loss issue is discovered, report it immediately and follow the repository's normal emergency process; do not use the clean-room feature approval as implied authorization.

## Design-to-implementation handoff

An `APPROVED_FOR_DESIGN` result may recommend implementation, tests, or a changed architecture. That recommendation is not an approval upgrade.

The worker must stop after the approved design deliverable and obtain a new approval level before target fixtures/tests or production changes.
