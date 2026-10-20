# Offline status and Windows direction

**October 20 update:** the user requires the newest shared Expo / React Native
version for native Windows desktop and regular Expo. The Edge PWA decision below
is the historical October 18 checkpoint, not fulfillment of that requirement.
RN Windows 0.85.0 was released October 19; SDK 56 / RN 0.85 is now the newest
version-intersection candidate. See [Windows SDK qualification](WINDOWS-SDK-COMPATIBILITY.md)
and the [desktop research](DESKTOP-RESEARCH-2026-10.md). The latter distinguishes
this candidate from the published community Expo Desktop template (SDK 55 /
RN 0.83), and records the current native-module and WebView2 qualification gates.

Research and implementation checkpoint: October 18, 2026. This open-source Reader
targets web, Android, and Windows. It is distinct from the native Apple Reader
and the Flashcards rewrite. This increment builds on the combined Expo candidate
`5d8d088f` in draft PR #268; the dirty, preserved Svelte checkout is not the app
being developed here.

## Platform decision

| Target  | Current direction                                                                         | Qualification in this increment                                                   |
| ------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Web     | Existing Expo Router / React Native Web app, rich DOM reading surface and IndexedDB owner | Production export, Chromium and WebKit browser scenarios                          |
| Android | Existing Expo app, Expo UI where appropriate, one embedded DOM storage/reader owner       | Type checks, shared UI and bridge lifecycle tests; no device or native build      |
| Windows | Install the Expo web app through Edge as a PWA first                                      | Manifest identity/assets and browser layout checks; Windows installation is unrun |

The pinned application remains Expo **57.0.26**, React Native **0.86.3**, React
**19.2.3**. No dependencies changed. The current [Expo SDK reference](https://docs.expo.dev/versions/latest/)
lists SDK 58 with RN 0.88. Microsoft's [React Native Windows support table](https://microsoft.github.io/react-native-windows/support/)
lists 0.84 as active. An older Expo version is not proof that its native modules
and this app's DOM host work on Windows. There is no verified common native
version to select from these tables.

[Expo UI](https://docs.expo.dev/versions/latest/sdk/ui/) documents universal
Android/iOS/web controls and native Compose/SwiftUI controls, without a Windows
native implementation. Keep shared application components and platform adapters;
use native Compose leaves where supported and accessible web controls elsewhere.
The new connection explanation shares one component tree and the existing modal,
typography and action primitives. Do not introduce an Apple build target.

An SDK 58 upgrade should be a separate, tested dependency change after the
combined candidate's outstanding qualification, including Android DOM hosting,
storage and required native modules. This checkpoint does not qualify SDK 58.

Microsoft explicitly supports [installable Windows PWAs in Edge](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/).
That route preserves this Reader's EPUB DOM, selection, ruby, vertical writing,
dictionary hit testing, browser storage and current Expo dependencies. It does
not establish a native React Native Windows or MSIX release.

The manifest now requests `standalone`, preserving ordinary window chrome
instead of forced fullscreen. Its explicit `id: ./` resolves to the same identity
as the previous implicit `start_url: ./`; start URL, scope and origin are
unchanged. This works at root and nested deployment prefixes. The existing
192/512px install icons are checked against their actual PNG dimensions.

Windows release acceptance remains: install/update/uninstall in Edge on Windows,
keyboard and Narrator navigation, text scaling and window resizing, offline
process restart, save/read/export/restore, and data preservation through updates.
Keep the production origin and app identity stable. A future packaged WebView
would require an explicit storage migration and backup/restore boundary.

## Connection and storage language

The neutral “Offline · On this device” control appears only when the device
reports offline. Its explanation distinguishes downloaded books, locally stored
progress, linked-library sync and backups. Reconnection clears the status, never
claims sync succeeded, and does not dismiss an explanation the person is reading.
On web, focus returns to the trigger before it retires when focus moves away.

The observer samples on mount and on returning to the app, including an offline
launch with no connection event. Events are deduplicated and all listeners are
removed on disposal. Android receives an optional transient `online` field through
the existing scoped runtime snapshot; it does not create another network client
or database. Account/session ownership is unchanged by a connection transition.

Connectivity is a device hint, not an endpoint health check, an acknowledgement
of a particular save, or proof that every app/book resource is available offline.
The existing Settings shell-completeness inspector remains authoritative for its
own narrower check. Existing save failures and sync conflicts retain their own
handling. No persistent schema, import/export format or backup content changed.

This follows [web.dev's offline UX guidance](https://web.dev/articles/offline-ux-design-guidelines):
explain what remains usable and where work is stored, without treating ordinary
disconnection as an error or equating a local save with remote success.

## Layout and list direction

Retain the design established in [web-design-2026.md](../web-design-2026.md):
quiet opaque surfaces, Manabi typography and hierarchy, readable content and
restrained controls. Native Apple material effects are a reference, not a Windows
or Android requirement. Phone widths retain the compact stack and contextual
actions; wider Library views retain the sidebar. Size, not device detection,
selects the layout. Reader controls and the connection explanation stay
horizontal even when the book is vertical Japanese.

[Legend List v3](https://www.legendapp.com/open-source/list/v3/react-native/getting-started/)
supports the React Native platforms, including Windows, without native code;
its documentation lists recycling as optional. The [DOM entry point](https://www.legendapp.com/open-source/list/v3/react/getting-started/)
is separate; RN Web applications should use the RN entry point. This is a viable
candidate for shelves/search results, not a replacement for the book DOM.

No Legend package was added. Benchmark it against the current FlatList with real
large catalogs before adoption: stable keys, delayed covers, account-scoped
tokens, selection, series headers, grid/list switching, keyboard focus, screen
readers, scroll restoration and 200% text must survive. Measure frame/input
latency, blank regions and memory in release builds. List adoption does not
require Legend State; the existing durable domain store remains authoritative.

## Verification and retained failures

- 371 relevant Node/jsdom tests pass across search, storage, statistics, shared
  controls, connection state and native bridge/navigation lifetimes.
- 82 pitch tests pass, including added duration checks at 44.1/48/88.2 kHz.
- Production Expo web export and postbuild pass; full app TypeScript passes.
- Nine browser scenarios pass: Chromium and WebKit at 390/820/1440px, both at
  320px with 200% root text, and a Chromium persistent-profile offline restart.
  The latter reopens a saved book through the service worker, opens the status
  inside the vertical reader, saves a different book while offline and verifies
  it after reload. Network disconnection is Playwright emulation, not OS airplane
  mode. External traffic is blocked; no production accounts are used.
- The shared Android UI compiles with native packages externalized. This is a
  source/module-boundary check, not an Android binary or device result.

The prior two storage-test failures came from a transaction double without `add`.
The prior six pitch-test failures came from a worker double returning nominal
0.55 seconds instead of `sampleCount / sampleRate` (rounding can add one sample).
Production already uses the latter. Assertions were retained; new regressions
confirm duration-mismatched replies still fail. No production storage/pitch
semantics were changed to satisfy these tests.

Intermediate evidence is retained: the first UI-test bundle resolved RN Web from
the wrong workspace; the initial build command used the repository root instead
of `apps/web`; visual review found inherited vertical writing in the notice; an
offline-import fixture reused identical content under a different filename and
correctly deduplicated instead of creating the expected second book. The repaired
fixture has distinct content. The 320px explanation also gained a sticky close
header after visual review. Original logs and screenshots are not overwritten.

Evidence is under the sibling `evidence` directory of the isolated
`reader-offline-platforms-20261018-*` worktree. The browser runner is
`test/expo/connection-browser.mjs`; set `MANABI_WEB_PREVIEW_URL` to a local preview
origin and `MANABI_WEB_EVIDENCE` to a fresh directory outside the repository.
Every automated Chromium launch on macOS includes
`--disable-features=MacAppCodeSignClone` and awaits cleanup.

This focused increment does not complete all of PR #268's browser qualification:
the original Japanese IME, media selection, transcription, statistics privacy,
Picks and EPUB RTL acceptance packets still need their combined-head run.
Physical Android, Windows installation/Narrator, real model inference and a
Legend benchmark remain unrun. No deployment, merge, native build or production
data changes were made.

## October 20 browser qualification and layout correction

The combined candidate's search, media selection, sparse transcription,
statistics privacy, Picks and selected EPUB RTL browser packets now have local
execution evidence. This remains affected-route qualification, not the complete
retained suite or native Windows/Android release acceptance.

Screenshot review found measurement details running together and an enlarged
popover heading splitting inside a word. Details now use a shared vertical
container with spacing; the web popover lets Close occupy its own row when text
is enlarged. The same change keeps heatmap dismissal targets separate from their
heading. No persisted schema, settings format, backup format or sync semantics
changed.

Coverage on the SDK 57 working candidate:

- Statistics: 21 cases in Chromium and WebKit against both default-off and
  video-enabled production exports. The new real-browser privacy case checks
  hidden numeric descendants/accessibility names, reveal before details,
  keyboard/Close focus return, snapshot retirement and persisted privacy after
  reload at desktop size and 320px/200% text. Existing heatmap, filtering,
  appearance, editing and export cases remain in the selection.
- Video-enabled search/Picks/RTL: 35 cases in Chromium; 34 passes and one
  expected WebKit skip for trusted touch dragging that requires Chromium CDP.
  Japanese composition events are synthetic, not a physical IME test.
- Built-app media: 10 checks including two distinct local videos, individual
  versus batch selection, sort refresh, Clear focus return, local caption
  persistence/export, appearance and 320px/200% layout. No model inference.
- Sparse media: seven Chromium/native IndexedDB checks against compiled
  production controllers with scripted recognition hypotheses. Includes failed
  transaction recovery, checkpoint reopen, provisional captions, buffering and
  saved digital-silence evidence. Silence contributes coverage without an ASR
  timing sample; a later genuine timing sample enables ETA.
- Media domain tests: 928 passes initially, with three fixture-dependent cases
  skipped. The two affected files then passed all 73 cases with real generated
  MP4/Matroska fixtures, including those three cases: 931 distinct cases covered.
- Shared statistics/components, native presentation and harness checks pass;
  application TypeScript, scoped ESLint/Prettier and both web exports pass.
  Native presentation tests are not an Android binary/device result.

Original failures remain in sibling evidence folder
`combined-qualification-mzz79u28/`: the first privacy fixture assumed two
virtualized rows were simultaneously mounted at phone size; the revised fixture
uses one row while the retained route cases still cover multiple rows. A
keyboard query-refresh check avoids attempting a pointer click through an open
nonmodal popover. The old heatmap geometry assertion assumed side-by-side
heading/Close; it now also accepts the verified stacked layout with a real gap
and retains hit testing. Sparse startup initially timed out before module load;
using the shared test server's larger request queue resolved it. Test expectations
also retain the two-second sparse overlap and test ETA where caption coverage is
actually insufficient.

Python harnesses used here now share the macOS Chromium launch safeguard,
preserve existing disabled features, and close contexts on setup failures.
Media harnesses explicitly close contexts and browsers in cleanup. Other
unexecuted legacy launch sites still need the same audit before use.

Screenshots from both engines were inspected. The final default production
export is left in `apps/web/build`; prior generated builds were moved to Trash.
See `statistics-default-final-*`, `statistics-gated-final-*` plus
`popover-gated-verified-*`, `gated-*`, `media-app-verified/` and
`media-sparse-qualified/` for the corresponding reports and retained failures.
