# Native Library controls

The Android Library uses React Native layout, `FlatList`, native modal sheets, and Expo UI controls. IndexedDB and source objects stay with the existing single DOM runtime. No library page is loaded in a WebView.

## Integration

Retain `createNativeLibraryService()` from `dom-service.ts` once in `reader-runtime.dom.tsx`. Admit `library.state`, `library.action`, and the bounded `library.content.start/read/cancel` methods through the existing versioned bridge. Call the corresponding service method with request payload and a trusted authority containing a session/epoch key, runtime abort signal, and a live account/session assertion. Call `admitAccess({ token: payload.libraryToken, keys: payload.libraryKeys, operation: "open" | "delete" }, authority)` inside existing open/delete dispatch. It returns DOM-only expected identities; validate those again in the actual read/write transaction. The native UI captures `libraryToken` and `libraryKeys` before removal confirmation. Call `dispose()` on runtime teardown. The route exports `NativeLibraryScreen` from `index.tsx`.

State is limited to 60 visible rows, one optional detail record, and a 640 KiB encoded response. Native receives opaque source/series/book handles, not filesystem handles, provider URLs, organization aliases, content bytes, or authentication material. Selected actions are capped at 60 targets. A maximum of eight single-use edit admissions is retained, with ten-minute expiry and only the selected presentation baselines. Tokens are revoked by bridge account generation changes. Existing shared domain code retains all its licenses.

## Saved-book passage search

Retain `createNativeLibraryContentSearchService(library)` from `content-search-dom.ts` alongside the Library service in the existing DOM runtime. `start({ query, view }, authority)` returns a loading token immediately; `read({ token, offset?, limit? }, authority)` returns a bounded page; `cancel({ token }, authority)` retires only that search. Retire the service on account/runtime teardown. The search owns its own cancellation controller and profile subscription after the initiating bridge command returns.

The source uses `lib/search/book-content-source.ts` and its existing `library-content-search-worker.ts`, canonical search projection, normalized matching, ownership/content-key checks and integrity-checked `readerSearchProjection` cache. It does not copy the search algorithm, create another worker entry point, add a database, read provider files or refresh provider credentials. Candidates are current-profile accessible imported, non-placeholder copies in the selected collection/series/source/unfinished view, independent of metadata-title matching.

Native output is limited to 30 passages per page, 300 total, and 640 KiB encoded per page. The existing worker additionally caps results at 24 per book. Query text is kept exactly as entered and capped at 512 Unicode code points. A single ten-minute search retains opaque hit tokens and DOM-only canonical locators; both later queries and profile/runtime lifetime changes revoke the old admission. Native receives original excerpt text and its original UTF-16 highlight boundaries, not source HTML, provider URLs, raw account identifiers, canonical book keys or executable callbacks.

Opening uses the ordinary native `open` command with `{ bookId, librarySearchToken, librarySearchHit }`. The host calls `admitOpen({ token, hit }, authority)` and receives `{ identity, locator, assertCurrent }` inside the DOM runtime only. It compares the requested book ID, calls the immediate admission assertion, retains its reader authority, validates the expected record identity at the final database read, and queues the exact locator using the existing `queueLibraryLocation`/`library-search` token handoff. The expected `readerBookKey` includes the legacy local UUID for hashless imports. Reusing a numeric book ID alone must never authorize a passage or coalesce a different passage open. Never reconstruct offsets or serialize the locator into a native URL.

Native controls explicitly submit Search/IME search actions rather than searching intermediate composition text. Editing a draft, changing the Library view, leaving the route or unmounting cancels old work; serial guards discard delayed starts, pages and open callbacks. The UI has loading/partial result, cancel, zero results, partial-failure, truncation, error and bounded paging states. Ordinary title/author/series search remains a separate mode.

## Implemented controls

- Search by title, canonical title, author, or matching series; eight sort fields; ascending/descending order; unfinished filter; list/grid layout and bounded pagination
- Native saved-book passage search, highlighted original-text excerpts, bounded paging and canonical passage opening
- Cached source and folder navigation, personal-series breadcrumbs and volume ordering
- All Books, Finished, Want to Read and custom collection navigation/counts
- Single-page selection, metadata/author sort/language/publisher/date/description/subject/direction editing, cover blur preferences
- Collection create/rename/remove, selected membership, Want to Read, personal series and optional volume number
- Atomic selected completion/reading changes and finished dates, preserving position and statistics
- Existing native document import and guarded runtime open/remove commands

## Explicit gaps

This is source implementation, not a complete native parity or release claim. First-party native authentication/session transport and persistent Android folder handles are unavailable. Cached provider rows can be browsed; the UI explains why provider refresh/import/move/rename/group/reconnect actions cannot be performed. No invented endpoint or filesystem bridge is exposed. Unverified unsaved previews cannot be organized until imported.

Editors' picks downloading, custom cover image picking, mixed snippet counts, physical local/cloud series operations and repair plans, backup/export/share, per-book statistics navigation/deletion, and finished timeline presentation are not implemented by these native controls. Existing web implementations remain intact. Native covers currently use text cards; blur preferences are editable but no new image-loading capability is exposed. Layout/sort/filter state is currently screen-local.

Open/remove admission returns expected content identity from the single-use Library token. The integrated host validates the expectation at its final read/write boundary; preflight visibility alone cannot authorize a replaced numeric ID. The guarded database read checks the existing canonical key and ownership in the same readonly transaction as the record bytes, and never creates a replacement UUID during admission.

## Validation

- `node --test test/expo/native-library.test.mjs`: 15 service/view-model tests plus real fake-indexeddb transactions for ownership, content replacement, atomic completion rollback, and cancellation
- `node --test test/expo/native-library-content*.test.mjs`: service/DTO/lifecycle tests and real existing worker + fake-indexeddb tests for profile ownership, replaced hash/UUID identity, cancellation, projection integrity, normalization and exclusion parity
- `node test/expo/native-library-typecheck.mjs`: strict scoped diagnostics using the production Expo configuration and resolved dependency types
- `node --test tests/unit/library-organization-lifetime.test.mjs`: delayed commit/cancellation, owner ABA, existing web callers and organization publication
- Focused esbuild UI and DOM-service dependency bundles

No Android device, emulator, production Metro export, or real browser interaction test was run for this package. A full-app TypeScript run was killed by environment memory limits; the scoped check is not a claim that unrelated legacy files are type-clean.
