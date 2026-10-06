# React library migration

The active entry point is `LibraryScreen` from `index.ts`. Existing Svelte files are reference material only; no `.svelte` module or Svelte runtime is imported by this directory.

## Implemented

- Saved books and connected source catalogs; account-owned visibility; cached/offline catalogs; lazy cover previews; local/OneDrive series plans and resume/reconciliation
- Grid/list shelves, Continue, finished timeline, series navigation, local layout/sort preferences, source view selection and legacy provider cards
- Shared selection algorithms (keyboard, range, marquee and series membership), synchronous scope retirement and selected-preview eligibility
- Book metadata, personal series, collections and mixed-membership dialogs; Want to Read; cover overrides and blur; completion/date operations
- File/folder and backup import, Editor’s Picks download/reuse, cancellation/progress, export data/target selection, saved-copy deletion, selected statistics opening/deletion
- Unified title/content search for books/snippets/video, dictionary preview/full definitions, dictionary archive installation, enable/disable/delete and recommended catalog; exact locator handoffs
- Header IME composition protection, dialog focus restoration, native HTML modal dialogs, accessible menus and radio items
- Library snippet summary shelf, excerpts, save/issue labels and pagination linking to the full snippet route

## Integration boundaries

- `LibraryController`: library open/import/export/delete/statistics/editor-pick workflows. `WorkspaceController`: catalog/shelf/organization/selection operations. `SearchController`: independent search-source sessions
- `ObservableController`: immediate mutation visibility for async guards, cached computed views, batched React subscriptions, bound methods and explicit activation/cleanup
- `useController` subscribes and activates a controller; optional second argument controls activation. No Svelte component scheduler is used
- `LibraryScreen` accepts optional `onOpenBook(id, searchToken)` navigation and `onReady(library, workspace)` host hooks
- Browser-specific operations still use the existing File/DOM/IndexedDB/source adapters. Android native presentation and bridges are owned by the parent migration, not implemented in this directory

## Verification and remaining work

- Passed: active library React bundle via esbuild, server render of the real `LibraryScreen`, all file parse checks, 7 active React/controller tests, and 39 focused existing library-domain tests
- The isolated bundle excluded optional Tiptap/ONNX/FFmpeg/Howler/CodeMirror packages; it is not a complete Expo production export
- Full graph TypeScript runs were repeatedly process-killed by the environment. A narrowed React declaration check was used to fix event/DOM/JSX mismatches; it is not a replacement for the parent’s integrated strict typecheck
- Chromium could not launch because local sockets are prohibited, including after approved escalation. The cloud browser denied the localhost URL. No browser acceptance, visual equivalence, mobile menu/focus behavior, real import/export or account-switch journey is claimed passed
- Expo integration must bundle the existing book-content/snippet search workers and Yomitan runtime assets. Their existing `new Worker(new URL(..., import.meta.url))` entry points remain unchanged
- The parent owns `/import-ttu` and Yatsu migration, `/snippets`, other application routes, Android native UI, and full browser-suite adaptation/execution
