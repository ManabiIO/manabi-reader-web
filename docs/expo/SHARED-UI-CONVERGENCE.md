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
