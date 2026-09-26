# Preserve browser failure identity before changing its classification

The integrated Reader has intermittent WebKit page-error failures around hard
navigation: an OPDS catalog fetch in an Appearance background test, and an
Editor's Picks failure whose string representation loses the beginning of a
local UUID URL. Later passing runs do not diagnose those failures. This change
adds evidence, not a claimed production repair or a test waiver.

The pinned Playwright WebKit implementation maps Console messages with
`level=error` and `source=javascript` into `pageerror`, using `splitErrorMessage`
to construct separate error name/message fields. A pageerror alone therefore
cannot distinguish an uncaught JavaScript exception, an unhandled promise
rejection and a browser-native resource/lifecycle diagnostic. Capturing only
`str(error)` can discard the useful prefix assigned to name.

Primary implementation inspected:
https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/webkit/wkPage.ts
(`_onConsoleMessage`). This is a reason to preserve evidence, not ignore errors.

## Retain the concurrent parent work without duplicate observers

Reader #57 added Editor's Picks diagnostics in `345c798919d25d310a34571d54fc69d582cde257`
while this follow-up was in progress. Its complete `test_editors_picks.py` is
retained byte-for-byte, with the parent commit as a real merge parent. The
parallel Editor's Picks observer from this branch is removed rather than
installing two instrumentation layers or overwriting newer work.

The additional `tests/browser/lifecycle_evidence.py` is used by the Appearance
fixture only. It retains raw Playwright name/message/stack, console metadata,
request/response/failure URLs and types, navigation and close events, plus
independent DOM error, unhandledrejection, pagehide and pageshow observations.
The last 512 events include sequence numbers and an explicit omission count.
No request bodies, credentials or response contents are recorded; this is
synthetic-fixture evidence, not production telemetry.

Existing no-page-error assertions remain authoritative. The Appearance native
listeners do not preventDefault, return false or consume application promises.
Its evidence is written in finally after teardown. Books qualification always
uploads both moved artifacts and any live `test-results` left behind by a
fail-fast suite, so the failure path cannot lose its diagnostic directory.
Additional observation can affect timing; a pass alone does not prove a repair.

Local emitter/Node controls cover complete error identity and original-listener
preservation, bounded retention, and native observers that do not consume
events. A local built-app control was attempted, but system Chromium rejected
loopback navigation with ERR_BLOCKED_BY_ADMINISTRATOR before app load. That is
an environment limitation, not a product regression or a browser pass. No
browser security policy was relaxed; pinned browser evidence comes from CI.
