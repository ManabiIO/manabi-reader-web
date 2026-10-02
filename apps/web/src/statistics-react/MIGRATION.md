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
identity and ownership inside the existing committed transaction.

Native parity remains incomplete: inline day edits, date-limited deletions,
TTU/raw exports, all-time heatmap aggregation, per-measurement average/min/max
choices, and reading-goal management/heatmaps are not exposed by this native
screen. Account-unassigned global goal/recovery tables must not be exposed merely
to fill those gaps. Orphaned/unresolved history is excluded with notices rather
than guessed. Initial native book choices are bounded to 200; explicitly chosen
IDs remain accepted when visible. The calendar uses native accessible day cells,
not the original DOM grid. These are explicit remaining tasks, not claimed 1:1
Android parity.

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
- Six native-service tests use real fake-indexeddb transactions to verify malformed
  query refusal, foreign/orphan history exclusion, foreign shared-copy refusal,
  selection retention, stale-identity/whole-history deletion, and account aborts

Not qualified here:

- Live browser visual/interaction checks: the task's verified browser/socket
  restriction prevents them; no repeated browser workaround was attempted
- Android emulator/device rendering and screen-reader testing
- Full production Metro export: parent owns integration/CI qualification; local
  production exports exceeded the execution memory limit
- Full-project TypeScript/lint: focused source/bundle checks are not a substitute

No deployment, merge, or source deletion is part of this change.
