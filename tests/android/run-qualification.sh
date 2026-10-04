#!/usr/bin/env bash
# SPDX-License-Identifier: BSD-3-Clause
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ANDROID_SERIAL:?Set ANDROID_SERIAL to the disposable CI emulator (emulator-NNNN)}"
[[ "$ANDROID_SERIAL" =~ ^emulator-[0-9]+$ ]] || { echo 'Refusing a non-emulator device' >&2; exit 1; }
[[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || { echo 'Not an Android emulator' >&2; exit 1; }
[[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == 1 ]] || { echo 'Emulator has not booted' >&2; exit 1; }
APP=apps/web/android/app/build/outputs/apk/release/app-release.apk
TEST=apps/web/android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
[[ -f "$APP" && -f "$TEST" ]] || { echo 'Build the release and release Android-test APKs first' >&2; exit 1; }
# Never overwrite or clear an installed app/profile. Run only on a fresh AVD.
for package in io.manabi.reader io.manabi.reader.test; do
  if adb shell pm path "$package" | grep -q '^package:'; then
    echo "Refusing existing $package; use a fresh disposable emulator" >&2
    exit 1
  fi
done
mkdir -p test-results/android
trap 'adb logcat -d -s ManabiQualification:I AndroidRuntime:E > test-results/android/logcat.txt || true' EXIT
adb shell dumpsys webviewupdate > test-results/android/webview-provider.txt
adb shell getprop ro.build.fingerprint > test-results/android/emulator-fingerprint.txt
sha256sum "$APP" "$TEST" > test-results/android/apk-sha256.txt
adb install "$APP"
adb install -t "$TEST"
id="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
run_phase() {
  local phase="$1"
  adb shell am instrument -w -r \
    -e class io.manabi.reader.qualification.PackagedReaderTest \
    -e qualificationPhase "$phase" -e qualificationId "$id" \
    io.manabi.reader.test/androidx.test.runner.AndroidJUnitRunner \
    | tee "test-results/android/$phase-instrumentation.txt"
  # adb may return zero even when JUnit fails. Require the exact final summary.
  grep -Eq '^OK \(1 test\)' "test-results/android/$phase-instrumentation.txt"
  node tests/android/verify-evidence.mjs "test-results/android/$phase-instrumentation.txt" "$phase" "$id"
}
run_phase seed
adb shell am force-stop io.manabi.reader
run_phase verify
node tests/android/verify-evidence.mjs --pair test-results/android/seed-instrumentation.txt test-results/android/verify-instrumentation.txt
