# Snippets React migration

## Implemented

The active React surface includes the full snippets workspace, durable capture dialog, Tiptap editor, snippet reader, destination picker, and searchable shelf. The exported entry points are `SnippetsScreen`, `SnippetCapture`, `SnippetReader`, `SnippetEditor`, `DestinationPicker`, and `SnippetShelf`.

The domain implementation remains in `lib/snippets`: account-generation guards, route ownership, draft serialization, IndexedDB transactions, outbox replay, storage permissions, folder-write fences, conflict resolution, transfer journals, portability, search, and reading-state sync remain shared. React controllers preserve the original asynchronous operation guards and own subscriptions, navigation listeners, timers, and editor cleanup.

The web views retain the original labels, selectors, content, buttons, input styles, and responsive rules. Component-local CSS boundaries are preserved as static `snippet-scope-*` classes so parent workspace rules cannot leak into the editor or destination form. `snippets.css` is the compiled asset; there are no Svelte imports or runtime components in this directory. Shared modal lifetimes handle focus, dismissal, busy fences, and account teardown. Native composition events retain `isComposing` for the furigana/link form.

`BrowserRuntime` mounts one `SnippetCapture`. The snippet reader/editor render DOM-owned content; those DOM surfaces are reusable by the Android split, but this directory does not implement the surrounding native Android controls.

## Verified

Run from the repository root with Node 24.21:

- `NODE_OPTIONS=--max-old-space-size=768 node test/snippets/run.mjs`: all 61 existing domain regressions pass. Assertions remain intact; the harness now imports the active framework-independent stores
- `node test/snippets/react-run.mjs`: 13 React/controller tests pass using real React and Tiptap, jsdom, and fake IndexedDB. Only external service and navigation-shell boundaries are fixtures
- `NODE_OPTIONS=--max-old-space-size=384 node test/snippets/typecheck.mjs`: zero diagnostics in the snippets surface using the production Expo TypeScript configuration and resolved dependency graph. This command reports snippets diagnostics, not all application diagnostics

The UI tests cover StrictMode ownership and cleanup; furigana composition, serialization, and pending-state coordination; rejected executable URLs; cancelled annotation edits; folder source switching and pending-write teardown; explicit locator restoration without manufacturing reading progress; final deliberate scroll persistence; shelf filtering, card layout and range selection; durable capture-before-prompt behavior; account switching; and guarded draft navigation.

The locator test caught a shared raw-HTML regression: fresh `dangerouslySetInnerHTML` objects erased DOM decorations on unrelated React renders. The shared DOM boundary now memoizes that payload, and the test verifies restoration and decoration retention after state changes.

## Remaining qualification

- The original `test/snippets/browser.mjs` end-to-end suite is retained. It still needs to run against the production Expo web export, including its responsive screenshots, clipboard, downloads, browser history, and storage-provider fixture flows
- Browser visual checks could not run in this sandbox: the local Chromium socket operation is denied and the cloud browser blocks localhost. No pixel-parity claim is made
- Android native list/folder/editor-control integration, the document-surface bridge, physical-device IME behavior, and production Metro export qualification are separate migration work. This web port alone does not establish Android parity
- Live-provider OAuth, permissions, and actual cloud storage writes are outside the mocked transport suites
