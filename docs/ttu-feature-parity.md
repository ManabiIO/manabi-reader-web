# TTU feature access after the Library redesign

Audited against the inherited TTU revision `301aef4957c3cb22162276b11f4a47b35533faae`
and the original controls in its README, Library, reader, and settings. This is
a redesign parity check, not a claim to include later upstream features.

## Current entry points

| Inherited feature                                                            | Current path                                                                                                         | Evidence                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| EPUB, HTMLZ, and plain-text import; drag and drop                            | Library actions → Add Books → Import File(s); drop files onto the Library                                            | Retained input/parser and drop handlers; static-reader and migration browser suites                     |
| Folder import and backup restore                                             | Library actions → Add Books → Import Folder(s) / Import Backup                                                       | Rhea submenu checks; filesystem and backup browser suites                                               |
| Selection, select all, bulk removal                                          | Library actions → Select Books, then the contextual selection row                                                    | Books Library browser suite                                                                             |
| Book, bookmark, statistics, audiobook-position, and subtitle export          | Select Books → Export                                                                                                | Rhea checks all five options; migration suite round-trips real exports                                  |
| Export progress and cancellation                                             | Contextual Library progress row                                                                                      | Retained replication callbacks; migration cancellation coverage                                         |
| Original seven sort fields and both directions                               | Library actions → View Options → Sort by…; technical fields under More Sort Options                                  | Rhea menu test; Library sorting tests. Recent corresponds to Last Read; Author is additional            |
| Character count, last read, bookmark date, last update                       | Book ellipsis → Book Details                                                                                         | Restored in this parity follow-up; phone/desktop browser regression                                     |
| Selected-book statistics and statistics deletion                             | Select Books → Actions                                                                                               | Retained route event handlers and selected-ID filtering                                                 |
| Browser, filesystem, Google Drive, OneDrive storage views                    | Library actions → Storage View, when configured and available                                                        | Capability checks retained; shared-library tests exercise TTU filesystem storage and identity guards    |
| Custom storage sources and automatic import/export                           | Settings → Library & sync → Storage sources / Auto Import/Export                                                     | Retained configuration, sync target, and replication bindings                                           |
| Contents, chapter navigation, bookmarks                                      | Reader → Show reading controls → Contents / Bookmark                                                                 | Rhea and reader-recovery browser suites                                                                 |
| Return to bookmark, jump, completion, custom reading point, fullscreen       | Reader → Reading tools                                                                                               | Original command/event contracts retained; conditional availability retained; Rhea command/dialog tests |
| Image gallery and spoiler reveal                                             | Reader → Reading tools → Image Gallery                                                                               | Actual illustrated EPUB tests on phone/desktop; keyboard and wheel coverage                             |
| Pagination/continuous mode, vertical/horizontal writing, ruby, reader styles | Reader → Themes & Settings; All Settings for advanced controls                                                       | Rhea appearance/layout tests; static reader, typography, and recovery suites                            |
| Autoscroll and reader shortcuts                                              | Continuous reader: Space toggles; A/D adjust speed. Existing bookmark, chapter, tracker, and page shortcuts retained | Source inspection of unchanged key mapping/dispatcher; overlays deliberately own their keys             |
| Reading tracker, freeze position, manual save, history                       | Reader footer → tracker button                                                                                       | Rhea tracker sheet and controls tests; tracking implementation retained                                 |
| Time/character reading goals and goal import/export                          | Settings → Tracking & goals → Reading Goals                                                                          | Retained Save/Cancel/Sync controls; migration reading-goal round-trip coverage                          |
| Statistics summary, heatmap, filters, ranges, aggregation, row editing       | Library actions → Statistics                                                                                         | Rhea navigation/filter tests; retained statistics components                                            |
| Statistics export/deletion and TMW clipboard data                            | Statistics → Options                                                                                                 | Rhea options-sheet test; retained export/delete/copy handlers                                           |
| Clear orphaned statistics                                                    | Settings → Tracking & goals → Keep Local Data on Deletion → Clear Zombie Statistics                                  | Source inspection of the live database callback; not exercised destructively in this audit              |
| Custom fonts, palettes, and advanced reader preferences                      | Settings categories or All settings; global search                                                                   | Inventory of all 65 original setting groups; Rhea persistence/focus tests                               |
| Offline reading and installable web app                                      | Browser installation UI; downloaded books remain local                                                               | Manifest/service worker retained; static-reader offline reload test                                     |
| Issue diagnostics and conditional character-count import                     | Library actions → Report an Issue; Import Character Counts when opened with `?count`                                 | Original handlers and conditions retained                                                               |
| TTU Whispersync records                                                      | Export/migration options; current reader Audiobook button opens native playback/subtitle controls                    | Migration suite; Whispersync browser suite in Chromium, Firefox, WebKit                                 |

## Gap found and repaired

The Books-style Library had omitted the original Book Details control even though
the legacy storage card still exposed its four values. The book ellipsis now
opens a read-only Rhea dialog with those values. Opening it neither imports a
preview-only book nor changes its reading state; unavailable values say No data.

## Limits of the evidence

- The source inventory and source-contract tests establish retained bindings;
  they do not prove every setting combination or every keyboard action end to end.
  The targeted audit additionally exercised 13 existing Chromium browser cases
  covering Library, reader, settings, tracking, statistics, gallery, and migration
  entry points. PR #29's exact-head CI also qualified Appearance, Library,
  recovery, migration, shared libraries, and Whispersync.
- Direct legacy Google Drive/OneDrive storage requires configured OAuth settings
  and a valid provider grant. This audit did not authorize live provider accounts.
  Managed Manabi connections are a separate protocol; their private state storage
  does not imply interoperability with a shared `ttu-reader-data` folder.
- Folder import remains hidden on mobile, as before. Persistent writable folder
  connections require the browser's directory-picker API. Native Safari/iPhone
  pickers and OS installation prompts need device qualification.
- The parser intentionally sanitizes unsafe EPUB content. Preserving TTU features
  does not mean executing arbitrary scripts or allowing remote resource tracking.
- The former exposed management toolbar is intentionally replaced by labelled
  menus. A minimal Library shelf does not imply removal of its advanced actions.

See [Rhea UI](rhea-ui.md), [TTU migration](ttu-migration.md), and
[shared-library interoperability](shared-library-interop.md) for implementation
and qualification boundaries.
