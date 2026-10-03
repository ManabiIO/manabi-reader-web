# Clean-room reader competitiveness specification

Status: sanitized implementation contract
Revision: 2026-10-02
Source provenance: intentionally excluded from implementation input
Authorization: **no implementation authority is granted by this document. Read `../CLEAN_ROOM_APPROVALS.md` before any CR-derived target tests or product changes.**

## 1. Scope

This specification defines observable behavior for a high-quality Japanese immersion reader across:

- local book/library management
- EPUB reading and navigation
- Japanese typography and Unicode
- selection and dictionary lookup
- search, highlights, and return navigation
- images and media-heavy publications
- audio/read-along behavior
- mining/export context
- statistics and progress
- offline/recovery behavior
- large-library performance
- manga/OCR interoperability
- input, accessibility, and device behavior

It does not prescribe architecture, algorithms, libraries, data structures, file names, class names, or implementation techniques.

Existing product features not covered here remain governed by their existing contracts. An implementation may satisfy a requirement using any independently chosen design that produces the required visible behavior.

Normative language describes desired quality only inside an explicitly approved feature/suite:
- MUST: release-blocking for that approved scope.
- SHOULD: expected for that approved scope unless a documented platform limitation prevents it.
- MAY: optional behavior within that approved scope.

MUST/SHOULD/MAY never grant permission to implement, test, optimize, or expand a feature. Approval is governed separately by `CLEAN_ROOM_APPROVALS.md`.

## 2. Product-level invariants

CR-INV-001 — User-selected reading direction wins
A publication may request its own writing mode, spacing, sizing, indentation, columns, or viewport behavior. When the user explicitly selects a reader presentation, the visible reader MUST remain usable and MUST NOT become blank, crash, or jump to a nonsensical progress location because of conflicting publication styling.

CR-INV-002 — Durable position is semantic, not visual
Changing viewport dimensions, font size, font, spacing, writing direction, page effect, safe-area padding, or orientation MUST preserve the user's logical reading position within reasonable text-anchor recovery. A reflow MAY move the anchor to a different screen, but MUST NOT silently jump chapters or reset to the beginning.

CR-INV-003 — Text accounting is Unicode-safe
Lookup, search, highlights, progress, subtitle/read-along alignment, and mining context MUST agree on text boundaries for supplementary-plane characters, compatibility characters, ruby, numeric entities, and multi-code-unit characters.

CR-INV-004 — Ruby is presentation plus annotation
Ruby readings MUST NOT be treated as duplicate book text for progress/search by default. The visible base text remains selectable at sub-ruby granularity. A lookup or highlight of a shorter word inside a ruby base MUST remain that shorter range unless the user explicitly expands it.

CR-INV-005 — Restore is not reading
Hidden restore landings, preload positions, temporary chapter starts, and canceled navigation MUST NOT be credited as reading progress/statistics.

CR-INV-006 — Background state has single ownership
Returning from background, media controls, another tab, another route, or crash/process restoration MUST NOT create duplicate playback, duplicate transcription, duplicate timers, or duplicate reader instances that act on the same logical session.

CR-INV-007 — Partial failure preserves usable content
A broken image, bad cover, failed thumbnail, unavailable remote refresh, malformed optional metadata, or one failed batch item MUST NOT make otherwise valid books/dictionaries/content disappear.

CR-INV-008 — Selection beats navigation gestures
When the user is selecting text or manipulating selection handles, reader swipe/page-turn gestures MUST NOT steal that gesture.

CR-INV-009 — User data is recoverable
Reading position, highlights, notes, statistics, audio position, and other durable user state MUST survive ordinary reload/restart and MUST have explicit behavior when a book is temporarily unavailable.

CR-INV-010 — Observable errors are actionable
For unsupported, missing, corrupt, or unreadable input, the UI MUST expose a stable error state with the item identity and a clear way to dismiss/retry/remove it. Infinite loading is a failure.

## 3. Capability matrix

The matrix is normative for the target experience, not a comparison to any external product.

| Capability | Baseline | Extended acceptance |
| --- | --- | --- |
| EPUB import/open | MUST | batch/folder/provider import SHOULD |
| Plain text / HTML-like book import | existing behavior preserved | SHOULD remain interoperable |
| Vertical and horizontal Japanese | MUST | live switch SHOULD preserve anchor |
| Paginated and continuous reading | MUST | optional additional presentation modes MAY |
| Table of contents | MUST | nested and unusual navigation paths MUST resolve |
| In-book search | MUST | chapter context + active hit + literal punctuation behavior MUST |
| Word lookup | MUST | recursive lookup SHOULD |
| Local dictionary data | existing capability preserved | frequency/pitch/kanji presentation SHOULD |
| Ruby/furigana controls | MUST | show/hide/dim/toggle MAY |
| Highlights | MUST | exact-range recolor/delete SHOULD |
| Saved position/bookmarks | MUST | return stack SHOULD |
| Fullscreen image viewer | SHOULD | gallery SHOULD |
| Reading statistics | MUST if enabled | calendar/goals/edit/archive SHOULD |
| Word audio | SHOULD | multiple sources/source chooser MAY |
| Read-along audio/subtitles | SHOULD where feature enabled | background/resume/export MAY |
| Mining/export context | SHOULD | sentence + image/audio context SHOULD |
| Offline/local reading | MUST for imported local books | provider cache behavior SHOULD |
| Crash/reload restoration | MUST | process-death/background restoration SHOULD |
| E-ink-friendly mode | MAY | high-contrast/reduced animation SHOULD if offered |
| Manga/OCR overlay interoperability | MAY | selectable overlay + progress SHOULD if offered |
| Profiles/language contexts | MAY | same book in multiple contexts MUST not corrupt state if supported |

## 4. Core user journeys

### CR-FLOW-001 Import and open

1. User chooses one or more supported book files.
2. Import begins with visible per-item or aggregate progress.
3. A valid book becomes visible in the library before optional heavy post-processing finishes when safe.
4. Selecting the book opens at the durable saved location, or the beginning for a first read.
5. If one item fails in a multi-item import, later valid items continue.
6. The final result distinguishes imported, duplicate/skipped, and failed items.

Expected output:
- No valid item is lost because a sibling failed.
- A failed item names the user-visible file/title and provides a reason category.
- Reopening the same logical book does not create accidental duplicate user state unless duplicate copies are an explicit supported concept.

### CR-FLOW-002 Reader restore

1. Open a previously read book.
2. The initial visible stable page/viewport contains the saved anchor.
3. No unrelated chapter start flashes long enough to be interpreted as the restored location.
4. Statistics begin only after the final restore location is accepted and the product's tracking policy says reading has started.

### CR-FLOW-003 Lookup from Japanese text

1. User taps/selects a word.
2. The source range is visibly marked without reflowing surrounding text.
3. Lookup opens within the usable viewport.
4. The popup preserves enough sentence/source context for mining.
5. User can dismiss it and immediately look up the same range again.
6. If recursive lookup exists, selecting text inside the popup opens a child/result state without losing a deterministic way back.

### CR-FLOW-004 Search inside a book

1. User opens Search.
2. Entering literal Japanese text returns matching results grouped/labeled by publication location.
3. Spaces and punctuation are treated literally by default unless the UI clearly exposes another mode.
4. Selecting a result navigates to it and marks the active hit.
5. Navigating the reader clears or updates the active-hit state without leaving stale overlays.
6. Closing/reopening Search during the same book session SHOULD preserve query and selected result.

### CR-FLOW-005 Highlight exact range

1. User selects a subrange that may lie inside ruby text.
2. User creates a highlight.
3. The highlight covers exactly the selected base-text range.
4. Reopen/reflow/restart preserves the same semantic range.
5. Selecting that exact saved range permits color change or deletion without widening to adjacent ruby.

### CR-FLOW-006 Internal link and return

1. User activates an internal publication link or contents entry.
2. Target resource/fragment is revealed.
3. Progress and visible location agree with the target.
4. A Return action, when offered, restores the pre-jump reading point.
5. A canceled or stale jump MUST NOT replace the latest accepted location.

### CR-FLOW-007 Audio/read-along

When read-along is enabled:
1. User associates audio/subtitles/transcript with a book.
2. Playback may begin with or without a complete text match if that mode is supported.
3. Current cue/text is visibly indicated without changing text layout.
4. Backgrounding and returning preserves one playback session and current position.
5. Chapter-crossing cues reveal the correct text without transiently crediting hidden positions.
6. Lookup from currently highlighted text remains available.
7. Delay/speed changes update the active session predictably.

### CR-FLOW-008 Library scale

1. Library contains thousands of items.
2. User repeatedly scrolls through covers, changes sort, leaves and returns.
3. Covers may load progressively, but scrolling remains responsive.
4. Re-entering the library MUST NOT repeatedly decode full-resolution cover assets solely because cells were recycled.
5. A corrupt/transient thumbnail does not permanently hide the book or its valid cover source.

### CR-FLOW-009 Recovery

1. Reader is open with unsaved-in-UI but durable committed state.
2. Page/process/tab/app is terminated or crashes.
3. User reopens the product.
4. Last committed reading position, highlights and durable media state are restored.
5. No duplicate playback/reader session is created.

## 5. Independently authored compatibility fixtures

The fixture suite MUST be created from scratch for this project. It must not copy third-party test books, code, comments, or fixture markup.

### CR-FIX-001 Ruby boundary book

Content requirements:
- ruby base containing multiple lexical subranges
- adjacent ruby annotations
- ruby at a line/page/column boundary
- punctuation immediately before and after ruby
- nested emphasis around ruby where valid

Example visible sentence:
彼は叱られても「本当に？」と聞き返した。

Acceptance:
- select only 叱 inside a larger ruby base: lookup/highlight starts and ends at the selected base character
- progress/search do not double-count visible base plus reading annotation
- hiding/showing furigana does not move durable position to another sentence
- vertical layout does not bleed highlight into adjacent column

### CR-FIX-002 Supplementary Unicode book

Include:
- 𠮟る
- 𠮷野家
- 猪
- ordinary BMP kanji around them
- emoji outside Japanese spans
- combining/variation-selector examples where the renderer supports them

Acceptance:
- no crash or truncated scan at supplementary CJK
- search finds the exact sequence
- lookup range starts/ends on complete code points
- saving/reopening a location after the characters restores the same following text
- read-along/search/progress offsets do not drift after compatibility characters

### CR-FIX-003 Entity equivalence book

Include the same visible Japanese character represented directly and using numeric character references in separate paragraphs.

Acceptance:
- visible text is identical
- search/progress location remains stable
- moving through the entity-heavy paragraph does not shift later anchors

### CR-FIX-004 Nested navigation EPUB

Independently construct:
- package at archive root
- navigation document inside a nested directory
- content resources in multiple sibling directories
- fragment links using relative paths
- a resource without a visible TOC label
- repeated labels and duplicate fragment IDs in different resources
- percent-encoded filename component

Acceptance:
- contents labels appear in correct order
- nested relative links resolve
- fragment jump chooses the correct resource, not a same-named fragment elsewhere
- unlabeled spine/resource remains readable
- Back/Return restores the origin if supported

### CR-FIX-005 Publisher-style conflict EPUB

Publication stylesheet requests:
- vertical writing
- fixed heights
- indentation
- multi-column rules
- large line-height
- rules attached to image pages and nested containers

Acceptance:
- user choosing horizontal reading gets visible horizontal content
- user choosing vertical reading gets visible vertical content
- neither mode blanks/crashes
- progress remains monotonic and near the previous logical anchor after switching

### CR-FIX-006 Inline character-image EPUB

Create a sentence in which one character-like glyph is represented as a small inline image with:
- intrinsic dimensions unlike text
- alt/fallback text
- a deliberately missing alternate copy
- ordinary large illustration elsewhere in the same chapter

Acceptance:
- inline glyph aligns/sizes like nearby text within reasonable visual tolerance
- inline glyph is not treated as a standalone gallery illustration
- missing glyph shows usable fallback text
- large illustration remains available to image viewer/gallery

### CR-FIX-007 Vertical punctuation book

Include line/column-boundary cases for:
- 「」
- 『』
- ！？
- ?!
- ……
- punctuation immediately after ruby
- very short final paragraph

Acceptance:
- paired/closing punctuation is not stranded as an isolated visual page/column when avoidable under normal Japanese line-breaking rules
- leftmost final column remains visible
- page direction and controls match selected writing direction
- final partial page remains reachable

### CR-FIX-008 Media-only sequence EPUB

Three consecutive resources:
1. full-page image
2. full-page image
3. short text plus image

Acceptance:
- each resource produces a distinct navigable step
- backward navigation reaches each preceding image in reverse order
- no consecutive image pages collapse into one or get skipped
- progress never exceeds valid book range

### CR-FIX-009 Broken optional resources EPUB

Include:
- missing nonessential image
- invalid optional cover reference with a valid text fallback
- one damaged thumbnail/derived cache entry simulated at runtime
- ordinary valid chapter text

Acceptance:
- book opens and text remains visible
- missing optional resource has a contained placeholder/fallback
- regenerating or bypassing a bad derived thumbnail recovers visible library item

### CR-FIX-010 Filename/import corpus

Use display names:
- Book #01.epub
- query?mark.epub on platforms that permit the display name
- 吾輩は猫である・完全版 第01巻［特装］.epub
- a title longer than 180 Unicode code points
- decomposed and composed Unicode equivalents
- spaces, parentheses, brackets, percent sign and non-Latin characters

Acceptance:
- file display name is not interpreted as a URL fragment/query
- no silent truncation that makes distinct items collide
- long/non-Latin names remain identifiable in errors and library UI
- platform-rejected filesystem names are skipped as platform limitations, not simulated as successful filesystem writes

### CR-FIX-011 Large-library corpus

Generate synthetic metadata for:
- 5,000 books
- 3,000 distinct covers at realistic thumbnail dimensions
- 25 shelves/collections
- mixed title scripts and long titles
- 10% missing covers
- reading-progress distribution across whole range

Acceptance:
- see benchmark section
- sorting is deterministic
- leaving/returning does not reset scroll unexpectedly unless product contract says so
- missing/corrupt derived thumbnails never remove book metadata

### CR-FIX-012 Long/ruby-heavy chapter

Generate:
- 150,000 visible Unicode code points in one resource
- at least 20,000 ruby annotations
- 2,000 inline emphasis spans
- periodic images
- search targets at start/middle/end

Acceptance:
- reader eventually becomes interactive without unbounded blank screen
- search returns start/middle/end targets
- repeated lookup/page turns do not progressively degrade from leaked reader/popup instances

### CR-FIX-013 Selection gesture corpus

Run on touch/pointer devices:
- slow drag selection
- staggered two-finger taps
- short fast swipe
- diagonal selection-handle movement
- stylus tap/drag where available

Acceptance:
- selection gestures do not page-turn
- genuine page swipes still work
- two-finger stagger is not misclassified as a page swipe
- swipe threshold zero, if supported, disables swipe but preserves explicit/hardware navigation

### CR-FIX-014 Read-along boundary corpus

Book text:
- short replies such as はい。/え？
- long gaps between matching passages
- punctuation split across inline markup
- chapter boundary in the middle of the audio timeline
- one image-only step
- compatibility/supplementary characters before later cues

Subtitle/transcript:
- multiline cue
- cue around chapter boundary
- cue after long unmatched gap

Acceptance:
- cue highlight includes intended punctuation without swallowing adjacent sentence
- chapter crossing reveals correct target directly
- later cues remain aligned after unusual Unicode
- image step follows explicit image-hold policy if offered
- lookup remains interactive on highlighted text
- background/resume keeps one active session

### CR-FIX-015 Same-book multi-context corpus

If language/profile contexts are supported, attach the same book bytes to two contexts with different display/lookup preferences.

Acceptance:
- deleting/removing one context does not destroy the other's durable book state
- context-specific preferences do not leak unless documented as global
- global display preferences, if designated global, remain global consistently

### CR-FIX-016 Manga/OCR overlay corpus

If manga/OCR reading is in scope:
- five synthetic page images
- independently authored OCR boxes, including vertical, horizontal, overlapping-nearby and off-center text
- one page missing image
- one partial volume placeholder

Acceptance:
- selectable text remains aligned during viewport resize and page-fit changes
- hidden duplicate OCR text is not exposed as a second lookup target
- missing page has contained error/placeholder
- progress across volume boundaries is deterministic

## 6. Detailed acceptance tests

### Typography / Unicode

CR-AT-001 Ruby subrange selection
Given CR-FIX-001 is open, when the user selects a subrange inside a ruby base and creates a highlight, then the saved and restored highlight equals that exact base-text subrange.

CR-AT-002 Ruby search accounting
Searching for base text returns one logical match per visible occurrence and does not return an extra match solely from the ruby reading.

CR-AT-003 Supplementary lookup
Tapping/selecting 𠮟る opens lookup or a clean no-result state. It MUST NOT crash, truncate the following sentence, or select half of the character.

CR-AT-004 Unicode offset continuity
Save a location immediately after 猪, reload, and compare the next 20 visible code points. They MUST match before/after.

CR-AT-005 Vertical final column
Navigate to the final partial vertical page. The leftmost visible column and final punctuation MUST remain reachable.

CR-AT-006 Paired punctuation
At configured boundary widths, closing quotation marks and paired !? sequences SHOULD remain visually attached according to the reader's documented Japanese line-breaking behavior.

### Navigation / restore

CR-AT-010 Nested nav resolution
Open each TOC entry from CR-FIX-004. Every entry MUST reveal the intended resource/fragment.

CR-AT-011 Duplicate fragment isolation
Two resources contain the same fragment id. A link relative to resource B MUST resolve B, never the first global match.

CR-AT-012 Restore without flash-credit
Persist a location mid-chapter, close, reopen. Tracking/statistics MUST NOT record characters/pages traversed solely during hidden restore.

CR-AT-013 Reflow anchor
At a distinctive sentence, change font size, viewport width and reading orientation. After each settled reflow, the distinctive sentence or its immediate semantic neighborhood MUST remain the current reading anchor.

CR-AT-014 Rapid opposing navigation
Trigger next/previous rapidly during a resource boundary. Final visible location MUST match the last accepted command; stale navigation MUST NOT win later.

CR-AT-015 Internal-link progress
Activate an internal chapter link and then Return. Target and origin progress indicators MUST correspond to their actual text locations.

### Publisher/media robustness

CR-AT-020 Style conflict
Open CR-FIX-005 and force the opposite user writing mode from the publication style. Reader remains nonblank, interactive and position-stable.

CR-AT-021 Broken image isolation
Remove a nonessential image resource. Book text and subsequent chapters still render.

CR-AT-022 Inline glyph fallback
Break the inline character image in CR-FIX-006. Fallback text remains readable and does not create a gallery item.

CR-AT-023 Media sequence reversibility
Navigate forward through all resources in CR-FIX-008 and back again. Observe every media-only step exactly once in each direction.

CR-AT-024 Image zoom bounds
If fullscreen zoom exists, pinch/tap near an edge; zoom centers near the interaction point and panning cannot permanently move all image content outside the viewport.

### Search / lookup / popup

CR-AT-030 Literal punctuation search
Search for a string containing Japanese quotes or punctuation. Results MUST distinguish that literal query from the same text with punctuation removed unless an explicit normalization option is enabled.

CR-AT-031 Leading whitespace
Entering accidental leading whitespace around an otherwise valid query MUST either trim it visibly/consistently or deliberately search it; it MUST NOT silently fail in a way indistinguishable from no matching dictionary data.

CR-AT-032 Search active result
Select a search result. The target is highlighted/marked. Normal page navigation removes or updates stale active-result marking.

CR-AT-033 Popup viewport containment
At top, bottom, left/right edges and in vertical text, lookup popup remains reachable and scrollable; no border/action region is permanently beyond viewport.

CR-AT-034 Repeat same lookup
Lookup a word, dismiss popup, immediately lookup same word. Second popup works as a fresh interaction with no invisible blocker.

CR-AT-035 Large-result scroll
Populate a lookup result tall enough to exceed viewport. User can reach first and final actions/content by scrolling without moving the underlying reader unexpectedly.

CR-AT-036 Profile/context switch
If lookup profiles exist, switch profile while results are visible. Subsequent lookup reflects the selected profile; stale result state does not leak into a new query.

### Selection / input

CR-AT-040 Selection versus swipe
While dragging selection handles horizontally/diagonally, no page turn occurs.

CR-AT-041 Multi-touch classification
Staggered two-finger taps on a page do not cause a swipe page turn.

CR-AT-042 Swipe disable
If a zero swipe-threshold/disable setting exists, gesture page-turn stops while keyboard/hardware/explicit buttons continue.

CR-AT-043 Hardware long press
If volume/page keys are bound to reader navigation, holding the key repeats the configured reader action predictably and does not switch to system volume after the first event unless the user exits reader ownership.

CR-AT-044 Orientation
Rotate while reader is open. Reader stays open and restores the semantic anchor after layout settles.

### Library/import

CR-AT-050 Batch failure isolation
Import 10 valid items plus one intentionally invalid item in the middle. All later valid items still import; failure summary identifies the bad item.

CR-AT-051 Special display names
Import files from CR-FIX-010. Names containing #, %, brackets and non-Latin characters remain intact as user-visible identity and never alter navigation as URL syntax.

CR-AT-052 Long title
Import a title >180 code points. UI may visually ellipsize, but stored/user-accessible title identity MUST not silently collide with a different long title.

CR-AT-053 Remote refresh resilience
If remote libraries exist, simulate transient refresh failure. Previously cached valid books remain visible; manual retry exposes failure rather than deleting the cache.

CR-AT-054 Derived-cover recovery
Corrupt/delete one derived thumbnail. The book remains present and its cover can regenerate/fallback.

### Audio/read-along

CR-AT-060 Background single session
Begin playback, background/switch away, invoke media controls if available, then return. Exactly one audible session exists and one progress position is authoritative.

CR-AT-061 Cue Unicode stability
Run CR-FIX-014 through cues before and after supplementary/compatibility characters. Later cue highlight remains on intended text.

CR-AT-062 Chapter-crossing cue
Seek from a cue in chapter N to a cue in chapter N+1. Reader reveals the destination without visibly settling on chapter N+1 start first unless that is the actual cue.

CR-AT-063 Lookup during highlight
Tap a word inside the current read-along highlight. Lookup works and closing it restores the current highlight/playback state.

CR-AT-064 Pause/resume durability
Pause or background during long-running transcript/transcription preparation if feature exists; reopen and verify documented progress resume/reuse behavior.

CR-AT-065 No-match mode
If playback without matched text is supported, missing/partial match data does not prevent basic audio transport controls.

### Statistics

CR-AT-070 Hidden navigation exclusion
Automated restore, hidden preload and canceled navigation do not add reading characters/time beyond the product's explicit tracking rules.

CR-AT-071 Sheet/image pause
If statistics pause while modal sheets/fullscreen images are open, open one for at least 30 seconds and verify that interval is excluded.

CR-AT-072 Deleted-book archive
If archived statistics are supported, delete a book, verify history remains in archive, reimport same logical book, and verify restoration follows explicit identity policy.

CR-AT-073 Edit daily record
If daily editing is supported, changing one record updates period totals deterministically and does not duplicate the original row.

### Recovery / lifecycle

CR-AT-080 Reload restore
Reload mid-book after a committed position change. Position, highlights, appearance and other promised durable state restore.

CR-AT-081 Process/crash recovery
Simulate process termination after state commit. Reopen without duplicate reader/audio instances.

CR-AT-082 Re-entry leak probe
Open/close the same book and perform 20 lookup cycles, repeated 20 times. Interaction latency and memory SHOULD plateau rather than grow monotonically due to abandoned reader/popup instances.

CR-AT-083 Stale async result
Start an expensive search/open/navigation, immediately switch book or issue a newer request. Late completion from the old operation MUST NOT overwrite current visible state.

### Manga/OCR when enabled

CR-AT-090 Overlay resize
Resize/rotate with OCR overlay visible. Text boxes remain associated with their intended image regions.

CR-AT-091 Hidden text uniqueness
One visible OCR token should expose one selection/lookup target, not a duplicate offscreen layer.

CR-AT-092 Partial volume
Open a volume missing one page asset. Reader shows a contained placeholder and can continue to later pages.

## 7. Input/output examples

These examples describe visible contracts, not implementation format.

### Example A — ruby selection

Input text displayed:
彼は叱られても帰らなかった。

Action:
Select only 叱 and create a highlight.

Expected visible output:
- highlight covers 叱 only
- furigana remains visually associated with its ruby base according to current furigana mode
- reopening highlight editor targets the same range

Forbidden outcome:
- entire multi-character ruby base is highlighted without user selection
- adjacent column is marked in vertical mode

### Example B — supplementary character

Input:
𠮟るのは簡単だ。

Action:
Tap 𠮟る, then save reading position after the sentence and reload.

Expected:
- lookup or explicit no-result state opens
- no crash
- after reload, next sentence remains the same logical next sentence

### Example C — nested fragment

Archive-visible conceptual paths:
OPS/nav/nav.xhtml
OPS/text/ch01.xhtml#target
OPS/text/ch02.xhtml#target

Action:
From ch02, activate relative link to #target intended for ch02.

Expected:
ch02 target is revealed. Same fragment name in ch01 is irrelevant.

### Example D — batch import

Input:
11 selected files: ten valid synthetic EPUBs and one invalid archive in position 6.

Expected summary:
10 imported
1 failed
failed item shown by display name with stable reason category

No valid item after position 6 is skipped merely because position 6 failed.

### Example E — literal search

Book contains both:
「そうです。」
そうです

Query:
「そうです。」

Expected:
Literal quoted occurrence matches. The unquoted occurrence is not considered the same match unless the user explicitly chooses a normalization mode that says punctuation is ignored.

## 8. Benchmark protocol

Performance results MUST be externally measurable at the product boundary. Internal algorithm timing alone is insufficient.

Record:
- commit/build identifier
- browser/device + OS
- cold/warm state
- fixture ID and size
- median, p95 and maximum for at least 20 repetitions where practical
- memory before/after long-run scenarios
- failures/timeouts

Reference environments:
A. Desktop baseline: current stable Chromium on a typical 4-core/8-core consumer machine with 16 GB RAM.
B. Safari baseline: current supported WebKit/Safari desktop or iPhone class device.
C. Constrained mobile: representative mid-range Android device or throttled equivalent.
D. E-ink device only for e-ink-specific UI if the product claims such support.

Thresholds are product targets, not measurements copied from any other product.

### CR-BENCH-001 Warm page turn

Fixture: medium publication already open.
Measure: input event to visually settled next/previous page.

Desktop:
- median <= 100 ms for no-animation mode
- p95 <= 180 ms for no-animation mode

Animated mode:
- input feedback begins <= 100 ms
- animation duration may be longer but MUST be deterministic and cancelable

Constrained mobile:
- p95 <= 300 ms no-animation

### CR-BENCH-002 Warm lookup

Fixture: representative installed local dictionary set already initialized.
Measure: tap/selection accepted to first meaningful popup result or explicit no-result state.

Desktop:
- median <= 120 ms
- p95 <= 250 ms

Constrained mobile:
- p95 <= 500 ms

No benchmark pass if the popup appears empty and fills substantially later without a visible loading state.

### CR-BENCH-003 In-book search

Fixture: 1,000,000 visible Unicode code points across >=100 resources, including ruby and supplementary CJK.
Query appears near beginning, middle and end.

Targets:
- UI acknowledges search <=100 ms
- first result batch <=300 ms desktop
- complete literal scan <=2.0 s desktop
- cancellation/new query takes visible precedence <=150 ms
- stale old results never replace the new query

### CR-BENCH-004 Ruby-heavy chapter open

Fixture: CR-FIX-012.
Targets:
- first stable readable content <=1.5 s warm desktop
- lookup becomes usable <=2.0 s
- no unbounded blank screen
- after 100 page/lookup interactions, p95 interaction latency is not >2x first-20-interaction p95 without a documented resource reason

### CR-BENCH-005 Large library

Fixture: CR-FIX-011, 5,000 books.

Targets desktop:
- first usable library viewport <=1.0 s from already-open local database
- sort/filter action visibly acknowledged <=100 ms
- p95 time to stable sorted first viewport <=500 ms
- 60-second repeated scroll has <=1% long frames above 100 ms, excluding deliberate image decode started by opening a book
- returning to library does not cause full-size cover re-decode for every previously seen item

Targets constrained mobile:
- first usable viewport <=2.0 s
- p95 sorted first viewport <=1.0 s

### CR-BENCH-006 Restore

Fixture: medium book, saved position at 70%, 50 highlights, optional audio position.

Targets:
- stable restored text <=1.0 s warm desktop / <=2.0 s constrained mobile
- no visible wrong-chapter steady state >250 ms
- no progress/statistics mutation caused solely by hidden restoration

### CR-BENCH-007 Re-entry stability

Scenario:
20 cycles of open book -> 10 lookups -> close, repeated in same process.

Pass:
- no crash
- no duplicate popup/input layer
- retained memory after GC/idle reaches a bounded plateau appropriate to caches
- final-cycle warm lookup p95 <=2x first-cycle p95

The exact memory ceiling is platform-specific; monotonic unbounded growth fails regardless of absolute number.

### CR-BENCH-008 Audio background return

Measure 20 background/foreground cycles during playback.

Pass:
- zero duplicate audible playback sessions
- authoritative position drift <=250 ms beyond normal media clock tolerance after each return
- controls remain responsive
- no progressive UI duplication

## 9. Accessibility and interaction requirements

CR-A11Y-001
All primary reader sheets/tabs/menus MUST have accessible names and stable focus order.

CR-A11Y-002
Opening a lookup/search/settings sheet MUST move or expose focus appropriately without losing the semantic reading anchor.

CR-A11Y-003
Closing modal reader UI MUST restore focus to a sensible reader control/content location.

CR-A11Y-004
High-contrast/e-ink themes MUST preserve selected/unselected distinction without relying solely on subtle color.

CR-A11Y-005
Text zoom/font-size increase MUST NOT make compact labels overlap essential controls; oversized popups MUST remain scrollable/reachable.

CR-A11Y-006
Reduced-motion preference MUST remove unnecessary motion while preserving navigation feedback.

CR-A11Y-007
Hardware keyboard paging/navigation MUST not fire while focus is inside text input, note editor, search field or other control that owns that key.

## 10. Failure taxonomy

Tests and telemetry/logs may classify failures with implementation-neutral categories:

- IMPORT_UNSUPPORTED
- IMPORT_UNREADABLE
- IMPORT_PARTIAL_FAILURE
- RESOURCE_OPTIONAL_MISSING
- RESOURCE_REQUIRED_MISSING
- NAV_TARGET_UNRESOLVED
- NAV_STALE_REQUEST
- LOOKUP_NO_RESULT
- LOOKUP_UNAVAILABLE
- SEARCH_CANCELED
- SEARCH_FAILED
- MEDIA_UNAVAILABLE
- MEDIA_MATCH_PARTIAL
- STORAGE_TEMPORARILY_UNAVAILABLE
- RESTORE_UNRESOLVED
- USER_ACTION_CANCELED

Exact internal enum names are not mandated. User-visible errors SHOULD use plain language rather than these machine-oriented labels.

## 11. Qualification sequencing after approval

This is a risk-first order for a **separately approved** feature or suite. It is not standing authorization to execute these phases.

Possible sequence after the approval gate is satisfied:

Phase A — for the named approved scope, build only the independently authored fixtures/tests permitted by that approval.

Phase B — if production implementation is also explicitly approved, address failing correctness requirements for the named scope.

Phase C — if included in the approval, qualify lifecycle/media behavior.

Phase D — if included in the approval, run scale and benchmark work.

Phase E — optional surfaces require their own explicit feature approval; they are never pulled in merely because an earlier phase completed.

A phase may discover that the current product already passes a requirement. In that case, preserve working behavior. Do not rewrite it merely to mimic another product.

If the approval is tests-only, stop after tests/qualification and report failures; do not modify production behavior.

## 12. Definition of done

For an explicitly approved feature area, qualification is complete when:

1. every in-scope MUST acceptance test has an automated test or a documented physical-device/manual test where automation is not credible;
2. all independently authored fixtures are stored with project-owned provenance and licenses;
3. benchmark results meet thresholds or a specific exception is documented;
4. no test depends on competitor source, symbols, comments, patches, internal architecture or copied fixture data;
5. implementation PR description references only this sanitized spec and target-side evidence;
6. the implementer attests that prohibited competitor implementation material was not consulted;
7. review confirms the change improves or preserves observable behavior without introducing a second hidden implementation solely for the test.

## 13. Implementer handoff text

Use only this specification, the clean-room policy, `CLEAN_ROOM_APPROVALS.md`, the sealed handoff, and authorized target repository material.

First verify that an active approval names the exact feature/CR IDs and work level. If no matching approval exists, do not create target fixtures/tests or modify product code; restrict work to requested research/spec refinement.

Do not search for or inspect the products that motivated these requirements. Do not open competitor repositories, source-bearing issues/PRs, patches, diffs, symbols, comments, or implementation descriptions. Do not request the observer dossier.

First create the independent fixtures and acceptance tests. Run them against current target behavior to establish which requirements already pass. Then make the smallest coherent target-owned changes needed to satisfy failing requirements. Preserve existing working behavior and licensing boundaries. Record benchmark methodology and results.

If a requirement is ambiguous, stop on that requirement and request a behavior-only clarification by acceptance-test ID. Continue with unambiguous requirements rather than researching the external product.
