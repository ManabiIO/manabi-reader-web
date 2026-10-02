# Statistics React / Expo migration

## Active web route

`index.tsx` exports `StatisticsScreen`. The route, toolbar, options sheet,
private title-filter sheet, responsive summary, summary column controls, and
statistics/reading-goal heatmaps are React components. The original computation,
identity selection, aggregation, goal-window, streak, export, and edit/delete
functions were retained in ordinary TypeScript controllers. The active graph
contains no Svelte components, compiler, or runtime.

Preserved web interactions include:

- Summary/heatmap navigation, resume-reading and application navigation
- Today/week/month/year/custom date templates, start-of-week selection, reversed
  date normalization, equal-bound shortcuts, selected-books all-time dates
- Data-source/aggregation choices, measurement sorting, responsive pagination,
  row details, inline time/character edits, min/max reset and confirmations
- Book-title search, private selection drafts, matching select/remove, selected
  dates/titles filters, bounded pages, apply/cancel and identity prefilter reset
- Statistics and reading-goal heatmaps, leap years, year/period navigation,
  keyboard day/week movement, externally anchored day details, streak highlighting
- TTU export ambiguity refusal, scoped-selection and explicit-all exports,
  raw recovery JSON, scoped-selection and explicit-all history deletion
- Existing selectors, labels, original component CSS and DOM structure, with
  React scope wrappers using `display: contents`

The lifecycle adaption additionally prevents Strict Mode probes from clearing
book prefilters, unrelated renders from resetting title drafts or summary edits,
fresh equivalent props from resetting heatmap year/streak state, duplicate
mutations, stale dialog confirmations, and old-route progress cleanup from
releasing a newer route's action lease. Account changes cancel owned dialogs and
retire the visible projection. Shared IndexedDB transaction/identity algorithms
were not replaced or weakened.

## Android boundary

`NativeStatisticsScreen` in `native-screen.tsx` uses React Native views and Expo UI
buttons, through the existing trusted DOM bridge. `native-service.ts` must be
imported only by the DOM owner. It exports:

- `readStatisticsSnapshot(query)` for `statistics.read`
- `dispatchStatisticsAction(action)` for `statistics.action`

`native-contract.ts` is data-only and safe for the native bundle. Reads resolve
visible per-book identities with the existing `statisticIdentityPlan` and
ownership guards, including every shared-content claimant. They do not return
raw global tables. The response includes bounded summary pages, totals, book
choices, and the original heatmap/streak model. Native controls provide date
presets/custom ranges, book filtering/search, aggregation/sorting, paging, annual
heatmaps/day details, longest-streak highlighting, and explicitly confirmed
whole-history deletion for one proven book identity. Deletion revalidates its
identity and ownership inside the committed transaction.

Native day entry and editing now use a native modal with whole-second time,
character count, an optional min/max-speed reset, and confirmation. Existing
completion payloads are preserved; a new entry cannot replace an existing day.
Zero-time entries remain visible and editable. Individual-entry deletion retains
conflicting secondary-identity records, while selected-book/date-range deletion
is atomic across every selected identity. The all-time date shortcut uses only
the selected safe histories. Native book filters have private Apply/Cancel drafts,
matching select/remove, explicit all/empty selection, and a 200-book selection
limit.

`native-transactions.ts` reuses the domain identity plan, content-hash claimant
lookup, ownership guards, and `commitTransaction`. Reads capture original records
under the same transaction as ownership/identity validation. Mutations recheck
those records, all shared-content claimants, local/content identities, migration
receipts, and modification markers inside one write transaction. Changed records
are rejected rather than overwritten. A final-request abort rolls back both data
and markers. Native reads issue opaque single-use snapshot IDs with a ten-minute
admission limit; at most four snapshots and 10,000 unique content rows are retained.
The DOM runtime supplies `{ key, signal, assertCurrent }` authority to both read
and action methods, including same-user session-generation changes. Old-account,
old-view, duplicate, and unmounted confirmations are fenced in native and again
by the service. Snapshot admission failure requires a fresh read; writes are
never automatically replayed.

Native parity still excludes TTU/raw exports, all-time heatmap aggregation, and
per-measurement average/min/max display choices. Reading-goal display, editing,
and goal heatmaps are explicitly gated in the native UI: the current
`readingGoal` store is keyed only by `goalStartDate`, with no account ownership
record or guarded account-bound goal API. Global recovery tables and ownerless
goals must not be exposed to fill these gaps. Orphaned/unresolved/oversized history
is excluded with notices rather than guessed. Initial native book choices are
bounded to 200; explicitly selected visible IDs can extend those choices.
Heatmap detail lines are bounded to keep the bridge projection small. These are
explicit remaining tasks, not claimed 1:1 Android parity.

## Validation (2026-10-02)

Passed:

- Real esbuild browser bundle of `statistics-react/index.tsx` (approximately
  1.3 MB unminified after explicit icon imports)
- Build metadata check: zero `.svelte` files or Svelte runtime/compiler inputs
- Real esbuild browser bundle of the DOM-only native service
- Focused esbuild native-screen bundle with platform/UI imports externalized
- 89 statistics-focused Node tests, including 18 new tests that execute active
  React controllers/native services and all existing statistics title-filter, deletion-range,
  content-identity, completion, and heatmap-navigation tests without removing
  assertions
- 33 tests in `tests/unit/statistics-react-controller.test.mjs`, including 18
  native-service tests using real fake-indexeddb transactions: ownership/identity
  isolation, guarded manual entry/editing, preserved completion records, atomic
  range deletion, exact entry deletion, optimistic conflicts, bounded/single-use
  snapshots, empty selection, runtime/account ABA, and abort after the final write
- Five mounted React Native-control tests in
  `test/expo/native-statistics-ui.test.mjs`: private-filter cancel/apply, native
  manual-entry confirmation, duplicate submission, account/refresh/unmount
  confirmation fencing, and stale asynchronous read retirement
- Zero scoped statistics TypeScript diagnostics using the production Expo
  configuration; Node heap bounded to 650 MB for this environment
- Real esbuild bundle of the final DOM-only native statistics service and mounted
  native-screen bundle through the React Native-control fixture

Not qualified here:

- Live browser visual/interaction checks: the task's verified browser/socket
  restriction prevents them; no repeated browser workaround was attempted
- Android emulator/device rendering and screen-reader testing
- Full production Metro export: parent owns integration/CI qualification; local
  production exports exceeded the execution memory limit
- Full-project TypeScript/lint: focused source/bundle checks are not a substitute

No deployment, merge, or source deletion is part of this change.
