# Windows and Expo SDK qualification

Checked October 20, 2026. The product targets web, Android, and **native Windows
desktop**. The user explicitly requires the newest React Native / Expo combination
that can serve both desktop and regular Expo. The existing Edge PWA is useful
browser coverage; it does not satisfy native Windows qualification.

## Published version intersection

The registry was inspected directly, including published package manifests and
Expo's `bundledNativeModules.json`, without installing into the working app.

| Package set             | Published versions                                       | Result                                                                                            |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Latest Expo             | Expo 58.0.16, RN 0.88.0, React 19.3.0                    | No matching stable RN Windows release found                                                       |
| Existing app            | Expo 57.0.26, RN 0.86.3, React 19.2.3                    | No matching stable RN Windows release found                                                       |
| Newest shared candidate | Expo 56.0.23, RN 0.85.3, React 19.2.3, RN Windows 0.85.0 | RN Windows peer ranges accept this React/RN pair; application/native compatibility is unqualified |

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

Qualify the candidate in an isolated worktree. Retain the verified SDK 57
increment until dependency resolution, web regressions, Android source/export
checks and the Windows module inventory identify a concrete integration path.
Do not declare native Windows support merely by adding a platform to app config.

Raw registry manifests, module descriptors, tarball hashes and release metadata
are retained under the October 20 browser evidence directory in
`sdk-compatibility-8ufjuekb/`. No dependency versions changed in this checkpoint.
