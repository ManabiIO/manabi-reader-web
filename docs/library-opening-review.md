# Library opening transaction and identity review

Starting source: PR #57 at `a2258a76c52ce4ce30d9c083910951e9a5494808`,
stacked on #55 at `92a53bfe9452ea0a3ad81824934113b369d82651`.
All ten workflows on that source completed successfully, including the expanded
WebKit catalog-departure tests. The diagnosed last-read image-encoding repair is
retained, not replaced with a test retry or error suppression.

## Opening must observe its resume-target commit

The common Library opener started `database.putLastItem` and navigation without
awaiting either. A native abort of the `lastItem` write still opened the Reader
and leaked a rejected promise. A catalog download correctly saved the book but
then failed the same way. These two actual-built-app cases failed before repair.

The database method additionally accepted a canceled request and an ID deleted
by an earlier queued transaction. Two production-module/native-storage cases
reproduced those failures before repair. It now checks a positive local ID,
checks existence with `getKey`, and writes the resume target within one
readwrite transaction spanning `data` and `lastItem`. It observes both request
and transaction completion through the existing helper. Cancellation reaches
waiting and active uncommitted work; notifications are sent only after commit.
`getKey` deliberately avoids loading the image payload merely to check existence.

The common opener awaits that commit before creating any passage-preview token
or starting navigation. Normal Library and catalog callers await the same
function and retain their visible error/retry interfaces. A native storage
AbortError is not hidden as voluntary catalog cancellation unless the actual
operation signal is aborted. Successfully downloaded book bytes remain available
for an explicit retry. The two databases are not made one transaction.

Normal Library openings have their own AbortController in addition to the
existing page/account/source generation checks. Replacement, account change,
source change and departure cancel the old request. The cancellation signal is
also passed to the existing storage-handler context. The disabled-cache branch
now reads the actual preference value rather than testing the truthiness of its
observable object. External transport implementation and account policy are not
replaced by this change.

The Back regression holds a real `lastItem` transaction in another tab. It waits
for the application's actual pending transaction, navigates Back, releases the
blocker, and verifies the prior target and route remain unchanged. A fresh
explicit open then succeeds. This does not claim that cancellation can undo a
committed write, or prevent a different writer/deletion after this commit.

## Local preparation must preserve the selected identity

`BrowserStorageHandler.prepareBookForReading` read the selected ID but detached
its legacy source through the general title/content upsert. With two same-title,
same-content records it updated the first record, then returned the second ID.
It also re-read native image bytes merely to clear the source marker. The
production handler regression failed before repair: the wrong copy was changed.
A separate title-only preparation test reproduced first-match selection when two
different local editions existed.

Local preparation now uses a narrow transaction on the current stored record.
An explicit ID never falls back to another title match. Legacy title-only calls
read at most two candidate keys and reuse the existing ambiguity rejection.
Placeholder and missing-book errors are retained. Only the selected record's
legacy source marker changes; timestamps, independent IDs, content, byte
representation and other metadata are preserved. No image encoder runs here.
The handler captures its context and cancellation signal before awaiting storage,
so a later context cannot retarget its work.

A cancellation regression aborts after a real `data.put` is enqueued and verifies
rollback of the original source, followed by successful explicit retry. This is
an existing local source-detachment policy repair, not an account-ownership
protocol, content deduplication, new schema, or change to original EPUB files.

## Preview and qualification coverage

The Content-search retry test establishes existing history through an ordinary
Reader opening, then verifies a failed resume write keeps the Library, bookmark
and that history intact. Ordinary first-open start-date initialization remains
unchanged; the test does not equate that initialization with counted reading. A fresh click creates the real cross-resource
preview and Return control without replacing resume or putting passage text in
the URL. Two unit cases verify that an older failed navigation cannot clear a
newer pending token, while current-token cleanup and explicit global cleanup
still work. The existing one-use, book/account-bound token behavior is retained.

`test_library_open_commit.py` has nine cases: five load production modules
through Vite against native IndexedDB, and four use the built static application.
It selects the real browser engine explicitly and retains page-error assertions.
Its `load_tests` selects only these new cases; inherited base suites still run in
their existing qualification jobs rather than being accidentally duplicated under
a different fixture. Fault injection is limited to native transaction aborts and
one held native transaction; no app or navigation implementation is mocked.

Six cases reproduced pre-repair failures: four resume-target/storage/actual-UI
failures and two local-preparation identity failures. Cancellation/retry, Back,
preview preservation, and one-use handoff checks extend the coverage. The
permanent Local Library workflow executes the nine cases in both Chromium and
WebKit alongside all original metadata-first search, Yatsu, WebDAV, deletion and
binary-lifetime cases. Exact final-head CI results belong in the PR description.

## References and boundaries

- [IndexedDB](https://www.w3.org/TR/IndexedDB/): transaction scheduling and
  rollback, current transactional reads, and key-only lookup.
- [idb transaction completion](https://github.com/jakearchibald/idb#txdone):
  request success is distinct from the transaction's final commit.
- [SvelteKit navigation](https://svelte.dev/docs/kit/$app-navigation):
  `goto` is asynchronous; `beforeNavigate` also covers browser Back/departure.
- [AbortSignal](https://dom.spec.whatwg.org/#aborting-ongoing-activities):
  the signal's state, not any arbitrary exception named AbortError, owns cancellation.

No main/base-branch mutation, merge, deployment, runtime dependency, schema or
renderer-activation change. Whole-browser navigation and an IndexedDB transaction
are not one atomic operation. Physical iPhone, live providers and the parent
renderer migration's release acceptance remain separate from these regressions.
