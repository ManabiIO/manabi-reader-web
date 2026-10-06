# Shared Statistics composition

Both `screens/routes/statistics.tsx` and `statistics.web.tsx` import the same
`StatisticsScreen.tsx`. That entry, its four child views, and `controller.ts` are
shared by Android and web. The retired `statistics-react/statistics-screen.tsx`
and `statistics-react/native-screen.tsx` are reference/legacy-test code, not route
presentations. No route-sized web view is embedded in the Android screen.

## Interaction and presentation

- The common controller owns query/source/aggregation/sort state, title-selection
  drafts, row drafts, confirmation admission, reads, write leases, and exports
- The Expo focus boundary lives above the port hook. A retained, blurred Stack
  route unmounts its inner controller and every overlay. Refocusing constructs a
  fresh owner port; stale callbacks cannot reuse a previous confirmation
- Blur retires callbacks and read/proof authority. It does not promise rollback
  of a transaction that has already committed. Existing owner transaction guards
  determine whether a not-yet-committed write can still be aborted
- Title-list paging and heatmap roving focus are local presentation state;
  preference changes and selection application still pass through the controller
- Header, toolbar, summary, filter, settings, calendar decisions, and navigation
  content use one RN/RNW composition. The source preserves the web date controls,
  all ten measurement choices, aggregation and sort, title/identity prefilters,
  25-title pages, responsive summary pages, value/title details, editing in raw
  seconds, min/max reset, destructive confirmations, independent reading/goal calendar periods and streak highlights,
  configured Statistics shortcuts, clipboard and raw/TTU export actions
- `theme-option.ts` remains the palette authority. Shared tokens retain the
  original geometry, state colors, root-scalable browser typography and native
  font scaling. Native first entry shows a neutral loading surface until the
  owner supplies its saved theme; a same-owner cached theme can paint earlier
- SDK 57 `@expo/ui` Checkbox, Switch, Picker and Android Icon are actual controls,
  hosted only at those control boundaries. Branded layout and actions remain
  RN/RNW. Android Picker retains Material styling exposed by the installed SDK

## Bounded platform leaves

All leaves below are under `shared-ui`; none reads statistics history, selects
books, aggregates data, exports files, or makes query/mutation decisions.

- `AppFrame`: native safe-area ownership versus the same RNW root layout
- `ExternalLink`: original browser User guide destination/new-tab gestures; only
  explicitly available absolute destinations may be offered on native
- `layout-direction`: computed browser target direction versus native RTL state
- `FieldFrame`, `TextField`, `useActionRef`: real browser form association/date
  semantics/title attributes versus native input/focus behavior
- `ModalSurface`, `Menu`, `AnchoredPopover`: browser modal/nonmodal focus, Escape,
  outside-pointer ownership, sticky/flow chrome and native Modal/Back behavior
- `CalendarLayout`: CSS grid/scroll semantics and original class hooks on web;
  the same supplied cells use native scroll/position geometry on Android
- `FocusPage`: focus the new browser page's first control; announce native page
  changes for accessibility
- `ShortcutListener`: bounded browser window key listener; all equivalent touch
  controls remain in the common screen on Android
- `UiIcon`: existing Lucide web components; identical licensed path data as
  Android vector assets hosted by Expo UI. Licenses are retained in `icons/LICENSE`
- `Presentation`: browser semantic CSS for the limited Expo UI styling surface

Data/effect differences are explicitly typed in `ports.web.ts` and
`ports.native.ts`. Android capability notices remain visible for ownerless
reading goals, global history/recovery, clipboard and native TTU destinations;
these are not falsely represented as completed native capabilities.

## Qualification

`test/expo/shared-ui-primitives.test.mjs` runs the actual installed RNW and Expo
UI controls (not RN/Expo control shims). `shared-statistics-screen.test.mjs` mounts
the production common screen/controller with a typed data-port fixture and real
RNW/Expo UI, including lifecycle/confirmation/draft/focus behavior. Pure owner,
transport, aggregation and transaction tests remain separately authoritative.

`tests/browser/test_statistics_shared_route.py` adds real-route, real-IndexedDB
and real-download acceptance to the existing browser job. Existing panel,
heatmap-grid, enlarged-text, filter-sticky, appearance and raw-recovery assertions
are retained. Browser layout/screenshot and Android device qualification must run
against the exported application; passing JSDOM or source graph tests is not a
claim of browser geometry or native device parity.
