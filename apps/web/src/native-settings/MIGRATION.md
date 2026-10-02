# Android-native settings

## Integration

- Export `NativeSettingsScreen` from `native-settings/index.ts` at the Android settings route. Rendering uses React Native layout and Expo SDK 57 universal `Host`, `Button`, `Switch`, `Picker`, and `TextInput`; it does not embed a settings WebView.
- Admit `settings.state` and `settings.action` in the existing bridge allowlist. In the single DOM owner, call `readNativeSettingsState(payload)` and `dispatchNativeSettingsAction(payload)` from `native-settings/service.ts`.
- These return `NativeSettingsState` directly, not `RuntimeSnapshot`. The native screen owns this DTO and does not use the old 33-field `snapshot.settings` array.
- Do not import `service.ts` into native code or create another reader/store/IndexedDB owner. No iOS or macOS targets are added.

## Exact feature inventory

70 explicitly admitted scalar controls, derived from existing controls rather than reflection over store exports:

- Appearance: system/light/dark; built-in and valid custom theme selection; reader and web-library background fade toggles and amounts (0–100%)
- Fonts and text: primary/serif and sans-serif names; available packaged/previously imported font choices; current effective primary font; nullable font weight; font size; line height; indentation; paragraph margin mode/value; vertical kerning/VPAL/orientation; justification; pretty wrapping
- Layout: continuous/paginated; horizontal/vertical; slide/no page-turn effect; margin and maximum dimension pixel inputs with source-derived percentage presets; resize positioning; paragraph page-break preference; horizontal page columns
- Reading: swipe threshold; reader style priority; keep-awake preference; all four footer/progress counters; wheel navigation; close confirmation; manual/automatic bookmarks and interval; spoiler blur/mode; furigana hiding/style; custom-point tracker pause; custom point toggle/reset; selection-to-bookmark; edge-tap page turn
- Library and sync preferences: external-source warning; EPUB fixes/link restriction; external data caching; automatic import/export preference; save behavior; placeholders
- Tracking preferences: keep local statistics on deletion; completion-date overwrite; start-of-day hour; statistics/goals merge preferences; tracker enablement/auto-pause/completion/start delay; idle minutes; forward/backward skip thresholds/action; dictionary detection; idle rollback

The 65-group source fixture contains 64 scalar-bound groups and the persistent-storage group. All 64 scalar groups retain explicit native schema entries and source IDs. Appearance, page-turn effect, and four background fade controls bring the native scalar inventory to 70. Custom theme create/edit/rename/copy/delete, dimension presets, and reading-point reset are separate bounded actions, not arbitrary object setters.

Native custom themes keep the seven existing color fields, including zero alpha, and reuse `parseColor`. Built-in/reserved names, prototype keys, duplicates, stale palettes, unknown color fields, CSS URLs, and excess palettes are rejected. Theme names have a 128-character transport bound and native theme editing/listing has a 128-custom-theme bound. Existing malformed or excess themes are not silently removed.

## State and lifecycle rules

- Preferences remain device-local source stores; no new defaults or second persistence layer are introduced. Numeric source limits and actual enum spellings are preserved. Unbounded source numeric fields have only a finite safe-number transport ceiling. Font names retain the resolver's 1,024-character bound. Empty font weight means `null`.
- Idle time displays minutes and writes seconds through `trackerIdleSecondsFromMinutes` (maximum 12 hours). Switching paragraph margins to automatic retains the source's explicit zero reset, but reading a settings DTO never writes preferences.
- Service calls acquire/check/release `captureLibraryOperation`. The parent bridge still provides version/session/epoch/request admission, replay protection, and reconciliation semantics. No setting accepts an arbitrary export name, profile ID, database path, credential, source object, or goal/history table.
- Text/number drafts use Apply/Cancel and an expected saved value. Drafts survive unrelated refreshes; stale baselines are rejected. Choices and switches save once. Pending requests reject repeated taps. A failed or uncertain request requires a successful explicit state refresh before another mutation; commands are not automatically replayed.
- Screen lifetime ends on navigation blur, unmount, or profile/session change. Late replies are discarded. Delayed confirmation alerts capture their original capability and cannot call into a replacement session. React development effect replay creates a new session.
- Conditional source controls remain searchable but cannot be changed while inactive. Dimension preview/rotation only recalculates presets; it never writes a saved size.

## Explicit integration gates

- Native background-image selection/transfer and native library image rendering are not connected. Existing reader images are preserved; fade controls apply to already configured reader images. Library fade controls are explicitly labeled as web-library preferences.
- Native font-file import/cache removal requires a scoped file-transfer adapter. Existing font names and packaged fonts remain selectable. No local file paths are returned in DTOs.
- Native first-party/provider session handoff, persistent directory capabilities, and credential-backed WebDAV connection management remain separate integration gates. Saving a sync preference does not connect a source or prove a sync ran.
- Android storage protection/eviction behavior needs actual device integration checks; browser persistence is not represented as persistent native directory permission.
- Advanced reading-goal/history/merge/sync flows and legacy global orphan-statistics cleanup are withheld until ownership-aware services exist. Global legacy tables are never exposed to make these flows appear implemented.
- Keep-awake and other device-sensitive preferences still need parent/device adapter verification. No emulator, device, browser visual, or interaction result is claimed here.

## Verification

Commands run with the existing Node 24.21 binary and installed dependencies:

- `node --test test/expo/native-settings.test.mjs`: 20 focused tests pass, covering exact source inventory, bounds/enums, DTO privacy, explicit setters, stale edit rejection, profile/lifetime cancellation, theme CRUD/conflicts, idle-unit conversion, automatic-margin reset, background isolation, duplicate requests, reconciliation, and effect replay
- `node test/expo/native-settings-build.mjs`: Android-native UI and DOM-service esbuild checks pass; the native module contains no Svelte settings or store owner. External domain/runtime boundaries are intentional, so these are not Metro/Android exports
- `node --max-old-space-size=512 test/expo/native-settings-typecheck.mjs`: zero strict TypeScript diagnostics against real React Native and Expo UI types, with a declaration at the runtime-owner boundary
- Strict dependency-resolved check of pure schema/contract/service-core/lifecycle: zero diagnostics
- An initial check following the full native runtime graph was OS-killed with exit 137. It is not counted as a passed full-application check. Parent full CI/Metro/build/device verification remains necessary
