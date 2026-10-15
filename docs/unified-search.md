# Unified dictionary and library search

## Interaction

Search has two independent controls.

**Search in** selects the source family: **Everything**, **Books**, or
**Snippets**. **Everything** includes Dictionary, saved book/snippet metadata and
body text, and—only in video-enabled builds—saved video titles and already
published transcript tracks. **Books** and **Snippets** never initialize the
other source's search lifetime. Their source choice is navigation state, survives
reloads, and does not rewrite the editable query.

**Show** selects the result presentation: **All**, **Dictionary**, **Titles**, or
**Content**. Dictionary is available only for Everything. All previews at most
two results from each section; See all switches to the corresponding dedicated
view. Dictionary mode requests full structured entries instead of stretching a
clipped preview. Titles rank displayed titles globally across source types as
exact, prefix, token-boundary, then interior substring matches; source type never
lets a weaker displayed-title match outrank a stronger one. Visible title matches
are highlighted using ranges mapped back to the original text, including
compatibility-width and ligature cases. Books admitted only by canonical title,
author, series/folder, or collection metadata remain visible after literal title
matches and show that provenance instead of pretending the displayed title
matched. Content stays source-diverse because book, snippet and transcript body
workers do not expose directly comparable relevance scores. Titles and Content
reveal additional batches of 30 with a keyboard focus anchor.

Every asynchronous source owns cancellation, stale-result suppression, loading,
failure and retry independently. A dictionary, snippet, video-store, or book-body
failure must not erase successful sibling results. Switching to Books does not
require Snippets scope readiness, and vice versa. Titles and Content also own
independent invalidation lifetimes: caption-only video changes refresh Content
without restarting Titles, while video metadata changes refresh both sections.
Dictionary-only typing does not restart either library section.

## Code ownership

- `media/search-text.ts` owns dependency-free normalization, field precedence,
  ranking and metadata highlight offsets. Both Reader and the standalone media
  build compile this implementation. `library/search-normalization.ts` preserves
  existing library and worker imports through re-exports.
- `search/result-rows.ts` turns book, snippet and video hits into display rows
  with typed navigation targets. Canonical book/snippet locators and precise video
  timestamps remain source data; the component opens those targets.
- `search/source-session.ts` owns concurrent Content source admission, stable
  interleaving, partial-result failures and cancellation. Each source reports
  completion through its batches; receiving its cleanup only confirms admission.
  A session retires workers returned after cancellation and suppresses results
  after an account boundary changes.
- `library-react/search-controller.ts` and `library-react/search.tsx` own the
  active React scope/filter interactions, query admission, navigation, accessible
  rendering and focus. `search/unified-search.svelte` retains the legacy path.
  Dictionary, Titles and Content keep their independent query lifetimes. Source
  workers own idempotent termination, including initial receiver/postMessage failures.

## PR261 source checkpoint — October 13, 2026

The inspected search head was `354a6a683f4b67843293f8d9f0aadac96f4d606b`,
against main `a1101b66db4c194140aeb4a8d6edcdfc86b4c770`. Its metadata snapshot,
grouped folder/series/collection contexts, folded direct fields, scalar revisions,
and 100 ms cancellable title admission were already implemented in both paths.
The React workspace also retained its corpus across query-only edits and kept
the hidden shelf unfiltered outside selection mode. No replacement index or
ranking redesign was needed. Admitted substring matching remains intentionally
linear; matching Books retain corpus order before the existing relevance sorter.

This combined draft incorporates repaired UI PR263 head
`f75e8fa04474dff063ab6b6ffacb31cf1404ac08`, including PR262 head
`75674fd06ca8eb9e2a80b1cae868e79bc96433aa`, as ancestors. The shared
`library-react/workspace.tsx` merge retains the indexed search props and the UI
changes. `screen.tsx`, Editor's Picks containment, EPUB language/direction and
video selection repairs are preserved. The header retains synchronous selection
exit and the committed-layout `wasSelecting`/`restoreSelectionFocus()` path.
The UI owner confirmed these heads and no pending source edits before the search
header follow-up. Its branches were not changed.

Focused follow-up changes:

- Compact search Escape checks tracked composition, React native composition,
  and key code 229 before clearing the query. Controller and DOM journey
  regression sources cover that boundary; these do not claim physical IME coverage.
- The React result view uses the shared, early-exit 512-code-point admission
  result instead of allocating a spread array for arbitrarily long input.
- The retained hot-path regression now supplies a membership filter, so its
  expected Snippet key read exercises the intended admission path. Its corpus-read
  and debounce assertions remain intact.
- Four reported formatting defects are corrected directly from the retained
  lint diagnostics, without running a formatter or lint.

Historical evidence remains open:

- At `354a6a68`, the [Unified search contract run](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37541381244)
  succeeded. That dependency-free job excludes the React controller regression.
- The [static-build job](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37541381070/job/112535309439)
  failed in unit tests on the React hot-path fixture (`0 !== 1`, line 441).
  Compilation and browser acceptance in that job were skipped. The missing
  membership filter explains that assertion by source inspection; the repaired
  fixture has not been executed.
- The [CI lint job](https://github.com/ManabiIO/manabi-reader-web/actions/runs/37541381279/job/112534952405)
  failed on four formatting diagnostics in the title snapshot, scope helper and
  title snapshot regressions. Its test build was skipped.
- Other failed/cancelled workflows for the old head remain historical evidence.
  UI failures and sibling repair obligations are retained in
  [the UI composition record](web-design-2026.md). Neither old successes nor
  source composition qualify the new combined tree.

### Deferred validation packet — all UNRUN

No build, test, type check, lint, benchmark, package install, browser/native run,
asset generation or manual CI dispatch was performed for this follow-up. An
authorized verifier must first freeze and read back the exact published PR261
head, then qualify that tree as one unit:

1. Run the retained dependency-free search suites, the repaired React controller
   suite, and the workspace/route boundary regressions. Check same-reference
   O(1) behavior, equivalent replacements, searchable-field invalidation, dormant
   source families, nested/overlapping contexts and preserved Book order.
2. Run type/lint and production compilation, retaining failures and skips. Cover
   ordinary/default-off and video-enabled packaging according to existing workflows.
3. Run the real unified-search journeys on the supported browser engines:
   title/metadata ranking, scope reload/history, middle edits and IME Escape,
   512/513 supplementary-code-point queries, Book rename and Snippet/media
   invalidation, rapid replacement/clear/unmount, account retirement and exact
   Book/Snippet/video locator navigation. Supplement synthetic IME events with
   physical Japanese IME acceptance.
4. Run the composed UI packet from `web-design-2026.md`, including enlarged
   phone/tablet search, selection focus, Picks containment/reopen, EPUB RTL and
   video shelf selection. Inspect retained failures; do not infer success from a
   different sibling head.

PR261 remains a draft. This source-only checkpoint does not establish runtime
resolution of historical failures or release readiness. No target-branch merge,
PR closure, deployment, persisted-data schema change or production mutation occurred.

## Dictionary behavior

Raw text stays unchanged in the global input. Dictionary search alone evaluates
Japanese spelling and romaji alternatives using Manabitan's existing converter
and Yomitan-derived translator/deinflector.

Exact and deinflected results always outrank completion. When all exact candidates
miss, the pinned runtime may perform a conservative implicit prefix lookup only
for a completed Japanese candidate of at least two code points with no remaining
Latin letters. This allows partial romaji such as `gakko` to become
`がっこ` and complete to words such as `学校` without turning arbitrary
English or unfinished romaji into prefix enumeration. Prefix-derived results are
labeled explicitly. A trailing `*` remains the explicit prefix-search form.

Both search inputs retain composition-aware updates; intermediate IME text is not
submitted, and Escape does not dismiss an active IME candidate list.

The embedded renderer reuses Manabitan's static structured definitions, frequency
information and dictionary media handling. The extension keeps its full UI.
Embedded audio, Anki and complete extension-UI parity are not claimed here.
English-gloss reverse search and new grammar data are not implemented.

## Books, snippets and video

Books and snippets retain differentiated labels and canonical locators. Content
highlights always use source-produced original-text offsets rather than re-searching
a displayed excerpt with a regex. This preserves compatibility-width text,
furigana-backed snippet matches, ligatures and supplementary characters. Snippet
navigation preserves the existing snippet locator.

Video search is read-only over the media database. Titles come from saved
`video_info` records. Content search reads only complete, published transcript
tracks and applies saved per-track subtitle delays when producing timestamp
locators. It does **not** reconnect a File/cloud source, download video bytes,
start MOSS, or publish a transcript. Equivalent cues across candidate tracks are
deduplicated; authored transcription tracks retain preference over generated or
translation duplicates. Transcript excerpts remain bounded but center on the
source-mapped match, so a long cue cannot clip the matching text off-screen.
Results are bounded per video and overall.

Transcript navigation uses
`/videos?media=<content-key>&time=<seconds>&track=<track-id>`. Opening such a
result reuses the media workspace's normal source/account checks, selects the
matched published track when it still exists, seeks while paused, and never
autoplays.

Transcript search enumerates validated track manifests once per query, groups
them by content identity, skips videos with no transcript manifest without
opening another IndexedDB transaction, and hydrates only the required caption
pages. Account changes and query replacement cancel publication.

## Release and ownership boundary

Video learning is integrated in Reader PR #157 but remains a **default-off build
feature**. `VITE_ENABLE_VIDEO_LEARNING=true` enables Videos navigation,
video search, the media profile watcher and the `/videos` workspace. Ordinary
builds hide those entry points; direct `/videos` access renders a page-not-found
view without mounting the workspace. Heavy media modules are loaded dynamically
only in enabled paths.

MOSS runtime files are excluded from the offline application shell in every
build. Enabled builds retain and verify the pinned single/threaded runtime.
Default-off production builds remove `build/moss` after compilation and CI
asserts that no MOSS artifact remains. This front-end gate does not enable the
separate Reader backend serving/API boundary.

The historical video stack (#46 / #67 / #79 / #153) is superseded by #157.
Do not land new product fixes on those closed branches.

## Pinned dictionary assets and local ownership

`manabitan-version.json` selects an exact companion Manabitan commit.
`pnpm prepare:dictionary` builds that revision (or a clean checkout supplied
with `MANABITAN_SOURCE`) and verifies generated assets. Normal root build/dev
includes this preparation; a warm local build reuses verified output. First
preparation needs GitHub/npm network access. Direct `apps/web` builds must
prepare first.

Runtime assets are under `static/manabitan/<revision>/`; the optional Jitendex
ZIP is under `static/dictionary-archives/`. Service-worker exclusions keep both
out of eager shell caching. The runtime is dynamically loaded only when dictionary
search is used. Installing Jitendex or an imported ZIP is explicit. Full Dictionary mode also
lists Reader-local dictionaries and lets the user enable, disable, or explicitly
confirm deletion without touching extension storage. Any such mutation reopens
the local translator before the active query runs again, so stale dictionary
state cannot survive management changes. Dictionary discovery reads the Japanese
section of the pinned Manabitan recommendation catalog only when the user opens
it; publisher/homepage links are validated HTTPS links and open externally.
Reader does not background-download or auto-install recommendations. The Jitendex
archive is pinned by byte count and SHA-256.

One lease-owned dictionary worker is shared per tab. Closing search retires its
worker; a replacement waits for retirement. Other tabs' exclusive-storage
failures appear as dictionary errors rather than empty results. No user query is
sent to a third-party dictionary service. Web dictionaries remain separate from
the installed extension's storage and preferences.

The GPL runtime retains LICENSE, per-file notices and corresponding source/build
instructions alongside the assets. Dictionary licensing remains separate.

## Research and acceptance

The Moe Way strongly favors Yomitan; its resources do not establish universal
consensus for Takoboto or a grammar-based reason to prefer it. Takoboto, Jotoba
and Jiten remain useful references alongside Jisho. Jiten's combined
words/sentences/media entry point is especially aligned with this design.

Sources: https://learnjapanese.moe/resources/ ; https://takoboto.jp/ ;
https://jotoba.de/tour ; https://jiten.moe/ ;
https://www.w3.org/WAI/ARIA/apg/patterns/tabs/

Merge qualification belongs to the exact selected Reader and Manabitan heads:
query-lifetime tests; Svelte/TypeScript/lint and production builds; no-extension
setup; Jitendex/custom ZIP import; Japanese IME and middle-of-input edits;
exact/deinflected/prefix precedence; stale success/error suppression; independent
source failures; full-entry expansion; mobile/200% text; light/dark themes;
keyboard and assistive-technology navigation; account/scope changes; exact
book/snippet navigation; video timestamp navigation; and enabled/default-off
packaging. Build or unit success alone is not manual/browser qualification.
