# Verified resources on the first document

The shell worker deliberately does not claim existing pages. A language tool
downloaded from the first, uncontrolled document therefore does not pass through
its optional-runtime fetch cache. HTTP caching alone does not establish offline
availability on a later visit.

Web provider hosts can use `loadVerifiedRuntimeAsset(scope, resource, expected)`
before transferring Worker/WASM bytes or separately admitting a module for execution.
Caching verification alone does **not** authorize a subsequent URL import: on an
uncontrolled page that import may fetch different bytes. The importing host must
bind the executed response to the selected digest (for example, an SRI module
script plus its document module-map namespace, with a self-contained bundle).
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

A verifier cache miss or damaged copy uses an explicit `cache: reload` request.
An explicit `X-Reader-Runtime-Reload: 1` marker distinguishes this verifier repair
from ordinary browser reloads (including disabled HTTP caches). The shell worker
honors that marker by bypassing both optional runtime caches,
then refreshes only the requested tool URL. Failed validation never publishes a
verified copy. This repair does not clear databases, user dictionaries, books,
foreign caches, or the application shell. Offline verified cache hits remain
usable without requesting the network.
