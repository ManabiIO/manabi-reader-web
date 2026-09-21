# Whispersync integration: third-pass review

> Historical review supplied with the v3 implementation bundle. The environment,
> test counts, and publication status below describe that review, before the
> full-checkout integration. See [integration validation](whispersync-validation.md)
> for the current checkout's results and additional fixes.

Date: September 20, 2026. Status: **unpublished draft; not merge-qualified**.
No GitHub fork, remote branch, pull request, push, merge or deployment was performed.
This bundle replaces the previous complete implementation patch.

## Starting point and evidence boundary

The starting point was `manabi-whispersync-refined.zip`, SHA-256
`2522847fe57d487c60b66d87290d7ed433b5a3df7fc0dfec52caa5924ec31f06`. An untouched snapshot of its implementation is supplied in
`validation/previous-draft-implementation.zip` for regression reproduction.
The reader code was checked through the connected GitHub integration against
`ManabiIO/manabi-reader-web` at
`c037fbec3911a10e90a3b94bf19443a484e7adc4`. The retrieved branch was still at that
commit during this review. Relevant paginated rendering, bookmark return values,
shared types, modal visibility, HTML rendering, route integration and CI were read.
The workspace is **not a full repository clone**.

## Corrections in this pass

### WS3-01 — stale-tab progress overwrite and deleted-caption resurrection

The previous store serialized only operations within one instance. Two independent
connections could restore the same state, then overwrite one another. Likewise,
a second tab could remove captions and a stale first tab could recreate them on
its next autosave. An unopened writer could replace an unread record.

The revision compares the restored revision with the stored revision inside the
same readwrite transaction as the replacement. Different tabs cannot bypass that
comparison merely by issuing operations concurrently. On conflict, the session
coordinator blocks further autosaves and rejects its latest pending snapshot
rather than retrying stale data. Explicit successful reset restores write access.

Reset removes the session payload and keeps only an opaque random revision marker
under the existing book key. This marker is necessary to distinguish deletion from
an untouched empty key for older live sessions. Captions, filenames, playback data
and settings are not retained in the marker. The book ID/title key remains; clear
site data to remove the marker itself. This is **not automatic conflict merging**.

Legacy payloads remain readable and gain revision metadata on their next save.
Failed commits do not advance the in-memory revision. Randomness uses
`crypto.getRandomValues`, not a timestamp or an assumed `randomUUID` API. Missing
randomness is a reported storage failure rather than an unsafe fallback. Old
clients that do not implement this protocol remain outside its guarantees.

Four direct unit regressions fail on the previous implementation and pass here.
Additional unit cases cover commit abort/retry, legacy records, isolated book
keys, exact reset-marker contents, corrupt metadata recovery, absent randomness,
and conflict rejection of coalesced/future writes. **Those tests use an explicitly
labeled transaction-boundary double, not native IndexedDB.** Five corresponding
native-engine cases were added but remain unexecuted in this environment.

### WS3-02 — canceled navigation can still publish stale UI results

Canceling the DOM waiter alone did not retire an already-resolved promise's queued
continuation. The panel also did not consistently cancel an automatic request when
audio entered a cue gap or advanced to an unmatched cue. A retired timeout could
replace the current status, and a late success could republish an old highlight.

`navigation.ts` now owns asynchronous UI results with a request generation,
disposal state and explicit automatic/manual intent. Cue transitions and Pause
cancel audio-driven navigation; manual Show in book is independent. Opening the
drawer, replacing/closing audio, changing content and replacing matches retire
both DOM work and the UI continuation. Redrawing the **same** cue during section
rendering does not cancel its pending chapter navigation.

Ten unit cases cover the new owner and bookmark adapter. Three real Chromium
fixtures combine it with the actual DOM navigator to cover same-cue render
mutations, a cue gap during a pending chapter change, and already-resolved promise
cancellation. These are adapter/DOM tests, not the actual Svelte component.

### WS3-03 — navigation must not compete with another modal

The previous navigator could select a chapter or scroll while the reader was
aria-hidden or inside an inert ancestor. The panel's own `open` guard does not
represent every modal in the application.

Navigation now waits for a connected reader outside hidden, aria-hidden and inert
ancestors before selecting chapters or scrolling. Its observer includes inert
changes and retains cancellation/timeout behavior. Two new Chromium regressions
fail on the previous implementation and pass here. The code still relies on the
reader/dialog library to express modal state through these DOM attributes.

### WS3-04 — selected-text hints could anchor to unselected following text

The earlier element-boundary mapping treated `Range.comparePoint >= 0` as selected,
which also accepts text after the range. Selecting only an image or hidden text
could therefore silently choose the next passage. A range extending beyond the
book was also accepted based only on its start.

A hint now requires a nonempty readable span actually within the selection and
both endpoints inside this book. Three prior-failing Chromium cases cover these
boundaries. Source-ID mutations now invalidate indexes before stale chapter
addresses can be reused; a fourth prior-failing DOM regression covers that case.

### WS3-05 — failed bookmark scrolling was reported as success

The concrete paginated bookmark manager can return `false` when its geometry
cannot satisfy a scroll, although its shared interface currently declares `void`.
The earlier adapter ignored the return value and unconditionally reported success.
The new adapter handles an explicit `false` as failure while retaining compatibility
with existing void-returning implementations. Missing managers or unavailable
bookmark snapshots also fail closed. The unit test covers all those returns.
Actual Svelte/bookmark-calculator integration remains an external execution gate.

### WS3-06 — repeated subtitle separators could lose or misparse a cue

SRT/VTT splitting now consumes a run of blank or whitespace-only separators as
one delimiter. The parser retains cue identifiers and multiline payloads and
continues validating the complete file before committing it. Two unit regressions
fail with the previous splitter and pass with the correction.

### WS3-07 — save/follow errors were hidden with the drawer closed

The compact player now shows a concise status warning when storage or following
needs attention, with View details reopening the native drawer. The new actual-app
two-tab test includes closing the drawer after a conflict and checking this warning.
This is an **implemented but not application-tested UI refinement**, not an
executed browser-rendering result.

## Executed tests and regression receipts

| Check                                              | Result                                    | Boundary                                                               |
| -------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Untouched previous draft, original unit suite      | 71/71 passed                              | Standalone core/controller tests.                                      |
| Untouched previous draft, original DOM/media suite | 33/33 passed                              | Three native-IDB tests skipped.                                        |
| Previous draft with direct new unit regressions    | 71 passed, 6 failed of 77                 | Two separator cases; four stale-storage cases.                         |
| Previous draft with direct new browser regressions | 33 passed, 6 failed of 39                 | Selection boundaries, ID invalidation, modal/inert navigation.         |
| Revised strict core check                          | Passed                                    | TypeScript 5.8.3, not the repository's pinned toolchain.               |
| Revised Node unit/controller/session suite         | **95/95 passed**                          | Transaction-boundary double is explicitly identified.                  |
| Revised real Chromium DOM/media/navigation suite   | **42/42 passed**                          | Chromium 144.0.7559.96, offline DOM mode.                              |
| Native IndexedDB browser cases                     | **Eight skipped**                         | Each has a named skip record and reason.                               |
| Actual-app acceptance cases                        | **Three added/present, not executed**     | Real built Svelte app required.                                        |
| Python test syntax                                 | Passed                                    | Compilation only, not test execution.                                  |
| Shell syntax / patch whitespace                    | Passed                                    | Publishing script was not executed.                                    |
| Complete patch application                         | See `validation/patch-context-check.json` | Exact retrieved integration-context excerpts/workflow, not full clone. |

There are **12 directly reproduced regression cases against the previous draft**:
six unit failures plus six real-DOM failures. Several exercise the same root cause;
do not describe this as 12 independent bugs. New navigation-owner cases are
additional invariant coverage, not failures manufactured by importing an absent
module into the old implementation.

The final browser report registers 50 cases: 42 executed and eight skipped.
Successful media testing uses a locally generated silent WAV and the harness's
autoplay-permissive test setting; it does not qualify normal browser gesture rules.
Native IndexedDB origin testing was blocked by `ERR_BLOCKED_BY_ADMINISTRATOR`.
That restriction was not bypassed. The older supplied logs are clearly separate
from the final receipts and are not counted toward the final totals.

## Publication and remaining gates

The connected GitHub actions exposed here are reads; discovery found no creation
action, and the available GitHub plugin is already installed. No authenticated
publishing CLI is available in this runtime. No remote repository mutation was
made. The guarded script remains a **draft-PR-only** path on a normal authenticated
checkout and stops if the main base, working tree or validation gates disagree.

Before merge, run the pinned dependency install, Svelte component compilation,
`svelte-check`, production static build, existing repository suites, all eight
native IndexedDB cases, and all three actual-app tests. The test harness's fixture
renderer and bookmark callback are not substitutes for the actual Svelte renderer
and bookmark calculator. The new UI warning and two-tab acceptance flow are not
qualified here. Test normal autoplay policy, Safari/iOS, all horizontal/vertical
and continuous/paginated combinations, codecs/long audio, modal focus, offline lazy
loading, quota/denied storage, route changes and dictionary interaction.

Remaining scope exclusions are unchanged: no Anki/clip export, subtitle editor,
playlist, filesystem auto-reopen, dictionary-popup auto-pause or cross-device sync.
No application dependency or backend was added by this pass.

## Attribution and artifacts

Credits for **4890A/ttu-whispersync** and original **Renji-XD/ttu-whispersync** remain
in source, documentation and the player. The preserved MIT license has SHA-256
`8b51ad70f6aed5ce783d6770d9545eb005d50876051a8ab2e4ca91c902bd04d2` and matches the prior bundle byte-for-byte. No Yatsu code was copied.

The bundle includes the replacement complete patch, source overlay, a review-only
delta from the previous overlay, guarded publishing script, updated draft PR body,
named test logs, direct-regression test sources, untouched prior implementation
and a machine-readable receipt. `review-delta.patch` is not the full feature patch
and must not be applied in addition to the complete patch.
