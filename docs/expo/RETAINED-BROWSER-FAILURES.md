# Retained browser failures: finite repair ledger

## Evidence and closure rule

Full-scope [run 37090080266](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37090080266)
ran against commit `ce5e91103bf2f349568ae583d25f498d3612c2b2`:
the regression/default-web and Android jobs passed; the full-web job failed.
The inventory below contains **15 distinct failing test names**, deduplicated
across repeated suites, engines and overlapping traceback excerpts. It is not a
count of failed executions or fifteen proven independent product defects.

All 15 observed cases below were subsequently repaired and qualified in full
[run 37099596037](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37099596037)
on `5ac1225b737fbeb7e6e7b2535ae68ea1fc24d5a9`. All three jobs passed.
The entries preserve the original failures, diagnoses and acceptance requirements;
their pending language describes the earlier repair checkpoint. The failed runs
remain failed evidence, and no original application assertion was weakened.

Intermediate full [run 37096298886](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37096298886)
on `53d4534c` passed Android, full data safety and production Snippets, but exposed
a WebKit startup/navigation diagnostic and a Settings history-test synchronization
failure. The history fixture now waits for the admitted focused Settings screen
before its unchanged entry-ID assertion. The video fixture positively waits for
both real worker activation and optional-catalog completion before replacing the
document. Both-engine local replays and the later full checkpoint passed.

Later design/reflow refinements need their own exact-head qualification; consult
the PR's current full run and [fidelity matrix](FIDELITY-MATRIX.md). This historical
failure ledger does not close the outstanding native/shared screen inventory.

## October 3 refinement checkpoint

Full [run 37107287438](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37107287438)
on `d3b0c26c2856233760d869299d48df35439d64e3` passed regression/default web,
Android, full data safety, production Snippets and source-unchanged checks. Its
retained full-web inventory failed one Chromium case:
`test_yatsu_manifest_mismatch_is_rejected_before_any_book_write`.
The screen briefly rendered the manifest error and `Inspecting ZIPs…` as two
live statuses while refreshing destination choices. The unchanged error locator
could encounter that intermediate state. A MutationObserver on the frozen export
reproduced two simultaneous statuses even when the original final-state check
passed. The import screen now uses one global status, replacing the inspecting
message with the error. The existing case additionally observes intermediate DOM
updates and requires at most one status through completion; manifest rejection
and the original no-book-write assertion remain. Exact-head CI qualification is
required after this repair; this failed run remains failure evidence.

The subsequent `226dd96f` full [run 37111223208](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37111223208)
passed its regression/default-web job. It was canceled before the full-web and
Android jobs completed after source review found numeric Heatmap button-label
font overrides bypassing root text scaling. The added real-browser zoom assertion
failed on its frozen export: 12px remained 12px instead of becoming 24px. Shared
button labels now use the same scalable text primitive as headings and body
copy. The existing zoom journey additionally verifies the metric size; no prior
assertion was removed. This canceled run is partial evidence, not qualification
of the later repair.

## Later touch-dismissal race

The full [256a5242 run](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37118260894)
passed all three jobs. The same-head [PR-event attempt 2](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37118264604)
then failed the Chromium default-route
`test_touch_reading_appearance_fits_and_outside_dismissal_restores_controls`.
Its focus assertion observed the Library screen after an outside tap at (20, 20).
The earlier frame-delayed backdrop removal did not cancel the browser's delayed
compatibility click, which could activate the Library button newly exposed there.

Reader modals now synchronously bind a native, non-passive `touchend` listener
on their backdrop ref. It cancels outside touch completion before a compatibility
click can be generated; controls inside the dialog retain their native gestures.
Ref teardown removes the listener. The existing browser journey retains every
original geometry, text-size and focus-return assertion, and additionally records
the final native event cancellation. That assertion fails `[True] != [False]`
on the frozen 256a5242 export, even when its original focus checks happen to pass.
Ten consecutive actual touch journeys per engine pass locally after the repair.
The same PR-event Android job built the APK and passed its emitted-worker check,
but SDK setup then failed to unpack the downloaded API 35 Google APIs x86_64
system-image ZIP (`Error on ZipFile unknown archive`). Instrumentation never
started in that attempt, so it supplies no native runtime qualification. The
full run's earlier runtime pass remains specific to its own disposable host.
The passing full run and failed PR-event attempt remain separate historical
evidence; the subsequent repair requires its own exact-head qualification.

## The 15 observed cases and original repair requirements

1. **Series count spacing** — `test_recursive_series_covers_filters_and_readonly_scanning`
   ([case](../../tests/browser/test_books_library.py)). Expected `Series · 1 Book`;
   rendered `Series · 1Book`. Local workspace text repairs restore the separator
   for singular/plural series and shelf counts. Browser requalification pending.

2. **Relocated open after Back** — `test_relocated_book_read_cannot_navigate_after_browser_back`
   ([case](../../tests/browser/test_books_library.py)). Back expected the unfiltered
   Library but reached Connections. Local navigation/history and accepted-traversal
   open-retirement repairs are awaiting the real held-open/Back replay, including
   its unchanged no-late-navigation and identity assertions.

3. **Nested menu exit before export** — `test_library_sort_and_export_preserve_all_export_parts`
   ([case](../../tests/browser/test_rhea_ui.py)). `Select Books` timed out after only
   two Escapes from four nested menus. Escape now closes the entire tree and
   returns focus to Library actions; ArrowLeft closes only the innermost submenu.
   A real Svelte baseline replay confirms the tree is gone after the first Escape.
   The fixture retains its original two-Escape sequence and all export-part
   assertions; browser requalification pending.

4. **Custom-theme dialog focus** — `test_dialog_traps_focus_and_escape_preserves_custom_theme`
   ([case](../../tests/browser/test_rhea_ui.py)). Repeated Tab left no focused
   descendant in the dialog. Local modal-focus/Tab repairs need the original
   repeated-keyboard, Escape, focus-return and unsaved-theme assertions to pass.

5. **Touch dismissal and focus return** — `test_touch_reading_appearance_fits_and_outside_dismissal_restores_controls`
   ([case](../../tests/browser/test_rhea_ui.py)). The `Themes & Settings` button
   could not be found/focused after dismissal. Local backdrop dismissal handles
   pointer release and stays mounted through click dispatch; Reader touch handling
   can suppress compatibility clicks. Touch and focus-return browser requalification pending.

6. **Whispersync conflict without audio** — `test_whispersync_conflict_warning_is_visible_without_an_audio_file`
   ([case](../../tests/browser/test_whispersync.py)). The `changed in another tab`
   status was absent. Local controlled-number-input repairs preserve edits needed
   to exercise stale-autosave detection. The original two-tab conflict warning
   and persisted-state assertions must still pass on the export.

7. **Whispersync reset versus stale autosave** — `test_whispersync_reset_in_second_tab_cannot_be_undone_by_stale_autosave`
   ([case](../../tests/browser/test_whispersync.py)). The same conflict status was
   absent with audio loaded. This remains a separate retained case: the local
   input repair does not itself prove reset protection or audio-loaded behavior.

8. **WebKit service-worker teardown error** — `test_video_release_gate_keeps_default_build_dormant`
   ([inherited case](../../tests/browser/test_static_reader.py),
   [Rhea suite](../../tests/browser/test_rhea_ui.py)). Teardown recorded a
   `service-worker.js` access-control error. This traceback does not establish a
   video-gate assertion failure. The newer lifecycle trace places the error at
   immediate hard navigation from Library to Videos, while real worker
   registration is pending. WebKit emits this engine error even though the
   registration rejection is caught. The fixture now positively asserts a real
   active offline worker and waits for the independently loaded optional catalog
   before replacing the document. The worker-only replay exposed the same WebKit
   cancellation diagnostic for the catalog, so both actual startup operations
   are fenced. The fixture neither suppresses errors nor changes video-gate
   assertions. Final full qualification is pending.

9. **Admitted TTU source and labels** — `test_migration_entrypoint_and_google_drive_labels_use_official_names`
   ([case](../../tests/browser/test_ttu_migration.py)). `Import from Yatsu Reader`
   was missing. The local route now supplies admitted, once-decoded Expo params
   to the import controller rather than relying on a not-yet-committed address
   bar. Labels and source-specific behavior await browser requalification.

10. **Enlarged completion-dialog targets** — `test_completion_dialog_reflows_and_reduced_motion_skips_confetti`
    ([case](../../tests/browser/test_completed_reading.py)). Button-center hit
    testing failed after scrolling at 320×320 and 200% text. The local dialog
    title now shares the scrollport so it cannot push fixed actions out of view.
    Original size, hit-target, cancel/confirm and reduced-motion checks remain pending.

11. **Imported note edit/download/conflict/restore** — `test_yatsu_edit_download_conflict_and_restore`
    ([case](../../tests/browser/test_local_library_features.py)). Filling `Note`
    inside `Imported Yatsu notes` timed out. Local note labels now explicitly
    target a stable textarea ID. Editing, export and conflict/restore assertions
    remain required; browser requalification pending.

12. **Concurrent imported-note edits/deletes** — `test_yatsu_concurrent_note_edits_and_deletes_require_reload`
    ([case](../../tests/browser/test_local_library_review.py)). The same `Note`
    field lookup timed out. The labeling repair enables the scenario; it does
    not establish concurrent-edit/delete safety. Retain the complete reload and
    persistence assertions in the rerun.

13. **Unlinked WebDAV passage and note sync** — `test_webdav_unlinked_passage_remains_visible_and_sync_converges`
    ([case](../../tests/browser/test_local_library_lifecycle.py)). The same `Note`
    lookup timed out. Local labeling repair awaits the complete unlinked-passage
    visibility and sync-convergence journey, without weakening either assertion.

14. **Read-only WebDAV import and offline search** — `test_direct_webdav_import_is_read_only_and_offline_searchable`
    ([case](../../tests/browser/test_local_library_features.py)). Excerpts show
    both absent service-worker control and a later `Search library` timeout.
    The local fixture uses the existing bounded offline-shell admission helper
    and waits for real Library hydration after reloading the offline document.
    Controller acquisition, real offline reload/search and unchanged no-provider-write
    assertions all remain unqualified until the exported-browser rerun.

15. **Queued open after Back** — `test_queued_open_cannot_change_resume_or_navigate_after_back`
    ([case](../../tests/browser/test_library_open_commit.py)). The test waited for
    the retired `#svelte-announcer`. Its local readiness check now exercises the
    mounted Settings navigation menu. Local history/open-retirement repairs must
    still pass the held-transaction test's original resume-state and no-late-open
    assertions; a replacement readiness check alone is not closure.

## Shared Library review and broader remaining work

The combined local Library slice shares book-face hierarchy, unread/progress/
completion labels and the eight-field metadata editor. Browser leaves retain
existing DOM classes, labels, limits, validation and draft ownership. Native
controls, passage search, catalog and cover placeholders consume the saved theme;
the owner sends only the selected custom palette. Focused source/component
checks do not establish browser geometry, device accessibility or whole-screen
parity. The [eight retained shelf/editor cases](../../tests/browser/library_shelf_acceptance_cases.py)
supplement affected qualification; they do not replace the full inventory.

This ledger tracks only the observed full-web failures. The
[fidelity matrix](FIDELITY-MATRIX.md) remains authoritative for seven-dimensional
acceptance and its [finite remaining screen/flow inventory](FIDELITY-MATRIX.md#finite-remaining-screen-and-flow-inventory):
Settings, the complete Library workspace, Snippets, Account, Connections, TTU
import, Shared libraries and Optional video, plus Statistics native flow gates
and reader/device qualification. Preserve the reader/dictionary DOM boundary and
neutral interfaces. Follow [CI coverage](CI-COVERAGE.md) for affected versus full
scope, exact-head evidence and the existing three-job/no-artifact policy.
