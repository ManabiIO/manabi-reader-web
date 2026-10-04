# Navigation and Android visual QA — October 4, 2026

Expo migration [PR #257](https://github.com/ManabiIO/manabi-reader-web/pull/257) is merged at `9c416a7bc69d9aef43cac8aa34f5673f70a323be`. Refinements continue directly on main. The original dirty Svelte checkout is preserved separately.

## Navigation and visual decisions

Library owns the global destinations. Pushed screens have a Back action and contextual overflow; they do not repeat global destination tabs or offer a link to themselves. Settings categories and Statistics Summary/Heatmap remain local navigation. Wide web Library retains its sidebar; compact web does not gain a sidebar drawer. Pushed Settings uses its own category workspace.

Web Back preserves the admitted arrival URL and existing save/navigation guards. Native Back uses the stack, with a Library fallback for a cold route. Snippets header Back and hardware Back share the draft checkpoint; failed checkpoints retain the editor. The native workspace retires listeners when its route loses focus.

The default Manabi theme now uses grayscale primary controls, focus rings and selection chrome, with existing custom themes preserved. Red/gold remain meaningful reading/activity accents. Native buttons and toggles use explicit Expo Compose colors rather than relying on a black Material seed, which still produced chromatic controls.

Native Library has cover-led transparent shelves, fixed-width grid cards, 2:3 covers capped at 200 dp, quieter status and readable list dividers. Two labeled switches formerly overlapped inside an unconstrained Expo Host; they now have separate width-constrained hosts and native accessible names. Short contextual menus size to content and tall menus scroll within the safe area.

## Screenshot evidence and provenance

The local navigable gallery is `test-results/expo-parity-review/navigation-final/index.html`, served at [the comparison gallery](http://127.0.0.1:4183/navigation-final/index.html). Evidence is intentionally ignored rather than checked into source.

- Preserved Svelte baseline: `7d552c47de7f0da9a723cc7645ea148482cd238f`, 27 matched frames.
- Expo web: 33 frames per Chromium and WebKit, phone 390×844, desktop 1200×900, enlarged/dark 320×568 at 200% root text. Every frame records zero document horizontal overflow and no browser errors in its `frames.json`.
- Android: actual Pixel 7 API 35 arm64 emulator, 1170×2532 physical pixels at density 480 (390×844 dp), release APK. System appearance is automatic; dark captures use real Android night mode. Enlarged Android uses font scale 2, which is a different layout condition from the smaller web viewport.
- Navigation refinement APK SHA-256: `6783387f427ad9d6071efb5fe4ab55ad255abb54a563174504c0390b8a49f7fe`. Its source includes the labeled-toggle repair, theme-aware text, focused status-bar contrast, quieter Settings navigation and native menu refinements. Wide Settings and the refreshed phone menu evidence use this APK. Earlier unaffected screens and appearance-mismatch captures predate the wide layout adjustment; `previous`, `interim` and explicitly named before-repair frames are excluded from the final gallery selector.
- All platforms use identical Alpha, Beta and Zulu EPUB inputs recovered from the Android Downloads fixtures. SHA-256: Alpha `804d4bf4a3b045e6c0d5c00471ad1d2b3be4e3a2f9f41aad153feb9a8eb0b810`; Beta `44267b09f4edcb53764ba77ebb47556b90eec85f08fcd3221c5ea2e2473c0d20`; Zulu `050138f360bf9231218929c4ec61b09be0691d7065c7f76d15dd711db1ec3c05`.

Reading history, clock/period selection and drafts are independent across the stores. Android system insets and native Material fields are intentional differences; screenshots are not a pixel-equality assertion. The enlarged Library cover cap, switches and short Settings menu were inspected on the actual emulator. Library list preference survived force-stop/relaunch. Snippets header Back returned to its shelf, and the saved `Nav` test draft reopened with its title intact; the second Back returned to Library. That draft remains in the isolated QA emulator.

The [Apple reference board](http://127.0.0.1:4183/apple-references.html) contains actual Books app screens from the macOS Tahoe 26 and iOS 26 guides, current apple.com, and the [March 2026 App Store Connect refresh](https://developer.apple.com/news/?id=hh6v4b55). Guide artwork can be reused across releases; these are official published references, not fresh device captures. Svelte is a behavioral baseline, and its stock shadcn appearance is not a requirement.

## Repairs and executable checks

The actual merged APK failed to load Statistics because React Native's AbortSignal lacks `throwIfAborted`. A shared assertion preserves cancellation reasons and works with that signal implementation. Statistics and native cover selection use it; service tests cover cancellation and owner replacement. Statistics now loads and its menu/filter respond on Android. A long-idle cover read can outlive its ten-minute admission; the native controller now refreshes an expired cover view once per user viewport change, without polling missing/broken images or weakening the admission lifetime. Thumbnail read/cancellation failures stay in their local fallback rather than leaking a global error onto the next screen.

An enlarged Library submenu could cover its trigger after hover in WebKit. It now uses bounded above/below placement, with normal-pointer regression coverage passing in both engines. Statistics toolbar stacking now leaves its visible menu clickable.

Actual Android dark-mode Accounts text was nearly invisible. Accounts and the two placeholder screens now use the theme foreground. Light-mode status-bar icons were white on white; the native root now mounts Expo's automatic status bar. Both system appearances were verified on the installed release APK, and the mounted root/CI-policy selection passes 38/38. Strict types and lint pass after these final changes. The gallery's 13 phone comparisons and seven Android stress frames were checked for successfully loaded images.

Local checks:

| Check                                         | Result / scope                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Full unit suite                               | 1664/1664 passed before the final native host-only layout/semantics repair                    |
| Full Expo contracts                           | 567/567 passed after the native host layout and expired-cover admission repair                |
| Strict Expo TypeScript and ESLint             | Passed on final implementation                                                                |
| Settings/Statistics/Connect browser selection | 58/62 initially passed per engine; all four affected failures repaired and rerun successfully |
| Additional Chromium reader/queued-open cases  | 9/9 passed                                                                                    |
| Additional WebKit reader/queued-open cases    | 8/9 passed; unsupported injected external-folder permission fixture remains unqualified       |
| Snippets React / native workspace             | 20/20 and 6/6 passed, including header checkpoint failure/cleanup                             |
| Enlarged Library submenu browser case         | Passed in Chromium and WebKit                                                                 |
| Preference recovery selection                 | 7/7 passed locally                                                                            |
| Media strict compile/core tests               | 918 passed, 3 speech-fixture-dependent cases skipped                                          |
| Android release build                         | Successful; actual install preserves imported books                                           |

Merged main had two failed CI jobs. The isolated Media CPU job installed TypeScript without its declared Node types; its setup now pins `@types/node` and supplies that isolated type root. This repairs compilation but does not claim local real speech CPU qualification. One Books preference-sync case observed the default font size before its first-sync intent; the isolated original case passed locally. The test now observes the actual persisted font-size write before enabling sync. This is a stronger readiness precondition, not a proven production data-race diagnosis. The first refinement main CI run passed Media CPU qualification. It also exposed three retained browser selectors for the removed Navigate/Back to Library controls and a generated-palette formatting mismatch. Those selectors now target the contextual Snippets actions and Back controls; generated palettes are excluded from formatting so the exact generator check remains authoritative. The full Books browser/file-operation selection passed on the first refinement head; its required data-safety dispatcher found one more retained Back to Library selector in the pending-save cancellation case. That selector now targets Back, preserving its cancellation assertions. The subsequent main CI run remains the authority for the final head.

## Further refinement pass

Android Settings categories now use quiet local navigation: an underline in compact layouts and a full-width gray selection row in the wide category column. The native workspace is bounded to 1000 dp, and Color mode/Theme precede custom-theme controls. Native menus use consistent left-aligned rows, a 280 dp width bounded by the viewport, and a separator between screen actions and global destinations. Shared libraries and Ttu import remain direct migration routes but are omitted from Android menus while unfinished. Accounts has no empty overflow trigger. These changes do not remove web destinations or implement the missing native integrations.

Selecting a dark app appearance on a light Android device reproduced invisible status-bar icons despite the root's automatic styling. Focused themed screens now own icon contrast and release it on blur, so retained stack screens cannot override the pushed screen. Actual screenshots also verify the reverse mismatch (light app, dark device). The general native error banner now consistently uses its resolved theme. A mounted regression covers appearance updates, blur and Back; another preserves the web destinations while checking native menu availability. The updated Library regression checks both Expo control theming and the actual RN menu text theme. The full Expo contract suite passes 567/567; the selected native Library/navigation suite passes 21/21. Strict types/lint and production web/release Android builds pass.

Wide Settings Appearance and Fonts & text were also inspected using an emulator display override of 1800×2400 pixels at density 240 (1200×1600 dp). This is a responsive layout check on the existing Pixel emulator, not full Android tablet acceptance. The default phone geometry is restored afterward.

## Connections numeric editing review

The `a1c0a810` main run passed the other application workflows but Books failed in WebKit before preference-sync consent: the first font-size edit still showed 20. The unchanged case, full recovery suite and 20 fresh-profile first edits passed locally. That intermittent failure alone does not establish its cause.

A focused browser check did reproduce a separate control defect: clearing Font size immediately persisted/restored the default 20, preventing a normal replacement edit. The Connections control now keeps a React editing draft, publishes only whole sizes in its advertised 8–96 range, restores the last saved value on invalid blur, and admits real external preference updates. The new browser case fails against the preceding build and checks clear/type, account refresh, invalid sizes, reload durability and account-sync replacement. Original lost-reply and conflict assertions remain intact. The eight-case recovery suite passes in Chromium and WebKit; 33 selected Settings unit checks, strict types, lint and the production web export pass. Native source and the qualified APK are unchanged by this web field repair. Final CI results are recorded separately in the ignored qualification evidence.

## Browser stack Back refinement

A real Library → Settings → Back round trip previously increased browser history length and made browser Back reopen Settings. Web header Back now traverses the nearest tracked earlier entry for its captured return URL, including its original state, query and fragment. Settings category entries can be skipped without fabricating a new Library or reader visit. Browser Forward retains the original Settings arrival. A cold visit replaces its local fallback instead of guessing an untracked history position. Settings, Snippets and the shared pushed-screen Back link use this behavior; modified link gestures retain the ordinary href.

Returns share the existing navigation save/cancel protocol. An issued return revoked by a newer app/account intent restores the outgoing entry before subsequent dispatch. Five new mounted navigation/broker regressions cover state/Forward preservation, synchronous cancellation, failed and successful reader saves, cold fallback and supersession. All 1671 unit tests, 567 Expo contracts, strict types, lint and the production web build pass. Real Chromium/WebKit checks cover Settings categories, Accounts, Snippets, Statistics, the reader font-size round trip and queued-open cancellation. One retained same-document cancellation fixture depended on Back pushing Library; it now uses the actual Forward traversal back to Settings and keeps its transaction-abort, same-document, retained-pointer and retry assertions. The preceding queued-open case still exercises native browser Back.

## Android reader frame review

A forced-dark reader on a light Android device revealed a separate transition defect: the status bar remained visible with dark icons on a black page. Showing reading controls also exposed the top toolbar underneath those icons. The persistent native reader frame now applies the device's safe-area insets on every edge, with the resolved DOM chrome background behind them. The DOM forwards appearance and selected/custom theme changes; the visible reader owns status-bar icon contrast until its save/close completes, then releases it to the destination screen. The DOM host remains mounted across appearance, inset and route changes.

The final rebuilt release APK SHA-256 is `450f0aab68c6711a9615ad929a1f22fffe2039adadf43dec23971442b4abacfd`. Actual Pixel 7 screenshots qualify dark-reader/light-device and light-reader/dark-device contrast, the toolbar below the status bar, and landscape cutout spacing. App appearance is restored to System; night mode, rotation, font scale and phone geometry are restored after inspection. The gallery's final Reader frame and reader stress frames use this APK; preceding versions are retained beside them, and the navigation and wide Settings frames retain the earlier APK provenance above.

Expo regenerates native action proxies when delivering props. Including the proxy in the appearance effect caused unchanged chrome to echo back to native. A real callback-renewal regression failed on the initial frame fix. The effect now uses React's Effect Event to call the current proxy only when appearance/theme values change, and the native receiver preserves state identity for duplicate values. This keeps appearance delivery from feeding repeated prop updates across the bridge.

Two new mounted regressions cover native frame appearance/rotation/save ownership and DOM appearance/custom-palette forwarding without reopening the book. All 1671 unit tests and 569 Expo contracts pass, as do strict types, lint and the Android release build. The preceding `684ab1b7` main CI run passed every triggered application workflow. Its Books first attempt timed out waiting for WebKit's directory-upload event despite the screenshot showing both imported books; the unchanged case passed locally in both engines, and the unchanged failed job passed on attempt two. The original failure and retry record remain in the qualification evidence. CI for the reader-frame refinement is recorded independently against its own commit.

On `3e780555`, Books and all other application workflows passed; Appearance's overall 20-minute job timer canceled browser acceptance immediately after the final module reported success. Its retained artifacts show all 164 browser cases per engine passed (328 total), plus successful units/types/build. The overall job budget is now 30 minutes to accommodate both engines and evidence collection. Individual module timeouts, failure propagation and all assertions remain unchanged. The canceled attempt remains recorded independently of the subsequent CI qualification; this is a workflow completion repair, not a diagnosed product failure.

## Remaining qualification boundaries

Native Shared libraries and Ttu import still render migration placeholders, and native Library does not yet have the wide web sidebar. Those are incomplete parity surfaces, not merely visual differences. Full Android tablet or whole-app parity is not claimed. This work qualifies phone navigation and selected native controls rather than every native screen action. Physical-device TalkBack/keyboard, system gestures, provider login, native document/font picking and the complete platform acceptance matrix remain separate gates.

WebKit's injected OPFS directory lacks the nonstandard `queryPermission` method required by the external shared-folder fixture. The assertion remains unchanged; modern external directory-picker publishing is qualified through Chromium, not this WebKit injection. No checks were weakened to claim unsupported filesystem functionality. See the existing [fidelity matrix](FIDELITY-MATRIX.md) and [retained failure ledger](RETAINED-BROWSER-FAILURES.md) for the broader migration boundaries.
