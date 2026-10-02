# Native Library controls

The Android Library uses React Native layout, `FlatList`, native modal sheets, and Expo UI controls. IndexedDB and source objects stay with the existing single DOM runtime. No library page is loaded in a WebView.

## Integration

Retain `createNativeLibraryService()` from `dom-service.ts` once in `reader-runtime.dom.tsx`. Admit only `library.state` and `library.action` through the existing versioned bridge. Call the corresponding service method with request payload and a trusted authority containing a session/epoch key, runtime abort signal, and a live account/session assertion. Call `admitAccess({ token: payload.libraryToken, keys: payload.libraryKeys, operation: "open" | "delete" }, authority)` inside existing open/delete dispatch. It returns DOM-only expected identities; validate those again in the actual read/write transaction. The native UI captures `libraryToken` and `libraryKeys` before removal confirmation. Call `dispose()` on runtime teardown. The route exports `NativeLibraryScreen` from `index.tsx`.

State is limited to 60 visible rows, one optional detail record, and a 640 KiB encoded response. Native receives opaque source/series/book handles, not filesystem handles, provider URLs, organization aliases, content bytes, or authentication material. Selected actions are capped at 60 targets. A maximum of eight single-use edit admissions is retained, with ten-minute expiry and only the selected presentation baselines. Tokens are revoked by bridge account generation changes. Existing shared domain code retains all its licenses.

## Implemented controls

- Search by title, canonical title, author, or matching series; eight sort fields; ascending/descending order; unfinished filter; list/grid layout and bounded pagination
- Cached source and folder navigation, personal-series breadcrumbs and volume ordering
- All Books, Finished, Want to Read and custom collection navigation/counts
- Single-page selection, metadata/author sort/language/publisher/date/description/subject/direction editing, cover blur preferences
- Collection create/rename/remove, selected membership, Want to Read, personal series and optional volume number
- Atomic selected completion/reading changes and finished dates, preserving position and statistics
- Existing native document import and guarded runtime open/remove commands

## Explicit gaps

This is source implementation, not a complete native parity or release claim. First-party native authentication/session transport and persistent Android folder handles are unavailable. Cached provider rows can be browsed; the UI explains why provider refresh/import/move/rename/group/reconnect actions cannot be performed. No invented endpoint or filesystem bridge is exposed. Unverified unsaved previews cannot be organized until imported.

Library content/passage search, editors' picks downloading, custom cover image picking, mixed snippet counts, physical local/cloud series operations and repair plans, backup/export/share, per-book statistics navigation/deletion, and finished timeline presentation are not implemented by these native controls. Existing web implementations remain intact. Native covers currently use text cards; blur preferences are editable but no new image-loading capability is exposed. Layout/sort/filter state is currently screen-local.

Open/remove admission returns expected content identity from the single-use Library token. The host must also validate the expectation at its final read/write boundary; preflight visibility alone cannot authorize a replaced numeric ID. This package does not implement the host transaction itself.

## Validation

- `node --test test/expo/native-library.test.mjs`: 15 service/view-model tests plus real fake-indexeddb transactions for ownership, content replacement, atomic completion rollback, and cancellation
- `node test/expo/native-library-typecheck.mjs`: strict scoped diagnostics using the production Expo configuration and resolved dependency types
- `node --test tests/unit/library-organization-lifetime.test.mjs`: delayed commit/cancellation, owner ABA, existing web callers and organization publication
- Focused esbuild UI and DOM-service dependency bundles

No Android device, emulator, production Metro export, or real browser interaction test was run for this package. A full-app TypeScript run was killed by environment memory limits; the scoped check is not a claim that unrelated legacy files are type-clean.
