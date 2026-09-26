# Library deletion review after Codex integration

Starting source: PR #57 at `36bec90230378b9b25bc61678df95dfa357cd315`,
stacked on PR #55 at `92a53bfe9452ea0a3ad81824934113b369d82651`.
This is a continuation of the integrated library review, not a return to #43.
The current Codex EPUB, Line Guide, shared-library identity and ownership repairs
are retained. No renderer gate, backend, dependency or storage schema changes.

## Reproduced deletion defects

The batch deletion helper took a snapshot of every bookmark key and the last-opened
book before starting its per-book transactions. Writes committed between deletions
could make those decisions obsolete: deletion of a later selected book erased a
newer last-opened target belonging to a retained book, while a newly saved bookmark
for the deleted book was left behind. The regression uses the real progress event
after the first commit to enqueue independent native IndexedDB writes before the
next deletion. It does not replace the database implementation or sleep to guess
an interleaving.

Deletion also trusted the caller's selected title. When the stored title changed,
cleanup removed auxiliary data under the old label and retained the current book's
auxiliary data. The current stored book now supplies its title inside the deletion
transaction. Existing legacy-title sharing remains conservative: a surviving
same-title copy keeps title-keyed audio/subtitle/handle and legacy statistics data.
The selected numeric IDs are snapshotted and de-duplicated; mutable presentation
metadata does not determine which record or title-owned data is deleted.

A native abort during book deletion was interpreted by the replication error
handler as deliberate user cancellation. The caller received an empty error even
though nothing was deleted, and the separate transaction-completion promise could
reject unhandled. The existing `commitTransaction` helper now observes and drains
that completion before reporting failure. At this boundary there is no user abort
signal inside the transaction, so its native AbortError receives an actionable
storage-error wrapper, retaining the original cause. Deliberate cancellation is
still checked between books; earlier committed deletions are not undone.

Finally, the existing keep-history preference only affected legacy `statistic`
rows. Newly tracked `readerStatistic` rows survived even when the user explicitly
turned history retention off. Deletion now resolves the stored content/local
identity and removes its keyed days and statistics timestamp in the same
transaction. A surviving copy with the same content hash, even under a different
title, retains their shared history. A different book with the same title retains
its independent history. No content identity or legacy ownership is guessed from
a title, and default history retention remains enabled.

## Transaction and notification boundaries

Each deletion reads the current book and last-opened record in the same readwrite
transaction that removes its bookmark, derived search projection, eligible
auxiliary/history rows and book. It publishes last-item/bookmark notifications and
progress only after commit. The history option expands this transaction's scope
rather than issuing detached cleanup writes. The content-copy check traverses a
cursor instead of retaining all book payloads in an array; it is still a scan and
is not a measured constant-memory or speed claim.

The native-abort test now checks rollback of the book, bookmark, last-opened
record, history, timestamp, search cache and audio together, then restores the
native method and retries successfully. The batch is intentionally not one giant
transaction. Cancellation cannot recover already committed deletions or prevent
an independent writer from acting after a deletion has committed. This patch
does not change remote-history retention or delete/recreate import/identity
receipts and saved annotations.

## Regression execution

`tests/browser/test_library_deletion.py` adds six production-module/native-storage
cases and two actual built-app cases. The runtime tests load the real DatabaseService
through Vite; they are not represented as production-bundle tests. The static
cases import a generated image-bearing EPUB through the normal UI, change the
actual Keep Local Data on Deletion switch, remove a book through its menu, and
exercise the real Deletion failed dialog plus successful retry. Generated history
is seeded explicitly into native IndexedDB where needed.

Four core failures were observed before repair: stale last-opened/bookmark state,
stale title cleanup, native-abort false success/unhandled rejection, and ignored
content-identity history deletion. Additional cases preserve deliberate batch
cancellation and legacy same-title auxiliary sharing. Tests keep normal page-error
assertions; no error is suppressed, assertion removed, timeout increased or failure
classified as expected.

The runtime suite explicitly selects its persistent page's browser engine, since
the shared OPFS test harness defaults to Chromium. Engine identity and user agent
are retained with page-error reports. Both engine selections run in the permanent
local-library workflow alongside all existing search/Yatsu/WebDAV cases. Full
source and CI identities, totals and remaining workflows are recorded in the PR.
Local WebKit requires unavailable ICU 74; desktop WebKit evidence must come from
Ubuntu CI and does not certify a physical iPhone.

## Other current-state findings and research

The initial source's latest Foliate workflow passed. Its Appearance workflow
`36220864606` failed WebKit background acceptance on an unhandled OPDS catalog
fetch error during navigation, not on background geometry. The downloaded
`appearance-evidence` archive matches SHA-256
`ea11252ea19a3ca81f1c9c316b6e546a0b42f20ce639c9789c1fa4793ac5e947`.
The catalog caller already has cancellation and try/catch; the retained report
alone does not establish whether the remaining failure is application lifetime
handling or WebKit teardown behavior. This deletion patch does not claim to fix
it, waive it, or prove it flaky. Fresh CI outcomes are distinct from that finding.

Primary references reviewed:

- [IndexedDB transaction lifecycle and scheduling](https://www.w3.org/TR/IndexedDB/):
  readwrite isolation, current transactional reads, and all-or-nothing commit/abort.
- [idb transaction completion](https://github.com/jakearchibald/idb#txdone):
  completion is separate from request promises; await commit before success.

The review also checked the new source/opening guards, current binary storage,
account transitions, WebDAV and Library search callers. Sibling PR #48's further
binary/listing refinements remain a separate integration decision; this patch
does not silently copy its whole branch. There is no merge, deployment, provider
credential use, or production activation in this review.
