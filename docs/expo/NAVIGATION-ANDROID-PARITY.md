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
- Final APK SHA-256: `9d3dc3cc03261e5fe4f3355830ab3a32e4070cf04381efa9ba8b6c0a93254008`. Final source includes the labeled-toggle layout repair, theme-aware Accounts/placeholder text, and automatic native status-bar styling. Accounts dark and light status-bar evidence were captured from this APK. Earlier captures of unaffected screens predate it; `previous`, `interim` and explicitly named before-repair frames are excluded from the final gallery selector.
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

## Remaining qualification boundaries

Native Shared libraries and Ttu import still render migration placeholders, and native Library does not yet have the wide web sidebar. Those are incomplete parity surfaces, not merely visual differences. Full Android tablet or whole-app parity is not claimed. This work qualifies phone navigation and selected native controls rather than every native screen action. Physical-device TalkBack/keyboard, system gestures, provider login, native document/font picking and the complete platform acceptance matrix remain separate gates.

WebKit's injected OPFS directory lacks the nonstandard `queryPermission` method required by the external shared-folder fixture. The assertion remains unchanged; modern external directory-picker publishing is qualified through Chromium, not this WebKit injection. No checks were weakened to claim unsupported filesystem functionality. See the existing [fidelity matrix](FIDELITY-MATRIX.md) and [retained failure ledger](RETAINED-BROWSER-FAILURES.md) for the broader migration boundaries.
