# Production export and APK asset gates

Run these checks on **generated artifacts**. Source imports, passing bridge tests,
`prepare-expo.mjs`, and an Android `expo export` are not proof that a WebView can
load its packaged resources.

```sh
node scripts/verify-expo-export.mjs --platform web --output apps/web/build \
  --report apps/web/web-asset-report.json
node scripts/verify-expo-export.mjs --platform android --output apps/web/dist-android \
  --report apps/web/android-export-asset-report.json
node scripts/verify-expo-export.mjs --platform apk \
  --output apps/web/android/app/build/outputs/apk/release/app-release.apk \
  --report apps/web/apk-asset-report.json
node --test test/expo/export-assets.test.mjs
```

`--output` for the APK gate also accepts an unpacked APK root containing
`AndroidManifest.xml`, `classes*.dex`, and `assets/index.android.bundle`. An APK
file is inspected with standard `unzip`; corresponding-source archives use `tar`.
The fixture tests additionally use `zip`. No network, install, app build, or
Android emulator is needed to run those focused tests.

`--base` / `BASE_PATH` defaults to `/reader-web`. The Android DOM base is always
relative `./`. `--media true|false` overrides `EXPO_PUBLIC_ENABLE_VIDEO_LEARNING`,
then `VITE_ENABLE_VIDEO_LEARNING`; the default is `false`. Use the **same explicit
flag** for preparation, export, Gradle, and verification. The verifier does not
silently skip a missing optional runtime when the feature is enabled.

## Exact SDK topology

The reviewed installation is Expo **57.0.26**, whose nested `@expo/cli` resolves
to **57.0.27**. The executable exporter is under
`node_modules/expo/node_modules/@expo/cli`, not an unrelated hoisted CLI.

| Stage | HTML and generated JS/CSS | Imported fonts/model/WASM | Public assets |
| --- | --- | --- | --- |
| Web export + postbuild | `index.html`, route aliases, `_expo/static/**` | Path-preserving `assets/**` | Export root |
| Android `expo export` | `www.bundle/<content-md5>.html/js/css`, native `.hbc` bundle, `metadata.json` | Extensionless `assets/<hash>` entries in metadata | Export root |
| Android Gradle release (`export:embed`) | APK `assets/www.bundle/<component-path-md5>.html`, `assets/www.bundle/_expo/static/**` | APK `assets/www.bundle/assets/**` | APK `assets/www.bundle/**` |

These are deliberately different formats. `exportDomComponentAsync` receives
`baseUrl: './'`. Update exports additionally use `useMd5Filename: true`, rename
serial assets, update the native HTML reference, and append DOM asset metadata.
Embedded release exports preserve the browser-style paths and copy the public
folder underneath `www.bundle`. The Reader DOM host patch serves that directory
at `https://appassets.androidplatform.net/www.bundle/`.

The SDK's update output may retain worker/chunk URLs from before its MD5 relocation.
The Android-export gate reports these unresolved browser URLs as warnings: it
verifies the update inventory and does **not** certify that inventory as a runnable
WebView package. The web and APK gates treat unresolved local URLs as failures.
**EAS Update remains disabled** in `app.config.ts`; this checker does not enable,
publish, or certify an OTA update. Changes to this topology or enabling OTA require
separate review.

Focused fixtures call the actual installed `exportDomComponentAsync` and
`createMetadataJson` with a stub Metro producer. They exercise the exporter, HTML
serialization, MD5 renaming, metadata, and the verifier; they do not run or claim a
production application export. The embedded public-copy/path contract is also
checked against the installed exporter source.

## What is checked

- Generated HTML entry scripts, CSS, every compatibility route alias and `404.html`
- Web prefix and Android document-relative references, with generated Metro
  dependency maps followed from HTML entries to reachable chunks/workers
- Reader, library-content, snippet-search and voice-pitch module-worker calls and
  local bundle targets and matching Metro worker-entry module IDs (including MD5
  update artifacts); enabled media adds the MOSS worker
- Every prepared font import, SwiftF0 `swift-f0-0.3.0.onnx`, and the installed ORT
  `ort-wasm-simd-threaded.wasm`: actual exported bytes must match their inputs, and
  web/APK builds must contain reachable generated runtime URLs for them
- Public-copy byte identity, including icons, web manifest, legal notices, and
  pinned Manabitan content. No fallback to source files can satisfy a missing
  output
- The pinned Manabitan revision/API/search contract, every declared asset's size
  and SHA-256, `web/worker.js`, `lib/sqlite/sqlite3.wasm`, client/render/presets and
  their exported ESM import graph, recommendations, CSS, license, source notice,
  readable corresponding-source archive with build inputs, and the default
  dictionary archive checksum
- Explicit media-on builds: both single-threaded and threaded MOSS public runtimes
  with build-manifest hashes. Media-off builds must not contain `moss/` public
  payloads
- Web CSP on every HTML alias, permitted local scripts/module workers/WASM,
  bootstrap SHA-256 hashes, and absence of broad executable escape hatches
- The **actual generated service worker's install handler**, executed in a bounded
  VM with mocked caches. Entry JS and route URLs must be requested; dictionaries,
  dictionary archives, MOSS, fonts, voice-pitch worker, ONNX and WASM must remain
  lazy. Merely listing the correct URLs in `expo-build-manifest.json` is insufficient
- Android update metadata paths, native entry, content-MD5 DOM names, HTML reference
  in the native bundle, and imported assets' metadata membership
- APK native entry/dex/manifest presence and the actual `assets/www.bundle` tree.
  Public files accidentally copied to APK root or `dist-android` do not count

## Integration notes

Run `prepare-dictionary.mjs` before `prepare-expo.mjs`; the latter replaces `public`
from `static`, including the pinned runtime. Run `expo-postbuild.mjs` **only after
web export** and before the web gate. It adds route aliases/CSP and generates the
service worker. A public-directory copy alone is not an application build.

Public dictionary ESM imports must survive Metro (`@metro-ignore`, not the old
Vite-only directive). Dictionary archive/recommendation URLs on Android must
resolve against the document URL, not `location.origin`, which would discard the
`/www.bundle/` path. The verifier follows emitted static public-module imports;
browser/device acceptance must exercise dynamic imports and fetches as well. In
particular, relative model/WASM URLs used inside a module worker resolve from that
worker’s URL unless explicitly anchored by the runtime. The static gate inventories
Metro asset literals against the document root; it does not execute ORT or prove
that a worker passes the correctly anchored URL to fetch.

The service worker derives a separate scope-specific shell. Public dictionary and
model payloads must never become required install requests. Changing filenames or
splitting can break lazy-asset matching; that is why this gate runs the emitted
install handler rather than reimplementing its filter from source.

## Limits and acceptance evidence

A green web gate means the static artifact contract passed; it does not prove
browser behavior. A green Android-export gate means the update inventory passed;
it is explicitly **not APK readiness**. A green APK gate proves packaged asset
availability and static reference integrity, not Android execution.

Keep the PR in draft until CI produces actual exports and a release APK, and
separate device tests cover module-worker startup, SQLite/WASM initialization,
ONNX/ORT loading, offline first launch, secure origin, OPFS/Web Locks/IndexedDB,
restart/update persistence, navigation/bridge isolation, and interrupted or
repeated flows. Check disabled EAS Update in resolved configuration/native output
alongside the existing platform and host-policy tests. Neither fixture success nor
source inspection substitutes for those gates.

### Primary sources

- [Expo DOM components](https://docs.expo.dev/guides/dom-components/)
- [Android local-content loading](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
- [Pinned Manabitan build contract](https://github.com/ManabiIO/manabitan/blob/4db879b7b5bcb749f90042a313669526ef2f57f4/web/build.mjs)
- [Pinned Manabitan module-worker client](https://github.com/ManabiIO/manabitan/blob/4db879b7b5bcb749f90042a313669526ef2f57f4/ext/web/client.ts)
