# Windows native host qualification

This workspace contains a **developer bootstrap**, not the Reader product yet.
The library/database is not opened. Expo 56.0.23, React Native 0.85.3, React
19.2.3 and RN Windows 0.85.0 are aligned with `apps/web`.

See [the research decision](../../docs/expo/DESKTOP-RESEARCH-2026-10.md).

## What works here

- SDK 56 Expo Metro and Babel composed with Microsoft's `@rnx-kit/metro-config`.
- Development and minified release JS bundles, source maps and development assets.
- The real Windows RN initialization, Platform and DevTools modules, with one
  React instance. The bundle verifier rejects mobile RN internals and unsupported
  Expo native modules/stubs.
- An RNW 0.85 C++/WinAppSDK project generated from its published `cpp-app`
  template. Native compilation and runtime are **not yet qualified**.

This uses Expo's build tooling. It does not establish Windows support for Expo
Router, Expo UI, DOM components, or Expo native services. Those require platform
adapters and separate acceptance before shared product screens are connected.

## Commands

Install from the repository root with Node 24.21.0 and pnpm 12.3.4:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/windows check
node --test patches/windows-cli/contract.test.mjs test/windows/metro-http.test.mjs
pnpm --dir apps/windows bundle:qualification /absolute/path/to/a/new/evidence-directory
```

Qualification refuses to replace an earlier evidence directory. Its JSON report
records bundle/map hashes and labels native runtime unqualified.

On Windows, the **installed RNW 0.85 prerequisites** require Visual Studio 2026
18.6.1 or newer and C++ toolset v145. Inspect `react-native-windows/Scripts/rnw-dependencies.ps1`
for the required components; older online setup guides may describe an earlier
RNW release. Install a fresh dependency graph on Windows, rather than copying
macOS `node_modules`.

```sh
pnpm --dir apps/windows start
# In a second terminal, with Windows build prerequisites installed:
pnpm --dir apps/windows windows
pnpm --dir apps/windows windows --release
```

The native DebugBundlePath is `apps/windows/index.windows`, relative to Expo's
monorepo server root. Release builds load `Bundle/index.windows.bundle`. The
project overrides the upstream MakeBundle target to use this SDK's Expo Metro
and stop on bundling failure. Source maps remain outside the installed Bundle.

`windows/` is tracked native source. Its changes from the generated template are:
the debug URL, initial window title/size, development publisher label, and the
MakeBundle target. `template-provenance.json` records the original template
file hashes; `THIRD-PARTY-NOTICES.txt` retains Microsoft's MIT license. Template
icons and package identity are qualification placeholders, not release branding.

## Compatibility repairs

The exact-version RNW CLI patch in `patches/windows-cli` delays PowerShell
discovery until a Windows operation needs it. Without it, platform enumeration
fails on macOS and Metro incorrectly selects mobile RN internals.

The runner also invokes SDK 56's existing packed source-map adapter, as Expo CLI
does. It checks the exact Metro config version so an SDK upgrade requires review.
No installed tools or shared dependencies are edited by the runner.

The config preserves rnx-kit's escaped monorepo asset names, then rewrites
development image requests using Metro's `unstable_path` query. Returning `../`
directly in the URL pathname causes a 404 after newer Metro URL normalization.
Both HTTP delivery and packaged asset copying need to remain covered.

## Next native acceptance

Compile and run Debug and Release on Windows; verify Hermes boot, text input/IME,
keyboard focus, Narrator, resize, high contrast and text scaling. The development
HTTP test does not exercise native Fast Refresh, debugger attachment, or input.
No installer or update preservation has been tested.

The candidate's `windows-bootstrap.yml` runs on the explicit GitHub VS 2026
image. It compiles both configurations and attempts the Release bootstrap using
Windows UI Automation (rendered platform text, input/state, button activation and
resize). Per-step results determine acceptance; the workflow definition itself
does not qualify the host. It prints evidence without uploading artifacts or
remote caches. See [CI scope](../../docs/expo/CI-COVERAGE.md).

The initial Windows run exposed a pnpm 12 shim that silently returned without
running commands. CI uses its published `bin/pnpm.mjs` entry with Node and checks
both dependency versions and fresh native outputs. A zero exit from the CLI
alone is not build acceptance.

Then implement a persistent WebView2 host with a stable local HTTPS origin and
an app-owned writable profile. Exercise the existing DOM database owner, workers,
WASM, bridge, offline relaunch and backup/restore before adding shared screens.
The bootstrap makes no persisted-data changes and needs no backup migration.
