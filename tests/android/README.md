# Packaged Android reader smoke qualification

Status: the harness has local Node tests; **Android compilation and emulator
execution are separate required gates**. Do not report runtime qualification from
source checks or from the harness unit tests.

This suite starts the generated Expo app's real launcher activity using
AndroidX `ActivityScenario`, traverses its actual view hierarchy (including the
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
the ignored generated Android project. Dependencies are test-scoped AndroidX
`core:1.7.0`, `runner:1.7.0`, and `ext:junit:1.3.0`. The tested build type is the
ordinary non-debuggable **release** target. The generated Expo template's local
CI signing configuration must match the test APK; do not supply production keys.
No test assets or probe hook are added to the target APK. Clean Expo prebuild
removes the instrumentation wiring; rerun preparation afterward.

Provision a new disposable AVD using the official SDK `sdkmanager`/`avdmanager`
and an API 35+ Google APIs x86_64 image (with a current Android System WebView).
Use only runner-supported hardware acceleration or the emulator's software
fallback. Do not change `/dev/kvm` permissions, disable security checks, or install
unreviewed runner actions. A typical official-tool boot, once the image is
available, is:

```sh
printf 'no\n' | avdmanager create avd --name manabi-reader-qualification --package 'system-images;android-35;google_apis;x86_64'
emulator -avd manabi-reader-qualification -port 5554 -no-window -no-audio -no-snapshot -gpu swiftshader -no-boot-anim > emulator.log 2>&1 &
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
cleanup. Both JUnit's exact success summary and complete structured evidence are
required because `adb am instrument` can exit zero for failed tests.

Archive `test-results/android/`, the APKs, and the original APK asset-qualification
report. The report records APK SHA-256 hashes, emulator fingerprint, WebView
provider/version, canonical entry, native settings, probe results and navigation
attempts. A failed run is failure evidence, never a pass. If the seed process
crashes, its synthetic namespace can remain in that disposable AVD; discard the
AVD rather than clearing any general-purpose app profile.

`connectedReleaseAndroidTest` is also supported for a single-process run. Its
`full` default checks reload persistence and removes its random namespace, but it
does **not** establish force-stop/process-restart persistence. Use the two-phase
runner for that claim.

## Assertions made by a passing two-phase run

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

- [AndroidX instrumented-test setup](https://developer.android.com/training/testing/instrumented-tests/androidx-test-libraries/test-setup)
- [AndroidX Test releases and stable dependency versions](https://developer.android.com/jetpack/androidx/releases/test)
- [ActivityScenario](https://developer.android.com/reference/androidx/test/core/app/ActivityScenario)
- [Instrumented tests from the command line](https://developer.android.com/studio/test/command-line)
- [Official emulator command-line options](https://developer.android.com/studio/run/emulator-commandline)
- [Local WebView content and HTTPS asset loading](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
