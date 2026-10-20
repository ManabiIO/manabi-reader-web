# Expo desktop research — October 20, 2026

**Current decision, October 20, 2026:** ship this edition for **web and Android**.
The user deferred native Windows until Expo UI supports it. The Windows host,
dependencies, patches, tests and CI workflow have been removed. After restoring
the pre-experiment SDK 57 baseline, the web/Android app advanced to
[SDK 58 / RN 0.88](MIGRATION.md#october-20-sdk-58-upgrade). macOS and iOS remain
outside this edition's targets.
See [current platform scope](WINDOWS-SDK-COMPATIBILITY.md).

The material below is an **archived research snapshot**, including the former
Windows recommendation. It records the investigated packages and experiment, not
work authorized to continue or a claim of native acceptance. A version match,
successful bundle, and native runtime acceptance are separate results.

## Archived recommendation before Windows was deferred

Keep web/Android and Windows as separate application workspaces, sharing domain
logic, screen composition, and explicit platform adapters. Continue qualifying
**Expo 56.0.23 / React Native 0.85.3 / React 19.2.3 / RN Windows 0.85.0** as the
newest matching published Windows/mobile pair. It is **not yet a working native
Windows application** or a supported Expo Desktop template combination.

Use this SDK's Expo Metro/Babel composed with Microsoft's pinned
`@rnx-kit/metro-config@2.2.6` in the Windows workspace. Development/release bundles
and development HTTP delivery are now qualified there; native execution is not.
The SDK-55-specific Expo Desktop Metro package was not installed into SDK 56.
Keep the verified SDK 57 branch available until the candidate's native host and
regressions are qualified.

The main Windows feasibility gate is the durable WebView2 reader host, followed
by navigation and native services. Establish those before expanding the Windows
presentation layer. Keep the existing database owner and backup format during
this qualification.

## What “Expo for desktop” currently means

| Option                              | Verified upstream state                                                                                        | Implication                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Regular Expo                        | Latest registry release is 58.0.16, bundling RN 0.88.0 and React 19.3.0                                        | Neither current desktop RN port matches this pair                                                      |
| Windows/mobile version intersection | RN Windows 0.85.0 accepts RN `^0.85.0` and React `^19.2.3`; Expo 56.0.23 bundles RN 0.85.3                     | Newest candidate for our actual targets; native integration remains work                               |
| Community `expo-desktop`            | CLI 1.0.5; latest published template 55.83.9 uses Expo 55.0.31, RN 0.83.10, RN Windows 0.83.2, RN macOS 0.83.0 | Concrete published template for a project that also needs macOS; not evidence that our SDK 56 app runs |
| Legend Spark                        | Published `0.0.1-next.3` pins Expo 54.0.37, RN 0.81.6, RN Windows 0.81.35                                      | Its Windows support is explicitly unverified; unsuitable as our current version baseline               |
| Expo web export in Tauri/Electron   | Web renderer inside a desktop application                                                                      | A distinct packaging option, not an RN Windows host                                                    |

Version evidence: [Expo registry](https://registry.npmjs.org/expo),
[RN Windows 0.85.0 manifest](https://registry.npmjs.org/react-native-windows/0.85.0),
[Expo Desktop template 55.83.9](https://registry.npmjs.org/expo-desktop-template-blank-typescript/55.83.9),
[Spark manifest](https://registry.npmjs.org/@legendapp%2fspark/0.0.1-next.3).
Expo's RN/React mappings were also read from each published tarball's
`bundledNativeModules.json`.

RN macOS 0.83.0 requires RN **0.83.10**, so including macOS would change the
intersection to the Expo 55 generation. Our inference is to avoid that extra
constraint because this product does not ship on macOS.
[RN macOS manifest](https://registry.npmjs.org/react-native-macos/0.83.0).

Official Expo Modules support for additional Apple platforms is module-specific:
the podspec and actual AppKit-compatible implementation matter. The `apple`
descriptor does not make every iOS module work on macOS. Windows is a separate
porting problem.
[Expo additional platforms](https://docs.expo.dev/modules/additional-platform-support/).

Expo's Windows platform-recognition proposal was closed without merge; the
ExpoModulesCore fallback proposal remains open. Expo maintainers describe broader
platform support as experimental and dependent on coordination with the React
Foundation's platform work. A successful community integration is useful evidence,
but not an official Expo Windows support commitment.
[Platform PR](https://github.com/expo/expo/pull/47704),
[runtime fallback PR](https://github.com/expo/expo/pull/47705).

## The PowerShell/autolinking failure

Our first SDK 56 web export imported RN Windows' CLI while Expo inspected native
dependencies, then failed looking for `dotnet.exe`, `where`, and `pwsh.exe` on
macOS. Moving RN Windows out of `apps/web` and into `apps/windows` made the same
web export succeed. No installed tooling was modified.

The published Expo Desktop template independently addresses this class of
failure: it excludes `react-native-windows` from Expo autolinking, includes a
`find-dotnet-tools` canary, and carries an RN Windows 0.83.2 CLI patch that defers
PowerShell discovery until a Windows operation actually needs it. That
version-specific patch is evidence of the issue, not a patch we can blindly
reuse on RN Windows 0.85.
[Template](https://github.com/shirakaba/expo-desktop/blob/1e45de7e2d63811b1480f0388d1572f084e67acb/templates/blank-typescript/package.json),
[CLI patch](https://github.com/shirakaba/expo-desktop/blob/1e45de7e2d63811b1480f0388d1572f084e67acb/templates/blank-typescript/patches/@react-native-windows%2Bcli%2B0.83.2.patch).

The subsequent SDK 56 bootstrap reproduced the issue during rnx-kit platform
discovery. We reviewed both affected RNW CLI 0.85.0 files and adapted the lazy
discovery patch through pnpm. Five regression tests verify original file hashes,
real configuration import and diagnostic success/failure behavior. Missing
PowerShell still fails an operation that needs it. See the
[versioned patch](https://github.com/ManabiIO/manabi-reader-web/blob/395f4605086e7fe26c27f2c88c9017b04cb25fdc/patches/windows-cli/README.md).

For this repository:

- Keep Windows CLI/build packages in the Windows app dependency graph. Shared
  packages should expose capabilities without eagerly importing a host's tools.
- Keep Expo's normal monorepo/autolinking defaults for web/Android. Add exclusions
  only for demonstrated leaks; do not disable all autolinking.
- Keep a single aligned React/RN version and inspect resolved native-module
  duplicates. Do not force peer versions merely to silence compatibility checks.
- Install on each build OS from the lockfile; do not copy macOS `node_modules`
  into a Windows checkout.

Expo documents automatic Metro monorepo configuration and warns about duplicate
React, RN, and native modules. Its autolinking walks application dependencies and
supports per-platform exclusions. These support the separation above; they do
not prescribe that every cross-platform app must have separate hosts.
[Monorepos](https://docs.expo.dev/guides/monorepos/),
[autolinking](https://docs.expo.dev/modules/autolinking/).

## Metro, bootstrapping, and adapter choices

The published `expo-desktop-metro-config@55.83.3` composes Expo's config with
`@rnx-kit/metro-config`, but explicitly depends on Expo Metro 55 and RN Metro
0.83.10. Microsoft's tool documents this composition. Evaluate an appropriately
versioned composition for SDK 56 in isolation; preserve Expo's serializer, DOM
transform, assets, existing resolver, and platform initialization.
[Published Metro package](https://registry.npmjs.org/expo-desktop-metro-config/55.83.3),
[Microsoft Metro configuration](https://microsoft.github.io/rnx-kit/docs/tools/metro-config).

The SDK 56 experiment now confirms that Microsoft's wrapper provides platform
resolution and initialization without runtime stubs. Two additional integration
details were reproduced and repaired:

- Expo CLI normally installs SDK 56's packed source-map adapter. A direct Metro
  runner must invoke that same adapter; stock Metro failed to serialize the
  development map. Our runner checks the exact Metro config version.
- Expo defaults override the wrapper's asset plugin during composition. Simply
  restoring `../` in asset URLs also fails with Metro's newer URL normalization.
  Preserve the wrapper's escaped asset names and route development requests
  through Metro's `unstable_path` query. An actual HTTP test now checks the
  native bundle URL, map, development image and clean server shutdown.

The resulting bundle inventories contain the real RN Windows initialization and
DevTools, one React instance, and no mobile RN internals or Expo native stubs.
This qualifies the bootstrap's JS graph, not native rendering or full Expo
module support. The [Windows workspace](https://github.com/ManabiIO/manabi-reader-web/blob/395f4605086e7fe26c27f2c88c9017b04cb25fdc/apps/windows/README.md) records
commands and exact scope.

Expo Desktop's source catalogs contain an RN 0.85 entry, but the registry has no
published 56.85 template. Its published modules-core 55.0.2 also declares RN/RNW
`~0.81.0` peers despite the newer template using 0.83. These inconsistencies need
investigation, not broad peer overrides.
[Source catalogs](https://github.com/shirakaba/expo-desktop/blob/1e45de7e2d63811b1480f0388d1572f084e67acb/pnpm-workspace.yaml),
[modules-core manifest](https://registry.npmjs.org/expo-desktop-modules-core/55.0.2).

Facilitron's alternative Metro shim documents four concrete failure modes:
workspace-relative bundle paths, Windows RN resolution, RN initialization, and
missing RN-internal platform implementations. It also excludes native build
outputs from watchers. Its authors report a shipping SDK 55/RNW 0.83 app, while
explicitly describing the extracted package as unvalidated by a second consumer.
Use it as a diagnostic reference; adopting it does not provide native Expo
modules or prove compatibility with RNW 0.85.
[Maintainer's shim documentation](https://github.com/FacilitronWorks/expo-metro-windows).

For platform leaves, prefer `.android.tsx`, `.windows.tsx`, and `.web.tsx` over
importing all native implementations and selecting one after module evaluation.
Our current generic `ExpoButton.tsx`, `ExpoToggle.tsx`, and `UiIcon.tsx` import
Android Compose; a Windows resolver must not fall through to those files.
Share the control contract and screen tree, with real implementations for each
target. Unsupported storage/export actions must report their unavailable
capability, never silently succeed.
[React Native platform separation](https://reactnative.dev/docs/platform-specific-code),
[Spark adapter conventions](https://github.com/LegendApp/legend-spark/blob/main/docs/extensions.md).

## WebView2 is the important Reader-specific gate

RN Windows 0.82+ removed the legacy Paper architecture. Our Expo-aligned
`react-native-webview@13.16.1` Windows implementation is therefore not a suitable
host for RNW 0.85.
[Microsoft architecture guidance](https://microsoft.github.io/react-native-windows/docs/getting-started/).

Newer upstream WebView code does have a Windows Fabric implementation:
15.0.0 introduced it and 16.0.0 removes Paper support. However, **npm `latest` is
14.0.1 and `next` is 16.0.0** at this check, despite GitHub labeling 16.0.0 as
latest. Treat 16.0.0 as an explicitly pinned qualification dependency, not a
routine Expo-compatible upgrade.
[WebView releases](https://github.com/react-native-webview/react-native-webview/releases),
[registry channels](https://registry.npmjs.org/react-native-webview).

Open reports describe blank URI navigation on RNW 0.84 and shortcomings in error
reporting, early bridge injection, and WebView environment setup. These are
reported issues, not failures reproduced by us on 0.85. Inspection of the
published 16.0.0 Windows component confirms that it does not itself configure a
virtual hostname or explicit user-data folder. Qualify the needed behavior;
Fabric availability alone does not satisfy our persistent DOM-owner contract.
[URI report](https://github.com/react-native-webview/react-native-webview/issues/3990),
[hardening report](https://github.com/react-native-webview/react-native-webview/issues/3980),
[published source](https://github.com/react-native-webview/react-native-webview/blob/v16.0.0/windows/ReactNativeWebView/RCTWebView2ComponentView.cpp).

Our host design should:

1. Serve packaged assets from a fixed HTTPS virtual origin and configure an
   app-owned, writable WebView2 data folder outside versioned binaries/temp paths.
2. Keep the existing IndexedDB owner singular. Test workers, WASM, ruby, vertical
   text, selection, local images, dictionary lookup and bridge startup.
3. Preserve origin/profile identity across updates and relaunches. Browser/PWA
   storage does not automatically become the packaged app's storage.
4. Exercise export/restore before changing an installed storage origin. Keep
   untrusted book content outside privileged bridge capabilities.
5. Test cold launch offline, failed writes, process termination, app upgrade,
   rollback policy, missing WebView2 runtime and real navigation errors.

These are proposed application requirements. Microsoft's guidance explains the
origin differences between file/string/virtual-host content and how WebView2
profiles hold IndexedDB and related browsing data.
[Local content](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content),
[user-data folders](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder).

## UI, lists, offline feedback, and desktop behavior

Expo UI's SDK 56 universal API documents **Android, iOS, and web**. Continue using
it where it fits, with Windows control adapters. Do not treat a shared import as
proof of a native macOS/Windows implementation.
[SDK 56 Expo UI](https://docs.expo.dev/versions/v56.0.0/sdk/ui/universal/).

Legend List is separate from Legend Spark. Published Legend List 3.6.0 has a
JavaScript implementation, and its documentation lists Windows/macOS support.
Benchmark it for shelves and search results; retain the EPUB DOM. Qualify stable
keys, recycled row state, keyboard focus, screen-reader order, variable heights,
selection, resize and scroll restoration. Use its RN entry point for RN/RN Web
screens and its DOM entry only for deliberate DOM components. Adoption does not
require Legend State.
[RN guide](https://legendapp.com/open-source/list/v3/react-native/getting-started/),
[DOM guide](https://www.legendapp.com/open-source/list/v3/react/getting-started/),
[published version](https://registry.npmjs.org/@legendapp%2flist/3.6.0).

Keep this product's two size-driven layouts: compact navigation stack and wider
sidebar. Test Windows Snap/resizing, Android split screen, text scaling, keyboard
and touch without resetting the current reader or selection. Windows guidance
likewise bases adaptation on available window space; we need not reproduce all
of NavigationView's default modes.
[Window sizing](https://learn.microsoft.com/en-us/windows/apps/design/layout/screen-sizes-and-breakpoints-for-responsive-design),
[NavigationView](https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview).

For visual polish, keep book content opaque and readable. Use Windows Mica or
Acrylic in suitable host/navigation surfaces only if the host supports them;
respect system contrast/transparency settings. Android should retain familiar
Compose behavior. Apple's materials remain a design reference.
[Windows materials](https://learn.microsoft.com/en-us/windows/apps/develop/ui/materials).

Keep connection, local save, offline readiness, and remote synchronization as
distinct states. The existing neutral “Offline · On this device” explanation
fits that model. A “Saved on this device” acknowledgement must follow a successful
commit; reconnecting must not imply sync completion. This edition must not
promise future AppSync behavior that has not been implemented.
[Offline UX](https://web.dev/articles/offline-ux-design-guidelines),
[connectivity hints](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine),
[local source of truth](https://developer.android.com/topic/architecture/data-layer/offline-first).

Browser persistence requests can reduce eviction risk, but backups are still a
separate capability. Show storage failures and preserve recoverable drafts;
ordinary disconnection should not block local reading.
[Browser persistent storage](https://web.dev/articles/persistent-storage).

## Alternatives and next acceptance gates

Tauri uses a system webview; Electron bundles a Chromium-based runtime. Either
could package our web renderer, but choosing one would change the desktop host
strategy and require storage migration, native services and installer work.
The old `@expo/electron-adapter` repository is archived. Do not introduce it as
current Expo desktop infrastructure.
[Tauri](https://v2.tauri.app/start/),
[Electron architecture](https://www.electronjs.org/docs/latest/tutorial/process-model),
[archived Expo adapter](https://github.com/expo/expo-electron-adapter).

Next gates for the native Windows path:

1. Resolve the Windows Metro/native-core bootstrap against the exact SDK/RN pair.
   Check both development and release bundles without breaking web/Android.
2. Compile and run a minimal persistent WebView2 host on Windows, then exercise
   the existing storage/bridge contract before porting screens.
3. Inventory Router/screens, safe areas, UI, file pickers, export, audio, linking,
   credentials and lifecycle individually; compile their actual native modules.
4. Run an installed application on Windows x64/ARM64 as applicable: keyboard,
   Narrator, IME, contrast themes, text scaling, resizing, offline restart,
   backup/restore and upgrade preservation.

No Windows runtime or installer acceptance has been performed. `apps/windows`
now contains a developer bootstrap, Expo Metro runner and RNW 0.85 C++/WinAppSDK
template project. Its published prerequisites require Visual Studio 2026
**18.6.1+** and toolset **v145**; a Windows CI image must be checked for these
components before scheduling a build. The current macOS environment has no
Windows VM/build toolchain.
[RNW prerequisites](https://github.com/microsoft/react-native-windows/blob/react-native-windows_v0.85.0/vnext/Scripts/rnw-dependencies.ps1).

GitHub's explicit `windows-2025-vs2026` image is a plausible hosted build
environment: its October 7 inventory lists VS 2026 18.10.12224.181. The ordinary
`windows-2025` inventory still lists VS 2022, so the generic Windows label is
insufficient for this template. Verify the selected runner's actual components
and record its image version; neither inventory proves that this app compiles.
A future Windows job should preserve the repository's existing public-repository
admission and no-artifact/no-cache storage boundary.
[VS 2026 runner inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md),
[ordinary Windows 2025 inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md).

SDK 56 web/Android checks and their limits are recorded in
[Windows SDK qualification](WINDOWS-SDK-COMPATIBILITY.md).
Raw metadata, source snapshots and package archives are retained in the
candidate worktree's sibling `evidence/desktop-research-cn_gmc61/`; the initial
snapshot includes retrieval time, URLs and SHA-256 hashes.
