# Release data-safety follow-up

The follow-up retains Reader #57 through
`a2258a76c52ce4ce30d9c083910951e9a5494808`, including the concurrent metadata,
binary validation and cursor-listing repairs. Every application source file is
identical to that parent. No renderer or production activation gate is changed.

## Required main qualification

`books-library.yml` already qualifies every main push and is required by both
the frontend notifier and backend publisher. Its existing app build and browser
installation now also run Shared TTU round-trip/safety/UI and Local Library
feature/review/lifecycle/deletion/save-cancellation/last-read suites. Local suites
run in Chromium and WebKit; the two focused open/Back cases remain selected.

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

## Preserve the concurrent last-read repair

WebKit evidence on `8649c0de` (Appearance run `36227962964`) identified Blob-access
errors through `updateLastRead` during immediate Reader departure. The old
handler re-encoded every image and rewrote the caller's entire book snapshot for
a timestamp update, also permitting stale content replacement or resurrection
of a deleted book.

The initial follow-up independently selected #48's `book-records.ts` helper.
While it was being prepared, #57's `a2258a76` integrated the same helper, binary
validation and cursor-based listing, with its own native and built-app regression
evidence. The follow-up merges that real commit and keeps its application files
unchanged instead of overwriting or duplicating the repair.

One read/write transaction now updates only the current stored record's monotonic
last-read timestamp, preserving content, source, receipts and binary representation.
Deleted books are not recreated and image bytes are not read. The separate
content-save validation and cancellation repairs remain those of #57.

Six additional unit tests exercise the helper and actual handler body. Three
native IndexedDB cases are selected in both engines: stale snapshots with an
image-read trap, deleted/newer timestamp preservation, and a real write-abort,
rollback and retry. Existing strict catalog navigation stress and page-error
assertions are unchanged. These add evidence; they do not claim ownership of the
concurrent production fix or replace its built-app acceptance.

Exact composed-head browser, lint and build qualification is required. Local
policy/unit tests alone do not establish WebKit, physical Safari, live-provider
or host cutover acceptance. Backend pins must qualify the final selected
frontend composition, not an older green pair. No main/master merge or production
dispatch is part of this follow-up.
