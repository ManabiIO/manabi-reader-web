# Local-library review — 25 September 2026

Reviewed PR #43 at `c90f4198d570f11daaefbe5ab6383ce8956721d7`, including the
storage subject, Yatsu importer/notebook, worker cache, WebDAV transport/sync,
reader lifetime, and their existing tests. This is a targeted failure-path review,
not a claim to have audited every possible reader setting or provider.

## Reproduced defects and repairs

### A failed preference write was acknowledged as a successful import

The storage subject persisted through an RxJS subscriber. A storage exception
escaped asynchronously rather than reaching the importer's surrounding try/catch.
A targeted second-preference failure left the first preference on disk, the second
only in memory, and a receipt claiming both were imported. Repeating that archive
could then skip the preference that had never been saved.

Both `next` and the Svelte `set` alias now persist synchronously before publishing.
The importer sees the failure, rolls back earlier changes, and does not acknowledge
the failed import. Unit tests use the real importer, persistence factory and RxJS,
with a narrow reader/account fixture and named storage-write failures. Browser
coverage exercises the real migration UI, failure message and successful retry.
Receipt-write failure and repeat-after-local-edit behavior are covered as well.

This is not a claim that multiple localStorage keys form an atomic transaction or
that rollback can succeed after all storage access has become unavailable. It fixes
the demonstrated false-success boundary; process termination remains different
from a caught synchronous failure.

### A stale notebook could overwrite or remove a newer note

Two real browser tabs reproduced silent last-writer-wins behavior for imported
book notes. Editing and deleting now require the exact record the UI observed.
Comparison and mutation occur within the same IndexedDB readwrite transaction.
A changed record produces a visible conflict instead of overwriting it. The
unsaved draft remains available to copy; Reload latest notes explicitly refreshes
the editor. The browser regression covers stale save, preserved draft, reload,
valid retry, and a stale deletion after another tab has saved again.

### A damaged projection cache hid valid source text

The previous worker verified the book's source fingerprint but trusted the cached
projection attached to it. Modifying cached text while leaving the source and its
fingerprint intact reproduced a false “No content matches” result.

Cache rows now carry a projection checksum. Missing, malformed or mismatched rows
are rebuilt from the stored publication. Legacy rows without a checksum upgrade
lazily, without a database-version bump or changes to reading data. The browser
test damages text and shape and removes the checksum, then requires real worker
results and a repaired cache in each case. Hashing and rebuilding remain off the
UI thread; the Books section still does not depend on Content completion.

The checksum detects inconsistent cache data, not malicious same-origin code that
can rewrite both the data and its checksum. Changes to projection semantics still
require the existing index-version invalidation discipline.

## WebDAV protocol refinement

A successful HTTP status is not necessarily a completed, full representation.
The adapter does not implement range assembly or asynchronous job polling. It now
accepts only its supported completion statuses: GET 200 (or explicit absence 404),
PROPFIND 207, MKCOL 201 (or 405 followed by collection verification), and PUT
200/201/204. In particular, GET 206 cannot import a partial plain-text book and PUT
202 cannot be mistaken for completed processing. Unexpected responses are canceled
and fail visibly; conditional writes and read-back verification remain in place.

Strong ETag validation follows the opaque-tag grammar rather than accepting any
quoted string. Tests cover valid empty/opaque tags, invalid spaces/controls and
non-octet Unicode, precondition headers, response cancellation, and a real HTTP
partial-text response that must save neither a book nor a source link.

## Research and qualification boundaries

Primary references checked for this pass:

- [Storage.setItem](https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem): synchronous storage exceptions.
- [RxJS error reporting](https://github.com/ReactiveX/rxjs/issues/3780): subscriber errors are reported asynchronously; the regression additionally reproduces the installed version's behavior directly.
- [HTTP Semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): sections 8.8.3, 15.3.3 and 15.3.7 distinguish entity-tag syntax, accepted processing and partial content.
- [WebDAV, RFC 4918](https://www.rfc-editor.org/rfc/rfc4918.html): method and multistatus semantics.
- [Web Locks request](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request): aborting a queued request is not cancellation of an acquired lock's work.
- [Yatsu library documentation](https://docs.yatsu.moe/library/): backup scope and portability expectations; existing unsupported-field disclosures are retained.

The permanent local-library workflow runs the existing feature suite and
`test_local_library_review.py` in Chromium and WebKit. Unit additions live in
`local-library-persistence.test.mjs` and `local-library-webdav.test.mjs`.
Exact-head results belong in the PR, alongside the retained commit/tree evidence.
Fault injection is explicitly limited to storage writes, cache damage and the
fixture HTTP response; the two-tab editor test uses ordinary application actions.

No new backend, account requirement, permissions, runtime dependency or original
EPUB write was introduced. The parent stack's physical Safari/locator gates and
live WebDAV-provider qualification are not replaced by desktop browser fixtures.

## Follow-on review of `4a42131ae321fe373feb0f38600d8c1a64084e64`

This round keeps the three-feature scope and examines malformed inputs, optional
cache failure, and agreement between metadata and passage search.

### Search normalization must agree before original offsets can be recovered

An exact self-query for `ΟΣ` reproduced a false negative in Content while Books
matched normally. Whole-string lowercasing produces the context-sensitive final
sigma; the worker's grapheme-by-grapheme lowercasing could not see that context.
A shared lightweight normalization helper now equates the two sigma forms for
metadata, queries and passage matching. Original text, excerpts and locator
coordinates remain unchanged. This is the existing NFKC/lowercase search with a
specific contextual repair, not a promise of exhaustive Unicode case folding.
The metadata component imports only the small helper, not the HTML parser.
Wider inspection reproduced the same self-query failure in Search Book. Its worker
now shares the case-only helper while retaining NFC normalization and the explicit
Match case option; it does not acquire Library search's broader NFKC matching.
The actual-worker unit harness and the browser test cover both behaviors.

The unit regression exercises self-matching and original offsets for Greek,
full-width Latin text, Japanese kana, combining marks, ligatures and astral text.
The browser test requires both sections to match the original Greek text and
retains Japanese lookup. Books never waits for the Content worker.

### Valid HTTP status does not prove intact text or a complete selected book

Default TextDecoder recovery substituted U+FFFD for malformed WebDAV JSON/XML.
The resulting JSON could still parse, allowing corrupted reading state to be
applied or sent back. UTF-8 decoding of protocol text is now fatal: invalid bytes
fail before listing admission or state application. The regression serves actual
HTTP responses, requires unchanged local progress and acknowledgement, and then
repairs the remote data and exercises retry. Correctly encoded U+FFFD remains
valid. Ebook bytes themselves are not passed through this protocol-text decoder.

A second real-HTTP test returned a shortened TXT file with HTTP 200 and a truthful
Content-Length for those shortened bytes. Since such a prefix is still valid
plain text, the importer formerly accepted it. Downloads now check the size from
the selected WebDAV listing when supplied, and reject a contradictory response
ETag when a strong selected ETag is available. Requests still send If-Match;
response checking is an additional guard, not a replacement for preconditions.
Tests cover empty destination stores after rejection and successful retry. A
separate gzip-transfer test proves the file-size check uses decoded file bytes,
not compressed transfer Content-Length. Servers that omit both size and strong
validators cannot supply the same independent completeness/revision evidence.

### Optional cache errors must not become unhandled worker rejections

A failed cache request and its transaction-completion promise are separate
failures in the installed idb wrapper. The cache-write failure path now aborts
and drains the real transaction before continuing without the optional cache.
Initial per-book read completion also has a rejection observer before requests
can fail. A narrowly instrumented real worker aborts actual projection writes:
passage results must still arrive, no worker unhandled rejection is emitted, and
a later uninstrumented query rebuilds the cache. A cache remains disposable; no
reading records are reset to recover it.

### Restoring a notebook must not hide an orphaned passage

An archive could describe a row as anchored while omitting its annotation ID.
The earlier restore fallback only ran when that ID was present; such a restored
row was consequently excluded from the unlocated-notes UI. Any anchored row
without an available, correctly scoped annotation now becomes visibly unlocated.
The browser regression retains its original source record and editable note.
It does not invent a location or silently recreate an absent annotation.

WebDAV connection enumeration also reads one prefix-scoped IndexedDB snapshot
instead of fetching keys and later fetching their values in separate transactions.
This removes the intervening-disconnect window for missing list entries. The
scoped-list unit test rejects the former detached-key path, excludes unrelated
metadata and checks enumeration after a deletion.

### Additional primary sources

- [Unicode case-mapping FAQ](https://unicode.org/faq/casemap_charprop.html): contextual casing versus caseless matching.
- [TextDecoder fatal mode](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/fatal): default replacement versus decoding failure.
- [JSON, RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html): interoperable UTF-8 network text.
- [HTTP Semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): representation metadata, content codings and strong preconditions.
- [IndexedDB transaction lifecycle](https://www.w3.org/TR/IndexedDB/): independent requests and transaction completion/abort.

`test_local_library_refinement.py` adds eight real-application browser cases to
the permanent Chromium/WebKit workflow. Unit changes exercise normalization,
strict decoding and connection snapshots. Fault injection is explicit: malformed
HTTP response bodies/validators and the named cache-write-abort worker wrapper.
Exact-head CI results belong in the PR. Local WebKit could not launch in this
review container because its Ubuntu 24.04 runtime requires unavailable ICU 74
libraries; the existing Ubuntu CI job remains the WebKit execution environment.
