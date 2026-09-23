# Manabi Reader Web: Reading Features and Data Architecture

Status: implementation guide for features 1–5. This document consolidates the three attached advice files in order. The third document is the final authority where it revises the first two; the second is useful historical context, not a competing target.

## Decisions and precedence

The first proposal establishes a shared durable-location and navigation foundation, then layers search, annotations, return navigation/scrubbing, Line Guide, and cloud series editing on it. The second proposal temporarily recommends provider-owned managed state for per-book data. The third proposal explicitly replaces that recommendation: **IndexedDB is always the complete local working database, and Manabi account sync is the cross-device replica for personal per-book state.** Do not implement the second proposal's provider-state authority or its optional dual-backend selector.

The resulting invariants are:

1. Original EPUB/TXT/HTMLZ bytes and physical folders remain in the selected storage provider.
2. SHA-256 of the original file identifies the logical book. Provider IDs, paths, and names identify physical copies only.
3. All personal reading state is immediately read and written in IndexedDB, online or offline. Signed-in users synchronize it asynchronously with Manabi; anonymous users use the same local model without a remote replica.
4. Manabi never needs the book bytes to synchronize metadata. Provider app-data state is not a competing runtime synchronization authority after migration.
5. `.manabi-reader.yaml` is the canonical, all-lowercase series marker filename. It describes physical folder/series metadata and stays with that folder. Preserve the bounded name-only YAML parser and reject unknown fields/unsupported constructs.
6. Keep the current pagination engine. Add services and adapters around it rather than replacing EPUB rendering.
7. Search, annotations, resume, return navigation, scrubber, and audio-follow share durable source locations and a navigation coordinator. Screen coordinates and live DOM ranges are ephemeral.

## Target placement

| Data                                                                                                 | Immediate/local placement                        | Cross-device placement                                   | Physical book provider                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| Book bytes, folders, series marker                                                                   | Source link/cache as needed                      | None                                                     | Original files and `.manabi-reader.yaml`   |
| Logical book identity and source-copy links                                                          | IndexedDB                                        | Source links as appropriate; never confuse with identity | Provider IDs are location metadata         |
| Resume locator, progress, completion, statistics                                                     | IndexedDB                                        | Manabi account, keyed by `content:<sha256>`              | Not authoritative after migration          |
| Bookmarks, highlights, notes, presentation (custom title/cover/direction)                            | IndexedDB                                        | Manabi account, keyed by content hash                    | Not written beside book                    |
| Collections, Want to Read, reader preferences                                                        | IndexedDB cache                                  | Manabi preferences/account sync                          | None                                       |
| Pending operations, sync baselines, conflicts                                                        | IndexedDB                                        | Server mutation/change feed                              | None                                       |
| Search index, current query/results, navigation stack, live ranges, Line Guide geometry/current line | Session/device memory or regenerable local cache | Never                                                    | None                                       |
| Line Guide appearance preference                                                                     | Local settings                                   | Optional through explicit preference schema              | None                                       |
| Series/folder organization metadata                                                                  | IndexedDB listing/cache                          | No personal-state replication requirement                | `.manabi-reader.yaml` and folder structure |

A moved or independently discovered copy with identical bytes resolves to the same `content:<sha256>` state. Missing/disconnected book bytes do not delete personal history or annotations. Different bytes never inherit state based only on title/ISBN. For legacy books without a verifiable original-file digest, use a local UUID key; keep features local and exclude it from portable account sync until identity is verified. Never hash rendered HTML as a substitute for original bytes.

## Shared location and reader runtime

### Publication model and canonical projection

Persist a `PublicationManifest` for every resource in reading order, including resources omitted from the TOC, repeated spine occurrences, image-only sections, and synthetic TXT/HTMLZ resources. A resource reference includes normalized archive-relative `href` and `spineIndex`; TOC entries are labels/shortcuts, not the resource inventory. Extend EPUB generation to emit the manifest and associate each spine occurrence with its rendered section. TXT and HTMLZ receive deterministic equivalent manifests.

Define a versioned canonical readable-text projection from sanitized stored content before runtime image URLs, spoiler/presentation wrappers, or other display-only transformations. Include ruby base text (`rb`); exclude readings/fallback (`rt`, `rp`, `rtc`), script/style/template and explicitly hidden content. Inline markup is transparent; paragraphs and explicit line breaks use documented separators; resources stay separate. Store source-run mappings back to DOM text nodes. Search normalization is a later, separate transform and must retain offsets into canonical text.

Offsets are Unicode code points, explicitly converted to/from DOM UTF-16 offsets. Build sparse code-point/UTF-16 checkpoints; do not repeatedly spread entire chapters into arrays. Durable identity comprises book key + resource + canonical offset/range and a text witness, never page number, pixels, viewport, font, columns, or writing mode.

A versioned locator supports point, range, and element targets. Include resource text digest and text witness (exact quote when bounded, prefix/suffix, length, digest; long spans may use head/tail plus full-span digest). For changed projections: validate identity/resource/digest, try direct offsets and witness, then search only within that resource; recover only a unique match. Otherwise keep the annotation and excerpt visible as unresolved (“Passage could not be located”). Never silently transfer to a different edition.

### Runtime contract

Expose a typed runtime through `book-reader.svelte` with continuous and paginated adapters. It must capture current durable reading point and selections, ensure a resource is mounted, and reveal a locator with cancellation. A reveal is complete only after correct resource mount, layout readiness, target resolution, and accepted scroll/page action. Recheck generation after each async boundary; reuse cancellation-aware Whispersync mapping ideas, not its playback normalization or transient DOM paths as permanent anchors.

Use shared navigation causes (ordinary reading, jump preview, history return, restore, reflow, audio follow). Internal tracking and autosave consume typed causes; do not infer reading credit from an unqualified `PAGE_CHANGE`. Keep existing character counters/statistics separate from canonical offsets and scrubber progress. Explicitly reveal the first resource for offset zero; current paginated bookmark behavior may return early at zero.

## Feature 1: Search Book

Add Search Book to expanded reader controls, separate from Library search. Provide chapter label, safe text excerpt, match, and result navigation. Keep query/results, selected result, and list scroll while the book remains open. Reader-scoped Cmd/Ctrl+F only activates from the reading surface, not input, note editor, dictionary popup, or other reader controls.

Begin with literal substring/phrase search. Search Japanese without tokenization; preserve punctuation; Unicode canonical equivalents match; default case-insensitive with Match case; compatibility/width folding is optional and separately mapped; do not conflate hiragana/katakana. Search ruby base text by default. Matches may cross inline boundaries, but not resource boundaries; paragraph separator/whitespace behavior must be explicit. Never reuse Whispersync punctuation/whitespace-stripping normalization.

Project text on the main thread and scan serializable resource text in a worker. Requests/responses carry book generation and request ID; stale responses are discarded. Scan in bounded chunks so cancel messages can run, stream early result batches, show “Searching…” until complete, and lazily materialize snippets/results (about 50 at a time). Handle IME composition before debounce. Search remains local. Avoid an index/database until measurement justifies it.

Opening a result captures origin before closing the sheet or changing resource, waits for sheet dismissal, then navigates via the shared coordinator. Use the highlight overlay for the active hit. Render excerpts as Svelte text nodes, never imported HTML or `<mark>` wrappers in book content.

## Feature 2: Bookmarks, highlights, notes

Keep the existing per-book bookmark/progress/completion snapshot as **resume state**. Add Bookmark creates a distinct saved point/element annotation. Rename manual resume action “Save Reading Position”; do not convert autosaved positions into user bookmarks.

Portable annotation entity: version, UUID, content-hash book key, kind (`bookmark|highlight|note`), ordered locator targets, optional label/plain-text body, presentation (bounded color/decoration), timestamps, revision and tombstone. Local envelope additionally tracks account/sync scope, dirty version, pending mutation IDs, baseline and unresolved conflict drafts; those fields are not portable entity data.

Add IndexedDB stores for publication manifests, annotations, annotation outbox, sync state and conflicts. Upgrade cumulatively so every old database reaching the new schema gets all stores/indexes; do no file hashing or EPUB parsing inside upgrade transactions. Commit annotation edits and corresponding outbox mutations in one transaction. Draft note text during editing; show Saved only after transaction success and preserve text for copy/export if quota fails. Index by scope/book/kind/resource; order by resource/source position.

Capture selected targets before opening toolbar/sheet/editor. Validate selection belongs to current book; preserve native handles and dictionary behavior; reject collapsed highlight selections but allow point bookmarks; split continuous multi-resource targets in order. Do not pretend paginated view can select unmounted resources. Do not clear selection as a side effect of saving resume state.

Paint via CSS Custom Highlights where available. Otherwise use an overlay host outside measured book content, clipped visible rectangles, pointer-events none. Keep saved highlight, audio highlight, and active search result layers distinct with intentional priority. Never mutate imported DOM or use `surroundContents()`. Re-resolve after reflow/resource changes; discard ranges from stale layout generations. Keep annotation list keyboard accessible.

Sync annotations and all other personal book state through Manabi account/local-first sync per the third attachment. Bootstrap remote state before flushing local changes at sign-in; sign-in alone does not discard or blindly upload either side. Scope every pending outbox to account identity; signing out retains local data, and account switches must never retarget Account A operations to B. Local edits remain usable offline and can resume syncing only in their original account scope.

Use idempotent mutation IDs, entity revisions/base revisions, atomic server mutation + accepted change + receipt, stable per-account sequence cursor/change feed, tombstones, strict bounded payloads and safe retries. A feed cursor must reflect commit order, not just allocated auto-increment IDs. Merge independent fields; preserve both same-field note edits for resolution; delete-versus-edit keeps original deletion and recoverable edit rather than resurrection. A stale acknowledgement acknowledges only its matching outgoing mutation, not a newer local version. Keep server unavailable from blocking reading or annotation edits.

Native JSON export is round-trippable; Markdown is readable but not lossless. Validate whole imports and limits before apply; repeat import idempotently. Report unknown books/unresolved locations without dropping records. Do not apply imported tombstones destructively without explicit choice. Removing a book copy is separate from deleting personal notes.

## Feature 3: Return to where I was and progress scrubber

Maintain per-book session navigation state: visible locator, resume locator, optional excursion origin/group/source, bounded back and forward. Search result B then C is one excursion from A, not a stack of every hit. Do not create browser history entries per page/result. Contents, links, search, annotations and scrubber use one coordinator; audio-follow does not flood history, while explicit Show in Book can create an excursion.

While previewing a jump, preserve the origin as resume and pause/rebase tracking. Return restores origin; Continue Here adopts visible target and starts a new tracker baseline. Ordinary intentional page turn/scroll after preview adopts the new location and counts only subsequent reading. Closing during preview retains origin. Reflow preserves source point and grants no reading credit. Jumping to the end never marks completion. No timeout guesses commitment. Show an unobtrusive Return to Chapter … and Continue Here affordance.

Scrubber appears only in expanded controls. Drag/keyboard changes a preview label without repeatedly mounting chapters; release commits one navigation; Escape/pointer cancel restores prior state. Text-bearing books use cumulative canonical text lengths; image-only books use resource order with honest labeling. Include zero-text resources in ordering. Accessible value describes chapter and approximate text percentage. Keep this scale distinct from existing reading-character statistics.

## Feature 4: Reading focus / Line Guide

Line Guide is a visual guide, not a reading position or bookmark mechanism. Settings: enabled, visible lines (1 or 3), bounded dimming. Store appearance locally; sync only via explicit preference schema if desired. Current line and geometry remain ephemeral.

Derive geometry from rendered layout, not font-size arithmetic: find visible text blocks, obtain range rectangles, split at grapheme boundaries as needed, group by writing mode/block-axis overlap/column, map each line to first source position, and include associated ruby. Vertical Japanese uses a vertical column aperture (block progression right-to-left); horizontal uses horizontal lines (downward); mixed descendants group independently.

Render dimming in a separate overlay host that does not affect pagination measurements. Provide gutter/explicit controls and accessible Previous Line/Next Line. Preserve selection, dictionary, page turns and scrolling. Cache by resource/layout epoch; invalidate for font, viewport/visual viewport, image, column, writing-mode changes. Measure in bounded animation frames with read/write separation. Hide briefly if geometry is uncertain. Support reduced-motion/high-contrast outline treatment.

## Feature 5: Cloud series editing

Treat as storage-provider mutation capability, separate from reader runtime and from existing `LibrarySource.write()` (managed state semantics). Keep three explicit operations: Create Series (folder + marker + move chosen originals), Move Books, Rename Series (display name only). Physical folder rename is separate. Marker remains strict, bounded, name-only YAML; canonical filename is `.manabi-reader.yaml` in lowercase.

Expose per-source capabilities reflecting provider, scopes, item permissions, selected root, policy and concurrency. Use prepare/preview → execute(plan revision/idempotency key) → status/cancel APIs; semantic stable item IDs only, never arbitrary paths/provider URLs. Initially constrain operations to same connection and selected root; OneDrive stays within current personal drive. Exclude cross-drive/shared-drive/shortcut/ownership-transfer scope.

Provider permission policy must be explicit and incremental: Google do not jump to unrestricted Drive scope; validate the narrow metadata/folder authorization combination, recognizing `drive.file` is not blanket access to existing descendants. OneDrive requires an explicit delegated Files.ReadWrite upgrade, not ReadWrite.All. Dropbox remains unavailable until app access configuration and mutation adapter are verified. Persist authorization purpose, bind OAuth return to account/connection, record actual granted scopes, retain read access when upgrade is cancelled, refresh plan after OAuth, and never auto-execute an old plan.

Server persists plan and durable step journal. Before each network call persist claim/intended action; after definitive response persist resulting IDs/parent/name/revision. Timeout/crash becomes uncertain and must reconcile provider state before replay. Do not hold DB transaction across network calls. Same-named folder is not proof that uncertain creation succeeded. Bounded execution may pause when browser closes and resume from journal.

Use provider-native moves; do not download/reupload/delete originals. Create Series sequence: create folder, create/validate marker, move each original, verify, publish relocation receipts. Partial success is reported honestly; no automatic rollback that could overwrite later user changes. Recheck root confinement and metadata around each operation. Honor OneDrive If-Match; do not claim Google preflight/version or Dropbox revision gives CAS unless provider contract proves it. Serialize Manabi's own weak-precondition operations, recheck and verify, preserve old marker content in receipt, stop on detectable external changes.

Apply relocation receipts idempotently to update only source links/invalidate folder listings. Preserve content identity, IndexedDB state, resume, annotations, completion, statistics, collections and presentation. If local receipt application is interrupted, replay safely.

## Phased vertical slices

1. **Durable source locations:** manifest, canonical projection, locator/witness resolver, cumulative IndexedDB migration. Include ruby/Unicode/no-TOC/repeated-resource/TXT/HTMLZ/image-only fixtures.
2. **Reader navigation contract:** adapters, causes, tracker/resume separation, session history. Demonstrate A → preview B/C → reflow → return A, without progress/credit/completion side effects.
3. **Search + scrubber vertical slice:** worker/local search, result navigation, active highlight, return control, progress preview/commit. This is the first end-to-end product slice: durable locator → off-screen result → reflow → exact return → prove autosave/statistics correctness. Search must not ship without return navigation and tracker-safe jumps.
4. **Local annotations:** selection capture, annotation browser, CSS/overlay highlights, crash-safe saves, JSON/Markdown export/restore; anchors survive reflow and missing book remains recoverable.
5. **Manabi personal-state sync:** local outbox, bootstrap, account fencing, changes feed, merge/conflicts/tombstones; cover progress and annotations under same logical-book identity. Provider-managed state is migration input only, not parallel authority.
6. **Line Guide:** geometry, overlay/settings and vertical/mixed-layout QA; no pagination-engine changes.
7. **Cloud mutation foundation:** capability reporting, scope upgrade, plan API, durable journal and recovery.
8. **OneDrive series editing:** first native provider implementation with conditional conflict checks and interrupted multi-book recovery.
9. **Google and Dropbox adapters:** only after scope/configuration contract tests and honest concurrency guarantees.

Cloud mutation foundation can proceed alongside reader slices, but the shared reader/location layer is prerequisite for features 1–4.

## Acceptance matrix

| Area                  | Required acceptance evidence                                                                                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/moves        | Identical bytes in two providers/copies share all personal state; old source disconnect does not remove it; reimport restores association; changed bytes do not inherit by filename/title.                                                                                                                       |
| Offline/local-first   | Signed-in user can open, resume, annotate, complete, track stats offline; reload offline reads IndexedDB; reconnect syncs; anonymous path uses same local schema.                                                                                                                                                |
| Account lifecycle     | Bootstrap/merge existing local and remote data; signout retains local; switching accounts fences outboxes; Account A mutations never go to B.                                                                                                                                                                    |
| Sync safety           | Idempotent retry; atomic local write+outbox; server receipt/change atomicity; stable paginated cursor during concurrent commits; stale ACK cannot clear newer edit; independent-field merge; same-field conflict preserved; delete/edit tombstone behavior.                                                      |
| Locator               | Font/column/orientation/writing-mode/remount preserves location; `𠮷`, combining dakuten, variation selectors, nested ruby, duplicate IDs, repeated spine, no-TOC, TXT/HTMLZ, image-only and zero-offset cases. Ambiguous anchor stays unresolved with note intact.                                              |
| Search                | Japanese substrings, punctuation, ruby base, inline-boundary matches, Unicode normalization and non-BMP mapping; no cross-resource false match; case/compatibility options; IME, cancellation, stale generations, early streaming, large result bound, local-only.                                               |
| Navigation/tracking   | A→B→C→Return yields A; autosave during preview does not replace resume; no skipped-text credit/completion; Continue Here establishes baseline; ordinary next reading counts normally; reflow and end jump do not create credit/completion.                                                                       |
| Annotations           | Multiple/overlapping highlights and same-passage notes; remove note vs highlight semantics; selection survives opening UI; quota failure preserves draft; repeated export/import idempotent; missing book/unresolved target retained.                                                                            |
| Line Guide            | Vertical Japanese aperture follows columns; horizontal/mixed writing, ruby, tate-chu-yoko, Latin, headings, indents, multi-column; geometry invalidation correct; selection/dictionary/scroll work; high-contrast/reduced motion.                                                                                |
| Cloud series          | Capability reflects scopes/root/item permissions; invalid/unknown YAML rejected; stale plan and permission denial safe; duplicate names handled; root relocation stops work; each create/move/write interruption reconciles; partial success and receipts accurate; provider concurrency claims match contracts. |
| Provider independence | Personal state is not deleted with a copy and is not duplicated into provider app-data as a second authority; Manabi sync never needs book upload.                                                                                                                                                               |

Run browser QA in Chromium, Firefox, and WebKit. Device-level iOS selection/keyboard/touch checks are still needed before claiming native mobile interaction coverage. Extend existing reader/Whispersync/Playwright/typecheck/build tooling; do not create a second test stack.

## Implementation checkpoint (2026-09-23)

This spec remains the acceptance contract, not a claim that every row above has passed. The current worktrees contain the versioned publication/locator layer, local Search Book, preview/return and scrubber controls, local annotations with archive/conflict review, Line Guide, and a OneDrive-only physical series mutation path. The canonical marker is `.manabi-reader.yaml`; the old mixed-case spelling is read only for compatibility.

The Manabi personal-state API and browser sync adapter are under qualification. IndexedDB remains the immediate reading database. The provider-managed state API is a migration input, not an active synchronization authority. Google Drive and Dropbox physical mutations remain unavailable until their grants, adapter contracts, and reconciliation tests are implemented.

The highest-priority browser gate is an offscreen search result in another EPUB spine resource followed by reflow and exact Return. Repeated Chromium/WebKit runs have shown an intermittent failure to enter preview; a successful run alone is insufficient. Require a stable cross-resource mount and byte-identical bookmark/statistics evidence before marking features 1–3 complete. Cloud series also needs composed frontend/backend and PostgreSQL qualification before release.

### Reader navigation qualification update

A built-static browser regression now covers a genuinely nonzero origin, cross-spine Search Book result, font-size reflow, Return, and byte-identical bookmark/statistics snapshots in Chromium and WebKit at 390×844 and 1200×900. The regression exposed two separate return failures: browser point hit-testing could select toolbar text and silently fall back to source offset zero, and a preview reflow callback could race a deliberate cross-spine Return. The implementation now captures visible source ranges, resets the old resource's virtual page position, waits for the mounted layout before scrolling, and fences preview reflow restoration during deliberate navigation. This qualifies that specific path, not the full locator/annotation/account acceptance matrix.

Still open before calling features 1–5 complete: migration of title-keyed legacy statistics to content identity, a composed frontend/backend OneDrive interruption run, and the broader locator/search/Line Guide matrix above. Until statistics migrate, personal sync fails closed when distinct books share a legacy statistics title; it never attributes that title's rows to either content hash. Google Drive and Dropbox physical mutations remain unavailable under current provider capabilities.

Direct browser imports now preserve two different original-file hashes even when both EPUBs have the same title. The Library lists both IDs, and removing one by ID leaves the other and title-keyed auxiliary data intact. This fixes the inherited title-keyed import overwrite but does not make the legacy statistics schema content-keyed; the fail-closed sync status remains necessary.

The real export→Import from Ttu path also exposed an independent version gate: increasing the local IndexedDB schema to v8 changed exported filenames from `1_6` to `1_8`, while the migration inspector accepted only `1_6`. The inspector now explicitly accepts the compatible v6–v8 filename forms and still rejects unqualified future versions. A browser round trip verifies finished date, page direction, and statistics.

### Qualification note: local-folder browser fixture

The old local-folder/completed-reading browser assertions expected managed state writes to `.manabi-reader` and a folder-conflict UI. They have been revised to assert local IndexedDB persistence and unchanged originals; provider-managed state is a migration input under this architecture. Completion snapshots retain TTU wire schema v8 even after local IndexedDB migrates to v9. On this macOS host, both Playwright's bundled Chromium and installed Chrome exit with `SIGTRAP` when an origin-private `FileSystemDirectoryHandle` is read back from IndexedDB. A minimal page with no Manabi application code reproduces the crash. That prevents local execution of the real-handle fixture and is not a product qualification pass; run it in a Linux CI browser environment and retain separate device-level picker coverage.

Composed browser checks now cover an account-A annotation outbox surviving a switch to account B and resuming only when A returns, plus an offline UI-created bookmark that remains in IndexedDB and syncs after reconnect. Both paths pass in Chromium and WebKit. Chromium also passes an offline reload with the bookmark still present. Playwright WebKit's network-offline mode fails to serve even a controlled, cache-present page through its service worker (`WebKit encountered an internal error` on a minimal Library reload), so the WebKit check covers offline editing/reconnect without reload; device-level Safari offline reload remains an open gate.

Search projection now preserves the HTML `hidden` attribute through sanitization, excludes hidden/`!important`-hidden text, treats block-level `div` boundaries as paragraph separators, and continues to ignore ruby readings. This changes the canonical projection to v2. An older point locator with the same resource-text digest still resolves directly; changed text continues to require an unambiguous witness. A built-static EPUB regression checks Japanese combining marks, non-BMP text, ruby, hidden content, and the block boundary in Chromium and WebKit. Reader-search cancellation now uses a bounded high-water mark rather than retaining every canceled debounce ID.

The backend series suite now drives the public HTTP prepare/execute/status endpoints against a stateful OneDrive fake. It loses a move response after the provider has moved the original, verifies the journal reports reconciliation without an early receipt, resumes after the claim ages, proves the move is not repeated, and checks that only the later verification publishes the receipt. Another account cannot read the plan. A separate built-static frontend browser regression now starts with an old cloud catalog, exposes the backend's completed plan after an interrupted browser session, and verifies that two relocation receipts are applied once, the catalog is refreshed, no execute request is repeated, and unrelated IndexedDB reading data is unchanged. It passes locally in Chromium and WebKit; Linux CI and a composed frontend/backend interruption run remain gates.

### Content-keyed statistics migration (follow-up branch)

The inherited `statistic` store has a `[title, dateKey]` primary key. The v9 local schema adds `readerStatistic` keyed by `[bookKey, dateKey]` and a per-title migration receipt. New tracking, completion, personal sync, and the statistics view use the logical book key. A uniquely identified legacy title migrates once; an ambiguous title remains in the legacy store and is never attributed to either content hash for account sync. An unverified book receives a stable local UUID key, and later verification can rekey its days without duplicate totals. TTU export filenames and completion metadata deliberately stay at wire version 8 even though IndexedDB is v9. TTU import and backup restore select content-keyed statistics by the saved destination book ID.

Statistics Settings offers a raw JSON recovery download containing a single-transaction snapshot of content-keyed days, inherited title-keyed days (including rows hidden from the combined view after assignment), migration receipts, local UUID mappings, and a minimal book identity manifest. It is a preservation/recovery artifact, not a TTU import format. The older standalone TTU statistics ZIP remains title-keyed; it refuses selected titles with multiple identities or unresolved legacy ownership and explains that the raw download preserves the data. A future versioned restore UI should validate and reconcile this raw format before importing it; do not silently feed it into the TTU importer.

Focused IndexedDB tests cover idempotence, same-title ambiguity, conflicting renamed titles, local-to-content promotion, and raw recovery serialization. Browser tests cover separate same-title account mutations, retention of ambiguous legacy days, TTU round trips, interruption/retry behavior, and the raw download versus ambiguous ZIP gate. This branch remains draft until the full CI and browser matrix pass. A remaining product decision is how to expose unresolved legacy days in the statistics UI without conflating them with verified rows. Device-level provider move/relink and deletion preference coverage remain open.
