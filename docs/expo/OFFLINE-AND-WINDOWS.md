# Offline status and Windows direction

**October 20 decision:** this edition targets **web and Android**. Native Windows
has been removed until Expo UI supports it; iOS and macOS remain separate native
products. The desktop investigation is retained in
[archived research](DESKTOP-RESEARCH-2026-10.md), with the active scope in
[Windows deferral](WINDOWS-SDK-COMPATIBILITY.md).

The offline implementation below began at the October 18 checkpoint, building
on the combined Expo candidate `5d8d088f`. The dirty, preserved Svelte checkout
is not the app being developed here.

## Platform decision

| Target  | Current direction                                                             | Qualification boundary                                                    |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Web     | Expo Router / React Native Web, rich DOM reading surface, one IndexedDB owner | Production export and real browser scenarios                              |
| Android | Expo app, Expo UI controls, one embedded DOM storage/reader owner             | APK, device, accessibility and offline restart acceptance remain required |

After restoring the pre-desktop baseline, the application advances to Expo
**58.0.16**, React Native **0.88.0**, React **19.3.0**. There is no native desktop
version constraint. See the [upgrade qualification](MIGRATION.md#october-20-sdk-58-upgrade).

Expo UI documents universal Android/iOS/web controls, without a Windows native
implementation. Use supported Compose controls and accessible web controls while
sharing application components and domain logic.
[Expo UI platform scope](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/).

The web manifest requests `standalone`, with `id: ./` preserving its previous
implicit `start_url: ./` identity. Start URL, scope, and origin are unchanged.
Browser/PWA use remains available on desktop operating systems, without a native
Windows packaging or release commitment. Keep the production origin and app
identity stable so existing browser data remains accessible.

## Connection and storage language

Web uses one neutral “Offline” control inside the current screen's toolbar,
next to the Library title or the screen actions. It never floats over reading
content. A linked-library issue uses “Review sync” in the same location; when
both conditions apply, “Offline” opens details containing the sync review link.
The link retires on Accounts and libraries, where the actual recovery controls
are already present. The paused Android presentation remains unchanged.

The explanation distinguishes downloaded books, locally stored
progress, linked-library sync and backups. Reconnection clears the offline status, never
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

The web placement draws from [Todoist's toolbar status](https://www.todoist.com/help/todoist/features/use-todoist-while-offline-4rbaZw)
(current help, September 2026), [Google Docs' title-adjacent save status](https://workspaceupdates.googleblog.com/2020/06/new-save-status-online-offline-google-docs.html)
(2020 behavioral reference), and [Material's offline patterns](https://m1.material.io/patterns/offline-states.html)
(archived guidance, not current Material styling). Use these for placement and
progressive disclosure, not for claims about this app's persistence guarantees.
The shared explanation/control keeps the native leaf boundary and adds no
persistent preference or backup payload.

## Layout and list direction

Retain the design established in [web-design-2026.md](../web-design-2026.md):
quiet opaque surfaces, Manabi typography and hierarchy, readable content and
restrained controls. Native Apple material effects inform the design of this
web/Android edition. Phone widths retain the compact stack and contextual
actions; wider Library views retain the sidebar. Size, not device detection,
selects the layout. Reader controls and the connection explanation stay
horizontal even when the book is vertical Japanese.

The [SDK 58 universal List](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/list/)
uses native list containers on Android/iOS, but React still creates all children
up front; the web implementation is a scrolling View. Expo recommends Legend
List or FlashList for large collections. Keep Expo UI for suitable controls and
small settings groups; a shared List import does not establish large-library
performance or web virtualization.

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
