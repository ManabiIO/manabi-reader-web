# Preserve browser failure identity before changing its classification

The integrated Reader has intermittent WebKit page-error failures around hard
navigation: an OPDS catalog fetch in an Appearance background test, and an
Editor's Picks failure whose string representation loses the beginning of a
local UUID URL. Those cases remain failures; this change does not diagnose or
repair the production behavior, remove assertions or retry a failed run.

The pinned Playwright WebKit implementation maps Console messages with
`level=error` and `source=javascript` into `pageerror`, using `splitErrorMessage`
to construct separate error name/message fields. Therefore a pageerror alone
is not sufficient to distinguish an uncaught JavaScript exception, an unhandled
promise rejection and a browser-native resource/lifecycle diagnostic. Capturing
only `str(error)` can also discard the useful prefix that was assigned to name.

Primary implementation inspected:
https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-core/src/server/webkit/wkPage.ts
(`_onConsoleMessage`). This is a reason to preserve evidence, not permission to
ignore errors.

`tests/browser/lifecycle_evidence.py` observes the existing Editor's Picks and
Appearance fixtures. It retains raw Playwright name/message/stack, console
metadata, request/response/failure URLs and types, navigation and close events,
and independently observed DOM error, unhandledrejection, pagehide and pageshow
events. The last 512 events have sequence numbers and an explicit omission count.
No request bodies, credentials or response content are recorded. These are
synthetic local fixtures, not production telemetry.

Existing pageerror listeners and no-page-error assertions remain unchanged.
Native listeners never call preventDefault, return false or install handlers on
application promises. Evidence is written in finally after teardown, including
failed assertions and context-close events, into the existing always-uploaded
per-engine test artifacts. Additional observation can affect timing; a green
run alone does not prove that the intermittent cause is repaired.

Local emitter/Node checks cover original error listener preservation, complete
error identity in JSON, bounded event retention and native observers that do
not consume events. A local built-app control was attempted but system Chromium
rejected loopback navigation with ERR_BLOCKED_BY_ADMINISTRATOR before the app
loaded. That is an environment limitation, not a browser test pass or a product
regression. Actual pinned Chromium/WebKit evidence must come from the normal
Linux workflows. No browser configuration or security policy was relaxed.
