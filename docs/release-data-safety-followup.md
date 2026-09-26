# Release data-safety follow-up

Base: Reader #57 at `8649c0de546d5f77738c4bf219dbf462bb771307`.
This follow-up preserves its catalog/account/cancellation/deletion repairs and
all renderer and production activation gates. It does not merge sibling #48.

## Required main qualification

`books-library.yml` already qualifies every main push and is required by both
the frontend notifier and backend publisher. Its existing app build and browser
installation now also run the Shared TTU round-trip/safety/UI and Local Library
feature/review/lifecycle/deletion/save-cancellation/last-read suites. The latter
run in Chromium and WebKit. The two focused open/Back cases remain selected.

`tests/browser/qualify_library_data_safety.py` is the one suite list used by this
required result and both standalone PR workflows. It is only a test launcher:
no rebuild, download, deployment, provider access or new release authority.
Shared files retain their explicit main entry points to avoid accidentally
collecting inherited harness cases. Native-module tests still use their existing
Vite harness; those cases are not represented as production-bundle evidence.

The launcher preserves every exit status, does not retry, and collects remaining
engine results after a failure. Any failure makes the job fail. Its report and
browser diagnostics are retained in the existing workflow artifacts. The Books
job budget grows to accommodate the extra suites; no per-test timeout or
assertion changes. Five standard-library tests exercise the actual dispatcher,
including each group's nonzero and signal exit, source selection and mandatory
main wiring. The three production workflow authorities are unchanged.

## Last-read is not a content save

Current-head WebKit evidence (Appearance run `36227962964`) reports blob-access
errors with a stack through `updateLastRead` while rapidly leaving catalog-opened
books. The current browser handler calls `encodeBook(book)` and writes the whole
caller snapshot just to record a reading timestamp. That creates asynchronous
image reads and also lets stale readers overwrite current content or recreate
an already deleted book.

Reuse #48's reviewed `book-records.ts` helper verbatim from `78a17fc0` (Git blob
`8b3cd8ff8f188932c8491b510b951b5691d910f8`), wiring only its timestamp function.
The listing helper is retained unchanged for a conflict-free selective port;
this follow-up does not change listing or adopt #48's other binary/offline work.
The handler snapshots the requested numeric ID and timestamp before awaiting.
One read/write transaction reads the current stored record, preserves its
content/source/import receipts/binary representation, never lowers last-opened
time and does not recreate missing books. The existing transaction completion
wrapper drains failures. No new database store or schema migration is needed.

Six unit tests cover the helper and actual handler body. Three native IndexedDB
cases in both engines cover stale snapshots without Blob reads, deletion/newer
timestamps, and a real write-abort followed by retry. Existing strict catalog
navigation stress and no-page-errors assertions are unchanged.

The inherited WebKit failure is not considered resolved until the newly composed
app passes its browser checks. Local policy/unit tests alone do not establish
WebKit, physical Safari, live-provider or host cutover acceptance. Backend pins
must qualify the final selected frontend composition, not an older green pair.
