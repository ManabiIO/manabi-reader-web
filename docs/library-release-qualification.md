# Enabled Library safety belongs to release qualification

This follow-up starts from Reader #57 at
`3f5a9568d6cf71de9c98b784cb3c1daa59ec64a9`, retaining the current identity,
ownership and deletion fixes. It does not modify the parent branch or enable
any renderer or production deployment.

The backend and notifier require exact-main static Reader, Appearance and Books
Library workflow results. The separate Local Library and Shared TTU workflows
are PR-only. Passing those on a feature/merge ref therefore did not qualify the
final main revision for their enabled data-safety behavior.

Books Library now runs their existing safety suites unconditionally, using its
already-built application, dependency installation and Chromium/WebKit engines:

- Local Library features, review, refinement, lifecycle and deletion in both
  Chromium and WebKit, plus the two focused Chromium Library open/Back cases.
- The explicit Shared TTU round-trip and safety suites, and integrated sharing
  UI in Chromium. Shared filesystem harnesses are not relabeled as WebKit tests.

The original standalone PR workflows remain available. No extra publisher,
workflow admission name, main-push rebuild or deployment handshake is needed.
The required job's timeout accommodates the additional suites; individual test
assertions and timeouts are unchanged. A failure behind tee exits nonzero, and
always-uploaded per-suite/per-engine evidence is retained. Cancellation, missing
checks and failed jobs cannot qualify through an older successful result.

`tests/unit/library-release-qualification.test.mjs` executes the actual added
shell block with command doubles in a disposable directory. It checks all six
invocations, each invocation's failure path, source-mutation rejection, and the
current standalone suite lists. These are workflow contract tests, not browser
passes. The existing seven notifier/static gate tests remain unchanged.

## Separate unresolved browser evidence

The parent has a current WebKit Editor's Picks no-page-errors failure in Books
Library, and earlier WebKit OPDS/background-navigation and Foliate readiness
failures remain undiagnosed. Passing on a later revision without a corresponding
repair does not establish their cause. This coverage change does not suppress
or fix those errors; full qualification of this exact candidate remains required.

Backend #82 currently qualifies the older #51 frontend. Qualifying the selected
integrated frontend against the backend requires updating both backend pins and
running its composed PostgreSQL/browser and actual artifact checks. Final merged
main/master qualification, full server image/application checks, private host
rehearsal and physical Safari remain distinct rollout requirements.
