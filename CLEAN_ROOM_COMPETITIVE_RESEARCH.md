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

The implementer receives only the sanitized specification and this policy. The implementer may inspect and modify Manabi-owned or otherwise authorized target code as needed, subject to the repository's existing licensing boundaries.

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
