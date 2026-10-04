# Android/web fidelity matrix

## What counts as fidelity

The reference is the released Svelte source at
`7d552c47de7f0da9a723cc7645ea148482cd238f`, including its live controls, styles,
state transitions and retained regression assertions. The inactive `.svelte`
files remain available for comparison. A route is not complete merely because
its JSX compiles, its controller tests pass, or an Android APK can be assembled.

The intended architecture is one nonreader screen composition and interaction
model, owned branded RN/RNW tokens and geometry, suitable SDK 57 Expo UI controls,
and small platform/system leaves. The reader and Yomitan are intentionally DOM
surfaces. Android and web are the only Expo targets.

**Published full checkpoint:** `5ac1225b737fbeb7e6e7b2535ae68ea1fc24d5a9`
passed all three jobs in [run 37099596037](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37099596037):
regression/default web, full web and Android. Both independent web exports passed
their selected Chromium/WebKit assertions; the full export passed the complete
shared/local data-safety dispatcher and production Snippets. Actual Android
packaged-host seed/reload/process-restart, cached-font loading and native Settings
font-cache read/close passed. This is the defined full migration gate, not
whole-app/native UI parity. All 589 original browser names remain; the current
inventory has 600. Specialized legacy matrices outside the gate remain unrun.

The [retained failure ledger](RETAINED-BROWSER-FAILURES.md) preserves failed runs
and their repairs; those 15 observed cases closed at the full checkpoint above.
Statistics shares its nonreader composition. Settings shares its workspace,
field cards, category inventory and visit-local filter; specialized action owners
and the remaining screens below still need convergence. Actual native font-picker
import, typography visual parity and device accessibility remain unqualified.

The subsequent October 3 refinement fixes real 200% Reader inset measurement,
Continue-card label compression, Statistics hierarchy and current-link semantics.
Its source-position Return and focused geometry/Statistics cases pass locally in
Chromium and WebKit. These edits require another full run on their exact published
head; older green results do not qualify them. The PR records that run's outcome.

Each screen must qualify these seven dimensions on its final source:

1. **Visual:** palette, type, emphasis, states, icons and custom themes
2. **Layout:** responsive/short/large-text geometry, overflow, scrolling and overlays
3. **Interaction:** every control, draft, cancel, confirmation, error and retry
4. **Accessibility:** names/roles, keyboard, focus, screen reader, motion and target size
5. **Persistence:** original formats, ownership, offline behavior and atomic settlement
6. **Navigation:** direct links, route params, Back/Forward, fragments and save barriers
7. **Android idioms:** system Back, IME, native pickers/sheets, insets and touch behavior

## Screen ledger

| Screen and Svelte reference                                            | Visual                                                                                                      | Layout                                                                                                                                   | Interaction                                                                                                                              | Accessibility                                                                                                                                                         | Persistence                                                                                                                                               | Navigation                                                                                                                         | Android idioms and open gates                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statistics: `routes/statistics`, `lib/components/statistics`           | Common semantic tokens and ten measurement choices; selected exported appearance cases pass in both engines | Original calendar/filter/summary/sheet thresholds pass the 20-case selection in both engines; broader final inventory remains            | One controller; complete web editing/filter/goal/export actions; mounted common UI and domain tests pass locally                         | Real RNW/Expo UI HTML labels, focus, roving cells and keyboard cases covered; TalkBack/Compose picker naming, reduced motion and dense native day targets unqualified | Web original domain; native complete versioned projection and exact identity-key transaction admission; owner still performs full in-memory history reads | Shared focus lifetime, stale-confirmation retirement, canonical Library hint and account ABA tests; actual exports still must pass | Native goals/global recovery/export destinations remain explicit parity gaps; shared manual edits preserve fractional values and captured long titles; picker IDs use an RN wrapper because installed universal Picker drops its own testID; wrapper ID is not proof of control labeling |
| Settings: `routes/settings`, `lib/components/settings`                 | Compare every live group and custom-theme/background/font preview, not only scalar values                   | Preserve sidebar/search, dimension overlays, font/source/goal dialogs and large-text reflow                                              | **71 live groups**, not the older 65-group fixture or native 70-scalar projection; preserve preview/commit/cancel and advanced workflows | Native input labels/IME/focus and browser form/date/number semantics need bounded leaves                                                                              | Existing preference and goal/source transactions retained; native global goal ownership and protected source operations remain gated                      | Preserve category hashes, search, return intent, pending resolver and reader save barriers                                         | Workspace/cards/filter state shared; specialized editors still platform-specific. Native font import/management and owned cached-font loading implemented, exact-head APK journey pending; remaining background/goals/source flows need convergence                                      |
| Library/organization: `routes/manage`, `lib/library`                   | Existing cover, collection, series, badges and menus remain the reference                                   | Responsive card/list/sidebar/selection/menu geometry has known old-head failures; must converge rather than duplicate fixes indefinitely | Retain import, metadata, collection/series, completion, want-to-read, scoped selection, catalog and search inventory                     | Native list virtualization, target sizes, menu focus and announcements require actual qualification                                                                   | Existing identity/transaction guards, receipts and offline data preserved; focused domain tests do not qualify all browser journeys                       | Canonical native admissions and web route-owned queries exist; shared screen still pending                                         | Keep RN FlatList for bounded list rendering; Expo universal List is not virtualized on web; provider/export/backup gaps remain explicit                                                                                                                                                  |
| Snippets: `routes/snippets`, `lib/snippets`                            | Preserve editor/workspace/vertical-layout tokens and rich content                                           | Keep enlarged-text controls and bounded workspace geometry                                                                               | Preserve save/cancel/conflict/capture/restore/source links and formatting without flattening ruby or marks                               | Tiptap selection/IME may remain a bounded rich-content leaf; native workspace controls and focus must be shared                                                       | Existing document identity, conflict and position rules remain authoritative                                                                              | Save completion must own navigation and stale readers must retire correctly                                                        | Common composition pending; a separate native-only formatting experiment is not counted as shared parity                                                                                                                                                                                 |
| Account: `routes/auth`                                                 | Original signed-in/out/error hierarchy is the reference                                                     | Responsive form and status geometry unqualified in a shared route                                                                        | Preserve existing web sign-in/logout and failure behavior                                                                                | Browser links/forms and Android system auth return need qualification                                                                                                 | Web same-origin session/CSRF/account-generation flow stays intact                                                                                         | Preserve intended return route and revoke prior-account work                                                                       | A supported native first-party authentication transport remains a separate design/qualification gate; no invented token endpoint or cookie bypass                                                                                                                                        |
| Connections: `routes/connections`                                      | Preserve source/status/error emphasis                                                                       | Existing account/provider/local-folder panels need shared composition                                                                    | Connect, reconnect, disconnect, cancel and source errors remain distinct                                                                 | Picker/permission/focus behavior must be qualified per platform                                                                                                       | Credentials and persistent folder handles stay inside explicit system/owner ports                                                                         | OAuth/system return and pending source intents cannot attach to another account                                                    | Native provider transport, secure credential and persistent-folder capabilities are not established by rendering controls                                                                                                                                                                |
| TTU import: `routes/import-ttu`                                        | Preserve hierarchy, file labels, errors and progress                                                        | Retain large-text and compact import workspace                                                                                           | Same importer, exactly-once selection, validation, retry and cancellation; early native FileList handoff retained on web                 | File controls, status announcements and keyboard access need actual shared-route coverage                                                                             | No hidden upload or duplicate parse; original manifests/migrations/identity rules remain                                                                  | Route departure retires unclaimed selections and stale imports                                                                     | Shared route pending; native document-picker/cache-copy boundaries must not expose arbitrary paths                                                                                                                                                                                       |
| Shared libraries: `routes/shared-library`                              | Preserve membership/source status and conflict wording                                                      | Shared source/tree panels need common geometry                                                                                           | Keep membership, publish/pull, cancellation and conflict/recovery flows                                                                  | Tree/list semantics and native permission prompts unqualified                                                                                                         | Original account/ownership/source guards remain; completed versus unknown outcomes must remain truthful                                                   | Returning or stale operations cannot restore prior-account membership                                                              | Persistent directory capabilities and native provider contracts remain open                                                                                                                                                                                                              |
| Optional video: `routes/videos`, `lib/media`                           | Preserve optional-feature design and transcript states                                                      | Shared presentation and native player layout remain incomplete                                                                           | Existing transcript/search/player behavior remains under the full gate                                                                   | Captions, controls, focus and motion require target-specific evidence                                                                                                 | Existing media identity and transcript persistence remain authoritative                                                                                   | Deep-link/player lifetime/background behavior requires qualification                                                               | Not counted as shared or full Android parity; no new desktop/Apple targets                                                                                                                                                                                                               |
| Reader/Yomitan: `routes/b`, retained reader/Foliate/dictionary sources | Preserve ruby, vertical text, selection, typography and dictionary rendering                                | DOM layout is intentional on both platforms                                                                                              | Original reading/annotation/search/pitch behavior and save/cancel rules remain                                                           | Web text selection/keyboard and native WebView accessibility need real execution                                                                                      | One Android DOM storage owner, origin/worker/OPFS/Web Locks and process-death persistence require packaged-host evidence                                  | Real web lifetime tests and native close/back admission are separate from mere export success                                      | Actual packaged host and seed/restart probes pass; full native reader UI, accessibility and device qualification remain open                                                                                                                                                             |

## First shared slice: precise evidence boundaries

Statistics uses actual `@expo/ui` 57.0.21 controls in mounted RNW tests, not a
replacement set of fake Picker/Switch/Checkbox implementations. Data effects are
typed fixture ports in those tests; production owner/transaction/transport tests
separately exercise the real algorithms. Neither kind of test establishes
browser layout or Android Compose behavior.

- Both route graphs must include the same `StatisticsScreen.tsx` and controller
- The Android shell must not import DOM storage/renderers; web ports must not
  hide a second whole-screen renderer behind the common entry
- Retained 49 controller/service scenarios were split into smaller files without
  losing their names or assertion bodies; original identity/deletion coverage stays
- Native transport tests cover more than 200 choices and 10,000 rows, incomplete
  transfer refusal, cancellation-before-admission, account/identity replacement,
  private mutation admission and same-title/secondary-key destructive isolation
- Library Open receives only a bounded identity hint, never a capped legacy
  projection or a mutation proof; the eventual shared read revalidates authority
- The canonical 20 browser cases retain original geometry, keyboard, appearance,
  export and identity assertions, identically selected in both production export
  modes and Chromium/WebKit. See `tests/browser/statistics_acceptance_cases.py`

Local combined suites have also encountered stopped esbuild services before
application assertions. Those runs remain failed/unqualified, even where the
same cases pass in isolation. Exact-head CI, actual browser geometry and actual
packaged-host execution remain required evidence. The three-job policy and
explicit **affected versus full** scopes are recorded in [CI-COVERAGE.md](CI-COVERAGE.md).
No affected-only pass replaces the full final web parity gate.

## SDK 57 component policy and research gates

Official universal APIs and the pinned installed implementation must both be
checked. The common style surface is intentionally smaller than RN styles; use
RN/RNW for branded screen layout rather than forcing every row into Compose.
[Expo UI universal](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/),
[Host boundary](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/host/)

- `Host` embeds Compose in RN; `RNHostView` embeds a single RN root inside Compose
  layout. Avoid unnecessary boundary crossings, particularly per Library row
- Browser form, dialog/menu/popover, date and focus leaves remain justified where
  universal APIs do not preserve the existing contract. No wholesale new UI
  framework is required
- The installed universal and community Slider do not expose a commit callback.
  The Android Compose Slider exposes `onValueChangeFinished`; an Android leaf may
  pair that event with the latest draft while the common controller owns commit,
  cancel and account/route lifetime. Web pointer/key completion remains explicit
- Native Picker ID propagation, field naming, keyboard/inset ownership, modal
  motion and calendar target size require actual Android checks. `testID` on a
  wrapper alone is not evidence that TalkBack names/operates its Compose child
- Preserve the released button semantic foreground and web hover color-mix rules.
  Current theme generation gives foreground and secondary-foreground equal
  values; using the correct semantic token is still part of the component contract
- Universal List is a native lazy list but a scrolling web View in the pinned
  implementation. Do not infer cross-platform virtualization from its API name

The next convergence is Settings with its complete 71-group inventory, followed
by Library/shared shell, Snippets and account/import/source workflows. Every
remaining row above stays open until its dimensions are qualified, with specific
capability gates rather than silent stubs or arbitrary native snapshot truncation.

## Finite remaining screen and flow inventory

There are nine nonreader UI routes (plus the index redirect). Statistics is the
first shared complete composition; the eight remaining screen closures are:

1. **Settings:** finish common scalar/specialized editor composition and native
   background image selection/rendering, account-owned goals/history and storage
   integrations. Font import/cache management and embedded cache consumption are implemented;
   actual picker and visual typography qualification remain open.
2. **Library:** converge the full shared screen/shell while retaining local
   import/open/delete, collections/series, selection, metadata, completion,
   want-to-read, covers and passage search. The eight saved sort choices now use
   shared labels/validation and the existing DOM-owned preference. Shelf layout
   keys/defaults now share one definition; native grid/list saves use the admitted
   Library/series/Finished destination and restore from the existing DOM storage
   owner on remount. Finished preserves the web grid/timeline preference, with a
   native list fallback until the timeline composition is implemented. Actual
   packaged layout-control/process-restart and accessibility acceptance remain
   unqualified. Continue/series heroes, finished timeline and common
   search/selection composition still differ.
   Native backup/export destinations and
   provider/folder access remain open. This is the largest next everyday-screen
   implementation now underway. Ordinary book-face and eight-field metadata-editor compositions and canonical
   reading labels are shared in current local source; native cards/controls consume
   saved appearance. These are not a complete shared workspace or packaged pass.
3. **Snippets:** converge the editor/list/toolbars and rich-text behavior; the
   separate native text editor is not complete rich-text or shared-screen parity.
4. **Account:** implement and verify native sign-in/session handling using a
   supported existing contract. Refresh/logout alone do not establish sign-in.
5. **Connections:** native provider authorization, secure WebDAV credential
   handling and persistent folder capabilities, with existing ownership guards.
6. **TTU import:** native scoped backup/settings/profile-choice UI and guarded
   transfer/commit behavior, preserving the existing web migration flow.
7. **Shared libraries:** shared import/export/conflict presentation and native
   provider/directory adapters; this depends on Connections capabilities.
8. **Optional video:** shared player/transcript/MOSS presentation when enabled,
   with real native media/worker behavior. Podcasts are outside this PR's scope.

**Statistics still has native flow gates:** account-owned goals/global recovery,
clipboard/export/share destinations and actual native control accessibility.
Shared composition does not make unsupported owner operations available.

**Reader/dictionary remain intentionally DOM-rendered.** Preserve the existing
neutral interfaces and separate packaged dictionary/source boundary; do not copy
GPL dictionary internals into Reader shared UI or change licensing here. Full
reader text selection, IME/insets, TalkBack, device/WebView matrix behavior and
real-book process-death recovery still need product-level qualification.

The final web gate remains the complete original browser inventory. Every screen
also retains the seven dimensions at the top of this document. Green selected
CI suites cannot close omitted screens or platform contracts.
