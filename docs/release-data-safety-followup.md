# Release data-safety follow-up

The candidate retains Reader #57 through
`c3f0ad8e64eeac73e208bba5d631851c83570efc` as a real merge parent, including
committed resume-target writes and exact-ID local preparation. It preserves the
preceding timestamp, binary validation, cursor-listing and cancellation repairs.
No renderer, schema, dependency, provider or production activation gate changes.

## Required main qualification

`books-library.yml` qualifies every main push and is required by both the
frontend notifier and backend publisher. Its existing app build and browsers
also run Shared TTU round-trip/safety/UI and Local Library feature, review,
lifecycle, deletion, save-cancellation, last-read and open-commit suites.
Local suites run in Chromium and WebKit; the two focused open/Back cases remain.

`tests/browser/qualify_library_data_safety.py` is the one suite list used by this
required result and both standalone PR workflows. It is only a test launcher,
not a deployment coordinator. Shared files retain their explicit main entry
points to avoid accidental inherited test discovery. Native-module cases still
use their existing Vite harness and are not production-bundle evidence.

The launcher preserves every exit status, does not retry, and collects remaining
engine results after a failure. Any failure fails qualification. Five
standard-library tests exercise each group's nonzero/signal exit, actual engine
selection and mandatory main wiring. The three production workflow authorities
and notifier credential boundary remain unchanged.

The newer base added nine `test_library_open_commit` cases. Reconciliation adds
that module to the central dispatcher and its regression, rather than losing
it when resolving the standalone workflow conflict. Actual unittest discovery
selects 77 unique Local Library cases, with no duplicated test IDs. This is
selection evidence, not a claim that those browsers have passed locally.

## Preserve and refine the current-record timestamp boundary

The earlier WebKit evidence on `8649c0de` identified Blob reads in
`updateLastRead` during immediate Reader departure. The method encoded every
image and replaced a stale whole-book snapshot just to update a timestamp.
#57's `a2258a76` integrated the reviewed metadata-only helper, validated binary
encoding and cursor-based listing. These concurrent repairs remain intact;
this is not a wholesale merge of sibling #48.

The handler still read `book.id` and `book.lastBookOpen` after awaiting the DB
promise. A deterministic test reproduced an update to ID 2 at timestamp 900
instead of the original ID 1 at timestamp 200. Capture those two scalars at
entry, while retaining the existing current-record read/modify/write transaction.
No image is read, deleted books stay deleted and newer timestamps are preserved.
This is a boundary reproduction, not an observed production caller changing IDs.
The direct handler test and a native-IndexedDB test cover the held-DB sequence.

The newer base also added two `$lib` runtime imports in `book-records.ts`.
Combining them with the direct Node timestamp tests reproduced
`ERR_MODULE_NOT_FOUND` before execution. Explicit relative TypeScript paths
import the same production helpers, matching other directly tested pure modules.
No copied implementation, loader mock or dependency is added.

Seven timestamp unit cases and four native IndexedDB cases cover metadata-only
writes, delayed arguments, deleted/newer records and native abort/rollback/retry.
The existing catalog, opening, ownership, migration and page-error tests remain.

## Strict-CSP Back fixture

Base Local Library run `36255103115` passed 73 Chromium cases and two focused
open/Back cases. WebKit errored in the new queued-open Back test's
`wait_for_function`: page-world eval was rejected by the actual app CSP. Failure
teardown also reported an unfinished module-import rejection. This is distinct
from the older catalog Blob-read failure.

Observe the same native transaction-construction hook through a temporary HTML
data attribute and a locator assertion instead of page-world eval polling.
The other tab still holds a real native transaction. Back, release, unchanged
resume state and explicit retry are retained. The successful retry also waits
for the real Reader's `aria-busy=false` before teardown. No CSP bypass, error
filter, retry or enlarged test timeout is introduced.

A minimal local Chromium/CSP fixture supports the locator observation but does
not reproduce the WebKit-only error or qualify the app. Exact composed Linux
WebKit acceptance is required before this fixture issue can be called resolved.

## Evidence and rollout boundary

Local continuation: 23 focused Node tests and five release-gate tests pass;
Python compilation, YAML parsing and whitespace checks pass. The delayed-ID
case fails before its repair and passes afterward. Local Node 22.16 and
Playwright 1.57 differ from the pinned CI tools. The full installed-toolchain
build and native-browser results belong to the exact-head GitHub checks.

Both backend qualification pins must follow the final selected frontend head.
Earlier green pairs do not certify a new composition. Final main/master,
physical Safari, live-provider, full server image/application and host-cutover
acceptance remain separate. No main/master merge or production dispatch is
part of this work. Current run IDs/results are recorded on the PRs.


## Follow-through on the final browser failures

The `446a9169` Local Library run `36257604105` finished with two WebKit
failures: the offline reload search had an empty query, and the queued-open
fixture never observed construction of the later resume transaction. Appearance
passed. These are not the previous CSP-evaluation exception. Artifact
`10911079866` was checked against its SHA-256 before inspecting the report and
retained DOM. No page-error assertion is waived.

This continuation retains #57's newer `ec6e1f74` save snapshot/source/ambiguity
changes, with the existing #59 scalar-capture and relative-import repairs. The
original unmocked offline search test is unchanged. The search controls now stay
disabled until the header is mounted and its query owner is available: otherwise
the server-rendered field can accept text before it has an input handler. This
does not wait for a search worker or block clickable metadata behind content
results. A separate browser case checks the real server-rendered disabled input
with JavaScript disabled, then normal hydrated input/query behavior; existing
worker-delay, worker-failure and offline reload cases remain decisive.

The peer-held opening test observes the first native book-storage transaction
instead of assuming a later resume transaction can start while another writer
holds the database. A separate same-document Back case installs an overlapping
native blocker exactly when the real resume transaction is constructed, after
local preparation. It asserts the target is pending, Back explicitly aborts it,
the document itself was not replaced, the prior resume target survives, and an
explicit retry succeeds. No production transaction is replaced, no native write
is faked, no test timeout increases and no browser policy is relaxed. This
separates the two cancellation phases instead of relying on cross-store writer
scheduling to reach a particular phase.

The central launcher had preserved exit statuses but dropped the per-suite
stdout/stderr artifacts that the prior shell tee steps retained. It now streams
one merged pipe in bounded chunks into both CI output and a per-group log. It
writes a fresh pending/running/completed report before launching children, so
interruption cannot leave an old success report. Launch failure is recorded and
remaining groups still run; signal/nonzero/incomplete results never pass. Real
subprocess tests cover both streams, large Unicode output, signal exits, launch
failure and interrupted evidence. This is diagnostics, not another release gate
or deployment coordinator.

Before/after local policy tests establish the disabled-control and retained-log
contracts. Native-browser execution on the final composition is still required
to qualify the actual failure sequences; a source assertion alone does not
establish an engine repair or certify physical Safari.

Before publication, #59 advanced to `891e4227` with the concurrent snapshot,
opening-lifecycle and offline-worker diagnostics. Those commits and their
complete source are retained. The additional launcher logs complement the
page-level lifecycle packets; they do not replace or duplicate those observers.
