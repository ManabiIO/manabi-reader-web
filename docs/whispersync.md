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

**Match book** matches subtitles against displayed book text. For a chapter-only
recording, select the chapter's starting text before opening the drawer to provide
a start hint. Default matching is normalized exact matching. Approximate matching
is optional, bounded, and labeled as approximate. Match counts remain visible;
unmatched cues are not assigned fabricated locations and still play normally.

**Follow matched text while playing** is opt-in. The reader's existing
`BookmarkManager.formatBookmarkDataByRange` and `scrollToBookmark` APIs are used
for navigation, rather than direct scroll offsets. Following stops the reader's
independent auto-scroller. It does not itself save a bookmark; existing automatic
bookmark/tracker behavior is still owned by the reader.

Positive subtitle delay means `audio time = subtitle time + delay`.
Delay is limited to ±3,600 seconds. Changing delay or selecting another cue cancels
an active cue loop. Native seeking outside the loop also cancels it. Media events
and animation frames enforce loops; browser throttling and decoder seeking mean
loops are not promised to be sample-accurate.

The compact player persists when the drawer closes. Closing audio playback stops
it while retaining its last checkpoint. Leaving/changing the book disposes the
player, listeners, animation frame and object URL. A late load/play event from the
old media element cannot update the new one. Overlapping play attempts on the same
element are fenced too, including a deliberate pause before a play promise rejects.
The route pairs book identity with completed HTML and unmounts the player when the
requested book ID changes, even while the next book is still loading.

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

Changing the view mode or replacing the rendered HTML cancels work and clears old
ranges. The drawer asks the user to match again rather than applying stale offsets.
Normal font/pagination reflows that retain the same text nodes do not require
rewriting book content. Extensions that replace text nodes invalidate matches. A scoped MutationObserver
and synchronous pending-record checks also catch interior edits, insertions,
reordering and authored hidden-state changes. Modal aria-hidden ancestors outside
the book do not exclude its narration. Index disposal disconnects its observer.
Matching caps source text at 8 million UTF-16 units, normalized text at 4 million
and visited nodes at 200,000; oversized books fail without changing their content.

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
and a finite decoded duration become available, then is clamped to that duration.
Unknown duration or an initially rejected seek retains the pending checkpoint. Opening the drawer before selecting
a file must not erase a previous checkpoint.

Reads, writes and removals are serialized and snapshots are copied before queuing.
The current in-memory checkpoint is captured before awaiting storage; old write
acknowledgements never replace it. An untouched panel does not write a new record
on close, including when its initial read failed. The indexedDB getter is accessed
lazily; denied, blocked and timed-out opens are reported without disabling playback. Playback checkpoints
are throttled to roughly five seconds, with immediate writes on pause and explicit setting changes and best-effort page-hide/unmount flushes. Browser termination may lose the
last few seconds. Storage errors are visible and do not stop audio playback.
Removing data queues deletion after pending writes; old completions are fenced
from repopulating the panel state. Other tabs are independent writers: there is
no cross-tab conflict resolution, so avoid simultaneous sessions for the same book.

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
- `matcher.ts`: non-destructive DOM index, offset mapping, bounded/cancellable matcher,
  selection start hint and owned CSS highlight.
- `upstream.ts`: explicitly attributed copied/adapted upstream algorithms.
- `persistence.ts`: validated, isolated, serialized session storage and checkpoint capture.
- `test/whispersync/`: core/controller tests, component-script orchestration tests,
  deterministic storage-queue tests, and a real-browser DOM/media/storage harness.
- `.github/workflows/whispersync.yml`: feature regression gate using repository-pinned
  tools; the separate static-build workflow retains full app typecheck/build coverage.

## Validation commands and required merge qualification

With the repository's dependencies installed:

```sh
node test/whispersync/run.mjs --svelte
pnpm test:reader
pnpm --dir apps/web check
pnpm build
```

The app-local check command invokes `svelte-check --tsconfig ./tsconfig.json`, as
verified in the target package manifest. The standalone runner strictly typechecks the
core modules and runs Node tests. `--svelte` additionally invokes the installed
Svelte compiler for the route and both components (client and server); it is not a replacement for Svelte type
checking or the full application build.

The browser harness is optional and uses Python Playwright (not a new application
runtime dependency). It generates its own silent WAV and never uses a real book
or copyrighted audio fixture:

```sh
node test/whispersync/run.mjs --browser-bundle=/tmp/ws-browser/bundle.js
python test/whispersync/browser.py /tmp/ws-browser/bundle.js
# Optional: --chromium /path/to/chromium
```

`--offline-dom` uses `about:blank` without HTTP navigation and skips three
origin-dependent IndexedDB tests. Do not count those as passed. Its media test uses
an autoplay-permissive test-launch setting to exercise the controller, so real
user-gesture policy must still be checked in normal browsers.

Before merging, run the actual app and verify horizontal/vertical × paginated/
continuous reading, mobile safe areas, drawer/focus/keyboard behavior, lazy chunk
loading offline, dark/light reader themes, a long audiobook, native codec failures,
reload/resume, denied/full browser storage, slow file replacement, deleting saved
data with a pending save, changing books while matching, subtitle injection as
plain text and extension dictionary interaction. Test at least Chromium and
Safari/iOS, and Firefox where supported. These are qualification steps, not claims
that they have already passed.

See [the deeper review record](whispersync-review.md) for reproduced failures,
local toolchain versions and the remaining qualification boundary.
