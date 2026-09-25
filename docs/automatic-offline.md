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

The existing IndexedDB book store, account ownership rules, sync consent,
source adapters, database identifiers and imported-font cache are unchanged.
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
node --test test/reader/service-worker.test.mjs tests/unit/offline-readiness.test.mjs
```

There are 47 cases, including the 27 existing service-worker cases. New cases
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

This imports a real EPUB through the existing UI before opening Settings,
checks the automatic active registration/status and absence of cached account
URLs, stops the HTTP origin, opens a fresh document and verifies local EPUB,
ruby text, Library and Settings. It does not claim multi-device sync,
physical-iPhone, OS permission-dialog, or browser-eviction certification.

At preparation time the 47 focused cases and Python syntax compilation pass
locally. Local browser navigation is blocked by the environment's administrator
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
