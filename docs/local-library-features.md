# Local library migration, WebDAV, and search

This is the implementation of the three selected local-first features in PR #43.
The app remains a static Svelte build. No new Manabi API, proxy, token service,
server-side search, or account is required. Existing optional account integration
is retained. This work does not authorize deployment or merging the parent stack.

## Library search

The search destination has two independent sections: **Books** matches titles,
authors, series and collections; **Content** finds passages in saved books.
Metadata buttons render from the existing catalog and are never disabled while
content is loading, failing, or being indexed. The worker is created lazily after
an input debounce; markup reads, HTML parsing, integrity hashing, and text search
run off the UI thread. Results stream by book, with request generations and worker
termination preventing a replaced query from publishing stale passages. IME
composition is committed before changing the query.

Content search is local and offline. It does not download every connected preview.
The worker checks the current book identity and account scope and reads only the
admitted saved book IDs. The disposable projection cache lives in the books database
and is deleted atomically with a removed book. Its source signature includes markup
and publication manifest, not only modification time. Search excludes ruby reading
nodes, script/style/template content, hidden attributes, and inline-hidden content
using the same canonical projection rules as reader navigation. It does not claim
to compute arbitrary publisher stylesheet visibility.

NFKC/case matching maps grapheme-normalized text back to the original code-point
locations and original Japanese excerpts. Search is bounded to 32 × 1024² markup UTF-16 units and
8 × 1024² readable UTF-16 units per book, 500,000 nodes, depth 512, 5,000 resources,
512-character queries, 24 passages per book, and 300 passages overall. Limits and
partial failures are visible. Rebuildable indexing is not a second authoritative
copy of the user's reading state.

Selecting a content hit uses the shared durable locator and the reader's existing
preview/Return behavior. Merely inspecting a hit does not replace resume or add
reading statistics. A tab-local, one-use five-minute handoff puts an opaque token,
not private book text, in navigation. Reloading an unconsumed handoff returns to
ordinary resume because the transient token cannot recover its in-memory target.

## Yatsu migration

Import from Yatsu accepts the observed complete-local-backup v11 format, alongside
the existing TTU format. Preflight reports available types and item counts before
writing. Book packages, nested covers, current position, daily statistics, reading
goals and legacy audio/subtitle records retain their existing importer paths.

Saved bookmarks, highlights with passage notes, and book-wide notes now have
separate adapters. Unique verified text/context becomes a durable bookmark or
highlight. Yatsu's joined text-node coordinates map back through Manabi's block
separators; source offsets are not assumed to equal normalized search offsets.
A quote-free bookmark can use the shared reading counter only when its whole-book
count and section witnesses agree. Repeated/ambiguous or otherwise unverifiable
passages remain explicitly **unlocated**, with their original records preserved;
no percentage, screen coordinate, or guessed passage is substituted.

Bookmarks & Notes includes an Imported Yatsu notes section for editing book-wide
and unlocated notes. Its recovery download retains original source fields and
local edits, including removed records, but excludes Manabi connection credentials
and top-level account bindings. Restore validates the destination book and requires
an explicit choice before replacing different local notes. Verified generic
annotations retain the existing separate annotation export/import path. Keep both
exports, as well as the original Yatsu ZIP; a legacy TTU book-only export is not a
complete backup of the new notebook store.

Authors become creator metadata. Tags and Yatsu series labels become collections,
without renaming or moving original files. The original series position, source
identifiers, and cover preference remain in the import receipt; Yatsu's series
position is not presented as a physical Manabi directory ordering. Collection
receipts commit with memberships so retrying an unchanged archive does not undo a
subsequent local collection removal. Original archives are never modified.

Safe settings are opt-in, requiring the settings row and its data-type checkbox.
The allowlist validates all values before applying changes. Credentials, cloud
bindings, automatic replication, executable CSS, arbitrary themes, local font
files and other nonportable settings are not restored. Repeating the same settings
backup preserves later local edits; conflicting changed settings require a choice.
The UI reports skipped preferences rather than claiming a complete settings clone.

Books, passage evidence, annotations and migration receipts commit in one books
transaction. Collections and settings have their own explicit completion/retry
boundaries. Different content with the same title is not silently overwritten.
The source account is rechecked around asynchronous work. Legacy imported audio
and subtitles remain exportable; this does not automatically configure the separate
built-in audiobook player or restore external audio bytes. Standalone outer cover
sidecars and unfamiliar future formats are not silently interpreted as known v11
fields. These boundaries mean “preserve and report,” not a claim of lossless
conversion of every field another application may add.

## Direct WebDAV

Accounts and libraries → Add WebDAV folder connects the browser directly to an
HTTPS WebDAV root. HTTP is restricted to loopback development. The server must
allow the reader's origin and the necessary `OPTIONS`, `PROPFIND`, `GET`, `PUT`,
and `MKCOL` methods and request headers. Reading-data writes require a strong
`ETag` exposed through CORS, and correct `If-Match` / `If-None-Match` handling.
There is no CORS bypass or Manabi proxy. The connection test proves readable
listing, not write permission; write-back has separate source and per-book opt-ins.

Directory traversal, foreign origins, redirects, credential-bearing URLs, unsafe
XML, duplicate paths, and oversized responses are rejected. Basic credentials are
sent only to the admitted root. A password is held in memory unless the user checks
Remember password; remembering stores it in this browser's same-origin IndexedDB,
not an encrypted secret vault. An app password is preferable. Disconnect clears
the source credentials and links but retains already imported books.

Original ebooks are read-only through this adapter: it does not MOVE or DELETE
original files. Reading data is a versioned, content-keyed document under
`.manabi-reader/book_<sha256>.json`. Position, daily statistics, annotations and
imported notes use conservative three-way merging. Same-field conflicts require
Keep device / Use WebDAV; disjoint records can merge. A missing previously
acknowledged remote file is not a reset: restoration is explicit. Writes use an
ETag precondition and read-back verification; failed writes do not advance the
local acknowledgement. Applied records and their acknowledgement commit together.
Browser-local annotation revision counters are not transported as content changes.

Consent is account-bound. Account, source, root, content and link lifetime are
rechecked; pending consent updates cannot resurrect a disconnected connection.
Readers hold a shared Web Lock while mounted; receiving WebDAV state requires an
exclusive lock. Return all reader tabs to the Library before syncing. Browsers
without Web Locks still import/read books but receive a clear explanation that safe
reading-data sync is unavailable. Sync checks run while the app is open; no
background work after closing the page is promised.

## Verification

`tests/unit/local-library-content.test.mjs` covers projection, Japanese normalization,
cancellation, Yatsu schema validation, legacy cross-paragraph coordinates, verified
counter bookmarks, and safe settings. `local-library-webdav.test.mjs` covers root
admission, streamed response limits, ETags, and the additive v9 → v10 database
upgrade. Unit database tests use fake-indexeddb and are not browser evidence.

`tests/browser/test_local_library_features.py` serves the real static artifact and
uses actual browser IndexedDB and a separate HTTP WebDAV fixture with real CORS,
Basic auth and conditional writes. Cases cover responsive metadata despite delayed
or failed worker delivery, IME/replaced queries, cache invalidation, offline search,
passage preview/Return, migration/recovery/conflicts/settings, directory admission,
missing files/ETags, two-device annotation convergence and competing reader tabs.
Worker injection is limited to the explicitly named fault/responsiveness cases.

The Local library features workflow runs this suite in Chromium and WebKit and
retains screenshots, page HTML and the exact source tree. Appearance component lint
includes the new UI components. Existing migration, appearance, reader, library and
static-build workflows remain in place. A test fixture is not a live NAS/provider,
and desktop WebKit is not physical iPhone Safari qualification. Exact head results
belong in the PR; remaining parent-stack/device gates are not waived here.

### Closeout regressions

Book insertion now aborts and drains the IndexedDB transaction on a failed request,
so storage failure neither publishes a partial book nor leaks the transaction's
secondary unhandled rejection. A browser test aborts the actual data transaction,
verifies that neither a book nor a link was saved, and then retries successfully.
WebDAV link publication validates the unchanged connection in the same transaction
that saves the link. Disconnecting in another tab during a held book download
retains the local book without recreating a deleted connection or credentials.

The offline-reload case stops the real origin HTTP listener, verifies connection
refusal, and requires a fresh document supplied by the actual service worker before
searching the imported book. This runs identically in Chromium and WebKit. It avoids
Playwright 1.63's documented WebKit offline-emulation failure even for literal
service-worker responses (microsoft/playwright#42775); it does not bypass the worker
or intercept requests. A separate negative CORS case denies the real WebDAV response
and verifies that no connection is saved and no promise rejection escapes. Chromium
also asserts observed OPTIONS preflights. WebKit does not emit those preflights in
this loopback fixture and reports the caught access-control denial through its
native inspector event; only that exact expected event is admitted in this test.

Two-device convergence uses two independent persistent browser profiles. A bare
WebKit 2359 ephemeral-context Blob transaction fails in the diagnostic runtime even
without Manabi, so that context is not substituted for a durable second device.
Closing a reader tab waits for the browser's actual lock release before retrying
sync; the test still first proves that a live reader prevents the write entirely.
These are browser-fixture boundaries, not changes to the production permission,
conflict, transaction, or reading-lifetime rules.

Connection edits, disconnect, and per-book consent now share a per-source lock
with the entire sync operation, not just its network calls. This orders changes
across the separate integration and books databases: after disconnect/disable is
reported complete, a previous sync cannot commit a late local acknowledgement.
A change in another tab may wait for an already-dispatched, bounded request to
finish; a request already accepted by a server cannot be unsent. Queued consent
and sync actions retain their originating account scope. Two gated HTTP write
regressions verify that changes wait for existing work and prevent later uploads.
