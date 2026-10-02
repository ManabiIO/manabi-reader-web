# Expo Android + web migration (draft)

This branch is one deliberately large, **unmerged draft PR**. It replaces active Svelte UI and orchestration with React and an Expo Android/web shell. It is not a claim of release readiness or established 1:1 parity.

## Platform boundary

- Expo SDK **57.0.26**, the current patched stable line, React **19.2.3**, React Native **0.86.3**. SDK 58 beta is not required for this migration.
- `app.config.ts` admits **Android and web only**. Scripts generate/export Android explicitly. There are no Expo iOS, macOS, Windows, or Linux application targets. Existing native Apple applications remain separate.
- Platform presentations live outside `src/app`; each route re-exports its platform-selected screen. This keeps the Router context from traversing web-only reading/worker modules in the Android shell graph. Executable graph tests use the installed Expo DOM transform and check both platforms.
- Expo Router owns the application routes on Android and web. The deployed web prefix remains `/reader-web` (or an explicit `BASE_PATH`), and the existing route/query shapes remain the compatibility contract.
- The React DOM reading surface retains EPUB/Foliate layout, ruby, vertical text, selection/ranges, annotations, dictionary rendering, rich content and browser workers. It renders directly on web and through an Expo DOM component on Android. It does not import or mount Svelte.
- Shared React screen/controller logic uses platform-specific presentation where web semantic markup/design and native Android controls differ. Native shell controls use Expo UI universal components, backed by Jetpack Compose on Android. A native view is not a claim of complete native feature parity.

## Durable state, lifecycle and trust

The first Android port deliberately keeps the existing IndexedDB book/integration databases in **one persistent DOM runtime**, including when a native screen is visible. Native views do not create a competing SQLite book/progress/outbox owner. Database names, schema migrations, content identity, account ownership, transaction commit rules and existing merge algorithms remain unchanged.

The native/DOM bridge is versioned and scoped to a random reader session and monotonically increasing account epoch. It validates methods, request identities and bounded payloads. Duplicate command identities coalesce; changing the payload under an existing identity fails. Commands are not automatically replayed after process death, timeout or an unknown mutation outcome. Native UI must reconcile a fresh saved-state snapshot. A completed mutation whose account became stale is reported as completed/stale, not falsely reported as cancelled before commit.

Android import uses the platform document picker and reads its app-cache copy in 256 KiB chunks. Each chunk crosses once; the entire book is not repeatedly serialized as a React prop. Transfer order, declared byte count, maximum size, file type and session/account ownership are checked before the existing import pipeline receives a File. The picker source is never deleted. Current bridge admission limit: 256 MiB per book.

Book HTML and dictionary content remain untrusted. Existing sanitizers and resource restrictions are retained. Native actions are exposed only to the trusted reader React root, never as arbitrary file/network capabilities on imported content. External URLs reject credential-bearing and non-HTTP(S) schemes. No access tokens, passwords or arbitrary native filesystem paths are part of the bridge contract.

Android Back uses the reader's existing close/save/confirmation path; it must not simply destroy the DOM while a bookmark/tracker commit is pending. Store subscriptions, DOM observers and pending operations are owned by their mounted controllers. React StrictMode restart is part of the new lifecycle tests.

## Bundling and offline requirements

The primary application build is Expo Metro, not a separately deployed web wrapper. Existing Sass `@use` sources are compiled to ordinary CSS before Metro, because Metro's documented Sass support does not follow Sass imports. Tailwind runs through PostCSS. Dictionary runtime, corresponding GPL source and existing third-party notices are copied from the existing static preparation pipeline into Expo public assets.

Expo documents that public assets are bundled into the native binary for DOM components and must use the Expo base URL. It also documents that public assets are unsupported by EAS Update. Accordingly, **EAS Update is disabled**; bundled asset updates require a new reviewed binary.

Manabitan's pinned public ES modules use Metro's documented `@metro-ignore` escape hatch, only inside the browser/DOM graph; URLs are anchored to the HTML document, not the origin or the hashed JS chunk.

Metro's web-worker bundling is explicitly **alpha**. Browser Worker execution is not available in Hermes; all current DOM-dependent worker entry points must stay inside the DOM graph. Web and Android DOM production exports, not just TypeScript parsing, must verify:

- `features/whispersync/pitch/voice-pitch.worker.ts`, SwiftF0 ONNX model and ONNX WASM URL resolution
- `snippets/search-worker.ts`
- `library/library-content-search-worker.ts`
- optional `media/moss-worker.ts` when the existing video feature flag is enabled
- pinned Manabitan module worker, SQLite/OPFS/Web Locks behavior and corresponding-source packaging

A successful desktop browser run does **not** qualify Android WebView origin stability, OPFS, Web Locks, module workers, process-death recovery, text selection or real-device performance. Those remain explicit release gates until measured on the supported Android/WebView matrix.

The existing offline service worker is retained with a Metro-generated asset manifest; it must preserve scoped caches, optional lazy pitch downloads and user-font cache ownership. Production exports preserve static routes for the existing Python browser server and backend deployment shape. Nothing in this PR deploys the app or changes backend publication.

## Current parity inventory

Status is intentionally separate from coverage. `Ported` means source implementation exists, not that browser/native acceptance passed. This table will be updated with exact commands and outcomes as validation proceeds.

| Area | Web port | Android presentation | Existing coverage to retain |
| --- | --- | --- | --- |
| Reader: continuous, paginated, Foliate, typography, ruby, selection, search, annotations, progress | React/controllers ported; integration validation underway | Same DOM surface; native close/back bridge added | `test/reader`, `tests/browser/test_static_reader.py`, Foliate/navigation/style/lifetime suites, annotations/search/reader-control suites |
| Library, import/backup/export, selection, series/collections, organization, sources/previews | React/controllers ported; integration validation underway | Native local import/open/delete, paged sort/search, cached sources/folders, collections, metadata/series, completion and want-to-read controls implemented; provider access, content search and export/backup still open | Library/account ownership, import hydration/cancellation, collection commit, local/cloud relocation and library browser suites |
| Settings, appearance/themes/backgrounds, fonts, goals, sync | React/controllers ported; integration validation underway | 70 native controls, custom themes/dimensions/font selection and reset implemented; image/font transfer, goals and sync editor parity remain open | Settings/editor/modal/appearance/preference-sync suites |
| Account/connections, shared libraries, TTU migration | React route ports implemented; integration qualification underway | Native refresh/logout shell implemented; native sign-in/session handoff and provider/local-folder UI remain open | Auth/account lifecycle, connections/shared-safety/WebDAV/TTU suites |
| Snippets and rich-text editing | React/controller screen ported; focused tests pass, full integration pending | Native structured-text/ruby editor, shelf/search, durable draft recovery, duplicate/trash/restore and scoped DOM snippet reading implemented; advanced rich formatting, transfer recovery, full conflict tools and portability remain open | `test/snippets`, snippets browser/integration suites |
| Statistics and reading goals/history | React/controller screen ported; focused tests pass, full integration pending | Scoped native summary/history/heatmap and deletion implemented; advanced editors/goals parity pending | Statistics deletion/identity/goals/history suites |
| Audiobook/Whispersync/pitch | React reader panel ported; runtime verification pending | Browser media/pitch retained in DOM initially; native background playback qualification remains open | `test/whispersync`, `test/pitch`, voice-pitch/Whispersync browser suites |
| Optional video learning | React lifecycle port retains the existing optional VideoWorkspace and release flag | Native media presentation pending | Existing optional media workflow and integration suites |

### Validation recorded so far

- CI checkpoint `a9b43c60e23ad221458412f2dc66f8d572cb0616`: full strict app TypeScript, retained reader regressions, snippets domain/React integration, and Whispersync coverage passed. Unit/migration failures were undeclared root `idb`/`p-limit` test imports under strict pnpm; fixed without dropping assertions. Web export then found missing WOFF/WOFF2 asset extensions; Android graph found ORT minified import-comment incompatibility. Browser tests did not receive a valid completed export on this checkpoint. The generated exact patched dependency graph was recovered from CI; frozen-lockfile admission is restored for the next checkpoint.
- New artifact verification inspects real web, Android export and APK output separately, including reachable module workers, fonts/model/WASM bytes, dictionary corresponding source, CSP and service-worker precache. Synthetic fixtures/installed-exporter tests are distinct from actual output qualification; see [ASSETS.md](ASSETS.md).

- Working tree as of 2026-10-02: 1,331 existing/adapted unit tests pass locally with zero skipped; 51 migration tests pass. This is not the result for the published head until the associated commit is identified by CI. Original button-render assertions now exercise actual React components.
- First real CI head `8b0c0a01cefdaed633930326ff5689c465162bee`: dependency/dictionary/public preparation passed. Both web and Android Metro exports failed resolving a retained TypeScript `.js` specifier. A local-source-only fallback now preserves normal Metro resolution first, then substitutes TypeScript siblings; it never rewrites npm imports. Strict CI reported 171 migration diagnostics, being fixed with concrete types and original behavioral tests. Reader (163 tests) and Whispersync (98 tests with coverage) passed on that head; browser acceptance was skipped because exports failed.
- Reader and library React entries bundle through a real esbuild dependency graph without a Svelte component loader. These are focused integration checks, not production Expo exports.
- Reader controller/readiness and library lifecycle/IME source tests are being adapted to the active React implementation. Tests that still inspect legacy `.svelte` sources are not counted as evidence for the new UI.
- Global Sass/public-asset preparation passes. Actual Metro production web export reaches the application graph, but a 384 MiB attempt exhausted its heap and a single-worker 768 MiB attempt was SIGKILLed in this sandbox. Production web/Android exports are being qualified on normal PR CI. Full browser acceptance remains unrun locally because Chromium socket launch and cloud localhost access are blocked.

## Secure Android reader host

The exact `@expo/dom-webview@57.0.1` patch in [patches/reader-dom](../../patches/reader-dom/README.md) gives the persistent DOM owner a stable packaged HTTPS origin through AndroidX WebViewAssetLoader. It blocks main-frame navigation, scopes message receipt to the exact origin/main frame, disables native-module evaluation and file-origin bypasses, and fails closed on unsupported WebView features. Imported EPUB frames are scriptless on Android. User-gesture external links are revalidated before Custom Tab opening. The patch's JVM URL policy has 89 executable assertions; Kotlin compilation, APK assets and device OPFS/Web Locks/worker persistence remain unqualified.

Book selection tokens are checked against content identity at the actual read/delete boundary. Reader authorization outlives the asynchronous bridge reply and is revoked on replacement, close, teardown or account generation change. This avoids treating `setBookId` as a completed authorized load.

## Native account boundary

The existing web app uses same-origin Django session cookies and CSRF/account-generation checks. A locally packaged Android DOM origin is a different transport. The draft must not weaken CORS, copy browser cookies into imported content, or invent a backend token endpoint to claim sign-in parity. Native sign-in and cloud-provider flows require a verified first-party session handoff/transport contract. The current Android UI labels that limitation and local reading remains available. This is a release blocker, not a silently successful sign-in implementation.

## Future desktop direction

Windows/Linux are architecture considerations only, not build targets in this PR. Keep portable controllers/data contracts separate from Android-specific modules and DOM geometry. React Native Windows and community Linux renderer efforts have different module/toolchain support; they must be evaluated independently before adding a host. A web/PWA distribution remains available on those desktops. No future desktop choice changes the decision to keep iOS/macOS as separate native applications.

## Primary implementation references (checked 2026-10-02)

- [Expo SDK release catalog](https://expo.dev/changelog)
- [Expo universal UI](https://docs.expo.dev/versions/latest/sdk/ui/universal/)
- [Expo DOM components: asynchronous actions, public assets, native execution boundary](https://docs.expo.dev/guides/dom-components/)
- [SDK 57 Metro: CSS/Sass, asset imports and alpha web-worker support](https://docs.expo.dev/versions/v57.0.0/config/metro/)
- [Expo FileSystem: bounded FileHandle reads](https://docs.expo.dev/versions/latest/sdk/filesystem/)
