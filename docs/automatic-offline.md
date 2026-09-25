# Automatic offline reading

Assessment and implementation: 2026-09-25. Reviewed baseline:
`8a5aee8767b98815ac18ad6d87a2b8e8f6f65ef4` (`main`). This change is independent
of the open lowercase-deployment-path and library-feature PRs.

## Product contract

Keep the Reader application shell automatically available offline after a
successful online preparation. Do not introduce an "Enable offline" toggle,
a separate offline engine download, or a requirement to install a PWA. SvelteKit
already automatically registers `src/service-worker.ts` in production builds.

These are separate capabilities:

- The app shell must be cached to reopen the website without its origin server.
- A book must actually have local content, not just a cloud-library placeholder.
- Optional fonts, dictionaries, audio and model files have their own lifecycles.
- Persistent storage is browser-granted eviction protection, not proof of any
  of the above and not a backup. Network account sync is separate again.

The existing IndexedDB schema and book format, account ownership rules, sync
consent, source adapters, database identifiers and imported-font cache are unchanged.
No remote library is mirrored, no account/API responses are cached, and no
large optional payload is downloaded by this change. Existing persistence
preferences and the browser's native permission decisions are respected.

## Re-evaluation of the earlier proposal

Yatsu documents an opt-in full-shell cache in addition to its smaller default
cache. That is a product bandwidth policy, not a special native offline engine.
Manabi already takes the automatic full-shell approach. Copying Yatsu's switch
would be a regression for the desired experience.

Do **not** replace mandatory `cache.addAll()` with `Promise.allSettled()` or
independent best-effort writes. A partly cached set of routes, CSS and dynamic
JavaScript chunks is not a working offline app. Required shell preparation
remains atomic; optional fonts/dictionaries remain excluded. An additional
critical/optional split needs measured asset sizes and dependency evidence,
not an assumption that a less-used route's JavaScript is dispensable.

Do **not** call `skipWaiting()`, `clients.claim()` or reload a live reading tab
just to make installation seem instant. The active and waiting generations
must remain separate. The first document can be uncontrolled while the active
registration is already capable of serving a subsequent offline navigation.

## Changes

### Fresh mutable resources, reusable immutable resources

Precache requests for mutable HTML and public/static resources use
`cache: 'reload'`, preventing a fresh but older browser HTTP-cache response from
being copied into the new shell. SvelteKit's content-hashed `build` resources
retain normal HTTP-cache reuse. All precache requests reject redirects; a
redirect to a login/error document is not an acceptable shell asset.

This does not turn an inconsistent server deployment into a consistent one.
The host must atomically publish matching HTML, worker and assets, serve the
manifest's canonical URLs directly with correct MIME types/status codes, and
retain immutable resources needed by previous releases. Do not substitute SPA
HTML for missing JavaScript. The worker must have a stable URL and a suitable
revalidation policy. The existing missing-shell network fallback never writes
possibly newer HTML into an older cache generation.

### Verified status, not an offline mode

Settings -> Library & sync contains an automatically refreshed Offline reading
status. A small read-only MessageChannel protocol asks the exact deployment's
**active** worker to inspect its own required shell entries. Counts are checked
against actual successful, nonredirected cached responses; registration alone,
`navigator.onLine`, persistence permission, or a saved boolean cannot imply
readiness. The worker does not read books or expose cache URLs/account data.

Only same-origin, in-scope clients can request the status. Inspection batches
are bounded and concurrent inquiries are coalesced. The client validates scope,
script URL and reply shape, rejects a changed worker, times out even stalled
registration discovery, and closes message ports on completion/abort. Older
workers that lack the protocol report unconfirmed status rather than success.
A waiting update is shown separately without forcing activation.

The inspector runs only while Settings is mounted, pauses in hidden documents,
and cleans up on unmount. It does not install a worker, grant persistence,
fetch missing resources, repair a partially cleared old generation, or block
Library/Reader startup. Readiness is a point-in-time shell-completeness check,
not content-integrity verification or a guarantee against later eviction.
Optional font availability and individual book completeness are not certified
by the app-ready label.

### Resilient persistence API boundary

The shared storage wrapper tolerates missing/partial browser APIs, throwing
getters, synchronous errors and rejected promises, while preserving native
method receivers. It reports unknown usage as an empty estimate instead of
the previous synthetic 1/1 (100% used) value. Concurrent persistence requests
share one promise; already granted persistence is reused, and a denial does
not permanently prohibit a later request. This is not a new permission-request
policy. A native permission prompt still belongs to the browser; this wrapper
does not dismiss it or claim it cannot remain pending.

## Verification

Dependency-free unit regressions:

```sh
node --test test/reader/service-worker.test.mjs tests/unit/offline-readiness.test.mjs \
  tests/unit/book-write-transaction.test.mjs tests/unit/offline-font-fallback.test.mjs
```

The original change added 20 cases to the 27 existing service-worker cases.
The refinement adds readiness, bounded-inspection, transaction-settlement and
optional-font fallback cases. New cases
cover mutable-versus-immutable request caching, status/cache ownership, missing
and denied caches, malformed/late replies, old workers, timeout/abort,
unsupported/partial storage APIs, native receivers, rejection, concurrent
permission requests, retries and invalid estimates. The existing Reader
archive/font/service-worker runner is now explicitly included in static CI.

Real browser worker contract tests:

```sh
python tests/browser/test_offline_worker.py --browser chromium
python tests/browser/test_offline_worker.py --browser firefox
python tests/browser/test_offline_worker.py --browser webkit
```

These serve the committed worker in a minimal HTTP shell (not a substitute
Reader implementation). Cases cover first-visit preparation and fresh offline
navigation, stale mutable HTTP-cache prevention, waiting-update/live-client
isolation and natural activation after old clients close, failed mandatory
resources and redirected resources. The origin listener is actually stopped;
Playwright network interception and `set_offline()` are not used.

Compiled application acceptance, after the normal `/Reader-Web` build:

```sh
python tests/browser/test_offline_reader.py --browser chromium
python tests/browser/test_offline_reader.py --browser webkit
```

This uses a disposable **persistent** profile, imports the original image-bearing
EPUB through the existing UI before opening Settings, and checks automatic
registration/status and absence of cached account URLs. It stops both the
browser process and HTTP origin, relaunches that same profile, opens the exact
manifest start URL and verifies local EPUB, ruby text, local image reference,
Library and Settings. Separate cases cover an empty library and native
IndexedDB abort/rollback followed by successful import retry and offline
restart. It does not claim multi-device sync,
physical-iPhone, OS permission-dialog, or browser-eviction certification.

The initial 47 focused cases passed locally. The refinement's 33 module cases
and Python syntax compilation also pass locally. Local browser navigation is
blocked by the environment's administrator
policy (`ERR_BLOCKED_BY_ADMINISTRATOR`); it is not counted as a browser pass.
The complete application toolchain is not installed locally. The PR's GitHub
checks are the authority for the full build and browser results; earlier PRs'
evidence must not be attributed to this head.

## Sources consulted

- [Yatsu: Using Yatsu Offline](https://docs.yatsu.moe/offline/)
- [SvelteKit: Service workers](https://svelte.dev/docs/kit/service-workers)
- [MDN: Cache.addAll](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll)
- [MDN: Request.cache](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache)
- [MDN: Request.redirect](https://developer.mozilla.org/en-US/docs/Web/API/Request/redirect)
- [web.dev: Service worker lifecycle](https://web.dev/articles/service-worker-lifecycle)
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [MDN: StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)


## Deeper review: launch and failed-write boundaries

The entry page is explicitly trailing-slash canonical so the manifest's `./`
start URL remains inside the service-worker scope. Empty-library navigation
uses the deployment base instead of a relative `manage` URL. Qualification now
checks the launch URL itself in the shell and uses it after a full browser
restart, not merely a fresh tab opened directly at a known Reader route.

The earlier full-app WebKit run was not a successful import: diagnostics at
`3b94170e` establish `Error preparing Blob/File data to be stored in object
store` during EPUB import and a separate unhandled transaction `AbortError`.
The previous ruby-assertion explanation did not explain this failure.
Playwright's ordinary `browser.new_context()` is non-persistent. WebKit has
reported restrictions on IndexedDB Blobs in private contexts; failure there
must not be represented as either proof of durable-profile failure or a
successful private-mode import. The durable-profile test retains the exact
image-bearing fixture and strengthens acceptance to a process restart.

A shared `commitTransaction` boundary now observes `tx.done` **before** the
first book/bookmark request, waits for commit before returning success, and
aborts/drains completion when requests fail. It still drains completion if
`abort()` itself throws because the browser has already ended the transaction.
Known binary-storage refusals receive actionable context while preserving
the native error as their cause. There is no silent image removal, automatic
private-mode detection, database reset, schema/Blob-format migration, or
unbounded ArrayBuffer copy. The book-write method does not take an AbortSignal:
a native `AbortError` there is an unexpected save failure, not a user's import
cancellation. It is given an actionable ordinary Error (with native cause) so
replication cannot silently discard it as user cancellation. The general
replication cancellation path is unchanged. Other errors, including quota
failures, keep their original identity.

Readiness is no longer "preparing" solely because registration is missing:
a real installing/waiting/activating worker is required for that state. The
waiting-update flag is sampled again when the reply arrives. Additional tests
cover late registration after cancellation, bounded cache inspection, denied
cache operations, partial cache deletion without network repair, and the
atomic absence of partially cached files after a failed install. Worker test
server backlog is configured before the listening socket is created. Browser
failure reports include the actual stage and are retained per engine.

With a persistent WebKit profile, the unchanged image-bearing EPUB imported
and reopened after a full offline restart. This exposed rejected worker work
for an optional packaged font that was not cached. A known packaged-font URL
now returns a non-cacheable 404 when both cache and network cannot supply it,
allowing CSS fallback without a rejected fetch handler. It does not substitute
another face or cache failures; a later request can retry online. This change
does not disguise mandatory-shell failures or cache unknown font-shaped URLs.
At `77d150b5`, the book and empty-library restart cases pass in Chromium and
WebKit with zero page errors. The native-abort retry test then exposed the
silent-cancellation classification fixed above; only its subsequent run can
qualify that refinement. Final per-head results belong in the PR discussion.

Playwright supports asynchronous wait predicates; the earlier comment that
`wait_for_function` inherently accepts a Promise as truthy was inaccurate.
The fixture retains bounded explicit polling without making that claim.

Additional primary references:
- [WebKit issue 198278: private-mode IndexedDB Blob limitation](https://bugs.webkit.org/show_bug.cgi?id=198278)
- [WebKit issue 188438: binary storage failure and later reports](https://bugs.webkit.org/show_bug.cgi?id=188438)
- [Playwright: browser contexts](https://playwright.dev/python/docs/api/class-browser#browser-new-context)
- [Playwright: persistent contexts](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [idb: transaction lifetime and tx.done](https://github.com/jakearchibald/idb#transaction-lifetime)
