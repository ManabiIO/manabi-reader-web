# Settings, account, and migration React port

## Entry points

`index.tsx` imports the compiled `settings.css` and exports `SettingsScreen`, `ConnectionsScreen`, `AuthScreen`, `SharedLibraryScreen`, and `ImportTtuScreen`.

Each view has an adjacent `*-controller.ts` factory. Controllers retain the original domain functions, stores, async guards, cancellation, transaction calls and dialog resolution contracts. Rendering uses React and the shared `reader-react/controller.ts` lifetime; no Svelte runtime is imported. `context.tsx` carries settings search/field labels through React context. `primitives.tsx` supplies DOM fields, slots, switch, popover and event/binding adapters and reuses the React library menu/navigation.

Included children: settings workspace/header/content; all 65 existing setting groups; custom themes; font management; dimension presets; reading goals/history/merge/sync; storage-source management; offline/persistence status; light/dark appearance/background images; WebDAV connections; TTU/Yatsu inspection, selection, destination, import/conflict retry/cancellation.

## Validation performed

- `NODE_PATH=/tmp/manabi-react-port/node_modules node --test tests/unit/rhea-ui.test.mjs tests/unit/settings-react-controller.test.mjs`: 16 tests passed
- TypeScript `transpileModule` syntax pass across all 57 TS/TSX source files: zero syntax diagnostics
- Sass compilation of the migrated scoped component CSS succeeded; Metro imports the resulting plain `settings.css`
- A dependency-isolated `noResolve` strict semantic pass was run to catch unresolved local names and extraction collisions. It is not a full type-check: unavailable dependency types and untyped render callbacks still produce diagnostics

Specific tested behavior: exact 65-setting manifest/store bindings; initial context-store reads; local/global search; dimension previews/resizing do not overwrite saved pixel settings; background subscription replacement/cleanup; reading-goal edits survive hydration; TTU duplicate-inspection guard, unchecked settings default, immutable row selection/target changes, cleanup; authorization begins only after mount and reports provider failure.

## Deliberate corrections discovered during migration

- Abort controllers in WebDAV/TTU were renamed `operationController` so they cannot replace the view lifetime controller
- Local stores initialize before dependent derived computations
- Reading-goal hydration depends only on the saved goal, not its editable fields
- Nested row selections publish a new row array so derived selected counts update
- Navigation callbacks are owned by controller cleanup
- Settings initial category reads the current URL hash
- Authorization failures are displayed and forwarded to the opener, rather than preserving the legacy commented-out failure handler. A missing/unresponsive opener rejects with an actionable error; raw callback URLs/tokens are not exposed in errors

## Remaining integration and parity verification

- These are web DOM React screens. Android must use the parent Expo/RN screen and bridge implementations; this folder does not establish full Android-native settings/account/folder support
- Actual Expo/Metro web and Android exports and browser/device visual/interaction suites have not run here. Installation/integration is owned by the parent task
- Full dependency-resolved `tsc` remains necessary; generated TSX event/map callbacks need contextual or explicit types under strict checking
- The new lightweight settings popover needs browser checks for focus, hover, placement/collision and legacy `containerStyles`/`innerContainerStyles` parity. It supports click/hover open, Escape/outside dismissal and viewport-bounded placement; it is not the former bits-ui implementation
- OAuth popup/PKCE provider flows, stored credentials, directory permission prompts, WebDAV uploads, live cloud sync/conflict resolution, real font caches and real TTU/Yatsu ZIPs require integration runs
- Settings Back navigation uses the existing route adapter; the parent should verify it records the external entry route before the settings controller subscribes
- Existing pure TypeScript domain algorithms and account-generation fences were not rewritten

## Strict TypeScript CI integration corrections (2026-10-02)

The 109 `settings-react/**` diagnostics reported by the dependency-resolved CI run on `8b0c0a0` were addressed without turning off strict mode or adding diagnostic suppressions:

- Binding callbacks name the exact existing controller/model type; browser event callbacks use native DOM or React synthetic event types appropriate to the adapter path
- Derived theme options, import rows, goal-history pages, sync choices, and shared-library choices have domain types rather than erased array types
- Read-only derived observables (`resolvedMode$`, `storageSources$`) and the read-only field-filter context expose getters only; generated setters no longer pretend to write them
- Element refs which can be cleared on unmount are nullable and guarded; IME key handling reads React's native keyboard event
- The shared React `AppNav` now restores the original compact trigger, primary links and full navigation sheet; the Settings header passes `compact` again
- Settings buttons reuse the original `snippets-react/button-styles.ts` variants via `cn`, preserve their event/binding adapter, prevent disabled activation, omit disabled-link `href`, and retain explicit keyboard tab order

Post-change checks: the 16 existing settings/Rhea controller and source-parity tests pass alongside 20 new native-settings tests (36 total). A dependency-resolved local settings-root strict check has no residual diagnostics from the posted CI failure. Its two remaining settings-file diagnostics are unresolved `showDirectoryPicker` and `PasswordCredential` globals because this partial local dependency installation does not contain `@types/wicg-file-system-access` or `@types/webappsec-credential-management`; both are already declared dependencies and referenced by `manabi-browser-types.d.ts`. Those two errors were absent from the real CI log. A fresh full dependency-installed CI run is still required; a local pass is not being substituted for it.
