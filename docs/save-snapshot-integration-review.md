# Save snapshot integration after Codex opening repairs

Base: PR #57 at `c3f0ad8e64eeac73e208bba5d631851c83570efc`, on #55 at
`92a53bfe9452ea0a3ad81824934113b369d82651`. This integrates the unpublished
save-snapshot patch prepared against `a2258a76`, without replacing Codex's newer
exact-ID opening, cancellable resume transaction, or owned preview-token changes.

## Reproduced on the current base

Four native IndexedDB regressions fail against c3f0ad8e's actual production modules:

- A held image read lets live caller title/hash changes retarget a save from book
  ID 1 to unrelated ID 2. Nested metadata and later mutable byte records can mix
  revisions in the same stored book.
- A pending database connection lets the caller replace even the initial title
  and markup before the save captures them.
- New insertions ignore explicit source detachment, while a retained NewOnly
  result reports detachment that was never written.
- More than one matching local record silently selects and replaces the first.

Two binary unit regressions independently reproduce nested-snapshot mutation and
starting image reads before validating a later malformed byte record.

## Repair boundaries

`encodeBook` snapshots structured metadata and every mutable byte record before
its first await. Immutable Blob references retain per-operation de-duplication.
The database service starts that capture before waiting for its connection and
immediately observes both promises. It uses the captured input for identity,
timestamps, persistence and the return value. An additional native regression
rejects the connection while an image is held to rule out unhandled rejection.

A title-index cursor retains only the matching candidate and refuses a second
match before writes. Distinct hashes with one title remain separate; no schema,
identity algorithm, or NewOnly revision policy changes. Inserts and replacements
honor source policy; a retained record returns its actual stored source. The
browser handler publishes the saved title, not the caller's later mutation.

Codex already supplies the stronger cancellable, metadata-only exact-ID opening
helper. It is preserved byte-for-byte. Two redundant opening tests from the old
patch are omitted; the current opening and cancellation suite remains enabled.

## Current WebKit test failure

The base's Local Library run 36255103115 passes Chromium but fails WebKit in
`test_queued_open_cannot_change_resume_or_navigate_after_back`. The primary error
is CSP refusal of the predicate compiled by `page.wait_for_function`. Teardown
also reports a module-import rejection. Other workflow passes do not erase this
failure.

The regression now observes the same native resume-transaction interception via
a DOM attribute and Playwright's locator assertion, avoiding predicate compilation
in the protected page. It establishes the Back destination through completed
in-app navigation, instead of immediately abandoning a freshly created Settings
document. Its separate transaction holder loads an existing same-origin static
image, not a second partially initialized application. All real IndexedDB holds,
Back navigation, retained resume assertions, successful retry and page-error
assertions remain. CSP is unchanged; no error is filtered and no timeout grows.
This diagnoses the CSP-sensitive test wait, not a universal explanation of all
historical WebKit module failures.

## Evidence and limits

Permanent suites include the five additional native-save tests and two binary
unit tests. Runtime cases import production modules through Vite and use native
IndexedDB; they are not described as production-bundle tests. Static application
cases retain two-section early-clickable metadata search, migration, WebDAV,
delete/retry, catalog departure, preview/resume and source/account isolation.
Four current-base native failures and both unit failures were retained before
repair. Exact final-head CI outcomes belong in the PR, not inferred from a prior
head's success. Local WebKit lacks ICU 74; Ubuntu CI provides that engine.

Snapshots still occupy the book's encoded bytes; cursor iteration still clones
individual records. This is not a measured performance improvement or a new
cross-database ownership protocol. Committed writes cannot be canceled afterward.
No backend, runtime dependency, storage migration, renderer enablement, original
EPUB write, merge or deployment is introduced.

Primary references: [IndexedDB transaction and cloning semantics](https://www.w3.org/TR/IndexedDB/),
[idb transaction completion](https://github.com/jakearchibald/idb#txdone),
[Playwright locator assertions](https://playwright.dev/python/docs/api/class-locatorassertions),
and [Playwright navigation and hydration](https://playwright.dev/python/docs/navigations).
