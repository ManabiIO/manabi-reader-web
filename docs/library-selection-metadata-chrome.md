# Library selection, metadata and reader controls

## Interaction contract

The shelf has one selection model in Grid and List. Command-click on macOS, or
Control-click elsewhere, toggles individual tiles. Shift-click extends a stable
anchor range in the current visual order; subsequent Shift choices can contract
that range. Independent earlier modifier selections remain selected. A plain
click in Select mode replaces the selection. Modified clicks outside Select mode
enter it without opening or downloading a book.

Mouse dragging from empty shelf space previews a rectangle and commits on release.
It enters Select mode only if something is selected. Shift adds; Command/Control
toggles against the original gesture baseline. Escape, pointer cancellation, lost
capture, account/destination changes and unmount clean up the gesture. Touch scrolls
normally. Starting a drag on a book is not a marquee gesture. Edge dragging scrolls
the document. No browser-wide file-drag behavior is installed.

Once selecting, arrows use the actual responsive tile geometry; Shift extends,
Command/Control moves focus independently, Space toggles, Home/End move to the
ends, and Command/Control-A selects visible eligible books. Escape exits selection.
Menu entry hands keyboard focus to the shelf. Inputs, IME composition and modal
controls retain their native keys. The toolbar's **Select All Visible** includes
books represented by the visible series tiles, not other destinations or filtered
out books. It is not limited to the current viewport's pixels.

Selection includes saved books and unopened connected previews. Selecting a preview
never imports it. Organization commands verify source identity when saving; deletion
and export remain limited to saved browser copies. Preview-only selection can be
entered from the menu, modified clicks, keyboard, or the marquee.

## Organization and metadata

Selected-book Actions offers new/existing collections, new/existing personal series,
Blur/Unblur Covers and deletion. Collection membership is additive, with mixed state
shown explicitly. Batch edits commit in one IndexedDB transaction; failed validation
aborts the batch. Deletion confirms a captured selection and rechecks its account,
source and destination before starting. Original connected files are not deleted by
removing browser copies. Existing source-folder series tools remain separate.

Personal series are presentation groups and do not move files. Individual metadata
can assign a fractional volume number. Volume order is retained in a personal series,
and re-adding books to the same series does not erase their individual numbers.

**Edit Metadata** edits title, ordered authors and optional sort names, language,
publisher, publication date text, tags, description, series/volume and cover blur.
Rename remains available. Metadata is a private draft until Save; stale cross-tab
edits are rejected rather than overwriting newer metadata. Empty author/tag values
are meaningful edits. Text is bounded and validated; description markup is plain
text, not injected HTML. Imported author metadata already existed; additional EPUB
Dublin Core fields now travel through book storage and the existing export/restore
paths. Old imports are not silently re-read or rewritten to populate missing fields.

These are Library metadata edits, not in-place rewrites of an EPUB archive. The
original book data, content hash, reading locations, notes and statistics remain
unchanged. The cover uses a strong 20px display blur, including series stacks,
Continue and Finished. Original cover bytes remain intact. This is visual spoiler
hiding, not encryption or a security boundary.

The presentation contract extends the existing content-keyed organization object
with optional `metadata`, `series` and `coverBlur` fields. Local-only numeric book
references remain local until content identity is verified. The client requests the
additive `book_presentation_version=1` capability on preference GET/PUT and trusts
only an explicit version-1 reply. With an older server, ordinary settings and
collections continue syncing; the new fields remain local and the status says so.
They are automatically offered when the server advertises support. Unknown-field
omission by older clients cannot erase them; false, null, and empty metadata are
explicit resets. This is not a promise that older clients display new fields.

The backend companion must admit bounded fields, advertise the capability only to
requesting clients, project replies for legacy clients, and preserve unknown fields
in legacy writes while retaining revision/If-Match checks. Composed live-backend
qualification remains separate from the browser fixture and pure model tests.

## Reading controls

`ReaderChrome` owns hidden, transient and pinned states. Initial/mouse reveal uses a
3-second idle timer. An explicit content click/tap, keyboard reveal or control
interaction pins the controls; later mouse movement cannot re-arm its timer.
Another content tap/click or explicit Hide hides them; intentional page navigation
can also hide them. Text selection, swipes, links, controls, dialogs and menu gestures
must not become blank-page toggles. Focused/hovered controls and active reader panels
protect transient controls. Timers are fenced and cancelled on book replacement and
unmount. Hiding chrome does not change reading-frame padding or reflow the book.

The toolbar has an actual Enter/Exit Fullscreen button when the browser advertises
that capability. It requests the document root so portalled menus remain usable,
tracks browser fullscreen-change events and handles rejected requests. Only a
fullscreen session entered by this reader is exited on departure. A shared request
identity prevents a delayed, disposed reader from exiting a successor's session.
Browser exits revoke that identity even before the entry promise settles. An
already dispatched platform exit cannot be cancelled; cleanup never dispatches one
for another request's ownership. There is no fake fullscreen toggle on unsupported
browsers, and any active native fullscreen is correctly labelled Exit.

Reviewed native behavior: `aehlke/manabi-reader` v3-hotfix's pinned ManabiReaderCore
`cb0a57d8f57767bff805e470b166b8b76c6291c9` visibility bridge and LakeOfFire
`10fdf15c8ce4550b4e7900830843c1c8f2ac9f98` EPUB navigation scripts. These informed
explicit reveal versus page-motion handling, gesture thresholds and lifetime cleanup.
The 3-second web delay is an implementation choice, **not a verified copy of the
native app's exact timeout**. No proprietary implementation or Apple assets are copied.

Platform references: W3C APG Grid pattern (keyboard selection), W3C Fullscreen
standard, and EPUB 3.3 Dublin Core metadata. Native fullscreen is capability/user-activation dependent;
desktop WebKit automation does not qualify physical iPhone Safari.

## Verification

Baseline: main at `0d24f182bb772ffcdbf7261ee5b9c7a2755e5a0b`, tree
`6ec127aa1388911877ebf4729417cf5c0c3ebcc5`. The recovered patch was first
verified against PR #69 and then applied cleanly to this exact main tree. It retains
the newer Foliate input, database-schema, dropped-file and XML-attribute repairs
as well as source-hash admission, durable account ownership and book-opening lifetimes.
No main merge or deployment is part of this change.

Unit tests cover range contraction, string identities for unopened previews,
visible ordering, group tiles, modifier/marquee baselines, responsive arrow geometry,
Unicode/metadata bounds, compatibility projections and explicit resets, pinned
timers, stale callbacks and disposal. The read-only `Library selection and reader
chrome` workflow builds the actual app and runs native-IndexedDB browser acceptance
in Chromium and WebKit. It covers metadata import/edit/reload, cross-tab conflicts,
batch organization, preview selection, real timers, fullscreen and legacy-server
fallback/upgrade. Provider and preference HTTP fixtures are explicitly synthetic;
the actual application, DOM, parser, storage and browser gestures execute unchanged.

The local production build, type check and unit tests are recorded with delivery.
Local Chromium refused localhost with `ERR_BLOCKED_BY_ADMINISTRATOR`; no browser
policy was altered and no local browser pass is claimed. Exact-head CI results,
not earlier branch checks, determine browser qualification. Physical-device Safari
acceptance and a composed backend run are not implied by desktop automation.
