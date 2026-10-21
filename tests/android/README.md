# Packaged Android reader smoke qualification

Status: both packaged instrumentation phases passed on SDK 58 source `9aeb3ad1`
in [run 39473146431](https://github.com/ManabiIO/manabi-reader-web/actions/runs/39473146431/job/118802173201),
on API 35 with WebView 124.0.6367.219. This qualifies the synthetic host checks
below on that exact APK. New source and the wider device/product matrix still
require their own qualification; local unit tests or compilation alone do not
establish runtime acceptance.

This suite starts the generated Expo app's real launcher activity using
the platform `Instrumentation.startActivitySync`, traverses its actual view hierarchy (including the
persistent offscreen reader), and inspects that WebView. It does not construct a
replacement host, load a fixture HTML page, enable release WebView debugging,
replace the `WebViewClient`, install a JavaScript interface, or change the host's
security settings. The test-only probe is read from the separate test APK and
executed with `WebView.evaluateJavascript` under Android instrumentation.

## Build, then run

Use Node 24.21, the reviewed dependency lock, Java 21, and the normal Android SDK.
Prepare pinned dictionary/public assets and run Android-only Expo prebuild through
the existing workflow first. The preparation script fails unless the generated
application ID is exactly `io.manabi.reader`. From the repository root:

```sh
node --test tests/android/harness.test.mjs
node scripts/prepare-android-qualification.mjs
node scripts/verify-reader-dom-autolinking.mjs
cd apps/web/android
./gradlew :expo-dom-webview:testDebugUnitTest :app:assembleRelease :app:assembleReleaseAndroidTest --no-daemon --max-workers=2
cd ../../..
```

The script adds an idempotent Gradle include and `src/androidTest` files only in
the ignored generated Android project. JUnit 4.13.2 assertions are the only
test dependency. A small platform `Instrumentation` subclass runs this one
qualification, reports normal instrumentation test status, and emits success
only after assertions and cleanup complete. It rejects another requested test
class. This avoids AndroidX Test's dependency on app-shared libraries that R8
may remove from the release APK. The tested build type is the
ordinary non-debuggable **release** target. The generated Expo template's local
CI signing configuration must match the test APK; do not supply production keys.
No test assets or probe hook are added to the target APK. Clean Expo prebuild
removes the instrumentation wiring; rerun preparation afterward.

Provision a new disposable AVD using the official SDK `sdkmanager`/`avdmanager`
and an API 35+ Google APIs x86_64 image (with a current Android System WebView).
Use runner-supported hardware acceleration. The first CI
attempt on `727b360e` lacked KVM device access; software x86_64 emulation timed
out before boot after 600 seconds, with no APK installation or assertions. The
current migration workflow uses the specifically approved three-command temporary-runner
KVM setup from GitHub’s official guidance, records capability diagnostics and
fails fast rather than retrying a software boot loop. That approval is scoped to
the disposable GitHub runner; do not change another machine’s permissions,
disable security checks, or install unreviewed runner actions. A typical official-tool boot, once the image is
available, is:

```sh
printf 'no\n' | avdmanager create avd --name manabi-reader-qualification --package 'system-images;android-35;google_apis;x86_64'
emulator -avd manabi-reader-qualification -port 5554 -accel on -no-metrics -no-window -no-audio -no-snapshot -gpu swiftshader -no-boot-anim > emulator.log 2>&1 &
export ANDROID_SERIAL=emulator-5554
adb wait-for-device
# Wait (with an outer timeout) until adb shell getprop sys.boot_completed is 1.
bash tests/android/run-qualification.sh
```

The runner refuses physical devices, non-emulator serials, incomplete boots, and
AVDs already containing the app or its test package. It never clears app data or
uninstalls an existing package. It installs the app and test APK on the fresh
emulator, runs seed instrumentation, force-stops that synthetic app process,
then runs verification with the same random identifier. Verification requires a
new process ID, unchanged canonical entry, retained sentinels, and successful
cleanup. Both the runner's exact success summary and complete structured evidence are
required because `adb am instrument` can exit zero for failed tests.

Keep `test-results/android/`, the APKs, and the original APK asset-qualification
report together during a local qualification. The migration’s
[zero-storage CI plan](../../docs/expo/CI-COVERAGE.md) keeps those files only on the
disposable runner and prints evidence to logs/job summaries; it does not upload
artifacts or save remote caches. The report records APK SHA-256 hashes, emulator fingerprint, WebView
provider/version, canonical entry, native settings, probe results and navigation
attempts. A failed run is failure evidence, never a pass. If the seed process
crashes, its synthetic namespace can remain in that disposable AVD; discard the
AVD rather than clearing any general-purpose app profile.

The instrumentation's `full` default checks reload persistence and removes its
random namespace in a single process, but it
does **not** establish force-stop/process-restart persistence. Use the two-phase
runner for that claim.

## Assertions made by a passing two-phase run

- Real native Library app heading, empty-library explanation and non-fallback pagination, requiring
  DOM `onSnapshot` → native routing and native `library.state` → DOM `onReply`;
  the existence of a JavaScript bridge shim alone is insufficient
- Actual packaged HTTPS root, secure context, read-only Expo DOM bootstrap, no
  native evaluation bridge, DOM storage enabled, file/content and file-origin
  access disabled, mixed content denied, automatic/multiple windows disabled
- Actual IndexedDB committed read/write and OPFS create/write/close/read, retained
  after document reload and app process termination/relaunch
- Actual exclusive Web Lock contention and acquisition after release
- Real pinned APK dictionary manifest and worker bytes (SHA-256/length), real
  packaged module-worker startup with its imports, and its expected `not_open`
  response to a non-writing `status` request. The dictionary is deliberately never
  opened, imported, reset, or deleted by this probe
- Real pinned SQLite WASM bytes, `application/wasm`, and successful streaming
  compilation in the app WebView
- Missing asset, double-encoded traversal and outside-prefix requests return 404
- Script-driven main-frame attempts to a wrong packaged path/query, external
  HTTPS URL, synthetic credential-bearing URL, encoded traversal, file, content,
  data and intent URLs leave both trusted entry and original document intact
- Cleanup deletes only `manabi-android-qualification-<random 32 hex>` IndexedDB
  and OPFS entries owned by that run. Unrelated namespaces are untouched

## Explicitly still unqualified

This narrow smoke is not complete Android acceptance. It does not test real
book/annotation/import data, a dictionary open/import/search, SQLite database
initialization, ONNX/ORT inference, worker OPFS synchronous handles, an APK update
with a changed HTML hash, OS reboot, storage eviction/quota, unsupported WebView
features, same-origin iframe bridge-dispatch rejection, actual scriptless EPUB
frames, renderer crashes, account changes, repeated native navigation, or
user-gesture links/Custom Tabs and redirects/popups.

No network-offline or no-DNS claim follows from this suite: it requests canonical
APK URLs and verifies packaged byte hashes, but does not turn off networking or
capture network traffic. `javascript:` execution is also not treated as blocked
navigation: the test already executes trusted page JavaScript, and Android does
not deliver every such URL to the navigation callback. Those trust-boundary and
offline gates remain separate before Android runtime readiness is declared.

## Official API references

- [Platform Instrumentation lifecycle, activity launch and status reporting](https://developer.android.com/reference/android/app/Instrumentation)
- [Instrumented tests from the command line](https://developer.android.com/studio/test/command-line)
- [Official emulator command-line options](https://developer.android.com/studio/run/emulator-commandline)
- [Local WebView content and HTTPS asset loading](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)

- [GitHub-supported Android virtualization and its explicit host permission setup](https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/)

### Native Settings font-manager journey

Both process phases also traverse the actual RN/Compose accessibility hierarchy:
Library actions → Settings → Fonts & text → primary font manager → Close → Back
to Library. The test
requires the real cache-read empty state from the DOM owner. The font-manager
portion selects no font file or preference. Evidence must include
`settings-typography-font-cache-read-and-close`; importing a component or merely
finding a bridge shim is insufficient. That read-only font journey complements
the original synthetic storage/origin probes. It is not proof of the Android
system file picker, physical-device typography, TalkBack or IME parity.

The choice-control follow-up adds a color-mode interaction in Settings before
opening Fonts & text. In both process phases it requires the actual accessible
selected/enabled state, selects a different mode, reads the saved value from the
real local owner, then restores the original choice through the native control.
Cleanup restores the exact initial localStorage value, including an absent key.
The evidence verifier requires `color-mode-selection-local-save-and-restore`;
merely mounting the component cannot satisfy this gate. This is one native
interaction with storage verification, not spoken TalkBack or full Settings
coverage. Its result is only established by a completed run on this source.

Theme chooser qualification additionally opens Add custom theme in the shared
native dialog, cancels with Android Back, reopens it and uses Close. Both exits
must restore access to the chooser while leaving the exact `customThemes` local
value unchanged. The verifier requires `add-dialog-back-and-close-without-save`
in both process phases. This exercises dialog entry and dismissal, not native
color entry, IME, editing/saving a palette or spoken TalkBack.

The storage probe also copies one actual packaged font into its random, test-owned
CacheStorage namespace, loads it through a Blob URL using the WebView FontFace API,
and repeats that load after reload and process restart. It removes only its own
cache at cleanup. This qualifies cached-font loading in the host, not a document
picker import, visual font comparison, or modifications to the user's font catalog.

Size-editor qualification uses the actual Compose range accessibility action in
both process phases. It checks a positive pixel save in the DOM owner, observes
the saved range back in the native control, selects the named Automatic action,
and verifies the zero sentinel. Cleanup restores the exact original raw local
value (including absence). The evidence verifier requires `nativeDimensions` to
be `slider-completion-and-automatic-local-save-with-exact-restore`. This exercises
accessible range completion and the save bridge; it does not prove physical
drag/rotation/cancellation, spoken TalkBack, or the device/large-text matrix.

### Native background image journey (current gate; runtime result pending)

The background journey requires API 29+ (CI uses API 35). On the fresh disposable
emulator, seed opens the native editor, cancels the real Android document picker,
then selects three test-owned PNGs through that picker. MediaStore fixtures are
unique to the qualification ID and are removed after each transfer. The app's
ordinary import path writes library light/dark and reader light into its real
appearance database; the unselected reader dark slot must remain absent.

Both process phases read SHA-256 hashes of the actual persisted slot bytes and
require light and dark Library image views to draw the corresponding decoded
pixels. Native-view capture excludes the separate intentional fade overlay.
The second phase must retain exactly the same saved image records after a real
force-stop/process restart. It removes only Library light, verifies the other
two records are unchanged, then uses both Remove-both actions and requires the
native background view to disappear. The exact original appearance preference
is restored. `nativeBackgrounds` evidence and cross-process byte equality are
required; a missing field, empty record map or component-only result fails.

Unlike the isolated storage sentinel probe, this journey uses the product's real
appearance store, initially required to be empty. It runs only on the runner's
fresh disposable emulator, never an existing device profile. If it fails, test
images may remain there until that emulator is discarded. Compilation and unit
harness results do not establish a successful system-picker/native-image run.

### Actual custom-font import and restart journey (runtime result pending)

Seed now cancels the real font picker with a named draft, verifies the catalog,
cache and family preferences remain untouched, and then selects a unique copy
of a real bundled WOFF2 font from Android Downloads. The product's ordinary
file-copy/chunk-import path must preserve its bytes. The test-owned source entry
is deleted afterward. Import must not select a font; the native Use action must
select it. The product's own `ttu-userfonts` stylesheet must materialize the
cached face as a Blob URL, and `document.fonts.load` must decode that exact face.
No test FontFace or CSS is installed into the APK's WebView.

The font must survive both document reload and real process restart, with exact
name/path/hash comparison across the two evidence records. The second process
cancels removal once, then confirms it and requires the catalog, bytes and CSS
to disappear. Only the selected primary family resets; the other family remains
unchanged. A random test-only localStorage sentinel preserves exact original raw
preferences for cleanup. The old read-only manager journey runs before seed
import and after verification cleanup, retaining its empty-catalog assertions.

`nativeFontPicker`, seed `nativeFontImported`/`nativeFontAfterReload`, and verify
`nativeFontCleanup` are mandatory evidence. Probe unit tests and the separate
real-browser font codec check do not establish native runtime acceptance.

### Picker source navigation repair

Run [39515114181](https://github.com/ManabiIO/manabi-reader-web/actions/runs/39515114181)
at `d4063de44ab4aca4b3446ac698b9fae4359530ec` passed both web jobs and built
both APKs. Its Android seed phase passed the existing choice, dimension and font
preference/manager controls, then failed before the first background import:
DocumentsUI showed an empty **Recent images** view and could not find the
newly created fixture. This run does not qualify background persistence or pixels.

The harness now verifies each source MediaStore record is published, nonempty,
and has the expected name/MIME type, then navigates the real system picker's
Images or Downloads root into `ManabiQualification` before selecting the exact
file. It does not depend on the cached aggregate Recent view. Source-fixture
cleanup and every existing persistence, decoded-pixel, cancellation and process
restart assertion remain required. Java/API compilation is not proof that the
revised picker navigation has passed; the next exact-source emulator run must
establish that result.
