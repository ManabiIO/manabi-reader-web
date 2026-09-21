# Library experience follow-up specification

Status: active implementation specification, captured 20 September 2026. The first local Library experience slice is implemented on `feat/library-experience-20260920`; qualification evidence belongs on its pull request. This document does not authorize merging or deployment.

Baseline: merged PR #15, `aec21b197492b3ab3af7684fa23920bcb800357d`. The concurrent Whispersync branch is separate. Recheck current main before implementation and preserve concurrent history.

## Objective

Make the personal Library support four clear tasks: resume reading, browse owned books, navigate collections/series, and revisit finished books. Keep Rhea/shadcn-Svelte components and appearance tokens. Apple Books supplies hierarchy, cover treatment, and interaction references.

Success means distinct, coherent destinations rather than one grid with different filters, without losing existing import/export, completion, collections, source, or local-file operations.

### Implemented in the first slice

- Destination-scoped Select all and selection invalidation for collection, series, search, and completion-scope changes.
- Flat individual-book projections for custom collections and Finished; directory hierarchy remains in Books and series.
- A reading-evidence-based Continue shelf, Finished timeline/Grid preference, and responsive scoped series hero/list.
- Separate root, series, and Finished layout preferences; contextual empty states; no contradictory Not Finished control inside Finished.
- Optional creator metadata through EPUB/HTMLZ import, persistence, bounded versioned preview cache, export/restore, and Ttu migration; creator display, search, and Author sort.
- Deterministic identity-seeded missing covers, dark shadows in both themes, Unread status, and a collapsible 224px desktop collection rail.
- Connected previews remain explicit: selecting never imports one, and Save to This Browser is a named book action.

Series batch completion/collection menus, selection of unsaved previews for metadata-only collection membership, URL-backed search history, and artwork-derived hero tint remain later slices. Cloud mutation and cross-device organization remain separate projects.

## Scope and invariants

- Personal ebooks only in this work. Store, discovery, purchases, ratings, and audiobook navigation shown in the references are outside this specification.
- Preserve the compact Library header; do not restore the old exposed TTU management toolbar.
- Series remain directory-backed. Source roots are not series; structural empty/single-child wrappers flatten; nested series precede individual books. Filtering must not mutate or re-identify the directory tree.
- Collections remain many-to-many memberships and never move files. Browser-local organization remains honestly labeled until a separate sync project ships.
- Retain completion dates, explicit Still Reading precedence, autosave fencing, migration, and reader Complete Book behavior.
- Preserve EPUB-derived binding direction and manual cover-edge overrides. Japanese language alone never implies RTL.
- Keep local move journaling, verification, relinking, recovery, and collision handling unchanged.
- No new cloud mutations, OAuth scopes, or backend contracts. No cloud write support implied by UI changes.

## 1. Destination model and navigation

Use one explicit destination model for rendering, searching, counts, selection, and command targets. Components must not independently reconstruct different scopes.

| Destination       | Book population                                                 | Presentation                                                | Default                           |
| ----------------- | --------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| Library / Books   | All accessible books, organized by source directory hierarchy   | Continue shelf, then cover grid or list                     | Grid; Recent                      |
| Custom collection | Individual member books, including members inside series        | Flat grid/list; optional containing-series subtitle in list | Grid; Recent                      |
| Finished          | Individual books for which existing `isFinished()` is true      | Timeline or Grid                                            | Timeline; newest completion first |
| Series            | Descendants of the selected directory, preserving nested series | Responsive hero, nested-series section, volume list/grid    | List; Volume Order                |

Custom collections and Finished intentionally use flat book projections. This changes their presentation, not directory structure or membership identity. Books and series retain directory hierarchy.

Retain existing `/manage`, `collection`, `series`, and `unfinished` links. Add a scoped `q` search parameter if needed; search edits replace history rather than creating an entry per keystroke. Navigating to another destination clears search and selection. Browser Back restores the previous destination/query and, where practical, scroll position.

Legacy combined collection+series links retain their collection scope. Compute the hero covers, count, reading target, and children from that same population. Show “N books in this collection” and offer an explicit “View full series” action. That action clears collection scope and selection. A Finished-scoped series must never promote an unfinished book.

Invalid/deleted collection or series IDs must resolve to Books with a brief status message, not silently display all books under the stale destination name. Only resolve a missing series after the relevant cached/live source catalog is available; offline/unavailable source is not proof of deletion.

## 2. Selection correctness — first implementation slice

Confirmed defect: a filtered collection with one visible book can report eight selected after Select all. Fix before visual additions.

Rules:

1. In this slice, selection targets saved browser books and is reconciled against the current destination's stable shelf projection. Connected previews are disabled in selection mode, and selecting elsewhere never imports one or writes reading state. Selecting unsaved previews by stable shelf key is a later slice.
2. Select all selects the current destination's matching saved books only. In a hierarchical view this includes matching saved descendants represented by visible series tiles; exclude filtered-out descendants.
3. In selection mode a series tile toggles its matching descendant books and has checked/mixed/unchecked state. Label the group with its book count. Explain once in the selection row that series selection includes their matching books.
4. Changing destination, search text, or completion filter clears selection. Sorting and layout changes preserve it. Refresh removes selections that are no longer in scope; it never silently adds books.
5. Preserve `Select all`, `Cancel selection`, `Export`, and `N selected`. Wait for actual reactive state in tests, not fixed sleeps.
6. Hide Continue while selection is active. Book/series covers toggle selection; reading/navigation requires leaving selection mode. Book menus that could mutate the scope are unavailable during selection.
7. Each command snapshots its exact target keys and revalidates existence, account ownership, scope, and capability immediately before execution. Never substitute a different book by filename or title.

Command capability rules:

| Command                          | Imported book                           | Connected preview                               |
| -------------------------------- | --------------------------------------- | ----------------------------------------------- |
| Add/remove collection membership | Available                               | Later slice; Save first for now                 |
| Save to This Browser             | Already saved/no-op                     | Explicit import, with progress and cancellation |
| Export                           | Existing full export flow               | Require explicit Save to This Browser first     |
| Completion/date changes          | Existing completion command             | Require explicit Save to This Browser first     |
| Remove from This Browser         | Available                               | No browser copy to remove                       |
| Create Series from Books         | Available when writable originals exist | Available when writable local originals exist   |

For a mixed selection, never silently operate on an eligible subset. Disable an inapplicable command with an adjacent explanation and provide the explicit Save action where it resolves the limitation. Retain settings controlling statistics retention when removing browser copies.

A later slice that makes previews selectable must remap selected keys through the same identity transition used for presentation and memberships. It must maintain a fixed operation snapshot and stop on account generation changes. Completing an import must not open the book, mark it read, or enable sync.

## 3. Shared shell and collection navigation

- Root heading: Library, with dedicated round Collections and Library actions buttons.
- Collection/Finished destination: its name is the primary heading; provide Library/back navigation and contextual destination actions. Avoid a large Library heading followed by a second competing destination title.
- Series: parent navigation and hero title establish the destination; do not repeat another large heading above the hero.
- Keep View, Organize, and Search near the relevant shelf. All existing Library actions remain reachable, including imports, legacy storage, settings, statistics, shared libraries, migration, and reporting.
- Add a collapsible library-only desktop rail at viewport widths of at least 1280px. Width: 224px. Entries: Books, Finished, My Collections, New Collection. On narrower screens use the existing Collections sheet. Persist desktop collapse preference locally; never squeeze a rail into mobile.
- On wide screens the Collections button toggles the rail; on narrow screens it opens the sheet. Expose the appropriate expanded/control relationship to assistive technology.
- Collection actions: Rename Collection and Delete Collection. Deletion removes membership container only and returns to Books if deleting the active collection.
- Use one content container for headings, controls, and shelves: maximum 1152px in the available main column; 16px mobile gutters, 24px tablet, 32px desktop. Remove conflicting nested width rules. Final dimensions may be tuned through screenshot review, but alignment is an acceptance requirement.

Empty states:

- Library empty: retain Add your first book and import/drop guidance using the actual new menu path.
- Collection empty: “No books in this collection” and instructions to use Add to Collection.
- Finished empty: “Books you finish will appear here.”
- Search empty: “No matching books” and Clear Search, preserving the destination.
- Not Finished empty: “All books here are finished” and Show All, preserving destination.
- Source unavailable: reconnect/retry status with retained cached contents, not a false empty-library state.

## 4. Continue shelf

Place Continue before the Books shelf on the root Library. Hide it for search, selection, filtered Books, collections, Finished, series, and when no eligible books exist.

Eligibility: accessible imported books with actual reading evidence and `!isFinished(book)`. Initially use valid `lastBookOpen > 0`, or nonzero progress with a valid bookmark timestamp for migrated books lacking an open timestamp. Import/scan/preview/selection alone is not reading evidence. Explicit Still Reading at 100% remains eligible when reading evidence exists. A finished book never appears.

Order by latest available reading timestamp descending; use stable key tie-breaking. Deduplicate logical books using existing identities, not titles. Show at most 10; no auto-rotation and no pagination UI in this slice.

Card: approximately 280–320px wide and 104px high; 52–60px fitted cover; title up to two lines; author up to one line when known; progress; separate 44px menu target. Connected books keep their source icon. Omit the redundant “Book” media label since this destination is ebooks only.

Use native horizontal scrolling, optional scroll snapping, and a visible next-card edge on mobile. Keyboard focus scrolls the target into view without trapping Tab or hijacking vertical wheel scrolling. A card opens the normal reader route and preserves progress.

Background tint comes from already available cover pixels, gently blended with appearance tokens. Fallback to theme tokens. Text contrast must meet 4.5:1. No provider reads solely to calculate color, no rendering remote image URLs, and no effect that obscures the cover.

## 5. Finished timeline

- Default view: Timeline. Alternate: Grid. Store this preference separately from Books, collection, and series layouts.
- Sort dated books by `finishedOn` descending. Group by year and calendar day; within a day use title natural order, then stable key. Offer newest/oldest date order; unknown dates stay in a final “Date not set” group in both directions.
- A row shows fitted cover, title, known author, date, source indicator where applicable, and existing book menu. Use a compact date gutter/line on desktop; date above or beside smaller rows on mobile.
- Treat completion dates as date-only values. Never let UTC/local conversion change the displayed day. Do not infer dates from file/import/open timestamps.
- Edit Finished Date moves the row to the appropriate group after commit. Existing restriction against future finish dates remains. Still Reading removes it from Finished and retains position/statistics.
- Unknown-date legacy finished books offer Set Finished Date, using the existing date edit flow. Do not fabricate a repeat-reading history or add the screenshot's ambiguous Mark Finished buttons to already-finished rows.
- Finished has no Not Finished filter. Search remains available. Grid still exposes finished-date information through the menu and an accessible description.

## 6. Series destination and group actions

Hero uses up to five distinct book identities. Artwork left and text/actions right when the main column is at least 768px wide; vertically stacked otherwise. Desktop target height roughly 320–420px for ordinary titles, without clipping at zoom or for long names. Keep nested-series and volume content near the first screenful.

Text: series display name, scoped book count, author only when all scoped books have the same known creator sequence, and Continue/Start Reading. Do not infer genre or author from the directory name. Background uses restrained cover color with token fallback.

Reading target:

- First choose the most recently read unfinished book in the destination's scope.
- If no unfinished book has reading evidence, choose the first unfinished book in Volume Order and label Start Reading.
- Volume Order is deterministic natural filename order within the existing directory hierarchy, with nested series first, stable locator tie-breaking, and recursive traversal. It is independent of a user's temporary Recent/Title view sort.
- If no unfinished books remain, show All books finished; no arbitrary restart target.

Below hero: Subseries section first, then Books. Default books to a compact list with 64–80px covers, title, author when known, progress/finished state, source badge, and menu. Grid remains available as a separate series preference.

Series menu: Open Series, Add Books to Collection…, Mark Books as Finished…, Mark Books as Still Reading…, and existing Rename Series when writable local metadata permits it. Clearly state target count and inclusion of nested descendants. Completion commands affect only books whose state changes; preserve existing finish dates on already-finished books.

Adding series books to a collection snapshots the current scoped descendants; future volumes are not automatically members. Membership is atomic locally and works without imports. Batch completion first requires explicit download of any unsaved targets; then apply per-book completion commands, reporting successes/failures by book. Retry only failed items. Never claim all-or-nothing across separate book transactions or replay successful date changes.

Retain local Create Series from Books. Local Rename Series changes YAML display name only. Cloud rename/move stays unavailable under the current provider contract, with capability-based explanation.

## 7. Author metadata, search, and sorting

Add optional ordered creator metadata through EPUB/HTMLZ extraction where available, book persistence, preview cache, `BookCardProps`, `ShelfBook`, export/restore, and Ttu migration. Proposed shape: `creators?: { name: string; sortAs?: string }[]`.

Parse EPUB `dc:creator`, including string/object/array forms and supported EPUB2/3 role/file-as refinements. Prefer creators marked as authors; accept unroled creators when no author-role entries exist. Never present explicitly non-author contributors as authors. Normalize whitespace, preserve Unicode, deduplicate exact normalized entries, bound count to 32 and each string to 512 characters. Malformed optional metadata is omitted without failing an otherwise valid book.

Absence must remain supported for old records. Omit unknown authors in cards; do not render a repeated Unknown Author label everywhere. No network lookup or filename guessing.

Do not reimport an entire library to populate authors. New imports extract metadata; existing accessible files can enrich through the bounded preview path when needed. Keep a metadata extraction version/attempt marker so old previews can be enriched once without rereading authorless books on every visit. Preview results must remain cancellation/account fenced. Metadata-only writes preserve IDs, canonical title, content hash, progress, completion, statistics, membership, and reading timestamps.

Export's static-data whitelist and migration projection currently enumerate fields: explicitly include/validate creators there. Legacy exports without creators import successfully; repeated import of the same metadata is idempotent. Metadata enrichment must not masquerade as newer book content or cause reading-state sync conflicts.

Search matches display title, canonical title, and known creator names, case-insensitively with Unicode normalization. Preserve accent distinctions initially; do not add fuzzy search. Search is scoped to the destination. In hierarchical views, matching a series name includes that series' descendants; matching a book includes its ancestor tile without changing structural identity.

Primary sort choices: Recent, Title, Author, Added. Keep Progress, Characters, Last Update, and Bookmarked in a More Sort Options submenu to preserve existing capability. Author uses first creator sortAs/name, unknown authors last in either direction, title/key ties. Series Author sorting uses an author only when the shared-author rule holds; series remain before individual books.

Manual order and built-in Want to Read are deferred. Neither is equivalent to unread status, and both require their own persisted semantics. Do not expose nonfunctional menu items for them.

## 8. Covers and state labels

- Preserve intrinsic aspect ratio and bottom-align artwork within uniform cover stages. Keep two columns on mobile; derive larger column counts from available main-column width, not viewport alone, so the rail is accounted for.
- Keep progress and ellipsis on a shared baseline across books and series. Put a series name below that row or reserve an equivalent caption band for all tiles; do not shift only the series status downward.
- Status precedence: Finished; otherwise percent when reading evidence exists; otherwise Unread. Explicit Still Reading at 100% displays 100% and remains unfinished. No time-based New badge in this iteration.
- Missing/broken artwork uses a deterministic restrained palette, readable title, and known author. Palette seed uses content identity when available and follows identity remapping; duplicate filenames must not merge books.
- Shadows use dark shadow tokens in both color modes; do not derive shadows from foreground. Use subtle borders/edges for dark-theme separation, not a white glow.
- Keep evidenced binding crease and manual override. Menu-open/focus states may highlight the owning tile gently; do not add permanent card panels behind every cover.
- Maintain 44px interaction targets, visible keyboard focus, reduced-motion support, and forced-colors legibility.

## 9. Implementation structure

Refactor by responsibility while preserving the existing catalog and file operations:

| Area                                                                   | Work                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `library/view-model.ts`                                                | Destination projection, flat collection/Finished populations, scoped series model, consistent counts         |
| Proposed `library/selection.ts`                                        | Selection keys, scope invalidation, group state, capabilities, command snapshots                             |
| Proposed `library/reading-state.ts`                                    | Shared reading evidence, status, Continue ordering, deterministic series start target                        |
| Proposed `library/library-shell.svelte`                                | Common container, destination header, desktop rail/mobile sheet                                              |
| Proposed Continue/Finished/series components                           | Dedicated layouts consuming the same projection                                                              |
| `library/library-workspace.svelte`                                     | Compose destinations and commands; remove duplicated scope decisions                                         |
| `routes/manage/+page.svelte`                                           | Adapt legacy export/import/statistics operations to explicit target IDs resolved from selection              |
| `book-manager-header.svelte`                                           | Preserve legacy storage branch and all compact-header actions; accept contextual selection/destination state |
| Import types/loaders, DB, preview cache, storage export, Ttu migration | Optional bounded creator metadata end to end                                                                 |
| `book-cover.svelte`, `cover-stack.svelte`                              | Shared geometry, fallback cover identity, color/shadow treatment                                             |

Keep query/navigation state in the URL; transient selection and active operations in memory; layout/sort/rail preferences in versioned local storage. Use separate preference families for Books, custom collections, Finished, and series. Read current layout/sort preferences as migration defaults for Books; do not blindly share those defaults with Finished or series.

## 10. Work breakdown and dependencies

1. **Scope and command safety.** Unified projection, selection rules, source-preview selection without import, Finished filter/empty-state corrections, scoped series hero. Ship focused behavior regressions first.
2. **Metadata.** Creator extraction, optional persistence/preview enrichment, export/import migration, search and Author sorting. Requires identity preservation and no eager source rereads.
3. **Navigation and shared layout.** Destination headings, desktop rail/mobile sheet, common alignment, contextual collection actions, persistent preference families.
4. **Continue and shelf presentation.** Reading evidence helper, Continue cards, status labels, fallback covers, dark shadows. Uses metadata and shared shell.
5. **Finished history.** Timeline/Grid preference, date grouping/formatting, unknown dates, scoped search, completion actions.
6. **Series experience.** Responsive hero, independent volume layout/order, scoped group actions and failure handling. Reuse the fixed selection/capability model.

Each slice must be independently reviewable and preserve working import/export/navigation. Do not combine cloud writes or sync into this stack. Implementation may combine adjacent small slices only if review remains focused.

## 11. Acceptance and qualification

Use Luna medium subagents for all tests/builds/runs, per session preference. This document does not claim that the new behavior is implemented or qualified.

Essential regression scenarios:

- Eight imported books; a one-book collection and matching search; Select all reports one and export targets one. No hidden selections survive scope changes.
- A filtered series tile selects only matching descendants, shows mixed state correctly, and counts each logical book once.
- Selecting source previews changes no book/import/bookmark/statistics records and causes no source reads; explicit Save imports only the requested items and preserves/remaps memberships.
- Finished cannot apply Not Finished; Clear Search stays in Finished/collection; empty text matches destination.
- Finished-scoped series has consistent covers, count, visible descendants, and no unfinished reading target.
- Continue excludes untouched imports and finished books; handles migrated progress, timestamp ties, multiple source appearances, and explicit Still Reading at 100%; rendering never writes reading state.
- Finished grouping survives timezone changes, missing dates, leap days, same-day ties, edits, Still Reading, and existing stale-autosave cases.
- Creator metadata handles multi-author EPUBs, refinements, Unicode, missing/malformed/oversized data, legacy backups, and idempotent export/import without changing identity/history.
- Series starts deterministically with filenames such as 1, 2, 10; nested order stays stable; retries do not reapply successful batch completions or overwrite old finished dates.
- Menu keyboard interaction, sheet focus return, collection deletion focus recovery, long names, 200% zoom, reduced motion, and forced colors remain usable.

Visual fixture: at least 16 books with varied real or purpose-built illustrated covers, portrait/square/landscape ratios, broken/missing art, Japanese and long titles, multiple creators, unread/in-progress/finished/unknown-date states, nested series, and each source badge. Solid-color rectangles alone are insufficient for design approval.

Capture named states at 390, 768, 1200, and 1440px in light/dark themes: root, populated Continue, collections navigation, custom collection, empty/search states, Finished timeline/Grid, series hero/list, selection, and open menus. Include 320px and zoom layout checks. Verify consistent gutters, cover/status baselines, no document overflow, contrast, and viewport-aware popovers. Capture before navigating away; teardown screenshots do not substitute for named-state evidence.

Run affected unit/browser tests per slice, then the established qualification workflows for the completed stack. Preserve `test_books_library.py`, `test_rhea_ui.py`, `test_static_reader.py`, `test_ttu_migration.py`, `test_completed_reading.py`, `test_shared_safety.py`, `test_library_preview_cache.py`, existing library units, and filesystem move/recovery coverage. Maintain Chromium/WebKit coverage for browser-independent library behavior; filesystem cases remain Chromium where API support requires it. Do not weaken global browser-error assertions or replace reactive waits with sleeps.

Done means the spec's scenarios pass, representative populated screenshots have been reviewed, all management paths remain available, and exact source/check evidence is recorded on the follow-up PRs. No merge or deployment without explicit authorization.
