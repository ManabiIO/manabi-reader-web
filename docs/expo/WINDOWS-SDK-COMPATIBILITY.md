# Windows and Expo SDK qualification

Checked October 20, 2026. The product targets web, Android, and **native Windows
desktop**. The user explicitly requires the newest React Native / Expo combination
that can serve both desktop and regular Expo. The existing Edge PWA is useful
browser coverage; it does not satisfy native Windows qualification.

See [desktop research](DESKTOP-RESEARCH-2026-10.md) for the community Expo Desktop,
Legend Spark, WebView2, macOS comparison, and host recommendations. In particular,
the newest matching Windows/mobile **versions** below are newer than the
published community Expo Desktop **template**, which currently uses SDK 55 /
RN 0.83.10. Neither is native acceptance for this app.

## Published version intersection

The registry was inspected directly, including published package manifests and
Expo's `bundledNativeModules.json`, without installing into the working app.

| Package set              | Published versions                                       | Result                                                                                            |
| ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Latest Expo              | Expo 58.0.16, RN 0.88.0, React 19.3.0                    | No matching stable RN Windows release found                                                       |
| Retained verified branch | Expo 57.0.26, RN 0.86.3, React 19.2.3                    | No matching stable RN Windows release found                                                       |
| Newest shared candidate  | Expo 56.0.23, RN 0.85.3, React 19.2.3, RN Windows 0.85.0 | RN Windows peer ranges accept this React/RN pair; application/native compatibility is unqualified |

RN Windows 0.85.0 was published on October 19 at 19:19 UTC. Its peers require
`react-native: ^0.85.0`, `react: ^19.2.3`, and
`@react-native/jest-preset: 0.85.3`. Microsoft's support page still showed 0.84
when checked; the newer [official 0.85.0 release](https://github.com/microsoft/react-native-windows/releases/tag/react-native-windows_v0.85.0)
and the [published package manifest](https://registry.npmjs.org/react-native-windows/0.85.0)
supersede the version assumption in the October 18 checkpoint.

Expo 56.0.23 bundles RN 0.85.3, React 19.2.3, Expo Router `~56.2.21`,
Expo UI `~56.0.26`, and DOM WebView `~56.0.6`.
See the [Expo SDK version mapping](https://docs.expo.dev/versions/latest/) and
[published Expo package](https://registry.npmjs.org/expo/56.0.23).

The candidate is a deliberate SDK downgrade to reach the newest shared RN
release. A permissive `*` Expo peer dependency is not native compatibility proof.

## Module and host gates

- Expo's published native module descriptors for Expo, Expo UI, and DOM WebView
  list Apple and Android implementations, with no Windows implementation.
  [Universal Expo UI](https://docs.expo.dev/versions/latest/sdk/ui/universal/)
  documents Android, iOS, and web. Windows needs supported presentation adapters.
- Expo's Windows Metro integration is not a completed built-in host. The
  [platform-recognition PR](https://github.com/expo/expo/pull/47704) is closed
  without merge; the [no-native-core fallback PR](https://github.com/expo/expo/pull/47705)
  is open and unmerged as of this check. Experimental community Metro support
  does not implement native modules.
- The current app uses Expo Router, Expo native services and a patched Android
  DOM WebView. Port and qualify the Android origin/worker patch against SDK 56;
  never silently drop it or reuse a precompiled unpatched binary.
- Windows needs its own durable DOM host, navigation, file pickers, export/share,
  accessibility and application lifecycle adapters. Keep the database owner
  singular, preserve EPUB DOM layout, and define backup/restore and storage
  migration before changing an installed application's storage origin.
- Native Windows build and runtime verification require a Windows environment.
  Bundling on macOS cannot establish WebView2 persistence, Narrator behavior,
  native module linking, installation or update safety.

## Isolated SDK 56 candidate

Branch `codex/reader-windows-sdk56-20261020` is based on `6cbbb790`. It aligns
`apps/web` with SDK 56's bundled packages and puts RN Windows 0.85.0 in a separate
`apps/windows` dependency workspace. Both use React 19.2.3 and RN 0.85.3.
The Windows workspace now has an RNW C++ template project, developer entrypoint
and a qualified Expo Metro bundle/delivery path. Native compilation and runtime
remain unqualified; it does not open the Reader library.

The first export with RN Windows inside `apps/web` failed during Expo autolinking:
RN Windows' CLI attempted Windows-only tool discovery on macOS. The separated
workspace's production web export and postbuild pass. The separation preserves
ordinary Expo web/Android autolinking.

The reviewed DOM-origin/worker patch was ported to `@expo/dom-webview@56.0.6`.
SDK 56 Expo UI also needed an accessibility-label backport from SDK 57. Both
patched modules are explicitly required to build from source, and the
autolinking verifier rejects unpatched precompiled binaries or version drift.
See [DOM patch](../../patches/reader-dom/README.md) and
[Expo UI patch](../../patches/expo-ui/README.md).

Current evidence:

- Windows development/release bootstrap bundles pass their source-map inventory
  checks (639 and 520 modules respectively), including real Windows initialization,
  Platform and development DevTools, with one React and no mobile RN internals
  or unsupported Expo native modules. Development bundles include five assets.
- The Windows HTTP acceptance test serves the C++ host's exact bundle URL,
  source map and an actual development image, then shuts Metro down cleanly.
  It caught and led to fixing a monorepo asset 404 that bundling alone missed.
- Five Windows CLI patch tests pass, including real platform-config import,
  deferred PowerShell discovery and failure reporting. The CLI intentionally
  does not enumerate a native Windows project on macOS; this is not autolinking
  or compilation acceptance.
- Windows TypeScript passes. The generated native project uses RNW 0.85's
  Visual Studio 2026/v145 prerequisites and invokes the tested SDK 56 Expo
  bundler for release builds. See [host details](../../apps/windows/README.md).
- App TypeScript and `expo install --check` pass.
- DOM patch contract: five tests pass, including 89 executable Java policy
  assertions.
- Expo UI/autolinking/export contracts: 30 tests pass.
- Shared/native statistics and Android autolinking selection: 34 tests pass
  (three autolinking cases overlap the preceding selection).
- Production web export, postbuild and Android export pass. Android export
  includes the bundled DOM assets; it is not an APK/native compilation result.
  Both artifact inventories pass with 501 files each. Web has no warnings;
  Android's EAS-update inventory warns that its relocated worker/chunk paths are
  not a runnable WebView layout. EAS Update remains disabled; the actual APK
  asset gate and native execution are still required.
- Nine browser connection scenarios pass across Chromium and WebKit, compact
  and sidebar sizes, and 320px/200% text. A Chromium persistent-profile restart
  reopens and saves local data offline. This uses browser offline emulation.
- The 21-case affected statistics selection passes in both Chromium and WebKit
  against the default web export. Candidate video-enabled browser qualification
  has not been repeated.

The first Chromium statistics run passed 20 cases and failed the final privacy
assertion after keyboard sorting with a popover open. Three focused reruns and
three runs with 4x CPU throttling passed without application changes. Source
inspection identified a possible race with the popover's scheduled initial
focus. The browser test now waits for its expected Close-button focus before
moving focus to Sort, as its earlier interactions already do; the requirement
that all three measurements re-hide is unchanged. The complete Chromium rerun
passes, and WebKit's updated privacy case also passes. The original failure
remains in `statistics-sdk56-dxt_6g0m/`, with
investigation evidence in `statistics-privacy-investigation-9mc3nej1/` and
`statistics-privacy-throttled-o92qeoi8/`. This is a test-readiness correction,
not a claim that an application privacy bug was reproduced and fixed.

Retain the verified SDK 57 increment until the Windows module inventory and
actual native host execution establish a concrete integration path. No native
Windows support is claimed by adding this workspace. The Android source patches
still require a candidate binary and device/TalkBack verification.

Raw registry manifests, module descriptors, tarball hashes and release metadata
from the initial inventory are retained under the October 20 SDK 57 browser
evidence directory in `sdk-compatibility-8ufjuekb/`. Candidate logs are in the
SDK 56 worktree's sibling `evidence/`: `build-web-sdk56.log` preserves the original
failure, `build-web-sdk56-isolated.log` and `build-android-sdk56.log` record the
exports, and `connection-sdk56-ywb9yp49/` records browser results/screenshots.
The Android export is retained outside Git at `evidence/android-export-sdk56/`;
`android-assets-sdk56.json` records its original pre-move output path.
The dependency change does not alter persistent schemas, origins or backup
formats.

Windows bootstrap evidence is retained in the same candidate `evidence/`:
`windows-bootstrap-bundles-final/qualification.json`,
`windows-bootstrap-contracts-final.log` (36 passing tests, including the six
Windows cases), `windows-msbuild-invocation.log` (the JS bundler command used by
the native build, not MSBuild itself), and `windows-scoped-lint.log`.
Earlier failed bundle/HTTP attempts remain alongside those final results.
Frozen installation and Expo dependency alignment pass after repairing a
pnpm importer link with its supported `--fix-lockfile` command.
