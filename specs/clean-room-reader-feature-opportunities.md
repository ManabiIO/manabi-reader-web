# Clean-room reader feature opportunities

Status: DISCOVERY_ONLY sanitized optional product backlog
Revision: 2026-10-03
External product provenance: intentionally absent
Authorization: **none of the CR-OPP entries in this document are approved for tests or implementation by inclusion here. `../CLEAN_ROOM_APPROVALS.md` currently controls promotion.**

This document contains product opportunities discovered through behavior-only competitive research. It is an idea registry, not a roadmap, queue, work order, or release plan.

The purpose is to preserve useful ideas without forcing an implementation worker to inspect external products.

Every CR-OPP entry defaults to DISCOVERY_ONLY. A future worker may refine an entry when explicitly asked to review this research PR, but must not create target tests, prototypes, production changes, or implementation PRs for it unless a separate explicit per-feature approval names that entry (or an unambiguous mapped feature) and approval level.

Order in this file, section placement, detail level, mention in a “candidate” subset, or overlap with current target primitives does not imply priority or approval.

## 1. Learning-aware reading

### CR-OPP-001 Chapter preflight

Before opening a chapter, optionally show:
- estimated unknown vocabulary;
- estimated unknown kanji;
- grammar patterns likely to be unfamiliar;
- reading length;
- expected reading time;
- optional preparation list.

The preparation list SHOULD be filterable by:
- already known;
- already saved/mined;
- frequency/rank;
- first occurrence in this chapter;
- user-selected difficulty threshold.

The feature MUST remain optional. A user should always be able to open the chapter immediately.

### CR-OPP-002 Whole-book vocabulary forecast

Provide a non-destructive overview of vocabulary/kanji that a user is likely to encounter across the whole book.

Possible views:
- total unique terms;
- unknown unique terms;
- high-frequency unknown terms;
- first-chapter appearance;
- known-word coverage percentage;
- cumulative coverage curve by chapter.

A forecast MUST identify its vocabulary source/version and must not alter the book.

### CR-OPP-003 Adaptive furigana

Offer learner-aware furigana modes in addition to ordinary publication-ruby controls.

Potential modes:
- publication only;
- all generated readings;
- unfamiliar words only;
- unfamiliar kanji only;
- reveal on tap/hover;
- dim until interaction.

Requirements:
- publication-native ruby remains distinct from generated learner assistance;
- toggling mode does not alter saved locators/highlights;
- generated reading never silently replaces source text;
- user can disable the feature completely.

### CR-OPP-004 Learner-state text styling

Optional low-noise styling can show known / learning / unknown vocabulary in the reading surface.

Requirements:
- source text remains selectable;
- dictionary lookup remains available;
- high-contrast themes remain legible;
- the overlay can be disabled instantly;
- state changes do not require book reload;
- late updates from another page/session cannot recolor the wrong token.

### CR-OPP-005 Inline micro-glosses

Optionally show short learner glosses inline for selected categories such as unfamiliar vocabulary.

The mode SHOULD be:
- sparse;
- user-configurable by difficulty/state;
- visually subordinate to source text;
- easy to hide.

Full dictionary detail remains on demand.

### CR-OPP-006 Proper-name assistance

Provide a distinct name-reading layer for likely person/place/organization names.

Requirements:
- visibly distinguish inferred/generated readings from publication-provided ruby;
- allow quick correction or suppression;
- do not force name readings into exported source text unless user chooses them.

### CR-OPP-007 Context-ranked dictionary sense

When a term has many readings/senses, the popup may rank likely senses using the current sentence.

Requirements:
- preserve access to the complete dictionary entry;
- mark machine-ranked/inferred ordering clearly;
- do not invent definitions;
- allow disabling context ranking.

### CR-OPP-008 Grammar overlay

Offer on-demand grammar or part-of-speech annotation for the current sentence/paragraph.

Potential surfaces:
- subtle POS styling;
- grammar-pattern underlines;
- compact grammar sheet;
- chapter grammar preview.

Requirements:
- off by default or easily dismissible;
- does not interfere with text selection;
- generated explanations are labeled separately from dictionary/reference facts.

## 2. Reading planning and habit support

### CR-OPP-010 Finish-date planner

Let the user choose either:
- target finish date -> required reading pace; or
- reading pace -> estimated finish date.

Inputs MAY include:
- reading days per week;
- rest days;
- chapters/pages/characters per session;
- historical reading speed.

The estimate must be visibly approximate when book structure or speed data is incomplete.

### CR-OPP-011 Reading queue

Allow users to queue multiple books and see:
- current priority/order;
- predicted finish dates;
- total remaining reading time;
- cumulative new vocabulary/kanji exposure.

Queue ordering SHOULD be independent of library folder organization.

### CR-OPP-012 Coverage projection across queue

Show how completing selected books may expand coverage of:
- vocabulary;
- kanji;
- frequency bands;
- user-defined study lists.

Projection must not imply actual acquisition merely from exposure.

### CR-OPP-013 Habit goals

Separate habit goals from linguistic progress.

Possible goals:
- minutes per day;
- reading days per week;
- books finished per year;
- characters/pages per day;
- streaks.

Notifications/coaching MUST be optional.

### CR-OPP-014 Time remaining

Show estimates for:
- current chapter;
- current section;
- current book.

Use measured personal reading speed when available and fall back to clearly labeled generic estimates.

## 3. Navigation beyond a normal table of contents

### CR-OPP-020 Book map

Provide a bird's-eye visualization of the whole publication.

Possible layers:
- chapter boundaries;
- read/unread regions;
- current location;
- bookmarks;
- highlights;
- notes;
- time spent;
- search hits.

The map should be navigational, not merely decorative.

### CR-OPP-021 Page/section browser

Expose a visual scrubber for nearby locations.

For reflowable text this MAY use:
- text snippets;
- chapter labels;
- small rendered previews.

For fixed-layout/comic content it MAY use page thumbnails.

### CR-OPP-022 Rich skim sheet

One compact navigation surface can jump among:
- chapters;
- recent locations;
- bookmarks;
- highlights;
- search hits;
- percentage/character location.

### CR-OPP-023 Generated table of contents

When a publication's TOC is missing or unusable, optionally derive a replacement from:
- headings;
- resource boundaries;
- other semantically safe structural cues.

Generated entries must be labeled as generated.

### CR-OPP-024 Progress scope

Allow advanced users to exclude non-reading flows from progress/time estimates, such as:
- appendix;
- bibliography;
- index;
- previews/ads;
- duplicated front matter.

This must never delete or hide the underlying content permanently.

### CR-OPP-025 Inline footnotes

Open eligible footnotes/endnotes in a local popup/sheet rather than forcing a disruptive navigation jump.

The original linked note remains reachable through ordinary navigation.

### CR-OPP-026 Navigation history

Maintain explicit Back/Forward history for intentional reader jumps.

Potential sources:
- internal links;
- TOC;
- search;
- bookmark;
- highlight;
- dictionary cross-reference back into text.

Normal page turns should not flood the history unless configured.

## 4. Reader presentation and control

### CR-OPP-030 Per-book reader presets

A title may remember its own:
- writing direction;
- layout mode;
- columns;
- margins;
- font;
- font size;
- line spacing;
- theme;
- image behavior;
- furigana mode.

Users should be able to:
- reset to global defaults;
- copy a preset;
- export/import presets;
- choose whether edits auto-save to the title.

### CR-OPP-031 Named global presets

Provide named presets such as:
- vertical novel;
- horizontal novel;
- manga dual-page;
- webtoon continuous;
- e-ink;
- accessibility large text.

Names and defaults should be target-authored, not copied from another product.

### CR-OPP-032 Sentence/block reading mode

Optional stepped reading mode shows:
- one semantic block;
- one sentence;
- or a configurable small group.

Potential controls:
- instant reveal;
- paced/typewriter reveal;
- tap/key/controller advance.

Images, tables and other atomic blocks should remain coherent.

### CR-OPP-033 Reading ruler / line guide

Provide a focus aid that emphasizes one line or a narrow band and dims surrounding text.

Requirements:
- adjustable dim amount;
- keyboard/touch navigation;
- compatible with vertical and horizontal text where practical;
- must not alter source selection or saved location.

### CR-OPP-034 Quote image

Turn a selected passage/highlight into a shareable local image.

Potential options:
- current reader font;
- vertical/horizontal layout;
- book title/author attribution;
- cover/background image;
- background blur/opacity;
- custom output dimensions.

Generation SHOULD remain local unless the user explicitly chooses a cloud feature.

### CR-OPP-035 Book notes

Support notes associated with the whole book independently of passage annotations.

Examples:
- character list;
- plot notes;
- vocabulary strategy;
- review thoughts.

### CR-OPP-036 Quick actions / command palette

Provide a searchable, keyboard-accessible command surface for infrequent reader actions.

Potential actions:
- appearance toggle;
- search;
- bookmark;
- jump;
- export;
- statistics;
- dictionary profile;
- media controls.

### CR-OPP-037 Remappable controls

Allow optional remapping for:
- keyboard;
- controller;
- external page-turn remote;
- mouse side buttons;
- gestures.

Editable text controls retain ownership of normal editing shortcuts.

### CR-OPP-038 Controller / remote navigation

Support game controllers or Bluetooth page-turn remotes for hands-free reading.

Minimum actions:
- next/previous;
- open/close controls;
- optional lookup navigation.

Input-repeat/debounce behavior must be deterministic.

### CR-OPP-039 Continuous chapters

Offer a true whole-book continuous mode that can cross chapter boundaries without a full visual reset.

Requirements:
- bounded memory;
- restore to semantic chapter+location;
- cancellable navigation;
- percentage seek;
- chapter boundaries remain visible enough to orient the reader.

## 5. Library organization

### CR-OPP-040 Continue dashboard

Create a library home emphasizing current activity:
- Continue Reading;
- recently added;
- recently finished;
- favourites;
- bookmarked books;
- queued books.

### CR-OPP-041 Rich book details

Allow user-editable local metadata such as:
- display title;
- author;
- series;
- tags;
- favourite;
- notes;
- custom cover;
- status.

Original imported metadata remains recoverable.

### CR-OPP-042 Include/exclude filters

Tags and states may support three-way filtering:
- neutral;
- include;
- exclude.

Filters should compose predictably and remain visible when active.

### CR-OPP-043 Saved library views

Save combinations of:
- search;
- sort;
- tags;
- status;
- source/provider;
- local/remote availability.

### CR-OPP-044 Watched folders

On supporting platforms, allow one or more folders to be watched or rescanned for new books.

Features MAY include:
- scan on launch;
- periodic scan;
- manual refresh;
- ignore patterns;
- inherited folder tags.

### CR-OPP-045 Relink missing books

If the physical file moves, preserve metadata/progress and let the user locate the new copy.

Identity matching must follow the product's logical-book policy, not title alone.

### CR-OPP-046 Pre-migration backup

Before a local database/schema migration, create a recoverable snapshot when practical.

A migration failure should offer a clear recovery path.

### CR-OPP-047 Favourites and collections

Favourites provide a low-friction single-bit shortcut independent of arbitrary user collections.

### CR-OPP-048 External tracking

Optional integrations can synchronize high-level progress/status with external book/manga tracking services.

External tracking must not become the authority for local reading position.

### CR-OPP-049 Local/remote placeholders

Show remote-known titles not currently stored on device while clearly distinguishing them from offline-readable items.

## 6. Search, annotations, and export

### CR-OPP-050 Advanced search

Possible modes:
- literal;
- match case;
- whole word where meaningful;
- regular expression for advanced users;
- search only current chapter;
- search whole book;
- filter by annotation type.

Regex must have execution safeguards for pathological patterns.

### CR-OPP-051 Annotation export

Export bookmarks/highlights/notes to portable formats such as:
- Markdown;
- plain text;
- JSON;
- HTML.

Export MAY optionally include:
- book metadata;
- chapter;
- location;
- surrounding context;
- creation/edit times.

### CR-OPP-052 Note-service connectors

Optional explicit connectors may send annotations to user-selected note/knowledge services.

Sync/export failures do not endanger local annotations.

### CR-OPP-053 Highlight-to-card

Convert a saved highlight into a flashcard/mining draft later, not only at initial lookup time.

### CR-OPP-054 Search/history persistence

Preserve search state within a book session and optionally expose recent searches without allowing old asynchronous queries to revive after clear/new search.

## 7. Dictionary and vocabulary workflow

### CR-OPP-060 Quick dictionary switching

Allow a small set of named dictionary/lookup profiles to be switched from the reader without visiting full settings.

### CR-OPP-061 Vocabulary browser

Provide a unified view of words:
- encountered;
- looked up;
- saved;
- mined;
- known;
- learning.

Each word MAY link back to source occurrences.

### CR-OPP-062 Encounter map

Visualize encountered kanji/vocabulary and let the user open source sentences/locations where each appeared.

### CR-OPP-063 Source-linked lookup history

Keep optional lookup history with:
- term;
- book;
- chapter;
- sentence;
- location;
- timestamp.

History can be disabled/cleared.

### CR-OPP-064 Mine from history

Allow creating a card from a previous lookup/sentence after the reading moment has passed.

If media context exists, retained media must follow explicit storage/privacy limits.

### CR-OPP-065 Update existing card

Where integration permits, allow a newly encountered context to update an existing card rather than always creating a duplicate.

The user should be able to choose which fields/media are replaced or appended.

### CR-OPP-066 Context/no-context distinction

Vocabulary saved from a sentence should retain that source context distinctly from vocabulary manually added without context.

### CR-OPP-067 Idempotent media reuse

Repeated mining of the same context should not create unnecessary duplicate image/audio assets when content is identical and the target integration supports reuse.

## 8. Audio, audiobook, podcast, and video study

### CR-OPP-070 Sentence playback modes

For timed transcript/audio:
- auto-pause at start;
- auto-pause at end;
- pause after every cue;
- resume-after-delay;
- loop cue;
- repeat N times.

### CR-OPP-071 Primed listening

Optionally hide transcript during playback and reveal it after:
- pause;
- replay;
- user request;
- configured number of listens.

### CR-OPP-072 Condensed playback

Optionally skip or speed through:
- silence;
- long gaps without transcript;
- non-target-language segments if confidently identified.

Users retain easy access to normal playback.

### CR-OPP-073 Track targeting

When multiple subtitle/transcript tracks exist, let the user choose:
- visible track;
- lookup/mining track;
- translation/reference track;
- track controlled by shortcuts.

### CR-OPP-074 Transcript list

Provide a virtualized transcript list with:
- seek;
- search;
- current-cue follow;
- chapter markers;
- mining action;
- keyboard navigation.

### CR-OPP-075 Transcript discovery

Given known media metadata, optionally help locate matching subtitle/transcript resources from configured legal/user-authorized providers.

No automatic copyrighted-resource acquisition should be assumed.

### CR-OPP-076 Subtitle timing alignment

Provide user-controlled timing tools:
- global offset;
- set current cue to current playback time;
- sync against a chosen reference point;
- per-track remembered offset.

### CR-OPP-077 Voice-activity sentence capture

Where local media is available, mining MAY capture sentence audio using voice activity around the selected cue.

Always keep manual trim/preview available.

### CR-OPP-078 Multi-line context capture

Allow adjacent transcript/dialogue lines to be intentionally combined into one mining context.

### CR-OPP-079 Media mining history

Keep a bounded history of recently seen cues/lines so the user can mine something shortly after it disappears.

### CR-OPP-080 Context image capture

Mining from media may include:
- current frame;
- cropped region;
- short animation/GIF where supported.

Capture must be explicit and respect platform/source restrictions.

## 9. Manga / OCR

### CR-OPP-090 On-demand page OCR

For user-owned or otherwise permitted images/pages, OCR a page at read time rather than requiring whole-volume preprocessing.

### CR-OPP-091 Region OCR

Allow the user to restrict OCR to:
- selected rectangle;
- speech-bubble region;
- current panel;
- configurable recurring screen area.

### CR-OPP-092 Pointer-follow lookup

When OCR overlay is enabled, a moving pointer/hover may reveal/select text beneath it without a separate mode switch.

Touch platforms need an equivalent explicit interaction.

### CR-OPP-093 OCR corrections

Allow users to correct:
- recognized text;
- reading order;
- text box geometry.

Original OCR remains recoverable.

### CR-OPP-094 OCR versions

Support alternate OCR results for one page/volume and switch without duplicating page identity or reading progress.

### CR-OPP-095 OCR improvement merge

When a higher-quality OCR version arrives, preserve user corrections when they can be mapped unambiguously; otherwise surface a conflict rather than silently discarding them.

### CR-OPP-096 Comic archive support

Consider local comic formats such as:
- CBZ/ZIP;
- other archive formats where licensing/platform support is acceptable;
- modern image formats.

Security limits for archive bombs/path traversal are mandatory.

### CR-OPP-097 Dual-page / webtoon layouts

Manga reader modes MAY include:
- single page;
- dual-page spread;
- right-to-left spread;
- continuous vertical/webtoon;
- fit width/height.

### CR-OPP-098 Panel/page zoom

Support precise zoom/pan with modality-aware controls:
- mouse wheel;
- trackpad;
- pinch;
- double tap;
- keyboard/controller.

### CR-OPP-099 Manga immersion statistics

Track manga reading independently using metrics appropriate to image/OCR content rather than pretending page OCR equals prose character counts.

## 10. Import and external sources

### CR-OPP-100 Web article / read-later import

Save a clean readable copy of a web article or user-selected page content for later study.

Requirements:
- preserve source URL/title;
- sanitize scripts/tracking;
- respect copyright/storage policy;
- imported copy is clearly distinct from live web page.

### CR-OPP-101 Web novel import

Support user-initiated import from compatible web-novel pages where terms/site policy allow.

The parser must fail safely when site markup changes.

### CR-OPP-102 External catalog connector

Allow optional connectors to user-authorized catalogs/libraries.

Examples of generic capability:
- remote book catalogs;
- personal media servers;
- read-later services;
- local desktop library managers.

The connector boundary must keep provider state distinct from logical book identity.

### CR-OPP-103 OPDS-like catalog browsing

Where useful, browse standard/open catalog feeds without adding a bespoke integration for every server.

### CR-OPP-104 Universal import inbox

Provide one place to add:
- books;
- plain text;
- article links;
- subtitles;
- audio;
- video;
- manga archives.

After import, content is routed to the relevant reader while preserving a shared learning identity/history where appropriate.

## 11. Context capture and flashcards

### CR-OPP-110 Context bundle

Represent mining context as a user-reviewable bundle:
- expression;
- reading;
- sentence;
- source title;
- source location/time;
- image;
- audio;
- optional translation;
- optional notes.

The bundle can be edited before export.

### CR-OPP-111 One-action mining

For users who configure a trusted template, allow one action to create/export a complete context bundle.

A preview/edit flow remains available.

### CR-OPP-112 Mining presets

Different content types may use different field mappings:
- novel;
- manga;
- video;
- podcast;
- web.

### CR-OPP-113 Capture crop

For image contexts, let the user crop before export.

### CR-OPP-114 Media privacy

Provide an option to omit sensitive images/audio from exported cards while retaining the text context.

## 12. Accessibility and comfort

### CR-OPP-120 Reading focus modes

Potential aids:
- line guide;
- dim surrounding text;
- reduced chrome;
- reduced motion;
- larger hit targets;
- high contrast.

### CR-OPP-121 Theme typography bundle

A theme MAY optionally include typography/layout settings, not only colors.

Users should choose whether theme activation changes typography.

### CR-OPP-122 Per-language font profiles

Let Japanese, Simplified Chinese, Traditional Chinese, Korean and Latin text choose independent preferred fonts/fallbacks.

### CR-OPP-123 Page overlap marker

For long pages/panning or screenful scrolling, a temporary marker can show how the new viewport overlaps the previous one.

### CR-OPP-124 External page-turn controls

Treat keyboard/controller/remote page-turn controls as accessibility/comfort inputs with user-remappable actions.

## 13. Privacy and durability

### CR-OPP-130 Local-first processing indicator

When OCR, transcription, dictionary, translation, TTS or AI features can run either locally or remotely, show where processing occurs.

### CR-OPP-131 Per-feature network permission

Allow network-backed learning helpers to be independently enabled rather than bundling all network behavior behind one switch.

### CR-OPP-132 Export/redaction preview

When exporting settings/backups/diagnostics, preview or automatically redact:
- API keys;
- auth tokens;
- private provider identifiers;
- private book content unless explicitly included.

### CR-OPP-133 Recovery center

Centralize:
- local backups;
- migration snapshots;
- failed imports;
- failed remote sync;
- orphaned placeholders;
- cache rebuild actions.

### CR-OPP-134 Portable data model

Where feasible, make user-created annotations, notes, reading state and settings exportable in documented formats so users are not trapped by one storage provider.

## 14. Candidate prioritization rubric

Evaluate an opportunity on:

1. immersion interruption reduced;
2. usefulness to existing Reader users;
3. overlap with current Manabi capabilities;
4. implementation complexity;
5. runtime/storage cost;
6. cross-platform feasibility;
7. privacy impact;
8. licensing/provenance risk;
9. long-term maintenance surface;
10. whether the feature creates a reusable platform primitive.

A feature with strong value but large new product scope should remain in this optional backlog rather than entering a current implementation PR by accident.

## 15. Cross-cutting candidates retained for possible separate exploration

These entries touch reusable target primitives and may be worth discussing separately **if the user explicitly selects them for further product-design investigation**. This section is not an approval list or priority ranking:

- CR-OPP-001 Chapter preflight
- CR-OPP-003 Adaptive furigana
- CR-OPP-010 Finish-date planner
- CR-OPP-020 Book map
- CR-OPP-030 Per-book reader presets
- CR-OPP-033 Reading ruler / line guide
- CR-OPP-034 Quote image
- CR-OPP-040 Continue dashboard
- CR-OPP-045 Relink missing books
- CR-OPP-051 Annotation export
- CR-OPP-061 Vocabulary browser
- CR-OPP-062 Encounter map
- CR-OPP-064 Mine from history
- CR-OPP-070 Sentence playback modes
- CR-OPP-071 Primed listening
- CR-OPP-074 Transcript list
- CR-OPP-090 On-demand page OCR
- CR-OPP-093 OCR corrections
- CR-OPP-100 Web article / read-later import
- CR-OPP-110 Context bundle
- CR-OPP-130 Local-first processing indicator
- CR-OPP-133 Recovery center

These are exploration candidates, not a ranking or commitment.


## 16. Second-wave learner workflow opportunities

### CR-OPP-135 Difficulty preview

Before opening imported material, estimate difficulty using transparent signals such as:
- known/unknown vocabulary ratio;
- kanji familiarity;
- sentence length;
- lexical frequency;
- grammar-density heuristics;
- text length.

Requirements:
- show the components behind the estimate;
- do not present one opaque number as objective truth;
- allow recalculation after the user's knowledge state changes;
- keep the estimate local where practical.

### CR-OPP-136 External knowledge-state import

Allow the user to seed Reader knowledge state from explicitly connected/imported sources.

Generic examples:
- kanji level list;
- known-vocabulary export;
- flashcard collection;
- user-supplied word list.

Requirements:
- source and import time are visible;
- import can be refreshed or removed;
- imported state remains distinguishable from Reader-inferred state;
- conflicts follow an explicit precedence policy.

### CR-OPP-137 Camera / photo OCR import

Support one-shot import of Japanese text from:
- printed books;
- physical manga;
- signs;
- screenshots;
- another device's screen.

Possible output modes:
- extracted clean text;
- page image plus selectable overlay;
- temporary lookup-only scan;
- saved library item.

Requirements:
- original image remains available when saved;
- OCR confidence/errors are editable or clearly fallible;
- processing location (local/remote) is disclosed;
- no silent upload when local mode is promised.

### CR-OPP-138 System share/import inbox

On supporting platforms, accept shared:
- selected text;
- webpage URL;
- image;
- PDF/document;
- subtitle/media file.

The receiving flow should preview what will be saved and route it to the appropriate content type.

### CR-OPP-139 Mobile lookup disambiguation

When a touch lands ambiguously near multiple possible token boundaries, provide a low-friction way to select the intended term.

Possible target-owned interactions:
- candidate chips;
- drag-to-expand;
- adjacent-term arrows;
- touch magnifier;
- second tap to change segmentation.

Requirements:
- avoid swallowing unrelated particles unless selected;
- preserve direct lookup speed for unambiguous taps;
- use touch-sized hit targets.

### CR-OPP-140 Explicit action feedback

Small one-tap actions such as:
- copy;
- save word;
- mark known;
- add bookmark;
- export card;
- download media

should give immediate, non-disruptive confirmation.

Feedback must not obscure reading text for long or steal keyboard focus unnecessarily.

### CR-OPP-141 Familiarity from reading behavior

Optionally infer vocabulary familiarity from behavior such as:
- repeated encounters without lookup;
- repeated successful review;
- manual known/learning changes;
- lookups after a period of apparent familiarity.

Requirements:
- inference rules are inspectable at a high level;
- user can override state;
- one accidental non-lookup does not mark a term known;
- inferred state is distinguishable from explicit user decisions.

### CR-OPP-142 Knowledge confidence

Represent familiarity as more than a binary flag when useful.

Possible states:
- unseen;
- encountered;
- learning;
- familiar;
- known;
- manually pinned.

A continuous confidence score MAY exist internally or visibly, but the user must not be forced to understand a complex score to use the reader.

### CR-OPP-143 Sample-content onboarding

A new user can explore core interactions immediately using a small bundled/project-owned sample instead of needing to import content first.

The sample should demonstrate:
- lookup;
- furigana controls;
- highlight/bookmark;
- appearance;
- optional mining.

It must be clearly removable and must not pollute real reading statistics by default.

### CR-OPP-144 Daily reading recommendation

If the user opts into planning, suggest a small next reading target based on:
- current queue;
- recent reading;
- stated goal;
- difficulty;
- time available.

This should guide, not lock the user into a curriculum.

### CR-OPP-145 Post-session mining queue

During reading/watch/listen sessions, allow lightweight marking of candidate words/sentences without interrupting flow.

After the session, present a review queue where the user can:
- discard;
- mark known;
- add to flashcards;
- merge duplicate contexts;
- choose the best source sentence/media.

### CR-OPP-146 Batch i+1 review

For users who want it, analyze a chapter/transcript after consumption and produce a bounded candidate list of terms that are:
- unfamiliar;
- high-value/frequent;
- contextually supported by mostly known surrounding text.

The system should not auto-create cards without explicit user policy.

### CR-OPP-147 Shadowing mode

For audio/video/podcast content, provide sentence-level shadowing controls:
- replay;
- adjustable delay before replay;
- hide/reveal transcript;
- optionally record the learner locally;
- compare timing or pitch only when a valid measurement pipeline exists.

Any pronunciation scoring must communicate uncertainty and avoid presenting a single noisy measurement as authoritative.

### CR-OPP-148 Dual-text reveal modes

For content with source plus translation/reference text, support:
- source only;
- both;
- translation blurred;
- translation hidden until tap;
- temporary reveal.

This can support reading or listening without making translation permanently dominant.

### CR-OPP-149 Difficulty-aware furigana baseline

Instead of selecting furigana only from a generic proficiency level, allow the baseline to combine:
- explicit user level;
- imported known kanji/vocabulary;
- Reader familiarity state.

User always retains a simple global override.

### CR-OPP-150 Vocabulary export without lock-in

Allow saved vocabulary/history to export in a simple documented format independently of any flashcard integration.

At minimum include:
- expression;
- reading if known;
- meaning/source dictionary reference where licensing permits;
- user status;
- optional source context;
- timestamps.

### CR-OPP-151 Source-specific privacy defaults

Content types can have different default capture policies.

For example:
- ordinary EPUB text may allow source sentence retention;
- private document may default to no cloud helper;
- camera OCR may default to local processing;
- streamed video may restrict screenshots/audio based on platform capability.

The user should see and be able to change applicable policies rather than discovering them after export.

### CR-OPP-152 Reading-flow friction telemetry — local only

Optionally compute private local metrics such as:
- lookups per 1,000 characters;
- lookup pause time;
- repeated lookup rate;
- pages/characters between interruptions.

Use them to help the user understand material difficulty or reading flow.

No analytics upload is implied; local computation is the default product opportunity.

### CR-OPP-153 Context quality chooser

When multiple possible mining contexts exist, allow the user to choose among:
- exact sentence;
- surrounding paragraph;
- adjacent subtitle lines;
- cleaner example sentence from an authorized source;
- manually edited context.

The chosen context must retain provenance so the user knows whether it came from the source material or a replacement example.

### CR-OPP-154 Reading-state interoperability

Expose a documented portable export/import for:
- current location;
- progress;
- bookmarks;
- highlights;
- notes;
- reading sessions/statistics where practical.

The goal is durable user ownership, not compatibility with any one external product.


## 17. Material selection and pre-learning opportunities

### CR-OPP-155 Personalized material difficulty

Estimate difficulty relative to the current user, not only as a global level.

Potential factors:
- vocabulary coverage;
- kanji coverage;
- grammar familiarity;
- sentence complexity;
- text density;
- user reading speed and lookup rate on similar material.

Present separate global/content difficulty and personalized difficulty when both exist.

### CR-OPP-156 Community difficulty metadata

Optionally display external/community difficulty information when available from an authorized source.

Requirements:
- label source and freshness;
- distinguish community-relative ratings from formal proficiency levels;
- never imply an approximate JLPT mapping is an official equivalence;
- external data failure does not block local reading.

### CR-OPP-157 Order-of-appearance vocabulary list

Generate a book/chapter vocabulary list ordered by first occurrence.

Allow alternate sort modes such as:
- first occurrence;
- frequency in this book;
- general corpus frequency;
- unknown-first;
- user status.

Selecting an entry SHOULD jump to or preview its first source occurrence when practical.

### CR-OPP-158 New-vocabulary delta

For a selected book, show only terms that are not already:
- known;
- learning;
- in another selected study deck/list;
- blacklisted/ignored.

This makes preparation cumulative across the user's library.

### CR-OPP-159 Next-material recommender

Recommend candidate books/media using explicit criteria such as:
- target vocabulary coverage;
- difficulty range;
- user interests/tags;
- current queue;
- expected new-word count;
- desired challenge level.

Recommendations must expose why an item was suggested.

### CR-OPP-160 Trouble-word pinboard

During reading, automatically or manually pin words that caused friction.

Possible signals:
- repeated lookup;
- multiple dictionary-sense changes;
- manual pin;
- lookup followed shortly by another lookup of the same term.

After the session, show a small reviewable list rather than forcing immediate mining.

### CR-OPP-161 Source-first i+1 examples

When choosing an example sentence for a target word, prefer source sentences the user actually encountered that are otherwise mostly understood.

Requirements:
- preserve source provenance;
- let the user choose a different example;
- do not rewrite source sentences to manufacture i+1 status without explicit labeling.

### CR-OPP-162 Cross-book vocabulary planning

When several queued books share unknown vocabulary, identify overlap so the user can prioritize high-leverage words that unlock multiple books.

This is a planning aid, not an automatic mandate to pre-study.

### CR-OPP-163 Preparation export

Allow pre-reading vocabulary/grammar candidates to export in a portable format without requiring use of a built-in SRS.

Export can include:
- source title/chapter;
- first occurrence;
- frequency;
- reading;
- user knowledge state;
- optional example sentence.

### CR-OPP-164 Reading readiness threshold

Let users define a personal threshold such as:
- “show books above 90% known vocabulary,”
- “show chapters with fewer than 20 new terms,”
- “show material one difficulty band above my recent average.”

Thresholds should remain user-facing filters, not claims that one number determines comprehension.


## 18. Contextual assistance and review opportunities

### CR-OPP-165 Scoped reading assistant

Offer an optional assistant whose scope is explicit:

- selected word or phrase;
- selected passage;
- current chapter/document;
- whole personal library.

Possible tasks:
- explain grammar;
- define a cultural/reference term;
- simplify an explanation;
- compare two passages;
- summarize what has been read;
- answer a question using source passages.

Requirements:
- answers cite or link back to the source passages used where possible;
- the UI clearly shows the active scope;
- library-wide mode cannot silently mix unrelated private sources;
- network/model use follows explicit privacy settings.

### CR-OPP-166 Permissioned assistant actions

If an assistant can change user data, separate read and write permissions.

Potential write actions:
- add/remove tags;
- create a note;
- save a highlight;
- edit local metadata;
- add an item to a reading queue.

Each action can be configured as:
- allowed;
- confirm each time;
- disabled.

The assistant must not mutate reading state merely because it answered a question.

### CR-OPP-167 User-defined reading actions

Allow reusable user-authored actions on a word, passage or document.

Examples:
- explain this grammar at my level;
- give two contrasting examples;
- identify names in this paragraph;
- produce a short chapter recap;
- extract unresolved questions;
- create a study note from this highlight.

Actions should be portable/exportable as plain configuration where possible and should declare whether they use local or network processing.

### CR-OPP-168 Highlight resurfacing

Optionally resurface saved highlights/notes after reading using a lightweight spaced-review flow.

This is distinct from vocabulary SRS.

Requirements:
- users can disable it;
- source book/location is always visible;
- deleting the review item does not delete the underlying highlight unless explicitly chosen;
- review scheduling is independent from reading statistics.

### CR-OPP-169 Scaffolding intensity control

Provide a simple session-level control for how much assistance is visible.

A target-owned design could vary some combination of:
- generated furigana;
- inline micro-glosses;
- translation reveal;
- grammar hints;
- learner-state color;
- audio prompts.

Requirements:
- each underlying assistance type remains independently configurable;
- the high-level control must not silently override permanent preferences;
- changing assistance intensity does not change source text or durable location.

### CR-OPP-170 Translation reveal density

For bilingual or translated content, allow the learner to choose how often translation is shown by default.

Possible policies:
- source only;
- translation only on request;
- selected sentences/panels translated;
- mixed/scaffolded mode;
- full parallel text.

The user can reveal the original/translation for any individual unit regardless of the default policy.

### CR-OPP-171 Post-reading comprehension check

After a chapter/session, optionally generate or present a small active-recall check.

Possible prompts:
- factual comprehension;
- who/what/where;
- sequence of events;
- meaning of a phrase in context;
- short summary.

Requirements:
- every answer can be traced to the source passage;
- generated questions are clearly identified as generated;
- this never blocks continuing the book;
- the user can disable automatic prompts entirely.

### CR-OPP-172 Layered annotation packs

Treat explanatory annotations as a separate layer from the book bytes.

Potential layers:
- personal notes;
- teacher/editor notes;
- grammar/culture explanations;
- shared study-group notes.

Requirements:
- each layer can be enabled/disabled;
- provenance is visible;
- annotations cannot silently rewrite source text;
- imported/shared packs have a version/identity independent of the book.

### CR-OPP-173 Feed subscriptions

Optional read-later subscriptions can bring recurring content into the library from explicitly subscribed feeds.

Examples:
- RSS/Atom;
- newsletters through an authorized connector;
- user-selected publication feeds.

Requirements:
- subscription content is clearly distinguishable from owned local books;
- unsubscribe stops future import without deleting prior saved items unless chosen;
- feed fetch failure cannot damage the main library.

### CR-OPP-174 Multi-page camera capture

Extend one-shot camera OCR into a batch flow for a physical chapter/article.

Possible workflow:
1. capture/import several photos;
2. reorder/retake;
3. deskew/crop;
4. OCR;
5. review uncertain text;
6. save as temporary study set or library item.

Original images remain available if the user saves the result.

### CR-OPP-175 Auto-detect OCR after page change

For a user-authorized live screen/camera OCR mode, optionally detect that the page has settled and refresh OCR automatically.

Requirements:
- repeated failures pause rather than retry forever;
- the user can stop auto-detect immediately;
- stale OCR from the prior page cannot overlay the new page;
- capture/privacy permissions remain explicit.

### CR-OPP-176 Source-linked daily review

Provide an optional daily review combining a bounded sample of:
- difficult highlights;
- pinned trouble words;
- saved source sentences;
- recent notes.

Every item links back to its original book/media location when still available.

This is a review surface over existing user data, not a duplicate copy of the library.

## 19. Target overlap guard

The following capabilities are already implemented, already specified, or have an established target-side data model in the current Reader repository. They must not be treated as greenfield competitive features merely because they also appear in this opportunity catalog.

### Already target-specified / existing

- reader-scoped search;
- bookmarks and resume state;
- highlights and passage notes;
- book-wide notes;
- return navigation / durable jump history foundation;
- scrubber/navigation foundation;
- Line Guide;
- reading statistics and reading goals;
- local-first annotation/account data;
- annotation export/import paths;
- local/provider library and folder organization;
- direct WebDAV support;
- snippets and stable source-selection capture;
- optional video/transcript learning stack;
- dictionary search with frequency/media presentation;
- reading progress/completion state.

### Opportunity entries that are extensions, not new primitives

- CR-OPP-013 expands existing goals into broader habit goals.
- CR-OPP-022 expands existing navigation/scrubbing into a richer skim surface.
- CR-OPP-026 expands existing jump/return concepts into explicit Back/Forward history.
- CR-OPP-033 overlaps the already-specified Line Guide; use the existing Line Guide contract rather than building a second feature.
- CR-OPP-035 overlaps existing book-wide notes; only additional UX should be considered.
- CR-OPP-051 extends existing annotation export with additional portable formats/fields.
- CR-OPP-052 extends existing annotation storage with optional connectors.
- CR-OPP-053 extends existing highlights into a later mining action.
- CR-OPP-070 through CR-OPP-080 should compose with the existing video/transcript/audio architecture rather than introduce a parallel media stack.
- CR-OPP-133 should orchestrate existing backup/recovery/sync surfaces rather than duplicate their underlying stores.

Before selecting any CR-OPP for implementation, the worker must inspect current target-owned architecture and determine whether the correct work is:
- no work;
- test coverage;
- UX exposure;
- extension of an existing primitive;
- or a genuinely new primitive.


## 20. Deep-reference and entity navigation opportunities

### CR-OPP-177 Character and entity index

Build a book-scoped reference view for recurring entities such as:
- characters;
- places;
- organizations;
- named events;
- user-pinned terms.

For each entity, optionally show:
- short user-authored/imported description;
- first occurrence;
- recent occurrence;
- all occurrence locations;
- aliases/readings;
- user notes.

Requirements:
- extracted/inferred entity identity is editable;
- generated descriptions are labeled;
- source occurrences link back to exact passages;
- no external biography/knowledge lookup is required for the basic local feature.

### CR-OPP-178 Vocabulary occurrence timeline

For a selected word/kanji, show where it has appeared across:
- the current chapter;
- current book;
- optionally the user's library.

Potential signals:
- first encounter;
- lookup events;
- saved/mined events;
- later unassisted encounters.

This can support familiarity decisions without automatically changing them.

### CR-OPP-179 User-facing reference anchors

Expose a stable human-shareable reference for a passage in addition to internal durable locators.

Possible forms:
- chapter + paragraph reference;
- resource + paragraph ordinal;
- target-owned opaque reference token.

Requirements:
- remains resolvable across ordinary reflow;
- clearly fails or degrades when the underlying edition/text changed too much;
- never exposes a private filesystem/provider path;
- copy/share is explicit.

### CR-OPP-180 Deep links to reading locations

Allow a target-owned link/reference to reopen a book at a saved location when the recipient/device has authorized access to the same logical book.

Potential uses:
- lesson notes;
- personal notes;
- study-group discussion;
- external knowledge-base links.

The link must not grant access to book bytes the recipient does not already have permission to read.

### CR-OPP-181 Progress-linked reading journal

Let users record freeform journal entries associated with:
- a point in the book;
- a progress percentage;
- a chapter;
- a reading session;
- the whole book.

Journal entries remain separate from passage highlights so the user can log reactions without selecting text.

### CR-OPP-182 Spoiler-aware shared discussion

If social/shared annotations are ever added, gate visibility by reading progress.

Possible policy:
- comments attached beyond the user's current position are hidden;
- user can explicitly reveal later discussion;
- current-position discussion is visible.

Shared discussion must be opt-in and must not upload private book content beyond what the user explicitly shares.

### CR-OPP-183 Semantic library search

Complement literal full-text search with optional concept-level retrieval across the user's library.

Requirements:
- every result cites the originating book and passage;
- literal search remains separately available;
- local embedding/indexing is preferred when feasible;
- remote semantic processing is explicit;
- deleting a book removes its semantic index without affecting other books.

## 21. Library lifecycle and physical-book bridge opportunities

### CR-OPP-184 Paused / did-not-finish state

Distinguish:
- actively reading;
- paused;
- finished;
- did not finish.

This is separate from deleting the book or resetting progress.

### CR-OPP-185 Physical-book catalog entry

Optionally let users add a metadata-only physical book via:
- ISBN/barcode scan;
- manual metadata.

A physical entry may link to camera OCR sessions/notes without pretending that full digital book bytes are available.

### CR-OPP-186 Reading report

Generate a private per-book or period report from existing data:
- time read;
- reading days;
- progress;
- speed trend;
- lookups;
- highlights/notes;
- difficult terms;
- completion date.

Reports should reflect existing statistics rather than inventing a second accounting system.


## 22. Promotion rules

A CR-OPP item can move out of DISCOVERY_ONLY only through an explicit approval recorded in `../CLEAN_ROOM_APPROVALS.md`.

Promotion is granular:

- approving one CR-OPP does not approve adjacent entries;
- approving design exploration does not approve tests;
- approving tests does not approve production implementation;
- approving implementation does not approve integration/merge;
- approving a feature for one platform/repository does not automatically approve another;
- approving an existing primitive's extension does not authorize replacing that primitive.

When a selected feature overlaps existing Reader architecture, the approved worker must first state which category applies:

1. already satisfied — no target change;
2. missing qualification — tests/evidence only if approved;
3. UX exposure of an existing primitive;
4. bounded extension of an existing primitive;
5. genuinely new primitive.

If the category itself is unclear, report that uncertainty before changing target code.

## 23. Non-goals for this backlog

This backlog does not authorize:

- implementing all 186 ideas;
- converging Manabi toward a competitor's aggregate feature set;
- recreating a competitor's workflow wholesale;
- replacing current target architecture because another product uses a different model;
- starting a feature because a future worker believes it is obvious, easy, or valuable;
- treating an observer-source update as a request to implement what was observed.

The branch remains research/specification material until per-feature approval says otherwise.


## 24. Shared-primitives dependency map

This section is informative only. It identifies likely target-owned primitives that multiple opportunities may reuse.

**It is not a bundle definition and does not create approval for any primitive or neighboring feature.** The minimal-shared-primitive rule in `../CLEAN_ROOM_APPROVALS.md` remains controlling.

### Knowledge-state primitive

Potential consumers:
- CR-OPP-001 Chapter preflight
- CR-OPP-002 Whole-book vocabulary forecast
- CR-OPP-003 Adaptive furigana
- CR-OPP-004 Learner-state text styling
- CR-OPP-005 Inline micro-glosses
- CR-OPP-012 Coverage projection
- CR-OPP-061 Vocabulary browser
- CR-OPP-062 Encounter map
- CR-OPP-135 Difficulty preview
- CR-OPP-136 External knowledge-state import
- CR-OPP-141 Familiarity from reading behavior
- CR-OPP-142 Knowledge confidence
- CR-OPP-149 Difficulty-aware furigana baseline
- CR-OPP-155 Personalized material difficulty
- CR-OPP-158 New-vocabulary delta
- CR-OPP-164 Reading readiness threshold
- CR-OPP-178 Vocabulary occurrence timeline

Approval of any one consumer authorizes only the minimum knowledge-state behavior required for that consumer.

### Semantic source-text primitive

Potential consumers:
- CR-OPP-006 Proper-name assistance
- CR-OPP-007 Context-ranked dictionary sense
- CR-OPP-008 Grammar overlay
- CR-OPP-053 Highlight-to-card
- CR-OPP-063 Source-linked lookup history
- CR-OPP-065 Update existing card
- CR-OPP-153 Context quality chooser
- CR-OPP-157 Order-of-appearance vocabulary list
- CR-OPP-161 Source-first i+1 examples
- CR-OPP-165 Scoped reading assistant
- CR-OPP-171 Post-reading comprehension check
- CR-OPP-177 Character/entity index
- CR-OPP-178 Vocabulary occurrence timeline
- CR-OPP-183 Semantic library search

This should reuse existing durable text/location infrastructure where possible rather than creating a second competing text model.

### Durable-location / navigation primitive

Potential consumers:
- CR-OPP-020 Book map
- CR-OPP-021 Page/section browser
- CR-OPP-022 Rich skim sheet
- CR-OPP-026 Navigation history
- CR-OPP-053 Highlight-to-card
- CR-OPP-062 Encounter map
- CR-OPP-063 Source-linked lookup history
- CR-OPP-168 Highlight resurfacing
- CR-OPP-176 Source-linked daily review
- CR-OPP-177 Character/entity index
- CR-OPP-179 User-facing reference anchors
- CR-OPP-180 Deep links to reading locations
- CR-OPP-181 Progress-linked reading journal

Existing Reader locator/navigation architecture should be evaluated first.

### Context-bundle / mining primitive

Potential consumers:
- CR-OPP-053 Highlight-to-card
- CR-OPP-064 Mine from history
- CR-OPP-065 Update existing card
- CR-OPP-067 Idempotent media reuse
- CR-OPP-077 Voice-activity sentence capture
- CR-OPP-078 Multi-line context capture
- CR-OPP-079 Media mining history
- CR-OPP-080 Context image capture
- CR-OPP-110 Context bundle
- CR-OPP-111 One-action mining
- CR-OPP-112 Mining presets
- CR-OPP-113 Capture crop
- CR-OPP-114 Media privacy
- CR-OPP-145 Post-session mining queue
- CR-OPP-146 Batch i+1 review
- CR-OPP-153 Context quality chooser

Approval of one mining workflow does not authorize a universal mining subsystem rewrite unless separately approved.

### OCR document primitive

Potential consumers:
- CR-OPP-090 On-demand page OCR
- CR-OPP-091 Region OCR
- CR-OPP-092 Pointer-follow lookup
- CR-OPP-093 OCR corrections
- CR-OPP-094 OCR versions
- CR-OPP-095 OCR improvement merge
- CR-OPP-137 Camera/photo OCR import
- CR-OPP-174 Multi-page camera capture
- CR-OPP-175 Auto-detect OCR after page change
- CR-OPP-185 Physical-book catalog entry

A read-only OCR approval does not authorize editable/versioned OCR.

### Timed-media / transcript primitive

Potential consumers:
- CR-OPP-070 Sentence playback modes
- CR-OPP-071 Primed listening
- CR-OPP-072 Condensed playback
- CR-OPP-073 Track targeting
- CR-OPP-074 Transcript list
- CR-OPP-075 Transcript discovery
- CR-OPP-076 Subtitle timing alignment
- CR-OPP-077 Voice-activity sentence capture
- CR-OPP-078 Multi-line context capture
- CR-OPP-079 Media mining history
- CR-OPP-147 Shadowing mode
- CR-OPP-148 Dual-text reveal modes

These should compose with existing target media/transcript architecture when present.

### Library metadata / lifecycle primitive

Potential consumers:
- CR-OPP-010 Finish-date planner
- CR-OPP-011 Reading queue
- CR-OPP-013 Habit goals
- CR-OPP-014 Time remaining
- CR-OPP-040 Continue dashboard
- CR-OPP-041 Rich book details
- CR-OPP-042 Include/exclude filters
- CR-OPP-043 Saved library views
- CR-OPP-047 Favourites and collections
- CR-OPP-048 External tracking
- CR-OPP-049 Local/remote placeholders
- CR-OPP-144 Daily reading recommendation
- CR-OPP-159 Next-material recommender
- CR-OPP-181 Progress-linked reading journal
- CR-OPP-184 Paused / did-not-finish state
- CR-OPP-185 Physical-book catalog entry
- CR-OPP-186 Reading report

Adding one lifecycle field must not silently require redesigning the entire library model.

### Ingestion / source-link primitive

Potential consumers:
- CR-OPP-044 Watched folders
- CR-OPP-045 Relink missing books
- CR-OPP-049 Local/remote placeholders
- CR-OPP-100 Web article/read-later import
- CR-OPP-101 Web novel import
- CR-OPP-102 External catalog connector
- CR-OPP-103 Catalog feed browsing
- CR-OPP-104 Universal import inbox
- CR-OPP-137 Camera/photo OCR import
- CR-OPP-138 System share/import inbox
- CR-OPP-173 Feed subscriptions
- CR-OPP-174 Multi-page camera capture
- CR-OPP-185 Physical-book catalog entry

Each source type retains explicit provenance and capability; generic ingestion must not collapse logical identity into provider path.

### Assistance / model boundary primitive

Potential consumers:
- CR-OPP-006 Proper-name assistance
- CR-OPP-007 Context-ranked dictionary sense
- CR-OPP-008 Grammar overlay
- CR-OPP-165 Scoped reading assistant
- CR-OPP-166 Permissioned assistant actions
- CR-OPP-167 User-defined reading actions
- CR-OPP-171 Post-reading comprehension check
- CR-OPP-183 Semantic library search

Read-only retrieval, generative explanation, and write-capable actions are distinct approval surfaces.

### Presentation / scaffolding primitive

Potential consumers:
- CR-OPP-003 Adaptive furigana
- CR-OPP-004 Learner-state text styling
- CR-OPP-005 Inline micro-glosses
- CR-OPP-008 Grammar overlay
- CR-OPP-030 Per-book reader presets
- CR-OPP-031 Named global presets
- CR-OPP-032 Sentence/block reading mode
- CR-OPP-033 Reading ruler / line guide
- CR-OPP-121 Theme typography bundle
- CR-OPP-122 Per-language font profiles
- CR-OPP-149 Difficulty-aware furigana baseline
- CR-OPP-169 Scaffolding intensity control
- CR-OPP-170 Translation reveal density

A high-level scaffolding control should compose existing presentation features rather than create duplicate settings authorities.

## 25. Approval dependency rule

When an approved opportunity has a dependency on another CR-OPP:

- the dependency does not become approved automatically;
- if the approved feature can be delivered with a narrow internal primitive that exposes no dependent user-facing feature, the minimal-shared-primitive rule may permit that internal work;
- if delivery requires the dependent opportunity's user-visible behavior, separate approval is required;
- if the dependency changes privacy, durable data, migration, platform reach, or external integrations, treat it as material and require explicit approval unless already included in the original bounded scope.

Before implementation, record dependencies in the per-feature scope packet as:

- `required internal primitive`;
- `existing target primitive`;
- `approved dependent feature`;
- or `unapproved dependency / blocker`.

Do not convert an unapproved dependency into a broad prerequisite project.
