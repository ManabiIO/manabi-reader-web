# Competitive clean-room research protocol

Status: implementation-side policy.

This repository may accept independently implemented features that are informed by observable product behavior. Competitive research must use a strict observer/implementer split whenever the observed product contains GPL or other source that is not authorized for reuse in Manabi-owned code.

## Roles

### Observer

The observer may inspect only public user-facing material:

- README files and end-user documentation
- changelogs and release notes
- store listings, screenshots, and demo videos
- public issues or feature requests, limited to the described user-visible behavior
- ordinary black-box behavior of released applications and hosted demos

The observer must not copy, summarize, transform, or transmit competitor source code, source-level identifiers, comments, patches, diffs, decompilation, binary inspection, or implementation explanations.

If a public issue or release page contains code or a patch, the observer records only the externally stated input, user action, and visible result. The code or implementation discussion is ignored.

### Sanitizer

The sanitizer converts observer evidence into an independently written product contract. The contract may contain:

- capabilities
- user journeys
- state transitions
- independently authored sample inputs
- visible expected outputs
- edge-case classes
- externally measurable performance budgets
- accessibility requirements
- acceptance tests

The contract must not contain competitor names as provenance for individual requirements, source links, quotations from release notes, source symbols, source file names, comments, patches, diffs, or descriptions of how another product implements the behavior.

### Implementer

The implementer receives only the sanitized specification, this policy, the approval gate, and authorized target-repository material.

**Receipt of the clean-room handoff is not authorization to implement anything.** Before creating fixtures/tests or modifying target product code, the implementer must read `CLEAN_ROOM_APPROVALS.md` and confirm that the exact feature/CR IDs and requested work level are actively approved.

An implementer may inspect and modify Manabi-owned or otherwise authorized target code only within an active approval, subject to the repository's existing licensing boundaries.

The implementer must not:

- open the observer dossier
- browse competitor repositories
- search competitor source
- read competitor patches or source-bearing PRs/issues
- use source symbols, comments, or implementation descriptions from a competitor
- mechanically reproduce a competitor's UI assets or copyrighted expression

If the specification is insufficient, the implementer must ask for a behavior-level clarification. A clarification must be answered by the observer/sanitizer without exposing source-derived material.

## Separation

Named source provenance and observation notes are stored outside this implementation branch. This branch intentionally contains only implementation-side policy plus the sanitized specification.

The observer record is not an implementation dependency and must not be copied into this repository, linked from implementation comments, or attached to implementation issues.

## Acceptance evidence

An implementation PR derived from this program should record:

1. the sanitized spec revision used;
2. which acceptance-test IDs are implemented or already satisfied;
3. externally observable before/after behavior;
4. benchmark results using the specification's reference workloads;
5. an implementer attestation that no prohibited competitor implementation material was consulted.

The attestation is process evidence, not a claim that automation can prove copyright provenance.

## Existing third-party boundaries

This protocol does not replace the repository's existing license notices, contribution provenance rules, or dictionary-provider boundary. Third-party components already present in the target remain governed by their own licenses and repository policy.

This document defines the additional separation required for competitive behavior research.


## Evidence classification

Observer notes must distinguish how a behavior was learned:

- **documented** — explicitly stated in public end-user documentation, store copy, or release notes;
- **reported** — described by a user or maintainer as externally visible behavior in a public issue;
- **observed** — reproduced through ordinary black-box use of a released build or hosted product;
- **inconclusive** — attempted but not reliably reproducible or blocked by environment/device/account requirements.

A documented or reported behavior must never be rewritten as “observed” unless a black-box run actually reproduced it.

The sanitizer may promote an edge case into an acceptance requirement even when it is only documented/reported, but the implementation contract must describe the independently chosen desired behavior rather than claiming the external product actually demonstrated it.

## Screenshot and video rule

Screenshots and demo videos may be used by the observer to understand:

- available controls;
- user-visible state transitions;
- information hierarchy;
- interaction sequence;
- error/empty/loading states;
- responsive or device-specific behavior.

They must not be used to reproduce distinctive visual expression. The sanitizer must translate screenshot evidence into functional requirements and generic usability constraints, not pixel dimensions, proprietary icons, exact copy, distinctive animation choreography, artwork, or a copied menu hierarchy.

An implementation should follow the target product's own design system even when the behavior was prompted by screenshot evidence.

## Black-box test boundary

Ordinary-user testing may exercise public controls and inputs, create synthetic content, record externally visible output, and measure wall-clock latency.

The observer must not use:

- decompilation or package extraction;
- debugger or symbol inspection;
- source maps intended for development rather than ordinary users;
- private/internal APIs discovered by reverse engineering;
- DOM/source inspection whose purpose is to reveal implementation rather than verify visible semantics;
- network interception to infer private internal protocols.

Publicly documented interoperability APIs may be tested as APIs, but their request/response contract must be recorded separately from any client implementation.

## Observation record minimum fields

Each observer record should contain:

1. evidence ID;
2. product/build/version when known;
3. platform/browser/device;
4. evidence class;
5. public source or black-box preconditions;
6. user-visible input;
7. user action;
8. visible output;
9. uncertainty/limitations;
10. sanitized acceptance-family IDs, if any.

Implementation workers must not receive this record.

## Taint handling

If prohibited implementation material is accidentally exposed to an observer note:

1. mark that note contaminated;
2. do not sanitize from it;
3. independently reacquire the behavior from an allowed user-facing source or black-box run;
4. create a new observation record without copying language from the contaminated note;
5. only then derive or restore the sanitized acceptance requirement.

If an implementer is exposed to prohibited competitor implementation material for a feature, that worker must not continue as the clean-room implementer for that feature. Preserve target-side work only if its independent provenance can be established by project owners/review.

## Clarification firewall

Implementer questions must reference sanitized requirement IDs and ask only about desired observable behavior, for example:

- “For CR-AT-104, should punctuation remain part of sentence context?”
- “For CR-SYNC-006, should a same-revision conflict prefer local, remote, or explicit user choice?”

The observer/sanitizer response must not name the motivating competitor or explain its mechanism. It should answer with a target-owned behavioral decision or state that the requirement remains unspecified.

## Similarity review

Before merging a competitively motivated UI change, reviewers should separately check:

- the functional requirement is traceable to the sanitized contract;
- wording is target-authored;
- visual treatment follows the target design system;
- icons/artwork are target-owned or properly licensed;
- control grouping is justified by target workflows rather than copied arrangement;
- test fixtures and example content are independently authored.

Clean-room process protects implementation provenance; it is not permission to copy protected visual expression.


## Authorization is separate from specification severity

Normative words in the sanitized specifications describe desired behavior **if and when that feature or qualification scope is approved**.

They do not authorize work:

- MUST does not mean “implement now”;
- a failing acceptance test does not authorize a fix;
- a benchmark target does not authorize optimization work;
- an optional opportunity does not authorize a prototype;
- a feature being already partially present does not authorize completion.

`CLEAN_ROOM_APPROVALS.md` is the sole branch-local record of approval state for this program. When it says no active approvals, no target test or product mutation is authorized by these clean-room documents.

## Research PR state

PR #260 is a research/specification draft. Research/spec refinement may continue when explicitly requested, but workers must preserve Draft state unless the user/project owner explicitly authorizes changing PR #260 to ready, merging it, or otherwise finalizing it.

Per-feature approval is not PR-finalization approval, and PR-finalization approval is not per-feature implementation approval.
