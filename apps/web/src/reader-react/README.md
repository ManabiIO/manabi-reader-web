# React DOM reader

This is the shared reading surface for Expo Web and the Android DOM component. The
EPUB DOM, Foliate paginator, dictionary integration, source locators, annotations,
reading tracker and audio synchronization retain their existing data formats and
algorithms. No Svelte component or Svelte runtime is mounted here.

## Public boundary

`ReaderScreen` from `index.tsx` accepts `bookId`, `onExit`, and `registerHandle`.
Its registered handle exposes `requestClose(): Promise<boolean>`. Android Back
must await that result and only retire the session after `true`. Confirmation,
bookmark persistence, tracker flush and pending replication run before success;
repeated close requests share one operation. `onExit` handles the toolbar's
Library action after the same close path.

`BookReader` is the lower-level DOM engine component. It preserves continuous,
legacy paginated and opt-in Foliate EPUB modes and their source-location APIs.

## State and lifetime

The `*-controller.ts` modules are ordinary TypeScript extracted from the reader's
existing orchestration. React TSX owns the component tree. `ReaderController`
provides an external-store revision, explicit dependency effects, managed store
subscriptions and a per-mounted cleanup lifetime.

- `prepare()` evaluates derived state before the initial view
- `start()` invokes mount work only after React commits element references
- `destroy()` retires subscriptions and callbacks; the original navigation,
  digest and resource-generation fences remain in their domain controllers
- Incoming props are compared with the previous **parent** snapshot. Unchanged
  props must not overwrite internal navigation or pending two-way bindings
- Assignments in controller methods use `changed(expression)`. Nested mutations
  made by a view also need explicit invalidation when they bypass a public setter

The controllers are maintained as TypeScript source. There is no runtime
transpiler or build-time dependency on the retired UI framework.

## DOM ownership

Publication HTML is an imperative island inside a React-owned element. The
memoized HTML payload must remain stable through ordinary state and style
renders, preserving ruby/spoiler state and lookup decorations. `htmlIdentity`
identifies the mounted spine occurrence: two chapters with identical markup
still receive separate geometry lifetimes. `HtmlReadiness` publishes only the
current committed occurrence after parent references and layout are available.

`ReaderScope` forwards CSS scoping classes into portals. `Dom` owns native custom
event listeners and stable action lifetimes; source geometry never depends on an
extra HTML wrapper inside the publication.

`reader.scss` retains the component styles; `reader.css` is its checked-in plain
CSS output for the Expo DOM bundle. Rebuild it with Sass after stylesheet edits.

## Verification

- `controller.test.ts`: dependency ordering, subscription replacement, abandoned
  lifetimes, teardown, assignment semantics, and parent-prop ownership
- `tests/unit/html-renderer-readiness.test.mjs`: committed markup readiness and
  repeated identical spine content
- `tests/unit/react-reader-smoke.test.mjs`: actual React/IndexedDB session under
  Strict Mode, persisted appearance changes, table of contents, identical-spine
  remounting, menus, scrubber/annotations dismissal, and DOM mutation retention
- Existing reader location, projection, navigation, fullscreen, chrome, archive,
  search and browser suites continue to target the retained domain modules and
  DOM selectors

The JSDOM smoke test does **not** qualify browser geometry, actual pagination,
font rendering, Foliate iframe layout, screenshots, Android WebView or Yomitan.
Those require the existing compiled-browser tests and Android device/emulator QA.
