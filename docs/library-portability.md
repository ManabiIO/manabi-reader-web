# Library search, direct WebDAV, and Yatsu migration

## Search Library

Typing in Library search opens two independent sections. **Books** searches the
currently accessible metadata (title, author, series and collections) immediately;
those results stay clickable while **Content** indexes or searches. Content results
arrive progressively, grouped by book, with original sentence context. Errors,
retries and result limits in Content never disable Books. IME composition does not
submit partial Japanese text. Clearing the query, switching accounts, changing the
eligible library or leaving the page cancels obsolete work.

Content search runs in a dedicated worker and reads only saved, currently accessible
book records. It never downloads connected previews, imports books, marks text as
read, or uploads search terms. Matching is literal, Unicode-aware, case-insensitive
and width-normalized. Ruby pronunciation/fallback, hidden text and executable
markup are excluded. Source coordinates refer to the original readable text.

A disposable IndexedDB text index is bounded to 32 MiB / 64 books and keyed by
reader database, viewer, book, stored content and projection version. Storage
failure falls back to uncached search. Content search can clear/rebuild its index.
One book is indexed at a time; oversized/invalid books get an explicit skipped/error
count. Results are capped at 20 passages per book and 500 overall, and limits are
reported rather than implying completeness.

Selecting a passage re-reads the book and account scope, verifies its content and
canonical DOM projection, and creates a one-use, in-memory locator handoff. Text
and credentials are not placed in the URL. The reader opens it as a preview with
Return / Continue Here; previewing must not alter resume position or statistics.
Reflow and cross-chapter navigation use the existing durable locator adapter.

## Direct WebDAV

Connections → Direct WebDAV connects the browser to an HTTPS WebDAV folder without
a Manabi account, proxy or credential relay. Only the connection label, normalized
folder URL, username and explicit upload preference are saved. The app password is
held in memory for this tab and is discarded by Lock, Disconnect or reload. There
is no claim of encrypted-at-rest password storage, because passwords are not stored.

The folder browser uses bounded Depth: 1 PROPFIND, and supports EPUB, HTMLZ and TXT
imports. Imported books become ordinary offline browser copies. Backup ZIPs can be
downloaded intact for the existing backup/migration flows. An explicitly enabled
Upload New File action sends a PUT with `If-None-Match: *`; conflicts are not retried
or overwritten. No delete, move, replace or automatic write operation is performed.
A compliant WebDAV server must enforce this HTTP precondition.

The server must allow the app origin and OPTIONS, PROPFIND, GET and PUT; allow the
Authorization, Depth, Content-Type and If-None-Match headers; and expose ETag where
used. HTTPS certificates must be trusted. Redirects are rejected. Returned paths
must remain inside the selected origin and folder, including decoded segments;
external, traversing, malformed or ambiguous entries fail closed. Reads and response
bodies have size and time bounds. Browser connectivity errors cannot reliably
separate CORS, certificates, network failures and denied local-network permissions.

Personal reading state remains in IndexedDB and the existing optional Manabi sync
path, independent of book locations. This feature does **not** introduce automatic
WebDAV history sync or write state beside books. Disconnecting leaves downloaded
books and personal data intact. Physical series editing is not offered for WebDAV.

## Yatsu migration

The supported complete-local-backup envelope is Yatsu exporter version 1, database
version 11, with settings schema 1. The implementation is based on the observed
public client data format and the existing synthetic-text, true-format backup
fixture; Yatsu implementation code is not included.

The preflight lists books, current position, daily statistics, tags, cover/book data,
audiobook/subtitle records, saved bookmarks, highlights, book notes and safe settings
when present. A per-book summary reports category counts. Migration reports can be
exported as JSON without book text or credential values. The input ZIP is read-only.

Saved bookmarks, highlights and book notes retain their original bounded JSON plus
current editable fields in a local imported-study archive attached to the book.
Unique, verified source excerpts get canonical locators. Pixel positions, ambiguous
repeated text or conflicting section hints never become guessed locators. Book
notes remain book-level notes rather than being pinned to the beginning of a book.
Verified highlights render in the reader; all records remain accessible in
Bookmarks & Notes → Imported from Yatsu, including unresolved ones.

Imported records can be edited, removed, inspected, exported and restored. The
`manabi-yatsu-study` version-1 JSON preserves edits, removal tombstones and original
source records. Restore validates book identity and recomputes locators instead of
trusting archived DOM positions. Conflicting edits require explicit replacement.
Repeat import of the same Yatsu source does not undo local edits or restore deleted
notes. These imported-study records are currently local-only, not silently added to
the native account annotation protocol. Use Export Imported Notes to move their
edits between browsers; retain the original backup as well.

Compatible reading settings are an explicit, unchecked-by-default import choice.
Only known typed preferences are applied. Credentials, source bindings, custom
scripts/CSS and arbitrary storage keys never import. Unsupported key names are
reported; their values are not copied. Settings conflicts require explicit choice,
and repeat import does not reset later local customization. Signing in is not a
prerequisite and importing never enables account sync.

## Qualification

`tests/unit/library-portability.test.mjs` covers normalized source coordinates,
projection exclusions, cancellation, metadata ranking, handoff scope, URL confinement,
conditional uploads, observed Yatsu records and the preference allowlist.
`tests/browser/test_library_portability.py` exercises the actual compiled app,
worker, IndexedDB and generated ZIPs against a real HTTPS WebDAV fixture with
Chromium and WebKit. Its local TLS fixture is explicitly test-only; production never
disables certificate validation. Slow/missing worker scripts and server CORS/auth
failures are injected at the HTTP boundary, not by replacing application APIs.

The parent reader stack's locator/Line Guide acceptance matrix and physical-device
Safari offline reload gates still apply. Automated WebKit is not device qualification.
