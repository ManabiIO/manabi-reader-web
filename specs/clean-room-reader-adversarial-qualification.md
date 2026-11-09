# Clean-room reader adversarial qualification plan

Status: sanitized implementation input
Revision: 2026-10-02 deep pass
External source provenance: intentionally absent
Authorization: **qualification work in this document is dormant unless the relevant feature/suite is explicitly approved in `../CLEAN_ROOM_APPROVALS.md`.**

This document supplements `clean-room-reader-competitive-spec.md`. It turns broad behavior requirements into adversarial, metamorphic, cross-engine, state-transition, and scale tests. It does not prescribe implementation.

## 1. Test philosophy

A reader should be tested as a long-lived stateful system, not just as a renderer.

Qualification must cover:

- the same logical text represented in different legal forms;
- the same semantic position across reflow and device changes;
- overlapping input owners such as selection, popup, reader navigation and browser chrome;
- stale asynchronous work completing after newer intent;
- local/remote state disagreement;
- partial corruption or missing optional resources;
- large-but-valid data;
- long-running repeated use rather than only a fresh launch;
- external integrations entering and leaving the reader.

Tests should prefer project-authored synthetic fixtures whose expected semantics are obvious from inspection.

## 2. Additional invariants

### CR-INV-011 — Semantic context crosses visual boundaries

Sentence/source context used for lookup, mining, audio or notes MUST be defined from logical text, not from the current page rectangle. A visual page, OCR line, inline span, or temporary render chunk MUST NOT truncate a sentence unless the product explicitly defines that boundary as semantic.

### CR-INV-012 — Newer user intent supersedes stale work

When operation B supersedes operation A, any later completion from A MUST NOT replace B's visible state, durable state, progress, popup, cover, query results or media ownership.

### CR-INV-013 — Sync never silently rolls a newer state backward

Remote refresh, reconnect, retry, reauthentication or metadata repair MUST NOT silently replace a known-newer local reading state with an older remote state. Ambiguous conflicts require a deterministic documented policy or explicit user resolution.

### CR-INV-014 — Display identity is not storage escaping

Filesystem/cloud-safe encoding, path normalization and provider naming constraints MUST NOT silently mutate the user's canonical display title or merge two distinct titles.

### CR-INV-015 — Context-specific state stays scoped

If one logical book may be attached to multiple language/profile contexts, removing or editing one context MUST NOT destroy another context's state. Global settings, if any, must be explicitly designated global.

### CR-INV-016 — Derived caches are disposable

A thumbnail, search index, render cache, OCR cache, remote-list cache or other derived artifact may improve performance but MUST NOT become the only copy of user-authored or original imported data.

### CR-INV-017 — Popup interaction owns its pointer stream

Once an interaction is accepted by an open popup/dialog/selection surface, that same pointer/gesture MUST NOT also trigger the underlying reader's page turn, pan, lookup, dismissal or navigation unless explicitly designed as a chained action.

### CR-INV-018 — Pagination does not redefine text

Page count and visual page boundaries may change with layout. They MUST NOT change sentence content, vocabulary-state identity, highlight ranges or the logical order of source text.

## 3. Additional independent fixtures

### CR-FIX-017 Cross-page sentence book

Create paragraphs where one sentence is forced to span:
- two paginated screens;
- multiple inline elements;
- a ruby span;
- an inline image with alt text between clauses.

Include unique sentinel words at the sentence start and end.

Acceptance:
- mining/source-context extraction contains both sentinels when the semantic sentence spans the page break;
- visual page change alone does not alter the sentence string;
- returning to the previous page does not duplicate or lose words;
- popup dismissal does not leave stale sentence highlighting.

### CR-FIX-018 OCR line-break context

Create a synthetic manga page with one logical sentence split across three OCR rectangles and two visual line breaks.

Acceptance:
- a lookup in the middle rectangle can expose the complete logical sentence when OCR reading order connects the boxes;
- line breaks used only for geometry do not become mandatory sentence terminators;
- duplicate OCR rectangles do not duplicate sentence text;
- user-selected text still maps to one visual location.

### CR-FIX-019 Rapid-page-state book

Create five short pages where each page contains:
- a distinct vocabulary state marker;
- a unique search target;
- a unique cover-like inline image;
- a unique delayed asynchronous decoration request in the test harness.

Acceptance:
- flip 1→2→3→4 quickly;
- after all delayed tasks settle, page 4 displays only page-4 state;
- late results from pages 1–3 are ignored;
- back to page 3 reconstructs page-3 state from authoritative data, not stale page-3 work retained from the previous visit.

### CR-FIX-020 Sync conflict corpus

Generate two replicas of the same logical book state:

Case A:
- local progress revision 12 at 72%;
- remote progress revision 11 at 64%.

Case B:
- local revision 12 at 72%;
- remote revision 13 at 75%.

Case C:
- same revision/timestamp class but conflicting highlight edits.

Case D:
- provider reconnect occurs after local progress changed while credentials were expired.

Acceptance:
- A never silently rolls local progress backward;
- B follows documented newer-state policy;
- C follows explicit merge/conflict policy rather than dropping one edit silently;
- D reconnect cannot treat rediscovered older remote metadata as authoritative merely because the connection is new.

### CR-FIX-021 Rename and storage-safety corpus

Create a series with local and remote children using titles containing:
- reserved path punctuation;
- leading/trailing spaces;
- composed/decomposed Unicode;
- two titles that sanitize to the same naïve filename;
- one remote-only child;
- one child whose rename operation is forced to fail.

Acceptance:
- display titles remain the user-authored strings;
- storage names may differ but cannot create undetected collisions;
- parent rename does not strand or hide an undownloaded child;
- partial rename reports per-item results;
- retry is idempotent;
- a failed remote rename does not revert already confirmed unrelated local metadata without policy.

### CR-FIX-022 Same-book contexts

Attach one byte-identical book to contexts A and B.

A:
- Japanese lookup profile;
- vertical layout;
- progress 40%.

B:
- another language/learning profile;
- horizontal layout;
- progress 10%.

Acceptance:
- removing context B does not remove A;
- changing B's lookup state does not change A unless the setting is explicitly global;
- any shared physical file ownership remains reference-safe;
- deleting the physical file has an explicit effect on both metadata records without silently merging their personal state.

### CR-FIX-023 Stale-cache query corpus

Create three queries whose results intentionally complete out of order:
- Q1 slow;
- Q2 medium;
- Q3 fast.

Also create optional cached enrichment from a previous query.

Acceptance:
- issuing Q1→Q2→Q3 rapidly ends with Q3 visible;
- no text/enrichment from Q1 or Q2 appears after Q3 settles;
- clearing search retires all outstanding visible-result work;
- reopening history may restore prior results only as an explicit history action.

### CR-FIX-024 TTS punctuation corpus

Sentences end with:
- 。
- ！」
- ？」
- ……
- a closing parenthesis;
- ruby immediately before closing punctuation;
- an inline emphasis element wrapping the final phrase.

Acceptance:
- read-along proceeds to the next sentence for every supported punctuation form;
- closing punctuation is included/excluded consistently according to the product's sentence contract;
- jumping between sentence N and N+2 repeatedly does not prevent later automatic continuation;
- stopping/leaving the reader terminates reader-owned TTS according to lifecycle policy.

### CR-FIX-025 Final-page pagination corpus

Generate books whose laid-out lengths produce:
- exactly one full page;
- one full page plus one line;
- N exact full pages;
- N pages plus one glyph;
- a final image-only page;
- a final ruby-only-short-line edge case.

Acceptance:
- X/Y never reports X > Y;
- the final reachable page reports X = Y;
- no empty ghost page is inserted solely by rounding;
- backward navigation from final page restores all preceding text;
- changing font size may change Y but preserves semantic final content.

### CR-FIX-026 Provider-placeholder library

Create 100 local items and 100 metadata-only remote placeholders.

Acceptance:
- placeholder is visually/semantically distinguishable from offline-readable item;
- opening a placeholder follows download/connect flow rather than an infinite reader load;
- a missing cover does not block the placeholder row/card;
- sorting and searching include/exclude placeholders according to documented policy;
- failed provider refresh does not delete last-known placeholder metadata.

### CR-FIX-027 Cache corruption matrix

Independently corrupt one derived artifact at a time:
- cover thumbnail;
- local text search index;
- render snapshot;
- remote listing cache;
- optional media analysis cache;
- OCR derivative.

Acceptance:
- original book/user state survives;
- product either rebuilds, bypasses or reports the derived failure;
- no corruption is propagated back to the original file solely from a bad cache;
- repair does not duplicate user annotations.

### CR-FIX-028 Mixed-input interaction page

Provide a reader page with:
- selectable text;
- an open popup taller than the viewport;
- an internal link;
- a scrollable popup subregion;
- reader page-swipe enabled;
- browser/OS text selection handles;
- mouse, touch, trackpad and stylus test paths where available.

Acceptance:
- gestures are owned by the surface where they begin unless documented otherwise;
- popup scrolling cannot turn the book page;
- dragging a selection handle cannot pan/turn the page;
- tapping a popup link does not also create a second lookup;
- tap outside dismisses exactly one modal layer according to stack order;
- a close control remains reachable at large text scale.

### CR-FIX-029 OCR ordering corpus

Create page files:
- page_001.jpg
- page_002.jpg
- page_010.jpg
- page_4_#001.jpg
- page_4_001.jpg
- page_4_%23001.jpg
- full-width digit variants
- non-Latin stems.

Define expected order explicitly in fixture metadata rather than relying on lexical sort.

Acceptance:
- reader honors declared/derived natural order deterministically;
- # and percent sequences are not mistaken for URL fragments;
- reimport produces the same order;
- cloud/local provider round-trip does not change order.

### CR-FIX-030 Large remote catalog

Simulate:
- 20,000 remote metadata records;
- 2,000 local items;
- 5% remote-only placeholders;
- 10% missing covers;
- provider pagination;
- credentials expiring during page 3;
- one later reconnect.

Acceptance:
- first usable viewport does not wait for the entire remote catalog when progressive listing is possible;
- already loaded records remain stable during later-page failure;
- reconnect resumes/reloads according to documented policy without duplicating entries or rolling progress backward;
- visible-first cover loading is bounded.

## 4. Acceptance suites

### Semantic context

CR-AT-100 Cross-page sentence integrity
Create mining/context from the middle of CR-FIX-017. Output MUST contain the same logical sentence before and after a repagination that moves the page break.

CR-AT-101 OCR line break is not automatically sentence break
Use CR-FIX-018. Geometry-only OCR line breaks MUST NOT truncate context if fixture reading order says the sentence continues.

CR-AT-102 Context range remains inside intended sentence
A lookup near a paragraph boundary MUST NOT absorb an unrelated next sentence merely to cross a page boundary.

CR-AT-103 Ruby reading does not replace source phrase
Source-context text uses the canonical visible/base-text policy rather than accidentally substituting ruby readings for ordinary source text.

CR-AT-104 Alt-text policy is explicit
Inline image alt text that represents a character may participate in logical text according to the publication projection policy; decorative image alt text MUST NOT silently become unrelated mining context.

### Input ownership

CR-AT-110 Popup scroll ownership
Open oversized popup and scroll inside it. Underlying reader position MUST NOT change.

CR-AT-111 Popup link ownership
Activate a link/control inside popup. Exactly the popup's intended action occurs; no simultaneous reader lookup/page action.

CR-AT-112 Selection-handle ownership
Drag selection handle across more than the configured page-swipe distance. Selection changes, page does not.

CR-AT-113 Touch dismissal stack
With nested/child popup state, outside tap dismisses only the topmost expected layer; invisible layers MUST NOT remain to block later input.

CR-AT-114 Trackpad modality
Small trackpad zoom/pan gestures, if supported, SHOULD produce proportional continuous response rather than being coerced into coarse wheel/page steps.

CR-AT-115 Input inside editable control
Reader/global lookup hotkeys and pointer scanners MUST NOT interfere with cursor placement/editing inside search, note or text-entry controls.

### Pagination/state fencing

CR-AT-120 Rapid flip stale-state isolation
Use CR-FIX-019. After rapid navigation settles, no decoration/state from an older page may appear on the final page.

CR-AT-121 Last-page correctness
Run all CR-FIX-025 variants. Final reachable page displays X = Y and no content is missing.

CR-AT-122 Backward completeness
Navigate forward then backward through a sentence split across pages. All source text returns in original order.

CR-AT-123 Malformed-resource containment
A malformed noncritical publication resource may be skipped or shown as an error according to policy, but MUST NOT leave the entire book in infinite loading when later valid resources are independently readable.

CR-AT-124 Fast repeated navigation persistence
Persisted resume state after a burst reflects the final accepted page/location, not an intermediate callback.

### Sync and provider state

CR-SYNC-001 Older remote state cannot win on reconnect
Given local newer progress and remote older progress, reconnect MUST NOT silently roll back local progress.

CR-SYNC-002 Newer remote state follows policy
Given an unambiguously newer remote state, behavior follows the documented import/merge policy and is visible if it changes local position.

CR-SYNC-003 Ambiguous edit conflict
Concurrent annotation edits cannot silently discard one side without documented conflict resolution.

CR-SYNC-004 Provider failure preserves last-known library
Transient automatic provider failure keeps previously known valid items/placeholders visible.

CR-SYNC-005 Destructive remote overwrite confirmation
If an action replaces an existing remote backup rather than merging/versioning it, explicit confirmation is required.

CR-SYNC-006 Partial rename truthfulness
If three of five child renames succeed, UI reports three success/two failure (or an equivalent accurate state), never a single unconditional success.

CR-SYNC-007 Reconnect idempotence
Repeated reconnect/retry does not duplicate books, annotations, statistics or placeholders.

CR-SYNC-008 Clock skew
If sync policy uses timestamps, run replicas with ±24-hour device skew. Behavior MUST follow a version/content policy that is documented; raw device clock alone MUST NOT cause silent destructive loss where stronger identity/version data exists.

CR-SYNC-009 Metadata placeholder distinction
Remote metadata without local bytes MUST NOT be represented as fully offline-readable.

CR-SYNC-010 Context deletion isolation
Deleting one logical context of CR-FIX-022 MUST NOT destroy sibling-context state.

### Cache isolation

CR-CACHE-001 Stale query completion
Q3 remains visible after late Q1/Q2 completions.

CR-CACHE-002 Clear retires visible work
Clear/reset action cannot be followed by a late old result reappearing.

CR-CACHE-003 Derived cache loss
Deleting any one derived cache from CR-FIX-027 does not delete the book or annotations.

CR-CACHE-004 Account/provider cache scope
Switching account/provider context MUST NOT display a previous account's cached private library state as current.

CR-CACHE-005 Cover refresh
A changed authoritative cover eventually replaces stale cached cover while library identity/progress stays unchanged.

### TTS/read-along

CR-AT-130 Closing-punctuation continuity
Run CR-FIX-024 and verify next-sentence progression for all supported punctuation forms.

CR-AT-131 Repeated sentence jumps
Perform 30 alternating sentence jumps, resume automatic playback, and verify progression continues.

CR-AT-132 Exit ownership
Leave the reader while reader-owned TTS/audio is active. Playback behavior matches explicit background policy; it MUST NOT become an orphan session.

CR-AT-133 Page transition continuity
Read-along crossing a visual page boundary does not stop solely because layout split the sentence.

### OCR/manga

CR-OCR-001 Duplicate box suppression
Two geometrically/equivalently duplicated OCR boxes expose one logical selectable text occurrence according to dedup policy.

CR-OCR-002 Hit-target stability
Press/hold/tap on the same OCR box without zoom or layout change. Box geometry MUST NOT jump merely because pointer state changed.

CR-OCR-003 Natural page ordering
CR-FIX-029 opens pages in fixture-declared order across local and provider round-trip.

CR-OCR-004 User correction durability
If OCR editing is supported, edit text/geometry, close/reopen, and verify correction persists without modifying the original source image.

CR-OCR-005 Undo/original restoration
If OCR version/edit history is supported, undo/redo and restore-original are deterministic and do not delete unrelated annotations/progress.

CR-OCR-006 Alternate OCR versions
If multiple OCR versions exist, switching version changes selectable text while preserving page identity/progress.

### Knowledge overlays when enabled

CR-KNOW-001 State visual update
Changing a word's learning state updates every currently visible occurrence that shares that vocabulary identity without requiring unrelated navigation.

CR-KNOW-002 Page isolation
A late state update from previous page cannot recolor a different token on current page merely because indexes coincide.

CR-KNOW-003 Native ruby compatibility
Generated learner furigana MUST NOT duplicate, corrupt or make native publication ruby unselectable.

CR-KNOW-004 Unknown-only furigana
If furigana can be limited by learner state, changing a word between known/unknown predictably toggles only the intended reading annotation.

CR-KNOW-005 Overlay opt-out
Disabling overlay restores readable source presentation and does not require reimporting the book.

## 5. Metamorphic tests

Metamorphic testing verifies that transformations which should not change semantics do not change results.

### CR-META-001 Unicode serialization
Serialize equivalent eligible characters/entities through alternate legal source encodings while keeping canonical visible text constant.

Expected:
- search match count and logical order remain equivalent;
- saved locator witness resolves to equivalent visible text;
- sentence context is semantically equivalent.

### CR-META-002 Inline markup fragmentation
Split one sentence into many inline spans/emphasis elements without changing visible text.

Expected:
- search, sentence extraction, highlight and read-along logical text stay equivalent.

### CR-META-003 Reflow
Change viewport width, font size, line spacing, safe area and writing direction while remaining on a sentinel paragraph.

Expected:
- logical anchor remains in the same semantic neighborhood;
- highlights/context strings remain identical;
- page number may change.

### CR-META-004 Resource rename
Rename archive resource paths and update valid publication references accordingly.

Expected:
- visible book, navigation and semantic positions remain equivalent;
- no assumption of one conventional folder layout is observable.

### CR-META-005 Provider round-trip
Export/import or remote/local round-trip without user edits.

Expected:
- logical book identity, progress and annotations remain equivalent according to documented portable fields;
- provider-specific path/IDs may differ.

### CR-META-006 Cache deletion
Delete all derived caches between two runs.

Expected:
- first run after deletion may be slower;
- user-visible durable data remains equivalent after rebuild.

### CR-META-007 Input modality
Perform semantically equivalent next-page actions via button, keyboard and touch gesture.

Expected:
- final logical position is equivalent;
- interaction animation may differ.

## 6. Cross-engine/browser matrix

For web surfaces, qualify at minimum:

| Suite | Chromium | WebKit | Firefox |
| --- | --- | --- | --- |
| EPUB open/restore | MUST | MUST | SHOULD |
| vertical/ruby rendering | MUST | MUST | MUST |
| selection + popup | MUST | MUST | MUST |
| keyboard/input ownership | MUST | MUST | MUST |
| touch/pointer emulation | MUST | MUST | SHOULD |
| offline/local persistence | MUST | MUST | SHOULD |
| internal links/navigation | MUST | MUST | MUST |
| search/highlights | MUST | MUST | MUST |
| large-library basic journey | MUST | MUST | SHOULD |
| service-worker/offline if shipped | MUST | MUST | SHOULD |

Physical-device qualification remains necessary for:
- iOS Safari selection handles and viewport/insets;
- Android browser/host back behavior and IME;
- stylus;
- hardware volume/page keys;
- real background audio/media controls;
- e-ink refresh characteristics.

An emulated browser pass must not be labeled a physical-device pass.

## 7. Property/fuzz domains

Project-owned generators MAY produce additional cases from these domains.

### Unicode generator
Include:
- BMP and supplementary CJK;
- variation selectors;
- combining marks;
- compatibility ideographs;
- full-width digits/punctuation;
- iteration marks;
- emoji and ZWJ sequences outside Japanese lexical spans;
- decomposed/composed equivalents.

Properties:
- never split a Unicode scalar/surrogate pair into an invalid lookup boundary;
- no crash;
- forward/backward traversal is stable;
- logical text witness after save/restore remains valid.

### Archive/path generator
Generate:
- nested directories;
- percent-encoded path components;
- spaces and non-Latin paths;
- same fragment IDs in multiple resources;
- long but bounded paths;
- mixed path case where provider semantics allow;
- optional missing resources.

Properties:
- valid relative references resolve against their resource;
- names are not interpreted as URL query/fragment accidentally;
- one missing optional asset does not destroy unrelated content.

### Layout generator
Vary:
- viewport width/height;
- writing direction;
- font size;
- line/paragraph spacing;
- safe areas;
- image aspect ratio;
- ruby density.

Properties:
- content remains reachable;
- progress remains bounded 0–100%;
- no permanent unreachable final column/page;
- semantic anchor survives reflow.

## 8. Long-run soak scenarios

### CR-SOAK-001 Reader reopen
100 open/read/close cycles across 10 books.

Fail if:
- abandoned interaction layers accumulate;
- memory/latency grows monotonically without bounded cache explanation;
- later restore becomes less accurate.

### CR-SOAK-002 Lookup
2,000 sequential lookups across repeated and distinct terms.

Fail if:
- popup no longer opens/dismisses;
- old source context appears on a new term;
- action controls drift outside popup;
- latency trend indicates unbounded leaked work.

### CR-SOAK-003 Provider refresh
200 refresh/retry cycles with injected transient failures.

Fail if:
- duplicates accumulate;
- last-known library disappears on transient automatic failure;
- progress moves backward without conflict policy.

### CR-SOAK-004 Search cancellation
Issue 500 alternating slow/fast queries with cancellation.

Fail if:
- stale result appears after newer query;
- UI becomes permanently “Searching”;
- memory grows without returning toward a bounded baseline.

### CR-SOAK-005 Page-turn burst
10,000 next/previous commands in bounded bursts using a synthetic book.

Fail if:
- final location differs from accepted command history;
- stored resume escapes valid range;
- old callbacks change a later resource.

## 9. Benchmark extensions

### CR-BENCH-009 Context extraction
Fixture: CR-FIX-017 and CR-FIX-018.

Desktop target:
- source-context extraction after accepted lookup <=50 ms median and <=120 ms p95, excluding dictionary query;
- extraction result identical before/after repagination.

### CR-BENCH-010 Popup interaction
With a result taller than two viewports:
- initial meaningful content within CR-BENCH-002 budget;
- scroll response starts within 100 ms;
- no underlying reader movement during 100 repeated popup scroll gestures.

### CR-BENCH-011 Provider reconnect
Fixture: CR-FIX-030 with simulated credential expiry.

Target:
- previously cached/known library remains interactable immediately where safe;
- reconnect action visibly acknowledged <=150 ms;
- no full-catalog duplicate pass after reconnect;
- first refreshed page <=2 s in test network profile unless provider itself is slower, in which case provider time is reported separately.

### CR-BENCH-012 Continuous long-volume rendering
Synthetic 1,000-page manga/OCR or equivalent long continuous source if feature exists.

Targets:
- opening at saved page does not require visibly scrolling from page 1;
- first saved-page content <=2 s desktop;
- scrolling for 60 s does not show unbounded retained item growth;
- interaction remains usable under OCR overlay.

## 10. Optional candidate capability contracts

These are isolated product opportunities, not requirements to implement in the current PR.

### CR-CAP-001 Paste/clipboard reader
User can paste plain text into a disposable or saved reading surface and use the same lookup/learning overlays as ordinary text.

Minimum contract:
- pasted content remains local unless user invokes a network feature;
- clear/new paste cannot be repopulated by stale processing;
- IME/editing remains usable;
- optional auto-paste has an obvious enabled state.

### CR-CAP-002 Distraction-free parsed-text view
A simplified reading surface may hide surrounding site chrome for user-selected text.

Minimum contract:
- original source can be exited/restored;
- transformed view does not silently change logical text;
- links/source attribution remain recoverable where relevant.

### CR-CAP-003 Learner-state furigana
Furigana modes may include all, none, interaction-reveal, or learner-state-driven display.

Minimum contract:
- publication-native ruby remains semantically distinct from generated learner ruby;
- toggling mode does not corrupt selection/highlights;
- state changes update deterministically.

### CR-CAP-004 Coverage/comprehension view
A document/book may show coverage based on the user's known-word state.

Minimum contract:
- calculation version and vocabulary scope are defined;
- recalculation is cancelable;
- large-library recalculation cannot corrupt books on failure;
- score is informational and does not alter source text.

### CR-CAP-005 Basic PDF reading
If added, PDF is treated as its own source type rather than pretending it has EPUB semantics.

Minimum contract:
- page identity is stable;
- selectable text/lookup only where text data exists;
- scanned pages expose an explicit OCR path if supported;
- bookmarks/progress remain page/document scoped.

### CR-CAP-006 OCR corrections and versions
If manga OCR is supported, users may correct recognized text/geometry without modifying original images.

Minimum contract:
- edits are reversible;
- original version remains recoverable;
- alternate OCR versions do not duplicate reading statistics;
- cloud conflict policy is explicit if edits sync.

### CR-CAP-007 Reading goals/deadlines
If goal planning is supported:
- goals are user-authored and editable;
- timezone/day-boundary policy is explicit;
- progress cannot double-count hidden restore/navigation;
- cross-device changes reconcile deterministically.

## 11. Qualification record template

For every test run record:

- Requirement ID:
- Build/commit:
- Fixture revision:
- Platform:
- Browser/engine:
- Device class:
- Cold/warm:
- Preconditions:
- User action:
- Expected:
- Observed:
- Result: PASS / FAIL / INCONCLUSIVE / NOT APPLICABLE
- Timing samples where required:
- Screenshot/video reference if permitted:
- Known limitation:
- Follow-up issue/PR:

Do not place external competitor source/provenance in this record.

## 12. Release gate

This gate applies only to a feature/suite that has explicit approval at the required work level. It does not authorize testing, implementation, integration, or release work by itself.

A release candidate should not claim an approved clean-room scope is complete merely because tests exist.

For each approved shipped feature area, completion requires:
- relevant deterministic acceptance tests pass;
- applicable cross-engine matrix passes;
- soak tests have no unbounded lifecycle defect;
- benchmark regressions are within target budgets;
- device-only behaviors are either physically qualified or explicitly unqualified;
- sync/provider destructive cases have a documented policy;
- fixture provenance is project-owned;
- implementation review confirms no prohibited external implementation material entered the worker context.


## 13. Stop conditions

A worker must stop target-side execution for a CR area when:

- no active approval names that feature/suite;
- the approval is tests-only and a production failure is discovered;
- resolving the failure would require an adjacent unapproved feature;
- the worker would need external competitor research to clarify behavior;
- device qualification is required but unavailable;
- the approved scope has been completed.

The worker should report the finding and the CR IDs that would require a new approval. It must not “finish nearby work while here.”
