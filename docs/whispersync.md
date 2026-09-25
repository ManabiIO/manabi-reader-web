# Built-in audiobook playback (ttu-whispersync adaptation)

## Provenance and licensing

The requested source is **[4890A/ttu-whispersync](https://github.com/4890A/ttu-whispersync)**.
Its original upstream is **[Renji-XD/ttu-whispersync](https://github.com/Renji-XD/ttu-whispersync)**.
Both `main` branches resolved to `dfc05f814e2c6edb30f07040418fd1d78bbf5b4d` when inspected
on September 20, 2026. GitHub's cross-fork comparison reported identical heads, zero
commits ahead/behind and no changed files. No separate fork-specific changes are claimed.

`apps/web/src/lib/features/whispersync/upstream.ts` copies/adapts the n-gram
similarity function from `src/components/Match.svelte` and the ruby-exclusion/time
helpers from `src/lib/util.ts`, at the pinned commit above. It retains the MIT
copyright notice. The matching workflow is adapted into a new, non-destructive
DOM index and range-based reader adapter; playback, validation, persistence and
Svelte UI are new Manabi integration code. This is a focused native adaptation,
**not a wholesale copy of every upstream component**.

The full original notice is shipped at
[`apps/web/static/licenses/ttu-whispersync.txt`](../apps/web/static/licenses/ttu-whispersync.txt).
Visible credits and that license are linked inside the Audiobook drawer. The
original copyright is `Copyright (c) 2024 Renji-xD`. These adaptation modules are
MIT-licensed; this does not change the repository's overall license.

Yatsu's [Whispersync documentation](https://docs.yatsu.moe/ttu-whispersync/) was
reviewed for workflow context. At inspection it described an external userscript,
not a built-in implementation. No Yatsu source code was copied. Manabi does not
need to install a userscript or create another GitHub fork.

## Reader workflow

Open a book and select **Audiobook** in its footer. The feature is lazy-loaded on
first use. Select a local audio file and an SRT or WebVTT subtitle file. UTF-8 text
files containing those formats are also accepted for file pickers that filter
subtitle extensions. Subtitles must be at most 5 MiB, contain at most 50,000 cues,
and have no individual cue longer than 8,192 UTF-16 units.

Audio uses the browser's media element. The supported codec/container combinations
are those of the user's browser; the file extension alone is not a guarantee.
The app does not transcode, decode entire audiobook files into JavaScript memory,
record system audio, fetch media from websites or upload selected files.

Use the native media controls, rate control (0.5–3×), previous/next/replay cue and
cue loop controls. Selecting a transcript cue starts it; a separate “Show in book”
action navigates without requiring audio to be loaded. Transcript rendering is
paged in batches of 30 instead of creating tens of thousands of buttons.

**Match book** matches subtitles against the complete stored book source, parsed into an
inert template rather than mounted in the live page. Paginated chapters do not have
to be currently rendered to receive a match. For a chapter-only
recording, select the chapter's starting text before opening the drawer to provide
a start hint. Default matching is normalized exact matching. Approximate matching
is optional, bounded, and labeled as approximate. Match counts remain visible;
unmatched cues are not assigned fabricated locations and still play normally.

**Follow matched text while playing** is opt-in. The reader's existing table-of-contents chapter action reveals an off-screen chapter,
then `BookmarkManager.formatBookmarkDataByRange` and `scrollToBookmark` locate a
fresh, validated range after the reader reports render readiness. Direct scroll
offsets and the legacy userscript's experimental event protocol are not used. Following stops the reader's
independent auto-scroller and is suspended while the drawer is open. Explicit
“Show in book” closes the drawer before navigation. New requests cancel older
render waits; a five-second readiness timeout reports an error instead of applying
a stale range. Navigation also waits while the reader or its ancestor is hidden,
aria-hidden or inert. Cue gaps, unmatched successor cues, Pause and newer navigation
requests cancel superseded automatic work; redrawing the same cue does not cancel
a chapter transition. Explicit Show in book remains independent of playback.
Canceled promise continuations cannot publish stale highlights or errors. A false
result from the paginated bookmark manager is reported as navigation failure.
It does not itself save a bookmark; existing automatic
bookmark/tracker behavior is still owned by the reader.

Positive subtitle delay means `audio time = subtitle time + delay`.
Delay is limited to ±3,600 seconds. Changing delay or selecting another cue cancels
an active cue loop. Native seeking outside the loop also cancels it. Media events
and animation frames enforce loops; browser throttling and decoder seeking mean
loops are not promised to be sample-accurate.

The compact player persists when the drawer closes. Closing audio playback stops
it while retaining its last checkpoint. Leaving/changing the book disposes the
player, listeners, animation frame and object URL. A late load/play event from the
old media element cannot update the new one.

## Book integrity and layout

The matcher never writes `elementHtml`, inserts matching spans, calls
`Range.surroundContents`, splits book text nodes or reloads the page. It indexes
text nodes, excludes ruby pronunciation/fallback and hidden/metadata subtrees,
and maps normalized grapheme clusters back to their original UTF-16 boundaries.
Inline emphasis, supplementary characters, combining kana and width normalization
are retained in the original DOM.

Inline highlighting uses one owned CSS Custom Highlight (`manabi-whispersync`).
It does not repurpose the user's selection. Without that API, transcript playback
and matched-text navigation remain available, with an explanatory message. Without
`Intl.Segmenter`, matching reports an error but playback remains available.

Whole-book source locations survive ordinary chapter virtualization and view-mode
changes. Live ranges are short-lived: the adapter maps unique source IDs and
comment-insensitive child paths into the rendered chapter, verifies the original
endpoint text and the full readable range, and respects `aria-busy`. Inserted,
changed, hidden, or duplicated content cannot silently redirect a match. Changes
to the stored book HTML require matching again. Extensions that restructure text
may prevent a live range from resolving, without modifying the stored book.

Cross-chapter navigation requires a stable section/descendant ID. Books lacking
usable IDs can still resolve root-relative locations in continuous reading mode;
an unavailable virtualized location produces a visible explanation. A single cue
spanning two virtualized chapters cannot be highlighted as one DOM range; do not
interpret its source match as a guarantee of a rendered highlight.

Matching limits are 32 million source-markup units before parsing, 8 million raw
readable UTF-16 units, 4 million normalized units, 100,000 visited nodes and 8,192
units per grapheme. Approximate matching considers a bounded forward window and
rejects near-tied distant candidates. Similarity scores of 1 are not sufficient
to label an approximate candidate exact; provenance is tracked explicitly.

A starting selection must contain readable text and have both endpoints inside the
current book. Image-only, hidden-only, collapsed and out-of-book selections cannot
silently anchor to following text. Source ID mutations invalidate cached locations.
Repeated blank or whitespace-only separators are accepted in SRT/VTT files without
losing cue identifiers or multiline payloads.

## Persistence and privacy

The optional IndexedDB database is named `manabi-whispersync-v1`, version 1, with
one `sessions` object store. It is separate from the TTU/Manabi book database;
this feature does not open, migrate or modify the book DB directly.

Records are keyed by the JSON pair `[bookId, bookTitle]` and contain validated
subtitle source/name, local audio file metadata, playback position/rate, subtitle
delay and matching/follow preferences. They contain no audio bytes, object URLs,
filesystem handles, credentials or remote URLs. Existing book IDs/titles are local
identity, not portable cloud identity. Reimporting with the same ID/title could
reuse a record; “Remove saved audiobook data” resets that record explicitly.

The local audio file must be selected again after reopening. Resume matching uses
name, byte size and last-modified timestamp; it is intentionally **not a content
hash**, so unrelated files with identical metadata cannot be distinguished.
Files with different metadata start at zero. Resume is applied after metadata
loads and is clamped to the decoded duration. Opening the drawer before selecting
a file must not erase a previous checkpoint.

The session coordinator updates its in-memory checkpoint synchronously, independently
of storage acknowledgments. Writes are serialized and snapshots copied before
queuing, with at most one in-flight and one latest pending snapshot. A failed
restore, invalid saved subtitle file or failed reset disables subsequent writes to
protect the unread record; playback can continue in memory. Reopening retries
restore, while explicit successful removal establishes a new writable session. Playback checkpoints
are throttled to roughly five seconds, with additional writes on pause/seek/rate
changes and best-effort page-hide/unmount flushes. Browser termination may lose the
last few seconds. Storage errors are visible and do not stop audio playback.
Removing data drops superseded pending snapshots and waits for the in-flight write
before committing a reset. Old completions cannot repopulate the panel state.

Each stored record now has a random `storageRevision`. Save reads, compares and
replaces the record inside one IndexedDB readwrite transaction. A session restored
before another tab's commit cannot overwrite that newer revision. A direct write
also cannot replace an existing record it has never restored. Legacy v1 payloads
are accepted on read and gain a revision when next saved; no DB version bump is
needed. A failed commit does not advance the writer's acknowledged revision.

Explicit removal erases the caption/settings/audio-metadata payload but retains a
minimal `{ storageRevision, tombstone: true }` marker under the same book key.
That marker prevents an older tab from treating removal as an empty database and
restoring deleted captions. It is not a full deletion of the key: the existing
book ID/title key and opaque revision remain until site data is cleared. Reset can
also recover corrupt records when explicitly requested.

A conflict blocks further autosaves from that coordinator and rejects already
coalesced pending writes. Audio continues in memory; reopen after closing competing
tabs to restore the current version, or explicitly reset to discard saved data.
There is no automatic merging, live cross-tab synchronization or cross-device
synchronization. Protection applies to clients implementing this revision protocol;
an older client that writes without it cannot be controlled by this adapter.
Storage and follow errors also surface in the compact audio player while the drawer
is closed, with a View details action. The actual-application acceptance suite
exercises this path with and without an audio file loaded.

This record is **not included in TTU/Drive/cloud replication or regular book export**.
Keep the original subtitle file. Deleting a book elsewhere does not automatically
remove this separate record; use the drawer's explicit remove action before deleting
or clear site data. No cross-device sync is claimed.

## Scope and intentionally unported upstream subsystems

Included: local playback, SRT/VTT parsing, text matching, highlighting, follow,
cue navigation/replay/loop, delay/rate, per-book browser persistence, native reader
UI, cancellation and cleanup, visible upstream attribution.

Not included: AnkiConnect note creation/update, audio clip export/FFmpeg or recorder
backends, subtitle editing/merge/bookmark/bulk export, embedded audiobook chapter
metadata, filesystem-handle auto-reopen, multi-file audio playlists, userscript DB
migration, dictionary-popup detection/automatic audio pause, global hotkeys or
cross-device synchronization. Users can pause audio using the persistent player
while looking up words. Do not install the legacy userscript over this built-in
player; duplicate playback/controls are not a supported mode.

## Architecture map

- `audiobook-launcher.svelte`: footer entry, first-use dynamic import and load-error retry.
- `audiobook-panel.svelte`: reader-owned lifetime, native Sheet, media host, captions,
  match requests, navigation adapter and persistence checkpoints.
- `player.ts`: one owned media element per file, guarded event/play completions,
  local object URL lifetime, seek/rate/loop controls.
- `subtitles.ts`: validated plain-text SRT/VTT parser and overlap-aware cue timeline.
- `matcher.ts`: grapheme-safe live/inert source indexes, bounded matching, selection
  offset mapping, mutation fencing and owned CSS highlight.
- `reader-source.ts`: stable whole-book coordinates, live range verification,
  virtualized-chapter readiness and cancellable navigation.
- `navigation.ts`: async UI-result ownership, automatic/manual navigation intent,
  cue-transition cancellation and the reader bookmark-result adapter.
- `session.ts`: checkpoint ownership, failed-restore/reset/conflict write fencing,
  coalesced persistence and close-time draining.
- `upstream.ts`: explicitly attributed copied/adapted upstream algorithms.
- `persistence.ts`: validated isolated storage, atomic per-key revision comparison,
  reset markers and checkpoint capture.
- `test/whispersync/`: isolated core and real-browser DOM/media/storage suites.
- `test/whispersync/idb-test-double.cjs`: deterministic transaction-boundary double
  for unit tests only; not a native IndexedDB implementation or engine test.
- `tests/browser/test_whispersync.py`: thirteen acceptance tests against the built
  Svelte app: paginated/continuous and horizontal/vertical chapter navigation,
  restore/reset, corrupt-data recovery, subtitle/media error handling, mobile
  dialog semantics, selection retention and real two-tab reset/conflict scenarios,
  using an imported generated EPUB and local generated WAV.
- `.github/workflows/manabi-reader-ci.yml`: hooks for all those checks.
- `docs/whispersync-review.md`: review findings, precise validation receipts and
  remaining release gates for this revision.

## Validation commands and required merge qualification

With the repository's dependencies installed:

```sh
pnpm --dir apps/web exec svelte-kit sync
node test/whispersync/run.mjs --coverage --svelte --browser-bundle=test-results/whispersync-bundle.js
pnpm test:reader
pnpm --dir apps/web check
BASE_PATH=/reader-web pnpm build
python test/whispersync/browser.py test-results/whispersync-bundle.js
python tests/browser/test_whispersync.py
```

The app-local check command invokes `svelte-check --tsconfig ./tsconfig.json`, as
verified in the target package manifest. The standalone runner strictly typechecks the
core modules and runs Node tests. `--coverage` prints Node's source-mapped core
line, branch and function coverage; it does not include the separate browser or
Svelte application suites. CI enforces floors of 75% lines, 85% branches and
85% functions for this core report. `--svelte` additionally invokes the installed
Svelte compiler for both new components; it is not a replacement for Svelte type
checking or the full application build.

The browser harness uses Python Playwright (not a new application
runtime dependency). It generates its own silent WAV and never uses a real book
or copyrighted audio fixture:

```sh
node test/whispersync/run.mjs --browser-bundle=/tmp/ws-browser/bundle.js
python test/whispersync/browser.py /tmp/ws-browser/bundle.js --browser chromium
# Cross-engine qualification: --browser firefox or --browser webkit
# Optional diagnostics: --autoplay-policy allow (normal is the default)
```

`--offline-dom` uses `about:blank` without HTTP navigation and skips eight
origin-dependent IndexedDB tests. Each skip is recorded by name and reason, separate
from passed/executed totals. Do not count those as passed. Its media test uses
the selected engine's normal autoplay policy by default. `--autoplay-policy allow`
is available for isolating controller behavior from user-gesture policy; it does
not qualify autoplay in a normal browser.

Automated qualification now covers horizontal/vertical × paginated/continuous
reading, drawer Escape/focus behavior, reload/resume, corrupt-data recovery,
subtitle/media rejection, stale-tab deletion conflicts, native IndexedDB, and the
standalone DOM/media/storage suite in Chromium, Firefox and WebKit. The actual app
suite passes in Chromium and WebKit. Firefox's reader EPUB import did not complete
in the actual-app harness, before Whispersync mounted, so that path remains
unqualified. Physical Safari/iOS devices, mobile safe areas,
operating-system background playback, long recordings and the full native codec
matrix still require device qualification. Dark/light visual review, offline lazy
chunk loading, denied/full browser storage, slow file replacement, changing books
while matching and third-party dictionary extension interaction remain explicit
manual release checks rather than automated pass claims.
