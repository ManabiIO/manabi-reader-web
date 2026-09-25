# Optional chapter preprocessing

Status: foundation patch, NOT an enabled end-to-end product integration.
The public source builds without a proprietary module. It does not fetch a plugin
unless a deployment explicitly configures a manifest. A missing manifest (404)
is supported absence, not a separate reader mode. The identity preprocessor uses
exactly the same interface and returns null: the host retains original HTML with
null sidecar and empty vocabulary. A ready provider may also intentionally return
null. Never cache no-op output as an annotated success. Invalid/mixed/incompatible
configured releases and undefined output remain explicit opening errors, not
silent no-ops. Handle failures in the existing setup/opening error surface; no
additional bypass switch or alternate reader-state machine is introduced.

The public host owns loading, chapter identities, cancellation, derived-cache
budgets, pre-publication staging, and vocabulary display. The optional provider
owns analysis, transformed HTML, opaque sidecar semantics and runtime mounting.
No private source, private npm dependency, generated binary or private test
fixture is committed to this repository.

## Opening contract

1. Load original book data and resolve the saved chapter using TTU's own character
   counts. Do not first preprocess chapter zero and later jump to the bookmark.
2. Create one BookPreprocessingSession with stable book/chapter identities,
   canonical resource identity, explicit analysis options, and an immutable
   source-reading-context key. Do not hash a title as the book's identity.
3. Call ChapterOpeningController.open(index). Its stage callback must create an
   offscreen/hidden renderer stage. Processed HTML is sanitized BEFORE insertion.
4. The provider mounts and validates the entire sidecar while the stage is hidden.
5. A final generation/admission check runs after asynchronous mounting. Only then
   commit synchronously and publish reader-ready. The stage must have completed
   its geometry/restore work while hidden, or its synchronous commit must retain
   the visibility barrier until that work is complete; do not reveal then restore.
6. didPresent schedules other chapters, bounded/serial and foreground-preemptible.
   It writes derived caches and vocabulary projections, never displayed HTML.

A stage's rollback must remove only that stage's nodes, never clear a shared
container that might already contain its successor. Display failures must leave
an explicit opening error or the previous chapter, not partial annotated prose.

## Cache identity

The key includes public protocol/cache schema, plugin ID and release, opaque
engine fingerprint, original chapter SHA-256, stable book/chapter identity,
base URL, resource generation, immutable source-reading context, and explicit
analysis options. The private fingerprint must include the relevant dictionary
content/import generations, morphology/user dictionary, normalization, selection,
evidence and markup/sidecar versions. Host-only theme changes need not invalidate
semantic work unless they actually change the generated payload.

Use original stable source before session-local Blob URLs. Cached resource
references must be rebound to the current reader lifetime before publication.
Until that resource adapter exists, disable persistent reuse rather than display
old Blob URLs. The cache is disposable derived data, separate from book/account
storage. Errors/quota failures must not destroy books or label an import complete.
Dictionary/update events call session.invalidate(); already visible prose is not
replaced. Next navigation passes through opening again.

## Renderer integration still required

The current paginated component's `displayedHtml = html` assignment is the correct
pre-render interception point, but the surrounding bookmark and font/geometry
owners must be integrated and tested together. Mount must precede sectionReady$ /
allowDisplay, and disposers must track renderGeneration and component teardown.

Continuous mode renders the entire htmlContent currently. It needs chapter-aware
staging/virtualization to honor current-chapter-first processing. Do NOT implement
it as post-load wrapping, and do NOT block opening on preprocessing the whole book.
Do not advertise preprocessing as complete until both rendering modes meet the contract.

Keep existing section roots/IDs, author ruby, links, bookmarks, keyboard navigation,
vertical writing and original TTU counting semantics intact. The new vocabulary
component uses incremental chapter projections, not native Realm tracking state.

## Tests

`node --test test/preprocessing/*.test.mjs`

These test the foundation, not a compiled private engine, the Svelte components,
a real installed extension, IndexedDB durability or mobile layout. Run the
separate cross-repository browser/native gates before enabling a deployment.

## Dictionary setup is independent of preprocessing readiness

The dictionary-setup component is a new reusable surface, not yet wired to startup.
Keep existing Jitendex/definition choices. Route every website install entry point
through DictionaryInstallationCoordinator. Its deployment-supplied processing
assets are mandatory dependencies whenever the user selects any dictionary; they
are not definition checkboxes and full JMdict must not replace them. Empty/Not now
makes no requests. Public-only deployments may supply no processing dependencies.

The storage adapter must acquire a cross-tab lock, validate/import archives into
immutable staging, reopen/verify receipts, atomically activate the complete
processing set and verify readback. Only then claim readiness. Staging failure
must preserve the prior valid set; definition failure need not delete a verified
processing set. The coordinator does not implement this OPFS importer itself.

fetchVerifiedDictionaryArchive hashes decoded ZIP bytes, not URLs or ETags. It
bounds both response and decompressed sizes. An HTTP Content-Encoding br response
can already be decoded by fetch even though its filename ends in .br: do not
Brotli-decode a ZIP twice. Brotli support is format-dependent; supply a pinned
streaming decoder when required. No opaque/no-cors fallback is valid. ZIP entry
validation, archive quotas and content import still belong to the real importer.

Analysis and popup-definition storage have distinct ownership and versions.
Only resources that actually affect analysis belong in semantic cache identity.
Keep data-reader-lookup and data-reader-lookup-context out of untrusted input;
validated runtime mounting installs them after sanitization.


## R3: integration and publication contracts

Apply the guarded `integration/web.json` source edit together with these additions.
It adds `BookHtmlPolicy.allowReaderAnnotations` to the existing book sanitizer.
`sanitizeProcessedChapter(html, policy)` now REUSES that policy; pass the normal
trusted resource resolver/allowlist. All original CSS, image, URL and SVG restrictions
remain in force. This replaces the earlier standalone sanitizer design. Sidecars
are out-of-band and incoming runtime context/lookup attributes remain disallowed.

`loadDeploymentManifest` is the setup-only data API: it does not import the private
module or initialize Swift, a Worker or morphology. The code loader is separate.
Malformed configured modules still fail, and any created provider is disposed on
validation failure. Intentional no-op output uses the ordinary single result shape.

`createDOMChapterStage` is the measurable hidden-root publication primitive. Supply
sanitize/configure/bindResources/restore from the real TTU adapter. `stage.prepare`
runs AFTER private runtime mount; final admission runs after restoration and BEFORE
commit. Returned cleanup belongs solely to that stage. An aborted successor cannot
remove its visible predecessor. This still needs actual paginated/continuous Svelte
wiring; the helper alone does not implement either renderer.

Use original `bookData.elementHtml` with TTU's stable image placeholders for analysis
and persistent cache identity. `formatBookDataHtml` currently binds Blob URLs and
publishes gallery state; those are render lifetimes, not stable cached input.
The zero-count resume helper intentionally preserves a zero-text cover at index 0.

Installation receipts now require artifactSha256 in addition to decoded ZIP
contentSha256. processing-set-v2 includes both hashes plus importer/format identity.
A supplied storage implementation must really reopen/verify its bytes and hold
leases for active engines; the public host does not depend on a private storage
implementation. Definitions and analysis resources remain separate destinations.
No template implementation should claim real dictionary installation qualification.
