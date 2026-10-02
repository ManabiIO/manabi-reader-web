# Statistics React / Expo migration

## Current shared route

Both `screens/routes/statistics.tsx` and `statistics.web.tsx` resolve the same
`features/statistics/StatisticsScreen.tsx` composition and the same
`createStatisticsController` / `useStatisticsController` interaction model.
See the [shared feature documentation](../features/statistics/README.md).

`statistics-react/index.tsx`, `statistics-screen.tsx`, and `native-screen.tsx`
are retained legacy reference/compatibility modules, **not the current Expo
Statistics route entries**. Their controllers and scenarios remain regression
coverage. `statistics-aggregation.ts` and the original heatmap model remain the
production domain computation used by the new ports.

The shared screen uses owned React Native / React Native Web layout and bounded
platform control/semantic leaves. The web port calls the existing DOM data owner
in-process. The native port uses the existing trusted `statistics.read` and
`statistics.action` bridge methods. Data ports return typed data/effect results,
not alternate screen trees. IndexedDB, account scope, identity migration, archive
creation, and persistence remain inside the existing DOM owner.

### Preserved web interaction inventory

- Summary/heatmap, resume-reading, application navigation, and the existing User
  guide link
- Today/week/month/year/custom ranges, tracked-day boundaries, week-start,
  reversed custom bounds, equal-bound shortcuts and selected-books all-time dates
- All ten measurement sources and three aggregation modes, measurement-aware
  sorting, responsive paging, row details, exact seconds/character editing,
  speed-bound reset and destructive-action confirmation preference
- Private title drafts, search, matching select/remove, stored selected-date and
  selected-title visibility filters, paging, apply/cancel, legacy-title and
  logical-identity prefilters
- Reading and goal calendars with independent years and highlights; no goal
  calendar when no goals exist; leap years, day/week/Home/End keyboard movement,
  configured Statistics shortcuts, current/longest/completed streaks, tied
  longest-streak counts and all-time cross-year navigation
- Clipboard TMW time/character logs; selected/all TTU ZIP exports with identity
  ambiguity and unresolved migration refusal; complete raw recovery JSON
- Exact selected identity/date deletion and explicit all-history deletion. An
  individual legacy row's absent identity is not a same-title wildcard
- Account/route revocation, StrictMode remount, private-draft preservation,
  single-action leases, stale confirmation/result rejection, and protection from
  an old route releasing another route's progress state

Web selection and exports retain complete existing domain reads. Native legacy
snapshot ceilings do not cap the web port or the shared-v1 route projection.

## Native admission, transport and mutation boundary

### Library Open versus Delete History

Library **Open Statistics** requests the explicit admission-only envelope:

`{ admissionVersion: 1, librarySelection: { token, key } }`

The bounded result contains only the version, an opaque selection token and the
admitted book ID. The owner rechecks the original canonical book identity,
profile ownership, existing local UUID and same-content claimants in a readonly
transaction. It reads no statistics/migration stores, mints no UUID and creates
no history snapshot or mutation proof. Consequently a book above the old
10,000-row limit can enter the shared route without an oversized initial reply.
The token is a scope hint; a subsequent full shared read must still revalidate
its original identity and ownership inside the established transaction boundary.

Library **Delete History** deliberately retains the existing full-proof
`{ librarySelection: { token, key } }` path and its confirmation/transaction
semantics. That legacy path retains its original resource limits. No route
parameter or admission-only token authorizes a mutation.

Selections remain account/runtime-bound, limited to four retained scopes with a
ten-minute lifetime. Unknown/expired tokens, account ABA, title/modification
replacement, content-hash replacement, missing/replaced legacy UUIDs and foreign
shared-content claimants fail closed. Valid hash casing is normalized by the
existing identity helper. Neither admission nor a rejected route mints a missing
legacy UUID to satisfy the original Library identity.

### Shared-v1 complete projection

The shared native port uses `{ sharedVersion: 1, query, requestId, ... }` on
`statistics.read`. Its first load requests an owner preference bootstrap for
tracked-day dates, saved week-start and measurement preferences. Bootstrap is
committed only after a current, complete response; later explicit dates and
calendar navigation are unchanged. Runtime reply revisions do not recreate the
port/controller; session, account epoch and original route selection define
ownership.

The owner resolves the full accessible history and projects it into immutable
JSON chunks. Unlike the retained legacy protocol, shared-v1 does not silently
stop at 200 choices or 10,000 rows. Replies carry at most 8,000 UTF-16 code units
and remain below 64 KiB serialized UTF-8. An assembly must receive every ordered
chunk before any model is displayed. Empty/non-progress chunks, changed IDs,
missing/repeated/out-of-order chunks and mismatched query/owner/request scope are
rejected.

At most two transfers are retained, with a 120-second lifetime. A projection has
an explicit 8 Mi-character admission ceiling (at most 16 MiB of UTF-16 string
storage); exceeding it produces an error rather than a truncated model.
Intermediate chunks recheck canonical ownership/identity. The final chunk
revalidates original source rows under a readonly lock. Continuations do not
rerun legacy migration.

Cancellation is request-specific, including cancel-before-begin. A bounded
128-entry owner/request tombstone ledger retains cancellation for the transfer
lifetime. Saturation fails closed for one lifetime instead of reopening an
evicted live cancellation. Closing a screen suppresses stale UI; it is not a
claim that a previously committed write can be undone.

### Exact destructive scope

A shared snapshot is not usable through the legacy mutation protocol, even
when its transfer has finished. Shared mutations require a non-serializable,
process-local admission bound to the exact fully verified proof. The runtime
never accepts this admission from a bridge payload.

The owner retains private selected book IDs and logical keys for the full
positive-time selection and each displayed aggregate row. Those targets are not
serialized. Shared bulk mutations copy the captured key subset before awaiting
transaction work. The original atomic transaction still checks book identity,
profile ownership, every shared-content claimant, migration receipts, original
rows and final abort state; it writes only the captured keys. A legacy title
range is included only when its receipt assigns it to a targeted key. Zero-only
same-title siblings and zero-only secondary identities are not broadened into a
visible selection's deletion. Ordinary legacy Delete Book History semantics are
unchanged.

Direct native logical-key-subset bulk deletion remains explicitly refused;
individual proven-day deletion and normal opaque Library-scoped selection
operations remain available. This conservative capability is not replaced by a
broader book-plan delete.

## Legacy native baseline

The ordinary native snapshot protocol remains for retained compatibility and
explicit Library Delete History. Its 25-row pages, 200-book admission ceiling,
10,000-row original-proof bound, four retained snapshots and ten-minute lifetime
are **legacy protocol limits**, not shared-v1 projection limits.

The original aggregation oracle remains unchanged, including inherited
rounding, weighted averages, zero-entry counting and speed-bound semantics.
Legacy native individual zero-time rows remain covered by its existing tests;
the shared route uses the established web positive-time selection semantics.
The canonical identity, migration `validateIdentity` hook, optimistic mutation
checks and final-transaction rollback tests are retained.

## Validation and honest limits (2026-10-02)

Controller/port qualification includes the unchanged 49 existing scenarios,
split into `statistics-react-controller.test.mjs` (15),
`statistics-native-controller.test.mjs` (24), and
`statistics-library-route-controller.test.mjs` (10). The split preserves the
49 test names and assertion bodies. The new
`statistics-shared-controller.test.mjs` has 30 production controller/port cases,
including 205 choices and 10,005 rows, bounded Unicode transport, source changes,
exact destructive scope, complete-proof admission, cancellation, bootstrap,
clipboard/TTU/raw recovery and independent goal state. The mounted production
port lifecycle suite has three React cases for stable runtime revisions,
StrictMode and retired responses. Admission-only Library tests cover the bounded
hint, over-10,000-row Open, canonical/account/UUID changes, malformed envelopes
and refusal to treat a hint as mutation authority.

The retained 15/24/10 suites, new 30-case suite, five admission-only cases and
three mounted port-lifecycle cases passed separately with pinned Node and a
768 MiB heap setting. Independent corrected-case and admission-only reruns also
passed. Earlier monolithic attempts received SIGKILL
without assertion failures; no specific resource diagnosis is claimed. Public
route graph, shared-view/primitive checks and final integrated qualification are
tracked separately; a fixture pass does not prove device rendering.

Remaining constraints:

- Bridge transport is chunked, but the trusted owner still reads a complete
  original proof and computes full aggregation/heatmap in memory. This is not a
  fully streaming IndexedDB implementation; maximum dataset/device performance
  is unqualified
- Native day writes retain the established integer bounds of 86,400 seconds and
  100,000,000 characters. Web finite nonnegative editing remains available
- Native ownerless goals, global recovery, global deletion, clipboard and TTU
  file destinations remain explicit unavailable capabilities. The corresponding
  established web flows remain available
- Web initial appearance is synchronous. Native uses a scoped theme cache or a
  neutral loading surface until the first full projection; exact first-entry
  custom-theme transition is not claimed
- Mounted React/RNW and mocked native-control tests do not establish actual
  Android rendering, TalkBack, IME, platform download/share or browser geometry
  qualification
- Scoped source/type/lint checks are not full-project production build or device
  qualification. No backend, release, merge or deployment is implied
