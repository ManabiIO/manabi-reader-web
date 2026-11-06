# Verified resources on the first document

The shell worker deliberately does not claim existing pages. A language tool
downloaded from the first, uncontrolled document therefore does not pass through
its optional-runtime fetch cache. HTTP caching alone does not establish offline
availability on a later visit.

Web provider hosts can use `loadVerifiedRuntimeAsset(scope, resource, expected)`
before importing their selected entrypoint or transferring Worker/WASM bytes.
The expected SHA-256 must come from a verified, build-selected manifest. Requests
are same-origin and scope-bound, without query fragments or credentials; code,
JSON and WASM bytes have explicit limits and are checked before publication.
Invalid or partial downloads never replace an existing copy. Owner cancellation
also bounds CacheStorage calls, which do not natively accept AbortSignal.

Verified bytes use a separate cache owned by the exact registration scope.
The activated shell worker can read that cache for URLs already declared in its
own optional-runtime inventory. It never searches foreign or unscoped caches,
claims clients, installs dictionaries, or treats arbitrary cached URLs as code.
The host still checks integrity when reading bytes for its own operations.

Cache denial or quota failure preserves usable online bytes. A successful load
is consequently not an offline-ready assertion or a backup of user data.
Resource availability UI needs to observe actual saved resources. These caches
are retained across shell versions because provider resource URLs include an
immutable artifact identity; reclamation requires a separate ownership policy.

The real-browser regression loads a hash-bound authored module before worker
registration, proves the first page remains uncontrolled after activation, then
imports it through the worker after an offline navigation. Chromium and WebKit
run the same assertions with Playwright 1.64.1; older WebKit offline emulation
has an upstream local-resource failure. This is cache-protocol qualification,
not language-engine or dictionary semantic parity.
