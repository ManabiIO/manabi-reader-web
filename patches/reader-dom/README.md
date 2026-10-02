# Android reader DOM secure-origin adapter

Status: **source/JVM contract verified; Android Kotlin build and device/runtime qualification still required**. This adapter is not an Android acceptance result.

## Why an exact dependency patch

The installed `expo@57.0.26` Android DOM entry is `file:///android_asset/www.bundle/<32-character hash>.html`. In `@expo/dom-webview@57.0.1`, `originWhitelist` is an unsupported prop, file access is enabled implicitly, and the DOM protocol uses an all-frame `addJavascriptInterface`. Merely adding a whitelist or disabling the nominal JS file-access props does not fix that implementation.

`expo-dom-webview-57.0.1.patch` adds an Android-only, opt-in adapter to that exact package. Unmodified native platforms are outside this migration. The patch leaves Expo's DOM imperative commands and the application's `execute`/`onReply` protocol intact. It does not add a general filesystem, native evaluation, credential, or network API.

The touched upstream files and SHA-256 digests are recorded in `upstream.json`. A package upgrade requires re-review and regeneration of the patch; never silently apply it to another version. `contract.test.mjs` accepts either a pristine or already-patched installation and verifies the original sources before testing the patched result in a temporary directory.

## Integration contract

Pin `@expo/dom-webview` to `57.0.1` and declare this patch in the workspace's pnpm `patchedDependencies` mapping:

```
'@expo/dom-webview@57.0.1': patches/reader-dom/expo-dom-webview-57.0.1.patch
```

SDK 57 enables precompiled Android AARs by default. A source patch alone does **not** change that binary. The app's `package.json` sets `expo.autolinking.android.buildFromSource: ["expo-dom-webview"]`. In the installed SDK, `SettingsManager.configurePublication` matches Gradle project names, so the npm-scoped name `@expo/dom-webview` is insufficient. The guard runs the installed autolinker, checks the exact module version and project, checks the pattern using the native full-match semantics, and requires the patched source files before Gradle compilation. CI then requires `:expo-dom-webview:testDebugUnitTest` and release APK assembly; omitting the source module fails the build. See [Expo's precompiled module guidance](https://docs.expo.dev/guides/prebuilt-expo-modules/) and [autolinking configuration](https://docs.expo.dev/modules/autolinking/#buildfromsource).

The parent application must pass these Android DOM properties to its **single persistent** trusted reader owner:

```ts
interface ReaderHostDOMProps {
  manabiReaderHost: true;
  manabiReaderDevOrigin?: string;
  onReaderExternalLink(event: { nativeEvent: { url: string } }): void;
  onReaderHostError(event: { nativeEvent: { message: string } }): void;
  useExpoDOMWebView: true;
  unstable_useExpoModulesBridge: false;
}
```

`expo/dom`'s `DOMProps` uses RN WebView types, so the application needs a local intersection type for these patched properties. Both the package's source and declaration types are patched as well.

- Surface `onReaderHostError.nativeEvent.message` as a startup error; do not fall back to an insecure WebView
- Revalidate `onReaderExternalLink.nativeEvent.url` with the app's `safeExternalLink` and open with `expo-web-browser.openBrowserAsync`; the native adapter blocks host navigation and emits only a user-gesture, main-frame, GET, HTTP(S), credential-free URL
- Keep `unstable_useExpoModulesBridge` false. Secure mode rejects it and always makes the native evaluation entry return null
- Keep EAS Update disabled. This implementation deliberately accepts only an embedded APK DOM entry, never an update-cache or arbitrary local-file URL
- Keep imported EPUB frames scriptless on the Android DOM host. A same-origin frame with `allow-scripts` could call a parent object despite an `isMainFrame` guard. The existing Safari/WebKit event workaround in Foliate must not enable scripts in Android's Chromium reader frames

### Development only

Omit `manabiReaderDevOrigin` in a production build. Supplying a nonempty value to a non-debuggable Android application is rejected, even if the DOM source is packaged. For development, supply one explicit Metro origin, such as `http://localhost:8081`, only from the application's real development configuration. The loaded entry must have that same origin and the Expo `/_expo/@dom` path. Neither wildcard hosts nor arbitrary production HTTPS URLs are accepted.

A development HTTP origin on a device/LAN is not necessarily a secure context. It is not evidence that production OPFS, Web Locks, or workers work. Qualify the packaged HTTPS build.

## Origin and offline asset ownership

Production root:

```
https://appassets.androidplatform.net/www.bundle/<32-character hash>.html
```

Only the source passed by the native application can establish the root, and the root cannot change in the lifetime of that host. Fragment changes are allowed; another path, query, scheme, or origin is not. New APK revisions can have a different HTML hash while retaining the same origin and app-owned WebView storage profile. There is no public DNS ownership claim: `appassets.androidplatform.net` is Android's reserved asset-loader domain, and these responses come from this application's APK. Do not change this origin casually: IndexedDB and OPFS are origin-keyed. An origin change requires an explicit data migration, not a silent reset.

The loader maps `/www.bundle/` only to APK `assets/www.bundle/`. It exposes no other APK assets, internal storage, `content://`, resources, or arbitrary filesystem path. Traversal, encoded traversal/separators/NUL, double-encoded escapes, empty and ambiguous paths are rejected. Missing paths under the asset origin produce a local 404, never a network fallback. `mjs`/`js` have JavaScript MIME types and `wasm` has `application/wasm` for module workers and streaming compilation.

Verified against the installed Expo 57 exporter source:

- `exportDomComponents.js` writes the hashed HTML and its Metro JS/assets beneath `www.bundle/`, with `baseUrl: './'` for emitted HTML/resources
- `exportEmbedAsync.js` chooses the Android JS bundle's asset directory, persists DOM files there, and copies the app's **public directory into `www.bundle/`**
- The app's `scripts/prepare-expo.mjs` copies existing static assets into public. The pinned Manabitan preparation remains required before it, including its manifest, module worker, WASM, license, and GPL corresponding source archive
- Relative `./manabitan/<revision>/...` and `./_expo/...` URLs therefore retain the same layout from the HTTPS entry. This patch does not rename, rewrite, omit, fetch remotely, or relicense any of those assets

`expo export --platform android` is not an APK and is not proof that a Gradle embed actually includes all public assets. Inspect the release APK/AAB and exercise its worker requests offline.

The WebView uses the application's ordinary persistent profile (`domStorageEnabled = true`) and does not clear cookies, IndexedDB, OPFS, or caches on destroy/reload. WebView/API availability, quota, OS eviction, app clear-data, uninstall, and app backup/restore remain real persistence constraints. Browser/site data from the old web deployment is a different origin/profile and is not automatically imported.

## Trust boundary

Before loading the secure root, the adapter removes both all-frame JavaScript interfaces, disables file/content access and file-origin bypass flags, disallows mixed content and automatic popups, and disables release WebView debugging. AndroidX's origin-scoped WebMessageListener checks the actual source origin, `isMainFrame`, and the current exact trusted root. A document-start script exposes only Expo's bounded message transport and initial props to that root. Incoming message strings are bounded at 1 MiB; application-level bridge validation remains authoritative.

This requires Android System WebView support for `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT`. Missing features fail closed with an actionable host error. `androidx.webkit:webkit:1.14.0` is explicitly included, matching this migration's installed RN WebView dependency; those two APIs are stable by 1.9.0. This is a library dependency, not a promise about the installed device WebView.

Main-frame navigation is restricted in both navigation and request callbacks, with an additional page-start guard. Third-party frame navigations are blocked; renderer-owned blob/data/about frames and packaged resources remain possible. Origin/frame checks still reject their direct bridge attempts. Existing sanitization and scriptless Android EPUB frames are mandatory. This patch is not a substitute for sanitizing imported books and dictionary HTML.

App API requests remain normal browser fetches governed by CORS and WebView policies. There is no native fetch proxy or credential forwarding. The Django/API deployment must explicitly support the intended Android app-origin authentication/CORS flow; this patch does not broaden backend CORS or cookie policy.

## Reproducible checks

From the repository root, with Node 24 and Java 21 available:

```
node --test patches/reader-dom/contract.test.mjs
```

The test verifies clean patch application; compiles and executes the **actual patched Java URL policy** using the JDK compiler module; tests hostile source/navigation/origin/path cases, asset topology and persistent canonical origin; executes the actual injected bootstrap in JS; and checks security hooks and SDK 57 exporter layout. These are source/JVM/JavaScript checks, not a WebView simulation. The patch also includes JUnit `ReaderDomPolicyTest` for the native module's `testDebugUnitTest` task.

### Remaining Android acceptance gates

1. Resolve the reviewed lock/patch, Android-only prebuild, and compile the patched native module and release APK. Record the resolved AndroidX graph and run native JVM tests
2. Inspect APK `assets/www.bundle/` for the root HTML, Metro JS/workers/fonts, pinned Manabitan manifest/worker/WASM/license/corresponding-source archive. Turn off networking before first launch. Verify all these resources load locally, including a deliberate missing-resource 404 with no DNS/network request
3. Record `location.origin`, `isSecureContext`, WebView version, `indexedDB`, `navigator.storage.getDirectory`, `navigator.locks`, module-worker startup, and actual Manabitan SQLite/WASM initialization. Exercise dictionary import and search. A property-existence check alone is insufficient
4. Write a book, annotation, reading position, dictionary, preference and a disposable OPFS sentinel; terminate/restart the process, reboot, and install a same-package/same-signature update with a changed DOM HTML hash. Verify retained state. Ensure test cleanup removes only test-owned sentinels
5. Attempt cross-origin, same-origin wrong-path, credential-bearing, file/content/data/intent/javascript and encoded-traversal main-frame navigation. Verify the root never changes. Attempt iframe bridge posts (including same-origin/blob), and verify none reaches the native action dispatcher
6. Tap valid HTTP(S) links and confirm only the system browser/Custom Tab opens. Test target-blank links and redirects explicitly; unsupported popup flows must fail closed rather than navigate the privileged host
7. Exercise background/resume, renderer termination/recovery, account change/logout during replies/import, repeated native-screen/reader switching, and retained session/epoch protections. Test both supported and unsupported WebView feature paths
8. Verify disabled EAS Update, no Apple targets, no native module evaluation, no file-origin bypass, and no unexpected service worker registration in the embedded reader

Until these are recorded, keep Android runtime readiness and OPFS/Web Locks persistence **unqualified**.

## Primary references

- Android local-content loading and file-origin warnings: https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
- WebViewAssetLoader and reserved origin: https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader
- Origin-scoped messaging / document-start script contract: https://developer.android.com/reference/androidx/webkit/WebViewCompat
- AndroidX WebKit dependency/releases: https://developer.android.com/jetpack/androidx/releases/webkit
- Expo DOM component limitations and APIs: https://docs.expo.dev/guides/dom-components/
- Exact reviewed upstream package source: https://github.com/expo/expo/tree/b9503d06b8e130abfca1bc16f671dbefb41ad709/packages/%40expo/dom-webview
