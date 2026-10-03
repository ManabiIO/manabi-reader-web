# Clean-room implementation handoff manifest

Status: sealed implementation input manifest
Revision: 2026-10-03 feature-discovery pass 3

The implementation worker is authorized to receive exactly the clean-room documents listed below plus ordinary authorized target-repository material.

| Path | Git blob SHA | Purpose |
| --- | --- | --- |
| `CLEAN_ROOM_COMPETITIVE_RESEARCH.md` | `8a54cd241a587c1a3ba4b5d30280c02f55ced45c` | process boundary, evidence rules, taint handling |
| `specs/clean-room-reader-competitive-spec.md` | `3f2b0909fec61669774063cc3305abb81b18a2d3` | behavior, fixtures, acceptance tests, benchmarks |
| `specs/clean-room-reader-adversarial-qualification.md` | `5a12dad34cae1c3632c959c23e49f665d4afbcac` | adversarial, sync, cache, fuzz, soak, cross-engine qualification |
| `specs/clean-room-reader-feature-opportunities.md` | `30d87355d138e808d7952b2b588f22fc9261468c` | optional sanitized feature backlog; not release requirements |

## Scope distinction

The competitive and adversarial specifications contain correctness/release-quality contracts for features already in scope.

The feature-opportunities document is different: its `CR-OPP-*` entries are optional exploration candidates. Their presence in the handoff does not authorize scope expansion in an implementation PR.

A worker should implement a `CR-OPP-*` only when the user or a separately scoped target-side plan explicitly selects it.

## Not authorized

The worker must not receive or request:

- observer dossiers or evidence ledgers;
- named-source provenance;
- external implementation repositories;
- external source code, patches, diffs, comments or source-level identifiers;
- contaminated observation notes;
- copied third-party fixtures or distinctive UI assets.

## Worker startup checklist

Before implementation work:

1. confirm the four blob SHAs above match the checked-out handoff;
2. do not perform external competitor research;
3. inventory current target behavior using only target-owned tests/code plus the sanitized CR requirements;
4. create independently authored fixtures before making competitively motivated production changes;
5. record which CR requirements already pass;
6. fix only failing/incomplete requirements using target-owned design;
7. treat `CR-OPP-*` as backlog unless separately selected;
8. keep benchmark and device evidence separate from unsupported claims.

## Worker completion attestation

An implementation PR should include a statement equivalent to:

> I implemented and qualified the referenced CR requirements using only the sealed clean-room handoff and authorized target-repository material. I did not consult prohibited external implementation material or the observer-side provenance record.

The exact wording may vary, but the substance must be retained.

## Manifest updates

Any change to one of the four authorized documents changes its blob SHA and requires a new manifest revision before a clean implementation handoff.

This manifest itself contains no external source provenance and may be supplied to the implementation worker.
