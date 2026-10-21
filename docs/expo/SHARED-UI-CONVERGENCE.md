# Shared Android/web UI convergence

The target is **one nonreader screen composition, interaction model and branded
style vocabulary** for Android and web. Android-specific controls and system
adapters are justified by actual UX or platform capabilities, not by separate
page implementations. The released Svelte application's resulting design and
functionality are the acceptance criteria. Retaining shadcn is not a requirement.
The reader and Yomitan remain the explicitly web-rendered surface. Expo still
admits Android and web only; Apple applications remain separate.

## Current checkpoint is not the target

At `1de0a54608086bc4fcae448cf59501f6381bfa56`, ten nonreader route names (including
the index redirect) have twenty platform-specific entry files. None select the
same shared screen composition. The substantial Library, Settings, Snippets and
Statistics presentations are duplicated. Native account/status is limited;
TTU/shared-library/video routes still contain explicit capability gaps.

Only four source modules import `@expo/ui`, all in the native graph. The shared
Expo Router shell, domain algorithms, persistent DOM owner and typed bridge are
real reuse, but do **not** establish shared screen UI or full web/native parity.
The parallel presentations are migration reference, not the final architecture.

See the per-screen [fidelity matrix](FIDELITY-MATRIX.md) for visual, layout,
interaction, accessibility, persistence, navigation and Android acceptance gates.

## Component policy

Use owned RN/RNW layout, text, surfaces and branded interactions with the existing
semantic theme, typography, spacing, radius and state colors. Use SDK 58 Expo UI
universal controls where their actual API satisfies the required behavior.
Universal controls share an API across Android Compose and web DOM/RNW; that is
not a promise of identical default geometry or styling. Inspect the installed
version and qualify both outputs. [Expo UI universal](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/)

Keep `Host`/`RNHostView` boundaries explicit. An RN container inside an Expo UI host
changes the rendering boundary; nested universal controls need their own host.
Do not force the entire branded page into Compose or rely on native-only
modifiers to reproduce web design. [Universal Host](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/host/)

A small owned primitive layer supplies actions, fields, choices, navigation,
modal/sheet/popover behavior, semantic headings and layout. A web leaf may retain
an actual anchor/form/dialog/table or CSS-grid/focus behavior where RNW cannot
represent its contract. Android Back, keyboard, picker, sheet, touch-target,
clipboard and file-chooser behavior may have corresponding bounded adapters.
These leaves must not own feature queries, history, export decisions or a second
screen state machine. No wholesale third-party UI framework is required.

## First complete route: Statistics

Both route entries now select
`features/statistics/StatisticsScreen.tsx` and its common controller. Typed ports
supply complete data and capabilities: the web port calls the existing DOM-owned
domain in-process; Android uses the existing account/epoch-fenced bridge. Ports
return data/outcomes, never old whole-page JSX.

The shared source uses actual SDK 58 universal Checkbox, Switch, Picker and
Android Icon controls within small `Host` boundaries. Branded layout, toolbar,
summary, filters, settings, calendar and interaction state are common RN/RNW.
Web form, focus, grid, link and nonmodal-popover semantics live in bounded leaves,
not a second page. Android icon XML is an asset type in the installed Metro
configuration; production export and packaged rendering still need qualification.

Preserve the full web inventory:

- All ten measurement sources, three aggregation modes, date/week-start/title
  and identity filters, sorting, pagination and details
- Summary and heatmap views, goals, day/week keyboard navigation, selection and
  nonmodal day details
- Row creation/edit/reset/delete and range/book history confirmation, with
  current account/identity/revision checks at the existing transaction boundary
- Clipboard logs, selected/all TTU exports with ambiguous identity refusal, and
  raw recovery JSON
- Responsive geometry, light/dark appearance, enlarged text, focus return,
  keyboard behavior, cancellation, errors and durable operation ownership

The earlier native projection's 200-book/10,000-row limits must not become
product-wide web limits. Native transport uses bounded, ordered, expiring
continuations tied to the original scope/query/projection. Missing or stale
pages are not complete results. Continuations cannot repeat migrations or
mutations. Any internal full-history read or memory limit must be documented
rather than described as fully streaming. Native capability gaps, including
ownerless goals/global recovery, remain explicit within the shared composition;
the web adapter retains its existing supported workflows.

The reviewed Library-to-Statistics handoff remains canonical-key scoped,
including issued legacy UUIDs. Identity validation occurs inside the existing
migration transaction before history/receipt writes; uppercase valid hashes use
the shared normalized comparison. Shared UI must not remove these guards.

## Qualification, then remaining routes

Replace tests that enforce opposite presentation-directory bans with positive
assertions that Android and web execute the same Statistics screen/controller.
Continue to forbid browser storage/renderers in the native shell and native
system/owner adapters in the web route. Pure algorithms can be shared regardless
of their historical directory name.

Retain the aggregation oracle, domain/mutation tests and existing behavioral
assertions. Exercise the actual production shared controller and ports under
StrictMode, account ABA, route replacement and pending confirmations. Add actual
RNW/universal primitive semantics and complete exported-app browser checks;
shims alone do not qualify the installed renderer. Preserve the existing
keyboard, role, form, geometry and focus assertions. Packaged Android controls
remain a separate runtime gate.

After Statistics, converge Settings without reducing it to scalar fields, then
Library/shared shell, Snippets and account/import/shared-library flows. The
snippet rich-content editing surface may be a bounded DOM/Tiptap adapter for
selection/ruby/IME, with shared workspace, toolbar, destination and recovery
composition around it. Optional video requires domain/view separation before
its route is counted as shared. File/auth/storage capability differences are
explicit ports, not alternate complete pages.

Work remains on the unmerged migration branch. Reuse the existing three-job
standard-runner [zero-remote-storage CI plan](CI-COVERAGE.md), with no new artifact
uploads/cache writes or paid resources. A successful export or source test is
not full UI parity; report evidence for the exact source head.

## Settings field foundation after Statistics qualification

Both existing Settings renderers now use the same `SettingsFieldGroup`
composition for card headings, descriptions, header accessories and editor
content. Small native/browser layout leaves retain the browser's section IDs,
labels, hidden-state semantics, original responsive classes and native RN
containment. The seven-category inventory is also common. Native field cards and
Expo UI control seeds now consume the same semantic theme vocabulary as the
shared UI instead of hard-coded light/dark grays.

This is a field-composition slice, not a claim that Settings is one complete
shared screen. Web font/background/custom-theme/goal/source editors and their
existing controllers remain intact. Native scalar draft Apply/Cancel, expected
value checks, account/blur retirement and capability gates remain intact. The
remaining screen/navigation/controller and specialized-editor divergences must
be converged explicitly; web is never redirected to the reduced native surface.

Both web export jobs now include all original Settings controls and editor
usability cases, alongside unchanged Statistics and reader lifetime gates.
Browser geometry and native control accessibility still require execution;
server-render and module-graph assertions alone do not establish parity.

The next Settings workspace slice moves the search/category/introduction/content
composition into `features/settings/SettingsWorkspace.tsx`, consumed by both
presentations. The same visit-local filter state supplies stable React snapshots
and the existing browser store adapter. Browser links retain modified-click and
Back/Forward/hash semantics; native categories remain Compose actions. Native
search uses the existing Expo TextInput boundary. Both retain their specialized
editor children and platform-specific save guidance.

This removes duplicated workspace structure and search/category state, but does
not yet unify every scalar editor, action controller or specialized flow. Browser
field/filter metadata and native account/blur mutation ownership remain at their
existing boundaries. No new preference persistence or route-global filter is
introduced. A common wrapper is not counted as complete screen parity.

Settings now also shares its workspace geometry policy. Both renderers measure
the available pane after outer padding and maximum-width constraints, then
account for text scale. Sidebar navigation requires 800 nominal units: 224 for
categories, 24 for the gap and at least 552 for editors. Smaller panes use
horizontal category navigation. Android supplies its layout width/font scale;
web observes the actual workspace and a rem-sized probe, including root text-size
changes that do not resize the window. No device-idiom check is involved.

This repairs a reproduced web layout at 900px and 200% text where the sidebar
left only 340px for editors. The compact layout gives editors the full 836px
workspace. Matched captures retain the normal 1200px and 390px geometry. Search
query, the exact search input node, keyboard focus and selected category survive
width/text-scale changes and a narrow pane within a wide window. Persistence,
schema and backup/restore formats are unchanged.

Local qualification passes strict application types, 1,750 original unit tests,
619 Expo tests and all 19 Settings browser journeys in each of Chromium and
WebKit. A mounted native-layout contract exercises the real workspace and
navigation components with supplied layout/font-scale events. That contract is
not Android rendering evidence; packaged compact Settings and the wider native
large-text/device matrix remain separate runtime gates.

Boolean settings now use the same `SettingsSwitch` composition and `SwitchField`
on Android and web. Web background fading also uses that field. The separate
button-based browser switch and its CSS are removed. Existing controllers still
own every save, expected-value check and session lifetime; stored boolean values
remain `1`/`0`, and background options retain their existing JSON. No persistence
schema, backup or restore format changes.

The shared setting displays a concise On/Off label because its enclosing card
already names the setting. A bounded web adapter names Expo's real input;
Android supplies the same name through Compose semantics. The web adapter owns
no draft, selection or save state. Native TalkBack behavior still needs actual
device qualification.

Browser review found and repaired two concrete layout/theme issues: a switch
beside a cleanup action could overflow its card at 200% text, and Expo's fixed
white checked thumb had insufficient distinction from the light track in dark
mode. The common field now constrains its flex width; the web thumb uses the same
semantic primary foreground as the existing native control. Focus, hit testing,
Space activation, state-label activation, disabled behavior, live accessible
names and saved-value reload remain explicit acceptance checks.

Local qualification passes all 1,750 original unit tests, 620 Expo tests, strict
types, full lint and production web export. The final export passes 22 Settings
and 21 shared-Statistics journeys in each browser engine. Phone/desktop and
200% light/dark captures were inspected. The mounted Settings fixtures now resolve
the installed RNW/Expo browser modules rather than trying to parse native RN
sources; they retain their existing controller, storage and dialog assertions.
Native import-boundary checks also pass. A fresh packaged Android run is still
required for this source; neither these local results nor the prior layout
commit's CI establish native switch rendering, TalkBack or full screen parity.

Short scalar choices now use `SettingsChoices` and the existing branded
`ActionButton` on both web and Android. Appearance mode uses the same composition.
Choices remain visible and wrap with the available pane and enlarged text;
selected borders reserve their space so selecting another choice does not move
neighboring controls. Web retains a named button group and pressed states.
Android names each action with its setting and option, retaining selected and
disabled semantics. An unknown saved ID is displayed without selecting or saving
a replacement. The owner supplies selection after saving; the component owns no
draft or storage state.

This is a deliberate control boundary, not a replacement UI framework. The
installed Expo UI 58.0.21 universal Picker supports menu/wheel presentation, not
visible wrapping choices. Its community segmented control's web implementation
uses a fixed 32px height and equal-width segments. Neither satisfies these short
Settings groups at enlarged text without a separate presentation. Font catalogs
and native theme selection retain Expo Picker; web theme swatches, custom-theme
Edit/Delete and the child action remain specialized. Page-turn's web select also
remains a separate control, so this does not claim complete Settings convergence.

The existing web controllers and native `save(value, expectedValue)` boundary
still own writes, pending state and session retirement. IDs, persistence schemas,
backup/restore formats and existing preference normalization are unchanged.
Mounted RNW coverage checks unknown values, distinct numeric/string IDs,
controlled selection, focus retention, repeated selection and disabled actions.
Production browser coverage checks Enter/Space, saved-value reload, theme-editor
availability and 320px/200% text in both light and dark appearance. These browser
and import-graph checks do not establish Android rendering or TalkBack behavior.

Local qualification for this choice-control slice passes 1,751 original unit
tests (including the new mounted choice contract), 620 Expo tests, strict types,
full lint, appearance generation and production web export. Both Chromium and
WebKit pass all 24 Settings and 21 Statistics journeys on that export: 90 browser
executions. Desktop, phone and 200% light/dark screenshots were reviewed. The
existing packaged Android qualification remains necessary for the new source;
native choice interaction and TalkBack still require their own runtime coverage.

The packaged Android harness now requires one choice interaction in both process
phases: the real accessible Color mode action changes selection, the local owner
must contain that value, and selecting the original option must restore it.
Cleanup also restores an initially absent preference key. The verifier rejects
missing interaction evidence. Both Java sources compile against the official
API 35 stub under Java 21, and all eight harness contracts pass locally. Only a
completed emulator run establishes this new gate; it still does not establish
spoken TalkBack or the full native choice matrix.

Theme selection now also uses a common `SettingsThemeChoices` composition. Both
platforms show the resolved preset/custom palette, selected state and the same
Add/Edit/Delete actions. Edit and Delete remain together when the chooser wraps.
The earlier separate browser swatch tree and native theme dropdown/action card
are removed. The browser child-action slot is retained, with a common Add button.
Unknown saved IDs remain visible without selecting or saving a fallback.

The chooser owns no theme records, confirmation state or persistence. Existing
browser editor callbacks are unchanged. Android retains its captured session and
expected palette across the system delete confirmation. Moving those actions
beside the swatch would leave the former inline editor far down the page, so
Android now opens that editor in the existing shared dialog surface. Pending
saves prevent dismissal; completed errors appear inside the dialog, and the
header Close action allows return to Refresh when reconciliation is required.
Copying palettes, draft state and saving still belong to the existing editors.
Their color-input composition remains platform-specific; this does not yet close
the complete custom-theme editor or Settings fidelity gates.

Mounted RNW tests cover actual swatch colors, controlled selection, selected-only
custom actions, child Add actions, independent editor/pending disables, and
unknown values. Browser journeys cover custom palettes, long names, 200% reflow,
grouped actions, editor cancellation/focus return, reload and scoped deletion.
Retained appearance tests continue to cover presets, forced colors, palette
copying, alpha/hex values, duplicate names, renaming and prototype-like names.
Neither the theme schema nor backup/restore format changes.

The Android harness now requires opening the new theme dialog, canceling once
with system Back and once with Close, and observing the exact unchanged local
theme catalog in both process phases. The strict evidence verifier rejects a
missing journey. Java compilation and harness contracts do not substitute for
that new exact-source emulator run, nor for native editing/IME/TalkBack coverage.

Local theme-chooser qualification passes the complete 1,752-test original unit
suite and 620 Expo tests. After grouping actions and moving the Android editor
into the dialog, the 90 affected mounted/domain/harness/CI-policy checks pass,
along with strict types, full lint, appearance generation, native import-boundary
build and API 35/Java 21 compilation of both instrumentation sources. The final
production web export passes all 25 Settings journeys and five retained theme
journeys in each browser engine (60 executions); desktop, phone, light/dark and
200% captures were reviewed. The broad unit runs precede those final layout-only
changes; affected tests and the browser journeys qualify their final source.

The short-choice native save gate is now qualified by
[run 39488615430](https://github.com/ManabiIO/manabi-reader-web/actions/runs/39488615430)
for source `aaba7d06deaf1b4e6d83d30a7c8b6e4f3ed96271`. All three standard-runner
jobs passed. API 35 / WebView 124.0.6367.219 changed and restored Color mode
through the actual native controls in both process phases (PIDs 2767 and 3884).
The verifier also retained the packaged origin, worker, storage, reload and
process-restart checks. The run uploaded no artifacts. This source predates the
theme chooser/dialog and shared editor below; it cannot qualify those changes.

Custom-theme editing now uses `SettingsThemeEditor` on Android and web. One
component owns the name, seven color expressions, copy selection, preview,
validation, pending state and Save/Cancel composition. Web retains its existing
dialog scroll region and fixed footer through a layout slot. Native retains the
shared dialog and its session-owned dismissal restrictions. The old browser
color-input controllers and native whole-editor implementation are removed.

Only input leaves differ: browser color wells and opacity inputs, versus Expo UI
native text inputs accepting the existing #RRGGBB/rgb/rgba expressions. Name
fields preserve browser validity/focus semantics and use Expo's focus API on
Android. The installed Expo UI 58.0.21 universal exports include Picker and
TextInput but no color well. Both editors use the same universal Picker for
copying; its browser leaf receives an explicit accessible name.

Copy selection now starts at the active theme on both platforms, and copying
resolves the palette for the current appearance. This fixes the former native
first-catalog-entry/raw-preset behavior. Editing still starts from the original
stored custom palette, preserving authored expressions and zero alpha until an
individual color changes. Opposite-appearance copies derive their existing
counterpart without rewriting the source palette. An unavailable copy ID is
shown explicitly and cannot replace the draft.

Common validation rejects empty/reserved/duplicate names and invalid colors.
The browser owner rechecks the live catalog before writing. Native expected
palettes, bounded transport/catalog/name validation and session retirement still
run at the original owner boundary; these native restrictions are not imposed
on browser names such as `constructor`. Pending submissions are single-flight,
failures retain the editable draft, and a late successful result cannot close a
replacement editor. No storage schema or backup/restore format changes.

Actual browser qualification caught two integration defects before acceptance:
the copy select needed an explicit accessible label, and the shared action's
text child intercepted the retained exact button hit test. Plain ActionButton
labels now leave hit testing to their owning action on both platforms. Mounted
coverage exercises copying without writes, duplicate rejection and focus,
prototype-like web names, pending disables, retry, exact expression round trips,
unavailable copies and late results after unmount. Android IME, editing, native
color-field focus/scrolling and TalkBack remain separate runtime gates.

Local shared-editor qualification passes 1,754 original unit tests, 623 Expo
tests, full lint, strict types, appearance generation, the native import-boundary
build and a production web export. The final export passes 27 Settings, five
retained appearance and all 21 shared-Statistics journeys in each of Chromium
and WebKit: 106 browser executions. Desktop, phone and 320×480 at 200% text
captures were reviewed, including the fixed dialog actions after scrolling.
The native text-focus leaf additionally passes strict types and the native build;
these checks do not establish Android keyboard, focus or TalkBack behavior.
The new theme dialog/editor source still needs its own packaged Android run.

Reader margin/maximum-size presets now share `SettingsDimensionEditor` and its
storage-free draft model. Both platforms expose the exact saved pixel value,
quick-size percentage/pixel preview, two shortcut actions and the existing
Automatic zero sentinel for maximum size. This replaces Android's ten-button
preset list and the browser's controller-owned presentation with one composition.
The browser retains its existing popover, fieldset and pixel-value input; native
retains its numeric draft Apply/Cancel and disables presets while that draft is
dirty. Existing owners still handle every save and native expected-value checks.

Opening, previewing, canceling and resizing never save. An in-progress gesture is
admitted to its original viewport, writing direction, saved value and enabled
state; a changed context rejects its late finish, even if the original values
later return. Only an explicit completion/shortcut reaches the owner. Incoming
saved values are not normalized to the nearest displayed quick-size step.
Automatic remains available without a measured viewport, but never for margins.
No persistence schema or backup/restore format changes.

The bounded browser slider leaf keeps native input/change/blur/pointercancel
events: React's range onChange fires while dragging and cannot represent the
existing completion contract. The native leaf uses Expo UI's Compose Slider,
whose installed API and Kotlin implementation provide `onValueChangeFinished`;
the universal Slider currently omits that callback. Labels, range steps and
semantic theme colors are supplied at this boundary. The shared model—not the
control—admits a completion and prevents a retired editor from saving.

The Android harness adds an actual accessible range interaction in both process
phases, verifies a positive local pixel save and the returned native range,
selects Automatic through its named action, then restores the exact raw original
value, including an absent key. Evidence must include
`nativeDimensions: slider-completion-and-automatic-local-save-with-exact-restore`.
Java compilation and model/import tests are not execution of this gate. Physical
touch/IME/rotation/TalkBack and native large-text layouts still require runtime
qualification.

Local dimension-editor qualification passes all 1,758 original unit tests, 623
Expo tests and 49 Android-harness/CI-policy checks. Full lint, strict types,
appearance generation, native import-boundary build, production web export and
API 35 / Java 21 compilation of both instrumentation sources pass. The final
export passes 29 Settings journeys, the retained Rhea theme-dialog geometry/focus
case and five retained theme journeys in each browser engine (70 executions).
Phone/desktop and 320×480 at 200% light/dark captures were inspected. The Rhea
case also verifies the restored large, 8px rounded Add theme action identified by
the earlier CI failure. Full native size/editor qualification remains pending.

Stored-font management now uses `SettingsFontManager` and
`SettingsFontImportFields` on both platforms: common Stored/Add navigation,
font rows, availability/selected states, Use/Remove actions, storage recovery,
and import-form composition. Browser list semantics remain a small `ul`/`li`
leaf. Common field frames preserve actual HTML label activation and native
labels. Android now opens the shared responsive Dialog rather than a separate
full-screen font manager. The shared action row wraps within the available
width, including 320px at 200% text with long font/file names.

The browser retains its real form and file input, required validation, IME
Enter guard and explicit Save. Android retains Expo UI's native name field and
its existing combined system-picker/import command, 200-character name limit
and 256 MB transfer limit. A cancelled picker retains the draft. An acknowledged
import returns to Stored; importing never selects a font. These differences are
bounded file/system adapters, not separate catalog presentations.

Storage owners and mutation contracts remain in place. The browser uses exact
cache entries and the live catalog; native selection/removal uses the captured
catalog token and key. Native single-flight leases, account/epoch lifetimes,
late-confirmation rejection, abort on dismissal and explicit reconciliation
remain. A browser Save already in progress may finish after dismissal without
closing a replacement dialog. The new browser Selected indicator observes the
current preference family and releases its subscription on replacement/teardown.
No schema, stored preference, font-cache, backup or restore format changes.

Mounted native coverage retains the original lifetime assertions and adds
missing-file disabling, read-only Add navigation, cancelled-picker draft
retention, duplicate-import coalescing and the acknowledged return to Stored.
The actual packaged gate now requires
`nativeFontManager: shared-font-list-add-back-and-close-without-save` in both
process phases. It navigates Stored/Add, dismisses with Android Back, reopens,
closes, and checks the exact raw catalog and both font-family preferences are
unchanged. It does not import a real font, exercise IME/TalkBack, or qualify
native large-text/rotation behavior.

Local font-manager qualification passes all 1,759 original unit tests, 626 Expo
tests and 49 Android-harness/CI-policy checks. Full lint, strict types, appearance
generation, native import-boundary build (63 modules), production web export,
and API 35 / Java 21 instrumentation compilation pass. The final export passes
30 Settings journeys and the retained Rhea theme-dialog geometry/focus case in
each browser engine: 62 executions. Desktop, phone and 320px/200% light/dark
captures were inspected. The inner-overflow repair has an additional 39 focused
controller, mounted-dialog and native-lifetime checks on its final source.
Packaged Android execution for the new font and preceding size gates remains
pending; earlier theme-editor APK results do not qualify these controls.

### Shared font choices and explicit native preferences

Both font selectors now consume one packaged catalog and one selection policy.
YuKyokasho is advertised only after a positive availability probe. Saved strings
and effective rendering choices remain distinct: opening a picker never writes
a fallback; an explicit available choice can replace a saved unavailable family.
Unknown, imported and CSS family lists remain visible as saved preferences.
Android uses the Expo Picker leaf; web retains the released radio menu, keyboard
navigation and trigger focus return. Browser labels are limited to three visual
lines so long names at 200% text leave other choices reachable; the full name
remains in the accessible label, title and editable preference field.

Android now exposes explicit text drafts for both font families, with Apply and
Cancel. Dirty drafts disable the picker and Manage action. Saves retain exact
strings and the existing expected-value/revision guards; external updates and
rejected or late replies cannot silently replace a newer draft. The actual
Compose TextInput receives the field name through its semantics modifier.
Browser freeform field/blur/IME behavior is unchanged. No storage schema, cache,
backup or restore format changes.

Local qualification: 1,759 unit tests, 634 Expo tests, 49 harness/policy checks,
full lint/types/appearance checks, native import-boundary build (66 modules),
production export and API 35 / Java 21 instrumentation compilation. The final
export passes 33 selected journeys in each browser engine (66 executions),
including every Settings controls/editor-usability case and retained Rhea font
keyboard/theme-dialog cases. Desktop/phone and 320px/200% light/dark menu captures
were inspected. This selected inventory does not establish whole-app parity.

The new native gate requires explicit draft/cancel/apply/exact-restore for both
families in both process phases. It has not yet executed remotely. The preceding
source `3ac13264` passed both web jobs in run `39501226500` but failed Android on
an unreachable named size slider before font-manager navigation. Native size and
font gates remain open. Bounded native accessibility snapshots now accompany
failures so the next run can distinguish control naming, visibility and range
semantics without relaxing the original assertions.

### Background owner preparation

Native background selection still needs its bridge, system picker and Library
image renderer. The existing DOM-owned image database now accepts a captured
mutation authority: queued operations recheck their reader lifetime before
starting, decoding/encoding rechecks before a write, and cancellation aborts an
in-flight IndexedDB transaction. Once a transaction commits, its durable result
is retained and refreshed even if the originating editor disappears. A retired
editor cannot publish its error into a replacement editor. Current browser
callers retain their existing save behavior and error/retry handling.

Nine owner tests exercise the actual IndexedDB transaction algorithm with a
synthetic canvas boundary: independent modes, queue retirement, decoder cleanup,
owner change during encoding, removal after a stale transaction read,
abort-after-put/before-commit, retirement after commit and explicit retry after
storage failure. Real browser appearance coverage separately exercises actual
PNG/JPEG/WebP decoding, canvas, corruption recovery, independent slots,
cross-tab changes and offline reopening. These contracts prepare native image
integration; they do not make that capability available yet.

The `manabi-reader-appearance` v1 schema and image record representation are
unchanged. Existing book ZIP export does not include this appearance database;
background-image backup/export coverage must remain explicit when wiring native
selection. The native feature must use the same data owner and image limits,
then qualify library rendering and process-restart persistence before removing
its current capability gate.

Local qualification of this preparation: 1,768 unit tests, lint, strict app
types and a fresh production web export passed. The complete retained appearance
collection passed 31 cases in each of Chromium and WebKit (62 journeys), including
actual image reencoding and offline persistence. Native background selection is
still unavailable and is not qualified by these web results.

### Packaged Android semantic-owner diagnosis

Run `39507202372` at `5622af9e` passed both web jobs, Android compilation, origin
policy, release packaging and worker checks, then failed the native size-slider
lookup. Its actual accessibility snapshot contains a visible SeekBar with range
50–95 and current value 95. The exact “Quick size for maximum page height” label
is on that SeekBar's immediate child. Expo UI text inputs use the same split:
an editable EditText owns its named semantics child. The harness now follows
only the exact label's self or immediate SeekBar/EditText parent. It also checks
screen and scroll-viewport bounds because Compose reports some offscreen virtual
children as visible. Named control, enabled state, real native actions, range,
local save and exact restore assertions remain required. A new packaged run must
confirm this correction; the failed run does not qualify size or font edits.

The raw log and parsed hierarchy are retained in local
`native-background-images-sf7gtuop` evidence. This diagnosis changes test lookup,
not product preference semantics or the installed Expo implementation.

### Shared background editor and native local images

The editor now shares `SettingsBackgroundImages` on web and Android, with small
HTML/RN layout leaves. Web retains its file inputs, fieldsets, independent mode
previews and fade controls. Android uses the system document picker and bounded
native file chunks, then the existing DOM-owned image decoder and transaction.
Library rendering consumes a separately requested local image resource. Original
files, native paths and image bytes never enter ordinary runtime snapshots.

All four library/reader × light/dark slots remain in the same
`manabi-reader-appearance` v1 database. No second native store or migration was
introduced. The owner keeps its 8 MB, 24 MP and 8192px input limits. Native replies
preserve aspect ratio and alpha, are reencoded as WebP or PNG, and are bounded to
2048px and 384 KiB. Late mode/account/revision replies cannot replace a newer
Library image. Failed native decoding hides the decorative image and can retry
on a later revision. A picker cancelled or retired by its editor/account cannot
replay a save; uncertain mutation results require explicit refresh.

Book ZIP backups still omit this image database. Both editors explicitly say
images stay locally, are not synced or included in book backups, and original
files are needed on another device. Existing backup/restore formats are unchanged.

Local checks in `native-background-images-sf7gtuop` and
`background-closeout-cJwIc0S9`: 1,768 units; 651 Expo contracts; six mounted native manager/renderer tests; real
IndexedDB/decoder/canvas/resource cases in Chromium and WebKit; application types,
lint, Android graph/export, and Java 21/API 35 instrumentation compilation. The
production web export passes all 31 retained appearance cases and 31 Settings
controls/editor-usability cases in each engine (124 journeys). Narrow/wide,
light/dark image-editor captures were reviewed. These are local results, not
packaged Android acceptance or full application parity.

The first browser run retained two failures per engine: the formatter removed a
conditional class-name space, breaking dark previews. An explicit class list
repairs the real stylesheet/DOM contract; the original assertions remain.
The image-button label is also a single text child, preventing RN flex gaps
between words. CI now selects the complete appearance collection for both export
modes and engines, plus real native-resource raster cases in both engines.

Packaged Android coverage now requires actual picker cancellation and three PNG
imports, distinct light/dark native image pixels, persisted slot-byte hashes
across a real process restart, isolated mode removal and complete cleanup. It
uses only fresh disposable emulator data. This new gate has been compiled and
its harness tested, but has not executed against the APK yet. The capability is
implemented in current source; native release qualification remains open.

Run [39511591350](https://github.com/ManabiIO/manabi-reader-web/actions/runs/39511591350)
completed successfully on `758d76e638f7fd113653b41a3496fdd108e15138`: both web jobs
and packaged Android passed. The native slider/font semantics repair is therefore
qualified for that source, including the original save/restore requirements.
That commit predates the background integration above; its green result does not
qualify the new background system picker, renderer or restart assertions.

### Actual Android font picker and production font loading gate

The packaged instrumentation now has a font import/select/remove journey in
addition to its retained read-only manager and font-draft checks. Seed copies
one actual bundled WOFF2 face into a unique, test-owned Downloads entry, opens
the Android document picker, verifies cancellation retains the name draft and
unchanged catalog, and selects that file through the system picker. Import must
leave both font-family preferences untouched; Use must select the exact new
name. The ordinary CacheStorage owner must retain byte-identical contents.

The inspection probe waits for BrowserRuntime's own embedded-font stylesheet
and asks `document.fonts.load` to decode the face it registered. It never installs
a test FontFace or stylesheet in the packaged app. A document reload and the
second real process must retain the selected font identity and exact cached-byte
hash. Verification cancels the native removal once, then confirms it, requires
catalog/cache/stylesheet removal and the selected-primary reset, and verifies the
other family never changed. Original raw preferences are restored by test cleanup.
All source-file fixtures are scoped to the disposable emulator and removed after
use; the existing suite still refuses installed app profiles and physical devices.

Local harness tests exercise the injected probe, wrong bytes, implicit selection,
incomplete removal, exact cleanup, and cross-process evidence rejection. Java
21/API 35 compilation passes. A real browser codec fixture runs the actual
save/remove and embedded stylesheet helpers with the bundled WOFF2 file in
Chromium and persistent WebKit, including a document restart. The first temporary
WebKit context lost its cached font entries on reload while retaining the catalog;
that failure and an unchanged persistent-profile pass are retained in
`native-font-picker-2MAtss7h`. Browser profiles close and move to Trash after use.
This is browser storage/codec evidence, not an Android picker pass.

The new font codec checks run in both CI browser engines and preserve any first
failure while still running the second engine. The APK font journey remains
unqualified until a new exact-source packaged run succeeds. This slice changes
test tooling only; application schemas, font ownership and backup/restore formats
are unchanged.

### Shared Library selection toolbar

Web and Android now execute `LibrarySelectionToolbar` for cancellation, the live
selection count, select-all/page, optional export, grouped bulk actions and the
saved-copy notice. The platform leaves supply controls and menu semantics; they
do not own selection queries or persistence. Web retains its existing compact
icon geometry, toolbar labels, focus restoration and saved-copy restrictions.
Android replaces the horizontal strip of bulk actions with a named Actions menu,
keeps “selected on this page” and Select page explicit, and exposes cancellation
in the toolbar. Its Select page control remains Expo UI/Compose; branded menu
items use the existing shared action primitive.

Android's menu retires on a new Library admission or route/account departure.
Busy operations disable the toolbar. Copy-removal confirmation now also retires
on cancellation, Android dismissal, refresh, selection changes (including ABA),
route departure/return and account replacement. A confirmed removal uses the
captured Library token, keys and IDs once and keeps reading history. Uncertain
failure is shown without replaying the destructive request. This changes no
storage schema, backup content or restore behavior.

Local evidence is in `../evidence/shared-selection-ix5swzj8/`: mounted native
selection/removal tests, actual web/Android route graphs and production exports,
TypeScript and lint. Eight actual-app browser journeys pass in each of Chromium
and WebKit, covering compact/200%-text toolbar reachability and keyboard focus,
scoped selection, same-title Statistics identities/deletion, bulk Want to Read,
and real export/migration/repeat. Both enlarged-text screenshots were reviewed.
These are local checks, not an installed Android interaction or TalkBack pass.
The full shared Library workspace, common search, native export destinations and
remaining device acceptance stay open.

### Backup archive delivery boundary

`BackupStorageHandler.finishExportZip` now consumes and returns a completed Blob
and the existing ZIP filename independently of browser downloading. The ordinary
browser path retains its download and URL cleanup. Detaching the writer before
awaiting completion prevents an old download/finalization from discarding a newer
export. Cancellation is supplied by the current replication operation, checked
after compression and before delivery, and checked again before a queued browser
click. A previous book context cannot supply another operation's cancellation.

`replicateData` accepts an optional archive destination. A destination receives
an archive only after successful replication; per-book errors, empty work and
cancellation discard it instead of presenting a partial ZIP as a successful native
backup. Destination failure is surfaced and is not replayed. Existing serializers,
ZIP entry names, preferences and restoration behavior are unchanged. Six focused
tests use the real ZIP codec for delivery, cancellation, writer isolation and
partial failures; the actual-app export/restore journeys remain the wire-format
acceptance evidence.

This is the shared archive boundary for native export, not a completed Android
Save flow. Android still needs selection admission, identity-checked DOM reads,
a bounded cancellable transfer, a real system destination chooser, and saved-file
verification/cleanup before exposing Export. Native paths must stay in the shell;
ZIP bytes must not be added to ordinary runtime snapshots. The existing DOM
storage owner and current backup format remain authoritative. Full Settings,
background images and font caches are not implicitly included by this refactor.
